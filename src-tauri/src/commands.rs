//! @file commands.rs
//! @brief Tauri IPC command handlers bridging frontend UI with database backend services.
//! @details Implements asynchronous invocation endpoints for connection testing,
//! active connection lifecycle management, schema metadata introspection, diff calculation,
//! DDL script synthesis, migration execution, and arbitrary SQL query evaluation.

use tauri::State;

use crate::diff::compute_schema_diff;
use crate::diff::ddl::generate_ddl;
use crate::diff::model::SchemaDiff;
use crate::driver::factory::DriverFactory;
use crate::driver::{MigrationReport, QueryResult, RowUpdatePayload};
use crate::error::AppError;
use crate::model::connection::ConnectionConfig;
use crate::model::schema::DatabaseSchema;
use crate::state::AppState;

/// @brief Tests database connectivity for the supplied configuration without altering active state.
/// @details Instantiates a transient driver and verifies connectivity handshake and ping.
/// @param config Connection parameters, host, port, credentials, and SSL settings.
/// @return `Ok(true)` if connection succeeded; `Err(AppError)` on failure.
#[tauri::command]
pub async fn cmd_test_connection(config: ConnectionConfig) -> Result<bool, AppError> {
    let driver = DriverFactory::create(&config).await?;
    driver.test_connection().await?;
    Ok(true)
}

/// @brief Establishes an active database session and persists it into global application state.
/// @param config Connection parameters and credentials for the target database.
/// @param state Tauri managed handle to shared AppState.
/// @return `Ok(true)` on successful connection initialization.
/// @throws AppError if connection pool creation fails.
#[tauri::command]
pub async fn cmd_connect(
    config: ConnectionConfig,
    state: State<'_, AppState>,
) -> Result<bool, AppError> {
    state.connect(&config).await?;
    Ok(true)
}

/// @brief Introspects relational metadata and structure from the currently active database connection.
/// @param state Tauri managed handle to shared AppState.
/// @return Complete DatabaseSchema including tables, columns, indexes, and foreign keys.
/// @throws AppError::Connection if no database session is active.
/// @throws AppError::Introspection if metadata extraction fails.
#[tauri::command]
pub async fn cmd_introspect_schema(state: State<'_, AppState>) -> Result<DatabaseSchema, AppError> {
    state.introspect_active().await
}

/// @brief Calculates structural differences between the current live schema and target desired schema.
/// @details Pure functional computation returning added/dropped tables, columns, alterations, and foreign keys.
/// @param current Reference to the current live database schema state.
/// @param desired Reference to the target desired database schema design.
/// @return Structured SchemaDiff model.
#[tauri::command]
pub async fn cmd_compute_diff(
    current: DatabaseSchema,
    desired: DatabaseSchema,
) -> Result<SchemaDiff, AppError> {
    Ok(compute_schema_diff(&current, &desired))
}

/// @brief Generates dialect-accurate SQL DDL migration statements for a computed schema diff.
/// @details Automatically selects the SQL dialect corresponding to the currently active connection.
/// @param diff Schema difference model describing planned modifications.
/// @param state Tauri managed handle to shared AppState.
/// @return Ordered list of executable SQL DDL migration statements.
/// @throws AppError::Connection if no active database session is present to determine dialect.
#[tauri::command]
pub async fn cmd_generate_ddl(
    diff: SchemaDiff,
    state: State<'_, AppState>,
) -> Result<Vec<String>, AppError> {
    let config = state
        .get_active_config()
        .await
        .ok_or_else(|| AppError::Connection("No active database connection".to_string()))?;
    Ok(generate_ddl(&diff, config.db_type))
}

/// @brief Executes a series of DDL migration statements against the active database inside a transaction.
/// @param statements Ordered list of SQL DDL statements to apply.
/// @param state Tauri managed handle to shared AppState.
/// @return MigrationReport detailing statement execution counts, success flag, and failure message if any.
/// @throws AppError::Connection if no active database connection exists.
#[tauri::command]
pub async fn cmd_execute_migration(
    statements: Vec<String>,
    state: State<'_, AppState>,
) -> Result<MigrationReport, AppError> {
    state.execute_migration(&statements).await
}

/// @brief Executes an arbitrary user-submitted SQL query and returns tabular results with column metadata.
/// @param sql SQL statement string to execute against the active database.
/// @param state Tauri managed handle to shared AppState.
/// @return QueryResult containing ordered column names, row maps, and total affected/returned row count.
/// @throws AppError::Connection if no active database connection exists.
/// @throws AppError::Database on SQL syntax or execution error.
#[tauri::command]
pub async fn cmd_execute_query(
    sql: String,
    state: State<'_, AppState>,
) -> Result<QueryResult, AppError> {
    state.execute_query(&sql).await
}

/// @brief Disconnects the active database connection and clears stored configuration.
/// @param state Tauri managed handle to shared AppState.
/// @return `Ok(true)` on successful disconnect.
#[tauri::command]
pub async fn cmd_disconnect(state: State<'_, AppState>) -> Result<bool, AppError> {
    state.disconnect().await;
    Ok(true)
}

/// @brief Executes transactional row mutations against the active database.
/// @param payload Ordered list of row update payloads containing table, primary keys, and modified columns.
/// @param state Tauri managed handle to shared AppState.
/// @return Total count of rows affected across all executed updates.
/// @throws AppError::Connection if no active database session exists.
/// @throws AppError::Database on SQL syntax, constraint, or execution error.
#[tauri::command]
pub async fn cmd_update_rows(
    payload: Vec<RowUpdatePayload>,
    state: State<'_, AppState>,
) -> Result<u64, AppError> {
    state.update_rows(payload).await
}

