//! @file redis_test.rs
//! @brief Unit tests for native Redis driver, RESP serialization, and URL parsing.

use super::redis::{decode_resp, encode_command, tokenize_command, RespValue};
use crate::driver::redis::RedisDriver;
use crate::driver::DatabaseDriver;
use crate::model::connection::{ConnectionConfig, DatabaseType};
use std::io::Cursor;

#[tokio::test]
async fn test_encode_command_formatting() {
    let ping = encode_command(&["PING"]);
    assert_eq!(ping, b"*1\r\n$4\r\nPING\r\n");

    let set_cmd = encode_command(&["SET", "foo", "bar"]);
    assert_eq!(set_cmd, b"*3\r\n$3\r\nSET\r\n$3\r\nfoo\r\n$3\r\nbar\r\n");
}

#[tokio::test]
async fn test_decode_resp_types() {
    // Simple String
    let mut cur = Cursor::new(b"+PONG\r\n");
    let val = decode_resp(&mut cur).await.unwrap();
    assert_eq!(val, RespValue::SimpleString("PONG".to_string()));

    // Error
    let mut cur = Cursor::new(b"-ERR unknown command\r\n");
    let val = decode_resp(&mut cur).await.unwrap();
    assert_eq!(val, RespValue::Error("ERR unknown command".to_string()));

    // Integer
    let mut cur = Cursor::new(b":42\r\n");
    let val = decode_resp(&mut cur).await.unwrap();
    assert_eq!(val, RespValue::Integer(42));

    // Bulk string
    let mut cur = Cursor::new(b"$5\r\nhello\r\n");
    let val = decode_resp(&mut cur).await.unwrap();
    assert_eq!(val, RespValue::BulkString(Some(b"hello".to_vec())));

    // Null bulk string
    let mut cur = Cursor::new(b"$-1\r\n");
    let val = decode_resp(&mut cur).await.unwrap();
    assert_eq!(val, RespValue::BulkString(None));

    // Array
    let mut cur = Cursor::new(b"*2\r\n$3\r\nfoo\r\n$3\r\nbar\r\n");
    let val = decode_resp(&mut cur).await.unwrap();
    assert_eq!(
        val,
        RespValue::Array(Some(vec![
            RespValue::BulkString(Some(b"foo".to_vec())),
            RespValue::BulkString(Some(b"bar".to_vec())),
        ]))
    );

    // Null Array
    let mut cur = Cursor::new(b"*-1\r\n");
    let val = decode_resp(&mut cur).await.unwrap();
    assert_eq!(val, RespValue::Array(None));
}

#[test]
fn test_tokenize_command_with_quotes() {
    let tokens = tokenize_command("SET key \"value with spaces\" EX 3600");
    assert_eq!(tokens, vec!["SET", "key", "value with spaces", "EX", "3600"]);

    let single_tokens = tokenize_command("HSET user:1 'full name' 'John Doe'");
    assert_eq!(single_tokens, vec!["HSET", "user:1", "full name", "John Doe"]);

    let simple = tokenize_command("PING");
    assert_eq!(simple, vec!["PING"]);
}

#[test]
fn test_parse_redis_url() {
    let (h1, p1, d1, u1, pass1) = RedisDriver::parse_redis_url("redis://127.0.0.1:6379/2").unwrap();
    assert_eq!(h1, "127.0.0.1");
    assert_eq!(p1, 6379);
    assert_eq!(d1, 2);
    assert_eq!(u1, None);
    assert_eq!(pass1, None);

    let (h2, p2, d2, u2, pass2) =
        RedisDriver::parse_redis_url("redis://:mysecret@remote.cache.internal:6380/5").unwrap();
    assert_eq!(h2, "remote.cache.internal");
    assert_eq!(p2, 6380);
    assert_eq!(d2, 5);
    assert_eq!(u2, None);
    assert_eq!(pass2, Some("mysecret".to_string()));

    let (h3, p3, d3, u3, pass3) =
        RedisDriver::parse_redis_url("rediss://admin:securepass@ssl.redis.io/0?ssl=true").unwrap();
    assert_eq!(h3, "ssl.redis.io");
    assert_eq!(p3, 6379);
    assert_eq!(d3, 0);
    assert_eq!(u3, Some("admin".to_string()));
    assert_eq!(pass3, Some("securepass".to_string()));
}

#[tokio::test]
async fn test_redis_unreachable_fails() {
    let cfg = ConnectionConfig {
        id: "redis-unreach".to_string(),
        name: "Unreachable Redis".to_string(),
        db_type: DatabaseType::Redis,
        host: Some("127.0.0.1".to_string()),
        port: Some(65432), // Inactive port
        database: "0".to_string(),
        username: None,
        password: None,
        file_path: None,
        ssl: false,
        ssh_tunnel: None,
        connection_url: None,
        dialect_family: None,
    };

    let result = RedisDriver::connect(&cfg).await;
    assert!(result.is_err(), "Expected connection failure to inactive port");
}

#[tokio::test]
async fn test_redis_schema_introspection_definition() {
    // Instantiate driver directly without connecting for schema inspection test
    let driver = RedisDriver {
        host: "127.0.0.1".to_string(),
        port: 6379,
        database_index: 0,
        username: None,
        password: None,
    };

    let schema = driver.introspect_schema().await.unwrap();
    assert_eq!(schema.tables.len(), 3);
    assert!(schema.tables.iter().any(|t| t.name == "redis_keys"));
    assert!(schema.tables.iter().any(|t| t.name == "redis_server_info"));
    assert!(schema.tables.iter().any(|t| t.name == "redis_client_list"));

    let pk = driver.primary_key_columns("redis_keys").await.unwrap();
    assert_eq!(pk, vec!["key".to_string()]);

    let plan = driver.explain_query("GET user:profile").await.unwrap();
    assert!(plan.node_type.contains("GET"));
    assert!(plan.detail.as_deref().unwrap_or("").contains("O(1)"));
}
