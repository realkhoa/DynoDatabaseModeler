//! @file redis.rs
//! @brief High-performance native Redis driver and REdis Serialization Protocol (RESP2) client.
//! @details Implements the DatabaseDriver trait for Redis, KeyDB, Dragonfly, and Valkey instances.
//! Supports key catalog introspection, dynamic command dispatching, tabular representation of
//! Redis keys, hashes, lists, sets, server diagnostics (INFO), and client connection lists.

use super::{DatabaseDriver, ExecutionPlanNode, MigrationReport, QueryResult, RowUpdatePayload};
use crate::error::AppError;
use crate::model::connection::{ConnectionConfig, DatabaseType};
use crate::model::schema::{CanonicalType, ColumnSchema, DatabaseSchema, TableSchema};
use async_trait::async_trait;
use serde_json::Value as JsonValue;
use std::time::Instant;
use tokio::io::{AsyncBufReadExt, AsyncReadExt, AsyncWriteExt, BufReader};
use tokio::net::TcpStream;

/// @brief REdis Serialization Protocol (RESP2) value representation.
#[derive(Debug, Clone, PartialEq)]
pub enum RespValue {
    /// @brief Simple string, e.g. +OK\r\n or +PONG\r\n.
    SimpleString(String),
    /// @brief Error message from Redis server, e.g. -ERR message\r\n.
    Error(String),
    /// @brief Integer number, e.g. :1000\r\n.
    Integer(i64),
    /// @brief Bulk string containing raw bytes, or None for null bulk strings ($-1\r\n).
    BulkString(Option<Vec<u8>>),
    /// @brief Array of RESP values, or None for null arrays (*-1\r\n).
    Array(Option<Vec<RespValue>>),
}

impl RespValue {
    /// @brief Extracts UTF-8 string content from SimpleString or BulkString.
    /// @return UTF-8 string or None if not a valid string or null.
    pub fn as_str(&self) -> Option<String> {
        match self {
            RespValue::SimpleString(s) => Some(s.clone()),
            RespValue::BulkString(Some(bytes)) => String::from_utf8(bytes.clone()).ok(),
            _ => None,
        }
    }

    /// @brief Converts RESP value into a JSON representation for data grids.
    /// @return JSON Value enum.
    pub fn to_json(&self) -> JsonValue {
        match self {
            RespValue::SimpleString(s) => JsonValue::String(s.clone()),
            RespValue::Error(e) => JsonValue::String(format!("ERROR: {e}")),
            RespValue::Integer(i) => JsonValue::Number((*i).into()),
            RespValue::BulkString(Some(bytes)) => {
                if let Ok(s) = std::str::from_utf8(bytes) {
                    if let Ok(json) = serde_json::from_str::<JsonValue>(s) {
                        json
                    } else {
                        JsonValue::String(s.to_string())
                    }
                } else {
                    JsonValue::String(format!("<binary {} bytes>", bytes.len()))
                }
            }
            RespValue::BulkString(None) => JsonValue::Null,
            RespValue::Array(Some(items)) => {
                JsonValue::Array(items.iter().map(|item| item.to_json()).collect())
            }
            RespValue::Array(None) => JsonValue::Null,
        }
    }
}

/// @brief Serializes a command and its arguments into RESP array format.
/// @param args Slice of command name and argument strings.
/// @return Serialized byte buffer ready to send across TCP stream.
pub fn encode_command(args: &[&str]) -> Vec<u8> {
    let mut buf = Vec::new();
    buf.extend_from_slice(format!("*{}\r\n", args.len()).as_bytes());
    for arg in args {
        buf.extend_from_slice(format!("${}\r\n{}\r\n", arg.len(), arg).as_bytes());
    }
    buf
}

/// @brief Asynchronously parses a single RESP value from a buffered reader.
/// @param reader Mutable reference to the buffered asynchronous reader.
/// @return Parsed RespValue or AppError on protocol or I/O failure.
pub async fn decode_resp<R: AsyncBufReadExt + Unpin>(reader: &mut R) -> Result<RespValue, AppError> {
    let mut line = String::new();
    let bytes_read = reader
        .read_line(&mut line)
        .await
        .map_err(|e| AppError::Connection(format!("Failed to read from Redis socket: {e}")))?;

    if bytes_read == 0 {
        return Err(AppError::Connection(
            "Connection closed by Redis server unexpectedly.".to_string(),
        ));
    }

    let trimmed = line.trim_end_matches(['\r', '\n']);
    if trimmed.is_empty() {
        return Err(AppError::Database("Empty response line from Redis.".to_string()));
    }

    let prefix = trimmed.chars().next().unwrap_or('\0');
    let content = &trimmed[1..];

    match prefix {
        '+' => Ok(RespValue::SimpleString(content.to_string())),
        '-' => Ok(RespValue::Error(content.to_string())),
        ':' => {
            let val = content
                .parse::<i64>()
                .map_err(|e| AppError::Database(format!("Invalid RESP integer: {e}")))?;
            Ok(RespValue::Integer(val))
        }
        '$' => {
            let len = content
                .parse::<i64>()
                .map_err(|e| AppError::Database(format!("Invalid RESP bulk string length: {e}")))?;
            if len < 0 {
                return Ok(RespValue::BulkString(None));
            }
            let ulen = len as usize;
            let mut data = vec![0u8; ulen];
            reader
                .read_exact(&mut data)
                .await
                .map_err(|e| AppError::Connection(format!("Failed to read bulk string payload: {e}")))?;
            // Read trailing \r\n
            let mut crlf = [0u8; 2];
            reader
                .read_exact(&mut crlf)
                .await
                .map_err(|e| AppError::Connection(format!("Failed to read bulk string delimiter: {e}")))?;
            Ok(RespValue::BulkString(Some(data)))
        }
        '*' => {
            let count = content
                .parse::<i64>()
                .map_err(|e| AppError::Database(format!("Invalid RESP array count: {e}")))?;
            if count < 0 {
                return Ok(RespValue::Array(None));
            }
            let mut items = Vec::with_capacity(count as usize);
            for _ in 0..count {
                let item = Box::pin(decode_resp(reader)).await?;
                items.push(item);
            }
            Ok(RespValue::Array(Some(items)))
        }
        unknown => Err(AppError::Database(format!(
            "Unrecognized RESP type prefix: '{unknown}'"
        ))),
    }
}

/// @brief Parses a command-line string into tokens, respecting quotes.
/// @param input Command line input string.
/// @return Vector of parsed string tokens.
pub fn tokenize_command(input: &str) -> Vec<String> {
    let mut tokens = Vec::new();
    let mut current = String::new();
    let mut in_single_quote = false;
    let mut in_double_quote = false;
    let mut chars = input.chars().peekable();

    while let Some(c) = chars.next() {
        match c {
            '\'' if !in_double_quote => {
                in_single_quote = !in_single_quote;
            }
            '"' if !in_single_quote => {
                in_double_quote = !in_double_quote;
            }
            ' ' | '\t' | '\r' | '\n' if !in_single_quote && !in_double_quote => {
                if !current.is_empty() {
                    tokens.push(std::mem::take(&mut current));
                }
            }
            _ => {
                current.push(c);
            }
        }
    }

    if !current.is_empty() {
        tokens.push(current);
    }

    tokens
}

/// @brief High-performance native Redis database driver adapter.
pub struct RedisDriver {
    pub(crate) host: String,
    pub(crate) port: u16,
    pub(crate) database_index: u32,
    pub(crate) username: Option<String>,
    pub(crate) password: Option<String>,
}

impl RedisDriver {
    /// @brief Establishes and verifies a connection configuration to a Redis instance.
    /// @param config Connection profile parameters.
    /// @return Initialized RedisDriver instance or AppError on connection failure.
    pub async fn connect(config: &ConnectionConfig) -> Result<Self, AppError> {
        let (host, port, db_index, username, password) = if let Some(ref url) = config.connection_url {
            Self::parse_redis_url(url)?
        } else {
            let host = config.host.clone().unwrap_or_else(|| "127.0.0.1".to_string());
            let port = config.port.unwrap_or(6379);
            let db_index = config.database.trim().parse::<u32>().unwrap_or(0);
            let username = config.username.clone().filter(|u| !u.trim().is_empty());
            let password = config.password.clone().filter(|p| !p.is_empty());
            (host, port, db_index, username, password)
        };

        let driver = Self {
            host,
            port,
            database_index: db_index,
            username,
            password,
        };

        driver.test_connection().await?;
        Ok(driver)
    }

    /// @brief Parses a Redis URL string into components.
    /// @param url Raw connection string (e.g. redis://:secret@localhost:6379/0).
    /// @return Tuple containing (host, port, database_index, username, password).
    pub fn parse_redis_url(
        url: &str,
    ) -> Result<(String, u16, u32, Option<String>, Option<String>), AppError> {
        let trimmed = url.trim();
        let without_proto = if let Some(rest) = trimmed.strip_prefix("redis://") {
            rest
        } else if let Some(rest) = trimmed.strip_prefix("rediss://") {
            rest
        } else {
            trimmed
        };

        let (auth_part, host_part) = if let Some((auth, host)) = without_proto.split_once('@') {
            (Some(auth), host)
        } else {
            (None, without_proto)
        };

        let mut username = None;
        let mut password = None;
        if let Some(auth) = auth_part {
            if let Some((u, p)) = auth.split_once(':') {
                if !u.is_empty() {
                    username = Some(u.to_string());
                }
                if !p.is_empty() {
                    password = Some(p.to_string());
                }
            } else if !auth.is_empty() {
                password = Some(auth.to_string());
            }
        }

        let (host_port, db_part) = if let Some((hp, db)) = host_part.split_once('/') {
            (hp, Some(db))
        } else {
            (host_part, None)
        };

        let (host, port) = if let Some((h, p)) = host_port.split_once(':') {
            let port_num = p
                .parse::<u16>()
                .map_err(|e| AppError::Connection(format!("Invalid Redis port: {e}")))?;
            (h.to_string(), port_num)
        } else {
            (host_port.to_string(), 6379)
        };

        let db_index = if let Some(db_str) = db_part {
            let clean_db = db_str.split('?').next().unwrap_or("0");
            clean_db.parse::<u32>().unwrap_or(0)
        } else {
            0
        };

        Ok((host, port, db_index, username, password))
    }

    /// @brief Opens a new authenticated and database-selected TCP connection to the Redis server.
    /// @return Buffered reader and writer pair connected to Redis.
    async fn open_connection(&self) -> Result<BufReader<TcpStream>, AppError> {
        let addr = format!("{}:{}", self.host, self.port);
        let stream = TcpStream::connect(&addr)
            .await
            .map_err(|e| AppError::Connection(format!("Failed to connect to Redis at {addr}: {e}")))?;

        let mut reader = BufReader::new(stream);

        // Authenticate if password provided
        if let Some(ref pass) = self.password {
            let auth_cmd = if let Some(ref user) = self.username {
                encode_command(&["AUTH", user, pass])
            } else {
                encode_command(&["AUTH", pass])
            };
            reader
                .get_mut()
                .write_all(&auth_cmd)
                .await
                .map_err(|e| AppError::Connection(format!("Failed to send AUTH command: {e}")))?;
            reader.get_mut().flush().await.map_err(|e| {
                AppError::Connection(format!("Failed to flush socket after AUTH: {e}"))
            })?;

            let resp = decode_resp(&mut reader).await?;
            if let RespValue::Error(err_msg) = resp {
                return Err(AppError::Connection(format!(
                    "Redis authentication failed: {err_msg}"
                )));
            }
        }

        // Select database index if not 0
        if self.database_index > 0 {
            let db_str = self.database_index.to_string();
            let select_cmd = encode_command(&["SELECT", &db_str]);
            reader
                .get_mut()
                .write_all(&select_cmd)
                .await
                .map_err(|e| AppError::Connection(format!("Failed to send SELECT command: {e}")))?;
            reader.get_mut().flush().await.map_err(|e| {
                AppError::Connection(format!("Failed to flush socket after SELECT: {e}"))
            })?;

            let resp = decode_resp(&mut reader).await?;
            if let RespValue::Error(err_msg) = resp {
                return Err(AppError::Connection(format!(
                    "Failed to select Redis database {}: {err_msg}",
                    self.database_index
                )));
            }
        }

        Ok(reader)
    }

    /// @brief Sends a command slice to Redis and returns the response.
    /// @param args Slice of command name and string arguments.
    /// @return RespValue response from Redis.
    pub async fn execute_raw_command(&self, args: &[&str]) -> Result<RespValue, AppError> {
        let mut conn = self.open_connection().await?;
        let cmd = encode_command(args);

        conn.get_mut()
            .write_all(&cmd)
            .await
            .map_err(|e| AppError::Database(format!("Failed to send command to Redis: {e}")))?;
        conn.get_mut()
            .flush()
            .await
            .map_err(|e| AppError::Database(format!("Failed to flush Redis socket: {e}")))?;

        let response = decode_resp(&mut conn).await?;
        if let RespValue::Error(err) = response {
            return Err(AppError::Database(format!("Redis error: {err}")));
        }
        Ok(response)
    }

    /// @brief Scans active keys in current database.
    /// @param limit Maximum number of keys to return.
    /// @return Vector of key name strings.
    async fn scan_keys(&self, limit: usize) -> Result<Vec<String>, AppError> {
        let count_str = limit.to_string();
        let resp = self
            .execute_raw_command(&["SCAN", "0", "COUNT", &count_str])
            .await?;

        if let RespValue::Array(Some(parts)) = resp {
            if parts.len() >= 2 {
                if let RespValue::Array(Some(keys_resp)) = &parts[1] {
                    let mut keys = Vec::new();
                    for k in keys_resp {
                        if let Some(s) = k.as_str() {
                            keys.push(s);
                            if keys.len() >= limit {
                                break;
                            }
                        }
                    }
                    return Ok(keys);
                }
            }
        }

        // Fallback to KEYS * if SCAN returned no array
        let resp_keys = self.execute_raw_command(&["KEYS", "*"]).await?;
        if let RespValue::Array(Some(keys_resp)) = resp_keys {
            let mut keys = Vec::new();
            for k in keys_resp {
                if let Some(s) = k.as_str() {
                    keys.push(s);
                    if keys.len() >= limit {
                        break;
                    }
                }
            }
            return Ok(keys);
        }

        Ok(vec![])
    }
}

#[async_trait]
impl DatabaseDriver for RedisDriver {
    /// @brief Pings Redis server to verify connectivity.
    async fn test_connection(&self) -> Result<(), AppError> {
        let resp = self.execute_raw_command(&["PING"]).await?;
        match resp {
            RespValue::SimpleString(s) if s.eq_ignore_ascii_case("PONG") => Ok(()),
            RespValue::BulkString(Some(b)) if b == b"PONG" => Ok(()),
            RespValue::SimpleString(_) | RespValue::BulkString(_) => Ok(()),
            other => Err(AppError::Connection(format!(
                "Unexpected PING response from Redis: {other:?}"
            ))),
        }
    }

    /// @brief Introspects virtual tables representing Redis keys, server statistics, and active clients.
    async fn introspect_schema(&self) -> Result<DatabaseSchema, AppError> {
        let redis_keys_table = TableSchema {
            name: "redis_keys".to_string(),
            schema: None,
            columns: vec![
                ColumnSchema {
                    name: "key".to_string(),
                    data_type: CanonicalType::Text,
                    is_nullable: false,
                    is_primary_key: true,
                    is_auto_increment: false,
                    default_value: None,
                },
                ColumnSchema {
                    name: "type".to_string(),
                    data_type: CanonicalType::Varchar(Some(16)),
                    is_nullable: true,
                    is_primary_key: false,
                    is_auto_increment: false,
                    default_value: None,
                },
                ColumnSchema {
                    name: "ttl".to_string(),
                    data_type: CanonicalType::BigInt,
                    is_nullable: true,
                    is_primary_key: false,
                    is_auto_increment: false,
                    default_value: None,
                },
                ColumnSchema {
                    name: "size".to_string(),
                    data_type: CanonicalType::BigInt,
                    is_nullable: true,
                    is_primary_key: false,
                    is_auto_increment: false,
                    default_value: None,
                },
                ColumnSchema {
                    name: "value".to_string(),
                    data_type: CanonicalType::Text,
                    is_nullable: true,
                    is_primary_key: false,
                    is_auto_increment: false,
                    default_value: None,
                },
            ],
            foreign_keys: vec![],
            indexes: vec![],
            ui_position: None,
            rename_from: None,
            unsupported_features: vec![],
        };

        let redis_server_info_table = TableSchema {
            name: "redis_server_info".to_string(),
            schema: None,
            columns: vec![
                ColumnSchema {
                    name: "property".to_string(),
                    data_type: CanonicalType::Varchar(Some(128)),
                    is_nullable: false,
                    is_primary_key: true,
                    is_auto_increment: false,
                    default_value: None,
                },
                ColumnSchema {
                    name: "section".to_string(),
                    data_type: CanonicalType::Varchar(Some(64)),
                    is_nullable: true,
                    is_primary_key: false,
                    is_auto_increment: false,
                    default_value: None,
                },
                ColumnSchema {
                    name: "value".to_string(),
                    data_type: CanonicalType::Text,
                    is_nullable: true,
                    is_primary_key: false,
                    is_auto_increment: false,
                    default_value: None,
                },
            ],
            foreign_keys: vec![],
            indexes: vec![],
            ui_position: None,
            rename_from: None,
            unsupported_features: vec![],
        };

        let redis_client_list_table = TableSchema {
            name: "redis_client_list".to_string(),
            schema: None,
            columns: vec![
                ColumnSchema {
                    name: "id".to_string(),
                    data_type: CanonicalType::BigInt,
                    is_nullable: false,
                    is_primary_key: true,
                    is_auto_increment: false,
                    default_value: None,
                },
                ColumnSchema {
                    name: "addr".to_string(),
                    data_type: CanonicalType::Varchar(Some(64)),
                    is_nullable: true,
                    is_primary_key: false,
                    is_auto_increment: false,
                    default_value: None,
                },
                ColumnSchema {
                    name: "name".to_string(),
                    data_type: CanonicalType::Varchar(Some(64)),
                    is_nullable: true,
                    is_primary_key: false,
                    is_auto_increment: false,
                    default_value: None,
                },
                ColumnSchema {
                    name: "age".to_string(),
                    data_type: CanonicalType::BigInt,
                    is_nullable: true,
                    is_primary_key: false,
                    is_auto_increment: false,
                    default_value: None,
                },
                ColumnSchema {
                    name: "cmd".to_string(),
                    data_type: CanonicalType::Varchar(Some(32)),
                    is_nullable: true,
                    is_primary_key: false,
                    is_auto_increment: false,
                    default_value: None,
                },
            ],
            foreign_keys: vec![],
            indexes: vec![],
            ui_position: None,
            rename_from: None,
            unsupported_features: vec![],
        };

        Ok(DatabaseSchema {
            database_name: format!("redis_db_{}", self.database_index),
            tables: vec![
                redis_keys_table,
                redis_server_info_table,
                redis_client_list_table,
            ],
        })
    }

    /// @brief Executes a Redis command or simulated SQL query on virtual tables.
    async fn execute_query(&self, sql: &str) -> Result<QueryResult, AppError> {
        let start = Instant::now();
        let trimmed = sql.trim().trim_end_matches(';').trim();

        if trimmed.is_empty() {
            return Ok(QueryResult {
                columns: vec!["result".to_string()],
                rows: vec![],
                rows_affected: 0,
                execution_time_ms: 0,
            });
        }

        let upper = trimmed.to_uppercase();

        // 1. Check for SELECT COUNT(*) FROM redis_keys / keys
        if upper.starts_with("SELECT")
            && upper.contains("COUNT")
            && (upper.contains("REDIS_KEYS") || upper.contains("KEYS"))
        {
            let dbsize = self.execute_raw_command(&["DBSIZE"]).await?;
            let count = match dbsize {
                RespValue::Integer(n) => n as u64,
                _ => 0,
            };
            return Ok(QueryResult {
                columns: vec!["total_count".to_string()],
                rows: vec![vec![JsonValue::Number(count.into())]],
                rows_affected: 1,
                execution_time_ms: start.elapsed().as_millis() as u64,
            });
        }

        // 2. Check for SELECT * FROM redis_keys / keys
        if upper.starts_with("SELECT") && (upper.contains("REDIS_KEYS") || upper.contains("KEYS")) {
            let limit = if let Some(pos) = upper.find("LIMIT") {
                let rest = upper[pos + 5..].trim();
                let num_str = rest.split_whitespace().next().unwrap_or("100");
                num_str.parse::<usize>().unwrap_or(100)
            } else {
                100
            };

            let keys = self.scan_keys(limit).await?;
            let mut rows = Vec::with_capacity(keys.len());

            for k in &keys {
                // Determine key type
                let type_resp = self.execute_raw_command(&["TYPE", k]).await;
                let k_type = match type_resp {
                    Ok(RespValue::SimpleString(t)) => t,
                    _ => "unknown".to_string(),
                };

                // Determine key TTL
                let ttl_resp = self.execute_raw_command(&["TTL", k]).await;
                let k_ttl = match ttl_resp {
                    Ok(RespValue::Integer(t)) => t,
                    _ => -1,
                };

                // Determine key value & size
                let (k_size, k_val) = match k_type.as_str() {
                    "string" => {
                        let val_resp = self.execute_raw_command(&["GET", k]).await;
                        match val_resp {
                            Ok(RespValue::BulkString(Some(b))) => {
                                let len = b.len();
                                let preview = String::from_utf8_lossy(&b).to_string();
                                (len as i64, preview)
                            }
                            _ => (0, "".to_string()),
                        }
                    }
                    "hash" => {
                        let hlen_resp = self.execute_raw_command(&["HLEN", k]).await;
                        let count = match hlen_resp {
                            Ok(RespValue::Integer(n)) => n,
                            _ => 0,
                        };
                        let val_resp = self.execute_raw_command(&["HGETALL", k]).await;
                        let json = val_resp.map(|v| v.to_json()).unwrap_or(JsonValue::Null);
                        (count, json.to_string())
                    }
                    "list" => {
                        let llen_resp = self.execute_raw_command(&["LLEN", k]).await;
                        let count = match llen_resp {
                            Ok(RespValue::Integer(n)) => n,
                            _ => 0,
                        };
                        let val_resp = self.execute_raw_command(&["LRANGE", k, "0", "9"]).await;
                        let json = val_resp.map(|v| v.to_json()).unwrap_or(JsonValue::Null);
                        (count, json.to_string())
                    }
                    "set" => {
                        let scard_resp = self.execute_raw_command(&["SCARD", k]).await;
                        let count = match scard_resp {
                            Ok(RespValue::Integer(n)) => n,
                            _ => 0,
                        };
                        let val_resp = self.execute_raw_command(&["SMEMBERS", k]).await;
                        let json = val_resp.map(|v| v.to_json()).unwrap_or(JsonValue::Null);
                        (count, json.to_string())
                    }
                    "zset" => {
                        let zcard_resp = self.execute_raw_command(&["ZCARD", k]).await;
                        let count = match zcard_resp {
                            Ok(RespValue::Integer(n)) => n,
                            _ => 0,
                        };
                        (count, format!("<zset with {count} members>"))
                    }
                    _ => (0, format!("<{k_type}>")),
                };

                rows.push(vec![
                    JsonValue::String(k.clone()),
                    JsonValue::String(k_type),
                    JsonValue::Number(k_ttl.into()),
                    JsonValue::Number(k_size.into()),
                    JsonValue::String(k_val),
                ]);
            }

            return Ok(QueryResult {
                columns: vec![
                    "key".to_string(),
                    "type".to_string(),
                    "ttl".to_string(),
                    "size".to_string(),
                    "value".to_string(),
                ],
                rows_affected: rows.len() as u64,
                rows,
                execution_time_ms: start.elapsed().as_millis() as u64,
            });
        }

        // 3. Check for SELECT * FROM redis_server_info
        if upper.starts_with("SELECT") && upper.contains("REDIS_SERVER_INFO") {
            let info_resp = self.execute_raw_command(&["INFO"]).await?;
            let text = info_resp.as_str().unwrap_or_default();
            let mut rows = Vec::new();
            let mut current_section = "general".to_string();

            for line in text.lines() {
                let trimmed_line = line.trim();
                if let Some(sec) = trimmed_line.strip_prefix('#') {
                    current_section = sec.trim().to_lowercase();
                } else if let Some((prop, val)) = trimmed_line.split_once(':') {
                    rows.push(vec![
                        JsonValue::String(prop.trim().to_string()),
                        JsonValue::String(current_section.clone()),
                        JsonValue::String(val.trim().to_string()),
                    ]);
                }
            }

            return Ok(QueryResult {
                columns: vec![
                    "property".to_string(),
                    "section".to_string(),
                    "value".to_string(),
                ],
                rows_affected: rows.len() as u64,
                rows,
                execution_time_ms: start.elapsed().as_millis() as u64,
            });
        }

        // 4. Check for SELECT * FROM redis_client_list or CLIENT LIST
        if (upper.starts_with("SELECT") && upper.contains("REDIS_CLIENT_LIST"))
            || upper == "CLIENT LIST"
        {
            let client_resp = self.execute_raw_command(&["CLIENT", "LIST"]).await?;
            let text = client_resp.as_str().unwrap_or_default();
            let mut rows = Vec::new();

            for line in text.lines() {
                let mut id = JsonValue::Null;
                let mut addr = JsonValue::Null;
                let mut name = JsonValue::Null;
                let mut age = JsonValue::Null;
                let mut cmd = JsonValue::Null;

                for pair in line.split_whitespace() {
                    if let Some((k, v)) = pair.split_once('=') {
                        match k {
                            "id" => id = JsonValue::String(v.to_string()),
                            "addr" => addr = JsonValue::String(v.to_string()),
                            "name" => name = JsonValue::String(v.to_string()),
                            "age" => age = v.parse::<i64>().map(JsonValue::from).unwrap_or(JsonValue::Null),
                            "cmd" => cmd = JsonValue::String(v.to_string()),
                            _ => {}
                        }
                    }
                }

                if !id.is_null() {
                    rows.push(vec![id, addr, name, age, cmd]);
                }
            }

            return Ok(QueryResult {
                columns: vec![
                    "id".to_string(),
                    "addr".to_string(),
                    "name".to_string(),
                    "age".to_string(),
                    "cmd".to_string(),
                ],
                rows_affected: rows.len() as u64,
                rows,
                execution_time_ms: start.elapsed().as_millis() as u64,
            });
        }

        // 5. Standard raw Redis command dispatching (e.g. GET foo, SET foo bar, KEYS *, HGETALL foo, PING, etc.)
        let tokens = tokenize_command(trimmed);
        if tokens.is_empty() {
            return Ok(QueryResult {
                columns: vec!["result".to_string()],
                rows: vec![],
                rows_affected: 0,
                execution_time_ms: 0,
            });
        }

        let token_refs: Vec<&str> = tokens.iter().map(|s| s.as_str()).collect();
        let resp = self.execute_raw_command(&token_refs).await?;

        // Format command response cleanly into QueryResult tabular view
        let (columns, rows, rows_affected) = match resp {
            RespValue::SimpleString(s) => (
                vec!["status".to_string()],
                vec![vec![JsonValue::String(s)]],
                1,
            ),
            RespValue::Integer(n) => (
                vec!["result".to_string()],
                vec![vec![JsonValue::Number(n.into())]],
                1,
            ),
            RespValue::BulkString(Some(bytes)) => {
                let val = String::from_utf8_lossy(&bytes).to_string();
                (
                    vec!["value".to_string()],
                    vec![vec![JsonValue::String(val)]],
                    1,
                )
            }
            RespValue::BulkString(None) => (
                vec!["value".to_string()],
                vec![vec![JsonValue::Null]],
                0,
            ),
            RespValue::Array(Some(items)) => {
                let cmd_name = token_refs[0].to_uppercase();
                if cmd_name == "HGETALL" && items.len() % 2 == 0 {
                    let mut pair_rows = Vec::with_capacity(items.len() / 2);
                    for chunk in items.chunks(2) {
                        let f = chunk[0].as_str().unwrap_or_default();
                        let v = chunk[1].as_str().unwrap_or_default();
                        pair_rows.push(vec![JsonValue::String(f), JsonValue::String(v)]);
                    }
                    (vec!["field".to_string(), "value".to_string()], pair_rows, items.len() as u64 / 2)
                } else if cmd_name == "KEYS" {
                    let key_rows = items
                        .into_iter()
                        .map(|item| vec![JsonValue::String(item.as_str().unwrap_or_default())])
                        .collect::<Vec<_>>();
                    (vec!["key".to_string()], key_rows.clone(), key_rows.len() as u64)
                } else {
                    let mut list_rows = Vec::with_capacity(items.len());
                    for (idx, item) in items.into_iter().enumerate() {
                        list_rows.push(vec![
                            JsonValue::Number(idx.into()),
                            item.to_json(),
                        ]);
                    }
                    (vec!["index".to_string(), "value".to_string()], list_rows.clone(), list_rows.len() as u64)
                }
            }
            RespValue::Array(None) => (
                vec!["result".to_string()],
                vec![],
                0,
            ),
            RespValue::Error(err) => {
                return Err(AppError::Database(format!("Redis error: {err}")));
            }
        };

        Ok(QueryResult {
            columns,
            rows,
            rows_affected,
            execution_time_ms: start.elapsed().as_millis() as u64,
        })
    }

    /// @brief Executes a batch of DDL operations. Drops simulate FLUSHDB.
    async fn execute_ddl(&self, statements: &[String]) -> Result<MigrationReport, AppError> {
        let start = Instant::now();
        let mut executed = 0;

        for stmt in statements {
            let upper = stmt.to_uppercase();
            if upper.contains("DROP TABLE") || upper.contains("FLUSH") {
                self.execute_raw_command(&["FLUSHDB"]).await?;
                executed += 1;
            } else if upper.starts_with("DEL ") {
                let key = stmt[4..].trim();
                self.execute_raw_command(&["DEL", key]).await?;
                executed += 1;
            }
        }

        Ok(MigrationReport {
            success: true,
            statements_executed: executed,
            execution_time_ms: start.elapsed().as_millis() as u64,
            error_message: None,
        })
    }

    /// @brief Updates rows in the redis_keys table.
    async fn update_rows(&self, updates: Vec<RowUpdatePayload>) -> Result<u64, AppError> {
        let mut affected = 0;

        for update in updates {
            let key = match update.primary_keys.get("key") {
                Some(k) => match k {
                    JsonValue::String(s) => s.clone(),
                    other => other.to_string(),
                },
                None => continue,
            };

            if key.is_empty() {
                continue;
            }

            // Update value if present
            if let Some(val) = update.updated_values.get("value") {
                let val_str = match val {
                    JsonValue::String(s) => s.clone(),
                    other => other.to_string(),
                };
                self.execute_raw_command(&["SET", &key, &val_str]).await?;
                affected += 1;
            }

            // Update TTL if present
            if let Some(ttl_val) = update.updated_values.get("ttl") {
                if let Some(ttl_sec) = ttl_val.as_i64() {
                    if ttl_sec > 0 {
                        let sec_str = ttl_sec.to_string();
                        self.execute_raw_command(&["EXPIRE", &key, &sec_str]).await?;
                    } else if ttl_sec == -1 {
                        self.execute_raw_command(&["PERSIST", &key]).await?;
                    }
                }
            }
        }

        Ok(affected)
    }

    /// @brief Explains a Redis command execution strategy and time complexity.
    async fn explain_query(&self, sql: &str) -> Result<ExecutionPlanNode, AppError> {
        let trimmed = sql.trim();
        let first_word = trimmed
            .split_whitespace()
            .next()
            .unwrap_or("COMMAND")
            .to_uppercase();

        let (complexity, description) = match first_word.as_str() {
            "GET" | "SET" | "DEL" | "EXISTS" | "TYPE" | "TTL" => {
                ("O(1)", "Direct in-memory hash table lookup by key.")
            }
            "HGETALL" | "HKEYS" | "HVALS" => {
                ("O(N)", "Retrieves all hash fields where N is the number of fields.")
            }
            "LRANGE" => {
                ("O(S+N)", "Linear list traversal from start offset to stop offset.")
            }
            "KEYS" => {
                ("O(N) - BLOCKING", "WARNING: Iterates through all keys in the database. Use SCAN in production.")
            }
            "SCAN" => {
                ("O(1) per step", "Incremental cursor-based key iteration without blocking server.")
            }
            "PING" | "DBSIZE" | "SELECT" | "INFO" => {
                ("O(1)", "Internal server control and statistics query.")
            }
            _ => ("O(N)", "General Redis command execution."),
        };

        Ok(ExecutionPlanNode::new(
            format!("Redis Command: {first_word}"),
            None,
            1.0,
            1,
            Some(format!("Time Complexity: {complexity}. {description}")),
        ))
    }

    /// @brief Lists active Redis databases reporting keys, plus indices 0 through 15.
    async fn list_databases(&self) -> Result<Vec<String>, AppError> {
        let mut dbs = Vec::new();
        for i in 0..16 {
            dbs.push(format!("{i}"));
        }
        Ok(dbs)
    }

    /// @brief Returns the primary key column for Redis virtual tables.
    async fn primary_key_columns(&self, table: &str) -> Result<Vec<String>, AppError> {
        match table {
            "redis_keys" | "keys" => Ok(vec!["key".to_string()]),
            "redis_server_info" => Ok(vec!["property".to_string()]),
            "redis_client_list" => Ok(vec!["id".to_string()]),
            _ => Ok(vec!["key".to_string()]),
        }
    }

    /// @brief Identifies this driver as DatabaseType::Redis.
    fn db_type(&self) -> DatabaseType {
        DatabaseType::Redis
    }
}
