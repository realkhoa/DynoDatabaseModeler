# Database Driver Subsystem (`src-tauri/src/driver`)

## 1. Overview & Purpose
The `driver` subsystem implements the multi-engine database adapter abstraction layer for DynoDbModeler. It establishes a unified, asynchronous trait interface (`DatabaseDriver`) that abstracts relational database management systems (SQLite, PostgreSQL, MySQL, and Microsoft SQL Server) behind common primitives for:
- Connection establishment and health verification (`test_connection`).
- Metadata catalog introspection into canonical domain models (`introspect_schema`).
- Arbitrary SQL execution returning tabular serialized JSON values (`execute_query`).
- Atomic transactional DDL migration batch execution with rollback on failure (`execute_ddl`).
- Atomic transactional row mutation batches targeted by primary keys (`update_rows`).
- Dialect identification (`db_type`).

A centralized factory (`DriverFactory`) dynamically selects and initializes the appropriate driver adapter based on the user's `ConnectionConfig.db_type`.

### Architectural Role
- **Unified Adapter Contract**: Standardizes database interactions across relational database engines via the `DatabaseDriver` trait.
- **Dynamic Factory Dispatch**: `DriverFactory::create(&ConnectionConfig)` evaluates engine dialect and initializes dedicated connection pools or TDS streams.
- **Deep Catalog Introspection**: Reverse-engineers native catalogs and schemas into canonical `DatabaseSchema` models containing tables, columns, primary keys, foreign keys, and indexes.
- **Fail-Safe Transactional Migrations**: Applies DDL scripts atomically within isolated transactions (`BEGIN ... COMMIT`), aborting and rolling back on the first failing statement.
- **Robust Type Normalization**: Provides dialect-specific type parsers (`parse_sqlite_type`, `parse_postgres_type`, `parse_mysql_type`, `parse_mssql_type`) to map vendor-specific types to the unified `CanonicalType` enum.

---

## 2. Prerequisites & Dependencies
- **Rust Toolchain**: `rustc` and `cargo` 1.80+ (2021 edition).
- **Core Dependencies**:
  - `async-trait` (v0.1): Dynamic asynchronous trait dispatch.
  - `sqlx` (v0.8): Async driver pool supporting `sqlite`, `postgres`, and `mysql` runtimes with `chrono` and `uuid`.
  - `tiberius` (v0.12): Async TDS protocol driver for Microsoft SQL Server.
  - `tokio-util` (v0.7): `TokioAsyncWriteCompatExt` adapter bridging Tokio TCP streams to futures-io for Tiberius.
  - `serde` (v1.0) & `serde_json` (v1.0): Serialization of tabular results and migration reports over Tauri IPC.
  - `tokio` (v1.0): Asynchronous runtime and synchronization primitives (`Mutex`, `RwLock`).

---

## 3. Driver Architecture & Component Reference

```
                             +------------------------+
                             |    ConnectionConfig    |
                             +------------------------+
                                         |
                                         v
                             +------------------------+
                             |     DriverFactory      |
                             +------------------------+
                               /     |        |      \
                              /      |        |       \
                             v       v        v        v
                      +--------+ +--------+ +-------+ +--------+
                      | Sqlite | |Postgres| | MySql | | Mssql  |
                      | Driver | | Driver | | Driver| | Driver |
                      +--------+ +--------+ +-------+ +--------+
                             \       |        |        /
                              \      |        |       /
                               v     v        v      v
                             +------------------------+
                             |   dyn DatabaseDriver   |
                             +------------------------+
```

### Common Trait: `DatabaseDriver`
Implemented by all engine driver adapters (`SqliteDriver`, `PostgresDriver`, `MySqlDriver`, `MssqlDriver`).

| Method | Signature | Description |
| :--- | :--- | :--- |
| `test_connection` | `async fn test_connection(&self) -> Result<(), AppError>` | Pings the database to verify credentials and connectivity. |
| `introspect_schema` | `async fn introspect_schema(&self) -> Result<DatabaseSchema, AppError>` | Extracts tables, columns, primary keys, and foreign keys. |
| `execute_query` | `async fn execute_query(&self, sql: &str) -> Result<QueryResult, AppError>` | Runs arbitrary SQL queries and returns column names and row values. |
| `execute_ddl` | `async fn execute_ddl(&self, statements: &[String]) -> Result<MigrationReport, AppError>` | Sequentially applies DDL statements inside an atomic transaction. |
| `update_rows` | `async fn update_rows(&self, updates: Vec<RowUpdatePayload>) -> Result<u64, AppError>` | Transactionally applies targeted row mutations with rollback on error. |
| `db_type` | `fn db_type(&self) -> DatabaseType` | Returns the database engine dialect identifier (`Sqlite`, `Postgres`, etc.). |

---

### Factory: `DriverFactory`
Central entry point for instantiating database driver adapters.

```rust
pub struct DriverFactory;

impl DriverFactory {
    pub async fn create(config: &ConnectionConfig) -> Result<Box<dyn DatabaseDriver>, AppError>;
}
```

- **`DatabaseType::Sqlite`**: Calls `SqliteDriver::connect(config)` (`sqlx::SqlitePool`).
- **`DatabaseType::Postgres`**: Calls `PostgresDriver::connect(config)` (`sqlx::PgPool`).
- **`DatabaseType::MySql`**: Calls `MySqlDriver::connect(config)` (`sqlx::MySqlPool`).
- **`DatabaseType::Mssql`**: Calls `MssqlDriver::connect(config)` (`tiberius::Client`).

---

### Engine Adapters

#### 1. SQLite (`SqliteDriver`)
- **Connection**: `sqlite:<path>` or `sqlite::memory:`. For in-memory databases, pool max connections is pinned to 1 to guarantee shared state across calls.
- **Introspection**:
  - Tables: `SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'`
  - Columns: `PRAGMA table_info('{table}')`
  - Foreign Keys: `PRAGMA foreign_key_list('{table}')`
- **Type Mapper**: `parse_sqlite_type(t: &str) -> CanonicalType`

#### 2. PostgreSQL (`PostgresDriver`)
- **Connection**: `postgres://{user}:{password}@{host}:{port}/{database}?sslmode={ssl_mode}`.
- **Introspection**:
  - Tables: `information_schema.tables WHERE table_schema NOT IN ('pg_catalog', 'information_schema') AND table_type = 'BASE TABLE'`
  - Columns: `information_schema.columns WHERE table_name = $1 AND table_schema = $2`
  - Primary Keys: `information_schema.table_constraints` joined with `information_schema.key_column_usage` (`tc.constraint_type = 'PRIMARY KEY'`)
  - Foreign Keys: `information_schema.table_constraints` joined with `information_schema.referential_constraints` and `constraint_column_usage`
- **Type Mapper**: `parse_postgres_type(dtype: &str, max_len: Option<i32>) -> CanonicalType`

#### 3. MySQL / MariaDB (`MySqlDriver`)
- **Connection**: `mysql://{user}:{password}@{host}:{port}/{database}`.
- **Introspection**:
  - Tables: `information_schema.TABLES WHERE TABLE_SCHEMA = ? AND TABLE_TYPE = 'BASE TABLE'`
  - Columns: `information_schema.COLUMNS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?`
  - Primary Keys: Column `COLUMN_KEY == 'PRI'`
  - Auto-Increment: Column `EXTRA` contains `auto_increment`
  - Foreign Keys: `information_schema.KEY_COLUMN_USAGE` joined with `information_schema.REFERENTIAL_CONSTRAINTS`
- **Type Mapper**: `parse_mysql_type(dtype: &str, max_len: Option<i64>) -> CanonicalType`

#### 4. Microsoft SQL Server (`MssqlDriver`)
- **Connection**: Native TDS socket via `TcpStream` and `tiberius::Client::connect`. Validates that host is provided.
- **Introspection**:
  - Tables: `INFORMATION_SCHEMA.TABLES WHERE TABLE_TYPE = 'BASE TABLE'`
  - Columns: `INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = ... AND TABLE_SCHEMA = ...`
  - Primary Keys: `INFORMATION_SCHEMA.TABLE_CONSTRAINTS` joined with `INFORMATION_SCHEMA.KEY_COLUMN_USAGE`
  - Foreign Keys: `INFORMATION_SCHEMA.TABLE_CONSTRAINTS` joined with `INFORMATION_SCHEMA.REFERENTIAL_CONSTRAINTS` and `INFORMATION_SCHEMA.CONSTRAINT_COLUMN_USAGE`
- **Type Mapper**: `parse_mssql_type(dtype: &str, max_len: Option<i32>) -> CanonicalType`

---

## 4. Usage Examples

### Instantiating Drivers via Factory
```rust
use dyno_db_modeler_lib::driver::factory::DriverFactory;
use dyno_db_modeler_lib::model::connection::{ConnectionConfig, DatabaseType};

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    // 1. PostgreSQL Connection
    let pg_config = ConnectionConfig {
        id: "pg-prod".to_string(),
        name: "Production PG".to_string(),
        db_type: DatabaseType::Postgres,
        host: Some("localhost".to_string()),
        port: Some(5432),
        database: "store_db".to_string(),
        username: Some("postgres".to_string()),
        password: Some("secret".to_string()),
        file_path: None,
        ssl: false,
    };
    let pg_driver = DriverFactory::create(&pg_config).await?;
    pg_driver.test_connection().await?;

    // 2. Introspect Schema
    let schema = pg_driver.introspect_schema().await?;
    println!("Found {} tables in PostgreSQL database", schema.tables.len());

    // 3. Execute Transactional Migration Batch
    let migration_report = pg_driver.execute_ddl(&[
        "CREATE TABLE audit_logs (id BIGSERIAL PRIMARY KEY, message TEXT NOT NULL);".to_string(),
    ]).await?;
    println!("Applied migration in {} ms", migration_report.execution_time_ms);

    // 4. Execute Transactional Row Mutation Batch
    use std::collections::HashMap;
    use dyno_db_modeler_lib::driver::RowUpdatePayload;

    let mut pks = HashMap::new();
    pks.insert("id".to_string(), serde_json::json!(1));
    let mut values = HashMap::new();
    values.insert("message".to_string(), serde_json::json!("Updated audit entry"));

    let affected = pg_driver.update_rows(vec![
        RowUpdatePayload::new("audit_logs", pks, values),
    ]).await?;
    println!("Mutated {} rows", affected);

    Ok(())
}
```

---

## 5. Troubleshooting & Edge Cases

- **PostgreSQL Schema Isolation**: Introspection automatically excludes internal Postgres system tables (`pg_catalog`, `information_schema`) to prevent cluttering application ERDs with internal metadata catalogs.
- **MySQL Boolean Emulation**: In MySQL, `TINYINT(1)` columns are commonly used to represent booleans. `parse_mysql_type` automatically inspects `max_len == Some(1)` and assigns `CanonicalType::Boolean`, while preserving larger `TINYINT` fields as `CanonicalType::SmallInt`.
- **MSSQL Host Requirement**: Microsoft SQL Server requires a network host address. If `config.host` is `None` or blank, `DriverFactory::create` immediately produces `AppError::Config` before initiating TCP handshakes.
- **Connection Acquisition Timeouts**: All networked driver pools enforce a 5-second connection acquisition timeout to avoid indefinite hanging during network failures.
- **DDL Rollback Guarantee**: `execute_ddl` encloses all statements in explicit transactions (`BEGIN ... COMMIT`). If any statement triggers a syntax error or constraint violation, the transaction is immediately rolled back and an `AppError::Migration` is returned.
- **Atomic Row Mutation Rollback**: `update_rows` executes all row mutations within an isolated transaction. If any update fails due to invalid column names, syntax errors, or check/foreign-key constraint violations, the entire transaction is rolled back immediately, ensuring no partial row updates remain committed.
