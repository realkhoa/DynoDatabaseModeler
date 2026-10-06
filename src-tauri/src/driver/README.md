# Database Driver Subsystem (`src-tauri/src/driver`)

## 1. Overview & Purpose
The `driver` module implements the database adapter abstraction layer for DynoDbModeler. It establishes a unified, asynchronous interface (`DatabaseDriver`) that isolates database engine differences (SQLite, PostgreSQL, MySQL, MSSQL) behind common abstractions for connection health verification, schema introspection, arbitrary SQL execution, and transactional migration DDL application.

### Architectural Role
- **Unified Adapter Contract**: Standardizes database interactions across relational database management systems through the `DatabaseDriver` trait.
- **Catalog Introspection**: Queries native database system catalogs and pragmas to reverse-engineer tables, columns, data types, primary keys, and foreign key relations into canonical `DatabaseSchema` structures.
- **Safe Transactional Migrations**: Executes batches of DDL migration statements atomically inside database transactions with automatic rollback on error.
- **Embedded & Cloud Support**: Implements native support for embedded SQLite databases (in-memory and file-based) with connection pooling via `sqlx`.

---

## 2. Prerequisites & Dependencies
- **Rust Toolchain**: `rustc` and `cargo` 1.77+ (2021 edition).
- **Core Crates**:
  - `async-trait` (v0.1): Asynchronous trait definition support in Rust.
  - `sqlx` (v0.8): Asynchronous SQL driver with `sqlite`, `runtime-tokio`, `chrono`, and `uuid` features enabled.
  - `serde` (v1.0) & `serde_json` (v1.0): Serialization of query results and migration reports.
  - `tokio` (v1.0): Async runtime and synchronization primitives.

---

## 3. API & Trait Reference

### Common Trait: `DatabaseDriver`
Implemented by all engine driver adapters (`SqliteDriver`, and future PostgreSQL, MySQL, MSSQL drivers).

| Method | Signature | Description |
| :--- | :--- | :--- |
| `test_connection` | `async fn test_connection(&self) -> Result<(), AppError>` | Pings the database to verify credentials and connectivity. |
| `introspect_schema` | `async fn introspect_schema(&self) -> Result<DatabaseSchema, AppError>` | Extracts tables, columns, primary keys, and foreign keys. |
| `execute_query` | `async fn execute_query(&self, sql: &str) -> Result<QueryResult, AppError>` | Runs arbitrary SQL queries and returns columns and row values. |
| `execute_ddl` | `async fn execute_ddl(&self, statements: &[String]) -> Result<MigrationReport, AppError>` | Sequentially applies DDL statements inside an atomic transaction. |
| `db_type` | `fn db_type(&self) -> DatabaseType` | Returns the database engine dialect identifier (`Sqlite`, `Postgres`, etc.). |

### Data Transfer Structures

| Struct | Field | Type | Description |
| :--- | :--- | :--- | :--- |
| `MigrationReport` | `success` | `bool` | Whether all statements completed and committed. |
| | `statements_executed` | `usize` | Total count of statements applied. |
| | `execution_time_ms` | `u64` | Elapsed execution duration in milliseconds. |
| | `error_message` | `Option<String>` | Error message if transaction failed and rolled back. |
| `QueryResult` | `columns` | `Vec<String>` | Column labels returned by the query. |
| | `rows` | `Vec<Vec<serde_json::Value>>` | Tabular cell values formatted as JSON values. |
| | `rows_affected` | `u64` | Total rows affected or returned. |
| | `execution_time_ms` | `u64` | Elapsed query duration in milliseconds. |

### Adapter: `SqliteDriver`
Provides embedded SQLite support.
- `SqliteDriver::connect(config: &ConnectionConfig) -> Result<Self, AppError>`: Establishes a connection pool. For in-memory databases (`:memory:`), enforces single-connection pooling to preserve transient in-memory tables across calls.
- `parse_sqlite_type(t: &str) -> CanonicalType`: Maps SQLite type affinities (`INTEGER`, `TEXT`, `BLOB`, `REAL`, `BOOLEAN`) to universal canonical types.
- `parse_referential_action(action: &str) -> ReferentialAction`: Normalizes foreign key action strings (`CASCADE`, `SET NULL`, `RESTRICT`, `SET DEFAULT`, `NO ACTION`).

---

## 4. Usage Examples

### Connecting to an In-Memory SQLite Database and Running Migrations
```rust
use dyno_db_modeler_lib::driver::sqlite::SqliteDriver;
use dyno_db_modeler_lib::driver::DatabaseDriver;
use dyno_db_modeler_lib::model::connection::{ConnectionConfig, DatabaseType};

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    let config = ConnectionConfig {
        id: "sqlite-memory".to_string(),
        name: "Test In-Memory SQLite".to_string(),
        db_type: DatabaseType::Sqlite,
        host: None,
        port: None,
        database: ":memory:".to_string(),
        username: None,
        password: None,
        file_path: Some(":memory:".to_string()),
        ssl: false,
    };

    let driver = SqliteDriver::connect(&config).await?;

    // Execute atomic DDL migration
    let migration_report = driver.execute_ddl(&[
        "CREATE TABLE users (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL);".to_string(),
        "CREATE TABLE posts (id INTEGER PRIMARY KEY, user_id INTEGER, title TEXT, FOREIGN KEY(user_id) REFERENCES users(id));".to_string(),
    ]).await?;

    println!("Executed {} statements in {}ms", migration_report.statements_executed, migration_report.execution_time_ms);

    // Introspect reverse-engineered catalog
    let schema = driver.introspect_schema().await?;
    println!("Introspected {} tables", schema.tables.len());

    Ok(())
}
```

### Executing Arbitrary SQL Query
```rust
let result = driver.execute_query("SELECT id, name FROM users").await?;
println!("Columns: {:?}", result.columns);
for row in result.rows {
    println!("Row: {:?}", row);
}
```

---

## 5. Output Structure & Schema

### Introspected `DatabaseSchema`
```json
{
  "database_name": "main",
  "tables": [
    {
      "name": "users",
      "schema": null,
      "columns": [
        {
          "name": "id",
          "data_type": "Integer",
          "is_primary_key": true,
          "is_nullable": false,
          "is_auto_increment": true,
          "default_value": null
        },
        {
          "name": "name",
          "data_type": "Text",
          "is_primary_key": false,
          "is_nullable": false,
          "is_auto_increment": false,
          "default_value": null
        }
      ],
      "foreign_keys": [],
      "indexes": [],
      "ui_position": null
    }
  ]
}
```

### Migration Report
```json
{
  "success": true,
  "statements_executed": 2,
  "execution_time_ms": 5,
  "error_message": null
}
```

---

## 6. Troubleshooting & Edge Cases

- **In-Memory SQLite Isolation**: SQLite in-memory databases (`:memory:`) are private to a database connection handle. `SqliteDriver::connect` restricts pool size to 1 connection when `:memory:` is used, preventing statements from executing across disparate in-memory instances.
- **Type Affinity Fallbacks**: Unrecognized SQLite types (e.g. `GEOMETRY`, `DATETIME`) fall back to `CanonicalType::Custom(String)` without halting introspection.
- **Foreign Key Column Inference**: When SQLite foreign keys omit the referenced column (referencing the parent table's primary key by default), introspection defaults `target_column` to `"id"`.
- **Atomic DDL Rollback**: If any statement within `execute_ddl` encounters a syntax error or constraint failure, the transaction is immediately aborted via `tx.rollback().await`, preventing partially applied schema corruptions.
