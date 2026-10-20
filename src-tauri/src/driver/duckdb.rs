//! @file duckdb.rs
//! @brief DuckDB embedded analytical database driver adapter.
//! @details Provides high-performance in-process analytical query processing, catalog introspection,
//! DDL migration execution, and transactional updates for local and in-memory DuckDB databases.

use async_trait::async_trait;
use duckdb::types::Value as DuckValue;
use duckdb::Connection;
use serde_json::json;
use std::sync::Arc;
use std::time::Instant;
use tokio::sync::Mutex;

use super::{
    is_row_returning, parse_referential_action, DatabaseDriver, ExecutionPlanNode, MigrationReport,
    QueryResult, RowUpdatePayload,
};
use crate::error::AppError;
use crate::model::connection::{ConnectionConfig, DatabaseType};
use crate::model::schema::*;

/// @brief DuckDB database driver managing an in-process DuckDB analytical engine connection.
pub struct DuckDbDriver {
    conn: Arc<Mutex<Connection>>,
    database_name: String,
}

impl DuckDbDriver {
    /// @brief Opens or connects to a DuckDB instance (in-memory or persistent file).
    /// @param config Connection configuration detailing file path and database name.
    /// @return Active DuckDbDriver or AppError on connection failure.
    pub async fn connect(config: &ConnectionConfig) -> Result<Self, AppError> {
        let path = config.file_path.as_deref().unwrap_or(":memory:");
        let conn = if path == ":memory:" || path.trim().is_empty() {
            Connection::open_in_memory().map_err(|e| {
                AppError::Connection(format!("Failed to open DuckDB in-memory: {}", e))
            })?
        } else {
            Connection::open(path).map_err(|e| {
                AppError::Connection(format!("Failed to open DuckDB file '{}': {}", path, e))
            })?
        };

        Ok(Self {
            conn: Arc::new(Mutex::new(conn)),
            database_name: config.database.clone(),
        })
    }
}

/// @brief Converts a DuckDB Value enum variant into a standard serde_json::Value.
/// @param val DuckDB typed Value variant.
/// @return Normalized JSON value.
fn duck_val_to_json(val: DuckValue) -> serde_json::Value {
    match val {
        DuckValue::Null => serde_json::Value::Null,
        DuckValue::Boolean(b) => json!(b),
        DuckValue::TinyInt(n) => json!(n),
        DuckValue::SmallInt(n) => json!(n),
        DuckValue::Int(n) => json!(n),
        DuckValue::BigInt(n) => json!(n),
        DuckValue::HugeInt(n) => json!(n.to_string()),
        DuckValue::UTinyInt(n) => json!(n),
        DuckValue::USmallInt(n) => json!(n),
        DuckValue::UInt(n) => json!(n),
        DuckValue::UBigInt(n) => json!(n),
        DuckValue::Float(f) => json!(f),
        DuckValue::Double(d) => json!(d),
        DuckValue::Text(s) => json!(s),
        DuckValue::Blob(b) => json!(format!("<binary {} bytes>", b.len())),
        other => json!(format!("{:?}", other)),
    }
}

/// @brief Converts a JSON value into a boxed DuckDB parameter.
/// @param val Reference to serde_json::Value to convert.
/// @return Boxed parameter ready to be bound to a prepared statement.
fn json_to_duck_param(val: &serde_json::Value) -> Box<dyn duckdb::ToSql> {
    match val {
        serde_json::Value::Null => Box::new(Option::<String>::None),
        serde_json::Value::Bool(b) => Box::new(*b),
        serde_json::Value::Number(n) => {
            if let Some(i) = n.as_i64() {
                Box::new(i)
            } else if let Some(f) = n.as_f64() {
                Box::new(f)
            } else {
                Box::new(n.to_string())
            }
        }
        serde_json::Value::String(s) => Box::new(s.clone()),
        other => Box::new(other.to_string()),
    }
}

/// @brief Quotes a SQL identifier with double quotes, escaping embedded quotes.
/// @param ident Identifier to quote.
/// @return Double-quoted identifier.
fn duck_quote_ident(ident: &str) -> String {
    format!("\"{}\"", ident.replace('"', "\"\""))
}

/// @brief Normalizes raw DuckDB data type strings into CanonicalType representations.
/// @param raw DuckDB data type name.
/// @return Normalized CanonicalType.
pub fn parse_duckdb_type(raw: &str) -> CanonicalType {
    let upper = raw.trim().to_uppercase();

    if upper.starts_with("INT") || upper.starts_with("INTEGER") || upper == "INT4" {
        CanonicalType::Integer
    } else if upper.starts_with("BIGINT") || upper == "INT8" || upper == "HUGEINT" {
        CanonicalType::BigInt
    } else if upper.starts_with("SMALLINT") || upper == "INT2" || upper.starts_with("TINYINT") {
        CanonicalType::SmallInt
    } else if upper.starts_with("FLOAT") || upper == "REAL" || upper == "FLOAT4" {
        CanonicalType::Float
    } else if upper.starts_with("DOUBLE") || upper == "FLOAT8" {
        CanonicalType::Double
    } else if upper.starts_with("BOOL") {
        CanonicalType::Boolean
    } else if upper.starts_with("VARCHAR")
        || upper.starts_with("TEXT")
        || upper.starts_with("STRING")
    {
        CanonicalType::Text
    } else if upper.starts_with("DATE") {
        CanonicalType::Date
    } else if upper.starts_with("TIME") && !upper.starts_with("TIMESTAMP") {
        CanonicalType::Time
    } else if upper.starts_with("TIMESTAMP") {
        CanonicalType::Timestamp
    } else if upper.starts_with("JSON") {
        CanonicalType::Json
    } else if upper.starts_with("UUID") {
        CanonicalType::Uuid
    } else if upper.starts_with("BLOB") || upper.starts_with("BYTEA") {
        CanonicalType::Binary
    } else if upper.starts_with("DECIMAL") || upper.starts_with("NUMERIC") {
        CanonicalType::Decimal {
            precision: None,
            scale: None,
        }
    } else {
        CanonicalType::Custom(upper)
    }
}

/// @brief Recursively converts a DuckDB JSON plan node into an ExecutionPlanNode.
/// @details DuckDB returns the plan as a single-element array whose nodes expose `name`,
/// `children` and `extra_info`. `extra_info` carries the accessed relation qualified as
/// `catalog.schema.table`, the estimated cardinality and the projection list.
/// @param val Reference to a plan node object.
/// @return Populated ExecutionPlanNode.
fn parse_duckdb_plan_node(val: &serde_json::Value) -> ExecutionPlanNode {
    let node_type = val
        .get("name")
        .and_then(|v| v.as_str())
        .unwrap_or("Operator")
        .to_string();

    let extra = val.get("extra_info");

    // Relations are reported as catalog.schema.table; the bare table name matches the ERD node id.
    let relation = extra
        .and_then(|e| e.get("Table"))
        .and_then(|v| v.as_str())
        .map(|qualified| {
            qualified
                .rsplit('.')
                .next()
                .unwrap_or(qualified)
                .to_string()
        });

    let rows = extra
        .and_then(|e| e.get("Estimated Cardinality"))
        .and_then(|v| {
            v.as_str()
                .and_then(|s| s.parse::<f64>().ok())
                .or_else(|| v.as_f64())
        })
        .unwrap_or(0.0) as u64;

    // Prefer the scan filter when present, otherwise list the projected expressions.
    let detail = extra
        .and_then(|e| e.get("Filters"))
        .and_then(|v| v.as_str())
        .map(|s| s.to_string())
        .or_else(|| {
            extra
                .and_then(|e| e.get("Projections"))
                .and_then(|v| v.as_array())
                .map(|items| {
                    items
                        .iter()
                        .filter_map(|i| i.as_str())
                        .collect::<Vec<_>>()
                        .join(", ")
                })
        });

    let mut node = ExecutionPlanNode::new(node_type, relation, 0.0, rows, detail);
    if let Some(children) = val.get("children").and_then(|v| v.as_array()) {
        for child in children {
            node.children.push(parse_duckdb_plan_node(child));
        }
    }
    node
}

/// @brief Parses a DuckDB JSON explain document into the root plan node.
/// @details DuckDB wraps the physical plan in a single-element array, so the array is unwrapped
/// before the recursive conversion.
/// @param parsed Parsed JSON document returned by `EXPLAIN (FORMAT JSON)`.
/// @return Root ExecutionPlanNode.
fn parse_duckdb_plan_document(parsed: &serde_json::Value) -> ExecutionPlanNode {
    match parsed {
        serde_json::Value::Array(items) => items
            .first()
            .map(parse_duckdb_plan_node)
            .unwrap_or_else(|| ExecutionPlanNode::new("Query Plan", None, 0.0, 0, None)),
        other => parse_duckdb_plan_node(other),
    }
}

#[async_trait]
impl DatabaseDriver for DuckDbDriver {
    /// @brief Tests the DuckDB connection responsiveness.
    /// @return Ok(()) on success.
    async fn test_connection(&self) -> Result<(), AppError> {
        let conn = self.conn.lock().await;
        conn.execute("SELECT 1", [])
            .map_err(|e| AppError::Connection(format!("DuckDB test connection failed: {}", e)))?;
        Ok(())
    }

    /// @brief Introspects tables, columns, foreign keys, and constraints from DuckDB information_schema.
    /// @details Numeric precision/scale are read from `information_schema.columns`, AUTOINCREMENT is
    /// inferred from a `nextval(...)` default, and foreign keys are read through
    /// `PRAGMA foreign_key_list` when the engine exposes it.
    /// @return Populated DatabaseSchema domain model.
    async fn introspect_schema(&self) -> Result<DatabaseSchema, AppError> {
        let conn = self.conn.lock().await;

        // Query non-internal user tables from information_schema
        let mut table_stmt = conn
            .prepare(
                "SELECT table_name FROM information_schema.tables WHERE table_schema = 'main' AND table_type = 'BASE TABLE' ORDER BY table_name",
            )
            .map_err(|e| AppError::Introspection(format!("Failed to query tables: {}", e)))?;

        let table_names: Vec<String> = table_stmt
            .query_map([], |row| row.get::<_, String>(0))
            .map_err(|e| AppError::Introspection(e.to_string()))?
            .filter_map(|r| r.ok())
            .collect();

        let mut tables = Vec::with_capacity(table_names.len());

        for table_name in table_names {
            // Introspect table columns via PRAGMA table_info('table_name')
            let pragma_sql = format!("PRAGMA table_info('{}')", table_name.replace('\'', "''"));
            let mut col_stmt = conn
                .prepare(&pragma_sql)
                .map_err(|e| AppError::Introspection(e.to_string()))?;

            let cols: Vec<(String, String, bool, Option<String>, bool)> = col_stmt
                .query_map([], |row| {
                    let col_name: String = row.get(1)?;
                    let raw_type: String = row.get(2)?;
                    let not_null: bool = row.get(3)?;
                    let dflt: Option<String> = row.get(4)?;
                    let is_pk: bool = row.get(5)?;
                    Ok((col_name, raw_type, not_null, dflt, is_pk))
                })
                .map_err(|e| AppError::Introspection(e.to_string()))?
                .filter_map(|r| r.ok())
                .collect();

            let columns: Vec<ColumnSchema> = cols
                .into_iter()
                .map(|(col_name, raw_type, not_null, dflt, is_pk)| {
                    let data_type = parse_duckdb_type(&raw_type);
                    let is_auto_increment = dflt
                        .as_deref()
                        .map(|d| d.to_lowercase().contains("nextval("))
                        .unwrap_or(false);
                    ColumnSchema {
                        name: col_name,
                        data_type,
                        is_primary_key: is_pk,
                        is_nullable: !not_null,
                        is_auto_increment,
                        default_value: dflt,
                    }
                })
                .collect();

            // Foreign keys: DuckDB exposes PRAGMA foreign_key_list on recent versions; when the
            // engine does not support it the table simply reports no foreign keys.
            let mut foreign_keys = Vec::new();
            let fk_pragma = format!(
                "PRAGMA foreign_key_list('{}')",
                table_name.replace('\'', "''")
            );
            if let Ok(mut stmt) = conn.prepare(&fk_pragma) {
                if let Ok(rows) = stmt.query_map([], |row| {
                    let id: i64 = row.get(0)?;
                    let target_table: String = row.get(2)?;
                    let from_col: String = row.get(3)?;
                    let to_col: Option<String> = row.get(4)?;
                    let on_update: Option<String> = row.get(5)?;
                    let on_delete: Option<String> = row.get(6)?;
                    Ok((id, target_table, from_col, to_col, on_update, on_delete))
                }) {
                    for row in rows.flatten() {
                        let (id, target_table, from_col, to_col, on_update, on_delete) = row;
                        foreign_keys.push(ForeignKeySchema {
                            constraint_name: format!("fk_{}_{}_{}", table_name, from_col, id),
                            source_column: from_col,
                            target_table,
                            target_column: to_col.unwrap_or_else(|| "id".to_string()),
                            on_delete: parse_referential_action(
                                on_delete.as_deref().unwrap_or("NO ACTION"),
                            ),
                            on_update: parse_referential_action(
                                on_update.as_deref().unwrap_or("NO ACTION"),
                            ),
                        });
                    }
                }
            }

            tables.push(TableSchema {
                name: table_name,
                schema: Some("main".to_string()),
                columns,
                foreign_keys,
                // DuckDB indexes are physical optimisations rather than schema contracts, so they
                // are intentionally not round-tripped into generated migrations.
                indexes: vec![],
                ui_position: None,
                rename_from: None,
                unsupported_features: vec![],
            });
        }

        Ok(DatabaseSchema {
            database_name: self.database_name.clone(),
            tables,
        })
    }

    /// @brief Executes arbitrary SQL query against DuckDB and returns structured tabular results.
    /// @details Row-returning statements are prepared and streamed; other statements are executed
    /// and report the engine's affected row count.
    /// @param sql SQL query string.
    /// @return QueryResult with column names and serialized rows.
    async fn execute_query(&self, sql: &str) -> Result<QueryResult, AppError> {
        let conn = self.conn.lock().await;
        let start = Instant::now();

        if !is_row_returning(sql) {
            let affected = conn
                .execute(sql, [])
                .map_err(|e| AppError::Database(format!("DuckDB execution error: {}", e)))?;
            return Ok(QueryResult {
                columns: vec![],
                rows: vec![],
                rows_affected: affected as u64,
                execution_time_ms: start.elapsed().as_millis() as u64,
            });
        }

        let mut stmt = conn
            .prepare(sql)
            .map_err(|e| AppError::Database(format!("DuckDB query prepare error: {}", e)))?;

        let mut rows = Vec::new();
        {
            let mut rows_iter = stmt
                .query([])
                .map_err(|e| AppError::Database(format!("DuckDB query execution error: {}", e)))?;

            while let Some(row) = rows_iter
                .next()
                .map_err(|e| AppError::Database(e.to_string()))?
            {
                let mut row_values = Vec::new();
                let mut col_idx = 0;
                while let Ok(val) = row.get::<_, DuckValue>(col_idx) {
                    row_values.push(duck_val_to_json(val));
                    col_idx += 1;
                }
                rows.push(row_values);
            }
        }

        let column_names: Vec<String> = stmt
            .column_names()
            .into_iter()
            .map(|s| s.to_string())
            .collect();

        let elapsed = start.elapsed().as_millis() as u64;

        Ok(QueryResult {
            columns: column_names,
            rows_affected: rows.len() as u64,
            rows,
            execution_time_ms: elapsed,
        })
    }

    /// @brief Applies a sequential series of DDL statements inside an atomic DuckDB transaction.
    /// @param statements Vector of SQL DDL statements.
    /// @return MigrationReport detailing applied statement metrics.
    async fn execute_ddl(&self, statements: &[String]) -> Result<MigrationReport, AppError> {
        let conn = self.conn.lock().await;
        let start = Instant::now();

        conn.execute("BEGIN TRANSACTION", []).map_err(|e| {
            AppError::Migration(format!("Failed to begin DuckDB transaction: {}", e))
        })?;

        let mut executed = 0;
        for stmt in statements {
            if stmt.trim().is_empty() {
                continue;
            }
            if let Err(e) = conn.execute_batch(stmt) {
                let _ = conn.execute("ROLLBACK", []);
                return Err(AppError::Migration(format!(
                    "DuckDB DDL statement failed: {}. Statement: {}",
                    e, stmt
                )));
            }
            executed += 1;
        }

        conn.execute("COMMIT", []).map_err(|e| {
            AppError::Migration(format!("Failed to commit DuckDB transaction: {}", e))
        })?;

        Ok(MigrationReport {
            success: true,
            statements_executed: executed,
            execution_time_ms: start.elapsed().as_millis() as u64,
            error_message: None,
        })
    }

    /// @brief Executes batch row mutations transactionally against DuckDB tables.
    /// @details Values are bound as statement parameters rather than interpolated, and identifiers
    /// are quote-escaped. In strict single-row mode the batch is rolled back unless exactly one row
    /// was affected.
    /// @param updates List of row update payloads specifying tables, PKs, and modified columns.
    /// @return Count of rows affected across updates.
    async fn update_rows(&self, updates: Vec<RowUpdatePayload>) -> Result<u64, AppError> {
        if updates.is_empty() {
            return Ok(0);
        }

        let conn = self.conn.lock().await;
        conn.execute("BEGIN TRANSACTION", [])
            .map_err(|e| AppError::Database(format!("Failed to begin transaction: {}", e)))?;

        let mut total_affected = 0u64;

        for update in updates {
            if update.updated_values.is_empty() {
                continue;
            }
            if let Err(message) = update.validate_locator() {
                let _ = conn.execute("ROLLBACK", []);
                return Err(AppError::Database(message));
            }

            let mut parameters: Vec<Box<dyn duckdb::ToSql>> = Vec::new();

            let mut set_clauses = Vec::new();
            for (col, val) in &update.updated_values {
                set_clauses.push(format!("{} = ?", duck_quote_ident(col)));
                parameters.push(json_to_duck_param(val));
            }

            let mut where_clauses = Vec::new();
            for (pk_col, pk_val) in &update.primary_keys {
                where_clauses.push(format!("{} = ?", duck_quote_ident(pk_col)));
                parameters.push(json_to_duck_param(pk_val));
            }

            let sql = format!(
                "UPDATE {} SET {} WHERE {}",
                duck_quote_ident(&update.table),
                set_clauses.join(", "),
                where_clauses.join(" AND ")
            );

            let param_refs: Vec<&dyn duckdb::ToSql> =
                parameters.iter().map(|p| p.as_ref()).collect();

            match conn.execute(&sql, param_refs.as_slice()) {
                Ok(affected) => {
                    if let Err(message) = update.check_affected_rows(affected as u64) {
                        let _ = conn.execute("ROLLBACK", []);
                        return Err(AppError::Database(message));
                    }
                    total_affected += affected as u64;
                }
                Err(e) => {
                    let _ = conn.execute("ROLLBACK", []);
                    return Err(AppError::Database(format!(
                        "DuckDB row mutation failed: {}",
                        e
                    )));
                }
            }
        }

        conn.execute("COMMIT", [])
            .map_err(|e| AppError::Database(format!("Failed to commit transaction: {}", e)))?;

        Ok(total_affected)
    }

    /// @brief Generates an execution plan tree for the provided SQL query using DuckDB EXPLAIN.
    /// @details Requests the JSON plan so the real operator tree is returned instead of a constant
    /// placeholder; a text plan is used as a fallback when JSON formatting is unavailable.
    /// @param sql SQL statement to explain.
    /// @return ExecutionPlanNode root representation.
    async fn explain_query(&self, sql: &str) -> Result<ExecutionPlanNode, AppError> {
        let conn = self.conn.lock().await;
        let clean_sql = sql.trim().trim_end_matches(';');
        let json_sql = format!("EXPLAIN (FORMAT JSON) {}", clean_sql);

        if let Ok(mut stmt) = conn.prepare(&json_sql) {
            if let Ok(mut rows) = stmt.query([]) {
                if let Some(row) = rows.next().map_err(|e| AppError::Database(e.to_string()))? {
                    if let Ok(text) = row.get::<_, String>(1) {
                        if let Ok(parsed) = serde_json::from_str::<serde_json::Value>(&text) {
                            return Ok(parse_duckdb_plan_document(&parsed));
                        }
                    }
                }
            }
        }

        // Fallback: textual plan, surfaced as the detail of a single root node.
        let explain_sql = format!("EXPLAIN {}", clean_sql);
        let mut stmt = conn
            .prepare(&explain_sql)
            .map_err(|e| AppError::Database(format!("DuckDB EXPLAIN prepare failed: {}", e)))?;

        let mut rows = stmt
            .query([])
            .map_err(|e| AppError::Database(format!("DuckDB EXPLAIN execution failed: {}", e)))?;

        let mut plan_text = String::new();
        while let Some(row) = rows.next().map_err(|e| AppError::Database(e.to_string()))? {
            if let Ok(val) = row.get::<_, String>(1) {
                plan_text.push_str(&val);
            }
        }

        if plan_text.trim().is_empty() {
            return Ok(ExecutionPlanNode::new("Query Plan", None, 0.0, 0, None));
        }

        Ok(ExecutionPlanNode::new(
            "DuckDB Physical Plan",
            None,
            0.0,
            0,
            Some(plan_text),
        ))
    }

    /// @brief Reports DuckDb engine type.
    fn db_type(&self) -> DatabaseType {
        DatabaseType::DuckDb
    }
}
