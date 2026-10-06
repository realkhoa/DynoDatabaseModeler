//! @file postgres.rs
//! @brief PostgreSQL database driver adapter using sqlx.
//! @details Provides connection pooling, schema introspection via information_schema,
//! arbitrary query execution, and transactional DDL migration execution for PostgreSQL.

use async_trait::async_trait;
use sqlx::{postgres::PgPoolOptions, postgres::PgRow, Column, PgPool, Row};
use std::time::Instant;

pub use super::parse_referential_action;
use super::{DatabaseDriver, MigrationReport, QueryResult, RowUpdatePayload};
use crate::error::AppError;
use crate::model::connection::{ConnectionConfig, DatabaseType};
use crate::model::schema::*;

const TABLE_QUERY: &str = concat!(
    "SELECT table_name, table_schema ",
    "FROM information_schema.tables ",
    "WHERE table_schema NOT IN ('pg_catalog', 'information_schema') ",
    "  AND table_type = 'BASE TABLE' ",
    "ORDER BY table_name;"
);

const COL_QUERY: &str = concat!(
    "SELECT column_name, data_type, is_nullable, column_default, character_maximum_length ",
    "FROM information_schema.columns ",
    "WHERE table_name = $1 AND table_schema = $2 ",
    "ORDER BY ordinal_position;"
);

const PK_QUERY: &str = concat!(
    "SELECT kcu.column_name ",
    "FROM information_schema.table_constraints tc ",
    "JOIN information_schema.key_column_usage kcu ",
    "  ON tc.constraint_name = kcu.constraint_name AND tc.table_schema = kcu.table_schema ",
    "WHERE tc.constraint_type = 'PRIMARY KEY' AND tc.table_name = $1 AND tc.table_schema = $2;"
);

const FK_QUERY: &str = concat!(
    "SELECT tc.constraint_name, kcu.column_name AS source_column, ",
    "       ccu.table_name AS target_table, ccu.column_name AS target_column, ",
    "       rc.update_rule AS on_update, rc.delete_rule AS on_delete ",
    "FROM information_schema.table_constraints tc ",
    "JOIN information_schema.key_column_usage kcu ",
    "  ON tc.constraint_name = kcu.constraint_name AND tc.table_schema = kcu.table_schema ",
    "JOIN information_schema.referential_constraints rc ",
    "  ON tc.constraint_name = rc.constraint_name AND tc.table_schema = rc.constraint_schema ",
    "JOIN information_schema.constraint_column_usage ccu ",
    "  ON rc.unique_constraint_name = ccu.constraint_name ",
    " AND rc.unique_constraint_schema = ccu.table_schema ",
    "WHERE tc.constraint_type = 'FOREIGN KEY' AND tc.table_name = $1 AND tc.table_schema = $2;"
);

/// @brief PostgreSQL database driver adapter providing connection pooling and introspection.
/// @details Wraps `sqlx::PgPool` to interact with PostgreSQL server instances.
pub struct PostgresDriver {
    pool: PgPool,
    database_name: String,
}

impl PostgresDriver {
    /// @brief Connects to a PostgreSQL database using the provided configuration.
    /// @details Configures connection pooling via PgPoolOptions with limit of 5.
    /// @param config Connection configuration options.
    /// @return Returns an initialized PostgresDriver or AppError::Connection on failure.
    pub async fn connect(config: &ConnectionConfig) -> Result<Self, AppError> {
        let host = config.host.as_deref().unwrap_or("localhost");
        let port = config.port.unwrap_or(5432);
        let user = config.username.as_deref().unwrap_or("postgres");
        let password = config.password.as_deref().unwrap_or("");
        let ssl_mode = if config.ssl { "require" } else { "disable" };

        let conn_str = format!(
            "postgres://{}:{}@{}:{}/{}?sslmode={}",
            user, password, host, port, config.database, ssl_mode
        );

        let pool = PgPoolOptions::new()
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

    /// @brief Helper query execution for schema introspection bound to table and schema names.
    /// @param query Prepared SQL query string with two string placeholders ($1, $2).
    /// @param table Target table name.
    /// @param schema Target schema namespace name.
    /// @return Vector of result rows or AppError::Introspection.
    async fn fetch_table_meta(
        &self,
        query: &str,
        table: &str,
        schema: &str,
    ) -> Result<Vec<PgRow>, AppError> {
        sqlx::query(query)
            .bind(table)
            .bind(schema)
            .fetch_all(&self.pool)
            .await
            .map_err(|e| AppError::Introspection(e.to_string()))
    }
}

#[async_trait]
impl DatabaseDriver for PostgresDriver {
    /// @brief Tests the PostgreSQL database connection by executing a ping query.
    /// @return Returns Ok(()) if the database responds, or AppError::Connection on failure.
    async fn test_connection(&self) -> Result<(), AppError> {
        sqlx::query("SELECT 1")
            .execute(&self.pool)
            .await
            .map_err(|e| AppError::Connection(e.to_string()))?;
        Ok(())
    }

    /// @brief Introspects tables, columns, primary keys, and foreign keys from catalog.
    /// @return Returns a fully populated DatabaseSchema or AppError::Introspection on failure.
    async fn introspect_schema(&self) -> Result<DatabaseSchema, AppError> {
        let table_rows = sqlx::query(TABLE_QUERY)
            .fetch_all(&self.pool)
            .await
            .map_err(|e| AppError::Introspection(e.to_string()))?;

        let mut tables = Vec::new();
        for trow in table_rows {
            let table_name: String = trow.get("table_name");
            let table_schema: String = trow.get("table_schema");

            let col_rows = self
                .fetch_table_meta(COL_QUERY, &table_name, &table_schema)
                .await?;
            let pk_rows = self
                .fetch_table_meta(PK_QUERY, &table_name, &table_schema)
                .await?;
            let pks: Vec<String> = pk_rows.into_iter().map(|r| r.get("column_name")).collect();

            let mut columns = Vec::new();
            for crow in col_rows {
                let cname: String = crow.get("column_name");
                let dtype: String = crow.get("data_type");
                let nullable: String = crow.get("is_nullable");
                let cdefault: Option<String> = crow.get("column_default");
                let max_len: Option<i32> = crow.get("character_maximum_length");

                let is_pk = pks.contains(&cname);
                let canonical_type = parse_postgres_type(&dtype, max_len);

                columns.push(ColumnSchema {
                    name: cname,
                    data_type: canonical_type,
                    is_primary_key: is_pk,
                    is_nullable: nullable.to_uppercase() == "YES",
                    is_auto_increment: cdefault
                        .as_deref()
                        .unwrap_or("")
                        .to_lowercase()
                        .starts_with("nextval("),
                    default_value: cdefault,
                });
            }

            let fk_rows = sqlx::query(FK_QUERY)
                .bind(&table_name)
                .bind(&table_schema)
                .fetch_all(&self.pool)
                .await
                .unwrap_or_default();

            let mut foreign_keys = Vec::new();
            for fk in fk_rows {
                let on_update_str: Option<String> = fk.try_get("on_update").ok();
                let on_delete_str: Option<String> = fk.try_get("on_delete").ok();

                foreign_keys.push(ForeignKeySchema {
                    constraint_name: fk.get("constraint_name"),
                    source_column: fk.get("source_column"),
                    target_table: fk.get("target_table"),
                    target_column: fk.get("target_column"),
                    on_delete: parse_referential_action(
                        on_delete_str.as_deref().unwrap_or("NO ACTION"),
                    ),
                    on_update: parse_referential_action(
                        on_update_str.as_deref().unwrap_or("NO ACTION"),
                    ),
                });
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

    /// @brief Executes an arbitrary SQL query against PostgreSQL.
    /// @param sql SQL query string to execute.
    /// @return Returns QueryResult or AppError::Database on execution failure.
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
                    .map(|i| format_cell_value(row, i))
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

    /// @brief Executes a batch of DDL statements inside an atomic transaction.
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

    /// @brief Executes a batch of row mutations transactionally against PostgreSQL.
    /// @details Begins a transaction on the connection pool, builds formatted UPDATE statements
    /// (`UPDATE "table" SET "col" = <value> WHERE "pk" = <value>`), escapes identifiers and literal values safely,
    /// and executes each update sequentially. If any statement fails (e.g., constraint violation, syntax error,
    /// invalid column), the transaction is immediately rolled back and an `AppError::Database` is returned.
    /// On success, the transaction is committed and the total affected row count is returned.
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
            if update.primary_keys.is_empty() {
                let _ = tx.rollback().await;
                return Err(AppError::Database(
                    "Primary keys must not be empty for row mutation".to_string(),
                ));
            }

            let mut set_clauses = Vec::with_capacity(update.updated_values.len());
            for (col, val) in &update.updated_values {
                set_clauses.push(format!("{} = {}", format_pg_ident(col), format_pg_value(val)));
            }

            let mut where_clauses = Vec::with_capacity(update.primary_keys.len());
            for (pk_col, pk_val) in &update.primary_keys {
                where_clauses.push(format!("{} = {}", format_pg_ident(pk_col), format_pg_value(pk_val)));
            }

            let table_ident = format_pg_ident(&update.table);
            let sql = format!(
                "UPDATE {} SET {} WHERE {};",
                table_ident,
                set_clauses.join(", "),
                where_clauses.join(" AND ")
            );

            match sqlx::query(&sql).execute(&mut *tx).await {
                Ok(res) => {
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

    /// @brief Returns the database dialect type for PostgreSQL.
    /// @return Returns DatabaseType::Postgres.
    fn db_type(&self) -> DatabaseType {
        DatabaseType::Postgres
    }
}

/// @brief Formats an identifier for PostgreSQL quoting (supporting dot-separated schema paths).
/// @param ident Identifier string (table, column, or schema name).
/// @return Properly double-quoted PostgreSQL identifier.
fn format_pg_ident(ident: &str) -> String {
    if ident.contains('.') {
        ident
            .split('.')
            .map(|part| format!("\"{}\"", part.replace('"', "\"\"")))
            .collect::<Vec<_>>()
            .join(".")
    } else {
        format!("\"{}\"", ident.replace('"', "\"\""))
    }
}

/// @brief Formats a serde_json::Value into a safe PostgreSQL literal SQL fragment.
/// @param val Reference to serde_json::Value to serialize.
/// @return SQL literal string representation (escaped string, number, boolean, or NULL).
fn format_pg_value(val: &serde_json::Value) -> String {
    match val {
        serde_json::Value::Null => "NULL".to_string(),
        serde_json::Value::Bool(b) => {
            if *b {
                "TRUE".to_string()
            } else {
                "FALSE".to_string()
            }
        }
        serde_json::Value::Number(n) => n.to_string(),
        serde_json::Value::String(s) => format!("'{}'", s.replace('\'', "''")),
        serde_json::Value::Array(_) | serde_json::Value::Object(_) => {
            format!("'{}'", val.to_string().replace('\'', "''"))
        }
    }
}

/// @brief Formats a PostgreSQL row cell into a JSON value.
/// @param row PostgreSQL row reference.
/// @param idx Column ordinal index.
/// @return Extracted cell JSON representation.
fn format_cell_value(row: &PgRow, idx: usize) -> serde_json::Value {
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

/// @brief Parses PostgreSQL data type strings and lengths into canonical types.
/// @param dtype Raw PostgreSQL data type name from information_schema.
/// @param max_len Optional character maximum length constraint.
/// @return Normalized CanonicalType representation.
pub fn parse_postgres_type(dtype: &str, max_len: Option<i32>) -> CanonicalType {
    match dtype.to_lowercase().as_str() {
        "integer" | "int4" => CanonicalType::Integer,
        "bigint" | "int8" => CanonicalType::BigInt,
        "smallint" | "int2" => CanonicalType::SmallInt,
        "boolean" | "bool" => CanonicalType::Boolean,
        "text" => CanonicalType::Text,
        "character varying" | "varchar" => CanonicalType::Varchar(max_len.map(|l| l as u32)),
        "character" | "char" => CanonicalType::Char(max_len.map(|l| l as u32)),
        "uuid" => CanonicalType::Uuid,
        "json" | "jsonb" => CanonicalType::Json,
        "bytea" => CanonicalType::Binary,
        "numeric" | "decimal" => CanonicalType::Decimal {
            precision: None,
            scale: None,
        },
        "real" | "float4" => CanonicalType::Float,
        "double precision" | "float8" => CanonicalType::Double,
        "date" => CanonicalType::Date,
        "time" | "time without time zone" => CanonicalType::Time,
        "timestamp"
        | "timestamp without time zone"
        | "timestamp with time zone"
        | "timestamptz" => CanonicalType::Timestamp,
        _ => CanonicalType::Custom(dtype.to_string()),
    }
}
