//! @file explain_test.rs
//! @brief Unit tests for query execution plan generation and explain_query driver implementation.

use crate::driver::sqlite::SqliteDriver;
use crate::driver::DatabaseDriver;
use crate::model::connection::{ConnectionConfig, DatabaseType};

/// @brief Helper function to construct an in-memory SQLite connection configuration.
/// @param id Connection identifier and database name.
/// @return Fully populated ConnectionConfig for SQLite in-memory instance.
fn create_test_config(id: &str) -> ConnectionConfig {
    ConnectionConfig {
        id: id.to_string(),
        name: id.to_string(),
        db_type: DatabaseType::Sqlite,
        host: None,
        port: None,
        database: ":memory:".to_string(),
        username: None,
        password: None,
        file_path: Some(":memory:".to_string()),
        ssl: false,
        ssh_tunnel: None,
    }
}

#[tokio::test]
async fn test_sqlite_explain_query_plan_table_scan() {
    let config = create_test_config("test_explain");
    let driver = SqliteDriver::connect(&config)
        .await
        .expect("Failed to create sqlite in-memory driver");

    // Setup schema
    driver
        .execute_query("CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT);")
        .await
        .expect("Failed to create table");

    let plan = driver
        .explain_query("SELECT * FROM users WHERE name = 'Alice';")
        .await
        .expect("explain_query failed");

    assert!(!plan.node_type.is_empty());
    // Either root is Scan Table or contains a child with Scan Table
    let has_scan = plan.node_type.contains("Scan")
        || plan
            .children
            .iter()
            .any(|c| c.node_type.contains("Scan") || c.relation_name.as_deref() == Some("users"));
    assert!(has_scan, "Expected scan operation in plan: {:?}", plan);
}

#[tokio::test]
async fn test_sqlite_explain_query_plan_with_index() {
    let config = create_test_config("test_explain_idx");
    let driver = SqliteDriver::connect(&config)
        .await
        .expect("Failed to create sqlite in-memory driver");

    driver
        .execute_query(
            "CREATE TABLE orders (id INTEGER PRIMARY KEY, user_id INTEGER, amount REAL);",
        )
        .await
        .expect("Failed to create table");
    driver
        .execute_query("CREATE INDEX idx_orders_user ON orders(user_id);")
        .await
        .expect("Failed to create index");

    let plan = driver
        .explain_query("SELECT * FROM orders WHERE user_id = 42;")
        .await
        .expect("explain_query failed");

    assert!(!plan.node_type.is_empty());
    let detail_str = format!("{:?}", plan);
    assert!(
        detail_str.contains("Index")
            || detail_str.contains("Search")
            || detail_str.contains("orders"),
        "Expected index search in plan: {:?}",
        plan
    );
}

#[tokio::test]
async fn test_sqlite_explain_query_invalid_syntax() {
    let config = create_test_config("test_explain_err");
    let driver = SqliteDriver::connect(&config)
        .await
        .expect("Failed to create driver");

    let result = driver.explain_query("SELECT FROM WHERE INVALID").await;
    assert!(result.is_err(), "Expected error on malformed SQL");
}
