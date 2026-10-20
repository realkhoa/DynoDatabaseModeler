//! @file sqlite_test.rs
//! @brief Integration and unit tests for SQLite database driver adapter.
//! @details Validates connection establishment, DDL execution, transaction rollback,
//! metadata schema introspection, and canonical type mapping using in-memory SQLite.

use super::sqlite::{parse_referential_action, parse_sqlite_type, SqliteDriver};
use super::DatabaseDriver;
use crate::diff::compute_schema_diff;
use crate::diff::ddl::generate_ddl;
use crate::error::AppError;
use crate::model::connection::{ConnectionConfig, DatabaseType};
use crate::model::schema::{CanonicalType, DatabaseSchema, ReferentialAction};

/// @brief Helper function to construct an in-memory SQLite connection configuration.
/// @return Returns a fully populated ConnectionConfig for an in-memory database.
fn create_in_memory_config() -> ConnectionConfig {
    ConnectionConfig {
        id: "test-sqlite-in-memory".to_string(),
        name: "Test In-Memory SQLite".to_string(),
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

/// @brief Helper function to construct and connect an in-memory SQLite driver.
/// @return Returns an initialized SqliteDriver instance.
async fn create_test_driver() -> SqliteDriver {
    let config = create_in_memory_config();
    SqliteDriver::connect(&config)
        .await
        .expect("Failed to connect SQLite")
}

/// @brief Asserts expected column definitions for the introspected users table.
/// @param schema Database schema reference to assert against.
fn assert_users_table(schema: &DatabaseSchema) {
    let users_table = schema
        .tables
        .iter()
        .find(|t| t.name == "users")
        .expect("users table should exist");
    assert_eq!(users_table.columns.len(), 2);

    let user_id_col = users_table
        .columns
        .iter()
        .find(|c| c.name == "id")
        .expect("users.id column should exist");
    assert!(user_id_col.is_primary_key);
    assert!(user_id_col.is_auto_increment);
    assert_eq!(user_id_col.data_type, CanonicalType::Integer);

    let user_name_col = users_table
        .columns
        .iter()
        .find(|c| c.name == "name")
        .expect("users.name column should exist");
    assert!(!user_name_col.is_nullable);
    assert_eq!(user_name_col.data_type, CanonicalType::Text);
}

/// @brief Asserts expected foreign key relations for the introspected posts table.
/// @param schema Database schema reference to assert against.
fn assert_posts_table(schema: &DatabaseSchema) {
    let posts_table = schema
        .tables
        .iter()
        .find(|t| t.name == "posts")
        .expect("posts table should exist");
    assert_eq!(posts_table.foreign_keys.len(), 1);

    let fk = &posts_table.foreign_keys[0];
    assert_eq!(fk.target_table, "users");
    assert_eq!(fk.source_column, "user_id");
    assert_eq!(fk.target_column, "id");
}

/// @brief Integration test for SQLite table, column, and foreign key schema introspection.
/// @details Verifies that SqliteDriver connects, executes table creation DDL,
/// and correctly introspects primary keys, auto-increment flags, column nullability,
/// and foreign key relationships.
#[tokio::test]
async fn test_sqlite_driver_introspection() {
    let driver = create_test_driver().await;

    let create_sql = vec![
        "CREATE TABLE users (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL);"
            .to_string(),
        concat!(
            "CREATE TABLE posts (id INTEGER PRIMARY KEY, user_id INTEGER, title TEXT, ",
            "FOREIGN KEY(user_id) REFERENCES users(id));"
        )
        .to_string(),
    ];

    driver
        .execute_ddl(&create_sql)
        .await
        .expect("Failed to create tables");

    let schema = driver
        .introspect_schema()
        .await
        .expect("Failed to introspect schema");

    assert_eq!(schema.tables.len(), 2);
    assert_users_table(&schema);
    assert_posts_table(&schema);
}

/// @brief Tests connection verification against SQLite.
/// @details Ensures test_connection returns Ok(()) when connection is healthy.
#[tokio::test]
async fn test_sqlite_driver_test_connection() {
    let driver = create_test_driver().await;

    let result = driver.test_connection().await;
    assert!(result.is_ok());
    assert_eq!(driver.db_type(), DatabaseType::Sqlite);
}

/// @brief Tests arbitrary SQL query execution and JSON value serialization.
/// @details Verifies query execution returns column headers, row counts, and serialized string values.
#[tokio::test]
async fn test_sqlite_driver_execute_query() {
    let driver = create_test_driver().await;

    driver
        .execute_ddl(&[
            "CREATE TABLE products (id INTEGER PRIMARY KEY, name TEXT, price REAL);".to_string(),
            "INSERT INTO products (id, name, price) VALUES (1, 'Widget', 19.99);".to_string(),
        ])
        .await
        .expect("Failed to setup product table");

    let result = driver
        .execute_query("SELECT id, name, price FROM products WHERE id = 1")
        .await
        .expect("Query should succeed");

    assert_eq!(result.columns, vec!["id", "name", "price"]);
    assert_eq!(result.rows.len(), 1);
    assert_eq!(
        result.rows[0][0],
        serde_json::Value::String("1".to_string())
    );
    assert_eq!(
        result.rows[0][1],
        serde_json::Value::String("Widget".to_string())
    );
    assert_eq!(
        result.rows[0][2],
        serde_json::Value::String("19.99".to_string())
    );
}

/// @brief Tests transactional DDL execution rollback on failure.
/// @details Verifies that when a batch contains a bad SQL statement, all prior statements are rolled back.
#[tokio::test]
async fn test_sqlite_driver_execute_ddl_rollback() {
    let driver = create_test_driver().await;

    let result = driver
        .execute_ddl(&[
            "CREATE TABLE rollback_test (id INTEGER PRIMARY KEY);".to_string(),
            "THIS IS NOT VALID SQL STATEMENT;".to_string(),
        ])
        .await;

    assert!(result.is_err());
    match result {
        Err(AppError::Migration(msg)) => {
            assert!(msg.contains("Failed on statement"));
        }
        _ => panic!("Expected Migration error variant"),
    }

    // Verify rollback: rollback_test table should not exist
    let schema = driver
        .introspect_schema()
        .await
        .expect("Schema introspection should succeed");
    assert!(!schema.tables.iter().any(|t| t.name == "rollback_test"));
}

/// @brief Unit test verifying parsing of SQLite column type names into CanonicalType.
#[test]
fn test_sqlite_type_mapping() {
    assert_eq!(parse_sqlite_type("INTEGER"), CanonicalType::Integer);
    assert_eq!(parse_sqlite_type("INT"), CanonicalType::Integer);
    assert_eq!(parse_sqlite_type("VARCHAR(255)"), CanonicalType::Text);
    assert_eq!(parse_sqlite_type("TEXT"), CanonicalType::Text);
    assert_eq!(parse_sqlite_type("BLOB"), CanonicalType::Binary);
    assert_eq!(parse_sqlite_type("REAL"), CanonicalType::Double);
    assert_eq!(parse_sqlite_type("FLOAT"), CanonicalType::Double);
    assert_eq!(parse_sqlite_type("DOUBLE"), CanonicalType::Double);
    assert_eq!(parse_sqlite_type("BOOLEAN"), CanonicalType::Boolean);
    assert_eq!(
        parse_sqlite_type("DATETIME"),
        CanonicalType::Custom("DATETIME".to_string())
    );
}

/// @brief Unit test verifying foreign key referential action string parsing.
#[test]
fn test_sqlite_referential_action_mapping() {
    assert_eq!(
        parse_referential_action("CASCADE"),
        ReferentialAction::Cascade
    );
    assert_eq!(
        parse_referential_action("SET NULL"),
        ReferentialAction::SetNull
    );
    assert_eq!(
        parse_referential_action("RESTRICT"),
        ReferentialAction::Restrict
    );
    assert_eq!(
        parse_referential_action("SET DEFAULT"),
        ReferentialAction::SetDefault
    );
    assert_eq!(
        parse_referential_action("NO ACTION"),
        ReferentialAction::NoAction
    );
    assert_eq!(
        parse_referential_action("UNKNOWN"),
        ReferentialAction::NoAction
    );
}

/// @brief Verifies that a generated SQLite rebuild applies and preserves the table's data.
/// @details SQLite cannot change column nullability in place, so the diff schedules a shadow-table
/// rebuild. This test drives the full path: introspect, diff, generate, execute, re-introspect.
#[tokio::test]
async fn test_sqlite_rebuild_applies_and_preserves_data() {
    let driver = create_test_driver().await;

    driver
        .execute_ddl(&[
            "CREATE TABLE users (id INTEGER PRIMARY KEY, nickname TEXT, email TEXT NOT NULL);"
                .to_string(),
            "CREATE INDEX idx_users_email ON users(email);".to_string(),
            "INSERT INTO users (id, nickname, email) VALUES (1, 'ada', 'ada@example.com');"
                .to_string(),
            "INSERT INTO users (id, nickname, email) VALUES (2, NULL, 'bob@example.com');"
                .to_string(),
        ])
        .await
        .expect("setup users table");

    let current = driver.introspect_schema().await.expect("introspect");
    let live_users = current
        .tables
        .iter()
        .find(|t| t.name == "users")
        .expect("users table");
    assert!(
        live_users
            .indexes
            .iter()
            .any(|i| i.name == "idx_users_email"),
        "secondary indexes must be introspected"
    );

    // Desired schema: nickname becomes NOT NULL (not expressible with in-place SQLite DDL).
    let mut desired = current.clone();
    let users = desired
        .tables
        .iter_mut()
        .find(|t| t.name == "users")
        .expect("users table");
    let nickname = users
        .columns
        .iter_mut()
        .find(|c| c.name == "nickname")
        .expect("nickname column");
    nickname.is_nullable = false;

    let diff = compute_schema_diff(&current, &desired);
    assert_eq!(diff.tables_to_rebuild.len(), 1);

    let generated = generate_ddl(&diff, DatabaseType::Sqlite);
    // The rebuild is announced, but nothing may be refused for a plain table.
    assert!(
        generated.warnings.iter().any(|w| w.contains("rebuilt")),
        "rebuild must be announced: {:?}",
        generated.warnings
    );
    assert!(
        !generated
            .warnings
            .iter()
            .any(|w| w.contains("not generated") || w.contains("No SQL was generated")),
        "plain table rebuild must not be refused: {:?}",
        generated.warnings
    );
    assert!(generated
        .statements
        .iter()
        .any(|s| s.contains("__dyno_rebuild")));

    // Fill the NULL before tightening the constraint, then run the generated rebuild.
    driver
        .execute_ddl(&["UPDATE users SET nickname = 'unknown' WHERE nickname IS NULL;".to_string()])
        .await
        .expect("backfill nulls");

    let report = driver
        .execute_ddl(&generated.statements)
        .await
        .expect("generated rebuild must apply");
    assert!(report.success);

    let after = driver.introspect_schema().await.expect("re-introspect");
    let users_after = after
        .tables
        .iter()
        .find(|t| t.name == "users")
        .expect("users table after rebuild");

    let nickname_after = users_after
        .columns
        .iter()
        .find(|c| c.name == "nickname")
        .expect("nickname column after rebuild");
    assert!(!nickname_after.is_nullable, "nullability change must apply");
    assert!(
        users_after
            .indexes
            .iter()
            .any(|i| i.name == "idx_users_email"),
        "indexes must survive the rebuild"
    );

    let rows = driver
        .execute_query("SELECT id, nickname, email FROM users ORDER BY id;")
        .await
        .expect("query rebuilt table");
    assert_eq!(
        rows.rows.len(),
        2,
        "rows must be copied into the rebuilt table"
    );
    assert_eq!(
        rows.rows[0][2],
        serde_json::Value::String("ada@example.com".to_string())
    );

    // The shadow table must not be left behind.
    let leftovers = driver
        .execute_query(
            "SELECT name FROM sqlite_master WHERE type='table' AND name LIKE '%__dyno_rebuild%';",
        )
        .await
        .expect("query leftover tables");
    assert!(
        leftovers.rows.is_empty(),
        "shadow table must be renamed away"
    );
}
