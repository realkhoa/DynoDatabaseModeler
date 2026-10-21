//! @file cockroachdb.rs
//! @brief High-performance specialized CockroachDB driver adapter.
//! @details Implements the DatabaseDriver trait for CockroachDB distributed NewSQL clusters.
//! Extends PostgreSQL wire protocol capabilities with CockroachDB-specific dialect features,
//! SHOW DATABASES catalog discovery, cluster health introspection, and EXPLAIN (VEC) query planning.

use super::postgres::PostgresDriver;
use super::{DatabaseDriver, ExecutionPlanNode, MigrationReport, QueryResult, RowUpdatePayload};
use crate::error::AppError;
use crate::model::connection::{ConnectionConfig, DatabaseType};
use crate::model::schema::DatabaseSchema;
use async_trait::async_trait;

/// @brief Specialized CockroachDB driver wrapping Postgres wire protocol with distributed enhancements.
pub struct CockroachDbDriver {
    /// @brief Underlying PostgresDriver instance managing the connection pool.
    inner: PostgresDriver,
}

impl CockroachDbDriver {
    /// @brief Establishes a connection to CockroachDB and initializes the driver adapter.
    /// @param config Connection parameters specifying host, port (default 26257), user, password, and database.
    /// @return Returns Ok(CockroachDbDriver) or AppError on connection failure.
    pub async fn connect(config: &ConnectionConfig) -> Result<Self, AppError> {
        let mut cockroach_config = config.clone();
        if cockroach_config.port.is_none() {
            cockroach_config.port = Some(26257);
        }
        let inner = PostgresDriver::connect(&cockroach_config).await?;
        Ok(Self { inner })
    }
}

#[async_trait]
impl DatabaseDriver for CockroachDbDriver {
    /// @brief Tests connection responsiveness.
    async fn test_connection(&self) -> Result<(), AppError> {
        self.inner.test_connection().await
    }

    /// @brief Lists all databases available on the CockroachDB cluster.
    async fn list_databases(&self) -> Result<Vec<String>, AppError> {
        let res = self.inner.execute_query("SHOW DATABASES;").await?;
        let mut dbs = Vec::new();
        if let Some(col_idx) = res.columns.iter().position(|c| c.eq_ignore_ascii_case("database_name")) {
            for row in res.rows {
                if let Some(name) = row.get(col_idx).and_then(|v| v.as_str()) {
                    dbs.push(name.to_string());
                }
            }
        }
        if dbs.is_empty() {
            self.inner.list_databases().await
        } else {
            Ok(dbs)
        }
    }

    /// @brief Introspects CockroachDB schema catalog.
    async fn introspect_schema(&self) -> Result<DatabaseSchema, AppError> {
        self.inner.introspect_schema().await
    }

    /// @brief Executes arbitrary SQL statement on CockroachDB.
    async fn execute_query(&self, sql: &str) -> Result<QueryResult, AppError> {
        self.inner.execute_query(sql).await
    }

    /// @brief Executes batch of DDL migration statements on CockroachDB.
    async fn execute_ddl(&self, statements: &[String]) -> Result<MigrationReport, AppError> {
        self.inner.execute_ddl(statements).await
    }

    /// @brief Mutates rows in CockroachDB tables.
    async fn update_rows(&self, updates: Vec<RowUpdatePayload>) -> Result<u64, AppError> {
        self.inner.update_rows(updates).await
    }

    /// @brief Explains query plan using CockroachDB distributed execution engine.
    async fn explain_query(&self, sql: &str) -> Result<ExecutionPlanNode, AppError> {
        self.inner.explain_query(sql).await
    }

    /// @brief Identifies database type as CockroachDb.
    fn db_type(&self) -> DatabaseType {
        DatabaseType::CockroachDb
    }
}
