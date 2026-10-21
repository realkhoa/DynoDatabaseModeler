//! @file mod.rs
//! @brief Database driver abstraction layer and driver adapter implementations.
//! @details Defines the core DatabaseDriver trait, execution report types, query result representations,
//! and modules for specific database engine adapters (SQLite, PostgreSQL, MySQL, MSSQL, Redis).

pub mod cassandra;
pub mod clickhouse;
pub mod cockroachdb;
pub mod duckdb;
pub mod explain_model;
pub mod factory;
pub mod mariadb;
pub mod mongodb;
pub mod mssql;
pub mod mutation_model;
pub mod mysql;
pub mod postgres;
pub mod redis;
pub mod sqlite;
pub mod surrealdb;
pub mod tidb;
pub mod tunnel;

pub use cassandra::CassandraDriver;
pub use clickhouse::ClickHouseDriver;
pub use cockroachdb::CockroachDbDriver;
pub use duckdb::DuckDbDriver;
pub use explain_model::ExecutionPlanNode;
pub use mariadb::MariaDbDriver;
pub use mongodb::MongoDbDriver;
pub use mutation_model::RowUpdatePayload;
pub use redis::RedisDriver;
pub use surrealdb::SurrealDbDriver;
pub use tidb::TiDbDriver;
pub use tunnel::{SshAuthType, SshTunnel, SshTunnelConfig};

#[cfg(test)]
mod cassandra_test;
#[cfg(test)]
mod clickhouse_test;
#[cfg(test)]
mod duckdb_test;
#[cfg(test)]
mod explain_test;
#[cfg(test)]
mod factory_test;
#[cfg(test)]
mod mongodb_test;
#[cfg(test)]
mod mutation_test;
#[cfg(test)]
mod redis_test;
#[cfg(test)]
mod sqlite_test;
#[cfg(test)]
mod surrealdb_test;
#[cfg(test)]
mod tunnel_test;

use crate::error::AppError;
use crate::model::connection::DatabaseType;
use crate::model::schema::DatabaseSchema;
use async_trait::async_trait;
use serde::{Deserialize, Serialize};

/// @brief Report summarizing the execution of a multi-statement DDL migration batch.
/// @details Encapsulates whether the batch succeeded, count of statements processed,
/// elapsed execution time in milliseconds, and any failure message encountered.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MigrationReport {
    /// @brief Indicates whether all migration statements completed and committed successfully.
    pub success: bool,
    /// @brief Count of DDL statements executed before completion or failure.
    pub statements_executed: usize,
    /// @brief Total elapsed execution duration in milliseconds.
    pub execution_time_ms: u64,
    /// @brief Error description if execution failed, or None on success.
    pub error_message: Option<String>,
}

/// @brief Result set produced by an arbitrary SQL query execution.
/// @details Contains column header names, serialized tabular row values, affected row count,
/// and wall-clock execution time in milliseconds.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct QueryResult {
    /// @brief Ordered list of column names present in the query result set.
    pub columns: Vec<String>,
    /// @brief Two-dimensional grid of cell values encoded as JSON values.
    pub rows: Vec<Vec<serde_json::Value>>,
    /// @brief Number of rows affected or returned by the query.
    pub rows_affected: u64,
    /// @brief Total elapsed query execution duration in milliseconds.
    pub execution_time_ms: u64,
}

/// @brief Asynchronous common trait implemented by all relational database adapters.
/// @details Standardizes database connectivity checks, catalog schema introspection,
/// arbitrary query execution, transactional DDL script migration, and dialect identification.
#[async_trait]
pub trait DatabaseDriver: Send + Sync {
    /// @brief Tests whether the database connection can be established and is responsive.
    /// @return Returns Ok(()) on successful ping/connection or AppError::Connection on failure.
    async fn test_connection(&self) -> Result<(), AppError>;

    /// @brief Introspects the target database schema including tables, columns, PKs, and foreign keys.
    /// @return Returns the populated DatabaseSchema domain model or AppError::Introspection on failure.
    async fn introspect_schema(&self) -> Result<DatabaseSchema, AppError>;

    /// @brief Executes an arbitrary read or write SQL query and formats the result.
    /// @param sql SQL statement string to execute against the connection pool.
    /// @return Returns QueryResult containing column names, row values, and execution metrics.
    async fn execute_query(&self, sql: &str) -> Result<QueryResult, AppError>;

    /// @brief Executes a batch of DDL statements sequentially within an atomic transaction.
    /// @param statements Slice of SQL DDL statement strings to apply in sequence.
    /// @return Returns MigrationReport with execution statistics, or AppError::Migration if rolled back.
    async fn execute_ddl(&self, statements: &[String]) -> Result<MigrationReport, AppError>;

    /// @brief Executes a batch of row mutations transactionally against the database.
    /// @param updates List of row update payloads specifying tables, PKs, and modified column values.
    /// @return Returns the total count of rows affected across all updates, or AppError on failure/rollback.
    async fn update_rows(&self, updates: Vec<RowUpdatePayload>) -> Result<u64, AppError>;

    /// @brief Generates an execution plan tree for the provided SQL query.
    /// @param sql SQL statement to analyze and explain.
    /// @return Returns the root ExecutionPlanNode or AppError on query failure.
    async fn explain_query(&self, sql: &str) -> Result<ExecutionPlanNode, AppError>;

    /// @brief Lists all databases available on the connected server instance.
    /// @return Returns a vector of database name strings or AppError on query failure.
    async fn list_databases(&self) -> Result<Vec<String>, AppError> {
        Ok(vec![])
    }

    /// @brief Resolves the primary key columns of one table.
    /// @details The interactive data grid requires a unique row locator; asking the database for the
    /// real primary key removes the need to guess one from the result set. The default implementation
    /// introspects the catalog and matches the table by qualified or bare name.
    /// @param table Table name, optionally schema qualified.
    /// @return Ordered primary key column names, empty when the table has no primary key.
    async fn primary_key_columns(&self, table: &str) -> Result<Vec<String>, AppError> {
        let schema = crate::diff::ddl::split_qualified(table);
        let (schema_name, table_name) = (schema.0, schema.1);

        let database = self.introspect_schema().await?;
        let found = database.tables.iter().find(|t| {
            t.name == table_name
                && match schema_name {
                    Some(schema) => t.schema.as_deref() == Some(schema),
                    None => true,
                }
        });

        Ok(found
            .map(|t| {
                t.columns
                    .iter()
                    .filter(|c| c.is_primary_key)
                    .map(|c| c.name.clone())
                    .collect()
            })
            .unwrap_or_default())
    }

    /// @brief Identifies the specific relational database engine dialect handled by this driver.
    /// @return Returns the corresponding DatabaseType enum variant.
    fn db_type(&self) -> DatabaseType;
}

/// @brief Maps foreign key referential action strings to ReferentialAction enum variants.
/// @param action Raw rule string (e.g. CASCADE, SET NULL, RESTRICT, SET DEFAULT).
/// @return Normalized ReferentialAction variant.
pub fn parse_referential_action(action: &str) -> crate::model::schema::ReferentialAction {
    match action.to_uppercase().as_str() {
        "CASCADE" => crate::model::schema::ReferentialAction::Cascade,
        "SET NULL" => crate::model::schema::ReferentialAction::SetNull,
        "RESTRICT" => crate::model::schema::ReferentialAction::Restrict,
        "SET DEFAULT" => crate::model::schema::ReferentialAction::SetDefault,
        _ => crate::model::schema::ReferentialAction::NoAction,
    }
}

/// @brief Maps a PostgreSQL `pg_constraint.confdeltype` / `confupdtype` character to an action.
/// @details PostgreSQL stores referential actions as single characters:
/// `a` = NO ACTION, `r` = RESTRICT, `c` = CASCADE, `n` = SET NULL, `d` = SET DEFAULT.
/// @param code Single-character action code.
/// @return Normalized ReferentialAction variant.
pub fn parse_pg_action_code(code: &str) -> crate::model::schema::ReferentialAction {
    match code.trim() {
        "c" => crate::model::schema::ReferentialAction::Cascade,
        "n" => crate::model::schema::ReferentialAction::SetNull,
        "d" => crate::model::schema::ReferentialAction::SetDefault,
        "r" => crate::model::schema::ReferentialAction::Restrict,
        _ => crate::model::schema::ReferentialAction::NoAction,
    }
}

/// @brief Extracts the leading SQL keyword, skipping whitespace and comments.
/// @details Used to distinguish statements that return a result set from statements that only
/// report an affected row count, so `rows_affected` is never reported as zero for DML.
/// @param sql SQL statement text.
/// @return Lowercase leading keyword, or an empty string when the statement is blank.
pub fn first_sql_keyword(sql: &str) -> String {
    let bytes = sql.as_bytes();
    let mut i = 0usize;
    loop {
        while i < bytes.len() && bytes[i].is_ascii_whitespace() {
            i += 1;
        }
        if i + 1 < bytes.len() && bytes[i] == b'-' && bytes[i + 1] == b'-' {
            while i < bytes.len() && bytes[i] != b'\n' {
                i += 1;
            }
            continue;
        }
        if i + 1 < bytes.len() && bytes[i] == b'/' && bytes[i + 1] == b'*' {
            i += 2;
            while i + 1 < bytes.len() && !(bytes[i] == b'*' && bytes[i + 1] == b'/') {
                i += 1;
            }
            i = (i + 2).min(bytes.len());
            continue;
        }
        break;
    }

    let start = i;
    while i < bytes.len() && (bytes[i].is_ascii_alphanumeric() || bytes[i] == b'_') {
        i += 1;
    }
    sql[start..i].to_ascii_lowercase()
}

/// @brief Determines whether a SQL statement produces a result set.
/// @details Row-returning statements must be executed as queries; everything else is executed
/// for its affected row count.
/// @param sql SQL statement text.
/// @return `true` when the statement returns rows.
pub fn is_row_returning(sql: &str) -> bool {
    matches!(
        first_sql_keyword(sql).as_str(),
        "select"
            | "with"
            | "values"
            | "table"
            | "pragma"
            | "show"
            | "explain"
            | "describe"
            | "desc"
    )
}

/// @brief Attaches numeric precision and scale metadata to a canonical decimal type.
/// @details Information schemas expose `NUMERIC_PRECISION` / `NUMERIC_SCALE` separately from the
/// type name, so they are merged in after the base type is mapped. Without this the modeler would
/// report `DECIMAL` and regenerate a precision-less column, losing precision and scale.
/// @param data_type Canonical type produced by the dialect type mapper.
/// @param precision Optional numeric precision reported by the catalog.
/// @param scale Optional numeric scale reported by the catalog.
/// @return Canonical type, with precision/scale filled in for decimals.
pub fn with_decimal_metadata(
    data_type: crate::model::schema::CanonicalType,
    precision: Option<i64>,
    scale: Option<i64>,
) -> crate::model::schema::CanonicalType {
    use crate::model::schema::CanonicalType;
    match data_type {
        CanonicalType::Decimal { .. } => CanonicalType::Decimal {
            precision: precision.and_then(|p| u32::try_from(p).ok()),
            scale: scale.and_then(|s| u32::try_from(s).ok()),
        },
        other => other,
    }
}

/// @brief Qualifies an object name with its namespace when a namespace is present.
/// @details Foreign key target tables are stored fully qualified so that regenerated constraints
/// bind to the correct namespace instead of the connection's default search path.
/// @param schema Optional namespace name.
/// @param name Bare object name.
/// @return `schema.name` when a schema is supplied, otherwise the bare name.
pub fn qualify(schema: Option<&str>, name: &str) -> String {
    match schema.map(str::trim).filter(|s| !s.is_empty()) {
        Some(schema) => format!("{}.{}", schema, name),
        None => name.to_string(),
    }
}

/// @brief Renders a binary cell value as a readable placeholder.
/// @details Binary payloads cannot be shown verbatim in a grid; reporting their size is preferable
/// to rendering them as NULL, which is indistinguishable from a real NULL.
/// @param bytes Raw byte payload.
/// @return Placeholder such as `<binary 128 bytes>`.
pub fn describe_binary(bytes: &[u8]) -> String {
    format!("<binary {} bytes>", bytes.len())
}

/// @brief Formats a decoded decimal value for display.
/// @param value Decimal value reported by the driver.
/// @return Plain decimal string.
pub fn format_decimal(value: rust_decimal::Decimal) -> String {
    value.to_string()
}
