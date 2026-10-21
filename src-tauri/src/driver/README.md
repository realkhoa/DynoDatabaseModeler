# Database Driver Subsystem (`src-tauri/src/driver`)

## 1. Overview & Purpose
The `driver` subsystem implements the multi-engine native database adapter abstraction layer for DynoDbModeler. It establishes a unified, asynchronous trait interface (`DatabaseDriver`) that abstracts traditional relational databases (SQLite, PostgreSQL, MySQL, MariaDB, Microsoft SQL Server), analytical columnar engines (DuckDB, ClickHouse), distributed NewSQL engines (CockroachDB, TiDB), key-value stores (Redis), document databases (MongoDB), wide-column stores (Cassandra, ScyllaDB), and multi-model databases (SurrealDB) behind common primitives for:
- Connection establishment and health verification (`test_connection`).
- Metadata catalog introspection into canonical domain models (`introspect_schema`).
- Native query execution returning tabular serialized JSON values (`execute_query`).
- Atomic transactional DDL migration batch execution (`execute_ddl`).
- Atomic transactional row mutation batches targeted by primary keys (`update_rows`).
- Dialect identification (`db_type`).

A centralized factory (`DriverFactory`) dynamically selects and initializes the appropriate driver adapter based on the user's `ConnectionConfig.db_type` or parses universal connection URLs.

### Architectural Role
- **Unified Adapter Contract**: Standardizes database interactions across 16+ native database engines via the `DatabaseDriver` trait.
- **Dynamic Factory Dispatch**: `DriverFactory::create(&ConnectionConfig)` evaluates engine dialect and initializes dedicated connection pools, native TCP frames, or HTTP JSON streams.
- **Deep Catalog Introspection**: Reverse-engineers native catalogs, system tables, keyspaces, and namespaces into canonical `DatabaseSchema` models containing tables/collections, columns/fields, primary keys, foreign keys, and indexes.
- **Fail-Safe Transactional Migrations**: Applies DDL scripts atomically within isolated transactions (`BEGIN ... COMMIT` or engine equivalents), aborting on the first failing statement.
- **Robust Type Normalization**: Provides dialect-specific type parsers to map vendor-specific types to the unified `CanonicalType` enum.

---

## 2. Prerequisites & Dependencies
- **Rust Toolchain**: `rustc` and `cargo` 1.80+ (2021 edition).
- **Core Dependencies**:
  - `async-trait` (v0.1): Dynamic asynchronous trait dispatch.
  - `sqlx` (v0.8): Async driver pool supporting `sqlite`, `postgres`, and `mysql` runtimes with `chrono` and `uuid`.
  - `tiberius` (v0.12): Async TDS protocol driver for Microsoft SQL Server.
  - `duckdb` (v1.1): Embedded analytical column-oriented database driver (bundled).
  - `tokio` (v1.0): Asynchronous runtime and synchronization primitives (`Mutex`, `RwLock`).
  - `tokio-util` (v0.7): `TokioAsyncWriteCompatExt` adapter bridging Tokio TCP streams.
  - `serde` (v1.0) & `serde_json` (v1.0): Serialization of tabular results and migration reports.
  - `reqwest` (v0.12): HTTP client for ClickHouse HTTP JSONCompact and SurrealDB `/sql` endpoints.
  - `url` (v2.5): URL parsing for connection strings and protocol routing.

---

## 3. Supported Native Engines

| Engine | Protocol / Transport | Default Port | Dialect Family | Primary Use Case |
| :--- | :--- | :--- | :--- | :--- |
| **SQLite** | Embedded C FFI / `sqlx` | N/A (file/memory) | Relational / SQLite | Local files, embedded testing |
| **PostgreSQL** | Native PostgreSQL wire (`sqlx`) | 5432 | Relational / Postgres | Enterprise OLTP, JSONB |
| **MySQL** | Native MySQL wire (`sqlx`) | 3306 | Relational / MySQL | General web applications |
| **MariaDB** | Native MySQL/MariaDB wire (`sqlx`) | 3306 | Relational / MySQL | Open-source MySQL fork |
| **MSSQL** | TDS 7.3+ over TCP (`tiberius`) | 1433 | Relational / T-SQL | Microsoft enterprise workloads |
| **DuckDB** | Embedded C FFI (`duckdb`) | N/A (file/memory) | Analytical / DuckDB | Embedded columnar analytics |
| **ClickHouse** | Native HTTP 1.1 JSONCompact | 8123 | Analytical / ClickHouse | Real-time big data analytics |
| **MongoDB** | OP_MSG (2013) Pure Rust wire | 27017 | Document / Mongo | Document storage, semi-structured |
| **Cassandra** | CQL v4 binary frame over TCP | 9042 | Wide-Column / CQL | High-throughput distributed write |
| **ScyllaDB** | CQL v4 binary frame over TCP | 9042 | Wide-Column / CQL | Ultra low-latency C++ Cassandra |
| **SurrealDB** | SurrealQL HTTP REST API | 8000 | Multi-Model / SurrealQL | Graph, Document, Relational |
| **CockroachDB**| PostgreSQL v3 wire (`sqlx`) | 26257 | Distributed NewSQL | Horizontally scalable ACID SQL |
| **TiDB** | MySQL wire protocol (`sqlx`) | 4000 | Distributed NewSQL | Hybrid HTAP (TiKV + TiFlash) |
| **Redis** | RESP2 / RESP3 binary protocol | 6379 | In-Memory Key-Value | High-speed cache, key-value |
| **Universal** | Automatic URL protocol router | Any | Auto-detected | Single URL connection strings |

---

## 4. Driver Architecture & Component Reference

```
                             +------------------------+
                             |    ConnectionConfig    |
                             +------------------------+
                                          |
                                          v
                             +------------------------+
                             |     DriverFactory      |
                             +------------------------+
                                          |
         +-------------+-------------+----+----+-------------+-------------+
         |             |             |         |             |             |
         v             v             v         v             v             v
    +----------+  +----------+  +---------+ +---------+  +---------+  +----------+
    | Sqlite   |  | Postgres |  | MySql   | | Mssql   |  | DuckDB  |  | Redis    |
    +----------+  +----------+  +---------+ +---------+  +---------+  +----------+
    | Click-   |  | MongoDB  |  | Cass-   | | Scylla  |  | Surreal |  | Cockroach|
    | House    |  | (OP_MSG) |  | andra   | | DB      |  | DB      |  | / TiDB   |
    +----------+  +----------+  +---------+ +---------+  +---------+  +----------+
                                          \
                                           v
                             +------------------------+
                             |   dyn DatabaseDriver   |
                             +------------------------+
```

### Common Trait: `DatabaseDriver`
Implemented by all 16 engine driver adapters.

| Method | Signature | Description |
| :--- | :--- | :--- |
| `test_connection` | `async fn test_connection(&self) -> Result<(), AppError>` | Verifies server credentials and socket responsiveness. |
| `introspect_schema` | `async fn introspect_schema(&self) -> Result<DatabaseSchema, AppError>` | Extracts tables, views, keys, collections, and attributes. |
| `execute_query` | `async fn execute_query(&self, sql: &str) -> Result<QueryResult, AppError>` | Runs arbitrary engine queries and returns tabular JSON values. |
| `execute_ddl` | `async fn execute_ddl(&self, statements: &[String]) -> Result<MigrationReport, AppError>` | Sequentially applies DDL statements inside an atomic batch. |
| `update_rows` | `async fn update_rows(&self, updates: Vec<RowUpdatePayload>) -> Result<u64, AppError>` | Transactionally applies targeted row mutations by primary key. |
| `db_type` | `fn db_type(&self) -> DatabaseType` | Returns the database engine dialect identifier. |

---

## 5. Engine Implementation Details

### 1. ClickHouse (`ClickHouseDriver`)
- **Transport**: Native HTTP 1.1 JSONCompact (`http://{host}:{port}/?database={db}&default_format=JSONCompact`).
- **Authentication**: `X-ClickHouse-User` and `X-ClickHouse-Key` request headers.
- **Introspection**: Queries `system.tables` and `system.columns` for columnar schema and sorting/partition keys.
- **Type Mapper**: Normalizes ClickHouse types (e.g. `UInt64`, `Float64`, `DateTime64`, `LowCardinality(String)`, `Array(T)`) to canonical types.

### 2. MongoDB (`MongoDbDriver`)
- **Transport**: Pure Rust TCP socket implementing the MongoDB wire protocol (`OP_MSG`, opcode 2013).
- **Introspection**: Executes `listCollections` and runs document sampling to infer collections, fields, and types.
- **Querying**: Supports raw JSON command payloads (`{ "find": "users" }`) and pseudo-SQL translation.
- **Type Mapper**: Maps BSON types (`Double`, `String`, `Document`, `Array`, `Binary`, `ObjectId`, `Boolean`, `DateTime`, `Int32`, `Int64`) to `CanonicalType`.

### 3. Cassandra & ScyllaDB (`CassandraDriver`)
- **Transport**: Native CQL v4 binary frame protocol over TCP port 9042 with `STARTUP` and `QUERY` frame headers.
- **Introspection**: Queries `system_schema.tables` and `system_schema.columns` to extract column metadata, mapping partition and clustering keys to primary keys.
- **Type Mapper**: Maps CQL native types (`int`, `bigint`, `text`, `varchar`, `uuid`, `timeuuid`, `timestamp`, `blob`, `frozen<set<T>>`) to canonical types.

### 4. SurrealDB (`SurrealDbDriver`)
- **Transport**: SurrealDB HTTP REST API (`/sql` endpoint) with basic authentication (`NS` and `DB` headers).
- **Introspection**: Executes `INFO FOR DB;` and `INFO FOR NS;` to extract table schemas and field definitions.
- **Querying**: Runs arbitrary SurrealQL statements and transforms JSON responses into tabular result grids.

### 5. CockroachDB & TiDB
- **CockroachDB**: Built on high-performance PostgreSQL v3 wire protocol with distributed consensus optimizations.
- **TiDB**: Built on MySQL wire protocol with support for hybrid OLTP/OLAP execution (TiKV and TiFlash engines).

---

## 6. Usage Examples

### Instantiating Drivers via Factory
```rust
use dyno_db_modeler_lib::driver::factory::DriverFactory;
use dyno_db_modeler_lib::model::connection::{ConnectionConfig, DatabaseType};

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    // 1. ClickHouse Analytical Connection
    let ch_config = ConnectionConfig {
        id: "ch-local".to_string(),
        name: "Analytics ClickHouse".to_string(),
        db_type: DatabaseType::ClickHouse,
        host: Some("127.0.0.1".to_string()),
        port: Some(8123),
        database: "default".to_string(),
        username: Some("default".to_string()),
        password: Some("".to_string()),
        file_path: None,
        ssl: false,
        ssh_tunnel: None,
        connection_url: None,
    };
    let ch_driver = DriverFactory::create(&ch_config).await?;
    ch_driver.test_connection().await?;

    // 2. Introspect Schema
    let schema = ch_driver.introspect_schema().await?;
    println!("Discovered {} tables in ClickHouse", schema.tables.len());

    // 3. Execute Tabular Query
    let result = ch_driver.execute_query("SELECT 1 AS num, 'ok' AS status").await?;
    println!("Columns: {:?}", result.columns);
    println!("Rows: {:?}", result.rows);

    Ok(())
}
```

---

## 7. Troubleshooting & Edge Cases
- **NoSQL & Document Modeling**: MongoDB and SurrealDB schemas are inferred through document sampling and schema catalogs. Missing fields in sampled documents default to nullable JSON columns.
- **Cassandra Keyspaces**: In Cassandra and ScyllaDB, the `database` config field represents the target `keyspace`. If left empty, `system_schema` is queried across all user keyspaces.
- **SurrealDB Namespace vs Database**: For SurrealDB, use `database` in the format `namespace/database` or provide the database name with default namespace `test`.
- **ClickHouse Compression & Formats**: ClickHouse queries executed via `execute_query` automatically append `FORMAT JSONCompact` to guarantee parseable tabular matrix responses.
