//! @file commands.rs
//! @brief Tauri IPC command handlers bridging frontend UI with database backend services.
//! @details Implements asynchronous invocation endpoints for connection testing,
//! active connection lifecycle management, schema metadata introspection, diff calculation,
//! DDL script synthesis, migration execution, and arbitrary SQL query evaluation.

use tauri::State;

use crate::diff::compute_schema_diff;
use crate::diff::ddl::{generate_ddl, GeneratedDdl};
use crate::diff::model::SchemaDiff;
use crate::driver::factory::DriverFactory;
use crate::driver::{ExecutionPlanNode, MigrationReport, QueryResult, RowUpdatePayload};
use crate::error::AppError;
use crate::model::connection::ConnectionConfig;
use crate::model::schema::DatabaseSchema;
use crate::state::AppState;
use crate::storage::QueryHistoryRecord;

/// @brief Tests database connectivity for the supplied configuration without altering active state.
/// @details Instantiates a transient driver and verifies connectivity handshake and ping.
/// Missing credentials are resolved from the operating system secret store.
/// @param config Connection parameters, host, port, credentials, and SSL settings.
/// @return `Ok(true)` if connection succeeded; `Err(AppError)` on failure.
#[tauri::command]
pub async fn cmd_test_connection(config: ConnectionConfig) -> Result<bool, AppError> {
    let mut resolved = config;
    crate::storage::secrets::apply_to_config(&mut resolved)?;
    // The handle owns the tunnel, so it must stay alive while the connectivity check runs.
    let handle = DriverFactory::create(&resolved).await?;
    handle.driver.test_connection().await?;
    Ok(true)
}

/// @brief Establishes an active database session and persists it into global application state.
/// @details Missing credentials are resolved from the operating system secret store so a saved
/// profile can reconnect without the password being present in frontend storage.
/// @param config Connection parameters and credentials for the target database.
/// @param state Tauri managed handle to shared AppState.
/// @return `Ok(true)` on successful connection initialization.
/// @throws AppError if connection pool creation fails.
#[tauri::command]
pub async fn cmd_connect(
    config: ConnectionConfig,
    state: State<'_, AppState>,
) -> Result<bool, AppError> {
    let mut resolved = config;
    crate::storage::secrets::apply_to_config(&mut resolved)?;
    state.connect(&resolved).await?;
    Ok(true)
}

/// @brief Queries all accessible databases on a remote database server using connection credentials.
/// @details Connects using default maintenance database if database name is omitted, resolving any
/// credentials that are only present in the operating system secret store.
/// @param config Connection parameters.
/// @return List of database names on the server.
#[tauri::command]
pub async fn cmd_list_databases(config: ConnectionConfig) -> Result<Vec<String>, AppError> {
    let mut resolved = config;
    crate::storage::secrets::apply_to_config(&mut resolved)?;
    let handle = DriverFactory::create(&resolved).await?;
    handle.driver.list_databases().await
}

/// @brief Stores connection credentials in the operating system secret store.
/// @details The frontend can write secrets but never reads them back; only the backend resolves
/// them while opening a connection. An empty payload removes any previously stored entry.
/// @param id Saved connection profile identifier.
/// @param db_password Database password, when one should be remembered.
/// @param ssh_password SSH bastion password, when one should be remembered.
/// @param ssh_passphrase SSH private key passphrase, when one should be remembered.
/// @return `Ok(true)` once the secret store has been updated.
#[tauri::command]
pub async fn cmd_save_connection_secrets(
    id: String,
    db_password: Option<String>,
    ssh_password: Option<String>,
    ssh_passphrase: Option<String>,
) -> Result<bool, AppError> {
    let secrets = crate::storage::ConnectionSecrets {
        db_password: normalize_secret(db_password),
        ssh_password: normalize_secret(ssh_password),
        ssh_passphrase: normalize_secret(ssh_passphrase),
    };
    crate::storage::secrets::save(&id, &secrets)?;
    Ok(true)
}

/// @brief Removes stored credentials for a connection profile.
/// @param id Saved connection profile identifier.
/// @return `Ok(true)` once the entry is gone.
#[tauri::command]
pub async fn cmd_delete_connection_secrets(id: String) -> Result<bool, AppError> {
    crate::storage::secrets::delete(&id)?;
    Ok(true)
}

/// @brief Reports whether credentials are stored for a connection profile.
/// @param id Saved connection profile identifier.
/// @return `true` when the secret store holds an entry for this profile.
#[tauri::command]
pub async fn cmd_has_connection_secrets(id: String) -> Result<bool, AppError> {
    Ok(crate::storage::secrets::exists(&id))
}

/// @brief Treats blank credential strings as absent values.
/// @param value Optional credential supplied by the UI.
/// @return `None` for `None` or an empty/whitespace-only string, otherwise the original value.
fn normalize_secret(value: Option<String>) -> Option<String> {
    value.filter(|v| !v.is_empty())
}

/// @brief Queries all accessible databases on the currently active database session.
/// @param state Tauri managed handle to shared AppState.
/// @return List of database names on the active server.
#[tauri::command]
pub async fn cmd_list_active_databases(
    state: State<'_, AppState>,
) -> Result<Vec<String>, AppError> {
    state.list_active_databases().await
}

/// @brief Switches the active database catalog on the current server connection.
/// @param database Target database catalog name to activate.
/// @param state Tauri managed handle to shared AppState.
/// @return Returns the newly introspected DatabaseSchema for the selected database.
#[tauri::command]
pub async fn cmd_switch_database(
    database: String,
    state: State<'_, AppState>,
) -> Result<DatabaseSchema, AppError> {
    let mut config = state
        .get_active_config()
        .await
        .ok_or_else(|| AppError::Connection("No active database connection".to_string()))?;
    config.database = database;
    state.connect(&config).await?;
    state.introspect_active().await
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
/// @return Ordered list of executable SQL DDL statements plus warnings for unsupported changes.
/// @throws AppError::Connection if no active database session is present to determine dialect.
#[tauri::command]
pub async fn cmd_generate_ddl(
    diff: SchemaDiff,
    state: State<'_, AppState>,
) -> Result<GeneratedDdl, AppError> {
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

/// @brief Resolves the primary key columns of a table on the active connection.
/// @details Used by the data grid to build a safe single-row locator instead of guessing one from
/// the result set, which could otherwise update unrelated rows.
/// @param table Table name, optionally schema qualified.
/// @param state Tauri managed handle to shared AppState.
/// @return Ordered primary key column names; empty when the table has no primary key.
#[tauri::command]
pub async fn cmd_get_primary_keys(
    table: String,
    state: State<'_, AppState>,
) -> Result<Vec<String>, AppError> {
    let lock = state.get_active_driver().await?;
    match lock.as_ref() {
        Some(driver) => driver.primary_key_columns(&table).await,
        None => Err(AppError::Connection(
            "No active database connection".to_string(),
        )),
    }
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

/// @brief Generates an execution plan tree for the provided SQL query against the active database.
/// @param sql SQL statement string to explain and analyze.
/// @param state Tauri managed handle to shared AppState.
/// @return ExecutionPlanNode representing root node of execution plan tree.
/// @throws AppError::Connection if no active database session exists.
/// @throws AppError::Query on SQL explain syntax or execution error.
#[tauri::command]
pub async fn cmd_explain_query(
    sql: String,
    state: State<'_, AppState>,
) -> Result<ExecutionPlanNode, AppError> {
    state.explain_query(&sql).await
}

/// @brief Records a query execution event into local persistent SQLite history.
/// @param query Executed SQL statement text.
/// @param duration_ms Wall-clock execution time in milliseconds.
/// @param rows_count Number of rows affected or returned.
/// @param status Status string ("success" or "error").
/// @param state Tauri managed handle to shared AppState.
/// @return Populated QueryHistoryRecord instance.
/// @throws AppError on SQLite persistence error.
#[tauri::command]
pub async fn cmd_record_query_history(
    query: String,
    duration_ms: u64,
    rows_count: u64,
    status: String,
    state: State<'_, AppState>,
) -> Result<QueryHistoryRecord, AppError> {
    state
        .record_query_history(&query, duration_ms, rows_count, &status)
        .await
}

/// @brief Retrieves the latest recorded query execution history records.
/// @param limit Maximum number of records to retrieve (defaults to 100).
/// @param state Tauri managed handle to shared AppState.
/// @return Vector of QueryHistoryRecord instances ordered latest first.
/// @throws AppError on SQLite query error.
#[tauri::command]
pub async fn cmd_get_query_history(
    limit: Option<usize>,
    state: State<'_, AppState>,
) -> Result<Vec<QueryHistoryRecord>, AppError> {
    let limit = limit.unwrap_or(100);
    state.get_query_history(limit).await
}

/// @brief Toggles favorite or bookmark status for a query history entry.
/// @param id Primary key ID of the history record.
/// @param state Tauri managed handle to shared AppState.
/// @return Updated boolean favorite status.
/// @throws AppError if record is not found or SQLite update fails.
#[tauri::command]
pub async fn cmd_toggle_favorite_query(
    id: i64,
    state: State<'_, AppState>,
) -> Result<bool, AppError> {
    state.toggle_favorite_query(id).await
}

/// @brief Clears non-favorite query history records from persistent storage.
/// @param state Tauri managed handle to shared AppState.
/// @return Unit `Ok(())` on successful deletion.
/// @throws AppError on SQLite delete error.
#[tauri::command]
pub async fn cmd_clear_query_history(state: State<'_, AppState>) -> Result<(), AppError> {
    state.clear_query_history().await
}
