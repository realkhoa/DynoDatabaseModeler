# DynoDbModeler Backend Core (`src-tauri`)

## 1. Overview & Purpose
The `src-tauri` crate serves as the core Rust desktop backend runtime for **DynoDbModeler**, a modern minimalist SQL management and ERD database modeler.

It connects the Tauri 2 frontend application (Svelte/TypeScript) to four major relational database engines (**PostgreSQL**, **SQLite**, **MySQL / MariaDB**, and **Microsoft SQL Server**) through thread-safe asynchronous IPC (Inter-Process Communication) command handlers and a global connection state manager (`AppState`).

### Architecture Overview
```text
┌────────────────────────────────────────────────────────┐
│            Frontend (Svelte 5 / TypeScript)            │
└───────────────────────────┬────────────────────────────┘
                            │ Tauri IPC (invoke)
┌───────────────────────────▼────────────────────────────┐
│                  src-tauri/src/commands.rs             │
│   (cmd_test_connection, cmd_connect, cmd_diff, etc.)   │
└─────────────┬────────────────────────────┬─────────────┘
              │ Delegates                  │ Uses
┌─────────────▼─────────────┐   ┌──────────▼─────────────┐
│    src-tauri/src/state.rs │   │  src-tauri/src/diff/   │
│  AppState (Arc<RwLock>)   │   │  Diff & DDL Generator  │
└─────────────┬─────────────┘   └────────────────────────┘
              │ Owns active
┌─────────────▼──────────────────────────────────────────┐
│              src-tauri/src/driver/factory.rs           │
│  (SqliteDriver, PostgresDriver, MySqlDriver, Mssql)    │
└────────────────────────────────────────────────────────┘
```

---

## 2. Prerequisites & Dependencies
- **Rust Toolchain**: Rust 1.75+ (Edition 2021)
- **Tauri Runtime**: Tauri 2 (`tauri = "2"`, `tauri-plugin-opener = "2"`)
- **Asynchronous Engine**: Tokio (`features = ["full"]`), `async-trait = "0.1"`
- **Database Clients**:
  - `sqlx = "0.8"` (PostgreSQL, SQLite, MySQL drivers, Chrono & UUID integration)
  - `tiberius = "0.12"` & `tokio-util = "0.7"` (MSSQL TDS protocol client)
- **Serialization**: `serde = "1"`, `serde_json = "1"`, `thiserror = "2"`

---

## 3. Tauri IPC Command Reference

Every backend command returns a `Result<T, AppError>` serialized to the frontend.

| IPC Command | Arguments | Return Type | Description |
| :--- | :--- | :--- | :--- |
| `cmd_test_connection` | `config: ConnectionConfig` | `bool` | Tests connectivity and credentials without mutating active application state. |
| `cmd_connect` | `config: ConnectionConfig` | `bool` | Instantiates driver via `DriverFactory` and persists connection inside `AppState`. |
| `cmd_introspect_schema` | _None_ | `DatabaseSchema` | Extracts tables, columns, indexes, and foreign keys from the active database. |
| `cmd_compute_diff` | `current: DatabaseSchema`, `desired: DatabaseSchema` | `SchemaDiff` | Computes added/dropped tables, modified columns, and altered foreign keys. |
| `cmd_generate_ddl` | `diff: SchemaDiff` | `Vec<String>` | Compiles `SchemaDiff` into dialect-accurate DDL statements matching active database engine. |
| `cmd_execute_migration` | `statements: Vec<String>` | `MigrationReport` | Executes ordered DDL statements within a database transaction. |
| `cmd_execute_query` | `sql: String` | `QueryResult` | Runs an arbitrary SQL query and returns column headers and tabular rows. |

### `AppError` Serialization
Errors are serialized as structured JSON objects:
```json
{
  "Connection": "No active database connection"
}
```
Variants:
- `Connection(String)`: Handshake, network timeout, or missing active session.
- `Database(String)`: SQL execution failure or syntax violation.
- `Introspection(String)`: Metadata catalog querying error.
- `Migration(String)`: DDL execution failure or rollback.
- `Config(String)`: Invalid connection parameters.
- `Internal(String)`: Unhandled runtime errors.

---

## 4. Usage Examples

### Frontend Invocation (TypeScript)
```typescript
import { invoke } from "@tauri-apps/api/core";

// 1. Test database connection
const isReachable = await invoke<boolean>("cmd_test_connection", {
  config: {
    id: "conn-1",
    name: "Production PostgreSQL",
    db_type: "Postgres",
    host: "10.0.0.1",
    port: 5432,
    database: "analytics",
    username: "postgres",
    password: "secretpassword",
    file_path: null,
    ssl: false
  }
});

// 2. Connect and persist in AppState
await invoke<boolean>("cmd_connect", { config });

// 3. Introspect active schema
const schema = await invoke<DatabaseSchema>("cmd_introspect_schema");

// 4. Generate DDL migration for active dialect
const statements = await invoke<string[]>("cmd_generate_ddl", { diff });

// 5. Apply migration
const report = await invoke<MigrationReport>("cmd_execute_migration", { statements });

// 6. Query data
const result = await invoke<QueryResult>("cmd_execute_query", {
  sql: "SELECT id, name FROM users LIMIT 10;"
});
```

### Backend Direct Invocation (Rust Unit / Integration Tests)
```rust
use dyno_db_modeler_lib::state::AppState;
use dyno_db_modeler_lib::model::connection::{ConnectionConfig, DatabaseType};

let state = AppState::default();
let config = ConnectionConfig {
    id: "test-sqlite".to_string(),
    name: "In-Memory".to_string(),
    db_type: DatabaseType::Sqlite,
    host: None,
    port: None,
    database: ":memory:".to_string(),
    username: None,
    password: None,
    file_path: Some(":memory:".to_string()),
    ssl: false,
};

state.connect(&config).await.expect("Failed to connect");
let schema = state.introspect_active().await.expect("Failed introspection");
```

---

## 5. State & Schema Data Structures

### `AppState` (`src-tauri/src/state.rs`)
- `active_driver`: `Arc<RwLock<Option<Box<dyn DatabaseDriver>>>>` - Thread-safe reference to the current driver.
- `active_config`: `Arc<RwLock<Option<ConnectionConfig>>>` - Thread-safe reference to active parameters.

### `QueryResult` (`src-tauri/src/driver/mod.rs`)
- `columns`: `Vec<String>` - Ordered column names.
- `rows`: `Vec<Vec<serde_json::Value>>` - Grid of cell values.
- `rows_affected`: `u64` - Affected or returned row count.
- `execution_time_ms`: `u64` - Query duration.

### `MigrationReport` (`src-tauri/src/driver/mod.rs`)
- `success`: `bool` - Transaction commit indicator.
- `statements_executed`: `usize` - Count of executed statements.
- `execution_time_ms`: `u64` - Migration execution duration.
- `error_message`: `Option<String>` - Error details on failure.

---

## 6. Troubleshooting & Edge Cases

1. **MySQL Error 1068 (Multiple primary key defined)**:
   - When altering existing columns using `ALTER TABLE ... MODIFY COLUMN`, MySQL raises error 1068 if the column definition includes `PRIMARY KEY`.
   - The DDL generator specifically uses `modify_column_def()`, omitting `PRIMARY KEY` to safely mutate column types and nullability without altering existing primary keys.

2. **Fully-Qualified Table Schemas for Foreign Keys (PostgreSQL & MSSQL)**:
   - Tables belonging to schemas (e.g., `public`, `sales`, `dbo`) must have fully-qualified identifiers during foreign key creation:
     - PostgreSQL: `ALTER TABLE "sales"."orders" ADD CONSTRAINT ...`
     - MSSQL: `ALTER TABLE [sales].[orders] ADD CONSTRAINT ...`
   - Both generators ensure `{schema}.{table_name}` is preserved and properly quoted.

3. **No Active Connection**:
   - Calling `cmd_introspect_schema`, `cmd_generate_ddl`, `cmd_execute_migration`, or `cmd_execute_query` when disconnected yields `AppError::Connection("No active database connection")`.
   - The frontend should check connection state or invoke `cmd_connect` before initiating operations.
