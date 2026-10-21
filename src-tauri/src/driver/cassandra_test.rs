//! @file cassandra_test.rs
//! @brief Unit tests for Cassandra & ScyllaDB driver protocol and type parsers.

use super::cassandra::{parse_cql_canonical_type, parse_cql_result};
use crate::model::connection::{ConnectionConfig, DatabaseType};
use crate::model::schema::CanonicalType;

#[test]
fn test_parse_cql_canonical_type() {
    assert_eq!(parse_cql_canonical_type("int"), CanonicalType::Integer);
    assert_eq!(parse_cql_canonical_type("bigint"), CanonicalType::BigInt);
    assert_eq!(parse_cql_canonical_type("text"), CanonicalType::Text);
    assert_eq!(parse_cql_canonical_type("varchar"), CanonicalType::Text);
    assert_eq!(parse_cql_canonical_type("uuid"), CanonicalType::Uuid);
    assert_eq!(parse_cql_canonical_type("timeuuid"), CanonicalType::Uuid);
    assert_eq!(parse_cql_canonical_type("boolean"), CanonicalType::Boolean);
    assert_eq!(parse_cql_canonical_type("double"), CanonicalType::Double);
    assert_eq!(parse_cql_canonical_type("float"), CanonicalType::Float);
    assert_eq!(parse_cql_canonical_type("timestamp"), CanonicalType::Timestamp);
    assert_eq!(parse_cql_canonical_type("blob"), CanonicalType::Binary);
    assert_eq!(
        parse_cql_canonical_type("list<text>"),
        CanonicalType::Json
    );
}

#[test]
fn test_parse_cql_result_void() {
    // Kind 0x0001 (VOID)
    let body = vec![0x00, 0x00, 0x00, 0x01];
    let (cols, rows) = parse_cql_result(&body).expect("parse void failed");
    assert_eq!(cols, vec!["result"]);
    assert_eq!(rows.len(), 1);
}

#[test]
fn test_cassandra_connection_config() {
    let config = ConnectionConfig {
        id: "cas-1".to_string(),
        name: "Scylla Cluster".to_string(),
        db_type: DatabaseType::Cassandra,
        host: Some("127.0.0.1".to_string()),
        port: Some(9042),
        database: "my_keyspace".to_string(),
        username: Some("cassandra".to_string()),
        password: Some("cassandra".to_string()),
        file_path: None,
        ssl: false,
        ssh_tunnel: None,
        connection_url: None,
        dialect_family: None,
    };

    assert_eq!(config.db_type, DatabaseType::Cassandra);
    assert_eq!(config.port, Some(9042));
}
