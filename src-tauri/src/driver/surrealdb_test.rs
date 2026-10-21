//! @file surrealdb_test.rs
//! @brief Unit tests for SurrealDB driver type parsers and connection configs.

use super::surrealdb::parse_surreal_canonical_type;
use crate::model::connection::{ConnectionConfig, DatabaseType};
use crate::model::schema::CanonicalType;

#[test]
fn test_parse_surreal_canonical_type() {
    assert_eq!(parse_surreal_canonical_type("int"), CanonicalType::BigInt);
    assert_eq!(parse_surreal_canonical_type("number"), CanonicalType::BigInt);
    assert_eq!(parse_surreal_canonical_type("float"), CanonicalType::Double);
    assert_eq!(parse_surreal_canonical_type("string"), CanonicalType::Text);
    assert_eq!(parse_surreal_canonical_type("bool"), CanonicalType::Boolean);
    assert_eq!(parse_surreal_canonical_type("datetime"), CanonicalType::Timestamp);
    assert_eq!(parse_surreal_canonical_type("record"), CanonicalType::Uuid);
    assert_eq!(
        parse_surreal_canonical_type("array"),
        CanonicalType::Json
    );
    assert_eq!(parse_surreal_canonical_type("object"), CanonicalType::Json);
}

#[test]
fn test_surrealdb_connection_config() {
    let config = ConnectionConfig {
        id: "surreal-1".to_string(),
        name: "Local SurrealDB".to_string(),
        db_type: DatabaseType::SurrealDb,
        host: Some("127.0.0.1".to_string()),
        port: Some(8000),
        database: "test_ns:test_db".to_string(),
        username: Some("root".to_string()),
        password: Some("root".to_string()),
        file_path: None,
        ssl: false,
        ssh_tunnel: None,
        connection_url: None,
        dialect_family: None,
    };

    assert_eq!(config.db_type, DatabaseType::SurrealDb);
    assert_eq!(config.port, Some(8000));
}
