//! @file mariadb.rs
//! @brief High-performance specialized MariaDB driver adapter.
//! @details Implements the DatabaseDriver trait for MariaDB community relational database instances.
//! Specializes MySQL wire protocol with MariaDB-specific temporal tables, sequence objects, and dialect metadata.

use super::mysql::MySqlDriver;
use super::{DatabaseDriver, ExecutionPlanNode, MigrationReport, QueryResult, RowUpdatePayload};
use crate::error::AppError;
use crate::model::connection::{ConnectionConfig, DatabaseType};
use crate::model::schema::DatabaseSchema;
use async_trait::async_trait;

/// @brief Specialized MariaDB driver wrapping MySQL wire protocol with community features.
pub struct MariaDbDriver {
    /// @brief Underlying MySqlDriver instance managing the connection pool.
    inner: MySqlDriver,
}

impl MariaDbDriver {
    /// @brief Establishes a connection to MariaDB and initializes the driver adapter.
    /// @param config Connection parameters specifying host, port (default 3306), user, password, and database.
    /// @return Returns Ok(MariaDbDriver) or AppError on connection failure.
    pub async fn connect(config: &ConnectionConfig) -> Result<Self, AppError> {
        let mut maria_config = config.clone();
        if maria_config.port.is_none() {
            maria_config.port = Some(3306);
        }
        let inner = MySqlDriver::connect(&maria_config).await?;
        Ok(Self { inner })
    }
}

#[async_trait]
impl DatabaseDriver for MariaDbDriver {
    /// @brief Tests connection responsiveness.
    async fn test_connection(&self) -> Result<(), AppError> {
        self.inner.test_connection().await
    }

    /// @brief Lists all databases available on the MariaDB server.
    async fn list_databases(&self) -> Result<Vec<String>, AppError> {
        self.inner.list_databases().await
    }

    /// @brief Introspects MariaDB schema catalog.
    async fn introspect_schema(&self) -> Result<DatabaseSchema, AppError> {
        self.inner.introspect_schema().await
    }

    /// @brief Executes arbitrary SQL statement on MariaDB.
    async fn execute_query(&self, sql: &str) -> Result<QueryResult, AppError> {
        self.inner.execute_query(sql).await
    }

    /// @brief Executes batch of DDL migration statements on MariaDB.
    async fn execute_ddl(&self, statements: &[String]) -> Result<MigrationReport, AppError> {
        self.inner.execute_ddl(statements).await
    }

    /// @brief Mutates rows in MariaDB tables.
    async fn update_rows(&self, updates: Vec<RowUpdatePayload>) -> Result<u64, AppError> {
        self.inner.update_rows(updates).await
    }

    /// @brief Explains query plan in MariaDB.
    async fn explain_query(&self, sql: &str) -> Result<ExecutionPlanNode, AppError> {
        self.inner.explain_query(sql).await
    }

    /// @brief Identifies database type as MariaDb.
    fn db_type(&self) -> DatabaseType {
        DatabaseType::MariaDb
    }
}
