//! @file sqlite.rs
//! @brief SQLite database driver adapter using sqlx.
//! @details Provides connection handling, schema introspection via PRAGMA queries,
//! arbitrary query execution, and transactional DDL execution for SQLite.

use async_trait::async_trait;
use sqlx::{sqlite::SqlitePoolOptions, Column, Connection, Row, SqlitePool};
use std::time::Instant;

use super::{
    is_row_returning, DatabaseDriver, ExecutionPlanNode, MigrationReport, QueryResult,
    RowUpdatePayload,
};
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

    /// @brief Introspects secondary indexes on one table.
    /// @details Implicit indexes (`sqlite_autoindex_*`, primary key indexes) are skipped because
    /// they cannot be created explicitly.
    /// @param table_name Name of the table to inspect.
    /// @return Vector of IndexSchema definitions.
    async fn introspect_indexes(&self, table_name: &str) -> Result<Vec<IndexSchema>, AppError> {
        let list_sql = format!("PRAGMA index_list('{}')", table_name.replace('\'', "''"));
        let rows = sqlx::query(&list_sql)
            .fetch_all(&self.pool)
            .await
            .map_err(|e| AppError::Introspection(e.to_string()))?;

        let mut indexes = Vec::new();
        for row in rows {
            let name: String = row.try_get("name").unwrap_or_default();
            let is_unique: i64 = row.try_get("unique").unwrap_or(0);
            let origin: String = row.try_get("origin").unwrap_or_default();

            // Skip primary-key and implicit indexes: they cannot be recreated by name.
            if origin == "pk" || name.starts_with("sqlite_") {
                continue;
            }

            let info_sql = format!("PRAGMA index_info('{}')", name.replace('\'', "''"));
            let col_rows = sqlx::query(&info_sql)
                .fetch_all(&self.pool)
                .await
                .map_err(|e| AppError::Introspection(e.to_string()))?;

            let mut columns: Vec<(i64, String)> = Vec::new();
            for col_row in col_rows {
                let seqno: i64 = col_row.try_get("seqno").unwrap_or(0);
                let col_name: Option<String> = col_row.try_get("name").ok();
                if let Some(col_name) = col_name {
                    columns.push((seqno, col_name));
                }
            }
            columns.sort_by_key(|(seqno, _)| *seqno);

            if columns.is_empty() {
                continue;
            }

            indexes.push(IndexSchema {
                name,
                columns: columns.into_iter().map(|(_, c)| c).collect(),
                is_unique: is_unique != 0,
            });
        }

        Ok(indexes)
    }

    /// @brief Detects dialect constructs that make a full table rebuild unsafe.
    /// @details A rebuild re-creates the table from the canonical model, which cannot represent
    /// triggers, CHECK constraints, generated columns, `WITHOUT ROWID` tables, COLLATE overrides,
    /// or dependent views. Reporting them lets the SQLite DDL generator refuse the rebuild instead
    /// of silently dropping those objects.
    /// @param table_name Name of the table to inspect.
    /// @return Vector of human-readable blocker descriptions.
    async fn introspect_rebuild_blockers(&self, table_name: &str) -> Vec<String> {
        let mut blockers = Vec::new();

        // Triggers attached to the table.
        if let Ok(rows) = sqlx::query(
            "SELECT name FROM sqlite_master WHERE type = 'trigger' AND tbl_name = ? ORDER BY name",
        )
        .bind(table_name)
        .fetch_all(&self.pool)
        .await
        {
            for row in rows {
                if let Ok(name) = row.try_get::<String, _>("name") {
                    blockers.push(format!("trigger: {}", name));
                }
            }
        }

        // Views that mention the table by name (conservative: a false positive only blocks a rebuild).
        if let Ok(rows) = sqlx::query(
            "SELECT name FROM sqlite_master WHERE type = 'view' AND sql LIKE ? ORDER BY name",
        )
        .bind(format!("%{}%", table_name))
        .fetch_all(&self.pool)
        .await
        {
            for row in rows {
                if let Ok(name) = row.try_get::<String, _>("name") {
                    blockers.push(format!("view: {}", name));
                }
            }
        }

        // Generated columns (hidden = 2 virtual, 3 stored).
        let xinfo_sql = format!("PRAGMA table_xinfo('{}')", table_name.replace('\'', "''"));
        if let Ok(rows) = sqlx::query(&xinfo_sql).fetch_all(&self.pool).await {
            for row in rows {
                let hidden: i64 = row.try_get("hidden").unwrap_or(0);
                if hidden == 2 || hidden == 3 {
                    let name: String = row.try_get("name").unwrap_or_default();
                    blockers.push(format!("generated column: {}", name));
                }
            }
        }

        // Table SQL features the canonical model cannot round-trip.
        if let Ok(Some(sql)) = sqlx::query_scalar::<_, String>(
            "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = ?",
        )
        .bind(table_name)
        .fetch_optional(&self.pool)
        .await
        {
            let upper = sql.to_uppercase();
            if upper.contains("CHECK") {
                blockers.push("CHECK constraint".to_string());
            }
            if upper.contains("WITHOUT ROWID") {
                blockers.push("WITHOUT ROWID table".to_string());
            }
            if upper.contains("COLLATE") {
                blockers.push("column COLLATE override".to_string());
            }
        }

        blockers
    }

    /// @brief Runs a DDL batch inside a single transaction on one dedicated connection.
    /// @details Foreign key enforcement is toggled on the same connection that owns the transaction:
    /// `PRAGMA foreign_keys` is per connection, so setting it on the pool could leave the transaction
    /// running on a connection where enforcement is still active, which would abort the rebuild
    /// sequence that drops a referenced table. The previous setting is restored regardless of outcome.
    /// @param statements Ordered list of SQL DDL statements to execute.
    /// @param start Instant captured before the batch began, for duration reporting.
    /// @return MigrationReport on success, or AppError::Migration after rollback.
    async fn run_ddl_batch(
        &self,
        statements: &[String],
        start: Instant,
    ) -> Result<MigrationReport, AppError> {
        let mut conn = self
            .pool
            .acquire()
            .await
            .map_err(|e| AppError::Migration(e.to_string()))?;

        let fk_was_enabled: bool = sqlx::query_scalar::<_, i64>("PRAGMA foreign_keys")
            .fetch_one(&mut *conn)
            .await
            .map(|v| v != 0)
            .unwrap_or(false);

        if fk_was_enabled {
            let _ = sqlx::query("PRAGMA foreign_keys = OFF")
                .execute(&mut *conn)
                .await;
        }

        let result = Self::apply_statements(&mut conn, statements, start).await;

        if fk_was_enabled {
            let _ = sqlx::query("PRAGMA foreign_keys = ON")
                .execute(&mut *conn)
                .await;
        }

        result
    }

    /// @brief Applies the statement list transactionally on an already-acquired connection.
    /// @param conn Dedicated pooled connection that will own the transaction.
    /// @param statements Ordered list of SQL DDL statements to execute.
    /// @param start Instant captured before the batch began, for duration reporting.
    /// @return MigrationReport on success, or AppError::Migration after rollback.
    async fn apply_statements(
        conn: &mut sqlx::SqliteConnection,
        statements: &[String],
        start: Instant,
    ) -> Result<MigrationReport, AppError> {
        let mut tx = conn
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

    /// @brief Introspects tables, columns, primary keys, foreign keys, and indexes from SQLite catalog.
    /// @details Queries `sqlite_master` for user tables, `PRAGMA table_info` for column definitions,
    /// `PRAGMA foreign_key_list` for foreign key relationships, and `PRAGMA index_list`/`index_info`
    /// for secondary indexes. AUTOINCREMENT is only reported for a single-column INTEGER primary key
    /// that is actually declared AUTOINCREMENT, so round-tripping a plain `INTEGER PRIMARY KEY` table
    /// does not silently upgrade it.
    /// @return Returns a fully populated DatabaseSchema or AppError::Introspection on failure.
    async fn introspect_schema(&self) -> Result<DatabaseSchema, AppError> {
        let tables_rows = sqlx::query(
            "SELECT name, sql FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'",
        )
        .fetch_all(&self.pool)
        .await
        .map_err(|e| AppError::Introspection(e.to_string()))?;

        let mut tables = Vec::new();

        for row in tables_rows {
            let table_name: String = row.get("name");
            let table_sql: Option<String> = row.try_get("sql").ok();
            let declares_autoincrement = table_sql
                .as_deref()
                .map(|s| s.to_uppercase().contains("AUTOINCREMENT"))
                .unwrap_or(false);

            // Query columns via PRAGMA table_info
            let col_query = format!("PRAGMA table_info('{}')", table_name.replace('\'', "''"));
            let col_rows = sqlx::query(&col_query)
                .fetch_all(&self.pool)
                .await
                .map_err(|e| AppError::Introspection(e.to_string()))?;

            let mut columns = Vec::new();
            let mut pk_columns: Vec<(String, String)> = Vec::new();
            for col in &col_rows {
                let col_name: String = col.get("name");
                let raw_type: String = col.get("type");
                let not_null: i64 = col.get("notnull");
                let pk: i64 = col.get("pk");
                let dflt_value: Option<String> = col.get("dflt_value");

                let data_type = parse_sqlite_type(&raw_type);

                if pk > 0 {
                    pk_columns.push((col_name.clone(), raw_type.clone()));
                }

                columns.push(ColumnSchema {
                    name: col_name,
                    data_type,
                    is_primary_key: pk > 0,
                    is_nullable: not_null == 0,
                    is_auto_increment: false,
                    default_value: dflt_value,
                });
            }

            // AUTOINCREMENT is only valid on a single INTEGER PRIMARY KEY column.
            if declares_autoincrement && pk_columns.len() == 1 {
                let (pk_name, pk_type) = &pk_columns[0];
                if pk_type.to_uppercase().contains("INT") {
                    if let Some(target) = columns.iter_mut().find(|c| &c.name == pk_name) {
                        target.is_auto_increment = true;
                    }
                }
            }

            // Query foreign keys via PRAGMA foreign_key_list
            let fk_query = format!(
                "PRAGMA foreign_key_list('{}')",
                table_name.replace('\'', "''")
            );
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

            let indexes = self.introspect_indexes(&table_name).await?;
            let unsupported_features = self.introspect_rebuild_blockers(&table_name).await;

            tables.push(TableSchema {
                name: table_name,
                schema: None,
                columns,
                foreign_keys,
                indexes,
                ui_position: None,
                rename_from: None,
                unsupported_features,
            });
        }

        Ok(DatabaseSchema {
            database_name: self.database_name.clone(),
            tables,
        })
    }

    /// @brief Executes an arbitrary SQL query against the SQLite database.
    /// @details Row-returning statements are fetched as a result set; other statements are executed
    /// and report the database's affected row count, so an UPDATE or DELETE never reports zero rows.
    /// @param sql SQL query string to execute.
    /// @return Returns QueryResult or AppError::Database on error.
    async fn execute_query(&self, sql: &str) -> Result<QueryResult, AppError> {
        let start = Instant::now();

        if !is_row_returning(sql) {
            let res = sqlx::query(sql)
                .execute(&self.pool)
                .await
                .map_err(|e| AppError::Database(e.to_string()))?;
            return Ok(QueryResult {
                columns: vec![],
                rows: vec![],
                rows_affected: res.rows_affected(),
                execution_time_ms: start.elapsed().as_millis() as u64,
            });
        }

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
    /// @details Runs on one dedicated connection so foreign key enforcement can be disabled for the
    /// duration of the batch on the connection that owns the transaction, matching the documented
    /// SQLite procedure for schema migrations (the rebuild sequence drops and recreates a table that
    /// other tables reference). Empty or whitespace-only statements are skipped.
    /// @param statements Ordered list of SQL DDL statements to execute.
    /// @return Returns MigrationReport on success, or AppError::Migration on rollback.
    async fn execute_ddl(&self, statements: &[String]) -> Result<MigrationReport, AppError> {
        let start = Instant::now();
        self.run_ddl_batch(statements, start).await
    }

    /// @brief Executes a batch of row mutations transactionally against the SQLite database.
    /// @details Begins a transaction on the connection pool, builds parameterized UPDATE statements
    /// for each payload (`UPDATE "table" SET "col" = ? WHERE "pk" = ?`), binds column and primary key
    /// values, and executes each statement sequentially. In strict single-row mode a locator that
    /// matches anything other than exactly one row aborts and rolls back the whole batch instead of
    /// silently modifying the wrong rows.
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
            if let Err(message) = update.validate_locator() {
                let _ = tx.rollback().await;
                return Err(AppError::Database(message));
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
                    if let Err(message) = update.check_affected_rows(res.rows_affected()) {
                        let _ = tx.rollback().await;
                        return Err(AppError::Database(message));
                    }
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
                if (words[i] == "TABLE" || words[i] == "SCAN" || words[i] == "SEARCH")
                    && i + 1 < words.len()
                {
                    let candidate =
                        words[i + 1].trim_matches(|c: char| !c.is_alphanumeric() && c != '_');
                    if candidate != "TABLE"
                        && candidate != "SUBQUERY"
                        && candidate != "USING"
                        && !candidate.is_empty()
                    {
                        return Some(candidate.to_string());
                    }
                }
            }
            None
        }

        fn item_to_node(detail: &str) -> ExecutionPlanNode {
            let (node_type, rel, cost) =
                if detail.contains("SCAN TABLE") || detail.contains("SCAN ") {
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
/// @details Delegates to the shared dialect-neutral parser so a single implementation is used by all
/// drivers.
/// @param action Raw string action from PRAGMA foreign_key_list (e.g. "CASCADE", "SET NULL").
/// @return Corresponding ReferentialAction enum variant.
pub fn parse_referential_action(action: &str) -> ReferentialAction {
    super::parse_referential_action(action)
}
