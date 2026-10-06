# Dialect DDL Generators Module (`src/diff/ddl`)

## 1. Overview & Purpose
The `diff::ddl` module is responsible for compiling high-level, engine-agnostic schema differences (`SchemaDiff`) into executable, dialect-accurate SQL Data Definition Language (DDL) migration scripts. It supports four major relational database engines:

- **PostgreSQL**: Standard double-quoted identifiers, `SERIAL`/`BIGSERIAL` sequence types, `CASCADE` drops, `ALTER TABLE ... ALTER COLUMN TYPE / SET NOT NULL`, and `ADD CONSTRAINT ... FOREIGN KEY`.
- **SQLite**: ANSI double quotes, storage affinity mappings (`INTEGER`, `REAL`, `TEXT`, `BLOB`), `INTEGER PRIMARY KEY AUTOINCREMENT`, and inline table-level `FOREIGN KEY` definitions.
- **MySQL / MariaDB**: Backtick identifier quoting, `AUTO_INCREMENT` modifiers, `MODIFY COLUMN` alterations, and `FOREIGN KEY` constraints.
- **Microsoft SQL Server (MSSQL)**: Square bracket quoting (`[dbo].[table]`), `IDENTITY(1,1)` identity specifications, `ALTER TABLE ... ALTER COLUMN` syntax, and T-SQL referential integrity constraints.

## 2. Prerequisites & Dependencies
- **Rust Toolchain**: Rust 1.75+ (2021 Edition)
- **Crates**:
  - `serde`: Serialization and deserialization of diffs and schemas.
  - Internal dependencies: `crate::diff::model::SchemaDiff`, `crate::model::schema::*`, `crate::model::connection::DatabaseType`.

## 3. API Reference & Interface Specification

### `pub trait DialectDdlGenerator`
Common trait implemented by each dialect generator:
```rust
pub trait DialectDdlGenerator {
    fn generate(diff: &SchemaDiff) -> Vec<String>;
}
```

### `pub fn generate_ddl(diff: &SchemaDiff, dialect: DatabaseType) -> Vec<String>`
Top-level entry point routing schema diffs to the appropriate generator:
- `@param diff`: Reference to `SchemaDiff` holding table additions/drops, column mutations, and foreign keys.
- `@param dialect`: Target engine variant (`DatabaseType::Postgres`, `Sqlite`, `MySql`, `Mssql`).
- `@return`: Vector of executable SQL statements in guaranteed execution order.

### Dialect Support Matrix

| Feature | PostgreSQL | SQLite | MySQL | MSSQL |
| :--- | :--- | :--- | :--- | :--- |
| **Identifier Quote** | `"name"` | `"name"` | `` `name` `` | `[name]` |
| **Schema Qualification** | `"schema"."table"` | `"table"` | `` `schema`.`table` `` | `[schema].[table]` |
| **Auto Increment PK** | `BIGSERIAL PRIMARY KEY` | `INTEGER PRIMARY KEY AUTOINCREMENT` | `BIGINT AUTO_INCREMENT PRIMARY KEY` | `BIGINT IDENTITY(1,1) PRIMARY KEY` |
| **Drop Table** | `DROP TABLE IF EXISTS ... CASCADE;` | `DROP TABLE IF EXISTS ...;` | `DROP TABLE IF EXISTS ...;` | `DROP TABLE IF EXISTS ...;` |
| **Add Column** | `ALTER TABLE t ADD COLUMN c TYPE;` | `ALTER TABLE t ADD COLUMN c TYPE;` | `ALTER TABLE t ADD COLUMN c TYPE;` | `ALTER TABLE t ADD c TYPE;` |
| **Drop Column** | `ALTER TABLE t DROP COLUMN IF EXISTS c CASCADE;` | `ALTER TABLE t DROP COLUMN c;` | `ALTER TABLE t DROP COLUMN c;` | `ALTER TABLE t DROP COLUMN c;` |
| **Alter Column Type** | `ALTER TABLE t ALTER COLUMN c TYPE ...;` | N/A (requires table rebuild) | `ALTER TABLE t MODIFY COLUMN ...;` | `ALTER TABLE t ALTER COLUMN c ...;` |
| **Drop Foreign Key** | `ALTER TABLE t DROP CONSTRAINT IF EXISTS fk;` | N/A | `ALTER TABLE t DROP FOREIGN KEY fk;` | `ALTER TABLE t DROP CONSTRAINT fk;` |
| **Add Foreign Key** | `ALTER TABLE t ADD CONSTRAINT fk FOREIGN KEY ...;` | Defined in `CREATE TABLE` | `ALTER TABLE t ADD CONSTRAINT fk FOREIGN KEY ...;` | `ALTER TABLE t ADD CONSTRAINT fk FOREIGN KEY ...;` |

## 4. Usage Examples

### Example: Generating PostgreSQL Migration Script
```rust
use dyno_db_modeler_lib::diff::ddl::generate_ddl;
use dyno_db_modeler_lib::diff::model::SchemaDiff;
use dyno_db_modeler_lib::model::connection::DatabaseType;
use dyno_db_modeler_lib::model::schema::{CanonicalType, ColumnSchema, TableSchema};

let mut diff = SchemaDiff::default();
diff.tables_to_create.push(TableSchema {
    name: "orders".to_string(),
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
            name: "total".to_string(),
            data_type: CanonicalType::Decimal { precision: Some(10), scale: Some(2) },
            is_primary_key: false,
            is_nullable: false,
            is_auto_increment: false,
            default_value: Some("0.00".to_string()),
        },
    ],
    foreign_keys: vec![],
    indexes: vec![],
    ui_position: None,
});

let sql_statements = generate_ddl(&diff, DatabaseType::Postgres);
for stmt in sql_statements {
    println!("{}", stmt);
}
// Outputs:
// CREATE TABLE "public"."orders" (
//   "id" BIGSERIAL PRIMARY KEY,
//   "total" DECIMAL(10, 2) NOT NULL DEFAULT 0.00
// );
```

### Example: Generating SQLite DDL with Inline Foreign Key
```rust
let sql_statements = generate_ddl(&diff, DatabaseType::Sqlite);
// Outputs:
// CREATE TABLE "orders" (
//   "id" INTEGER PRIMARY KEY AUTOINCREMENT,
//   "user_id" INTEGER NOT NULL,
//   FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE CASCADE
// );
```

## 5. Execution Order & Safety Invariants
Statements are generated in a deterministic sequence to prevent dependency violations:
1. **Drop Foreign Key Constraints**: Removes obsolete relations before dropping underlying tables or columns.
2. **Drop Tables**: Drops obsolete tables (`CASCADE` where supported).
3. **Create Tables**: Creates new tables with columns, identities, and inline constraints.
4. **Drop Columns**: Drops unneeded columns from surviving tables.
5. **Add Columns**: Adds newly introduced columns.
6. **Alter Columns**: Updates data types and nullability specifications.
7. **Add Foreign Key Constraints**: Applies referential constraints across created and surviving tables.

## 6. Troubleshooting & Edge Cases

| Scenario | Behavior / Mitigation |
| :--- | :--- |
| **SQLite Foreign Keys** | SQLite does not support `ALTER TABLE ADD CONSTRAINT`. Foreign keys are generated inline within `CREATE TABLE`. |
| **MySQL Full Column Specification** | MySQL `MODIFY COLUMN` resets nullability to `NULL` if omitted. `MySqlDdlGenerator` always emits complete column definitions including nullability and defaults. |
| **MSSQL RESTRICT Keyword** | Microsoft SQL Server rejects `ON DELETE RESTRICT` syntax. The generator maps `ReferentialAction::Restrict` to `NO ACTION`. |
| **MSSQL ADD COLUMN Syntax** | T-SQL syntax requires `ALTER TABLE t ADD [col] ...` rather than `ADD COLUMN`. The generator omits the `COLUMN` keyword for MSSQL. |
| **PostgreSQL Schema Namespaces** | Table names containing dot delimiters (e.g., `"audit"."events"`) or explicit `schema` properties are decomposed and individually quoted. |
