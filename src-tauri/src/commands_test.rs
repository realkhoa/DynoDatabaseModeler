//! @file commands_test.rs
//! @brief Integration tests for AppState and Tauri IPC backend commands.
//! @details Validates thread-safe connection state lifecycle, schema introspection,
//! DDL migration generation, SQL query execution, and error handling for disconnected states.

use crate::commands::{cmd_compute_diff, cmd_test_connection};
use crate::diff::model::SchemaDiff;
use crate::error::AppError;
use crate::model::connection::{ConnectionConfig, DatabaseType};
use crate::model::schema::{CanonicalType, ColumnSchema, DatabaseSchema, TableSchema};
use crate::state::AppState;

/// @brief Helper to generate an in-memory SQLite ConnectionConfig for testing.
/// @param id Unique identifier string for the connection.
/// @return Configured ConnectionConfig targeting an in-memory SQLite instance.
fn make_sqlite_config(id: &str) -> ConnectionConfig {
    ConnectionConfig {
        id: id.to_string(),
        name: format!("Test State SQLite ({})", id),
        db_type: DatabaseType::Sqlite,
        host: None,
        port: None,
        database: ":memory:".to_string(),
        username: None,
        password: None,
        file_path: Some(":memory:".to_string()),
        ssl: false,
    }
}

/// @brief Tests the end-to-end AppState connection and schema introspection workflow using SQLite.
#[tokio::test]
async fn test_app_state_sqlite_workflow() {
    let state = AppState::default();
    let config = make_sqlite_config("workflow-test");

    // Initially no config or driver
    assert!(state.get_active_config().await.is_none());

    // Connect to in-memory SQLite
    state
        .connect(&config)
        .await
        .expect("Failed to connect in AppState");

    // Verify config is stored
    let active_cfg = state.get_active_config().await;
    assert!(active_cfg.is_some());
    assert_eq!(active_cfg.unwrap().id, "workflow-test");

    // Introspect active database schema
    let schema = state
        .introspect_active()
        .await
        .expect("Failed to introspect active database");
    assert_eq!(schema.tables.len(), 0);
}

/// @brief Tests DDL migration execution and subsequent SQL querying through AppState.
#[tokio::test]
async fn test_app_state_migration_and_query_execution() {
    let state = AppState::default();
    let config = make_sqlite_config("query-test");
    state.connect(&config).await.expect("Failed to connect");

    // Execute DDL migration statements to create table and insert row
    let migration_stmts = vec![
        "CREATE TABLE items (id INTEGER PRIMARY KEY, title TEXT NOT NULL);".to_string(),
        "INSERT INTO items (id, title) VALUES (1, 'First Item');".to_string(),
        "INSERT INTO items (id, title) VALUES (2, 'Second Item');".to_string(),
    ];

    let report = state
        .execute_migration(&migration_stmts)
        .await
        .expect("Failed to execute migration");
    assert!(report.success);
    assert_eq!(report.statements_executed, 3);
    assert!(report.error_message.is_none());

    // Query the created table
    let query_result = state
        .execute_query("SELECT id, title FROM items ORDER BY id ASC;")
        .await
        .expect("Failed to execute query");

    assert_eq!(query_result.columns, vec!["id", "title"]);
    assert_eq!(query_result.rows.len(), 2);
    assert_eq!(
        query_result.rows[0][1],
        serde_json::Value::String("First Item".to_string())
    );
    assert_eq!(
        query_result.rows[1][1],
        serde_json::Value::String("Second Item".to_string())
    );

    // Introspect schema and verify table exists
    let schema = state
        .introspect_active()
        .await
        .expect("Failed to introspect");
    assert_eq!(schema.tables.len(), 1);
    assert_eq!(schema.tables[0].name, "items");
    assert_eq!(schema.tables[0].columns.len(), 2);
}

/// @brief Tests that operations on an unconnected AppState return appropriate AppError::Connection.
#[tokio::test]
async fn test_app_state_unconnected_returns_error() {
    let state = AppState::default();

    // Introspect should fail
    let introspect_res = state.introspect_active().await;
    match introspect_res {
        Err(AppError::Connection(msg)) => {
            assert!(msg.contains("No active database connection"));
        }
        _ => panic!("Expected AppError::Connection"),
    }

    // Execute migration should fail
    let mig_res = state
        .execute_migration(&["CREATE TABLE t (id INT);".to_string()])
        .await;
    match mig_res {
        Err(AppError::Connection(msg)) => {
            assert!(msg.contains("No active database connection"));
        }
        _ => panic!("Expected AppError::Connection"),
    }

    // Execute query should fail
    let query_res = state.execute_query("SELECT 1;").await;
    match query_res {
        Err(AppError::Connection(msg)) => {
            assert!(msg.contains("No active database connection"));
        }
        _ => panic!("Expected AppError::Connection"),
    }

    // Generate DDL without active config should fail
    let ddl_res = state.generate_ddl(&SchemaDiff::default()).await;
    match ddl_res {
        Err(AppError::Connection(msg)) => {
            assert!(msg.contains("No active database connection"));
        }
        _ => panic!("Expected AppError::Connection"),
    }
}

/// @brief Tests switching active connection and explicit disconnect on AppState.
#[tokio::test]
async fn test_app_state_switch_connection_and_disconnect() {
    let state = AppState::default();
    let config1 = make_sqlite_config("db-1");
    let config2 = make_sqlite_config("db-2");

    state.connect(&config1).await.expect("Failed to connect 1");
    assert_eq!(
        state.get_active_config().await.map(|c| c.id),
        Some("db-1".to_string())
    );

    state.connect(&config2).await.expect("Failed to connect 2");
    assert_eq!(
        state.get_active_config().await.map(|c| c.id),
        Some("db-2".to_string())
    );

    state.disconnect().await;
    assert!(state.get_active_config().await.is_none());
    assert!(state.introspect_active().await.is_err());
}

/// @brief Tests DDL generation using the active connection's database dialect.
#[tokio::test]
async fn test_app_state_generate_ddl_with_active_dialect() {
    let state = AppState::default();
    let config = make_sqlite_config("ddl-test");
    state.connect(&config).await.expect("Failed to connect");

    let mut diff = SchemaDiff::default();
    diff.tables_to_create.push(TableSchema {
        name: "products".to_string(),
        schema: None,
        columns: vec![ColumnSchema {
            name: "id".to_string(),
            data_type: CanonicalType::Integer,
            is_primary_key: true,
            is_nullable: false,
            is_auto_increment: true,
            default_value: None,
        }],
        foreign_keys: vec![],
        indexes: vec![],
        ui_position: None,
    });

    let ddl_stmts = state
        .generate_ddl(&diff)
        .await
        .expect("Failed to generate DDL");
    assert_eq!(ddl_stmts.len(), 1);
    assert!(ddl_stmts[0].contains("CREATE TABLE \"products\""));
}

/// @brief Tests cmd_test_connection with a valid SQLite configuration.
#[tokio::test]
async fn test_cmd_test_connection_sqlite() {
    let config = make_sqlite_config("cmd-test-conn");
    let result = cmd_test_connection(config).await;
    assert!(result.is_ok());
    assert!(result.unwrap());
}

/// @brief Tests cmd_test_connection failure with an unreachable host.
#[tokio::test]
async fn test_cmd_test_connection_unreachable() {
    let config = ConnectionConfig {
        id: "unreachable-pg".to_string(),
        name: "Unreachable Postgres".to_string(),
        db_type: DatabaseType::Postgres,
        host: Some("127.0.0.1".to_string()),
        port: Some(54329),
        database: "nonexistent".to_string(),
        username: Some("user".to_string()),
        password: Some("pass".to_string()),
        file_path: None,
        ssl: false,
    };

    let result = cmd_test_connection(config).await;
    assert!(result.is_err());
}

/// @brief Tests cmd_compute_diff calculating differences between two schemas.
#[tokio::test]
async fn test_cmd_compute_diff() {
    let current = DatabaseSchema {
        database_name: "test_db".to_string(),
        tables: vec![],
    };

    let desired = DatabaseSchema {
        database_name: "test_db".to_string(),
        tables: vec![TableSchema {
            name: "users".to_string(),
            schema: None,
            columns: vec![ColumnSchema {
                name: "id".to_string(),
                data_type: CanonicalType::Integer,
                is_primary_key: true,
                is_nullable: false,
                is_auto_increment: true,
                default_value: None,
            }],
            foreign_keys: vec![],
            indexes: vec![],
            ui_position: None,
        }],
    };

    let diff = cmd_compute_diff(current, desired)
        .await
        .expect("Failed to compute diff");
    assert_eq!(diff.tables_to_create.len(), 1);
    assert_eq!(diff.tables_to_create[0].name, "users");
}
