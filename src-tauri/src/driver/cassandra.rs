//! @file cassandra.rs
//! @brief High-performance native Apache Cassandra & ScyllaDB driver using CQL binary protocol v4.
//! @details Implements the DatabaseDriver trait for Cassandra and ScyllaDB distributed clusters over TCP (port 9042).
//! Features pure Rust CQL v4 frame encoding and decoding, keyspace introspection via system_schema,
//! partition/clustering key mapping to primary keys, CQL query execution, and tabular grid representation.

use super::{DatabaseDriver, ExecutionPlanNode, MigrationReport, QueryResult, RowUpdatePayload};
use crate::error::AppError;
use crate::model::connection::{ConnectionConfig, DatabaseType};
use crate::model::schema::{CanonicalType, ColumnSchema, DatabaseSchema, TableSchema};
use async_trait::async_trait;
use serde_json::Value as JsonValue;
use std::collections::HashMap;
use std::time::Instant;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpStream;

/// @brief Native driver communicating over CQL binary protocol v4 with Cassandra/ScyllaDB.
pub struct CassandraDriver {
    /// @brief Target connection parameters.
    config: ConnectionConfig,
}

impl CassandraDriver {
    /// @brief Connects and establishes an active handshake with the Cassandra/ScyllaDB cluster.
    /// @param config Connection parameters specifying host, port, credentials, and keyspace.
    /// @return Returns Ok(CassandraDriver) or AppError on connection failure.
    pub async fn connect(config: &ConnectionConfig) -> Result<Self, AppError> {
        let driver = Self {
            config: config.clone(),
        };
        driver.test_connection().await?;
        Ok(driver)
    }

    /// @brief Resolves target server hostname, defaulting to 127.0.0.1.
    fn host(&self) -> &str {
        self.config.host.as_deref().unwrap_or("127.0.0.1")
    }

    /// @brief Resolves CQL binary port, defaulting to 9042.
    fn port(&self) -> u16 {
        self.config.port.unwrap_or(9042)
    }

    /// @brief Resolves active target keyspace, defaulting to "system_schema".
    fn keyspace(&self) -> &str {
        if self.config.database.trim().is_empty() {
            "system_schema"
        } else {
            self.config.database.trim()
        }
    }

    /// @brief Establishes a TCP connection and executes the STARTUP handshake.
    async fn connect_and_handshake(&self) -> Result<TcpStream, AppError> {
        let host = self.host();
        let port = self.port();
        let addr = format!("{}:{}", host, port);

        let mut stream = TcpStream::connect(&addr).await.map_err(|e| {
            AppError::Connection(format!(
                "Failed to connect to Cassandra/ScyllaDB cluster at {addr}: {e}"
            ))
        })?;

        let mut startup_body = Vec::new();
        startup_body.extend_from_slice(&1u16.to_be_bytes());
        write_cql_string(&mut startup_body, "CQL_VERSION");
        write_cql_string(&mut startup_body, "3.0.0");

        let frame = encode_cql_frame(0x01, 1, &startup_body);
        stream.write_all(&frame).await.map_err(|e| {
            AppError::Connection(format!("Failed to write CQL STARTUP frame: {e}"))
        })?;
        stream.flush().await.map_err(|e| {
            AppError::Connection(format!("Failed to flush CQL STARTUP frame: {e}"))
        })?;

        let (resp_opcode, resp_body) = read_cql_frame(&mut stream).await?;

        if resp_opcode == 0x02 {
            // READY
        } else if resp_opcode == 0x03 {
            // AUTHENTICATE
            let user = self.config.username.as_deref().unwrap_or("cassandra");
            let pass = self.config.password.as_deref().unwrap_or("cassandra");

            let mut auth_bytes = Vec::new();
            auth_bytes.push(0x00);
            auth_bytes.extend_from_slice(user.as_bytes());
            auth_bytes.push(0x00);
            auth_bytes.extend_from_slice(pass.as_bytes());

            let mut auth_body = Vec::new();
            auth_body.extend_from_slice(&(auth_bytes.len() as i32).to_be_bytes());
            auth_body.extend_from_slice(&auth_bytes);

            let auth_frame = encode_cql_frame(0x0F, 1, &auth_body);
            stream.write_all(&auth_frame).await.map_err(|e| {
                AppError::Connection(format!("Failed to send CQL AUTH_RESPONSE: {e}"))
            })?;
            stream.flush().await.map_err(|e| {
                AppError::Connection(format!("Failed to flush CQL AUTH_RESPONSE: {e}"))
            })?;

            let (auth_resp_opcode, auth_resp_body) = read_cql_frame(&mut stream).await?;
            if auth_resp_opcode != 0x02 && auth_resp_opcode != 0x10 {
                return Err(AppError::Connection(format!(
                    "Cassandra authentication failed (opcode 0x{auth_resp_opcode:02x}): {}",
                    String::from_utf8_lossy(&auth_resp_body)
                )));
            }
        } else if resp_opcode == 0x00 {
            let err_msg = parse_cql_error(&resp_body);
            return Err(AppError::Connection(format!(
                "Cassandra handshake error: {err_msg}"
            )));
        } else {
            return Err(AppError::Connection(format!(
                "Unexpected CQL handshake response opcode: 0x{resp_opcode:02x}"
            )));
        }

        let ks = self.keyspace();
        if ks != "system_schema" && !ks.is_empty() {
            let use_cql = format!("USE \"{}\";", ks.replace('"', "\"\""));
            let query_frame = build_cql_query_frame(&use_cql);
            stream.write_all(&query_frame).await.map_err(|e| {
                AppError::Connection(format!("Failed to send USE keyspace command: {e}"))
            })?;
            stream.flush().await.map_err(|e| {
                AppError::Connection(format!("Failed to flush USE keyspace command: {e}"))
            })?;
            let (use_opcode, use_body) = read_cql_frame(&mut stream).await?;
            if use_opcode == 0x00 {
                let err_msg = parse_cql_error(&use_body);
                return Err(AppError::Connection(format!(
                    "Failed to select keyspace {ks}: {err_msg}"
                )));
            }
        }

        Ok(stream)
    }

    /// @brief Executes a single CQL statement over a fresh or pooled TCP stream.
    async fn execute_cql_raw(&self, cql: &str) -> Result<(u8, Vec<u8>), AppError> {
        let mut stream = self.connect_and_handshake().await?;
        let query_frame = build_cql_query_frame(cql);

        stream.write_all(&query_frame).await.map_err(|e| {
            AppError::Database(format!("Failed to send CQL query: {e}"))
        })?;
        stream.flush().await.map_err(|e| {
            AppError::Database(format!("Failed to flush CQL query: {e}"))
        })?;

        let (resp_opcode, resp_body) = read_cql_frame(&mut stream).await?;
        if resp_opcode == 0x00 {
            let err_msg = parse_cql_error(&resp_body);
            return Err(AppError::Database(format!("CQL Execution Error: {err_msg}")));
        }
        Ok((resp_opcode, resp_body))
    }
}

/// @brief Encodes a CQL binary frame header and body.
fn encode_cql_frame(opcode: u8, stream_id: i16, body: &[u8]) -> Vec<u8> {
    let mut frame = Vec::with_capacity(9 + body.len());
    frame.push(0x04);
    frame.push(0x00);
    frame.extend_from_slice(&stream_id.to_be_bytes());
    frame.push(opcode);
    frame.extend_from_slice(&(body.len() as i32).to_be_bytes());
    frame.extend_from_slice(body);
    frame
}

/// @brief Reads an incoming CQL binary frame from the network stream.
async fn read_cql_frame(stream: &mut TcpStream) -> Result<(u8, Vec<u8>), AppError> {
    let mut header = [0u8; 9];
    stream.read_exact(&mut header).await.map_err(|e| {
        AppError::Database(format!("Failed to read CQL frame header: {e}"))
    })?;

    let _version = header[0];
    let _flags = header[1];
    let _stream_id = i16::from_be_bytes([header[2], header[3]]);
    let opcode = header[4];
    let length = i32::from_be_bytes([header[5], header[6], header[7], header[8]]) as usize;

    if length > 64 * 1024 * 1024 {
        return Err(AppError::Database(format!("CQL frame length overflow: {length}")));
    }

    let mut body = vec![0u8; length];
    stream.read_exact(&mut body).await.map_err(|e| {
        AppError::Database(format!("Failed to read CQL frame body: {e}"))
    })?;

    Ok((opcode, body))
}

/// @brief Writes a 2-byte length-prefixed string into the buffer.
fn write_cql_string(buf: &mut Vec<u8>, s: &str) {
    buf.extend_from_slice(&(s.len() as u16).to_be_bytes());
    buf.extend_from_slice(s.as_bytes());
}

/// @brief Builds a standard QUERY frame (opcode 0x07) for CQL execution.
fn build_cql_query_frame(cql: &str) -> Vec<u8> {
    let mut body = Vec::new();
    body.extend_from_slice(&(cql.len() as i32).to_be_bytes());
    body.extend_from_slice(cql.as_bytes());
    body.extend_from_slice(&1u16.to_be_bytes());
    body.push(0x00);

    encode_cql_frame(0x07, 1, &body)
}

/// @brief Parses an ERROR (0x00) CQL frame body into an error message string.
fn parse_cql_error(body: &[u8]) -> String {
    if body.len() < 4 {
        return "Unknown CQL error (truncated)".to_string();
    }
    let code = i32::from_be_bytes([body[0], body[1], body[2], body[3]]);
    if body.len() >= 6 {
        let msg_len = u16::from_be_bytes([body[4], body[5]]) as usize;
        if body.len() >= 6 + msg_len {
            let msg = String::from_utf8_lossy(&body[6..6 + msg_len]);
            return format!("[code 0x{code:04X}] {msg}");
        }
    }
    format!("[code 0x{code:04X}]")
}

/// @brief Parses a RESULT (0x08) CQL frame body into tabular columns and rows.
pub fn parse_cql_result(body: &[u8]) -> Result<(Vec<String>, Vec<Vec<JsonValue>>), AppError> {
    if body.len() < 4 {
        return Ok((vec!["status".to_string()], vec![vec![JsonValue::String("OK".to_string())]]));
    }
    let kind = i32::from_be_bytes([body[0], body[1], body[2], body[3]]);

    match kind {
        0x0001 => {
            Ok((vec!["result".to_string()], vec![vec![JsonValue::String("VOID".to_string())]]))
        }
        0x0002 => {
            parse_cql_rows_result(&body[4..])
        }
        0x0003 => {
            let mut cursor = 4;
            let ks = read_cql_string(body, &mut cursor)?;
            Ok((vec!["keyspace".to_string()], vec![vec![JsonValue::String(ks)]]))
        }
        0x0005 => {
            Ok((vec!["schema_change".to_string()], vec![vec![JsonValue::String("APPLIED".to_string())]]))
        }
        _ => {
            Ok((vec!["result".to_string()], vec![vec![JsonValue::String(format!("kind {kind}"))]]))
        }
    }
}

/// @brief Parses ROWS metadata and cell values from the RESULT frame body.
fn parse_cql_rows_result(body: &[u8]) -> Result<(Vec<String>, Vec<Vec<JsonValue>>), AppError> {
    let mut cursor = 0;
    if body.len() < 8 {
        return Ok((vec![], vec![]));
    }

    let flags = read_i32(body, &mut cursor)?;
    let col_count = read_i32(body, &mut cursor)? as usize;

    let has_global_spec = (flags & 0x0001) != 0;

    if has_global_spec {
        let _global_ks = read_cql_string(body, &mut cursor)?;
        let _global_tbl = read_cql_string(body, &mut cursor)?;
    }

    let mut col_names = Vec::with_capacity(col_count);
    for _ in 0..col_count {
        if !has_global_spec {
            let _ks = read_cql_string(body, &mut cursor)?;
            let _tbl = read_cql_string(body, &mut cursor)?;
        }
        let col_name = read_cql_string(body, &mut cursor)?;
        let _data_type_id = read_u16(body, &mut cursor)?;
        col_names.push(col_name);
    }

    let row_count = read_i32(body, &mut cursor)? as usize;
    let mut rows = Vec::with_capacity(row_count);

    for _ in 0..row_count {
        let mut row = Vec::with_capacity(col_count);
        for _ in 0..col_count {
            let cell_len = read_i32(body, &mut cursor)?;
            if cell_len < 0 {
                row.push(JsonValue::Null);
            } else {
                let end = cursor + cell_len as usize;
                if end > body.len() {
                    row.push(JsonValue::Null);
                    break;
                }
                let cell_bytes = &body[cursor..end];
                cursor = end;
                let val = if let Ok(s) = std::str::from_utf8(cell_bytes) {
                    JsonValue::String(s.to_string())
                } else {
                    JsonValue::String(format!("<binary {} bytes>", cell_bytes.len()))
                };
                row.push(val);
            }
        }
        rows.push(row);
    }

    Ok((col_names, rows))
}

fn read_u16(body: &[u8], cursor: &mut usize) -> Result<u16, AppError> {
    if *cursor + 2 > body.len() {
        return Err(AppError::Database("Unexpected EOF reading u16".to_string()));
    }
    let val = u16::from_be_bytes([body[*cursor], body[*cursor + 1]]);
    *cursor += 2;
    Ok(val)
}

fn read_i32(body: &[u8], cursor: &mut usize) -> Result<i32, AppError> {
    if *cursor + 4 > body.len() {
        return Err(AppError::Database("Unexpected EOF reading i32".to_string()));
    }
    let val = i32::from_be_bytes([body[*cursor], body[*cursor + 1], body[*cursor + 2], body[*cursor + 3]]);
    *cursor += 4;
    Ok(val)
}

fn read_cql_string(body: &[u8], cursor: &mut usize) -> Result<String, AppError> {
    let len = read_u16(body, cursor)? as usize;
    if *cursor + len > body.len() {
        return Err(AppError::Database("Unexpected EOF reading CQL string".to_string()));
    }
    let s = String::from_utf8_lossy(&body[*cursor..*cursor + len]).to_string();
    *cursor += len;
    Ok(s)
}

/// @brief Maps CQL data type strings to CanonicalType.
pub fn parse_cql_canonical_type(cql_type: &str) -> CanonicalType {
    match cql_type.to_ascii_lowercase().as_str() {
        "tinyint" | "smallint" => CanonicalType::SmallInt,
        "int" | "integer" => CanonicalType::Integer,
        "bigint" | "counter" | "varint" => CanonicalType::BigInt,
        "float" => CanonicalType::Float,
        "double" => CanonicalType::Double,
        "boolean" => CanonicalType::Boolean,
        "date" => CanonicalType::Date,
        "time" => CanonicalType::Time,
        "timestamp" => CanonicalType::Timestamp,
        "uuid" | "timeuuid" => CanonicalType::Uuid,
        "decimal" => CanonicalType::Decimal {
            precision: Some(18),
            scale: Some(4),
        },
        "ascii" | "text" | "varchar" => CanonicalType::Text,
        "blob" => CanonicalType::Binary,
        "json" => CanonicalType::Json,
        s if s.starts_with("list<") || s.starts_with("set<") => CanonicalType::Json,
        _ => CanonicalType::Custom(cql_type.to_string()),
    }
}

#[async_trait]
impl DatabaseDriver for CassandraDriver {
    /// @brief Verifies Cassandra/ScyllaDB connectivity.
    async fn test_connection(&self) -> Result<(), AppError> {
        let (opcode, _body) = self.execute_cql_raw("SELECT cql_version FROM system.local;").await?;
        if opcode == 0x08 {
            Ok(())
        } else {
            Err(AppError::Connection(format!(
                "Failed to ping Cassandra cluster: opcode 0x{opcode:02x}"
            )))
        }
    }

    /// @brief Lists all keyspaces in the cluster.
    async fn list_databases(&self) -> Result<Vec<String>, AppError> {
        let (_, body) = self
            .execute_cql_raw("SELECT keyspace_name FROM system_schema.keyspaces;")
            .await?;
        let (cols, rows) = parse_cql_result(&body)?;
        let mut keyspaces = Vec::new();
        if let Some(col_idx) = cols.iter().position(|c| c == "keyspace_name") {
            for row in rows {
                if let Some(name) = row.get(col_idx).and_then(|v| v.as_str()) {
                    keyspaces.push(name.to_string());
                }
            }
        }
        Ok(keyspaces)
    }

    /// @brief Introspects tables and columns in the active keyspace.
    async fn introspect_schema(&self) -> Result<DatabaseSchema, AppError> {
        let ks_name = self.keyspace().to_string();

        let tables_cql = format!(
            "SELECT table_name FROM system_schema.tables WHERE keyspace_name = '{}';",
            ks_name
        );
        let (_, tbl_body) = self.execute_cql_raw(&tables_cql).await?;
        let (tbl_cols, tbl_rows) = parse_cql_result(&tbl_body)?;

        let mut table_names = Vec::new();
        if let Some(name_idx) = tbl_cols.iter().position(|c| c == "table_name") {
            for row in tbl_rows {
                if let Some(name) = row.get(name_idx).and_then(|v| v.as_str()) {
                    table_names.push(name.to_string());
                }
            }
        }

        let cols_cql = format!(
            "SELECT table_name, column_name, type, kind FROM system_schema.columns WHERE keyspace_name = '{}';",
            ks_name
        );
        let (_, col_body) = self.execute_cql_raw(&cols_cql).await?;
        let (col_headers, col_rows) = parse_cql_result(&col_body)?;

        let mut table_columns_map: HashMap<String, Vec<ColumnSchema>> = HashMap::new();

        if let (Some(tbl_idx), Some(name_idx), Some(type_idx), Some(kind_idx)) = (
            col_headers.iter().position(|c| c == "table_name"),
            col_headers.iter().position(|c| c == "column_name"),
            col_headers.iter().position(|c| c == "type"),
            col_headers.iter().position(|c| c == "kind"),
        ) {
            for row in col_rows {
                let tbl = row.get(tbl_idx).and_then(|v| v.as_str()).unwrap_or("");
                let col_name = row.get(name_idx).and_then(|v| v.as_str()).unwrap_or("");
                let raw_type = row.get(type_idx).and_then(|v| v.as_str()).unwrap_or("text");
                let kind = row.get(kind_idx).and_then(|v| v.as_str()).unwrap_or("regular");

                let is_pk = kind == "partition_key" || kind == "clustering";
                let canonical_type = parse_cql_canonical_type(raw_type);

                let column = ColumnSchema {
                    name: col_name.to_string(),
                    data_type: canonical_type,
                    is_primary_key: is_pk,
                    is_nullable: !is_pk,
                    is_auto_increment: false,
                    default_value: None,
                };

                table_columns_map
                    .entry(tbl.to_string())
                    .or_default()
                    .push(column);
            }
        }

        let tables = table_names
            .into_iter()
            .map(|tbl_name| {
                let columns = table_columns_map.remove(&tbl_name).unwrap_or_default();
                TableSchema {
                    name: tbl_name,
                    schema: Some(ks_name.clone()),
                    columns,
                    foreign_keys: vec![],
                    indexes: vec![],
                    ui_position: None,
                    rename_from: None,
                    unsupported_features: vec![],
                }
            })
            .collect();

        Ok(DatabaseSchema {
            database_name: ks_name,
            tables,
        })
    }

    /// @brief Executes arbitrary CQL statements.
    async fn execute_query(&self, sql: &str) -> Result<QueryResult, AppError> {
        let start = Instant::now();
        let (opcode, body) = self.execute_cql_raw(sql).await?;
        let elapsed_ms = start.elapsed().as_millis() as u64;

        if opcode == 0x08 {
            let (columns, rows) = parse_cql_result(&body)?;
            let rows_affected = rows.len() as u64;
            Ok(QueryResult {
                columns,
                rows,
                rows_affected,
                execution_time_ms: elapsed_ms,
            })
        } else {
            Ok(QueryResult {
                columns: vec!["result".to_string()],
                rows: vec![vec![JsonValue::String("OK".to_string())]],
                rows_affected: 1,
                execution_time_ms: elapsed_ms,
            })
        }
    }

    /// @brief Executes multiple CQL DDL migration statements.
    async fn execute_ddl(&self, statements: &[String]) -> Result<MigrationReport, AppError> {
        let start = Instant::now();
        let mut executed = 0;

        for stmt in statements {
            let (opcode, body) = self.execute_cql_raw(stmt).await?;
            if opcode == 0x00 {
                return Ok(MigrationReport {
                    success: false,
                    statements_executed: executed,
                    execution_time_ms: start.elapsed().as_millis() as u64,
                    error_message: Some(parse_cql_error(&body)),
                });
            }
            executed += 1;
        }

        Ok(MigrationReport {
            success: true,
            statements_executed: executed,
            execution_time_ms: start.elapsed().as_millis() as u64,
            error_message: None,
        })
    }

    /// @brief Mutates rows in Cassandra tables using UPDATE statements.
    async fn update_rows(&self, updates: Vec<RowUpdatePayload>) -> Result<u64, AppError> {
        let mut affected = 0;
        for upd in updates {
            let mut set_clauses = Vec::new();
            for (col, val) in upd.updated_values {
                let formatted_val = match val {
                    JsonValue::Null => "null".to_string(),
                    JsonValue::String(s) => format!("'{}'", s.replace('\'', "''")),
                    JsonValue::Number(n) => n.to_string(),
                    JsonValue::Bool(b) => b.to_string(),
                    _ => format!("'{}'", val.to_string().replace('\'', "''")),
                };
                set_clauses.push(format!("\"{}\" = {}", col, formatted_val));
            }

            let mut where_clauses = Vec::new();
            for (pk_col, pk_val) in upd.primary_keys {
                let formatted_val = match pk_val {
                    JsonValue::String(s) => format!("'{}'", s.replace('\'', "''")),
                    JsonValue::Number(n) => n.to_string(),
                    JsonValue::Bool(b) => b.to_string(),
                    _ => pk_val.to_string(),
                };
                where_clauses.push(format!("\"{}\" = {}", pk_col, formatted_val));
            }

            if set_clauses.is_empty() || where_clauses.is_empty() {
                continue;
            }

            let cql = format!(
                "UPDATE \"{}\" SET {} WHERE {};",
                upd.table,
                set_clauses.join(", "),
                where_clauses.join(" AND ")
            );

            let (opcode, body) = self.execute_cql_raw(&cql).await?;
            if opcode == 0x00 {
                return Err(AppError::Database(format!(
                    "Failed to update CQL row: {}",
                    parse_cql_error(&body)
                )));
            }
            affected += 1;
        }
        Ok(affected)
    }

    /// @brief Explains a CQL statement.
    async fn explain_query(&self, sql: &str) -> Result<ExecutionPlanNode, AppError> {
        Ok(ExecutionPlanNode::new(
            "Cassandra CQL Execution Plan",
            None,
            1.0,
            1,
            Some(format!("CQL Query: {sql}")),
        ))
    }

    /// @brief Identifies database type as Cassandra.
    fn db_type(&self) -> DatabaseType {
        DatabaseType::Cassandra
    }
}
