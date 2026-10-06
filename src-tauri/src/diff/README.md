# Schema Difference Engine (`src-tauri/src/diff`)

## 1. Overview & Purpose
The `diff` module implements the core schema comparison engine for DynoDbModeler. It performs structural comparison between a live database schema (introspected via the `driver` subsystem) and a target desired schema (edited interactively by users on the canvas/ERD modeler).

The resulting `SchemaDiff` acts as the single source of truth for:
- Migration generator algorithms to produce deterministic `ALTER`, `CREATE`, and `DROP` DDL statements across dialect targets (PostgreSQL, MySQL, SQLite, MSSQL).
- Visual UI highlights indicating added, dropped, or modified tables, columns, and foreign keys.
- Destructive change warning indicators (e.g. converting a nullable column to `NOT NULL` without default data).

### Architectural Role
- **Declarative Schema Comparison**: Evaluates the differences between two `DatabaseSchema` trees without requiring live database connections or side-effects.
- **Granular Change Decomposition**: Classifies differences into table creations, table drops, column additions, column drops, column alterations, and foreign key additions/drops.
- **Destructive Mutation Detection**: Automatically flags column modifications that risk data integrity loss (such as tightening nullability constraints).
- **Fast In-Memory Operation**: Pure Rust computational engine operating with zero runtime allocations beyond string identifiers and schema clone vectors.

---

## 2. Prerequisites & Dependencies
- **Rust Toolchain**: `rustc` and `cargo` 1.80+ (2021 edition).
- **Core Dependencies**:
  - `serde` (v1.0): Serializes and deserializes `SchemaDiff` and `ColumnAlteration` structures over Tauri IPC to the React frontend.
  - `crate::model::schema`: Relational schema domain entities (`DatabaseSchema`, `TableSchema`, `ColumnSchema`, `ForeignKeySchema`, `CanonicalType`).

---

## 3. API & Component Reference

### `SchemaDiff` Struct
Represents the complete set of structural deltas between two schemas:

| Field | Type | Description |
|---|---|---|
| `tables_to_create` | `Vec<TableSchema>` | Tables present in the desired schema but missing from the current schema. |
| `tables_to_drop` | `Vec<String>` | Table names present in the current schema but omitted from the desired schema. |
| `columns_to_add` | `Vec<(String, ColumnSchema)>` | Tuples of `(table_name, column_schema)` for newly added columns in existing tables. |
| `columns_to_drop` | `Vec<(String, String)>` | Tuples of `(table_name, column_name)` for dropped columns from existing tables. |
| `columns_to_alter` | `Vec<ColumnAlteration>` | Column alterations within existing surviving tables. |
| `foreign_keys_to_add` | `Vec<(String, ForeignKeySchema)>` | Tuples of `(table_name, foreign_key_schema)` for added or modified foreign keys. |
| `foreign_keys_to_drop` | `Vec<(String, String)>` | Tuples of `(table_name, constraint_name)` for dropped or modified foreign keys. |

#### Methods
- `pub fn is_empty(&self) -> bool`: Returns `true` if all change vectors are empty (indicating schemas are identical).

---

### `ColumnAlteration` Struct
Details a column alteration inside an existing table:

| Field | Type | Description |
|---|---|---|
| `table_name` | `String` | Name of the table owning the altered column. |
| `source_column` | `ColumnSchema` | Column definition in the current live schema. |
| `target_column` | `ColumnSchema` | Desired column definition in the target schema. |
| `is_destructive` | `bool` | `true` if alteration tightens nullability (`is_nullable: true -> false`), risking runtime migration failure if null values exist. |

---

### `compute_schema_diff` Function
```rust
pub fn compute_schema_diff(
    current: &DatabaseSchema,
    desired: &DatabaseSchema,
) -> SchemaDiff
```
- **Parameters**:
  - `current`: Reference to current introspected `DatabaseSchema`.
  - `desired`: Reference to user-edited target `DatabaseSchema`.
- **Returns**: Populated `SchemaDiff` structure.

---

## 4. Usage Examples

### Basic Diff Calculation
```rust
use dyno_db_modeler_lib::diff::compute_schema_diff;
use dyno_db_modeler_lib::model::schema::DatabaseSchema;

fn inspect_changes(live: &DatabaseSchema, target: &DatabaseSchema) {
    let diff = compute_schema_diff(live, target);

    if diff.is_empty() {
        println!("No changes detected. Schemas are in sync.");
        return;
    }

    println!("Tables to create: {}", diff.tables_to_create.len());
    println!("Tables to drop: {}", diff.tables_to_drop.len());
    println!("Columns to alter: {}", diff.columns_to_alter.len());

    for alteration in &diff.columns_to_alter {
        if alteration.is_destructive {
            eprintln!(
                "WARNING: Destructive alteration on {}.{} ({} -> {})",
                alteration.table_name,
                alteration.source_column.name,
                alteration.source_column.is_nullable,
                alteration.target_column.is_nullable
            );
        }
    }
}
```

---

## 5. Output Structure & Schema
When serialized across Tauri IPC to the frontend application, `SchemaDiff` produces structured JSON:

```json
{
  "tables_to_create": [
    {
      "name": "audit_logs",
      "schema": null,
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
      "ui_position": null
    }
  ],
  "tables_to_drop": [
    "legacy_temp_table"
  ],
  "columns_to_add": [
    ["users", {
      "name": "phone_number",
      "data_type": { "Varchar": 32 },
      "is_primary_key": false,
      "is_nullable": true,
      "is_auto_increment": false,
      "default_value": null
    }]
  ],
  "columns_to_drop": [
    ["users", "fax_number"]
  ],
  "columns_to_alter": [
    {
      "table_name": "users",
      "source_column": {
        "name": "email",
        "data_type": { "Varchar": 100 },
        "is_primary_key": false,
        "is_nullable": true,
        "is_auto_increment": false,
        "default_value": null
      },
      "target_column": {
        "name": "email",
        "data_type": { "Varchar": 255 },
        "is_primary_key": false,
        "is_nullable": false,
        "is_auto_increment": false,
        "default_value": null
      },
      "is_destructive": true
    }
  ],
  "foreign_keys_to_add": [
    ["orders", {
      "constraint_name": "fk_orders_user",
      "source_column": "user_id",
      "target_table": "users",
      "target_column": "id",
      "on_delete": "Cascade",
      "on_update": "NoAction"
    }]
  ],
  "foreign_keys_to_drop": [
    ["orders", "fk_orders_old_customer"]
  ]
}
```

---

## 6. Troubleshooting & Edge Cases

### Foreign Key Constraints on Dropped Tables
- When an entire table is dropped, individual foreign key drops targeting or originating from that table are not duplicated in `foreign_keys_to_drop`. The DDL generator will issue a `DROP TABLE ... CASCADE` or sequence table drops to respect dependency ordering.

### Column Renames vs. Drop & Add
- The diff engine matches columns by exact name. If a column is renamed from `user_nm` to `username`, it is decomposed as dropping `user_nm` and adding `username`. Advanced rename heuristics can be layered downstream by matching column ordinality and data type compatibility.

### Destructive Nullability Tightening
- Setting `is_nullable: false` on an existing column with existing `NULL` records will fail during DDL execution on relational engines unless backfilled. The frontend UI uses `is_destructive: true` to display user confirmation prompts.
