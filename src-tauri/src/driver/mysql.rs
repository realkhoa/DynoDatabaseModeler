//! @file mysql.rs
//! @brief MySQL / MariaDB database driver adapter using sqlx.
//! @details Provides connection pooling, schema introspection via information_schema,
//! arbitrary query execution, and transactional DDL migration execution for MySQL.

use async_trait::async_trait;
use sqlx::{mysql::MySqlPoolOptions, mysql::MySqlRow, Column, MySqlPool, Row};
use std::time::Instant;

pub use super::parse_referential_action;
use super::{DatabaseDriver, MigrationReport, QueryResult};
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
    "       COLUMN_KEY, EXTRA, CHARACTER_MAXIMUM_LENGTH ",
    "FROM information_schema.COLUMNS ",
    "WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? ",
    "ORDER BY ORDINAL_POSITION"
);

const FK_QUERY: &str = concat!(
    "SELECT k.CONSTRAINT_NAME, k.COLUMN_NAME, k.REFERENCED_TABLE_NAME, ",
    "       k.REFERENCED_COLUMN_NAME, r.UPDATE_RULE, r.DELETE_RULE ",
    "FROM information_schema.KEY_COLUMN_USAGE k ",
    "JOIN information_schema.REFERENTIAL_CONSTRAINTS r ",
    "  ON k.CONSTRAINT_NAME = r.CONSTRAINT_NAME ",
    " AND k.CONSTRAINT_SCHEMA = r.CONSTRAINT_SCHEMA ",
    "WHERE k.TABLE_SCHEMA = ? AND k.TABLE_NAME = ? ",
    "  AND k.REFERENCED_TABLE_NAME IS NOT NULL ",
    "ORDER BY k.ORDINAL_POSITION;"
);

/// @brief MySQL / MariaDB database driver adapter providing connection pooling and introspection.
/// @details Wraps `sqlx::MySqlPool` to interact with MySQL and MariaDB server instances.
pub struct MySqlDriver {
    pool: MySqlPool,
    database_name: String,
}

impl MySqlDriver {
    /// @brief Connects to a MySQL database using the provided configuration.
    /// @details Configures connection pooling via MySqlPoolOptions with maximum limit of 5.
    /// @param config Connection configuration options.
    /// @return Returns an initialized MySqlDriver or AppError::Connection on failure.
    pub async fn connect(config: &ConnectionConfig) -> Result<Self, AppError> {
        let host = config.host.as_deref().unwrap_or("localhost");
        let port = config.port.unwrap_or(3306);
        let user = config.username.as_deref().unwrap_or("root");
        let password = config.password.as_deref().unwrap_or("");

        let conn_str = format!(
            "mysql://{}:{}@{}:{}/{}",
            user, password, host, port, config.database
        );

        let pool = MySqlPoolOptions::new()
            .max_connections(5)
            .acquire_timeout(std::time::Duration::from_secs(5))
            .connect(&conn_str)
            .await
            .map_err(|e| AppError::Connection(e.to_string()))?;

        Ok(Self {
            pool,
            database_name: config.database.clone(),
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

    /// @brief Introspects tables, columns, primary keys, and foreign keys from MySQL catalog.
    /// @return Returns a fully populated DatabaseSchema or AppError::Introspection on failure.
    async fn introspect_schema(&self) -> Result<DatabaseSchema, AppError> {
        let table_rows = sqlx::query(TABLE_QUERY)
            .bind(&self.database_name)
            .fetch_all(&self.pool)
            .await
            .map_err(|e| AppError::Introspection(e.to_string()))?;

        let mut tables = Vec::new();
        for trow in table_rows {
            let tname: String = trow.get("TABLE_NAME");

            let col_rows = sqlx::query(COL_QUERY)
                .bind(&self.database_name)
                .bind(&tname)
                .fetch_all(&self.pool)
                .await
                .map_err(|e| AppError::Introspection(e.to_string()))?;

            let mut columns = Vec::new();
            for crow in col_rows {
                let cname: String = crow.get("COLUMN_NAME");
                let dtype: String = crow.get("DATA_TYPE");
                let nullable: String = crow.get("IS_NULLABLE");
                let cdefault: Option<String> = crow.get("COLUMN_DEFAULT");
                let ckey: String = crow.get("COLUMN_KEY");
                let extra: String = crow.get("EXTRA");
                let max_len: Option<i64> = crow.get("CHARACTER_MAXIMUM_LENGTH");

                let canonical = parse_mysql_type(&dtype, max_len);

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
                .unwrap_or_default();

            let mut foreign_keys = Vec::new();
            for fk in fk_rows {
                let on_update_str: Option<String> = fk.try_get("UPDATE_RULE").ok();
                let on_delete_str: Option<String> = fk.try_get("DELETE_RULE").ok();

                foreign_keys.push(ForeignKeySchema {
                    constraint_name: fk.get("CONSTRAINT_NAME"),
                    source_column: fk.get("COLUMN_NAME"),
                    target_table: fk.get("REFERENCED_TABLE_NAME"),
                    target_column: fk.get("REFERENCED_COLUMN_NAME"),
                    on_delete: parse_referential_action(
                        on_delete_str.as_deref().unwrap_or("NO ACTION"),
                    ),
                    on_update: parse_referential_action(
                        on_update_str.as_deref().unwrap_or("NO ACTION"),
                    ),
                });
            }

            tables.push(TableSchema {
                name: tname,
                schema: Some(self.database_name.clone()),
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

    /// @brief Executes an arbitrary SQL query against MySQL.
    /// @param sql SQL query string to execute.
    /// @return Returns QueryResult or AppError::Database on error.
    async fn execute_query(&self, sql: &str) -> Result<QueryResult, AppError> {
        let start = Instant::now();
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

    /// @brief Returns the database type dialect for MySQL.
    /// @return Returns DatabaseType::MySql.
    fn db_type(&self) -> DatabaseType {
        DatabaseType::MySql
    }
}

/// @brief Formats a MySQL row cell into a JSON value representation.
/// @param row MySQL row reference.
/// @param idx Column ordinal index.
/// @return Extracted cell JSON value.
fn format_mysql_cell(row: &MySqlRow, idx: usize) -> serde_json::Value {
    let val: Option<String> = row
        .try_get::<String, _>(idx)
        .ok()
        .or_else(|| row.try_get::<i64, _>(idx).ok().map(|v| v.to_string()))
        .or_else(|| row.try_get::<i32, _>(idx).ok().map(|v| v.to_string()))
        .or_else(|| row.try_get::<f64, _>(idx).ok().map(|v| v.to_string()))
        .or_else(|| row.try_get::<bool, _>(idx).ok().map(|v| v.to_string()))
        .or_else(|| {
            row.try_get::<serde_json::Value, _>(idx)
                .ok()
                .map(|v| v.to_string())
        });
    match val {
        Some(s) => serde_json::Value::String(s),
        None => serde_json::Value::Null,
    }
}

/// @brief Parses MySQL data type strings and lengths into canonical types.
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
