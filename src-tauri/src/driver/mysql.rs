//! @file mysql.rs
//! @brief MySQL / MariaDB database driver adapter using sqlx.
//! @details Provides connection pooling, schema introspection via information_schema,
//! arbitrary query execution, and transactional DDL execution for MySQL.

use async_trait::async_trait;
use sqlx::mysql::{MySqlConnectOptions, MySqlPoolOptions, MySqlRow, MySqlSslMode};
use sqlx::{Column, MySqlPool, Row};
use std::time::Instant;

pub use super::parse_referential_action;
use super::{
    is_row_returning, qualify, with_decimal_metadata, DatabaseDriver, ExecutionPlanNode,
    MigrationReport, QueryResult, RowUpdatePayload,
};
use crate::error::AppError;
use crate::model::connection::{ConnectionConfig, DatabaseType};
use crate::model::schema::*;

const TABLE_QUERY: &str = concat!(
    "SELECT TABLE_NAME FROM information_schema.TABLES ",
    "WHERE TABLE_SCHEMA = ? AND TABLE_TYPE = 'BASE TABLE' ",
    "ORDER BY TABLE_NAME"
);

const COL_QUERY: &str = concat!(
    "SELECT COLUMN_NAME, DATA_TYPE, IS_NULLABLE, COLUMN_DEFAULT, ",
    "       COLUMN_KEY, EXTRA, CHARACTER_MAXIMUM_LENGTH, NUMERIC_PRECISION, NUMERIC_SCALE ",
    "FROM information_schema.COLUMNS ",
    "WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? ",
    "ORDER BY ORDINAL_POSITION"
);

/// @brief Foreign key introspection including the referenced schema.
/// @details The referenced schema is selected so that cross-database foreign keys are stored
/// qualified; without it a regenerated constraint would bind to whatever schema is current.
const FK_QUERY: &str = concat!(
    "SELECT k.CONSTRAINT_NAME, k.COLUMN_NAME, k.REFERENCED_TABLE_NAME, ",
    "       k.REFERENCED_COLUMN_NAME, k.REFERENCED_TABLE_SCHEMA, r.UPDATE_RULE, r.DELETE_RULE ",
    "FROM information_schema.KEY_COLUMN_USAGE k ",
    "JOIN information_schema.REFERENTIAL_CONSTRAINTS r ",
    "  ON k.CONSTRAINT_NAME = r.CONSTRAINT_NAME ",
    " AND k.CONSTRAINT_SCHEMA = r.CONSTRAINT_SCHEMA ",
    "WHERE k.TABLE_SCHEMA = ? AND k.TABLE_NAME = ? ",
    "  AND k.REFERENCED_TABLE_NAME IS NOT NULL ",
    "ORDER BY k.CONSTRAINT_NAME, k.ORDINAL_POSITION;"
);

/// @brief Secondary index introspection, excluding the PRIMARY key index.
const INDEX_QUERY: &str = concat!(
    "SELECT INDEX_NAME, COLUMN_NAME, NON_UNIQUE ",
    "FROM information_schema.STATISTICS ",
    "WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? AND INDEX_NAME <> 'PRIMARY' ",
    "ORDER BY INDEX_NAME, SEQ_IN_INDEX;"
);

/// @brief Reads a text column from a MySQL catalog row.
/// @details MySQL 8 reports several `information_schema` string columns as `VARBINARY`, so a direct
/// `String` decode fails with a type mismatch and aborts introspection. UTF-8 bytes are decoded as a
/// fallback, and a missing column yields `None` instead of panicking.
/// @param row MySQL row reference.
/// @param column Column name (or ordinal index).
/// @return Decoded text, or `None` when the column is NULL/absent.
fn mysql_text(row: &MySqlRow, column: &str) -> Option<String> {
    // Non-null text (sqlx decodes Result<T> for a non-nullable request).
    if let Ok(value) = row.try_get::<String, _>(column) {
        return Some(value);
    }
    // Nullable text.
    if let Ok(Some(value)) = row.try_get::<Option<String>, _>(column) {
        return Some(value);
    }
    // MySQL 8 returns some catalog columns as VARBINARY/BLOB.
    if let Ok(bytes) = row.try_get::<Vec<u8>, _>(column) {
        return Some(String::from_utf8_lossy(&bytes).into_owned());
    }
    row.try_get::<Option<Vec<u8>>, _>(column)
        .ok()
        .flatten()
        .map(|bytes| String::from_utf8_lossy(&bytes).into_owned())
}

/// @brief Reads an integer column from a MySQL catalog row regardless of signedness.
/// @details Catalog counters are frequently `BIGINT UNSIGNED`, which does not decode as `i64`.
/// @param row MySQL row reference.
/// @param column Column name (or ordinal index).
/// @return The value widened to `i64`, or `None` when NULL/absent.
fn mysql_int(row: &MySqlRow, column: &str) -> Option<i64> {
    if let Ok(value) = row.try_get::<i64, _>(column) {
        return Some(value);
    }
    if let Ok(Some(value)) = row.try_get::<Option<i64>, _>(column) {
        return Some(value);
    }
    if let Ok(value) = row.try_get::<u64, _>(column) {
        return i64::try_from(value).ok();
    }
    if let Ok(value) = row.try_get::<i32, _>(column) {
        return Some(i64::from(value));
    }
    None
}

/// @brief MySQL / MariaDB database driver adapter providing connection pooling and introspection.
/// @details Wraps `sqlx::MySqlPool` to interact with MySQL and MariaDB server instances.
pub struct MySqlDriver {
    pool: MySqlPool,
    database_name: String,
}

impl MySqlDriver {
    /// @brief Connects to a MySQL database using the provided configuration.
    /// @details Uses `MySqlConnectOptions` rather than a URL string so that credentials containing
    /// `@`, `:`, `/` or `%` are transmitted literally, and so the SSL flag actually selects a TLS
    /// mode (a URL without TLS parameters silently connected in cleartext).
    /// @param config Connection configuration options.
    /// @return Returns an initialized MySqlDriver or AppError::Connection on failure.
    pub async fn connect(config: &ConnectionConfig) -> Result<Self, AppError> {
        let host = config.host.as_deref().unwrap_or("localhost");
        let port = config.port.unwrap_or(3306);
        let user = config.username.as_deref().unwrap_or("root");

        let db_name = if config.database.trim().is_empty() {
            "mysql"
        } else {
            config.database.trim()
        };

        let mut options = MySqlConnectOptions::new()
            .host(host)
            .port(port)
            .username(user)
            .database(db_name)
            .ssl_mode(if config.ssl {
                MySqlSslMode::Required
            } else {
                MySqlSslMode::Disabled
            });

        if let Some(password) = config.password.as_deref() {
            options = options.password(password);
        }

        let pool = MySqlPoolOptions::new()
            .max_connections(5)
            .acquire_timeout(std::time::Duration::from_secs(5))
            .connect_with(options)
            .await
            .map_err(|e| AppError::Connection(e.to_string()))?;

        Ok(Self {
            pool,
            database_name: db_name.to_string(),
        })
    }
}

#[async_trait]
impl DatabaseDriver for MySqlDriver {
    /// @brief Tests the MySQL database connection by executing a ping query.
    /// @return Returns Ok(()) if the database responds, or AppError::Connection on failure.
    async fn test_connection(&self) -> Result<(), AppError> {
        sqlx::query("SELECT 1")
            .execute(&self.pool)
            .await
            .map_err(|e| AppError::Connection(e.to_string()))?;
        Ok(())
    }

    /// @brief Introspects tables, columns, primary keys, foreign keys, and indexes from MySQL catalog.
    /// @details Numeric precision/scale and index metadata are read explicitly; foreign key
    /// targets are stored schema-qualified. Catalog errors propagate instead of degrading to an
    /// empty foreign key list, which would look like "no constraints exist".
    /// @return Returns a fully populated DatabaseSchema or AppError::Introspection on failure.
    async fn introspect_schema(&self) -> Result<DatabaseSchema, AppError> {
        let table_rows = sqlx::query(TABLE_QUERY)
            .bind(&self.database_name)
            .fetch_all(&self.pool)
            .await
            .map_err(|e| AppError::Introspection(e.to_string()))?;

        let mut tables = Vec::new();
        for trow in table_rows {
            let Some(tname) = mysql_text(&trow, "TABLE_NAME") else {
                continue;
            };

            let col_rows = sqlx::query(COL_QUERY)
                .bind(&self.database_name)
                .bind(&tname)
                .fetch_all(&self.pool)
                .await
                .map_err(|e| AppError::Introspection(e.to_string()))?;

            let mut columns = Vec::new();
            for crow in col_rows {
                let Some(cname) = mysql_text(&crow, "COLUMN_NAME") else {
                    continue;
                };
                let dtype = mysql_text(&crow, "DATA_TYPE").unwrap_or_default();
                let nullable = mysql_text(&crow, "IS_NULLABLE").unwrap_or_default();
                let cdefault = mysql_text(&crow, "COLUMN_DEFAULT");
                let ckey = mysql_text(&crow, "COLUMN_KEY").unwrap_or_default();
                let extra = mysql_text(&crow, "EXTRA").unwrap_or_default();
                let max_len = mysql_int(&crow, "CHARACTER_MAXIMUM_LENGTH");
                let numeric_precision = mysql_int(&crow, "NUMERIC_PRECISION");
                let numeric_scale = mysql_int(&crow, "NUMERIC_SCALE");

                let canonical = with_decimal_metadata(
                    parse_mysql_type(&dtype, max_len),
                    numeric_precision,
                    numeric_scale,
                );

                columns.push(ColumnSchema {
                    name: cname,
                    data_type: canonical,
                    is_primary_key: ckey == "PRI",
                    is_nullable: nullable.to_uppercase() == "YES",
                    is_auto_increment: extra.to_lowercase().contains("auto_increment"),
                    default_value: cdefault,
                });
            }

            let fk_rows = sqlx::query(FK_QUERY)
                .bind(&self.database_name)
                .bind(&tname)
                .fetch_all(&self.pool)
                .await
                .map_err(|e| AppError::Introspection(e.to_string()))?;

            let mut foreign_keys = Vec::new();
            for fk in fk_rows {
                let on_update_str = mysql_text(&fk, "UPDATE_RULE");
                let on_delete_str = mysql_text(&fk, "DELETE_RULE");
                let target_schema = mysql_text(&fk, "REFERENCED_TABLE_SCHEMA");
                let target_name = mysql_text(&fk, "REFERENCED_TABLE_NAME").unwrap_or_default();

                foreign_keys.push(ForeignKeySchema {
                    constraint_name: mysql_text(&fk, "CONSTRAINT_NAME").unwrap_or_default(),
                    source_column: mysql_text(&fk, "COLUMN_NAME").unwrap_or_default(),
                    target_table: qualify(target_schema.as_deref(), &target_name),
                    target_column: mysql_text(&fk, "REFERENCED_COLUMN_NAME").unwrap_or_default(),
                    on_delete: parse_referential_action(
                        on_delete_str.as_deref().unwrap_or("NO ACTION"),
                    ),
                    on_update: parse_referential_action(
                        on_update_str.as_deref().unwrap_or("NO ACTION"),
                    ),
                });
            }

            let index_rows = sqlx::query(INDEX_QUERY)
                .bind(&self.database_name)
                .bind(&tname)
                .fetch_all(&self.pool)
                .await
                .map_err(|e| AppError::Introspection(e.to_string()))?;

            let mut indexes: Vec<IndexSchema> = Vec::new();
            for irow in index_rows {
                let Some(index_name) = mysql_text(&irow, "INDEX_NAME") else {
                    continue;
                };
                let column_name = mysql_text(&irow, "COLUMN_NAME").unwrap_or_default();
                let non_unique = mysql_int(&irow, "NON_UNIQUE").unwrap_or(1);

                match indexes.iter_mut().find(|i| i.name == index_name) {
                    Some(existing) => existing.columns.push(column_name),
                    None => indexes.push(IndexSchema {
                        name: index_name,
                        columns: vec![column_name],
                        is_unique: non_unique == 0,
                    }),
                }
            }

            tables.push(TableSchema {
                name: tname,
                schema: Some(self.database_name.clone()),
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

    /// @brief Executes an arbitrary SQL query against MySQL.
    /// @details Row-returning statements are fetched; other statements report the database's
    /// affected row count so DML is never reported as zero rows.
    /// @param sql SQL query string to execute.
    /// @return Returns QueryResult or AppError::Database on error.
    async fn execute_query(&self, sql: &str) -> Result<QueryResult, AppError> {
        let start = Instant::now();

        if !is_row_returning(sql) {
            let res = sqlx::query(sql)
                .execute(&self.pool)
                .await
                .map_err(|e| AppError::Database(e.to_string()))?;
            return Ok(QueryResult {
                columns: vec![],
                rows: vec![],
                rows_affected: res.rows_affected(),
                execution_time_ms: start.elapsed().as_millis() as u64,
            });
        }

        let rows = sqlx::query(sql)
            .fetch_all(&self.pool)
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
                    .map(|i| format_mysql_cell(row, i))
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

    /// @brief Executes a series of DDL statements inside an atomic MySQL transaction.
    /// @param statements Ordered list of SQL DDL statements to apply.
    /// @return Returns MigrationReport on success or AppError::Migration on failure.
    async fn execute_ddl(&self, statements: &[String]) -> Result<MigrationReport, AppError> {
        let start = Instant::now();
        let mut tx = self
            .pool
            .begin()
            .await
            .map_err(|e| AppError::Migration(e.to_string()))?;

        for stmt in statements {
            let trimmed = stmt.trim();
            if trimmed.is_empty() {
                continue;
            }
            if let Err(e) = sqlx::query(trimmed).execute(&mut *tx).await {
                let _ = tx.rollback().await;
                return Err(AppError::Migration(format!(
                    "Statement failed: {}: {}",
                    trimmed, e
                )));
            }
        }

        tx.commit()
            .await
            .map_err(|e| AppError::Migration(e.to_string()))?;

        Ok(MigrationReport {
            success: true,
            statements_executed: statements.len(),
            execution_time_ms: start.elapsed().as_millis() as u64,
            error_message: None,
        })
    }

    /// @brief Executes a batch of row mutations transactionally against MySQL.
    /// @details Builds parameterized UPDATE statements (`UPDATE `t` SET `c` = ? WHERE `pk` = ?`),
    /// binds every value, and in strict single-row mode aborts and rolls back unless exactly one
    /// row matched.
    /// @param updates List of row update payloads specifying tables, PKs, and modified column values.
    /// @return Returns the total count of rows affected across all updates, or AppError on rollback/failure.
    async fn update_rows(&self, updates: Vec<RowUpdatePayload>) -> Result<u64, AppError> {
        if updates.is_empty() {
            return Ok(0);
        }

        let mut tx = self
            .pool
            .begin()
            .await
            .map_err(|e| AppError::Database(e.to_string()))?;

        let mut total_affected = 0u64;

        for update in &updates {
            if update.updated_values.is_empty() {
                continue;
            }
            if let Err(message) = update.validate_locator() {
                let _ = tx.rollback().await;
                return Err(AppError::Database(message));
            }

            let mut set_clauses = Vec::with_capacity(update.updated_values.len());
            let mut set_values = Vec::with_capacity(update.updated_values.len());
            for (col, val) in &update.updated_values {
                set_clauses.push(format!("`{}` = ?", col.replace('`', "``")));
                set_values.push(val);
            }

            let mut where_clauses = Vec::with_capacity(update.primary_keys.len());
            let mut where_values = Vec::with_capacity(update.primary_keys.len());
            for (pk_col, pk_val) in &update.primary_keys {
                where_clauses.push(format!("`{}` = ?", pk_col.replace('`', "``")));
                where_values.push(pk_val);
            }

            let table_esc = update.table.replace('`', "``");
            let sql = format!(
                "UPDATE `{}` SET {} WHERE {};",
                table_esc,
                set_clauses.join(", "),
                where_clauses.join(" AND ")
            );

            let mut query = sqlx::query(&sql);
            for val in set_values.into_iter().chain(where_values.into_iter()) {
                query = bind_mysql_val(query, val);
            }

            match query.execute(&mut *tx).await {
                Ok(res) => {
                    if let Err(message) = update.check_affected_rows(res.rows_affected()) {
                        let _ = tx.rollback().await;
                        return Err(AppError::Database(message));
                    }
                    total_affected += res.rows_affected();
                }
                Err(e) => {
                    let _ = tx.rollback().await;
                    return Err(AppError::Database(format!(
                        "Row update failed on table '{}': {}",
                        update.table, e
                    )));
                }
            }
        }

        tx.commit()
            .await
            .map_err(|e| AppError::Database(e.to_string()))?;

        Ok(total_affected)
    }

    /// @brief Generates an execution plan tree for the provided SQL query via EXPLAIN.
    /// @param sql SQL statement string to analyze.
    /// @return Returns the root ExecutionPlanNode or AppError on query failure.
    async fn explain_query(&self, sql: &str) -> Result<ExecutionPlanNode, AppError> {
        let clean_sql = sql.trim().trim_end_matches(';');
        let basic_sql = format!("EXPLAIN {}", clean_sql);
        let rows = sqlx::query(&basic_sql)
            .fetch_all(&self.pool)
            .await
            .map_err(|e| AppError::Database(format!("EXPLAIN failed: {}", e)))?;

        let mut root = ExecutionPlanNode::new("Query Execution Plan", None, 0.0, 0, None);
        let mut total_cost = 0.0;
        for row in rows {
            let table: Option<String> = row.try_get::<String, _>("table").ok();
            let access_type: String = row
                .try_get::<String, _>("type")
                .unwrap_or_else(|_| "ALL".to_string());
            let rows_est: u64 = row.try_get::<i64, _>("rows").map(|v| v as u64).unwrap_or(0);
            let cost = if access_type == "ALL" { 100.0 } else { 20.0 };
            total_cost += cost;
            let extra: Option<String> = row.try_get::<String, _>("Extra").ok();
            let step = ExecutionPlanNode::new(
                format!("Access: {}", access_type),
                table,
                cost,
                rows_est,
                extra,
            );
            root.children.push(step);
        }
        root.cost = total_cost;
        Ok(root)
    }

    /// @brief Lists all databases available on the MySQL server instance.
    /// @return Vector of database names on the server.
    async fn list_databases(&self) -> Result<Vec<String>, AppError> {
        let rows = sqlx::query("SHOW DATABASES;")
            .fetch_all(&self.pool)
            .await
            .map_err(|e| AppError::Database(e.to_string()))?;

        let names: Vec<String> = rows
            .into_iter()
            .filter_map(|r| mysql_text(&r, "Database"))
            .filter(|db| {
                !["information_schema", "performance_schema", "sys"].contains(&db.as_str())
            })
            .collect();
        Ok(names)
    }

    /// @brief Returns the database type dialect for MySQL.
    /// @return Returns DatabaseType::MySql.
    fn db_type(&self) -> DatabaseType {
        DatabaseType::MySql
    }
}

/// @brief Binds a JSON value to a MySQL parameterized query.
/// @param query Target sqlx MySQL query.
/// @param val Reference to serde_json::Value to bind into the query.
/// @return Query with the bound value appended.
fn bind_mysql_val<'a>(
    query: sqlx::query::Query<'a, sqlx::MySql, sqlx::mysql::MySqlArguments>,
    val: &'a serde_json::Value,
) -> sqlx::query::Query<'a, sqlx::MySql, sqlx::mysql::MySqlArguments> {
    match val {
        serde_json::Value::Null => query.bind(Option::<String>::None),
        serde_json::Value::Bool(b) => query.bind(*b),
        serde_json::Value::Number(n) => {
            if let Some(i) = n.as_i64() {
                query.bind(i)
            } else if let Some(f) = n.as_f64() {
                query.bind(f)
            } else {
                query.bind(n.to_string())
            }
        }
        serde_json::Value::String(s) => query.bind(s.as_str()),
        serde_json::Value::Array(_) | serde_json::Value::Object(_) => query.bind(val.to_string()),
    }
}

/// @brief Formats a MySQL row cell into a JSON value representation.
/// @details Every MySQL type a data grid commonly renders is attempted: text, integers, floats,
/// booleans, decimals, temporal types, JSON and binary. Without the decimal and temporal attempts
/// DECIMAL and DATETIME columns were rendered as NULL.
/// @param row MySQL row reference.
/// @param idx Column ordinal index.
/// @return Extracted cell JSON value.
fn format_mysql_cell(row: &MySqlRow, idx: usize) -> serde_json::Value {
    let text: Option<String> = row
        .try_get::<String, _>(idx)
        .ok()
        .or_else(|| row.try_get::<Option<String>, _>(idx).ok().flatten())
        .or_else(|| row.try_get::<i64, _>(idx).ok().map(|v| v.to_string()))
        .or_else(|| row.try_get::<u64, _>(idx).ok().map(|v| v.to_string()))
        .or_else(|| row.try_get::<i32, _>(idx).ok().map(|v| v.to_string()))
        .or_else(|| row.try_get::<i16, _>(idx).ok().map(|v| v.to_string()))
        .or_else(|| row.try_get::<i8, _>(idx).ok().map(|v| v.to_string()))
        .or_else(|| row.try_get::<u8, _>(idx).ok().map(|v| v.to_string()))
        .or_else(|| row.try_get::<f64, _>(idx).ok().map(|v| v.to_string()))
        .or_else(|| row.try_get::<f32, _>(idx).ok().map(|v| v.to_string()))
        .or_else(|| row.try_get::<bool, _>(idx).ok().map(|v| v.to_string()))
        .or_else(|| {
            row.try_get::<rust_decimal::Decimal, _>(idx)
                .ok()
                .map(super::format_decimal)
        })
        .or_else(|| {
            row.try_get::<chrono::NaiveDateTime, _>(idx)
                .ok()
                .map(|v| v.to_string())
        })
        .or_else(|| {
            row.try_get::<chrono::DateTime<chrono::Utc>, _>(idx)
                .ok()
                .map(|v| v.to_rfc3339())
        })
        .or_else(|| {
            row.try_get::<chrono::NaiveDate, _>(idx)
                .ok()
                .map(|v| v.to_string())
        })
        .or_else(|| {
            row.try_get::<chrono::NaiveTime, _>(idx)
                .ok()
                .map(|v| v.to_string())
        })
        .or_else(|| {
            row.try_get::<serde_json::Value, _>(idx)
                .ok()
                .map(|v| v.to_string())
        })
        .or_else(|| {
            row.try_get::<Vec<u8>, _>(idx)
                .ok()
                .map(|bytes| super::describe_binary(&bytes))
        });

    match text {
        Some(s) => serde_json::Value::String(s),
        None => serde_json::Value::Null,
    }
}

/// @brief Parses MySQL data type strings and lengths into canonical types.
/// @details Precision and scale are merged in separately through [`with_decimal_metadata`].
/// @param dtype Raw MySQL data type string from information_schema (e.g. "int", "varchar", "tinyint").
/// @param max_len Optional character maximum length constraint.
/// @return Normalized CanonicalType representation.
pub fn parse_mysql_type(dtype: &str, max_len: Option<i64>) -> CanonicalType {
    match dtype.to_lowercase().as_str() {
        "int" | "integer" | "mediumint" => CanonicalType::Integer,
        "bigint" => CanonicalType::BigInt,
        "smallint" => CanonicalType::SmallInt,
        "tinyint" if max_len == Some(1) => CanonicalType::Boolean,
        "tinyint" => CanonicalType::SmallInt,
        "varchar" => CanonicalType::Varchar(max_len.map(|l| l as u32)),
        "char" => CanonicalType::Char(max_len.map(|l| l as u32)),
        "text" | "mediumtext" | "longtext" | "tinytext" => CanonicalType::Text,
        "decimal" | "numeric" => CanonicalType::Decimal {
            precision: None,
            scale: None,
        },
        "float" => CanonicalType::Float,
        "double" => CanonicalType::Double,
        "date" => CanonicalType::Date,
        "time" => CanonicalType::Time,
        "datetime" | "timestamp" => CanonicalType::Timestamp,
        "json" => CanonicalType::Json,
        "blob" | "binary" | "varbinary" | "longblob" | "mediumblob" | "tinyblob" => {
            CanonicalType::Binary
        }
        _ => CanonicalType::Custom(dtype.to_string()),
    }
}
