//! @file mod.rs
//! @brief Database driver abstraction layer and driver adapter implementations.
//! @details Defines the core DatabaseDriver trait, execution report types, query result representations,
//! and modules for specific database engine adapters (SQLite, PostgreSQL, MySQL, MSSQL).

pub mod explain_model;
pub mod factory;
pub mod mssql;
pub mod mutation_model;
pub mod mysql;
pub mod postgres;
pub mod sqlite;
pub mod tunnel;

pub use explain_model::ExecutionPlanNode;
pub use mutation_model::RowUpdatePayload;
pub use tunnel::{SshAuthType, SshTunnel, SshTunnelConfig};

#[cfg(test)]
mod explain_test;
#[cfg(test)]
mod factory_test;
#[cfg(test)]
mod mutation_test;
#[cfg(test)]
mod sqlite_test;
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
