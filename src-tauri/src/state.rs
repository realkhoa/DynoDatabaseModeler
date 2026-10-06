//! @file state.rs
//! @brief Thread-safe global application state management for database connections.
//! @details Houses the active database driver and connection configuration inside
//! asynchronous read-write locks (`tokio::sync::RwLock`), providing coordinated access
//! across Tauri IPC command invocations.

use std::sync::Arc;
use tokio::sync::RwLock;

use crate::diff::ddl::generate_ddl;
use crate::diff::model::SchemaDiff;
use crate::driver::factory::DriverFactory;
use crate::driver::{DatabaseDriver, MigrationReport, QueryResult, RowUpdatePayload};
use crate::error::AppError;
use crate::model::connection::ConnectionConfig;
use crate::model::schema::DatabaseSchema;

/// @brief Global application state managing the active database driver and configuration.
/// @details Wrapped in `Arc` and `RwLock` to enable safe shared mutable state across asynchronous
/// Tauri IPC handler execution threads.
#[derive(Default, Clone)]
pub struct AppState {
    /// @brief Thread-safe handle to the active database driver instance.
    active_driver: Arc<RwLock<Option<Box<dyn DatabaseDriver>>>>,
    /// @brief Thread-safe handle to the active database connection configuration.
    active_config: Arc<RwLock<Option<ConnectionConfig>>>,
}

impl AppState {
    /// @brief Constructs a new, disconnected AppState instance.
    /// @return Fresh AppState initialized with empty driver and configuration references.
    pub fn new() -> Self {
        Self::default()
    }

    /// @brief Establishes an active database connection using the provided configuration.
    /// @details Instantiates a new database driver via DriverFactory and atomically updates
    /// both the active driver and active configuration state locks.
    /// @param config Reference to target connection parameters and credentials.
    /// @return Ok(()) on successful connection; Err(AppError) if driver creation fails.
    pub async fn connect(&self, config: &ConnectionConfig) -> Result<(), AppError> {
        let driver = DriverFactory::create(config).await?;
        let mut d_lock = self.active_driver.write().await;
        let mut c_lock = self.active_config.write().await;
        *d_lock = Some(driver);
        *c_lock = Some(config.clone());
        Ok(())
    }

    /// @brief Closes and releases the active database connection and stored configuration.
    /// @details Resets both driver and configuration state handles to `None`.
    pub async fn disconnect(&self) {
        let mut d_lock = self.active_driver.write().await;
        let mut c_lock = self.active_config.write().await;
        *d_lock = None;
        *c_lock = None;
    }

    /// @brief Introspects relational schema metadata from the currently connected database.
    /// @details Acquires a read lock on the active driver and delegates introspection.
    /// @return Complete DatabaseSchema metadata on success.
    /// @throws AppError::Connection if no database connection is currently active.
    /// @throws AppError::Introspection if metadata catalog queries fail.
    pub async fn introspect_active(&self) -> Result<DatabaseSchema, AppError> {
        let lock = self.active_driver.read().await;
        if let Some(driver) = lock.as_ref() {
            driver.introspect_schema().await
        } else {
            Err(AppError::Connection(
                "No active database connection".to_string(),
            ))
        }
    }

    /// @brief Acquires an asynchronous read lock guard on the active driver slot.
    /// @return Read guard referencing the optional active DatabaseDriver trait object.
    pub async fn get_active_driver(
        &self,
    ) -> Result<tokio::sync::RwLockReadGuard<'_, Option<Box<dyn DatabaseDriver>>>, AppError> {
        Ok(self.active_driver.read().await)
    }

    /// @brief Retrieves a cloned copy of the currently active connection configuration.
    /// @return Some(ConnectionConfig) if connected; None if disconnected.
    pub async fn get_active_config(&self) -> Option<ConnectionConfig> {
        self.active_config.read().await.clone()
    }

    /// @brief Executes a batch of DDL migration statements against the active database.
    /// @param statements Ordered slice of SQL DDL statements to execute.
    /// @return MigrationReport summarizing execution status, counts, or failure details.
    /// @throws AppError::Connection if no database connection is currently active.
    pub async fn execute_migration(
        &self,
        statements: &[String],
    ) -> Result<MigrationReport, AppError> {
        let lock = self.active_driver.read().await;
        if let Some(driver) = lock.as_ref() {
            driver.execute_ddl(statements).await
        } else {
            Err(AppError::Connection(
                "No active database connection".to_string(),
            ))
        }
    }

    /// @brief Executes an arbitrary SQL query against the active database and returns tabular results.
    /// @param sql SQL query string to execute.
    /// @return QueryResult containing column definitions, JSON row maps, and row counts.
    /// @throws AppError::Connection if no database connection is currently active.
    pub async fn execute_query(&self, sql: &str) -> Result<QueryResult, AppError> {
        let lock = self.active_driver.read().await;
        if let Some(driver) = lock.as_ref() {
            driver.execute_query(sql).await
        } else {
            Err(AppError::Connection(
                "No active database connection".to_string(),
            ))
        }
    }

    /// @brief Generates dialect-specific SQL DDL statements for a given schema diff using the active connection's dialect.
    /// @param diff Reference to the computed schema diff.
    /// @return List of executable SQL DDL statements.
    /// @throws AppError::Connection if no active database connection exists to determine dialect.
    pub async fn generate_ddl(&self, diff: &SchemaDiff) -> Result<Vec<String>, AppError> {
        let config = self
            .get_active_config()
            .await
            .ok_or_else(|| AppError::Connection("No active database connection".to_string()))?;
        Ok(generate_ddl(diff, config.db_type))
    }

    /// @brief Executes a batch of transactional row updates against the active database.
    /// @param updates List of row update payloads specifying tables, PKs, and modified column values.
    /// @return Total number of affected rows on success, or AppError if rolled back or disconnected.
    /// @throws AppError::Connection if no database connection is currently active.
    pub async fn update_rows(&self, updates: Vec<RowUpdatePayload>) -> Result<u64, AppError> {
        let lock = self.active_driver.read().await;
        if let Some(driver) = lock.as_ref() {
            driver.update_rows(updates).await
        } else {
            Err(AppError::Connection(
                "No active database connection".to_string(),
            ))
        }
    }
}
