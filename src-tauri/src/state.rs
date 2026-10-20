//! @file state.rs
//! @brief Thread-safe global application state management for database connections.
//! @details Houses the active database driver and connection configuration inside
//! asynchronous read-write locks (`tokio::sync::RwLock`), providing coordinated access
//! across Tauri IPC command invocations.

use std::path::PathBuf;
use std::sync::Arc;
use std::time::Duration;
use tokio::sync::RwLock;

use crate::diff::ddl::{generate_ddl, GeneratedDdl};
use crate::diff::model::SchemaDiff;
use crate::driver::factory::DriverFactory;
use crate::driver::{
    DatabaseDriver, ExecutionPlanNode, MigrationReport, QueryResult, RowUpdatePayload,
};
use crate::error::AppError;
use crate::model::connection::ConnectionConfig;
use crate::model::schema::DatabaseSchema;

/// @brief Wall-clock limit applied to a single user query or execution plan request.
/// @details Without a bound a runaway statement leaves the workbench spinning and blocks every
/// other command on the same connection. The limit abandons the call and reports it; the database
/// server may still be finishing the statement.
const QUERY_TIMEOUT: Duration = Duration::from_secs(120);

/// @brief Wall-clock limit applied to a DDL migration batch or a batch row mutation.
const MUTATION_TIMEOUT: Duration = Duration::from_secs(300);

/// @brief Awaits a driver call with a wall-clock limit.
/// @param limit Maximum time to wait.
/// @param future Driver call to await.
/// @param description Human-readable operation name used in the timeout message.
/// @return The driver result, or an AppError describing the timeout.
async fn with_timeout<T, F>(limit: Duration, future: F, description: &str) -> Result<T, AppError>
where
    F: std::future::Future<Output = Result<T, AppError>>,
{
    match tokio::time::timeout(limit, future).await {
        Ok(result) => result,
        Err(_) => Err(AppError::Database(format!(
            "{} exceeded the {} second limit and was abandoned. The database server may still be \
             executing it; reconnect if the session stops responding.",
            description,
            limit.as_secs()
        ))),
    }
}

/// @brief Global application state managing the active database driver and configuration.
/// @details Wrapped in `Arc` and `RwLock` to enable safe shared mutable state across asynchronous
/// Tauri IPC handler execution threads.
#[derive(Default, Clone)]
pub struct AppState {
    /// @brief Thread-safe handle to the active database driver instance.
    active_driver: Arc<RwLock<Option<Box<dyn DatabaseDriver>>>>,
    /// @brief Active SSH bastion tunnel backing the connection, when one is configured.
    /// @details Held here so the forwarding listener and its loopback socket stay alive for as long
    /// as the connection does.
    active_tunnel: Arc<RwLock<Option<crate::driver::SshTunnel>>>,
    /// @brief Thread-safe handle to the active database connection configuration.
    active_config: Arc<RwLock<Option<ConnectionConfig>>>,
    /// @brief Thread-safe handle to the internal SQLite pool for persistent query history.
    storage_pool: Arc<RwLock<Option<sqlx::SqlitePool>>>,
    /// @brief Directory holding the application's local SQLite file.
    /// @details Set from the Tauri app data directory during startup, so query history survives
    /// application restarts instead of living in a per-process in-memory database.
    storage_dir: Arc<std::sync::Mutex<Option<PathBuf>>>,
}

impl AppState {
    /// @brief Constructs a new, disconnected AppState instance.
    /// @return Fresh AppState initialized with empty driver and configuration references.
    pub fn new() -> Self {
        Self::default()
    }

    /// @brief Sets the directory used for the application's local SQLite file.
    /// @details Called once during startup with the Tauri app data directory. Query history is
    /// persisted there so it survives restarts; without it the storage falls back to a temporary
    /// directory, which is only appropriate for tests.
    /// @param dir Directory that will hold `history.db`.
    pub fn configure_storage(&self, dir: PathBuf) {
        if let Ok(mut guard) = self.storage_dir.lock() {
            *guard = Some(dir);
        }
    }

    /// @brief Resolves the directory holding the local SQLite file.
    /// @return Configured directory, or a process-wide temporary directory as a fallback.
    fn storage_directory(&self) -> PathBuf {
        if let Ok(guard) = self.storage_dir.lock() {
            if let Some(dir) = guard.as_ref() {
                return dir.clone();
            }
        }
        std::env::temp_dir().join("dyno-db-modeler")
    }

    /// @brief Establishes an active database connection using the provided configuration.
    /// @details Instantiates a new database driver via DriverFactory and atomically updates the
    /// active driver, tunnel and configuration state locks. The configuration stored is the one
    /// supplied by the caller (not the tunnel-rewritten one) so that reconnecting re-establishes
    /// the tunnel from the original endpoint.
    /// @param config Reference to target connection parameters and credentials.
    /// @return Ok(()) on successful connection; Err(AppError) if driver creation fails.
    pub async fn connect(&self, config: &ConnectionConfig) -> Result<(), AppError> {
        let handle = DriverFactory::create(config).await?;
        let mut d_lock = self.active_driver.write().await;
        let mut t_lock = self.active_tunnel.write().await;
        let mut c_lock = self.active_config.write().await;
        *d_lock = Some(handle.driver);
        *t_lock = handle.tunnel;
        *c_lock = Some(config.clone());
        Ok(())
    }

    /// @brief Closes and releases the active database connection, its tunnel and stored configuration.
    /// @details Resets the driver, tunnel and configuration state handles to `None`, which drops the
    /// SSH tunnel and releases its loopback port.
    pub async fn disconnect(&self) {
        let mut d_lock = self.active_driver.write().await;
        let mut t_lock = self.active_tunnel.write().await;
        let mut c_lock = self.active_config.write().await;
        *d_lock = None;
        *t_lock = None;
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

    /// @brief Lists all databases available on the currently connected active server.
    /// @return Vector of database names or AppError::Connection if disconnected.
    pub async fn list_active_databases(&self) -> Result<Vec<String>, AppError> {
        let lock = self.active_driver.read().await;
        if let Some(driver) = lock.as_ref() {
            driver.list_databases().await
        } else {
            Err(AppError::Connection(
                "No active database connection".to_string(),
            ))
        }
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
            with_timeout(
                MUTATION_TIMEOUT,
                driver.execute_ddl(statements),
                "Schema migration",
            )
            .await
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
            with_timeout(QUERY_TIMEOUT, driver.execute_query(sql), "Query execution").await
        } else {
            Err(AppError::Connection(
                "No active database connection".to_string(),
            ))
        }
    }

    /// @brief Generates dialect-specific SQL DDL statements for a given schema diff using the active connection's dialect.
    /// @param diff Reference to the computed schema diff.
    /// @return Generated statements plus warnings for changes the dialect cannot express.
    /// @throws AppError::Connection if no active database connection exists to determine dialect.
    pub async fn generate_ddl(&self, diff: &SchemaDiff) -> Result<GeneratedDdl, AppError> {
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
            with_timeout(MUTATION_TIMEOUT, driver.update_rows(updates), "Row update").await
        } else {
            Err(AppError::Connection(
                "No active database connection".to_string(),
            ))
        }
    }

    /// @brief Generates an execution plan tree for the provided SQL query against the active database.
    /// @param sql SQL statement string to analyze.
    /// @return ExecutionPlanNode representing root plan operation.
    /// @throws AppError::Connection if no database connection is currently active.
    pub async fn explain_query(&self, sql: &str) -> Result<ExecutionPlanNode, AppError> {
        let lock = self.active_driver.read().await;
        if let Some(driver) = lock.as_ref() {
            with_timeout(
                QUERY_TIMEOUT,
                driver.explain_query(sql),
                "Query plan analysis",
            )
            .await
        } else {
            Err(AppError::Connection(
                "No active database connection".to_string(),
            ))
        }
    }

    /// @brief Ensures the internal history SQLite database is initialized.
    /// @details Opens (creating when needed) a file-backed SQLite database inside the configured
    /// storage directory. A file database is required for history to survive application restarts:
    /// an in-memory database is destroyed as soon as the pool reaps its idle connection, after which
    /// every history read and write fails with `no such table: query_history`.
    /// @return Returns active SQLite connection pool for local storage.
    pub async fn get_or_init_storage(&self) -> Result<sqlx::SqlitePool, AppError> {
        let mut lock = self.storage_pool.write().await;
        if let Some(pool) = lock.as_ref() {
            return Ok(pool.clone());
        }

        let dir = self.storage_directory();
        std::fs::create_dir_all(&dir).map_err(|e| {
            AppError::Database(format!(
                "Failed to create local storage directory '{}': {}",
                dir.display(),
                e
            ))
        })?;

        let db_path = dir.join("history.db");
        let options = sqlx::sqlite::SqliteConnectOptions::new()
            .filename(&db_path)
            .create_if_missing(true)
            .journal_mode(sqlx::sqlite::SqliteJournalMode::Wal)
            .busy_timeout(std::time::Duration::from_secs(5));

        // A single connection keeps the history log free of writer contention; the workload is a
        // low-volume append/read log, so a larger pool would only add lock error surface.
        let pool = sqlx::sqlite::SqlitePoolOptions::new()
            .max_connections(1)
            .idle_timeout(None)
            .max_lifetime(None)
            .connect_with(options)
            .await
            .map_err(|e| {
                AppError::Database(format!(
                    "Failed to open history storage '{}': {}",
                    db_path.display(),
                    e
                ))
            })?;

        crate::storage::history::init_history_schema(&pool).await?;

        *lock = Some(pool.clone());
        Ok(pool)
    }

    /// @brief Records a query execution record in local history storage.
    /// @param query Executed SQL statement text.
    /// @param duration_ms Wall-clock execution time in milliseconds.
    /// @param rows_count Number of affected or returned rows.
    /// @param status Status string ("success" or "error").
    /// @return QueryHistoryRecord instance.
    pub async fn record_query_history(
        &self,
        query: &str,
        duration_ms: u64,
        rows_count: u64,
        status: &str,
    ) -> Result<crate::storage::QueryHistoryRecord, AppError> {
        let pool = self.get_or_init_storage().await?;
        match crate::storage::history::record_query(&pool, query, duration_ms, rows_count, status)
            .await
        {
            Ok(record) => Ok(record),
            Err(err) => {
                self.retry_history_after_reinit(err, || {
                    let pool = pool.clone();
                    let query = query.to_string();
                    let status = status.to_string();
                    async move {
                        crate::storage::history::record_query(
                            &pool,
                            &query,
                            duration_ms,
                            rows_count,
                            &status,
                        )
                        .await
                    }
                })
                .await
            }
        }
    }

    /// @brief Retrieves the latest query execution records.
    /// @param limit Maximum number of records to return.
    /// @return Vector of QueryHistoryRecord instances ordered latest first.
    pub async fn get_query_history(
        &self,
        limit: usize,
    ) -> Result<Vec<crate::storage::QueryHistoryRecord>, AppError> {
        let pool = self.get_or_init_storage().await?;
        match crate::storage::history::get_history(&pool, limit).await {
            Ok(records) => Ok(records),
            Err(err) => {
                self.retry_history_after_reinit(err, || {
                    let pool = pool.clone();
                    async move { crate::storage::history::get_history(&pool, limit).await }
                })
                .await
            }
        }
    }

    /// @brief Re-runs a history operation once after recreating a missing history table.
    /// @details Guards against a history file that was deleted or replaced while the app was
    /// running (or opened before the schema existed): the schema is re-created and the operation is
    /// retried a single time. Any other error is returned unchanged.
    /// @param error Error produced by the first attempt.
    /// @param retry Closure performing the same operation again.
    /// @return Result of the retry, or the original error.
    async fn retry_history_after_reinit<F, Fut, T>(
        &self,
        error: AppError,
        retry: F,
    ) -> Result<T, AppError>
    where
        F: FnOnce() -> Fut,
        Fut: std::future::Future<Output = Result<T, AppError>>,
    {
        if !error.to_string().contains("no such table") {
            return Err(error);
        }

        let pool = self.get_or_init_storage().await?;
        if crate::storage::history::init_history_schema(&pool)
            .await
            .is_err()
        {
            return Err(error);
        }
        retry().await
    }

    /// @brief Toggles the favorite status of a query history record.
    /// @param id Primary key ID of the record.
    /// @return Updated favorite boolean state.
    pub async fn toggle_favorite_query(&self, id: i64) -> Result<bool, AppError> {
        let pool = self.get_or_init_storage().await?;
        match crate::storage::history::toggle_favorite(&pool, id).await {
            Ok(value) => Ok(value),
            Err(err) => {
                self.retry_history_after_reinit(err, || {
                    let pool = pool.clone();
                    async move { crate::storage::history::toggle_favorite(&pool, id).await }
                })
                .await
            }
        }
    }

    /// @brief Clears non-favorite query history records.
    /// @return Ok(()) on successful cleanup.
    pub async fn clear_query_history(&self) -> Result<(), AppError> {
        let pool = self.get_or_init_storage().await?;
        match crate::storage::history::clear_history(&pool).await {
            Ok(()) => Ok(()),
            Err(err) => {
                self.retry_history_after_reinit(err, || {
                    let pool = pool.clone();
                    async move { crate::storage::history::clear_history(&pool).await }
                })
                .await
            }
        }
    }
}
