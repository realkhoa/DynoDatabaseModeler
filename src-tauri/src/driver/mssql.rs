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
use super::{
    is_row_returning, qualify, with_decimal_metadata, DatabaseDriver, ExecutionPlanNode,
    MigrationReport, QueryResult, RowUpdatePayload,
};
use crate::error::AppError;
use crate::model::connection::{ConnectionConfig, DatabaseType};
use crate::model::schema::*;

const TABLE_QUERY: &str = concat!(
    "SELECT TABLE_NAME, TABLE_SCHEMA FROM INFORMATION_SCHEMA.TABLES ",
    "WHERE TABLE_TYPE = 'BASE TABLE' ORDER BY TABLE_SCHEMA, TABLE_NAME;"
);

const COL_QUERY: &str = concat!(
    "SELECT COLUMN_NAME, DATA_TYPE, IS_NULLABLE, COLUMN_DEFAULT, CHARACTER_MAXIMUM_LENGTH, ",
    "       NUMERIC_PRECISION, NUMERIC_SCALE, ",
    "       COLUMNPROPERTY(OBJECT_ID(@P3), COLUMN_NAME, 'IsIdentity') AS IS_IDENTITY ",
    "FROM INFORMATION_SCHEMA.COLUMNS ",
    "WHERE TABLE_SCHEMA = @P1 AND TABLE_NAME = @P2 ORDER BY ORDINAL_POSITION;"
);

const PK_QUERY: &str = concat!(
    "SELECT kcu.COLUMN_NAME FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS tc ",
    "JOIN INFORMATION_SCHEMA.KEY_COLUMN_USAGE kcu ",
    "  ON tc.CONSTRAINT_NAME = kcu.CONSTRAINT_NAME AND tc.TABLE_SCHEMA = kcu.TABLE_SCHEMA ",
    "WHERE tc.CONSTRAINT_TYPE = 'PRIMARY KEY' AND tc.TABLE_SCHEMA = @P1 AND tc.TABLE_NAME = @P2 ",
    "ORDER BY kcu.ORDINAL_POSITION;"
);

/// @brief Composite-safe foreign key introspection from the `sys` catalog.
/// @details `INFORMATION_SCHEMA.CONSTRAINT_COLUMN_USAGE` joined on `UNIQUE_CONSTRAINT_NAME`
/// cannot resolve composite keys or keys backed by a unique index, so `sys.foreign_key_columns`
/// is used instead. The referenced table is returned schema-qualified.
const FK_QUERY: &str = concat!(
    "SELECT fk.name AS CONSTRAINT_NAME, pc.name AS SOURCE_COLUMN, ",
    "       rs.name AS TARGET_SCHEMA, rt.name AS TARGET_TABLE, rc.name AS TARGET_COLUMN, ",
    "       fk.update_referential_action_desc AS ON_UPDATE, ",
    "       fk.delete_referential_action_desc AS ON_DELETE ",
    "FROM sys.foreign_keys fk ",
    "JOIN sys.foreign_key_columns fkc ON fkc.constraint_object_id = fk.object_id ",
    "JOIN sys.tables rt ON rt.object_id = fkc.referenced_object_id ",
    "JOIN sys.schemas rs ON rs.schema_id = rt.schema_id ",
    "JOIN sys.columns pc ON pc.object_id = fkc.parent_object_id ",
    "  AND pc.column_id = fkc.parent_column_id ",
    "JOIN sys.columns rc ON rc.object_id = fkc.referenced_object_id ",
    "  AND rc.column_id = fkc.referenced_column_id ",
    "WHERE fk.parent_object_id = OBJECT_ID(@P1) ",
    "ORDER BY fk.name, fkc.constraint_column_id;"
);

/// @brief Secondary index introspection, excluding primary key and hypothetical indexes.
const INDEX_QUERY: &str = concat!(
    "SELECT i.name AS INDEX_NAME, i.is_unique AS IS_UNIQUE, c.name AS COLUMN_NAME ",
    "FROM sys.indexes i ",
    "JOIN sys.index_columns ic ON ic.object_id = i.object_id AND ic.index_id = i.index_id ",
    "JOIN sys.columns c ON c.object_id = ic.object_id AND c.column_id = ic.column_id ",
    "WHERE i.object_id = OBJECT_ID(@P1) AND i.is_primary_key = 0 ",
    "  AND i.is_hypothetical = 0 AND i.name IS NOT NULL AND ic.is_included_column = 0 ",
    "ORDER BY i.name, ic.key_ordinal;"
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
    /// @return Returns an initialized MssqlDriver or AppError::Connection on failure.
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
        let db_name = if config.database.trim().is_empty() {
            "master"
        } else {
            config.database.trim()
        };
        tiberius_config.database(db_name);

        // Tiberius always negotiates TLS (EncryptionLevel::Required by default). This flag only
        // controls server certificate validation: when disabled the driver trusts any certificate,
        // which is required for self-signed instances but is not equivalent to "no TLS".
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
            database_name: db_name.to_string(),
        })
    }
}

/// @brief Executes a parameterized catalog query and returns the first result set.
/// @param client Mutable reference to Tiberius client.
/// @param query SQL query text with `@P1`-style placeholders.
/// @param params Parameter values bound in placeholder order.
/// @return Result rows or AppError::Introspection.
async fn query_first(
    client: &mut Client<Compat<TcpStream>>,
    query: &str,
    params: &[&dyn tiberius::ToSql],
) -> Result<Vec<Row>, AppError> {
    client
        .query(query, params)
        .await
        .map_err(|e| AppError::Introspection(e.to_string()))?
        .into_first_result()
        .await
        .map_err(|e| AppError::Introspection(e.to_string()))
}

/// @brief Reads a catalog integer column regardless of the T-SQL integer width used.
/// @details `INFORMATION_SCHEMA.COLUMNS` exposes `NUMERIC_PRECISION` as `tinyint`, while
/// `CHARACTER_MAXIMUM_LENGTH` and `NUMERIC_SCALE` are `int` and `COLUMNPROPERTY` returns `int`.
/// Requesting the wrong width made the entire introspection fail, so every width is attempted.
/// @param row Tiberius row reference.
/// @param idx Column ordinal index.
/// @return The value widened to `i64`, or `None` when the column is NULL or not numeric.
fn mssql_int(row: &Row, idx: usize) -> Option<i64> {
    if let Ok(Some(value)) = row.try_get::<i32, _>(idx) {
        return Some(i64::from(value));
    }
    if let Ok(Some(value)) = row.try_get::<i16, _>(idx) {
        return Some(i64::from(value));
    }
    if let Ok(Some(value)) = row.try_get::<u8, _>(idx) {
        return Some(i64::from(value));
    }
    if let Ok(Some(value)) = row.try_get::<i64, _>(idx) {
        return Some(value);
    }
    None
}

/// @brief Normalizes a SQL Server referential action description.
/// @details The catalog reports `NO_ACTION`, `SET_NULL` and `SET_DEFAULT` with underscores.
/// @param desc Catalog description string.
/// @return Normalized ReferentialAction variant.
fn parse_mssql_action(desc: &str) -> ReferentialAction {
    parse_referential_action(&desc.replace('_', " "))
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
            .map_err(|e| AppError::Connection(e.to_string()))?
            .into_results()
            .await
            .map_err(|e| AppError::Connection(e.to_string()))?;
        Ok(())
    }

    /// @brief Introspects tables, columns, primary keys, foreign keys, and indexes from system views.
    /// @details Catalog queries are parameterized (no identifier interpolation), IDENTITY columns are
    /// detected through `COLUMNPROPERTY`, numeric precision/scale are read explicitly, and foreign
    /// key targets are stored schema-qualified.
    /// @return Returns a fully populated DatabaseSchema or AppError::Introspection on failure.
    async fn introspect_schema(&self) -> Result<DatabaseSchema, AppError> {
        let mut client = self.client.lock().await;

        let table_rows = client
            .simple_query(TABLE_QUERY)
            .await
            .map_err(|e| AppError::Introspection(e.to_string()))?
            .into_first_result()
            .await
            .map_err(|e| AppError::Introspection(e.to_string()))?;

        let mut table_meta: Vec<(String, String)> = Vec::new();
        for row in table_rows {
            if let (Some(tname), Some(tschema)) = (row.get::<&str, _>(0), row.get::<&str, _>(1)) {
                table_meta.push((tname.to_string(), tschema.to_string()));
            }
        }

        let mut tables = Vec::new();
        for (table_name, table_schema) in table_meta {
            let qualified = qualify(Some(&table_schema), &table_name);

            let col_rows = query_first(
                &mut client,
                COL_QUERY,
                &[&table_schema, &table_name, &qualified],
            )
            .await?;

            let pk_rows = query_first(&mut client, PK_QUERY, &[&table_schema, &table_name]).await?;
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
                    let numeric_precision = mssql_int(crow, 5);
                    let numeric_scale = mssql_int(crow, 6);
                    let is_identity = mssql_int(crow, 7).unwrap_or(0) != 0;
                    let max_len = mssql_int(crow, 4).and_then(|v| i32::try_from(v).ok());

                    ColumnSchema {
                        name: cname,
                        data_type: with_decimal_metadata(
                            parse_mssql_type(dtype, max_len),
                            numeric_precision,
                            numeric_scale,
                        ),
                        is_primary_key: is_pk,
                        is_nullable,
                        is_auto_increment: is_identity,
                        default_value: crow.get::<&str, _>(3).map(|s| s.to_string()),
                    }
                })
                .collect();

            let fk_rows = query_first(&mut client, FK_QUERY, &[&qualified]).await?;
            let mut foreign_keys = Vec::new();
            for r in fk_rows {
                let target_schema = r.get::<&str, _>(2).unwrap_or("");
                let target_table = r.get::<&str, _>(3).unwrap_or("");
                foreign_keys.push(ForeignKeySchema {
                    constraint_name: r.get::<&str, _>(0).unwrap_or("").to_string(),
                    source_column: r.get::<&str, _>(1).unwrap_or("").to_string(),
                    target_table: qualify(Some(target_schema), target_table),
                    target_column: r.get::<&str, _>(4).unwrap_or("").to_string(),
                    on_update: parse_mssql_action(r.get::<&str, _>(5).unwrap_or("NO_ACTION")),
                    on_delete: parse_mssql_action(r.get::<&str, _>(6).unwrap_or("NO_ACTION")),
                });
            }

            let index_rows = query_first(&mut client, INDEX_QUERY, &[&qualified]).await?;
            let mut indexes: Vec<IndexSchema> = Vec::new();
            for r in index_rows {
                let index_name = r.get::<&str, _>(0).unwrap_or("").to_string();
                let is_unique = r.get::<bool, _>(1).unwrap_or(false);
                let column_name = r.get::<&str, _>(2).unwrap_or("").to_string();

                match indexes.iter_mut().find(|i| i.name == index_name) {
                    Some(existing) => existing.columns.push(column_name),
                    None => indexes.push(IndexSchema {
                        name: index_name,
                        columns: vec![column_name],
                        is_unique,
                    }),
                }
            }

            tables.push(TableSchema {
                name: table_name,
                schema: Some(table_schema),
                columns,
                foreign_keys,
                indexes,
                ui_position: None,
                rename_from: None,
                unsupported_features: vec![],
            });
        }

        Ok(DatabaseSchema {
            database_name: self.database_name.clone(),
            tables,
        })
    }

    /// @brief Executes an arbitrary SQL query against Microsoft SQL Server.
    /// @details Row-returning statements are fetched; other statements report the statement's
    /// affected row count so DML is never reported as zero rows.
    /// @param sql SQL query string to execute.
    /// @return Returns QueryResult or AppError::Database on error.
    async fn execute_query(&self, sql: &str) -> Result<QueryResult, AppError> {
        let start = Instant::now();
        let mut client = self.client.lock().await;

        if !is_row_returning(sql) {
            let res = client
                .execute(sql, &[])
                .await
                .map_err(|e| AppError::Database(e.to_string()))?;
            return Ok(QueryResult {
                columns: vec![],
                rows: vec![],
                rows_affected: res.total(),
                execution_time_ms: start.elapsed().as_millis() as u64,
            });
        }

        let rows = client
            .simple_query(sql)
            .await
            .map_err(|e| AppError::Database(e.to_string()))?
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
    /// @details Initiates an explicit transaction, builds escaped UPDATE statements, and in strict
    /// single-row mode rolls the whole batch back unless exactly one row was affected.
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
            if let Err(message) = update.validate_locator() {
                let _ = client
                    .execute("IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION", &[])
                    .await;
                return Err(AppError::Database(message));
            }

            let mut set_clauses = Vec::with_capacity(update.updated_values.len());
            for (col, val) in &update.updated_values {
                set_clauses.push(format!(
                    "{} = {}",
                    format_mssql_ident(col),
                    format_mssql_val(val)
                ));
            }

            let mut where_clauses = Vec::with_capacity(update.primary_keys.len());
            for (pk_col, pk_val) in &update.primary_keys {
                where_clauses.push(format!(
                    "{} = {}",
                    format_mssql_ident(pk_col),
                    format_mssql_val(pk_val)
                ));
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
                    let affected = res.total();
                    if let Err(message) = update.check_affected_rows(affected) {
                        let _ = client
                            .execute("IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION", &[])
                            .await;
                        return Err(AppError::Database(message));
                    }
                    total_affected += affected;
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

    /// @brief Generates a real execution plan tree using `SET SHOWPLAN_XML ON`.
    /// @details SQL Server returns the estimated plan as XML without executing the statement, which
    /// is parsed into the shared plan tree. The session setting is always restored.
    /// @param sql SQL statement string to analyze.
    /// @return Returns the root ExecutionPlanNode or AppError on query failure.
    async fn explain_query(&self, sql: &str) -> Result<ExecutionPlanNode, AppError> {
        let mut client = self.client.lock().await;

        client
            .simple_query("SET SHOWPLAN_XML ON;")
            .await
            .map_err(|e| AppError::Database(format!("EXPLAIN failed: {}", e)))?
            .into_results()
            .await
            .map_err(|e| AppError::Database(format!("EXPLAIN failed: {}", e)))?;

        let plan_result = client
            .simple_query(sql)
            .await
            .map_err(|e| AppError::Database(format!("EXPLAIN failed: {}", e)))?
            .into_first_result()
            .await
            .map_err(|e| AppError::Database(format!("EXPLAIN failed: {}", e)));

        // Always restore the session setting, even if the plan query failed.
        let _ = client
            .simple_query("SET SHOWPLAN_XML OFF;")
            .await
            .map(|stream| stream.into_results());

        let rows = plan_result?;
        let xml = rows
            .first()
            .and_then(|r| r.get::<&str, _>(0))
            .unwrap_or_default();

        if xml.trim().is_empty() {
            return Ok(ExecutionPlanNode::new("Query Plan", None, 0.0, 0, None));
        }

        Ok(parse_showplan_xml(xml))
    }

    /// @brief Lists all databases available on the Microsoft SQL Server instance.
    /// @return Vector of database names on the server.
    async fn list_databases(&self) -> Result<Vec<String>, AppError> {
        let mut client = self.client.lock().await;
        let rows = client
            .simple_query("SELECT name FROM sys.databases WHERE state = 0 ORDER BY name;")
            .await
            .map_err(|e| AppError::Database(e.to_string()))?
            .into_first_result()
            .await
            .map_err(|e| AppError::Database(e.to_string()))?;

        let names: Vec<String> = rows
            .into_iter()
            .filter_map(|r| r.get::<&str, _>("name").map(|s| s.to_string()))
            .collect();
        Ok(names)
    }

    /// @brief Returns the database engine dialect for Microsoft SQL Server.
    /// @return Returns DatabaseType::Mssql.
    fn db_type(&self) -> DatabaseType {
        DatabaseType::Mssql
    }
}

/// @brief Reads one attribute value from an XML start tag body.
/// @param tag Body of a start tag.
/// @param attribute Attribute name to look up.
/// @return Attribute value when present.
fn xml_attribute(tag: &str, attribute: &str) -> Option<String> {
    let needle = format!("{}=\"", attribute);
    let start = tag.find(&needle)? + needle.len();
    let rest = &tag[start..];
    let end = rest.find('"')?;
    Some(rest[..end].to_string())
}

/// @brief Parses a SQL Server SHOWPLAN_XML document into an ExecutionPlanNode tree.
/// @details Tags are scanned sequentially; `RelOp` elements open and close plan nodes and an
/// `Object` element supplies the accessed relation for its enclosing operator.
/// @param xml SHOWPLAN_XML document text.
/// @return Root plan node, or a placeholder when no operator is present.
fn parse_showplan_xml(xml: &str) -> ExecutionPlanNode {
    let mut stack: Vec<ExecutionPlanNode> = Vec::new();
    let mut root: Option<ExecutionPlanNode> = None;
    let mut cursor = 0usize;

    while let Some(open) = xml[cursor..].find('<') {
        let tag_start = cursor + open;
        let Some(close_rel) = xml[tag_start..].find('>') else {
            break;
        };
        let tag_end = tag_start + close_rel + 1;
        let tag = &xml[tag_start..tag_end];
        cursor = tag_end;

        if tag.starts_with("</") {
            if tag.starts_with("</RelOp") {
                if let Some(node) = stack.pop() {
                    match stack.last_mut() {
                        Some(parent) => parent.children.push(node),
                        None => {
                            if root.is_none() {
                                root = Some(node);
                            }
                        }
                    }
                }
            }
            continue;
        }

        if tag.starts_with("<RelOp") {
            let physical = xml_attribute(tag, "PhysicalOp").unwrap_or_else(|| "RelOp".to_string());
            let logical = xml_attribute(tag, "LogicalOp").unwrap_or_default();
            let rows = xml_attribute(tag, "EstimateRows")
                .and_then(|v| v.parse::<f64>().ok())
                .unwrap_or(0.0) as u64;
            let cost = xml_attribute(tag, "EstimatedTotalSubtreeCost")
                .and_then(|v| v.parse::<f64>().ok())
                .unwrap_or(0.0);

            stack.push(ExecutionPlanNode::new(
                physical,
                None,
                cost,
                rows,
                if logical.is_empty() {
                    None
                } else {
                    Some(logical)
                },
            ));
        } else if tag.starts_with("<Object") {
            if let Some(node) = stack.last_mut() {
                if node.relation_name.is_none() {
                    node.relation_name = xml_attribute(tag, "Table")
                        .or_else(|| xml_attribute(tag, "Index"))
                        .map(|t| t.replace(['[', ']'], ""));
                }
            }
        }
    }

    // Close any operators left open by a truncated document.
    while let Some(node) = stack.pop() {
        match stack.last_mut() {
            Some(parent) => parent.children.push(node),
            None => {
                if root.is_none() {
                    root = Some(node);
                }
            }
        }
    }

    root.unwrap_or_else(|| ExecutionPlanNode::new("Query Plan", None, 0.0, 0, None))
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
/// @details Text, integer, float, boolean, decimal, temporal and binary values are all attempted so
/// a DECIMAL or DATETIME column is never rendered as NULL. `try_get` is used exclusively because
/// `Row::get` panics when the requested Rust type does not match the column's TDS type.
/// @param row Tiberius row reference.
/// @param idx Column ordinal index.
/// @return Extracted cell JSON value.
fn format_mssql_cell(row: &Row, idx: usize) -> serde_json::Value {
    /// @brief Attempts one typed decode and renders the value as text.
    /// @param result Decode result from `Row::try_get`.
    /// @param render Converts the decoded value into display text.
    /// @return Some(text) when the decode succeeded with a value.
    fn text_of<T, F>(result: Result<Option<T>, tiberius::error::Error>, render: F) -> Option<String>
    where
        F: FnOnce(T) -> String,
    {
        result.ok().flatten().map(render)
    }

    let value = text_of(row.try_get::<&str, _>(idx), |v| v.to_string())
        .or_else(|| text_of(row.try_get::<i64, _>(idx), |v| v.to_string()))
        .or_else(|| text_of(row.try_get::<i32, _>(idx), |v| v.to_string()))
        .or_else(|| text_of(row.try_get::<i16, _>(idx), |v| v.to_string()))
        .or_else(|| text_of(row.try_get::<u8, _>(idx), |v| v.to_string()))
        .or_else(|| text_of(row.try_get::<f64, _>(idx), |v| v.to_string()))
        .or_else(|| text_of(row.try_get::<f32, _>(idx), |v| v.to_string()))
        .or_else(|| text_of(row.try_get::<bool, _>(idx), |v| v.to_string()))
        .or_else(|| {
            text_of(row.try_get::<rust_decimal::Decimal, _>(idx), |v| {
                super::format_decimal(v)
            })
        })
        .or_else(|| {
            text_of(row.try_get::<chrono::NaiveDateTime, _>(idx), |v| {
                v.to_string()
            })
        })
        .or_else(|| {
            text_of(row.try_get::<chrono::DateTime<chrono::Utc>, _>(idx), |v| {
                v.to_rfc3339()
            })
        })
        .or_else(|| text_of(row.try_get::<chrono::NaiveDate, _>(idx), |v| v.to_string()))
        .or_else(|| text_of(row.try_get::<chrono::NaiveTime, _>(idx), |v| v.to_string()))
        .or_else(|| {
            text_of(row.try_get::<&[u8], _>(idx), |bytes| {
                super::describe_binary(bytes)
            })
        });

    value
        .map(serde_json::Value::String)
        .unwrap_or(serde_json::Value::Null)
}

/// @brief Parses Microsoft SQL Server data type names and maximum lengths into canonical types.
/// @details Precision and scale are merged in separately through [`with_decimal_metadata`].
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
