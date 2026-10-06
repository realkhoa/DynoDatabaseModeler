# Core Domain Models (`src-tauri/src/model`)

## 1. Overview & Purpose
The `model` module defines the canonical domain models and data transfer contracts for DynoDbModeler's Rust backend. It acts as the universal schema abstraction layer that decouples database engine dialect specifics (SQLite, PostgreSQL, MySQL, MSSQL) from frontend ERD visualization, diagram persistence, and schema migration computation.

### Architectural Role
- **Universal Schema Abstraction**: Provides `DatabaseSchema`, `TableSchema`, `ColumnSchema`, `CanonicalType`, `ForeignKeySchema`, and `IndexSchema` to represent any relational catalog uniformly.
- **Visual Persistence**: Stores diagram coordinates via `Point` directly within `TableSchema` to enable seamless visual state persistence across app restarts.
- **Connection Configuration**: Encapsulates database connection profiles via `ConnectionConfig` and `DatabaseType` for secure driver initialization.
- **IPC Transport**: All models implement `serde::Serialize` and `serde::Deserialize` for bidirectional communication over Tauri IPC channels with the React frontend.

---

## 2. Prerequisites & Dependencies
- **Rust Toolchain**: `rustc` and `cargo` 1.77+ (2021 edition).
- **Crates**:
  - `serde` (v1.0 with `derive` feature): Serialization and deserialization.
  - `serde_json` (v1.0): JSON formatting and roundtrip testing.
  - `thiserror` (v2.0): Ergonomic error derivation in accompanying `error` module.

---

## 3. API & Data Structures Reference

| Symbol | Type | Description |
| :--- | :--- | :--- |
| `CanonicalType` | `enum` | Unified column types (`SmallInt`, `Integer`, `BigInt`, `Decimal`, `Float`, `Double`, `Boolean`, `Char`, `Varchar`, `Text`, `Date`, `Time`, `Timestamp`, `Json`, `Uuid`, `Binary`, `Custom`). |
| `ReferentialAction` | `enum` | Foreign key constraint actions (`NoAction`, `Restrict`, `Cascade`, `SetNull`, `SetDefault`). |
| `ForeignKeySchema` | `struct` | Source-to-target relationship definition with delete/update action rules. |
| `ColumnSchema` | `struct` | Column metadata: name, canonical type, PK status, nullability, auto-increment, and default value. |
| `IndexSchema` | `struct` | Table secondary index metadata with column list and uniqueness indicator. |
| `Point` | `struct` | 2D canvas coordinates (`x: f64`, `y: f64`) for diagram node positioning. |
| `TableSchema` | `struct` | Table entity container with columns, foreign keys, indexes, and optional UI position. |
| `DatabaseSchema` | `struct` | Top-level catalog container containing the database name and table collection. |
| `DatabaseType` | `enum` | Supported database engines (`Sqlite`, `Postgres`, `MySql`, `Mssql`). |
| `ConnectionConfig` | `struct` | Connection parameters including host, port, credentials, SQLite file path, and SSL. |

---

## 4. Usage Examples

### Defining and Serializing a Database Schema
```rust
use dyno_db_modeler_lib::model::schema::*;

let schema = DatabaseSchema {
    database_name: "ecommerce_db".to_string(),
    tables: vec![
        TableSchema {
            name: "customers".to_string(),
            schema: Some("public".to_string()),
            columns: vec![
                ColumnSchema {
                    name: "id".to_string(),
                    data_type: CanonicalType::BigInt,
                    is_primary_key: true,
                    is_nullable: false,
                    is_auto_increment: true,
                    default_value: None,
                },
                ColumnSchema {
                    name: "email".to_string(),
                    data_type: CanonicalType::Varchar(Some(255)),
                    is_primary_key: false,
                    is_nullable: false,
                    is_auto_increment: false,
                    default_value: None,
                },
            ],
            foreign_keys: vec![],
            indexes: vec![
                IndexSchema {
                    name: "idx_customers_email".to_string(),
                    columns: vec!["email".to_string()],
                    is_unique: true,
                },
            ],
            ui_position: Some(Point { x: 250.0, y: 180.0 }),
        },
    ],
};

let json_output = serde_json::to_string_pretty(&schema).expect("Failed to serialize schema");
println!("{}", json_output);
```

### Specifying a Connection Profile
```rust
use dyno_db_modeler_lib::model::connection::*;

let profile = ConnectionConfig {
    id: "conn-prod-pg".to_string(),
    name: "Production Postgres".to_string(),
    db_type: DatabaseType::Postgres,
    host: Some("db.internal.net".to_string()),
    port: Some(5432),
    database: "analytics".to_string(),
    username: Some("app_reader".to_string()),
    password: Some("s3cret".to_string()),
    file_path: None,
    ssl: true,
};
```

---

## 5. Output Structure & Schema
When serialized across Tauri IPC as JSON, domain objects adhere to the following schema structure:

```json
{
  "database_name": "ecommerce_db",
  "tables": [
    {
      "name": "customers",
      "schema": "public",
      "columns": [
        {
          "name": "id",
          "data_type": "BigInt",
          "is_primary_key": true,
          "is_nullable": false,
          "is_auto_increment": true,
          "default_value": null
        }
      ],
      "foreign_keys": [],
      "indexes": [],
      "ui_position": { "x": 250.0, "y": 180.0 }
    }
  ]
}
```

---

## 6. Troubleshooting & Edge Cases
- **Unmapped Dialect Types**: When an engine-specific type cannot be mapped to standard canonical variants (e.g. PostgreSQL `tsvector`, PostGIS `geometry`), driver adapters map to `CanonicalType::Custom(String)` to prevent introspection failure.
- **Missing UI Coordinates**: New tables or reverse-engineered schemas without previous visual layout have `ui_position: None`. The frontend layout engine automatically applies Force-Directed DAG placement before persisting coordinates back.
- **Float Coordinate Precision**: Diagram `Point` values use 64-bit IEEE-754 floats (`f64`). When comparing equality in tests, beware of direct float comparisons with precision drift.
