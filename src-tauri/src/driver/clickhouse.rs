//! @file clickhouse.rs
//! @brief High-performance native ClickHouse database driver using HTTP JSONCompact protocol.
//! @details Implements the DatabaseDriver trait for ClickHouse columnar analytical database clusters.
//! Communicates natively over HTTP (port 8123) with JSONCompact formatting, supporting catalog
//! introspection via system.tables and system.columns, SQL analytics, DDL migrations, and execution plans.

use super::{DatabaseDriver, ExecutionPlanNode, MigrationReport, QueryResult, RowUpdatePayload};
use crate::error::AppError;
use crate::model::connection::{ConnectionConfig, DatabaseType};
use crate::model::schema::{CanonicalType, ColumnSchema, DatabaseSchema, TableSchema};
use async_trait::async_trait;
use serde_json::Value as JsonValue;
use std::time::Instant;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpStream;

/// @brief Native ClickHouse database driver communicating via ClickHouse HTTP interface.
pub struct ClickHouseDriver {
    /// @brief Connection profile configuration holding host, port, credentials, and catalog.
    config: ConnectionConfig,
}

impl ClickHouseDriver {
    /// @brief Connects and initializes a ClickHouseDriver instance.
    /// @param config Connection parameters containing ClickHouse host, port, user, and password.
    /// @return Returns Ok(ClickHouseDriver) or AppError on connection failure.
    pub async fn connect(config: &ConnectionConfig) -> Result<Self, AppError> {
        let driver = Self {
            config: config.clone(),
        };
        driver.test_connection().await?;
        Ok(driver)
    }

    /// @brief Resolves target hostname, falling back to 127.0.0.1 if unspecified.
    fn host(&self) -> &str {
        self.config.host.as_deref().unwrap_or("127.0.0.1")
    }

    /// @brief Resolves HTTP port, defaulting to 8123 for ClickHouse HTTP interface.
    fn port(&self) -> u16 {
        self.config.port.unwrap_or(8123)
    }

    /// @brief Resolves active database catalog, defaulting to "default".
    fn database(&self) -> &str {
        if self.config.database.trim().is_empty() {
            "default"
        } else {
            self.config.database.trim()
        }
    }

    /// @brief Executes a raw HTTP POST request to the ClickHouse server endpoint.
    /// @param query SQL statement or command body.
    /// @param database_override Optional target database name override.
    /// @return Returns status code, response body string, and execution duration in ms.
    pub async fn raw_http_post(
        &self,
        query: &str,
        database_override: Option<&str>,
    ) -> Result<(u16, String, u64), AppError> {
        let host = self.host();
        let port = self.port();
        let start = Instant::now();

        let db = database_override.unwrap_or_else(|| self.database());
        let addr = format!("{}:{}", host, port);

        let mut stream = TcpStream::connect(&addr).await.map_err(|e| {
            AppError::Connection(format!(
                "Failed to connect to ClickHouse server at {}: {e}",
                addr
            ))
        })?;

        let body_bytes = query.as_bytes();
        let user = self.config.username.as_deref().unwrap_or("default");
        let pass = self.config.password.as_deref().unwrap_or("");

        let path = format!("/?database={}", urlencoding::encode(db));

        let auth_header = if !pass.is_empty() || user != "default" {
            let credentials = format!("{}:{}", user, pass);
            let encoded = base64_encode(credentials.as_bytes());
            format!("Authorization: Basic {}\r\n", encoded)
        } else {
            String::new()
        };

        let request = format!(
            "POST {} HTTP/1.1\r\n\
             Host: {}:{}\r\n\
             User-Agent: DynoDbModeler/0.2.0\r\n\
             Content-Type: text/plain; charset=utf-8\r\n\
             Content-Length: {}\r\n\
             {}Connection: close\r\n\
             \r\n",
            path,
            host,
            port,
            body_bytes.len(),
            auth_header
        );

        stream
            .write_all(request.as_bytes())
            .await
            .map_err(|e| AppError::Database(format!("Failed to write HTTP header to ClickHouse: {e}")))?;

        stream
            .write_all(body_bytes)
            .await
            .map_err(|e| AppError::Database(format!("Failed to write query body to ClickHouse: {e}")))?;

        stream.flush().await.map_err(|e| {
            AppError::Database(format!("Failed to flush HTTP request to ClickHouse: {e}"))
        })?;

        let mut response_bytes = Vec::new();
        stream
            .read_to_end(&mut response_bytes)
            .await
            .map_err(|e| AppError::Database(format!("Failed to read ClickHouse HTTP response: {e}")))?;

        let elapsed_ms = start.elapsed().as_millis() as u64;

        let response_str = String::from_utf8_lossy(&response_bytes).to_string();
        let (status_code, body) = parse_http_response(&response_str)?;

        Ok((status_code, body, elapsed_ms))
    }
}

/// @brief Minimal URL encoding helper for path parameters.
mod urlencoding {
    /// @brief Percent-encodes characters not unreserved in RFC 3986.
    pub fn encode(s: &str) -> String {
        let mut out = String::with_capacity(s.len());
        for byte in s.bytes() {
            if byte.is_ascii_alphanumeric() || byte == b'-' || byte == b'_' || byte == b'.' || byte == b'~' {
                out.push(byte as char);
            } else {
                out.push_str(&format!("%{:02X}", byte));
            }
        }
        out
    }
}

/// @brief Base64 encoding helper for HTTP Basic authentication headers.
fn base64_encode(input: &[u8]) -> String {
    const TABLE: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut out = String::with_capacity((input.len() + 2) / 3 * 4);
    for chunk in input.chunks(3) {
        let b0 = chunk[0];
        let b1 = if chunk.len() > 1 { chunk[1] } else { 0 };
        let b2 = if chunk.len() > 2 { chunk[2] } else { 0 };

        out.push(TABLE[(b0 >> 2) as usize] as char);
        out.push(TABLE[(((b0 & 0x03) << 4) | (b1 >> 4)) as usize] as char);
        if chunk.len() > 1 {
            out.push(TABLE[(((b1 & 0x0F) << 2) | (b2 >> 6)) as usize] as char);
        } else {
            out.push('=');
        }
        if chunk.len() > 2 {
            out.push(TABLE[(b2 & 0x3F) as usize] as char);
        } else {
            out.push('=');
        }
    }
    out
}

/// @brief Parses an HTTP/1.1 response string into status code and body content.
fn parse_http_response(raw: &str) -> Result<(u16, String), AppError> {
    let mut parts = raw.splitn(2, "\r\n\r\n");
    let header_part = parts.next().unwrap_or("");
    let body_part = parts.next().unwrap_or("");

    let status_line = header_part.lines().next().unwrap_or("");
    let mut tokens = status_line.split_whitespace();
    let _http_version = tokens.next();
    let status_code: u16 = tokens
        .next()
        .and_then(|code| code.parse().ok())
        .unwrap_or(500);

    let is_chunked = header_part
        .lines()
        .any(|line| line.to_ascii_lowercase().starts_with("transfer-encoding:") && line.to_ascii_lowercase().contains("chunked"));

    let body = if is_chunked {
        decode_chunked_body(body_part)
    } else {
        body_part.to_string()
    };

    Ok((status_code, body))
}

/// @brief Decodes chunked HTTP transfer encoding stream chunks.
fn decode_chunked_body(raw: &str) -> String {
    let mut out = String::new();
    let mut remaining = raw;
    while !remaining.is_empty() {
        let mut lines = remaining.splitn(2, "\r\n");
        let size_str = lines.next().unwrap_or("").trim();
        let chunk_data = lines.next().unwrap_or("");
        if let Ok(size) = usize::from_str_radix(size_str, 16) {
            if size == 0 {
                break;
            }
            if chunk_data.len() >= size {
                out.push_str(&chunk_data[..size]);
                let after = &chunk_data[size..];
                remaining = after.strip_prefix("\r\n").unwrap_or(after);
            } else {
                out.push_str(chunk_data);
                break;
            }
        } else {
            out.push_str(remaining);
            break;
        }
    }
    out
}

/// @brief Maps ClickHouse raw column type strings into CanonicalType representations.
pub fn parse_clickhouse_canonical_type(ch_type: &str) -> CanonicalType {
    let trimmed = ch_type.trim();
    let lower = trimmed.to_ascii_lowercase();

    if lower.starts_with("nullable(") && lower.ends_with(')') {
        let inner = &trimmed[9..trimmed.len() - 1];
        return parse_clickhouse_canonical_type(inner);
    }
    if lower.starts_with("lowcardinality(") && lower.ends_with(')') {
        let inner = &trimmed[15..trimmed.len() - 1];
        return parse_clickhouse_canonical_type(inner);
    }

    if lower == "uint8" || lower == "int8" || lower == "int16" {
        CanonicalType::SmallInt
    } else if lower == "uint16" || lower == "int32" {
        CanonicalType::Integer
    } else if lower == "uint32" || lower == "int64" || lower == "uint64" {
        CanonicalType::BigInt
    } else if lower == "float32" || lower == "float64" {
        CanonicalType::Double
    } else if lower == "bool" || lower == "boolean" {
        CanonicalType::Boolean
    } else if lower == "date" || lower == "date32" {
        CanonicalType::Date
    } else if lower.starts_with("datetime") {
        CanonicalType::Timestamp
    } else if lower == "uuid" {
        CanonicalType::Uuid
    } else if lower.starts_with("decimal") {
        CanonicalType::Decimal {
            precision: Some(18),
            scale: Some(4),
        }
    } else if lower.starts_with("fixedstring") {
        CanonicalType::Char(Some(32))
    } else if lower == "string" {
        CanonicalType::Text
    } else if lower.starts_with("array(") || lower.starts_with("json") || lower.starts_with("tuple(") || lower.starts_with("map(") {
        CanonicalType::Json
    } else {
        CanonicalType::Custom(trimmed.to_string())
    }
}

#[async_trait]
impl DatabaseDriver for ClickHouseDriver {
    /// @brief Verifies that ClickHouse server is reachable and responsive.
    async fn test_connection(&self) -> Result<(), AppError> {
        let (status, body, _) = self
            .raw_http_post("SELECT 1 FORMAT JSONCompact", None)
            .await?;
        if status == 200 {
            Ok(())
        } else {
            Err(AppError::Connection(format!(
                "ClickHouse returned HTTP error status {status}: {body}"
            )))
        }
    }

    /// @brief Lists all database catalogs available on the ClickHouse server.
    async fn list_databases(&self) -> Result<Vec<String>, AppError> {
        let (status, body, _) = self
            .raw_http_post("SHOW DATABASES FORMAT JSONCompact", Some("default"))
            .await?;
        if status != 200 {
            return Err(AppError::Database(format!(
                "Failed to list ClickHouse databases: {body}"
            )));
        }

        let json: JsonValue = serde_json::from_str(&body)
            .map_err(|e| AppError::Database(format!("Failed to parse ClickHouse JSON response: {e}")))?;

        let mut databases = Vec::new();
        if let Some(data) = json.get("data").and_then(|d| d.as_array()) {
            for row in data {
                if let Some(db_name) = row.get(0).and_then(|v| v.as_str()) {
                    databases.push(db_name.to_string());
                }
            }
        }
        Ok(databases)
    }

    /// @brief Introspects ClickHouse system catalogs for tables and columns.
    async fn introspect_schema(&self) -> Result<DatabaseSchema, AppError> {
        let db_name = self.database().to_string();

        let tables_sql = format!(
            "SELECT name, engine, total_rows, comment \
             FROM system.tables \
             WHERE database = '{}' AND is_temporary = 0 \
             ORDER BY name FORMAT JSONCompact",
            db_name
        );
        let (status, tables_body, _) = self.raw_http_post(&tables_sql, Some(&db_name)).await?;
        if status != 200 {
            return Err(AppError::Introspection(format!(
                "Failed to query system.tables in ClickHouse: {tables_body}"
            )));
        }

        let tables_json: JsonValue = serde_json::from_str(&tables_body).map_err(|e| {
            AppError::Introspection(format!("Failed to parse system.tables JSON: {e}"))
        })?;

        let mut table_names = Vec::new();
        if let Some(data) = tables_json.get("data").and_then(|d| d.as_array()) {
            for row in data {
                if let Some(name) = row.get(0).and_then(|v| v.as_str()) {
                    table_names.push(name.to_string());
                }
            }
        }

        let cols_sql = format!(
            "SELECT table, name, type, is_in_primary_key, default_expression \
             FROM system.columns \
             WHERE database = '{}' \
             ORDER BY table, position FORMAT JSONCompact",
            db_name
        );
        let (status, cols_body, _) = self.raw_http_post(&cols_sql, Some(&db_name)).await?;
        if status != 200 {
            return Err(AppError::Introspection(format!(
                "Failed to query system.columns in ClickHouse: {cols_body}"
            )));
        }

        let cols_json: JsonValue = serde_json::from_str(&cols_body).map_err(|e| {
            AppError::Introspection(format!("Failed to parse system.columns JSON: {e}"))
        })?;

        let mut table_columns_map: std::collections::HashMap<String, Vec<ColumnSchema>> =
            std::collections::HashMap::new();

        if let Some(data) = cols_json.get("data").and_then(|d| d.as_array()) {
            for row in data {
                let tbl = row.get(0).and_then(|v| v.as_str()).unwrap_or("");
                let col_name = row.get(1).and_then(|v| v.as_str()).unwrap_or("");
                let raw_type = row.get(2).and_then(|v| v.as_str()).unwrap_or("String");
                let is_pk = row
                    .get(3)
                    .and_then(|v| v.as_u64())
                    .map(|n| n == 1)
                    .unwrap_or(false);
                let default_expr = row
                    .get(4)
                    .and_then(|v| v.as_str())
                    .filter(|s| !s.is_empty())
                    .map(|s| s.to_string());

                let canonical_type = parse_clickhouse_canonical_type(raw_type);
                let is_nullable = raw_type.to_ascii_lowercase().contains("nullable(");

                let column = ColumnSchema {
                    name: col_name.to_string(),
                    data_type: canonical_type,
                    is_primary_key: is_pk,
                    is_nullable,
                    is_auto_increment: false,
                    default_value: default_expr,
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
                    schema: Some(db_name.clone()),
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
            database_name: db_name,
            tables,
        })
    }

    /// @brief Executes arbitrary ClickHouse SQL statements, parsing JSONCompact query responses.
    async fn execute_query(&self, sql: &str) -> Result<QueryResult, AppError> {
        let trimmed = sql.trim();
        let is_select = trimmed.to_ascii_uppercase().starts_with("SELECT")
            || trimmed.to_ascii_uppercase().starts_with("SHOW")
            || trimmed.to_ascii_uppercase().starts_with("DESCRIBE")
            || trimmed.to_ascii_uppercase().starts_with("EXPLAIN");

        let formatted_sql = if is_select && !trimmed.to_ascii_uppercase().contains("FORMAT") {
            format!("{} FORMAT JSONCompact", trimmed)
        } else {
            trimmed.to_string()
        };

        let (status, body, elapsed_ms) = self.raw_http_post(&formatted_sql, None).await?;

        if status != 200 {
            return Err(AppError::Database(format!(
                "ClickHouse execution error (status {status}): {body}"
            )));
        }

        if is_select {
            if let Ok(json) = serde_json::from_str::<JsonValue>(&body) {
                let mut columns = Vec::new();
                if let Some(meta) = json.get("meta").and_then(|m| m.as_array()) {
                    for col_meta in meta {
                        if let Some(name) = col_meta.get("name").and_then(|n| n.as_str()) {
                            columns.push(name.to_string());
                        }
                    }
                }

                let rows = json
                    .get("data")
                    .and_then(|d| d.as_array())
                    .cloned()
                    .unwrap_or_default()
                    .into_iter()
                    .map(|r| r.as_array().cloned().unwrap_or_default())
                    .collect::<Vec<Vec<JsonValue>>>();

                let rows_affected = rows.len() as u64;

                return Ok(QueryResult {
                    columns,
                    rows,
                    rows_affected,
                    execution_time_ms: elapsed_ms,
                });
            }
        }

        Ok(QueryResult {
            columns: vec!["status".to_string()],
            rows: vec![vec![JsonValue::String("OK".to_string())]],
            rows_affected: 1,
            execution_time_ms: elapsed_ms,
        })
    }

    /// @brief Executes multiple DDL migration statements against ClickHouse.
    async fn execute_ddl(&self, statements: &[String]) -> Result<MigrationReport, AppError> {
        let start = Instant::now();
        let mut executed = 0;

        for stmt in statements {
            let (status, body, _) = self.raw_http_post(stmt, None).await?;
            if status != 200 {
                return Ok(MigrationReport {
                    success: false,
                    statements_executed: executed,
                    execution_time_ms: start.elapsed().as_millis() as u64,
                    error_message: Some(format!("ClickHouse DDL error: {body}")),
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

    /// @brief Mutates rows in ClickHouse using lightweight ALTER TABLE UPDATE statements.
    async fn update_rows(&self, updates: Vec<RowUpdatePayload>) -> Result<u64, AppError> {
        let mut affected = 0;
        for upd in updates {
            let mut set_clauses = Vec::new();
            for (col, val) in upd.updated_values {
                let formatted_val = match val {
                    JsonValue::Null => "NULL".to_string(),
                    JsonValue::String(s) => format!("'{}'", s.replace('\'', "''")),
                    JsonValue::Number(n) => n.to_string(),
                    JsonValue::Bool(b) => if b { "1" } else { "0" }.to_string(),
                    _ => format!("'{}'", val.to_string().replace('\'', "''")),
                };
                set_clauses.push(format!("{} = {}", col, formatted_val));
            }

            let mut where_clauses = Vec::new();
            for (pk_col, pk_val) in upd.primary_keys {
                let formatted_val = match pk_val {
                    JsonValue::Null => "IS NULL".to_string(),
                    JsonValue::String(s) => format!("= '{}'", s.replace('\'', "''")),
                    JsonValue::Number(n) => format!("= {}", n),
                    JsonValue::Bool(b) => format!("= {}", if b { "1" } else { "0" }),
                    _ => format!("= '{}'", pk_val.to_string().replace('\'', "''")),
                };
                where_clauses.push(format!("{} {}", pk_col, formatted_val));
            }

            if set_clauses.is_empty() || where_clauses.is_empty() {
                continue;
            }

            let sql = format!(
                "ALTER TABLE {} UPDATE {} WHERE {}",
                upd.table,
                set_clauses.join(", "),
                where_clauses.join(" AND ")
            );

            let (status, body, _) = self.raw_http_post(&sql, None).await?;
            if status != 200 {
                return Err(AppError::Database(format!(
                    "Failed to update ClickHouse table: {body}"
                )));
            }
            affected += 1;
        }
        Ok(affected)
    }

    /// @brief Explains a ClickHouse SQL query plan.
    async fn explain_query(&self, sql: &str) -> Result<ExecutionPlanNode, AppError> {
        let explain_sql = format!("EXPLAIN {}", sql);
        let (_, body, _) = self.raw_http_post(&explain_sql, None).await?;

        Ok(ExecutionPlanNode::new(
            "ClickHouse Query Plan",
            None,
            1.0,
            1,
            Some(body),
        ))
    }

    /// @brief Identifies database type as ClickHouse.
    fn db_type(&self) -> DatabaseType {
        DatabaseType::ClickHouse
    }
}
