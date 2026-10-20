//! @file factory_test.rs
//! @brief Unit tests for database driver factory and driver adapters.
//! @details Validates factory instantiation, dialect matching, error handling for unreachable endpoints,
//! and type mapping logic for PostgreSQL, MySQL, MSSQL, and SQLite.

use crate::driver::factory::DriverFactory;
use crate::driver::mssql::parse_mssql_type;
use crate::driver::mysql::parse_mysql_type;
use crate::driver::postgres::parse_postgres_type;
use crate::model::connection::{ConnectionConfig, DatabaseType};
use crate::model::schema::CanonicalType;

/// @brief Helper to generate connection configs for testing.
/// @param id Identifier for connection profile.
/// @param db_type Dialect database type.
/// @param host Optional network hostname.
/// @param port Optional port number.
/// @return Populated ConnectionConfig instance.
fn create_test_config(
    id: &str,
    db_type: DatabaseType,
    host: Option<&str>,
    port: Option<u16>,
) -> ConnectionConfig {
    ConnectionConfig {
        id: id.to_string(),
        name: format!("Test {}", id),
        db_type,
        host: host.map(|h| h.to_string()),
        port,
        database: "testdb".to_string(),
        username: Some("user".to_string()),
        password: Some("secret".to_string()),
        file_path: None,
        ssl: false,
        ssh_tunnel: None,
    }
}

#[tokio::test]
async fn test_factory_sqlite_creation() {
    let mut config = create_test_config("sqlite-mem", DatabaseType::Sqlite, None, None);
    config.database = ":memory:".to_string();
    config.file_path = Some(":memory:".to_string());

    let handle = DriverFactory::create(&config)
        .await
        .expect("Failed to create driver");
    assert_eq!(handle.driver.db_type(), DatabaseType::Sqlite);
    assert!(handle.tunnel.is_none());
}

#[tokio::test]
async fn test_factory_postgres_unreachable() {
    let config = create_test_config(
        "pg-fail",
        DatabaseType::Postgres,
        Some("127.0.0.1"),
        Some(59991),
    );
    let result = DriverFactory::create(&config).await;
    assert!(
        result.is_err(),
        "Expected connection failure for unreachable Postgres"
    );
}

#[tokio::test]
async fn test_factory_mysql_unreachable() {
    let config = create_test_config(
        "mysql-fail",
        DatabaseType::MySql,
        Some("127.0.0.1"),
        Some(59992),
    );
    let result = DriverFactory::create(&config).await;
    assert!(
        result.is_err(),
        "Expected connection failure for unreachable MySQL"
    );
}

#[tokio::test]
async fn test_factory_mssql_without_host() {
    let config = create_test_config("mssql-nohost", DatabaseType::Mssql, None, None);
    let result = DriverFactory::create(&config).await;
    assert!(
        result.is_err(),
        "Expected config error when MSSQL host is missing"
    );
}

#[tokio::test]
async fn test_factory_mssql_unreachable() {
    let config = create_test_config(
        "mssql-fail",
        DatabaseType::Mssql,
        Some("127.0.0.1"),
        Some(59993),
    );
    let result = DriverFactory::create(&config).await;
    assert!(
        result.is_err(),
        "Expected connection failure for unreachable MSSQL"
    );
}

#[test]
fn test_postgres_type_mapping() {
    assert_eq!(parse_postgres_type("integer", None), CanonicalType::Integer);
    assert_eq!(parse_postgres_type("int4", None), CanonicalType::Integer);
    assert_eq!(parse_postgres_type("bigint", None), CanonicalType::BigInt);
    assert_eq!(parse_postgres_type("int8", None), CanonicalType::BigInt);
    assert_eq!(
        parse_postgres_type("smallint", None),
        CanonicalType::SmallInt
    );
    assert_eq!(parse_postgres_type("int2", None), CanonicalType::SmallInt);
    assert_eq!(parse_postgres_type("boolean", None), CanonicalType::Boolean);
    assert_eq!(parse_postgres_type("bool", None), CanonicalType::Boolean);
    assert_eq!(parse_postgres_type("text", None), CanonicalType::Text);
    assert_eq!(
        parse_postgres_type("varchar", Some(64)),
        CanonicalType::Varchar(Some(64))
    );
    assert_eq!(
        parse_postgres_type("character varying", Some(128)),
        CanonicalType::Varchar(Some(128))
    );
    assert_eq!(parse_postgres_type("uuid", None), CanonicalType::Uuid);
    assert_eq!(parse_postgres_type("json", None), CanonicalType::Json);
    assert_eq!(parse_postgres_type("jsonb", None), CanonicalType::Json);
    assert_eq!(parse_postgres_type("bytea", None), CanonicalType::Binary);
    assert_eq!(
        parse_postgres_type("custom_enum", None),
        CanonicalType::Custom("custom_enum".to_string())
    );
}

#[test]
fn test_mysql_type_mapping() {
    assert_eq!(parse_mysql_type("int", None), CanonicalType::Integer);
    assert_eq!(parse_mysql_type("integer", None), CanonicalType::Integer);
    assert_eq!(parse_mysql_type("bigint", None), CanonicalType::BigInt);
    assert_eq!(parse_mysql_type("smallint", None), CanonicalType::SmallInt);
    assert_eq!(
        parse_mysql_type("varchar", Some(255)),
        CanonicalType::Varchar(Some(255))
    );
    assert_eq!(parse_mysql_type("text", None), CanonicalType::Text);
    assert_eq!(parse_mysql_type("tinyint", Some(1)), CanonicalType::Boolean);
    assert_eq!(
        parse_mysql_type("tinyint", Some(4)),
        CanonicalType::SmallInt
    );
    assert_eq!(parse_mysql_type("blob", None), CanonicalType::Binary);
    assert_eq!(
        parse_mysql_type("geometry", None),
        CanonicalType::Custom("geometry".to_string())
    );
}

#[test]
fn test_mssql_type_mapping() {
    assert_eq!(parse_mssql_type("int", None), CanonicalType::Integer);
    assert_eq!(parse_mssql_type("bigint", None), CanonicalType::BigInt);
    assert_eq!(parse_mssql_type("smallint", None), CanonicalType::SmallInt);
    assert_eq!(parse_mssql_type("bit", None), CanonicalType::Boolean);
    assert_eq!(
        parse_mssql_type("varchar", Some(100)),
        CanonicalType::Varchar(Some(100))
    );
    assert_eq!(
        parse_mssql_type("nvarchar", Some(50)),
        CanonicalType::Varchar(Some(50))
    );
    assert_eq!(parse_mssql_type("text", None), CanonicalType::Text);
    assert_eq!(
        parse_mssql_type("uniqueidentifier", None),
        CanonicalType::Uuid
    );
    assert_eq!(parse_mssql_type("varbinary", None), CanonicalType::Binary);
    assert_eq!(
        parse_mssql_type("hierarchyid", None),
        CanonicalType::Custom("hierarchyid".to_string())
    );
}
