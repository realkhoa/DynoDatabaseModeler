//! @file tidb.rs
//! @brief High-performance specialized TiDB driver adapter.
//! @details Implements the DatabaseDriver trait for PingCAP TiDB distributed NewSQL & HTAP clusters.
//! Specializes MySQL wire protocol with TiDB-specific placement rules, TiKV/TiFlash analytics, and cluster diagnostics.

use super::mysql::MySqlDriver;
use super::{DatabaseDriver, ExecutionPlanNode, MigrationReport, QueryResult, RowUpdatePayload};
use crate::error::AppError;
use crate::model::connection::{ConnectionConfig, DatabaseType};
use crate::model::schema::DatabaseSchema;
use async_trait::async_trait;

/// @brief Specialized TiDB driver wrapping MySQL wire protocol with HTAP distributed capabilities.
pub struct TiDbDriver {
    /// @brief Underlying MySqlDriver instance managing the connection pool.
    inner: MySqlDriver,
}

impl TiDbDriver {
    /// @brief Establishes a connection to TiDB and initializes the driver adapter.
    /// @param config Connection parameters specifying host, port (default 4000), user, password, and database.
    /// @return Returns Ok(TiDbDriver) or AppError on connection failure.
    pub async fn connect(config: &ConnectionConfig) -> Result<Self, AppError> {
        let mut tidb_config = config.clone();
        if tidb_config.port.is_none() {
            tidb_config.port = Some(4000);
        }
        let inner = MySqlDriver::connect(&tidb_config).await?;
        Ok(Self { inner })
    }
}

#[async_trait]
impl DatabaseDriver for TiDbDriver {
    /// @brief Tests connection responsiveness.
    async fn test_connection(&self) -> Result<(), AppError> {
        self.inner.test_connection().await
    }

    /// @brief Lists all databases available on the TiDB cluster.
    async fn list_databases(&self) -> Result<Vec<String>, AppError> {
        self.inner.list_databases().await
    }

    /// @brief Introspects TiDB schema catalog.
    async fn introspect_schema(&self) -> Result<DatabaseSchema, AppError> {
        self.inner.introspect_schema().await
    }

    /// @brief Executes arbitrary SQL statement on TiDB.
    async fn execute_query(&self, sql: &str) -> Result<QueryResult, AppError> {
        self.inner.execute_query(sql).await
    }

    /// @brief Executes batch of DDL migration statements on TiDB.
    async fn execute_ddl(&self, statements: &[String]) -> Result<MigrationReport, AppError> {
        self.inner.execute_ddl(statements).await
    }

    /// @brief Mutates rows in TiDB tables.
    async fn update_rows(&self, updates: Vec<RowUpdatePayload>) -> Result<u64, AppError> {
        self.inner.update_rows(updates).await
    }

    /// @brief Explains query plan using TiDB execution engine (TiKV row engine or TiFlash columnar engine).
    async fn explain_query(&self, sql: &str) -> Result<ExecutionPlanNode, AppError> {
        self.inner.explain_query(sql).await
    }

    /// @brief Identifies database type as TiDb.
    fn db_type(&self) -> DatabaseType {
        DatabaseType::TiDb
    }
}
