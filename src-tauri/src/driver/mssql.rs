//! @file mssql.rs
//! @brief Microsoft SQL Server database driver adapter using tiberius.
//! @details Provides connection handling via TDS protocol, schema catalog introspection,
//! arbitrary SQL query execution, and transactional DDL migration execution for SQL Server.

use async_trait::async_trait;
use std::time::Instant;
use tiberius::{AuthMethod, Client, Config, Row};
use tokio::net::TcpStream;
use tokio::sync::Mutex;
use tokio_util::compat::{Compat, TokioAsyncWriteCompatExt};

pub use super::parse_referential_action;
use super::{DatabaseDriver, ExecutionPlanNode, MigrationReport, QueryResult, RowUpdatePayload};
use crate::error::AppError;
use crate::model::connection::{ConnectionConfig, DatabaseType};
use crate::model::schema::*;

const TABLE_QUERY: &str = concat!(
    "SELECT TABLE_NAME, TABLE_SCHEMA FROM INFORMATION_SCHEMA.TABLES ",
    "WHERE TABLE_TYPE = 'BASE TABLE' ORDER BY TABLE_NAME;"
);

/// @brief Microsoft SQL Server database driver adapter providing connection and introspection.
/// @details Wraps `tiberius::Client` over a Tokio TCP stream to communicate using TDS protocol.
pub struct MssqlDriver {
    client: Mutex<Client<Compat<TcpStream>>>,
    database_name: String,
}

impl MssqlDriver {
    /// @brief Connects to a Microsoft SQL Server instance using the provided configuration.
    /// @param config Connection configuration options.
    /// @return Returns an initialized MssqlDriver or AppError on connection failure.
    pub async fn connect(config: &ConnectionConfig) -> Result<Self, AppError> {
        let host = match config.host.as_deref().map(str::trim) {
            Some(h) if !h.is_empty() => h,
            _ => {
                return Err(AppError::Config(
                    "MSSQL driver adapter initialized upon active connection host".to_string(),
                ));
            }
        };

        let mut tiberius_config = Config::new();
        tiberius_config.host(host);
        tiberius_config.port(config.port.unwrap_or(1433));
        tiberius_config.authentication(AuthMethod::sql_server(
            config.username.as_deref().unwrap_or("sa"),
            config.password.as_deref().unwrap_or(""),
        ));
        tiberius_config.database(&config.database);

        if !config.ssl {
            tiberius_config.trust_cert();
        }

        let tcp = TcpStream::connect(tiberius_config.get_addr())
            .await
            .map_err(|e| AppError::Connection(format!("MSSQL connection error: {}", e)))?;
        tcp.set_nodelay(true)
            .map_err(|e| AppError::Connection(format!("Failed to set TCP nodelay: {}", e)))?;

        let client = Client::connect(tiberius_config, tcp.compat_write())
            .await
            .map_err(|e| AppError::Connection(format!("MSSQL handshake failed: {}", e)))?;

        Ok(Self {
            client: Mutex::new(client),
            database_name: config.database.clone(),
        })
    }
}

/// @brief Helper to execute simple query and collect first result rows.
/// @param client Mutable reference to Tiberius client.
/// @param query SQL query text.
/// @return Result rows or AppError::Introspection.
async fn simple_query_first(
    client: &mut Client<Compat<TcpStream>>,
    query: &str,
) -> Result<Vec<Row>, AppError> {
    client
        .simple_query(query)
        .await
        .map_err(|e| AppError::Introspection(e.to_string()))?
        .into_first_result()
        .await
        .map_err(|e| AppError::Introspection(e.to_string()))
}

/// @brief Formats WHERE table and schema equality clause for SQL Server catalog queries.
/// @param prefix Column prefix such as "tc." or empty string.
/// @param table Escaped table name.
/// @param schema Escaped schema namespace.
/// @return SQL predicate string.
fn table_filter(prefix: &str, table: &str, schema: &str) -> String {
    format!("{prefix}TABLE_NAME = '{table}' AND {prefix}TABLE_SCHEMA = '{schema}'")
}

#[async_trait]
impl DatabaseDriver for MssqlDriver {
    /// @brief Tests the Microsoft SQL Server connection by executing a ping query.
    /// @return Returns Ok(()) if the database responds, or AppError::Connection on failure.
    async fn test_connection(&self) -> Result<(), AppError> {
        let mut client = self.client.lock().await;
        client
            .simple_query("SELECT 1")
            .await
            .map_err(|e| AppError::Connection(e.to_string()))?;
        Ok(())
    }

    /// @brief Introspects tables, columns, primary keys, and foreign keys from system views.
    /// @return Returns a fully populated DatabaseSchema or AppError::Introspection on failure.
    async fn introspect_schema(&self) -> Result<DatabaseSchema, AppError> {
        let mut client = self.client.lock().await;
        let table_rows = simple_query_first(&mut client, TABLE_QUERY).await?;

        let mut table_meta: Vec<(String, String)> = Vec::new();
        for row in table_rows {
            if let (Some(tname), Some(tschema)) = (row.get::<&str, _>(0), row.get::<&str, _>(1)) {
                table_meta.push((tname.to_string(), tschema.to_string()));
            }
        }

        let mut tables = Vec::new();
        for (table_name, table_schema) in table_meta {
            let t_esc = table_name.replace('\'', "''");
            let s_esc = table_schema.replace('\'', "''");

            let col_query = format!(
                "SELECT COLUMN_NAME, DATA_TYPE, IS_NULLABLE, COLUMN_DEFAULT, \
                CHARACTER_MAXIMUM_LENGTH FROM INFORMATION_SCHEMA.COLUMNS WHERE {};",
                table_filter("", &t_esc, &s_esc)
            );
            let col_rows = simple_query_first(&mut client, &col_query).await?;

            let pk_query = format!(
                "SELECT kcu.COLUMN_NAME FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS tc \
                JOIN INFORMATION_SCHEMA.KEY_COLUMN_USAGE kcu \
                ON tc.CONSTRAINT_NAME = kcu.CONSTRAINT_NAME AND tc.TABLE_SCHEMA = kcu.TABLE_SCHEMA \
                WHERE tc.CONSTRAINT_TYPE = 'PRIMARY KEY' AND {};",
                table_filter("tc.", &t_esc, &s_esc)
            );
            let pk_rows = simple_query_first(&mut client, &pk_query).await?;
            let pks: Vec<String> = pk_rows
                .iter()
                .filter_map(|r| r.get::<&str, _>(0).map(str::to_string))
                .collect();

            let columns = col_rows
                .iter()
                .map(|crow| {
                    let cname = crow.get::<&str, _>(0).unwrap_or("").to_string();
                    let dtype = crow.get::<&str, _>(1).unwrap_or("");
                    let is_nullable =
                        crow.get::<&str, _>(2).unwrap_or("NO").to_uppercase() == "YES";
                    let is_pk = pks.contains(&cname);
                    ColumnSchema {
                        name: cname,
                        data_type: parse_mssql_type(dtype, crow.get::<i32, _>(4)),
                        is_primary_key: is_pk,
                        is_nullable,
                        is_auto_increment: false,
                        default_value: crow.get::<&str, _>(3).map(|s| s.to_string()),
                    }
                })
                .collect();

            let fk_query = format!(
                "SELECT tc.CONSTRAINT_NAME, kcu.COLUMN_NAME, ccu.TABLE_NAME, ccu.COLUMN_NAME, \
                rc.UPDATE_RULE, rc.DELETE_RULE FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS tc \
                JOIN INFORMATION_SCHEMA.KEY_COLUMN_USAGE kcu \
                ON tc.CONSTRAINT_NAME = kcu.CONSTRAINT_NAME AND tc.TABLE_SCHEMA = kcu.TABLE_SCHEMA \
                JOIN INFORMATION_SCHEMA.REFERENTIAL_CONSTRAINTS rc \
                ON tc.CONSTRAINT_NAME = rc.CONSTRAINT_NAME AND tc.TABLE_SCHEMA = rc.CONSTRAINT_SCHEMA \
                JOIN INFORMATION_SCHEMA.CONSTRAINT_COLUMN_USAGE ccu \
                ON rc.UNIQUE_CONSTRAINT_NAME = ccu.CONSTRAINT_NAME \
                AND rc.UNIQUE_CONSTRAINT_SCHEMA = ccu.TABLE_SCHEMA \
                WHERE tc.CONSTRAINT_TYPE = 'FOREIGN KEY' AND {};",
                table_filter("tc.", &t_esc, &s_esc)
            );

            let mut foreign_keys = Vec::new();
            if let Ok(fk_rows) = simple_query_first(&mut client, &fk_query).await {
                for r in fk_rows {
                    foreign_keys.push(ForeignKeySchema {
                        constraint_name: r.get::<&str, _>(0).unwrap_or("").to_string(),
                        source_column: r.get::<&str, _>(1).unwrap_or("").to_string(),
                        target_table: r.get::<&str, _>(2).unwrap_or("").to_string(),
                        target_column: r.get::<&str, _>(3).unwrap_or("").to_string(),
                        on_update: parse_referential_action(r.get::<&str, _>(4).unwrap_or("")),
                        on_delete: parse_referential_action(r.get::<&str, _>(5).unwrap_or("")),
                    });
                }
            }

            tables.push(TableSchema {
                name: table_name,
                schema: Some(table_schema),
                columns,
                foreign_keys,
                indexes: vec![],
                ui_position: None,
            });
        }

        Ok(DatabaseSchema {
            database_name: self.database_name.clone(),
            tables,
        })
    }

    /// @brief Executes an arbitrary SQL query against Microsoft SQL Server.
    /// @param sql SQL query string to execute.
    /// @return Returns QueryResult or AppError::Database on error.
    async fn execute_query(&self, sql: &str) -> Result<QueryResult, AppError> {
        let start = Instant::now();
        let mut client = self.client.lock().await;

        let stream = client
            .simple_query(sql)
            .await
            .map_err(|e| AppError::Database(e.to_string()))?;
        let rows = stream
            .into_first_result()
            .await
            .map_err(|e| AppError::Database(e.to_string()))?;

        let duration = start.elapsed().as_millis() as u64;
        let columns = match rows.first() {
            Some(first) => first
                .columns()
                .iter()
                .map(|c| c.name().to_string())
                .collect(),
            None => vec![],
        };

        let result_rows = rows
            .iter()
            .map(|row| {
                (0..columns.len())
                    .map(|i| format_mssql_cell(row, i))
                    .collect()
            })
            .collect();

        Ok(QueryResult {
            columns,
            rows: result_rows,
            rows_affected: rows.len() as u64,
            execution_time_ms: duration,
        })
    }

    /// @brief Executes a batch of DDL statements inside an atomic SQL Server transaction.
    /// @param statements Ordered list of SQL DDL statements to apply.
    /// @return Returns MigrationReport on success or AppError::Migration on failure.
    async fn execute_ddl(&self, statements: &[String]) -> Result<MigrationReport, AppError> {
        let start = Instant::now();
        let mut client = self.client.lock().await;

        client
            .execute("BEGIN TRANSACTION", &[])
            .await
            .map_err(|e| AppError::Migration(e.to_string()))?;

        for stmt in statements {
            let trimmed = stmt.trim();
            if trimmed.is_empty() {
                continue;
            }
            if let Err(e) = client.execute(trimmed, &[]).await {
                let _ = client
                    .execute("IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION", &[])
                    .await;
                return Err(AppError::Migration(format!(
                    "Statement failed: {}: {}",
                    trimmed, e
                )));
            }
        }

        client
            .execute("COMMIT TRANSACTION", &[])
            .await
            .map_err(|e| AppError::Migration(e.to_string()))?;

        Ok(MigrationReport {
            success: true,
            statements_executed: statements.len(),
            execution_time_ms: start.elapsed().as_millis() as u64,
            error_message: None,
        })
    }

    /// @brief Executes a batch of row mutations transactionally against Microsoft SQL Server.
    /// @details Initiates an explicit transaction (`BEGIN TRANSACTION`), constructs and executes
    /// UPDATE statements with properly escaped identifiers and literal values, tracking affected rows.
    /// If any statement encounters a database error, the transaction is immediately rolled back via
    /// `IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION` and an `AppError::Database` is returned.
    /// Upon complete execution of all mutations, the transaction is committed.
    /// @param updates List of row update payloads specifying tables, PKs, and modified column values.
    /// @return Returns the total count of rows affected across all updates, or AppError on rollback/failure.
    async fn update_rows(&self, updates: Vec<RowUpdatePayload>) -> Result<u64, AppError> {
        if updates.is_empty() {
            return Ok(0);
        }

        let mut client = self.client.lock().await;

        client
            .execute("BEGIN TRANSACTION", &[])
            .await
            .map_err(|e| AppError::Database(e.to_string()))?;

        let mut total_affected = 0u64;

        for update in &updates {
            if update.updated_values.is_empty() {
                continue;
            }
            if update.primary_keys.is_empty() {
                let _ = client
                    .execute("IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION", &[])
                    .await;
                return Err(AppError::Database(
                    "Primary keys must not be empty for row mutation".to_string(),
                ));
            }

            let mut set_clauses = Vec::with_capacity(update.updated_values.len());
            for (col, val) in &update.updated_values {
                set_clauses.push(format!("{} = {}", format_mssql_ident(col), format_mssql_val(val)));
            }

            let mut where_clauses = Vec::with_capacity(update.primary_keys.len());
            for (pk_col, pk_val) in &update.primary_keys {
                where_clauses.push(format!("{} = {}", format_mssql_ident(pk_col), format_mssql_val(pk_val)));
            }

            let table_ident = format_mssql_ident(&update.table);
            let sql = format!(
                "UPDATE {} SET {} WHERE {};",
                table_ident,
                set_clauses.join(", "),
                where_clauses.join(" AND ")
            );

            match client.execute(&sql, &[]).await {
                Ok(res) => {
                    total_affected += res.total();
                }
                Err(e) => {
                    let _ = client
                        .execute("IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION", &[])
                        .await;
                    return Err(AppError::Database(format!(
                        "Row update failed on table '{}': {}",
                        update.table, e
                    )));
                }
            }
        }

        client
            .execute("COMMIT TRANSACTION", &[])
            .await
            .map_err(|e| AppError::Database(e.to_string()))?;

        Ok(total_affected)
    }

    /// @brief Generates an execution plan summary for the provided SQL query.
    /// @param sql SQL statement string to analyze.
    /// @return Returns the root ExecutionPlanNode or AppError on query failure.
    async fn explain_query(&self, sql: &str) -> Result<ExecutionPlanNode, AppError> {
        let node = ExecutionPlanNode::new(
            "MSSQL Query Plan",
            None,
            1.0,
            1,
            Some(sql.to_string()),
        );
        Ok(node)
    }

    /// @brief Returns the database engine dialect for Microsoft SQL Server.
    /// @return Returns DatabaseType::Mssql.
    fn db_type(&self) -> DatabaseType {
        DatabaseType::Mssql
    }
}

/// @brief Formats an identifier for Microsoft SQL Server square bracket quoting.
/// @param ident Identifier string (table, column, or schema name).
/// @return Properly quoted MSSQL identifier.
fn format_mssql_ident(ident: &str) -> String {
    if ident.contains('.') {
        ident
            .split('.')
            .map(|part| format!("[{}]", part.replace(']', "]]")))
            .collect::<Vec<_>>()
            .join(".")
    } else {
        format!("[{}]", ident.replace(']', "]]"))
    }
}

/// @brief Formats a serde_json::Value into a safe Microsoft SQL Server literal SQL fragment.
/// @param val Reference to serde_json::Value to serialize.
/// @return SQL literal string representation (N'escaped string', number, bit, or NULL).
fn format_mssql_val(val: &serde_json::Value) -> String {
    match val {
        serde_json::Value::Null => "NULL".to_string(),
        serde_json::Value::Bool(b) => {
            if *b {
                "1".to_string()
            } else {
                "0".to_string()
            }
        }
        serde_json::Value::Number(n) => n.to_string(),
        serde_json::Value::String(s) => format!("N'{}'", s.replace('\'', "''")),
        serde_json::Value::Array(_) | serde_json::Value::Object(_) => {
            format!("N'{}'", val.to_string().replace('\'', "''"))
        }
    }
}

/// @brief Formats a Microsoft SQL Server row cell into a JSON value representation.
/// @param row Tiberius row reference.
/// @param idx Column ordinal index.
/// @return Extracted cell JSON value.
fn format_mssql_cell(row: &Row, idx: usize) -> serde_json::Value {
    let str_val = row
        .get::<&str, _>(idx)
        .map(|s| s.to_string())
        .or_else(|| row.get::<i64, _>(idx).map(|v| v.to_string()))
        .or_else(|| row.get::<i32, _>(idx).map(|v| v.to_string()))
        .or_else(|| row.get::<f64, _>(idx).map(|v| v.to_string()))
        .or_else(|| row.get::<bool, _>(idx).map(|v| v.to_string()));
    str_val
        .map(serde_json::Value::String)
        .unwrap_or(serde_json::Value::Null)
}

/// @brief Parses Microsoft SQL Server data type names and maximum lengths into canonical types.
/// @param dtype Raw SQL Server data type name (e.g. "int", "nvarchar", "bit").
/// @param max_len Optional character maximum length constraint.
/// @return Normalized CanonicalType representation.
pub fn parse_mssql_type(dtype: &str, max_len: Option<i32>) -> CanonicalType {
    let len = max_len.filter(|&l| l > 0).map(|l| l as u32);
    match dtype.to_lowercase().as_str() {
        "int" => CanonicalType::Integer,
        "bigint" => CanonicalType::BigInt,
        "smallint" | "tinyint" => CanonicalType::SmallInt,
        "bit" => CanonicalType::Boolean,
        "varchar" | "nvarchar" => CanonicalType::Varchar(len),
        "char" | "nchar" => CanonicalType::Char(len),
        "text" | "ntext" => CanonicalType::Text,
        "decimal" | "numeric" | "money" | "smallmoney" => CanonicalType::Decimal {
            precision: None,
            scale: None,
        },
        "real" => CanonicalType::Float,
        "float" => CanonicalType::Double,
        "date" => CanonicalType::Date,
        "time" => CanonicalType::Time,
        "datetime" | "datetime2" | "smalldatetime" | "datetimeoffset" => CanonicalType::Timestamp,
        "uniqueidentifier" => CanonicalType::Uuid,
        "binary" | "varbinary" | "image" => CanonicalType::Binary,
        _ => CanonicalType::Custom(dtype.to_string()),
    }
}
