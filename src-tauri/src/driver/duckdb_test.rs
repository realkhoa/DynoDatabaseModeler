//! @file duckdb_test.rs
//! @brief Unit tests for DuckDbDriver in-memory analytical database operations.

use super::duckdb::{parse_duckdb_type, DuckDbDriver};
use super::DatabaseDriver;
use crate::driver::RowUpdatePayload;
use crate::model::connection::{ConnectionConfig, DatabaseType};
use crate::model::schema::CanonicalType;
use serde_json::json;

fn create_test_config() -> ConnectionConfig {
    ConnectionConfig {
        id: "test-duckdb".to_string(),
        name: "Test DuckDB In-Memory".to_string(),
        db_type: DatabaseType::DuckDb,
        host: None,
        port: None,
        database: "memory".to_string(),
        username: None,
        password: None,
        file_path: Some(":memory:".to_string()),
        ssl: false,
        ssh_tunnel: None,
        connection_url: None,
        dialect_family: None,
    }
}

#[tokio::test]
async fn test_duckdb_type_mapping() {
    assert_eq!(parse_duckdb_type("INTEGER"), CanonicalType::Integer);
    assert_eq!(parse_duckdb_type("BIGINT"), CanonicalType::BigInt);
    assert_eq!(parse_duckdb_type("SMALLINT"), CanonicalType::SmallInt);
    assert_eq!(parse_duckdb_type("FLOAT"), CanonicalType::Float);
    assert_eq!(parse_duckdb_type("DOUBLE"), CanonicalType::Double);
    assert_eq!(parse_duckdb_type("BOOLEAN"), CanonicalType::Boolean);
    assert_eq!(parse_duckdb_type("VARCHAR"), CanonicalType::Text);
    assert_eq!(parse_duckdb_type("DATE"), CanonicalType::Date);
    assert_eq!(parse_duckdb_type("TIMESTAMP"), CanonicalType::Timestamp);
    assert_eq!(parse_duckdb_type("UUID"), CanonicalType::Uuid);
}

#[tokio::test]
async fn test_duckdb_in_memory_workflow() {
    let config = create_test_config();
    let driver = DuckDbDriver::connect(&config)
        .await
        .expect("Connect to DuckDB");

    // Test connection
    driver.test_connection().await.expect("Test connection");

    // Execute DDL
    let ddl = vec![
        "CREATE TABLE analytics (id INTEGER, metric VARCHAR, score DOUBLE, PRIMARY KEY (id))"
            .to_string(),
    ];
    let report = driver.execute_ddl(&ddl).await.expect("Execute DDL");
    assert!(report.success);
    assert_eq!(report.statements_executed, 1);

    // Introspect schema
    let schema = driver.introspect_schema().await.expect("Introspect");
    assert_eq!(schema.tables.len(), 1);
    let table = &schema.tables[0];
    assert_eq!(table.name, "analytics");
    assert_eq!(table.columns.len(), 3);
    assert_eq!(table.columns[0].name, "id");
    assert_eq!(table.columns[0].data_type, CanonicalType::Integer);
    assert!(table.columns[0].is_primary_key);

    // Insert sample data
    let _insert_res = driver
        .execute_query(
            "INSERT INTO analytics VALUES (1, 'cpu_usage', 72.5), (2, 'memory_usage', 45.0)",
        )
        .await
        .expect("Insert query");

    // Query data
    let select_res = driver
        .execute_query("SELECT * FROM analytics ORDER BY id")
        .await
        .expect("Select query");
    assert_eq!(select_res.columns, vec!["id", "metric", "score"]);
    assert_eq!(select_res.rows.len(), 2);
    assert_eq!(select_res.rows[0][0], json!(1));
    assert_eq!(select_res.rows[0][1], json!("cpu_usage"));

    // Update row mutation
    let mut modified = std::collections::HashMap::new();
    modified.insert("score".to_string(), json!(88.5));
    let mut pks = std::collections::HashMap::new();
    pks.insert("id".to_string(), json!(1));

    let updates = vec![RowUpdatePayload {
        table: "analytics".to_string(),
        primary_keys: pks,
        updated_values: modified,
        expect_single_row: true,
    }];

    let affected = driver.update_rows(updates).await.expect("Update rows");
    assert_eq!(affected, 1);

    // Verify updated value
    let check_res = driver
        .execute_query("SELECT score FROM analytics WHERE id = 1")
        .await
        .expect("Verify query");
    assert_eq!(check_res.rows[0][0], json!(88.5));

    // Explain query returns a real operator tree parsed from EXPLAIN (FORMAT JSON)
    let plan = driver
        .explain_query("SELECT * FROM analytics WHERE score > 50")
        .await
        .expect("Explain query");
    assert_eq!(plan.node_type, "PROJECTION");
    assert_eq!(plan.children.len(), 1);
    let scan = &plan.children[0];
    assert_eq!(scan.node_type, "SEQ_SCAN");
    assert_eq!(scan.relation_name.as_deref(), Some("analytics"));
    assert_eq!(scan.detail.as_deref(), Some("score>50.0"));
    assert_eq!(scan.rows, 1);
}
