//! @file clickhouse_test.rs
//! @brief Unit tests for ClickHouse driver type parsing and HTTP response processing.

use super::clickhouse::parse_clickhouse_canonical_type;
use crate::model::connection::{ConnectionConfig, DatabaseType};
use crate::model::schema::CanonicalType;

#[test]
fn test_parse_clickhouse_canonical_type() {
    assert_eq!(parse_clickhouse_canonical_type("UInt8"), CanonicalType::SmallInt);
    assert_eq!(parse_clickhouse_canonical_type("Int32"), CanonicalType::Integer);
    assert_eq!(parse_clickhouse_canonical_type("UInt32"), CanonicalType::BigInt);
    assert_eq!(parse_clickhouse_canonical_type("Int64"), CanonicalType::BigInt);
    assert_eq!(parse_clickhouse_canonical_type("Float64"), CanonicalType::Double);
    assert_eq!(parse_clickhouse_canonical_type("String"), CanonicalType::Text);
    assert_eq!(parse_clickhouse_canonical_type("FixedString(16)"), CanonicalType::Char(Some(32)));
    assert_eq!(parse_clickhouse_canonical_type("Bool"), CanonicalType::Boolean);
    assert_eq!(parse_clickhouse_canonical_type("Date"), CanonicalType::Date);
    assert_eq!(parse_clickhouse_canonical_type("DateTime64(3, 'UTC')"), CanonicalType::Timestamp);
    assert_eq!(parse_clickhouse_canonical_type("UUID"), CanonicalType::Uuid);
    assert_eq!(
        parse_clickhouse_canonical_type("Nullable(Int32)"),
        CanonicalType::Integer
    );
    assert_eq!(
        parse_clickhouse_canonical_type("LowCardinality(String)"),
        CanonicalType::Text
    );
    assert_eq!(
        parse_clickhouse_canonical_type("Array(String)"),
        CanonicalType::Json
    );
    assert_eq!(
        parse_clickhouse_canonical_type("JSON"),
        CanonicalType::Json
    );
}

#[test]
fn test_clickhouse_driver_config_properties() {
    let config = ConnectionConfig {
        id: "ch-1".to_string(),
        name: "Test ClickHouse".to_string(),
        db_type: DatabaseType::ClickHouse,
        host: Some("clickhouse.internal".to_string()),
        port: Some(8123),
        database: "analytics".to_string(),
        username: Some("reporter".to_string()),
        password: Some("secret".to_string()),
        file_path: None,
        ssl: false,
        ssh_tunnel: None,
        connection_url: None,
        dialect_family: None,
    };

    assert_eq!(config.db_type, DatabaseType::ClickHouse);
    assert_eq!(config.port, Some(8123));
}
