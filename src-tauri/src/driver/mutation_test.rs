//! @file mutation_test.rs
//! @brief Integration tests for transactional row mutation execution across database drivers.
//! @details Validates single-row updates, multi-row batch mutations, transaction rollback
//! on column or constraint errors, and AppState end-to-end integration using SQLite in-memory databases.

use std::collections::HashMap;

use super::sqlite::SqliteDriver;
use super::{DatabaseDriver, RowUpdatePayload};
use crate::error::AppError;
use crate::model::connection::{ConnectionConfig, DatabaseType};
use crate::state::AppState;

/// @brief Helper function to construct an in-memory SQLite ConnectionConfig for testing.
/// @param id Unique identifier string for the connection.
/// @return Configured ConnectionConfig targeting an in-memory SQLite instance.
fn create_test_config(id: &str) -> ConnectionConfig {
    ConnectionConfig {
        id: id.to_string(),
        name: format!("Test Mutation SQLite ({})", id),
        db_type: DatabaseType::Sqlite,
        host: None,
        port: None,
        database: ":memory:".to_string(),
        username: None,
        password: None,
        file_path: Some(":memory:".to_string()),
        ssl: false,
        ssh_tunnel: None,
        connection_url: None,
        dialect_family: None,
    }
}

/// @brief Helper function to initialize and connect an in-memory SQLite driver instance.
/// @param id Unique connection identifier.
/// @return Connected SqliteDriver ready for test operations.
async fn create_test_driver(id: &str) -> SqliteDriver {
    let config = create_test_config(id);
    SqliteDriver::connect(&config)
        .await
        .expect("Failed to connect SQLite test driver")
}

/// @brief Tests updating a single row within an in-memory SQLite database.
/// @details Verifies that updated column values are written, untouched columns remain unchanged,
/// and the affected row count is exactly 1.
#[tokio::test]
async fn test_update_single_row_sqlite() {
    let driver = create_test_driver("single-row").await;

    driver
        .execute_ddl(&[
            concat!(
                "CREATE TABLE users (",
                "  id INTEGER PRIMARY KEY, ",
                "  name TEXT NOT NULL, ",
                "  age INTEGER, ",
                "  email TEXT",
                ");"
            )
            .to_string(),
            "INSERT INTO users (id, name, age, email) VALUES (1, 'Alice', 25, 'alice@example.com');"
                .to_string(),
            "INSERT INTO users (id, name, age, email) VALUES (2, 'Bob', 30, 'bob@example.com');"
                .to_string(),
        ])
        .await
        .expect("Setup users table failed");

    let mut pk = HashMap::new();
    pk.insert("id".to_string(), serde_json::json!(1));

    let mut updates = HashMap::new();
    updates.insert("name".to_string(), serde_json::json!("Alice Cooper"));
    updates.insert("age".to_string(), serde_json::json!(26));

    let payload = RowUpdatePayload::new("users", pk, updates);

    let affected = driver
        .update_rows(vec![payload])
        .await
        .expect("update_rows should succeed");

    assert_eq!(affected, 1, "Expected exactly 1 affected row");

    // Verify row 1 updated
    let query_res = driver
        .execute_query("SELECT name, age, email FROM users WHERE id = 1;")
        .await
        .expect("Query failed");
    assert_eq!(query_res.rows.len(), 1);
    assert_eq!(
        query_res.rows[0][0],
        serde_json::Value::String("Alice Cooper".to_string())
    );
    assert_eq!(
        query_res.rows[0][1],
        serde_json::Value::String("26".to_string())
    );
    assert_eq!(
        query_res.rows[0][2],
        serde_json::Value::String("alice@example.com".to_string())
    );

    // Verify row 2 untouched
    let query_res2 = driver
        .execute_query("SELECT name, age FROM users WHERE id = 2;")
        .await
        .expect("Query failed");
    assert_eq!(query_res2.rows.len(), 1);
    assert_eq!(
        query_res2.rows[0][0],
        serde_json::Value::String("Bob".to_string())
    );
    assert_eq!(
        query_res2.rows[0][1],
        serde_json::Value::String("30".to_string())
    );
}

/// @brief Tests updating multiple rows in a single transactional batch.
/// @details Verifies that all mutations in the batch are applied and the returned
/// affected row count equals the total rows modified.
#[tokio::test]
async fn test_update_multiple_rows_sqlite() {
    let driver = create_test_driver("multi-row").await;

    driver
        .execute_ddl(&[
            concat!(
                "CREATE TABLE items (",
                "  id INTEGER PRIMARY KEY, ",
                "  name TEXT NOT NULL, ",
                "  price REAL NOT NULL",
                ");"
            )
            .to_string(),
            "INSERT INTO items (id, name, price) VALUES (1, 'Widget', 9.99);".to_string(),
            "INSERT INTO items (id, name, price) VALUES (2, 'Gadget', 19.99);".to_string(),
            "INSERT INTO items (id, name, price) VALUES (3, 'Doohickey', 29.99);".to_string(),
        ])
        .await
        .expect("Setup items table failed");

    let mut pk1 = HashMap::new();
    pk1.insert("id".to_string(), serde_json::json!(1));
    let mut up1 = HashMap::new();
    up1.insert("price".to_string(), serde_json::json!(12.49));

    let mut pk2 = HashMap::new();
    pk2.insert("id".to_string(), serde_json::json!(2));
    let mut up2 = HashMap::new();
    up2.insert("name".to_string(), serde_json::json!("Super Gadget"));
    up2.insert("price".to_string(), serde_json::json!(24.99));

    let batch = vec![
        RowUpdatePayload::new("items", pk1, up1),
        RowUpdatePayload::new("items", pk2, up2),
    ];

    let affected = driver
        .update_rows(batch)
        .await
        .expect("update_rows batch should succeed");

    assert_eq!(affected, 2, "Expected 2 affected rows");

    // Verify row 1
    let r1 = driver
        .execute_query("SELECT price FROM items WHERE id = 1;")
        .await
        .expect("Query failed");
    assert_eq!(
        r1.rows[0][0],
        serde_json::Value::String("12.49".to_string())
    );

    // Verify row 2
    let r2 = driver
        .execute_query("SELECT name, price FROM items WHERE id = 2;")
        .await
        .expect("Query failed");
    assert_eq!(
        r2.rows[0][0],
        serde_json::Value::String("Super Gadget".to_string())
    );
    assert_eq!(
        r2.rows[0][1],
        serde_json::Value::String("24.99".to_string())
    );
}

/// @brief Tests transactional rollback when an invalid column is referenced in an update batch.
/// @details Verifies that if any statement in the batch fails, the entire transaction is rolled back
/// and prior mutations within the same batch are discarded.
#[tokio::test]
async fn test_update_rows_rollback_on_invalid_column() {
    let driver = create_test_driver("rollback-col").await;

    driver
        .execute_ddl(&[
            concat!(
                "CREATE TABLE products (",
                "  id INTEGER PRIMARY KEY, ",
                "  name TEXT NOT NULL, ",
                "  price REAL NOT NULL",
                ");"
            )
            .to_string(),
            "INSERT INTO products (id, name, price) VALUES (1, 'Book', 15.5);".to_string(),
            "INSERT INTO products (id, name, price) VALUES (2, 'Pen', 2.0);".to_string(),
        ])
        .await
        .expect("Setup products table failed");

    // Update 1: Valid change on row 1
    let mut pk1 = HashMap::new();
    pk1.insert("id".to_string(), serde_json::json!(1));
    let mut up1 = HashMap::new();
    up1.insert("price".to_string(), serde_json::json!(99.99));

    // Update 2: Invalid column name on row 2
    let mut pk2 = HashMap::new();
    pk2.insert("id".to_string(), serde_json::json!(2));
    let mut up2 = HashMap::new();
    up2.insert(
        "nonexistent_column".to_string(),
        serde_json::json!("invalid_val"),
    );

    let batch = vec![
        RowUpdatePayload::new("products", pk1, up1),
        RowUpdatePayload::new("products", pk2, up2),
    ];

    let result = driver.update_rows(batch).await;
    assert!(
        result.is_err(),
        "Expected batch update to fail on invalid column"
    );

    // CRITICAL: Verify transaction rollback - row 1 must still have original price 15.5
    let r1 = driver
        .execute_query("SELECT price FROM products WHERE id = 1;")
        .await
        .expect("Query failed");
    assert_eq!(
        r1.rows[0][0],
        serde_json::Value::String("15.5".to_string()),
        "Row 1 should not have been updated due to transaction rollback"
    );
}

/// @brief Tests transactional rollback when a table constraint is violated.
/// @details Verifies that check constraint failures trigger a full transaction rollback.
#[tokio::test]
async fn test_update_rows_rollback_on_constraint_violation() {
    let driver = create_test_driver("rollback-constraint").await;

    driver
        .execute_ddl(&[
            concat!(
                "CREATE TABLE accounts (",
                "  id INTEGER PRIMARY KEY, ",
                "  username TEXT NOT NULL UNIQUE, ",
                "  balance INTEGER CHECK(balance >= 0)",
                ");"
            )
            .to_string(),
            "INSERT INTO accounts (id, username, balance) VALUES (1, 'user1', 100);".to_string(),
            "INSERT INTO accounts (id, username, balance) VALUES (2, 'user2', 200);".to_string(),
        ])
        .await
        .expect("Setup accounts table failed");

    // Update 1: Valid balance change on user 1
    let mut pk1 = HashMap::new();
    pk1.insert("id".to_string(), serde_json::json!(1));
    let mut up1 = HashMap::new();
    up1.insert("balance".to_string(), serde_json::json!(150));

    // Update 2: Violates CHECK(balance >= 0) on user 2
    let mut pk2 = HashMap::new();
    pk2.insert("id".to_string(), serde_json::json!(2));
    let mut up2 = HashMap::new();
    up2.insert("balance".to_string(), serde_json::json!(-50));

    let batch = vec![
        RowUpdatePayload::new("accounts", pk1, up1),
        RowUpdatePayload::new("accounts", pk2, up2),
    ];

    let result = driver.update_rows(batch).await;
    assert!(result.is_err(), "Expected constraint violation error");

    // Verify row 1 rolled back
    let r1 = driver
        .execute_query("SELECT balance FROM accounts WHERE id = 1;")
        .await
        .expect("Query failed");
    assert_eq!(
        r1.rows[0][0],
        serde_json::Value::String("100".to_string()),
        "Row 1 balance must remain 100 due to rollback"
    );
}

/// @brief Tests row update behavior when targeting a non-existent primary key.
/// @details Verifies that updating a non-existent row yields 0 affected rows without error.
#[tokio::test]
async fn test_update_rows_zero_affected_when_pk_not_found() {
    let driver = create_test_driver("not-found").await;

    driver
        .execute_ddl(&[
            "CREATE TABLE notes (id INTEGER PRIMARY KEY, content TEXT);".to_string(),
            "INSERT INTO notes (id, content) VALUES (1, 'Existing note');".to_string(),
        ])
        .await
        .expect("Setup notes table failed");

    let mut pk = HashMap::new();
    pk.insert("id".to_string(), serde_json::json!(999));

    let mut up = HashMap::new();
    up.insert("content".to_string(), serde_json::json!("Ghost note"));

    let payload = RowUpdatePayload::new("notes", pk, up);

    let affected = driver
        .update_rows(vec![payload])
        .await
        .expect("update_rows on missing PK should succeed with 0 affected");

    assert_eq!(affected, 0, "Expected 0 affected rows");

    // Verify existing row untouched
    let r = driver
        .execute_query("SELECT content FROM notes WHERE id = 1;")
        .await
        .expect("Query failed");
    assert_eq!(
        r.rows[0][0],
        serde_json::Value::String("Existing note".to_string())
    );
}

/// @brief Tests updating with an empty payload list.
/// @details Verifies that passing an empty vector returns 0 affected rows.
#[tokio::test]
async fn test_update_rows_empty_payload() {
    let driver = create_test_driver("empty-payload").await;

    let affected = driver
        .update_rows(vec![])
        .await
        .expect("Empty updates should succeed");

    assert_eq!(affected, 0);
}

/// @brief Tests end-to-end row mutation through AppState.
/// @details Verifies that `AppState::update_rows` properly delegates to the active driver
/// and returns the correct affected rows count.
#[tokio::test]
async fn test_update_rows_via_app_state() {
    let state = AppState::default();
    let config = create_test_config("app-state-test");

    // Unconnected state returns AppError::Connection
    let unconn_res = state.update_rows(vec![]).await;
    assert!(unconn_res.is_err());
    match unconn_res {
        Err(AppError::Connection(msg)) => {
            assert!(msg.contains("No active database connection"));
        }
        _ => panic!("Expected Connection error variant"),
    }

    state.connect(&config).await.expect("Failed to connect");

    // Setup table via state
    state
        .execute_migration(&[
            "CREATE TABLE customers (id INTEGER PRIMARY KEY, name TEXT);".to_string(),
            "INSERT INTO customers (id, name) VALUES (1, 'Old Customer');".to_string(),
        ])
        .await
        .expect("Migration failed");

    let mut pk = HashMap::new();
    pk.insert("id".to_string(), serde_json::json!(1));
    let mut up = HashMap::new();
    up.insert("name".to_string(), serde_json::json!("New Customer"));

    let affected = state
        .update_rows(vec![RowUpdatePayload::new("customers", pk, up)])
        .await
        .expect("AppState update_rows failed");

    assert_eq!(affected, 1);

    let res = state
        .execute_query("SELECT name FROM customers WHERE id = 1;")
        .await
        .expect("Query failed");
    assert_eq!(
        res.rows[0][0],
        serde_json::Value::String("New Customer".to_string())
    );
}
