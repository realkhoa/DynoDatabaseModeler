//! @file mongodb.rs
//! @brief High-performance native MongoDB driver implementing OP_MSG (opcode 2013) wire protocol.
//! @details Communicates natively with MongoDB servers, clusters, and Atlas endpoints over TCP (port 27017).
//! Features pure Rust BSON serialization and deserialization, collection catalog introspection,
//! dynamic JSON & pseudo-SQL query execution, document flattening into tabular data grids, and mutations.

use super::{DatabaseDriver, ExecutionPlanNode, MigrationReport, QueryResult, RowUpdatePayload};
use crate::error::AppError;
use crate::model::connection::{ConnectionConfig, DatabaseType};
use crate::model::schema::{CanonicalType, ColumnSchema, DatabaseSchema, TableSchema};
use async_trait::async_trait;
use serde_json::Value as JsonValue;
use std::collections::{BTreeMap, HashSet};
use std::sync::atomic::{AtomicI32, Ordering};
use std::time::Instant;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpStream;

static REQUEST_COUNTER: AtomicI32 = AtomicI32::new(1);

/// @brief Native MongoDB driver managing network streams and BSON command dispatching.
pub struct MongoDbDriver {
    /// @brief Connection configuration parameters (host, port, credentials, active database).
    config: ConnectionConfig,
}

impl MongoDbDriver {
    /// @brief Establishes and verifies a connection to a MongoDB server instance.
    /// @param config Connection parameters containing MongoDB host, port, credentials, and catalog.
    /// @return Returns Ok(MongoDbDriver) or AppError on connection failure.
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

    /// @brief Resolves target server port, defaulting to 27017 for MongoDB.
    fn port(&self) -> u16 {
        self.config.port.unwrap_or(27017)
    }

    /// @brief Resolves target active database name, defaulting to "admin".
    fn database(&self) -> &str {
        if self.config.database.trim().is_empty() {
            "admin"
        } else {
            self.config.database.trim()
        }
    }

    /// @brief Sends a MongoDB OP_MSG command and receives the BSON response document.
    /// @param command_doc Key-value pairs representing the BSON command document.
    /// @return Returns the parsed response document as a JSON Value.
    pub async fn send_command(&self, mut command_doc: BTreeMap<String, JsonValue>) -> Result<JsonValue, AppError> {
        let host = self.host();
        let port = self.port();
        let addr = format!("{}:{}", host, port);

        let mut stream = TcpStream::connect(&addr).await.map_err(|e| {
            AppError::Connection(format!("Failed to connect to MongoDB server at {addr}: {e}"))
        })?;

        // Ensure $db is present
        if !command_doc.contains_key("$db") {
            command_doc.insert("$db".to_string(), JsonValue::String(self.database().to_string()));
        }

        let bson_body = encode_bson_document(&command_doc);

        let request_id = REQUEST_COUNTER.fetch_add(1, Ordering::SeqCst);
        let flag_bits: u32 = 0; // No flags
        let section_kind: u8 = 0; // Body section

        // Total message length = 16 (header) + 4 (flags) + 1 (kind) + bson_body.len()
        let total_length = 16 + 4 + 1 + bson_body.len() as i32;

        let mut packet = Vec::with_capacity(total_length as usize);
        packet.extend_from_slice(&total_length.to_le_bytes());
        packet.extend_from_slice(&request_id.to_le_bytes());
        packet.extend_from_slice(&0i32.to_le_bytes()); // responseTo = 0
        packet.extend_from_slice(&2013i32.to_le_bytes()); // opCode = OP_MSG (2013)
        packet.extend_from_slice(&flag_bits.to_le_bytes());
        packet.push(section_kind);
        packet.extend_from_slice(&bson_body);

        stream.write_all(&packet).await.map_err(|e| {
            AppError::Database(format!("Failed to write OP_MSG to MongoDB: {e}"))
        })?;
        stream.flush().await.map_err(|e| {
            AppError::Database(format!("Failed to flush OP_MSG to MongoDB: {e}"))
        })?;

        // Read response header (16 bytes)
        let mut header = [0u8; 16];
        stream.read_exact(&mut header).await.map_err(|e| {
            AppError::Database(format!("Failed to read response header from MongoDB: {e}"))
        })?;

        let resp_len = i32::from_le_bytes([header[0], header[1], header[2], header[3]]) as usize;
        if resp_len < 16 || resp_len > 64 * 1024 * 1024 {
            return Err(AppError::Database(format!(
                "Invalid response length received from MongoDB: {resp_len}"
            )));
        }

        let mut rest_of_packet = vec![0u8; resp_len - 16];
        stream.read_exact(&mut rest_of_packet).await.map_err(|e| {
            AppError::Database(format!("Failed to read packet body from MongoDB: {e}"))
        })?;

        // Format of rest_of_packet in OP_MSG: 4 bytes flags + 1 byte section kind (0) + BSON doc
        if rest_of_packet.len() < 5 {
            return Err(AppError::Database("Truncated OP_MSG response from MongoDB".to_string()));
        }

        let section_kind = rest_of_packet[4];
        if section_kind != 0 {
            return Err(AppError::Database(format!(
                "Unsupported MongoDB response section kind: {section_kind}"
            )));
        }

        let bson_payload = &rest_of_packet[5..];
        let response_doc = decode_bson_document(bson_payload)?;

        // Check if ok == 1
        if let Some(ok) = response_doc.get("ok") {
            let is_ok = match ok {
                JsonValue::Number(n) => n.as_f64().map(|f| f == 1.0).unwrap_or(false),
                JsonValue::Bool(b) => *b,
                _ => false,
            };
            if !is_ok {
                let errmsg = response_doc
                    .get("errmsg")
                    .and_then(|v| v.as_str())
                    .unwrap_or("MongoDB command failed without error message");
                return Err(AppError::Database(format!("MongoDB error: {errmsg}")));
            }
        }

        Ok(JsonValue::Object(response_doc.into_iter().collect()))
    }
}

/// @brief Serializes a map of string keys to JSON values into BSON format.
pub fn encode_bson_document(doc: &BTreeMap<String, JsonValue>) -> Vec<u8> {
    let mut payload = Vec::new();
    for (key, val) in doc {
        encode_bson_element(&mut payload, key, val);
    }
    payload.push(0x00); // document terminator

    let mut out = Vec::with_capacity(4 + payload.len());
    let doc_len = (4 + payload.len()) as i32;
    out.extend_from_slice(&doc_len.to_le_bytes());
    out.extend_from_slice(&payload);
    out
}

/// @brief Appends a single typed BSON element to the buffer.
fn encode_bson_element(buf: &mut Vec<u8>, key: &str, val: &JsonValue) {
    match val {
        JsonValue::Null => {
            buf.push(0x0A); // null
            write_cstring(buf, key);
        }
        JsonValue::Bool(b) => {
            buf.push(0x08); // boolean
            write_cstring(buf, key);
            buf.push(if *b { 0x01 } else { 0x00 });
        }
        JsonValue::Number(num) => {
            if let Some(i) = num.as_i64() {
                if i >= i32::MIN as i64 && i <= i32::MAX as i64 {
                    buf.push(0x10); // 32-bit integer
                    write_cstring(buf, key);
                    buf.extend_from_slice(&(i as i32).to_le_bytes());
                } else {
                    buf.push(0x12); // 64-bit integer
                    write_cstring(buf, key);
                    buf.extend_from_slice(&i.to_le_bytes());
                }
            } else if let Some(f) = num.as_f64() {
                buf.push(0x01); // 64-bit float
                write_cstring(buf, key);
                buf.extend_from_slice(&f.to_le_bytes());
            }
        }
        JsonValue::String(s) => {
            buf.push(0x02); // UTF-8 string
            write_cstring(buf, key);
            let s_bytes = s.as_bytes();
            let s_len = (s_bytes.len() + 1) as i32;
            buf.extend_from_slice(&s_len.to_le_bytes());
            buf.extend_from_slice(s_bytes);
            buf.push(0x00);
        }
        JsonValue::Array(arr) => {
            buf.push(0x04); // array (encoded as BSON document with string index keys)
            write_cstring(buf, key);
            let mut map = BTreeMap::new();
            for (idx, item) in arr.iter().enumerate() {
                map.insert(idx.to_string(), item.clone());
            }
            let sub = encode_bson_document(&map);
            buf.extend_from_slice(&sub);
        }
        JsonValue::Object(map) => {
            buf.push(0x03); // embedded document
            write_cstring(buf, key);
            let btree = map.iter().map(|(k, v)| (k.clone(), v.clone())).collect();
            let sub = encode_bson_document(&btree);
            buf.extend_from_slice(&sub);
        }
    }
}

/// @brief Writes a null-terminated C string into the buffer.
fn write_cstring(buf: &mut Vec<u8>, s: &str) {
    buf.extend_from_slice(s.as_bytes());
    buf.push(0x00);
}

/// @brief Decodes a raw BSON byte payload into key-value JSON map.
pub fn decode_bson_document(bytes: &[u8]) -> Result<BTreeMap<String, JsonValue>, AppError> {
    if bytes.len() < 5 {
        return Err(AppError::Database("Invalid BSON: buffer too small".to_string()));
    }

    let doc_len = i32::from_le_bytes([bytes[0], bytes[1], bytes[2], bytes[3]]) as usize;
    if doc_len > bytes.len() {
        return Err(AppError::Database(format!(
            "BSON length overflow: declared {doc_len}, available {}",
            bytes.len()
        )));
    }

    let mut cursor = 4;
    let mut map = BTreeMap::new();

    while cursor < doc_len - 1 {
        let type_byte = bytes[cursor];
        cursor += 1;

        // Read C-string key
        let key_start = cursor;
        while cursor < doc_len && bytes[cursor] != 0 {
            cursor += 1;
        }
        let key = String::from_utf8_lossy(&bytes[key_start..cursor]).to_string();
        cursor += 1; // skip null terminator

        let (val, consumed) = decode_bson_value(type_byte, &bytes[cursor..doc_len - 1])?;
        cursor += consumed;
        map.insert(key, val);
    }

    Ok(map)
}

/// @brief Decodes a single BSON value by its type tag.
fn decode_bson_value(type_byte: u8, slice: &[u8]) -> Result<(JsonValue, usize), AppError> {
    match type_byte {
        0x01 => {
            if slice.len() < 8 {
                return Err(AppError::Database("Truncated BSON Double".to_string()));
            }
            let f = f64::from_le_bytes([
                slice[0], slice[1], slice[2], slice[3], slice[4], slice[5], slice[6], slice[7],
            ]);
            let val = serde_json::Number::from_f64(f)
                .map(JsonValue::Number)
                .unwrap_or(JsonValue::Null);
            Ok((val, 8))
        }
        0x02 => {
            if slice.len() < 4 {
                return Err(AppError::Database("Truncated BSON String length".to_string()));
            }
            let str_len = i32::from_le_bytes([slice[0], slice[1], slice[2], slice[3]]) as usize;
            if slice.len() < 4 + str_len {
                return Err(AppError::Database("Truncated BSON String payload".to_string()));
            }
            let str_val = if str_len > 1 {
                String::from_utf8_lossy(&slice[4..4 + str_len - 1]).to_string()
            } else {
                String::new()
            };
            Ok((JsonValue::String(str_val), 4 + str_len))
        }
        0x03 => {
            if slice.len() < 4 {
                return Err(AppError::Database("Truncated BSON Document".to_string()));
            }
            let doc_len = i32::from_le_bytes([slice[0], slice[1], slice[2], slice[3]]) as usize;
            let sub = decode_bson_document(&slice[..doc_len])?;
            Ok((JsonValue::Object(sub.into_iter().collect()), doc_len))
        }
        0x04 => {
            if slice.len() < 4 {
                return Err(AppError::Database("Truncated BSON Array".to_string()));
            }
            let doc_len = i32::from_le_bytes([slice[0], slice[1], slice[2], slice[3]]) as usize;
            let sub = decode_bson_document(&slice[..doc_len])?;
            let mut arr = Vec::new();
            for i in 0..sub.len() {
                if let Some(v) = sub.get(&i.to_string()) {
                    arr.push(v.clone());
                }
            }
            Ok((JsonValue::Array(arr), doc_len))
        }
        0x07 => {
            if slice.len() < 12 {
                return Err(AppError::Database("Truncated BSON ObjectId".to_string()));
            }
            let mut hex = String::with_capacity(24);
            for b in &slice[..12] {
                hex.push_str(&format!("{b:02x}"));
            }
            Ok((JsonValue::String(hex), 12))
        }
        0x08 => {
            if slice.is_empty() {
                return Err(AppError::Database("Truncated BSON Boolean".to_string()));
            }
            Ok((JsonValue::Bool(slice[0] == 0x01), 1))
        }
        0x09 => {
            if slice.len() < 8 {
                return Err(AppError::Database("Truncated BSON Date".to_string()));
            }
            let millis = i64::from_le_bytes([
                slice[0], slice[1], slice[2], slice[3], slice[4], slice[5], slice[6], slice[7],
            ]);
            Ok((JsonValue::Number(millis.into()), 8))
        }
        0x0A => Ok((JsonValue::Null, 0)),
        0x10 => {
            if slice.len() < 4 {
                return Err(AppError::Database("Truncated BSON Int32".to_string()));
            }
            let i = i32::from_le_bytes([slice[0], slice[1], slice[2], slice[3]]);
            Ok((JsonValue::Number(i.into()), 4))
        }
        0x12 => {
            if slice.len() < 8 {
                return Err(AppError::Database("Truncated BSON Int64".to_string()));
            }
            let i = i64::from_le_bytes([
                slice[0], slice[1], slice[2], slice[3], slice[4], slice[5], slice[6], slice[7],
            ]);
            Ok((JsonValue::Number(i.into()), 8))
        }
        _ => Ok((JsonValue::String(format!("<bson 0x{type_byte:02x}>")), 0)),
    }
}

/// @brief Maps BSON/JSON field values to CanonicalType representations.
pub fn infer_bson_canonical_type(val: &JsonValue) -> CanonicalType {
    match val {
        JsonValue::Bool(_) => CanonicalType::Boolean,
        JsonValue::Number(n) => {
            if n.is_i64() {
                CanonicalType::BigInt
            } else {
                CanonicalType::Double
            }
        }
        JsonValue::String(s) => {
            if s.len() == 24 && s.chars().all(|c| c.is_ascii_hexdigit()) {
                CanonicalType::Uuid
            } else {
                CanonicalType::Text
            }
        }
        JsonValue::Array(_) => CanonicalType::Json,
        JsonValue::Object(_) => CanonicalType::Json,
        JsonValue::Null => CanonicalType::Text,
    }
}

#[async_trait]
impl DatabaseDriver for MongoDbDriver {
    /// @brief Verifies MongoDB server connectivity using the standard hello command.
    async fn test_connection(&self) -> Result<(), AppError> {
        let mut cmd = BTreeMap::new();
        cmd.insert("hello".to_string(), JsonValue::Number(1.into()));
        cmd.insert("$db".to_string(), JsonValue::String("admin".to_string()));

        let _ = self.send_command(cmd).await?;
        Ok(())
    }

    /// @brief Lists all databases available on the MongoDB instance.
    async fn list_databases(&self) -> Result<Vec<String>, AppError> {
        let mut cmd = BTreeMap::new();
        cmd.insert("listDatabases".to_string(), JsonValue::Number(1.into()));
        cmd.insert("$db".to_string(), JsonValue::String("admin".to_string()));

        let resp = self.send_command(cmd).await?;
        let mut databases = Vec::new();
        if let Some(dbs) = resp.get("databases").and_then(|d| d.as_array()) {
            for db in dbs {
                if let Some(name) = db.get("name").and_then(|n| n.as_str()) {
                    databases.push(name.to_string());
                }
            }
        }
        Ok(databases)
    }

    /// @brief Introspects MongoDB collections and infers schema models from top documents.
    async fn introspect_schema(&self) -> Result<DatabaseSchema, AppError> {
        let db_name = self.database().to_string();

        let mut list_cmd = BTreeMap::new();
        list_cmd.insert("listCollections".to_string(), JsonValue::Number(1.into()));
        list_cmd.insert("$db".to_string(), JsonValue::String(db_name.clone()));

        let resp = self.send_command(list_cmd).await?;

        let mut collection_names = Vec::new();
        if let Some(cursor) = resp.get("cursor").and_then(|c| c.get("firstBatch")).and_then(|b| b.as_array()) {
            for col in cursor {
                if let Some(name) = col.get("name").and_then(|n| n.as_str()) {
                    if !name.starts_with("system.") {
                        collection_names.push(name.to_string());
                    }
                }
            }
        }

        let mut tables = Vec::new();
        for col_name in collection_names {
            let mut find_cmd = BTreeMap::new();
            find_cmd.insert("find".to_string(), JsonValue::String(col_name.clone()));
            find_cmd.insert("limit".to_string(), JsonValue::Number(10.into()));
            find_cmd.insert("$db".to_string(), JsonValue::String(db_name.clone()));

            let mut field_names_set = HashSet::new();
            let mut field_types_map = BTreeMap::new();

            if let Ok(find_resp) = self.send_command(find_cmd).await {
                if let Some(docs) = find_resp.get("cursor").and_then(|c| c.get("firstBatch")).and_then(|b| b.as_array()) {
                    for doc in docs {
                        if let Some(obj) = doc.as_object() {
                            for (k, v) in obj {
                                field_names_set.insert(k.clone());
                                if !field_types_map.contains_key(k) && !v.is_null() {
                                    field_types_map.insert(k.clone(), infer_bson_canonical_type(v));
                                }
                            }
                        }
                    }
                }
            }

            let mut columns = Vec::new();
            columns.push(ColumnSchema {
                name: "_id".to_string(),
                data_type: CanonicalType::Uuid,
                is_primary_key: true,
                is_nullable: false,
                is_auto_increment: false,
                default_value: None,
            });

            for f_name in field_names_set {
                if f_name == "_id" {
                    continue;
                }
                let canonical_type = field_types_map
                    .get(&f_name)
                    .cloned()
                    .unwrap_or(CanonicalType::Text);

                columns.push(ColumnSchema {
                    name: f_name,
                    data_type: canonical_type,
                    is_primary_key: false,
                    is_nullable: true,
                    is_auto_increment: false,
                    default_value: None,
                });
            }

            tables.push(TableSchema {
                name: col_name,
                schema: Some(db_name.clone()),
                columns,
                foreign_keys: vec![],
                indexes: vec![],
                ui_position: None,
                rename_from: None,
                unsupported_features: vec![],
            });
        }

        Ok(DatabaseSchema {
            database_name: db_name,
            tables,
        })
    }

    /// @brief Executes MongoDB JSON command or translated pseudo-SQL query.
    async fn execute_query(&self, sql: &str) -> Result<QueryResult, AppError> {
        let trimmed = sql.trim();
        let start = Instant::now();

        if trimmed.starts_with('{') && trimmed.ends_with('}') {
            if let Ok(JsonValue::Object(map)) = serde_json::from_str::<JsonValue>(trimmed) {
                let btree = map.into_iter().collect();
                let resp = self.send_command(btree).await?;
                let elapsed_ms = start.elapsed().as_millis() as u64;

                return format_mongodb_response_to_query_result(resp, elapsed_ms);
            }
        }

        let upper = trimmed.to_ascii_uppercase();
        if upper.starts_with("SELECT") {
            let parts: Vec<&str> = trimmed.split_whitespace().collect();
            let from_pos = parts.iter().position(|p| p.eq_ignore_ascii_case("FROM"));

            if let Some(pos) = from_pos {
                if pos + 1 < parts.len() {
                    let col_name = parts[pos + 1].trim_matches(|c| c == '`' || c == '"' || c == ';');

                    let limit = parts
                        .iter()
                        .position(|p| p.eq_ignore_ascii_case("LIMIT"))
                        .and_then(|idx| parts.get(idx + 1))
                        .and_then(|s| s.trim_matches(';').parse::<i64>().ok())
                        .unwrap_or(50);

                    let mut find_cmd = BTreeMap::new();
                    find_cmd.insert("find".to_string(), JsonValue::String(col_name.to_string()));
                    find_cmd.insert("limit".to_string(), JsonValue::Number(limit.into()));

                    let resp = self.send_command(find_cmd).await?;
                    let elapsed_ms = start.elapsed().as_millis() as u64;
                    return format_mongodb_response_to_query_result(resp, elapsed_ms);
                }
            }
        } else if upper.starts_with("SHOW") && upper.contains("COLLECTIONS") {
            let mut list_cmd = BTreeMap::new();
            list_cmd.insert("listCollections".to_string(), JsonValue::Number(1.into()));
            let resp = self.send_command(list_cmd).await?;
            let elapsed_ms = start.elapsed().as_millis() as u64;
            return format_mongodb_response_to_query_result(resp, elapsed_ms);
        }

        Err(AppError::Database(
            "MongoDB requires JSON command syntax (e.g. {\"find\": \"collection\", \"limit\": 50}) or SELECT * FROM <collection> [LIMIT n]"
                .to_string(),
        ))
    }

    /// @brief Executes collection creation or deletion DDL operations.
    async fn execute_ddl(&self, statements: &[String]) -> Result<MigrationReport, AppError> {
        let start = Instant::now();
        let mut executed = 0;

        for stmt in statements {
            let trimmed = stmt.trim();
            let upper = trimmed.to_ascii_uppercase();

            let cmd_res = if upper.starts_with("CREATE TABLE") || upper.starts_with("CREATE COLLECTION") {
                let name = trimmed.split_whitespace().last().unwrap_or("").trim_matches(';');
                let mut cmd = BTreeMap::new();
                cmd.insert("create".to_string(), JsonValue::String(name.to_string()));
                self.send_command(cmd).await
            } else if upper.starts_with("DROP TABLE") || upper.starts_with("DROP COLLECTION") {
                let name = trimmed.split_whitespace().last().unwrap_or("").trim_matches(';');
                let mut cmd = BTreeMap::new();
                cmd.insert("drop".to_string(), JsonValue::String(name.to_string()));
                self.send_command(cmd).await
            } else {
                Ok(JsonValue::Null)
            };

            if let Err(e) = cmd_res {
                return Ok(MigrationReport {
                    success: false,
                    statements_executed: executed,
                    execution_time_ms: start.elapsed().as_millis() as u64,
                    error_message: Some(format!("MongoDB DDL failed: {e}")),
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

    /// @brief Applies row/document mutations to collections.
    async fn update_rows(&self, updates: Vec<RowUpdatePayload>) -> Result<u64, AppError> {
        let mut count = 0;
        for upd in updates {
            let mut filter = BTreeMap::new();
            for (pk_k, pk_v) in upd.primary_keys {
                filter.insert(pk_k, pk_v);
            }

            let mut set_fields = BTreeMap::new();
            for (k, v) in upd.updated_values {
                set_fields.insert(k, v);
            }

            let mut update_entry = BTreeMap::new();
            update_entry.insert("q".to_string(), JsonValue::Object(filter.into_iter().collect()));
            let mut set_wrapper = BTreeMap::new();
            set_wrapper.insert("$set".to_string(), JsonValue::Object(set_fields.into_iter().collect()));
            update_entry.insert("u".to_string(), JsonValue::Object(set_wrapper.into_iter().collect()));

            let mut cmd = BTreeMap::new();
            cmd.insert("update".to_string(), JsonValue::String(upd.table));
            cmd.insert(
                "updates".to_string(),
                JsonValue::Array(vec![JsonValue::Object(update_entry.into_iter().collect())]),
            );

            let _ = self.send_command(cmd).await?;
            count += 1;
        }
        Ok(count)
    }

    /// @brief Explains a MongoDB query execution plan.
    async fn explain_query(&self, sql: &str) -> Result<ExecutionPlanNode, AppError> {
        let collection = sql
            .split_whitespace()
            .find(|w| !w.eq_ignore_ascii_case("SELECT") && !w.eq_ignore_ascii_case("*") && !w.eq_ignore_ascii_case("FROM"))
            .unwrap_or("collection")
            .trim_matches(';');

        let mut explain_cmd = BTreeMap::new();
        let mut find_cmd = BTreeMap::new();
        find_cmd.insert("find".to_string(), JsonValue::String(collection.to_string()));
        explain_cmd.insert("explain".to_string(), JsonValue::Object(find_cmd.into_iter().collect()));
        explain_cmd.insert("verbosity".to_string(), JsonValue::String("queryPlanner".to_string()));

        let resp = self.send_command(explain_cmd).await?;

        Ok(ExecutionPlanNode::new(
            "MongoDB Query Planner",
            Some(collection.to_string()),
            1.0,
            1,
            Some(resp.to_string()),
        ))
    }

    /// @brief Returns database type as MongoDb.
    fn db_type(&self) -> DatabaseType {
        DatabaseType::MongoDb
    }
}

/// @brief Formats arbitrary MongoDB command responses into tabular QueryResult grids.
fn format_mongodb_response_to_query_result(resp: JsonValue, elapsed_ms: u64) -> Result<QueryResult, AppError> {
    if let Some(cursor) = resp.get("cursor").and_then(|c| c.get("firstBatch")).and_then(|b| b.as_array()) {
        let mut column_set = Vec::new();
        let mut column_indices = BTreeMap::new();

        column_set.push("_id".to_string());
        column_indices.insert("_id".to_string(), 0);

        for doc in cursor {
            if let Some(obj) = doc.as_object() {
                for key in obj.keys() {
                    if !column_indices.contains_key(key) {
                        column_indices.insert(key.clone(), column_set.len());
                        column_set.push(key.clone());
                    }
                }
            }
        }

        let mut rows = Vec::new();
        for doc in cursor {
            let mut row = vec![JsonValue::Null; column_set.len()];
            if let Some(obj) = doc.as_object() {
                for (k, v) in obj {
                    if let Some(&idx) = column_indices.get(k) {
                        row[idx] = v.clone();
                    }
                }
            }
            rows.push(row);
        }

        let count = rows.len() as u64;
        return Ok(QueryResult {
            columns: column_set,
            rows,
            rows_affected: count,
            execution_time_ms: elapsed_ms,
        });
    }

    Ok(QueryResult {
        columns: vec!["result".to_string()],
        rows: vec![vec![resp]],
        rows_affected: 1,
        execution_time_ms: elapsed_ms,
    })
}
