//! @file surrealdb.rs
//! @brief High-performance native SurrealDB multi-model database driver.
//! @details Implements the DatabaseDriver trait for SurrealDB instances communicating over HTTP REST SQL endpoint.
//! Supports SurrealQL statements, namespace & database catalogs, schema introspection via INFO FOR DB/TABLE,
//! tabular representation of document/graph records, and mutations.

use super::{DatabaseDriver, ExecutionPlanNode, MigrationReport, QueryResult, RowUpdatePayload};
use crate::error::AppError;
use crate::model::connection::{ConnectionConfig, DatabaseType};
use crate::model::schema::{CanonicalType, ColumnSchema, DatabaseSchema, TableSchema};
use async_trait::async_trait;
use serde_json::Value as JsonValue;
use std::time::Instant;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpStream;

/// @brief Native driver for SurrealDB multi-model databases communicating over HTTP /sql.
pub struct SurrealDbDriver {
    /// @brief Target connection parameters.
    config: ConnectionConfig,
}

impl SurrealDbDriver {
    /// @brief Connects and verifies accessibility of the SurrealDB instance.
    /// @param config Connection parameters specifying host, port, credentials, and catalog.
    /// @return Returns Ok(SurrealDbDriver) or AppError on connection failure.
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

    /// @brief Resolves SurrealDB HTTP port, defaulting to 8000.
    fn port(&self) -> u16 {
        self.config.port.unwrap_or(8000)
    }

    /// @brief Resolves namespace and database components from the database field ("ns:db" or defaults).
    fn ns_and_db(&self) -> (String, String) {
        let raw = self.config.database.trim();
        if raw.contains(':') {
            let mut parts = raw.splitn(2, ':');
            let ns = parts.next().unwrap_or("test").to_string();
            let db = parts.next().unwrap_or("test").to_string();
            (ns, db)
        } else if raw.is_empty() {
            ("test".to_string(), "test".to_string())
        } else {
            ("test".to_string(), raw.to_string())
        }
    }

    /// @brief Executes a raw HTTP request against the SurrealDB /sql endpoint.
    /// @param surrealql SurrealQL statement string to execute.
    /// @return Returns HTTP status code, response body, and elapsed execution time in ms.
    pub async fn raw_http_post(&self, surrealql: &str) -> Result<(u16, String, u64), AppError> {
        let host = self.host();
        let port = self.port();
        let addr = format!("{}:{}", host, port);
        let (ns, db) = self.ns_and_db();

        let start = Instant::now();
        let mut stream = TcpStream::connect(&addr).await.map_err(|e| {
            AppError::Connection(format!("Failed to connect to SurrealDB at {addr}: {e}"))
        })?;

        let user = self.config.username.as_deref().unwrap_or("root");
        let pass = self.config.password.as_deref().unwrap_or("root");
        let credentials = format!("{user}:{pass}");
        let auth_header = format!("Authorization: Basic {}\r\n", base64_encode(credentials.as_bytes()));

        let body_bytes = surrealql.as_bytes();
        let request = format!(
            "POST /sql HTTP/1.1\r\n\
             Host: {}:{}\r\n\
             User-Agent: DynoDbModeler/0.2.0\r\n\
             Accept: application/json\r\n\
             Content-Type: text/plain; charset=utf-8\r\n\
             NS: {}\r\n\
             DB: {}\r\n\
             {}\
             Content-Length: {}\r\n\
             Connection: close\r\n\
             \r\n",
            host,
            port,
            ns,
            db,
            auth_header,
            body_bytes.len()
        );

        stream.write_all(request.as_bytes()).await.map_err(|e| {
            AppError::Database(format!("Failed to write HTTP header to SurrealDB: {e}"))
        })?;
        stream.write_all(body_bytes).await.map_err(|e| {
            AppError::Database(format!("Failed to write SurrealQL body to SurrealDB: {e}"))
        })?;
        stream.flush().await.map_err(|e| {
            AppError::Database(format!("Failed to flush HTTP request to SurrealDB: {e}"))
        })?;

        let mut response_bytes = Vec::new();
        stream.read_to_end(&mut response_bytes).await.map_err(|e| {
            AppError::Database(format!("Failed to read response from SurrealDB: {e}"))
        })?;

        let elapsed_ms = start.elapsed().as_millis() as u64;
        let response_str = String::from_utf8_lossy(&response_bytes).to_string();
        let (status_code, body) = parse_http_response(&response_str)?;

        Ok((status_code, body, elapsed_ms))
    }
}

/// @brief Base64 encoder for HTTP Basic authentication.
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

/// @brief Parses an HTTP response string into status code and body string.
fn parse_http_response(raw: &str) -> Result<(u16, String), AppError> {
    let mut parts = raw.splitn(2, "\r\n\r\n");
    let header_part = parts.next().unwrap_or("");
    let body_part = parts.next().unwrap_or("");

    let status_line = header_part.lines().next().unwrap_or("");
    let mut tokens = status_line.split_whitespace();
    let _version = tokens.next();
    let status_code: u16 = tokens
        .next()
        .and_then(|c| c.parse().ok())
        .unwrap_or(500);

    Ok((status_code, body_part.to_string()))
}

/// @brief Maps SurrealDB field data types into CanonicalType.
pub fn parse_surreal_canonical_type(type_str: &str) -> CanonicalType {
    let lower = type_str.to_ascii_lowercase();
    if lower == "int" || lower == "number" {
        CanonicalType::BigInt
    } else if lower == "float" || lower == "decimal" {
        CanonicalType::Double
    } else if lower == "bool" {
        CanonicalType::Boolean
    } else if lower == "string" {
        CanonicalType::Text
    } else if lower == "datetime" {
        CanonicalType::Timestamp
    } else if lower == "uuid" || lower == "record" {
        CanonicalType::Uuid
    } else if lower.starts_with("array") || lower.starts_with("object") {
        CanonicalType::Json
    } else {
        CanonicalType::Custom(type_str.to_string())
    }
}

#[async_trait]
impl DatabaseDriver for SurrealDbDriver {
    /// @brief Verifies that the SurrealDB endpoint responds to INFO FOR DB.
    async fn test_connection(&self) -> Result<(), AppError> {
        let (status, body, _) = self.raw_http_post("INFO FOR DB;").await?;
        if status == 200 {
            Ok(())
        } else {
            Err(AppError::Connection(format!(
                "SurrealDB responded with HTTP error status {status}: {body}"
            )))
        }
    }

    /// @brief Lists all databases within the current namespace.
    async fn list_databases(&self) -> Result<Vec<String>, AppError> {
        let (status, body, _) = self.raw_http_post("INFO FOR NS;").await?;
        if status != 200 {
            return Err(AppError::Database(format!(
                "Failed to list SurrealDB databases: {body}"
            )));
        }

        let mut databases = Vec::new();
        if let Ok(JsonValue::Array(arr)) = serde_json::from_str::<JsonValue>(&body) {
            if let Some(first) = arr.first() {
                if let Some(res) = first.get("result") {
                    if let Some(dbs) = res.get("databases").and_then(|d| d.as_object()) {
                        for name in dbs.keys() {
                            databases.push(name.clone());
                        }
                    }
                }
            }
        }
        Ok(databases)
    }

    /// @brief Introspects tables and fields in the active SurrealDB database.
    async fn introspect_schema(&self) -> Result<DatabaseSchema, AppError> {
        let (ns, db) = self.ns_and_db();
        let db_full_name = format!("{ns}:{db}");

        let (status, body, _) = self.raw_http_post("INFO FOR DB;").await?;
        if status != 200 {
            return Err(AppError::Introspection(format!(
                "Failed to query INFO FOR DB in SurrealDB: {body}"
            )));
        }

        let mut table_names = Vec::new();
        if let Ok(JsonValue::Array(arr)) = serde_json::from_str::<JsonValue>(&body) {
            if let Some(first) = arr.first() {
                if let Some(res) = first.get("result") {
                    if let Some(tbls) = res.get("tables").and_then(|t| t.as_object()) {
                        for name in tbls.keys() {
                            table_names.push(name.clone());
                        }
                    }
                }
            }
        }

        let mut tables = Vec::new();
        for tbl_name in table_names {
            let info_table_sql = format!("INFO FOR TABLE {tbl_name};");
            let mut columns = Vec::new();

            columns.push(ColumnSchema {
                name: "id".to_string(),
                data_type: CanonicalType::Uuid,
                is_primary_key: true,
                is_nullable: false,
                is_auto_increment: false,
                default_value: None,
            });

            if let Ok((200, tbl_info_body, _)) = self.raw_http_post(&info_table_sql).await {
                if let Ok(JsonValue::Array(arr)) = serde_json::from_str::<JsonValue>(&tbl_info_body) {
                    if let Some(first) = arr.first() {
                        if let Some(res) = first.get("result") {
                            if let Some(fields) = res.get("fields").and_then(|f| f.as_object()) {
                                for (f_name, f_def) in fields {
                                    let def_str = f_def.as_str().unwrap_or("");
                                    let type_part = def_str
                                        .split_whitespace()
                                        .skip_while(|w| !w.eq_ignore_ascii_case("TYPE"))
                                        .nth(1)
                                        .unwrap_or("any");

                                    columns.push(ColumnSchema {
                                        name: f_name.clone(),
                                        data_type: parse_surreal_canonical_type(type_part),
                                        is_primary_key: false,
                                        is_nullable: true,
                                        is_auto_increment: false,
                                        default_value: None,
                                    });
                                }
                            }
                        }
                    }
                }
            }

            tables.push(TableSchema {
                name: tbl_name,
                schema: Some(db.clone()),
                columns,
                foreign_keys: vec![],
                indexes: vec![],
                ui_position: None,
                rename_from: None,
                unsupported_features: vec![],
            });
        }

        Ok(DatabaseSchema {
            database_name: db_full_name,
            tables,
        })
    }

    /// @brief Executes a SurrealQL statement and formats response into tabular QueryResult.
    async fn execute_query(&self, sql: &str) -> Result<QueryResult, AppError> {
        let (status, body, elapsed_ms) = self.raw_http_post(sql).await?;
        if status != 200 {
            return Err(AppError::Database(format!(
                "SurrealDB query execution error: {body}"
            )));
        }

        if let Ok(JsonValue::Array(arr)) = serde_json::from_str::<JsonValue>(&body) {
            if let Some(first) = arr.first() {
                if let Some(result_val) = first.get("result") {
                    if let Some(rows_arr) = result_val.as_array() {
                        let mut columns = Vec::new();
                        let mut col_indices = std::collections::BTreeMap::new();

                        columns.push("id".to_string());
                        col_indices.insert("id".to_string(), 0);

                        for item in rows_arr {
                            if let Some(obj) = item.as_object() {
                                for key in obj.keys() {
                                    if !col_indices.contains_key(key) {
                                        col_indices.insert(key.clone(), columns.len());
                                        columns.push(key.clone());
                                    }
                                }
                            }
                        }

                        let mut rows = Vec::new();
                        for item in rows_arr {
                            let mut row = vec![JsonValue::Null; columns.len()];
                            if let Some(obj) = item.as_object() {
                                for (k, v) in obj {
                                    if let Some(&idx) = col_indices.get(k) {
                                        row[idx] = v.clone();
                                    }
                                }
                            }
                            rows.push(row);
                        }

                        let rows_affected = rows.len() as u64;
                        return Ok(QueryResult {
                            columns,
                            rows,
                            rows_affected,
                            execution_time_ms: elapsed_ms,
                        });
                    }
                }
            }
        }

        Ok(QueryResult {
            columns: vec!["result".to_string()],
            rows: vec![vec![JsonValue::String(body)]],
            rows_affected: 1,
            execution_time_ms: elapsed_ms,
        })
    }

    /// @brief Executes DDL migration statements in SurrealDB.
    async fn execute_ddl(&self, statements: &[String]) -> Result<MigrationReport, AppError> {
        let start = Instant::now();
        let mut executed = 0;

        for stmt in statements {
            let (status, body, _) = self.raw_http_post(stmt).await?;
            if status != 200 {
                return Ok(MigrationReport {
                    success: false,
                    statements_executed: executed,
                    execution_time_ms: start.elapsed().as_millis() as u64,
                    error_message: Some(format!("SurrealDB DDL error: {body}")),
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

    /// @brief Mutates records in SurrealDB tables using UPDATE MERGE statements.
    async fn update_rows(&self, updates: Vec<RowUpdatePayload>) -> Result<u64, AppError> {
        let mut affected = 0;
        for upd in updates {
            let mut record_id = None;
            for (pk_col, pk_val) in &upd.primary_keys {
                if pk_col == "id" {
                    if let Some(s) = pk_val.as_str() {
                        record_id = Some(s.to_string());
                    } else {
                        record_id = Some(pk_val.to_string());
                    }
                }
            }

            let id_str = record_id.unwrap_or_else(|| "1".to_string());
            let target_ref = if id_str.contains(':') {
                id_str
            } else {
                format!("{}:{}", upd.table, id_str)
            };

            let mut fields_map = serde_json::Map::new();
            for (col, val) in upd.updated_values {
                fields_map.insert(col, val);
            }

            let json_body = JsonValue::Object(fields_map).to_string();
            let sql = format!("UPDATE {target_ref} MERGE {json_body};");

            let (status, body, _) = self.raw_http_post(&sql).await?;
            if status != 200 {
                return Err(AppError::Database(format!(
                    "Failed to update SurrealDB record: {body}"
                )));
            }
            affected += 1;
        }
        Ok(affected)
    }

    /// @brief Explains a SurrealQL statement.
    async fn explain_query(&self, sql: &str) -> Result<ExecutionPlanNode, AppError> {
        let explain_sql = format!("{sql} EXPLAIN;");
        let (_, body, _) = self.raw_http_post(&explain_sql).await?;

        Ok(ExecutionPlanNode::new(
            "SurrealDB Execution Plan",
            None,
            1.0,
            1,
            Some(body),
        ))
    }

    /// @brief Identifies database type as SurrealDb.
    fn db_type(&self) -> DatabaseType {
        DatabaseType::SurrealDb
    }
}
