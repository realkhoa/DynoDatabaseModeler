//! @file mongodb_test.rs
//! @brief Unit tests for MongoDB driver BSON encoding, decoding, and type inferences.

use super::mongodb::{decode_bson_document, encode_bson_document, infer_bson_canonical_type};
use crate::model::connection::{ConnectionConfig, DatabaseType};
use crate::model::schema::CanonicalType;
use serde_json::Value as JsonValue;
use std::collections::BTreeMap;

#[test]
fn test_bson_encode_decode_roundtrip() {
    let mut doc = BTreeMap::new();
    doc.insert("name".to_string(), JsonValue::String("Dyno".to_string()));
    doc.insert("count".to_string(), JsonValue::Number(42.into()));
    doc.insert("active".to_string(), JsonValue::Bool(true));
    doc.insert("null_field".to_string(), JsonValue::Null);

    let bytes = encode_bson_document(&doc);
    assert!(bytes.len() > 10);

    let decoded = decode_bson_document(&bytes).expect("BSON decode failed");
    assert_eq!(decoded.get("name"), Some(&JsonValue::String("Dyno".to_string())));
    assert_eq!(decoded.get("count"), Some(&JsonValue::Number(42.into())));
    assert_eq!(decoded.get("active"), Some(&JsonValue::Bool(true)));
    assert_eq!(decoded.get("null_field"), Some(&JsonValue::Null));
}

#[test]
fn test_infer_bson_canonical_type() {
    assert_eq!(
        infer_bson_canonical_type(&JsonValue::Bool(true)),
        CanonicalType::Boolean
    );
    assert_eq!(
        infer_bson_canonical_type(&JsonValue::Number(100.into())),
        CanonicalType::BigInt
    );
    assert_eq!(
        infer_bson_canonical_type(&JsonValue::String("regular text".to_string())),
        CanonicalType::Text
    );
    // 24-character hex string representing ObjectId
    assert_eq!(
        infer_bson_canonical_type(&JsonValue::String("507f1f77bcf86cd799439011".to_string())),
        CanonicalType::Uuid
    );
    assert_eq!(
        infer_bson_canonical_type(&JsonValue::Array(vec![])),
        CanonicalType::Json
    );
    assert_eq!(
        infer_bson_canonical_type(&JsonValue::Object(serde_json::Map::new())),
        CanonicalType::Json
    );
}

#[test]
fn test_mongodb_connection_config() {
    let config = ConnectionConfig {
        id: "mongo-1".to_string(),
        name: "Dev Mongo".to_string(),
        db_type: DatabaseType::MongoDb,
        host: Some("127.0.0.1".to_string()),
        port: Some(27017),
        database: "mydb".to_string(),
        username: Some("admin".to_string()),
        password: Some("secret".to_string()),
        file_path: None,
        ssl: false,
        ssh_tunnel: None,
        connection_url: None,
        dialect_family: None,
    };

    assert_eq!(config.db_type, DatabaseType::MongoDb);
    assert_eq!(config.port, Some(27017));
}
