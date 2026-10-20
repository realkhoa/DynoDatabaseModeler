//! @file postgres.rs
//! @brief PostgreSQL database driver adapter using sqlx.
//! @details Provides connection pooling, schema introspection via the system catalogs,
//! arbitrary query execution, and transactional DDL migration execution for PostgreSQL.

use async_trait::async_trait;
use sqlx::postgres::{PgConnectOptions, PgPoolOptions, PgRow, PgSslMode};
use sqlx::{Column, PgPool, Row};
use std::time::Instant;

pub use super::parse_referential_action;
use super::{
    is_row_returning, parse_pg_action_code, qualify, with_decimal_metadata, DatabaseDriver,
    ExecutionPlanNode, MigrationReport, QueryResult, RowUpdatePayload,
};
use crate::error::AppError;
use crate::model::connection::{ConnectionConfig, DatabaseType};
use crate::model::schema::*;

const TABLE_QUERY: &str = concat!(
    "SELECT c.relname AS table_name, n.nspname AS table_schema ",
    "FROM pg_class c ",
    "JOIN pg_namespace n ON n.oid = c.relnamespace ",
    "WHERE c.relkind IN ('r', 'p') ",
    "  AND n.nspname NOT IN ('pg_catalog', 'information_schema') ",
    "  AND n.nspname NOT LIKE 'pg_toast%' ",
    "  AND n.nspname NOT LIKE 'pg_temp%' ",
    "ORDER BY n.nspname, c.relname;"
);

const COL_QUERY: &str = concat!(
    "SELECT column_name, data_type, is_nullable, column_default, character_maximum_length, ",
    "       numeric_precision, numeric_scale, is_identity, identity_generation ",
    "FROM information_schema.columns ",
    "WHERE table_name = $1 AND table_schema = $2 ",
    "ORDER BY ordinal_position;"
);

const PK_QUERY: &str = concat!(
    "SELECT kcu.column_name ",
    "FROM information_schema.table_constraints tc ",
    "JOIN information_schema.key_column_usage kcu ",
    "  ON tc.constraint_name = kcu.constraint_name AND tc.table_schema = kcu.table_schema ",
    "WHERE tc.constraint_type = 'PRIMARY KEY' AND tc.table_name = $1 AND tc.table_schema = $2 ",
    "ORDER BY kcu.ordinal_position;"
);

/// @brief Composite-safe foreign key introspection.
/// @details `information_schema.constraint_column_usage` cannot distinguish the columns of a
/// composite key (it joins on the referenced unique constraint, not on column positions), so the
/// `pg_constraint` catalog is used instead and each key column pair is unnested in ordinal order.
/// The referenced table is returned schema-qualified so regenerated constraints bind to the right
/// namespace.
const FK_QUERY: &str = concat!(
    "SELECT c.conname AS constraint_name, ",
    "       sa.attname AS source_column, ",
    "       tn.nspname || '.' || t.relname AS target_table, ",
    "       ta.attname AS target_column, ",
    "       c.confupdtype AS on_update, ",
    "       c.confdeltype AS on_delete ",
    "FROM pg_constraint c ",
    "JOIN pg_class t ON t.oid = c.confrelid ",
    "JOIN pg_namespace tn ON tn.oid = t.relnamespace ",
    "JOIN pg_class s ON s.oid = c.conrelid ",
    "JOIN pg_namespace sn ON sn.oid = s.relnamespace ",
    "JOIN LATERAL unnest(c.conkey, c.confkey) WITH ORDINALITY AS k(conkey, confkey, ord) ON true ",
    "JOIN pg_attribute sa ON sa.attrelid = s.oid AND sa.attnum = k.conkey ",
    "JOIN pg_attribute ta ON ta.attrelid = t.oid AND ta.attnum = k.confkey ",
    "WHERE c.contype = 'f' AND s.relname = $1 AND sn.nspname = $2 ",
    "ORDER BY c.conname, k.ord;"
);

/// @brief Index introspection excluding primary key and constraint-backing indexes.
/// @details Those indexes cannot be created with `CREATE INDEX` because they already exist as
/// constraint objects, so including them would produce failing DDL.
const INDEX_QUERY: &str = concat!(
    "SELECT i.relname AS index_name, ix.indisunique AS is_unique, a.attname AS column_name ",
    "FROM pg_index ix ",
    "JOIN pg_class i ON i.oid = ix.indexrelid ",
    "JOIN pg_class t ON t.oid = ix.indrelid ",
    "JOIN pg_namespace n ON n.oid = t.relnamespace ",
    "JOIN LATERAL unnest(ix.indkey) WITH ORDINALITY AS k(attnum, ord) ON true ",
    "JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = k.attnum ",
    "WHERE t.relname = $1 AND n.nspname = $2 ",
    "  AND NOT ix.indisprimary ",
    "  AND NOT EXISTS (SELECT 1 FROM pg_constraint c WHERE c.conindid = ix.indexrelid) ",
    "ORDER BY i.relname, k.ord;"
);

/// @brief PostgreSQL database driver adapter providing connection pooling and introspection.
/// @details Wraps `sqlx::PgPool` to interact with PostgreSQL server instances.
pub struct PostgresDriver {
    pool: PgPool,
    database_name: String,
}

impl PostgresDriver {
    /// @brief Connects to a PostgreSQL database using the provided configuration.
    /// @details Uses `PgConnectOptions` rather than a URL string so that credentials containing
    /// `@`, `:`, `/` or `%` are transmitted literally instead of breaking URL parsing. When SSL is
    /// requested the connection requires TLS.
    /// @param config Connection configuration options.
    /// @return Returns an initialized PostgresDriver or AppError::Connection on failure.
    pub async fn connect(config: &ConnectionConfig) -> Result<Self, AppError> {
        let host = config.host.as_deref().unwrap_or("localhost");
        let port = config.port.unwrap_or(5432);
        let user = config.username.as_deref().unwrap_or("postgres");

        let db_name = if config.database.trim().is_empty() {
            "postgres"
        } else {
            config.database.trim()
        };

        let mut options = PgConnectOptions::new()
            .host(host)
            .port(port)
            .username(user)
            .database(db_name)
            .ssl_mode(if config.ssl {
                PgSslMode::Require
            } else {
                PgSslMode::Disable
            });

        if let Some(password) = config.password.as_deref() {
            options = options.password(password);
        }

        let pool = PgPoolOptions::new()
            .max_connections(5)
            .acquire_timeout(std::time::Duration::from_secs(5))
            .connect_with(options)
            .await
            .map_err(|e| AppError::Connection(e.to_string()))?;

        Ok(Self {
            pool,
            database_name: db_name.to_string(),
        })
    }

    /// @brief Helper query execution for schema introspection bound to table and schema names.
    /// @param query Prepared SQL query string with two string placeholders ($1, $2).
    /// @param table Target table name.
    /// @param schema Target schema namespace name.
    /// @return Vector of result rows or AppError::Introspection.
    async fn fetch_table_meta(
        &self,
        query: &str,
        table: &str,
        schema: &str,
    ) -> Result<Vec<PgRow>, AppError> {
        sqlx::query(query)
            .bind(table)
            .bind(schema)
            .fetch_all(&self.pool)
            .await
            .map_err(|e| AppError::Introspection(e.to_string()))
    }
}

#[async_trait]
impl DatabaseDriver for PostgresDriver {
    /// @brief Tests the PostgreSQL database connection by executing a ping query.
    /// @return Returns Ok(()) if the database responds, or AppError::Connection on failure.
    async fn test_connection(&self) -> Result<(), AppError> {
        sqlx::query("SELECT 1")
            .execute(&self.pool)
            .await
            .map_err(|e| AppError::Connection(e.to_string()))?;
        Ok(())
    }

    /// @brief Introspects tables, columns, primary keys, foreign keys, and indexes from the catalog.
    /// @details Reads `pg_class`/`pg_namespace` for tables, `information_schema.columns` for column
    /// definitions (including numeric precision/scale and identity metadata), `pg_constraint` for
    /// composite-safe foreign keys, and `pg_index` for user indexes. Foreign key targets are stored
    /// schema-qualified.
    /// @return Returns a fully populated DatabaseSchema or AppError::Introspection on failure.
    async fn introspect_schema(&self) -> Result<DatabaseSchema, AppError> {
        let table_rows = sqlx::query(TABLE_QUERY)
            .fetch_all(&self.pool)
            .await
            .map_err(|e| AppError::Introspection(e.to_string()))?;

        let mut tables = Vec::new();
        for trow in table_rows {
            let table_name: String = trow.get("table_name");
            let table_schema: String = trow.get("table_schema");

            let col_rows = self
                .fetch_table_meta(COL_QUERY, &table_name, &table_schema)
                .await?;
            let pk_rows = self
                .fetch_table_meta(PK_QUERY, &table_name, &table_schema)
                .await?;
            let pks: Vec<String> = pk_rows.into_iter().map(|r| r.get("column_name")).collect();

            let mut columns = Vec::new();
            for crow in col_rows {
                let cname: String = crow.get("column_name");
                let dtype: String = crow.get("data_type");
                let nullable: String = crow.get("is_nullable");
                let cdefault: Option<String> = crow.get("column_default");
                let max_len: Option<i32> = crow.get("character_maximum_length");
                let numeric_precision: Option<i32> = crow.get("numeric_precision");
                let numeric_scale: Option<i32> = crow.get("numeric_scale");
                let is_identity: Option<String> = crow.try_get("is_identity").ok();
                let identity_generation: Option<String> = crow.try_get("identity_generation").ok();

                let is_pk = pks.contains(&cname);
                let canonical_type = with_decimal_metadata(
                    parse_postgres_type(&dtype, max_len),
                    numeric_precision.map(i64::from),
                    numeric_scale.map(i64::from),
                );

                // Identity columns (GENERATED ... AS IDENTITY) have a NULL default and are the
                // modern equivalent of SERIAL, so both forms must be recognised.
                let is_serial = cdefault
                    .as_deref()
                    .unwrap_or("")
                    .to_lowercase()
                    .starts_with("nextval(");
                let is_identity_column = is_identity.as_deref() == Some("YES");

                columns.push(ColumnSchema {
                    name: cname,
                    data_type: canonical_type,
                    is_primary_key: is_pk,
                    is_nullable: nullable.to_uppercase() == "YES",
                    is_auto_increment: is_serial || is_identity_column,
                    default_value: if is_identity_column {
                        identity_generation.clone().or(cdefault)
                    } else {
                        cdefault
                    },
                });
            }

            let fk_rows = self
                .fetch_table_meta(FK_QUERY, &table_name, &table_schema)
                .await?;

            let mut foreign_keys = Vec::new();
            for fk in fk_rows {
                let on_update_str: Option<String> = fk.try_get("on_update").ok();
                let on_delete_str: Option<String> = fk.try_get("on_delete").ok();

                foreign_keys.push(ForeignKeySchema {
                    constraint_name: fk.get("constraint_name"),
                    source_column: fk.get("source_column"),
                    target_table: fk.get("target_table"),
                    target_column: fk.get("target_column"),
                    on_delete: parse_pg_action_code(on_delete_str.as_deref().unwrap_or("a")),
                    on_update: parse_pg_action_code(on_update_str.as_deref().unwrap_or("a")),
                });
            }

            let index_rows = self
                .fetch_table_meta(INDEX_QUERY, &table_name, &table_schema)
                .await?;
            let mut indexes: Vec<IndexSchema> = Vec::new();
            for irow in index_rows {
                let index_name: String = irow.get("index_name");
                let is_unique: bool = irow.try_get("is_unique").unwrap_or(false);
                let column_name: String = irow.get("column_name");

                match indexes.iter_mut().find(|i| i.name == index_name) {
                    Some(existing) => existing.columns.push(column_name),
                    None => indexes.push(IndexSchema {
                        name: index_name,
                        columns: vec![column_name],
                        is_unique,
                    }),
                }
            }

            tables.push(TableSchema {
                name: table_name,
                schema: Some(table_schema),
                columns,
                foreign_keys,
                indexes,
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

    /// @brief Executes an arbitrary SQL query against PostgreSQL.
    /// @details Row-returning statements are fetched; other statements report the database's
    /// affected row count so DML is never reported as zero rows.
    /// @param sql SQL query string to execute.
    /// @return Returns QueryResult or AppError::Database on execution failure.
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
            Some(first) => first
                .columns()
                .iter()
                .map(|c| c.name().to_string())
                .collect(),
            None => vec![],
        };

        let result_rows = rows
            .iter()
            .map(|row| {
                (0..columns.len())
                    .map(|i| format_cell_value(row, i))
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

    /// @brief Executes a batch of DDL statements inside an atomic transaction.
    /// @param statements Ordered list of SQL DDL statements to apply.
    /// @return Returns MigrationReport on success or AppError::Migration on failure.
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
                    "Statement failed: {}: {}",
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

    /// @brief Executes a batch of row mutations transactionally against PostgreSQL.
    /// @details Builds parameterized UPDATE statements (`UPDATE "table" SET "col" = $1 WHERE "pk" = $2`)
    /// and binds every value, so no user data is ever interpolated into SQL. In strict single-row
    /// mode a locator that does not match exactly one row aborts and rolls back the batch.
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
            let mut ordered_values: Vec<&serde_json::Value> =
                Vec::with_capacity(update.updated_values.len() + update.primary_keys.len());

            for (col, val) in &update.updated_values {
                set_clauses.push(format!(
                    "{} = ${}",
                    format_pg_ident(col),
                    ordered_values.len() + 1
                ));
                ordered_values.push(val);
            }

            let mut where_clauses = Vec::with_capacity(update.primary_keys.len());
            for (pk_col, pk_val) in &update.primary_keys {
                where_clauses.push(format!(
                    "{} = ${}",
                    format_pg_ident(pk_col),
                    ordered_values.len() + 1
                ));
                ordered_values.push(pk_val);
            }

            let sql = format!(
                "UPDATE {} SET {} WHERE {};",
                format_pg_ident(&update.table),
                set_clauses.join(", "),
                where_clauses.join(" AND ")
            );

            let mut query = sqlx::query(&sql);
            for val in ordered_values {
                query = bind_pg_val(query, val);
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

    /// @brief Generates an execution plan tree for the provided SQL query via EXPLAIN (FORMAT JSON).
    /// @param sql SQL statement string to analyze.
    /// @return Returns the root ExecutionPlanNode or AppError on query failure.
    async fn explain_query(&self, sql: &str) -> Result<ExecutionPlanNode, AppError> {
        let clean_sql = sql.trim().trim_end_matches(';');
        let explain_sql = format!("EXPLAIN (FORMAT JSON) {}", clean_sql);
        let rows = sqlx::query(&explain_sql)
            .fetch_all(&self.pool)
            .await
            .map_err(|e| AppError::Database(format!("EXPLAIN failed: {}", e)))?;

        if let Some(first_row) = rows.first() {
            let val_opt: Option<serde_json::Value> = first_row
                .try_get::<serde_json::Value, _>(0)
                .ok()
                .or_else(|| {
                    first_row
                        .try_get::<String, _>(0)
                        .ok()
                        .and_then(|s| serde_json::from_str(&s).ok())
                });
            if let Some(val) = val_opt {
                if let Some(plan_arr) = val.as_array() {
                    if let Some(first_item) = plan_arr.first() {
                        if let Some(plan_obj) = first_item.get("Plan") {
                            return Ok(parse_pg_plan_node(plan_obj));
                        }
                    }
                }
            }
        }
        Ok(ExecutionPlanNode::new("Query Plan", None, 0.0, 0, None))
    }

    /// @brief Lists all user databases accessible on the PostgreSQL cluster.
    /// @return Vector of database names accessible by the user.
    async fn list_databases(&self) -> Result<Vec<String>, AppError> {
        let rows = sqlx::query(
            "SELECT datname FROM pg_database WHERE datistemplate = false AND has_database_privilege(datname, 'CONNECT') ORDER BY datname;"
        )
        .fetch_all(&self.pool)
        .await
        .map_err(|e| AppError::Database(e.to_string()))?;

        let names: Vec<String> = rows
            .into_iter()
            .filter_map(|r| r.try_get::<String, _>("datname").ok())
            .collect();
        Ok(names)
    }

    /// @brief Returns the database dialect type for PostgreSQL.
    /// @return Returns DatabaseType::Postgres.
    fn db_type(&self) -> DatabaseType {
        DatabaseType::Postgres
    }
}

/// @brief Recursively parses a PostgreSQL EXPLAIN JSON plan node into an ExecutionPlanNode.
/// @param val Reference to JSON Value representing the node.
/// @return Populated ExecutionPlanNode instance.
fn parse_pg_plan_node(val: &serde_json::Value) -> ExecutionPlanNode {
    let node_type = val
        .get("Node Type")
        .and_then(|v| v.as_str())
        .unwrap_or("Plan Node")
        .to_string();
    let relation = val
        .get("Relation Name")
        .and_then(|v| v.as_str())
        .map(|s| s.to_string());
    let cost = val
        .get("Total Cost")
        .and_then(|v| v.as_f64())
        .unwrap_or(0.0);
    let rows = val.get("Plan Rows").and_then(|v| v.as_u64()).unwrap_or(0);
    let actual_time = val.get("Actual Total Time").and_then(|v| v.as_f64());
    let mut node = ExecutionPlanNode::new(node_type, relation, cost, rows, None);
    node.actual_time_ms = actual_time;
    if let Some(children_arr) = val.get("Plans").and_then(|v| v.as_array()) {
        for child in children_arr {
            node.children.push(parse_pg_plan_node(child));
        }
    }
    node
}

/// @brief Formats an identifier for PostgreSQL quoting (supporting dot-separated schema paths).
/// @param ident Identifier string (table, column, or schema name).
/// @return Properly double-quoted PostgreSQL identifier.
fn format_pg_ident(ident: &str) -> String {
    if ident.contains('.') {
        ident
            .split('.')
            .map(|part| format!("\"{}\"", part.replace('"', "\"\"")))
            .collect::<Vec<_>>()
            .join(".")
    } else {
        format!("\"{}\"", ident.replace('"', "\"\""))
    }
}

/// @brief Binds a JSON value to a PostgreSQL parameterized query.
/// @param query Target sqlx PostgreSQL query.
/// @param val Reference to serde_json::Value to bind into the query.
/// @return Query with the bound value appended.
fn bind_pg_val<'a>(
    query: sqlx::query::Query<'a, sqlx::Postgres, sqlx::postgres::PgArguments>,
    val: &'a serde_json::Value,
) -> sqlx::query::Query<'a, sqlx::Postgres, sqlx::postgres::PgArguments> {
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

/// @brief Formats a PostgreSQL row cell into a JSON value.
/// @details Every PostgreSQL type a data grid commonly renders is attempted: text, integers,
/// floats, booleans, decimals (NUMERIC), temporal types, JSON/JSONB and binary. Without the decimal
/// and temporal attempts NUMERIC and TIMESTAMP columns were rendered as NULL.
/// @param row PostgreSQL row reference.
/// @param idx Column ordinal index.
/// @return Extracted cell JSON representation.
fn format_cell_value(row: &PgRow, idx: usize) -> serde_json::Value {
    let text: Option<String> = row
        .try_get::<String, _>(idx)
        .ok()
        .or_else(|| row.try_get::<Option<String>, _>(idx).ok().flatten())
        .or_else(|| row.try_get::<i64, _>(idx).ok().map(|v| v.to_string()))
        .or_else(|| row.try_get::<i32, _>(idx).ok().map(|v| v.to_string()))
        .or_else(|| row.try_get::<i16, _>(idx).ok().map(|v| v.to_string()))
        .or_else(|| row.try_get::<f64, _>(idx).ok().map(|v| v.to_string()))
        .or_else(|| row.try_get::<f32, _>(idx).ok().map(|v| v.to_string()))
        .or_else(|| row.try_get::<bool, _>(idx).ok().map(|v| v.to_string()))
        .or_else(|| {
            row.try_get::<rust_decimal::Decimal, _>(idx)
                .ok()
                .map(super::format_decimal)
        })
        .or_else(|| {
            row.try_get::<chrono::NaiveDateTime, _>(idx)
                .ok()
                .map(|v| v.to_string())
        })
        .or_else(|| {
            row.try_get::<chrono::DateTime<chrono::Utc>, _>(idx)
                .ok()
                .map(|v| v.to_rfc3339())
        })
        .or_else(|| {
            row.try_get::<chrono::NaiveDate, _>(idx)
                .ok()
                .map(|v| v.to_string())
        })
        .or_else(|| {
            row.try_get::<chrono::NaiveTime, _>(idx)
                .ok()
                .map(|v| v.to_string())
        })
        .or_else(|| {
            row.try_get::<serde_json::Value, _>(idx)
                .ok()
                .map(|v| v.to_string())
        })
        .or_else(|| {
            row.try_get::<Vec<u8>, _>(idx)
                .ok()
                .map(|bytes| super::describe_binary(&bytes))
        });

    match text {
        Some(s) => serde_json::Value::String(s),
        None => serde_json::Value::Null,
    }
}

/// @brief Parses PostgreSQL data type strings and lengths into canonical types.
/// @details Numeric precision and scale are merged in separately through
/// [`with_decimal_metadata`] because they live in dedicated catalog columns.
/// @param dtype Raw PostgreSQL data type name from information_schema.
/// @param max_len Optional character maximum length constraint.
/// @return Normalized CanonicalType representation.
pub fn parse_postgres_type(dtype: &str, max_len: Option<i32>) -> CanonicalType {
    match dtype.to_lowercase().as_str() {
        "integer" | "int4" => CanonicalType::Integer,
        "bigint" | "int8" => CanonicalType::BigInt,
        "smallint" | "int2" => CanonicalType::SmallInt,
        "boolean" | "bool" => CanonicalType::Boolean,
        "text" => CanonicalType::Text,
        "character varying" | "varchar" => CanonicalType::Varchar(max_len.map(|l| l as u32)),
        "character" | "char" => CanonicalType::Char(max_len.map(|l| l as u32)),
        "uuid" => CanonicalType::Uuid,
        "json" | "jsonb" => CanonicalType::Json,
        "bytea" => CanonicalType::Binary,
        "numeric" | "decimal" => CanonicalType::Decimal {
            precision: None,
            scale: None,
        },
        "real" | "float4" => CanonicalType::Float,
        "double precision" | "float8" => CanonicalType::Double,
        "date" => CanonicalType::Date,
        "time" | "time without time zone" => CanonicalType::Time,
        "timestamp"
        | "timestamp without time zone"
        | "timestamp with time zone"
        | "timestamptz" => CanonicalType::Timestamp,
        _ => CanonicalType::Custom(dtype.to_string()),
    }
}

/// @brief Builds a schema-qualified table key for PostgreSQL objects.
/// @param schema Schema namespace name.
/// @param table Bare table name.
/// @return Qualified `schema.table` identifier.
pub fn qualify_table(schema: &str, table: &str) -> String {
    qualify(Some(schema), table)
}
