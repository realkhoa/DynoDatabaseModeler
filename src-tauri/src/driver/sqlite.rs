//! @file sqlite.rs
//! @brief SQLite database driver adapter using sqlx.
//! @details Provides connection handling, schema introspection via PRAGMA queries,
//! arbitrary query execution, and transactional DDL execution for SQLite.

use async_trait::async_trait;
use sqlx::{sqlite::SqlitePoolOptions, Column, Row, SqlitePool};
use std::time::Instant;

use super::{DatabaseDriver, ExecutionPlanNode, MigrationReport, QueryResult, RowUpdatePayload};
use crate::error::AppError;
use crate::model::connection::{ConnectionConfig, DatabaseType};
use crate::model::schema::*;

/// @brief SQLite database driver adapter providing connection pooling and schema introspection.
/// @details Wraps `sqlx::SqlitePool` to interact with local file-backed or in-memory SQLite instances.
pub struct SqliteDriver {
    pool: SqlitePool,
    database_name: String,
}

impl SqliteDriver {
    /// @brief Connects to a SQLite database using the provided configuration.
    /// @details Configures connection pooling. For in-memory databases (`:memory:`),
    /// a single connection pool limit is enforced to guarantee that all operations
    /// share the same underlying in-memory state.
    /// @param config Connection configuration options including file path and database name.
    /// @return Returns an initialized SqliteDriver or AppError::Connection on failure.
    pub async fn connect(config: &ConnectionConfig) -> Result<Self, AppError> {
        let path = config.file_path.as_deref().unwrap_or(":memory:");
        let conn_str = format!("sqlite:{}", path);
        let max_conns = if path == ":memory:" { 1 } else { 5 };
        let pool = SqlitePoolOptions::new()
            .max_connections(max_conns)
            .connect(&conn_str)
            .await
            .map_err(|e| AppError::Connection(e.to_string()))?;

        Ok(Self {
            pool,
            database_name: config.database.clone(),
        })
    }
}

#[async_trait]
impl DatabaseDriver for SqliteDriver {
    /// @brief Tests the SQLite database connection by executing a ping query.
    /// @return Returns Ok(()) if the database responds, or AppError::Connection on failure.
    async fn test_connection(&self) -> Result<(), AppError> {
        sqlx::query("SELECT 1")
            .execute(&self.pool)
            .await
            .map_err(|e| AppError::Connection(e.to_string()))?;
        Ok(())
    }

    /// @brief Introspects tables, columns, primary keys, and foreign keys from SQLite catalog.
    /// @details Queries `sqlite_master` for user tables, `PRAGMA table_info` for column definitions,
    /// and `PRAGMA foreign_key_list` for foreign key relationships.
    /// @return Returns a fully populated DatabaseSchema or AppError::Introspection on failure.
    async fn introspect_schema(&self) -> Result<DatabaseSchema, AppError> {
        let tables_rows = sqlx::query(
            "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'",
        )
        .fetch_all(&self.pool)
        .await
        .map_err(|e| AppError::Introspection(e.to_string()))?;

        let mut tables = Vec::new();

        for row in tables_rows {
            let table_name: String = row.get("name");

            // Query columns via PRAGMA table_info
            let col_query = format!("PRAGMA table_info('{}')", table_name);
            let col_rows = sqlx::query(&col_query)
                .fetch_all(&self.pool)
                .await
                .map_err(|e| AppError::Introspection(e.to_string()))?;

            let mut columns = Vec::new();
            for col in col_rows {
                let col_name: String = col.get("name");
                let raw_type: String = col.get("type");
                let not_null: i64 = col.get("notnull");
                let pk: i64 = col.get("pk");
                let dflt_value: Option<String> = col.get("dflt_value");

                let data_type = parse_sqlite_type(&raw_type);

                columns.push(ColumnSchema {
                    name: col_name,
                    data_type,
                    is_primary_key: pk > 0,
                    is_nullable: not_null == 0,
                    is_auto_increment: pk > 0 && raw_type.to_uppercase().contains("INTEGER"),
                    default_value: dflt_value,
                });
            }

            // Query foreign keys via PRAGMA foreign_key_list
            let fk_query = format!("PRAGMA foreign_key_list('{}')", table_name);
            let fk_rows = sqlx::query(&fk_query)
                .fetch_all(&self.pool)
                .await
                .map_err(|e| AppError::Introspection(e.to_string()))?;

            let mut foreign_keys = Vec::new();
            for fk in fk_rows {
                let id: i64 = fk.get("id");
                let target_table: String = fk.get("table");
                let from_col: String = fk.get("from");
                let to_col: Option<String> = fk.try_get("to").ok().flatten();
                let on_update_str: Option<String> = fk.try_get("on_update").ok().flatten();
                let on_delete_str: Option<String> = fk.try_get("on_delete").ok().flatten();

                foreign_keys.push(ForeignKeySchema {
                    constraint_name: format!("fk_{}_{}_{}", table_name, from_col, id),
                    source_column: from_col,
                    target_table,
                    target_column: to_col.unwrap_or_else(|| "id".to_string()),
                    on_delete: parse_referential_action(
                        on_delete_str.as_deref().unwrap_or("NO ACTION"),
                    ),
                    on_update: parse_referential_action(
                        on_update_str.as_deref().unwrap_or("NO ACTION"),
                    ),
                });
            }

            tables.push(TableSchema {
                name: table_name,
                schema: None,
                columns,
                foreign_keys,
                indexes: vec![],
                ui_position: None,
            });
        }

        Ok(DatabaseSchema {
            database_name: self.database_name.clone(),
            tables,
        })
    }

    /// @brief Executes an arbitrary SQL query against the SQLite database.
    /// @details Records execution duration, extracts column labels, and converts cell values
    /// into JSON string/null values for uniform tabular representation.
    /// @param sql SQL query string to execute.
    /// @return Returns QueryResult or AppError::Database on error.
    async fn execute_query(&self, sql: &str) -> Result<QueryResult, AppError> {
        let start = Instant::now();
        let rows = sqlx::query(sql)
            .fetch_all(&self.pool)
            .await
            .map_err(|e| AppError::Database(e.to_string()))?;

        let duration = start.elapsed().as_millis() as u64;

        let columns = match rows.first() {
            Some(first) => extract_column_names(first),
            None => vec![],
        };

        let result_rows = rows
            .iter()
            .map(|row| {
                (0..columns.len())
                    .map(|i| {
                        // Return string representation as JSON value
                        let val: Option<String> = row
                            .try_get::<String, _>(i)
                            .ok()
                            .or_else(|| row.try_get::<i64, _>(i).ok().map(|v| v.to_string()))
                            .or_else(|| row.try_get::<f64, _>(i).ok().map(|v| v.to_string()))
                            .or_else(|| row.try_get::<bool, _>(i).ok().map(|v| v.to_string()));
                        match val {
                            Some(s) => serde_json::Value::String(s),
                            None => serde_json::Value::Null,
                        }
                    })
                    .collect()
            })
            .collect();

        Ok(QueryResult {
            columns,
            rows: result_rows,
            rows_affected: rows.len() as u64,
            execution_time_ms: duration,
        })
    }

    /// @brief Executes a series of DDL statements inside an atomic database transaction.
    /// @details If any statement fails, the entire transaction is rolled back and an AppError::Migration is returned.
    /// Empty or whitespace-only statements are skipped.
    /// @param statements Ordered list of SQL DDL statements to execute.
    /// @return Returns MigrationReport on success, or AppError::Migration on rollback.
    async fn execute_ddl(&self, statements: &[String]) -> Result<MigrationReport, AppError> {
        let start = Instant::now();
        let mut tx = self
            .pool
            .begin()
            .await
            .map_err(|e| AppError::Migration(e.to_string()))?;

        for stmt in statements {
            let trimmed = stmt.trim();
            if trimmed.is_empty() {
                continue;
            }
            if let Err(e) = sqlx::query(trimmed).execute(&mut *tx).await {
                let _ = tx.rollback().await;
                return Err(AppError::Migration(format!(
                    "Failed on statement: {}: {}",
                    trimmed, e
                )));
            }
        }

        tx.commit()
            .await
            .map_err(|e| AppError::Migration(e.to_string()))?;

        Ok(MigrationReport {
            success: true,
            statements_executed: statements.len(),
            execution_time_ms: start.elapsed().as_millis() as u64,
            error_message: None,
        })
    }

    /// @brief Executes a batch of row mutations transactionally against the SQLite database.
    /// @details Begins a transaction on the connection pool, builds parameterized UPDATE statements
    /// for each payload (`UPDATE "table" SET "col" = ? WHERE "pk" = ?`), binds column and primary key values,
    /// and executes each statement sequentially. If any statement encounters an error (syntax, missing column,
    /// constraint violation), the transaction is explicitly rolled back and an `AppError::Database` is returned.
    /// On success, the transaction is committed and the total affected rows count is returned.
    /// @param updates List of row update payloads specifying tables, PKs, and modified column values.
    /// @return Returns the total count of rows affected across all updates, or AppError on rollback/failure.
    async fn update_rows(&self, updates: Vec<RowUpdatePayload>) -> Result<u64, AppError> {
        if updates.is_empty() {
            return Ok(0);
        }

        let mut tx = self
            .pool
            .begin()
            .await
            .map_err(|e| AppError::Database(e.to_string()))?;

        let mut total_affected = 0u64;

        for update in &updates {
            if update.updated_values.is_empty() {
                continue;
            }
            if update.primary_keys.is_empty() {
                let _ = tx.rollback().await;
                return Err(AppError::Database(
                    "Primary keys must not be empty for row mutation".to_string(),
                ));
            }

            let mut set_clauses = Vec::with_capacity(update.updated_values.len());
            let mut set_values = Vec::with_capacity(update.updated_values.len());
            for (col, val) in &update.updated_values {
                set_clauses.push(format!("\"{}\" = ?", col.replace('"', "\"\"")));
                set_values.push(val);
            }

            let mut where_clauses = Vec::with_capacity(update.primary_keys.len());
            let mut where_values = Vec::with_capacity(update.primary_keys.len());
            for (pk_col, pk_val) in &update.primary_keys {
                where_clauses.push(format!("\"{}\" = ?", pk_col.replace('"', "\"\"")));
                where_values.push(pk_val);
            }

            let table_esc = update.table.replace('"', "\"\"");
            let sql = format!(
                "UPDATE \"{}\" SET {} WHERE {};",
                table_esc,
                set_clauses.join(", "),
                where_clauses.join(" AND ")
            );

            let mut query = sqlx::query(&sql);
            for val in set_values.into_iter().chain(where_values.into_iter()) {
                query = bind_sqlite_val(query, val);
            }

            match query.execute(&mut *tx).await {
                Ok(res) => {
                    total_affected += res.rows_affected();
                }
                Err(e) => {
                    let _ = tx.rollback().await;
                    return Err(AppError::Database(format!(
                        "Row update failed on table '{}': {}",
                        update.table, e
                    )));
                }
            }
        }

        tx.commit()
            .await
            .map_err(|e| AppError::Database(e.to_string()))?;

        Ok(total_affected)
    }

    /// @brief Generates an execution plan tree for the provided SQL query via EXPLAIN QUERY PLAN.
    /// @param sql SQL statement string to analyze.
    /// @return Returns the root ExecutionPlanNode or AppError on query failure.
    async fn explain_query(&self, sql: &str) -> Result<ExecutionPlanNode, AppError> {
        let clean_sql = sql.trim().trim_end_matches(';');
        let explain_sql = format!("EXPLAIN QUERY PLAN {}", clean_sql);
        let rows = sqlx::query(&explain_sql)
            .fetch_all(&self.pool)
            .await
            .map_err(|e| AppError::Database(format!("EXPLAIN failed: {}", e)))?;

        struct RawPlanItem {
            id: i64,
            parent: i64,
            detail: String,
        }

        let mut items = Vec::new();
        for row in rows {
            let id: i64 = row.try_get::<i64, _>("id").unwrap_or(0);
            let parent: i64 = row.try_get::<i64, _>("parent").unwrap_or(0);
            let detail: String = row.try_get::<String, _>("detail").unwrap_or_default();
            items.push(RawPlanItem { id, parent, detail });
        }

        if items.is_empty() {
            return Ok(ExecutionPlanNode::new(
                "Execution Plan",
                None,
                0.0,
                0,
                Some("No operations planned".to_string()),
            ));
        }

        fn extract_relation(detail: &str) -> Option<String> {
            let words: Vec<&str> = detail.split_whitespace().collect();
            for i in 0..words.len() {
                if (words[i] == "TABLE" || words[i] == "SCAN" || words[i] == "SEARCH") && i + 1 < words.len() {
                    let candidate = words[i + 1].trim_matches(|c: char| !c.is_alphanumeric() && c != '_');
                    if candidate != "TABLE" && candidate != "SUBQUERY" && candidate != "USING" && !candidate.is_empty() {
                        return Some(candidate.to_string());
                    }
                }
            }
            None
        }

        fn item_to_node(detail: &str) -> ExecutionPlanNode {
            let (node_type, rel, cost) = if detail.contains("SCAN TABLE") || detail.contains("SCAN ") {
                (String::from("Scan Table"), extract_relation(detail), 100.0)
            } else if detail.contains("SEARCH TABLE") || detail.contains("SEARCH ") {
                (String::from("Index Search"), extract_relation(detail), 15.0)
            } else if detail.contains("USE TEMP B-TREE") {
                (String::from("Sort (Temp B-Tree)"), None, 45.0)
            } else {
                (String::from("Execution Step"), None, 10.0)
            };
            ExecutionPlanNode::new(node_type, rel, cost, 0, Some(detail.to_string()))
        }

        use std::collections::HashMap;
        let mut node_map: HashMap<i64, ExecutionPlanNode> = HashMap::new();
        let mut children_map: HashMap<i64, Vec<i64>> = HashMap::new();
        let mut root_ids = Vec::new();

        for item in &items {
            node_map.insert(item.id, item_to_node(&item.detail));
            if item.parent == 0 || !items.iter().any(|other| other.id == item.parent) {
                root_ids.push(item.id);
            } else {
                children_map.entry(item.parent).or_default().push(item.id);
            }
        }

        fn build_subtree(
            id: i64,
            node_map: &mut HashMap<i64, ExecutionPlanNode>,
            children_map: &HashMap<i64, Vec<i64>>,
        ) -> Option<ExecutionPlanNode> {
            let mut node = node_map.remove(&id)?;
            if let Some(child_ids) = children_map.get(&id) {
                for child_id in child_ids {
                    if let Some(child_node) = build_subtree(*child_id, node_map, children_map) {
                        node.children.push(child_node);
                    }
                }
            }
            Some(node)
        }

        if root_ids.len() == 1 {
            let root_id = root_ids[0];
            let root_node = build_subtree(root_id, &mut node_map, &children_map)
                .unwrap_or_else(|| ExecutionPlanNode::new("Query Plan", None, 0.0, 0, None));
            Ok(root_node)
        } else {
            let mut root = ExecutionPlanNode::new("Query Execution Plan", None, 0.0, 0, None);
            let mut total_cost = 0.0;
            for root_id in root_ids {
                if let Some(child) = build_subtree(root_id, &mut node_map, &children_map) {
                    total_cost += child.cost;
                    root.children.push(child);
                }
            }
            root.cost = total_cost;
            Ok(root)
        }
    }

    /// @brief Returns the database type dialect enum associated with this driver.
    /// @return Returns DatabaseType::Sqlite variant.
    fn db_type(&self) -> DatabaseType {
        DatabaseType::Sqlite
    }
}

/// @brief Binds a JSON value to a SQLite parameterized query.
/// @param query Target sqlx SQLite query.
/// @param val Reference to serde_json::Value to bind into the query.
/// @return Query with the bound value appended.
fn bind_sqlite_val<'a>(
    query: sqlx::query::Query<'a, sqlx::Sqlite, sqlx::sqlite::SqliteArguments<'a>>,
    val: &'a serde_json::Value,
) -> sqlx::query::Query<'a, sqlx::Sqlite, sqlx::sqlite::SqliteArguments<'a>> {
    match val {
        serde_json::Value::Null => query.bind(Option::<String>::None),
        serde_json::Value::Bool(b) => query.bind(*b),
        serde_json::Value::Number(n) => {
            if let Some(i) = n.as_i64() {
                query.bind(i)
            } else if let Some(f) = n.as_f64() {
                query.bind(f)
            } else {
                query.bind(n.to_string())
            }
        }
        serde_json::Value::String(s) => query.bind(s.as_str()),
        serde_json::Value::Array(_) | serde_json::Value::Object(_) => query.bind(val.to_string()),
    }
}

/// @brief Extracts column header names from a SQLite row.
/// @param row Reference to SQLite row containing column metadata.
/// @return Vector of column header strings.
fn extract_column_names(row: &sqlx::sqlite::SqliteRow) -> Vec<String> {
    let mut names = Vec::new();
    for col in row.columns() {
        names.push(col.name().to_string());
    }
    names
}

/// @brief Converts SQLite declared data type strings into standard CanonicalType.
/// @details Inspects type affinity per SQLite rules (INTEGER, TEXT/CHAR, BLOB, REAL, BOOLEAN).
/// Unrecognized or specific types default to CanonicalType::Custom.
/// @param t SQLite declared type string (e.g. "VARCHAR(255)", "INTEGER", "DATETIME").
/// @return Normalized CanonicalType representation.
pub fn parse_sqlite_type(t: &str) -> CanonicalType {
    let upper = t.to_uppercase();
    if upper.contains("INT") {
        CanonicalType::Integer
    } else if upper.contains("CHAR") || upper.contains("TEXT") || upper.contains("CLOB") {
        CanonicalType::Text
    } else if upper.contains("BLOB") {
        CanonicalType::Binary
    } else if upper.contains("REAL") || upper.contains("FLOA") || upper.contains("DOUB") {
        CanonicalType::Double
    } else if upper.contains("BOOL") {
        CanonicalType::Boolean
    } else {
        CanonicalType::Custom(t.to_string())
    }
}

/// @brief Maps SQLite foreign key referential action strings to ReferentialAction enum variants.
/// @details Supports standard SQL actions (CASCADE, SET NULL, RESTRICT, SET DEFAULT, NO ACTION).
/// Defaults to ReferentialAction::NoAction for unrecognized actions.
/// @param action Raw string action from PRAGMA foreign_key_list (e.g. "CASCADE", "SET NULL").
/// @return Corresponding ReferentialAction enum variant.
pub fn parse_referential_action(action: &str) -> ReferentialAction {
    match action.to_uppercase().as_str() {
        "CASCADE" => ReferentialAction::Cascade,
        "SET NULL" => ReferentialAction::SetNull,
        "RESTRICT" => ReferentialAction::Restrict,
        "SET DEFAULT" => ReferentialAction::SetDefault,
        _ => ReferentialAction::NoAction,
    }
}
