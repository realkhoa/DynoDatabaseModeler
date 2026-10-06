# DynoDbModeler - System Architecture & Design Specification

## 1. Executive Summary

**DynoDbModeler** is a cross-platform desktop database management and modeling application built with **Tauri v2**, **Rust**, and **React 19**. It provides a minimalist, sleek dark UI, combined with visual Entity-Relationship Diagram (ERD) exploration, schema reverse-engineering, visual schema design, and bidirectional forward-engineering (safe schema diff and SQL DDL synchronization).

---

## 2. Goals and Scope

### 2.1 In Scope (MVP)
1. **Multi-Database Connection Manager**:
   - Connection configuration storage (local JSON / SQLite in AppData).
   - Extensible Driver Adapter Architecture (`DatabaseDriver` trait).
   - Native support for SQLite, PostgreSQL, MySQL/MariaDB, and MS SQL Server.
   - Extensible abstraction for future additions (ODBC, Oracle, DuckDB).
2. **Reverse Engineering (SQL -> ERD)**:
   - Querying system catalogs / `information_schema` / SQLite `PRAGMA`.
   - Normalizing database schema into an engine-agnostic intermediate `DatabaseSchema` model.
   - Interactive ERD canvas powered by `@xyflow/react` with custom Table Entity nodes, column types, primary key (PK) / foreign key (FK) badges, and relationship edges.
   - Dagre auto-layout for automatic diagram positioning and routing.
3. **Visual Schema Editing**:
   - Creating tables and modifying columns, types, nullability, defaults, primary keys, and foreign keys directly via canvas and slide-out inspector panels.
4. **Forward Engineering & Safe Sync (ERD -> SQL Migration)**:
   - Rust-based Schema Diff Engine comparing current live schema against desired ERD schema.
   - Dialect-specific DDL generator producing precise `ALTER TABLE`, `CREATE TABLE`, `DROP`, and constraint migration statements.
   - Interactive Visual Diff Review modal with side-by-side change tree, risk warnings (e.g. data loss on drop column), and editable SQL script preview (Monaco Editor).
   - Transactional execution of migration DDL on the active database connection.
5. **Basic SQL Query Editor**:
   - Monaco Editor tab for running exploratory queries with tabular data display.
6. **ERD Export**:
   - Exporting the active diagram as PNG, SVG, or JSON schema definition.

### 2.2 Out of Scope (Post-MVP)
- Full-scale spreadsheet-style inline cell editing across millions of rows (Data Grid is limited to query results in MVP).
- Cloud team collaboration / remote model sharing.
- Stored procedure / trigger graphical visualizers.

---

## 3. Technology Stack

| Layer | Technology | Justification |
|---|---|---|
| Desktop Framework | Tauri v2 (Rust 1.80+) | Lightweight, minimal RAM footprint, native OS integration, fast startup |
| Async Runtime | Tokio | Industry standard for asynchronous I/O and database connection pools |
| Database Drivers | `sqlx` (Postgres, MySQL, SQLite), `tiberius` (MSSQL) | Native Rust async drivers with high performance, pure memory safety, and zero external runtime dependencies |
| Frontend Framework | React 19 + TypeScript + Vite | Type-safe, reactive UI development with rich component ecosystem |
| Styling & Design System | Tailwind CSS v4 + Lucide Icons | Modern minimalist dark theme (#1e1f22, #18191c, sleek borders) |
| ERD Canvas Engine | `@xyflow/react` (React Flow) + Dagre | Mature node-graph engine supporting custom handles per column, smooth pan/zoom, and automated graph layout |
| Code & SQL Editor | Monaco Editor (`@monaco-editor/react`) | Industry-standard code editor for SQL query execution and DDL diff review |

---

## 4. Architecture & Component Decomposition

```
┌────────────────────────────────────────────────────────────────────────┐
│                        Tauri Frontend (React 19)                       │
│                                                                        │
│  ┌──────────────────┐  ┌────────────────────┐  ┌───────────────────┐   │
│  │ Connection Bar & │  │  ERD Canvas Model  │  │ Visual Diff Modal │   │
│  │ Table Navigation │  │   (@xyflow/react)  │  │ & Monaco Preview  │   │
│  └─────────┬────────┘  └─────────┬──────────┘  └─────────┬─────────┘   │
└────────────┼─────────────────────┼───────────────────────┼─────────────┘
             │                     │                       │
             ▼                     ▼                       ▼
      [Tauri IPC Command Layer: serde_json serialization over IPC]
             │                     │                       │
┌────────────┼─────────────────────┼───────────────────────┼─────────────┐
│            ▼                     ▼                       ▼             │
│  ┌──────────────────┐  ┌────────────────────┐  ┌───────────────────┐   │
│  │Connection Manager│  │ Schema Introspect  │  │ Schema Diff Engine│   │
│  │  & Pool Registry │  │   & Normalizer     │  │ & DDL Generators  │   │
│  └─────────┬────────┘  └─────────┬──────────┘  └─────────┬─────────┘   │
│            │                     │                       │             │
│            └─────────────────────┼───────────────────────┘             │
│                                  ▼                                     │
│                     DatabaseDriver Trait (Rust)                        │
│            ┌─────────────┬─────────────┬─────────────┐                 │
│            │   Postgres  │    MySQL    │   SQLite    │   MSSQL...    │
│            └─────────────┴─────────────┴─────────────┘                 │
│                        Tauri Backend Core                              │
└────────────────────────────────────────────────────────────────────────┘
```

### 4.1 Backend Architecture

#### 4.1.1 Normalized Schema Model (`src-tauri/src/model/schema.rs`)
An engine-agnostic representation of a relational schema:
- `DatabaseSchema`:
  - `database_name: String`
  - `tables: Vec<TableSchema>`
- `TableSchema`:
  - `name: String`
  - `schema: Option<String>`
  - `columns: Vec<ColumnSchema>`
  - `foreign_keys: Vec<ForeignKeySchema>`
  - `indexes: Vec<IndexSchema>`
  - `ui_position: Option<Point>` (for preserving canvas coordinates)
- `ColumnSchema`:
  - `name: String`
  - `data_type: CanonicalType` (Int, BigInt, Varchar(Option<u32>), Text, Boolean, Timestamp, Decimal, Uuid, Json, Custom(String))
  - `is_primary_key: bool`
  - `is_nullable: bool`
  - `is_auto_increment: bool`
  - `default_value: Option<String>`
- `ForeignKeySchema`:
  - `constraint_name: String`
  - `source_column: String`
  - `target_table: String`
  - `target_column: String`
  - `on_delete: ReferentialAction` (Cascade, SetNull, Restrict, NoAction)
  - `on_update: ReferentialAction`
- `IndexSchema`:
  - `name: String`
  - `columns: Vec<String>`
  - `is_unique: bool`

#### 4.1.2 Database Driver Trait (`src-tauri/src/driver/mod.rs`)
```rust
#[async_trait]
pub trait DatabaseDriver: Send + Sync {
    async fn test_connection(&self) -> Result<(), AppError>;
    async fn introspect_schema(&self) -> Result<DatabaseSchema, AppError>;
    async fn execute_query(&self, sql: &str) -> Result<QueryResult, AppError>;
    async fn execute_ddl(&self, statements: &[String]) -> Result<MigrationReport, AppError>;
    fn dialect(&self) -> SqlDialect;
}
```

Implementations:
- `PostgresDriver`: Queries `information_schema.tables`, `columns`, `table_constraints`, `key_column_usage`, `constraint_column_usage`, `pg_indexes`.
- `MySqlDriver`: Queries `information_schema.TABLES`, `COLUMNS`, `KEY_COLUMN_USAGE`, `STATISTICS`.
- `SqliteDriver`: Queries `sqlite_master`, `PRAGMA table_info`, `PRAGMA foreign_key_list`, `PRAGMA index_list`.
- `MssqlDriver`: Queries SQL Server system catalogs (`sys.tables`, `sys.columns`, `sys.foreign_keys`, `sys.indexes`).

#### 4.1.3 Schema Diff Engine & DDL Generators (`src-tauri/src/diff/`)
Calculates structural differences between `current_schema` and `desired_schema`:
- `SchemaDiff`:
  - `tables_to_create: Vec<TableSchema>`
  - `tables_to_drop: Vec<String>`
  - `columns_to_add: Vec<(String, ColumnSchema)>`
  - `columns_to_drop: Vec<(String, String)>`
  - `columns_to_alter: Vec<(String, ColumnAlteration)>`
  - `foreign_keys_to_add: Vec<(String, ForeignKeySchema)>`
  - `foreign_keys_to_drop: Vec<(String, String)>`

Each dialect implements `DialectDdlGenerator`:
- `PostgreSqlDdlGenerator`: Generates standard PostgreSQL DDL (`ALTER TABLE ... ADD COLUMN`, `ALTER TABLE ... ALTER COLUMN TYPE`).
- `MySqlDdlGenerator`: Generates MySQL DDL with backtick quotes and MySQL constraint syntax.
- `SqliteDdlGenerator`: Handles SQLite schema migration. For operations not natively supported in standard SQLite `ALTER TABLE` (e.g. drop column in older engines or altering column types), it generates the table reconstruction pattern with data copy within a transactional wrapper.
- `MssqlDdlGenerator`: Generates T-SQL migration scripts (`ALTER TABLE [table] ADD [col] ...`).

---

## 5. User Interface & Minimalist Dark Theme Specifications

### 5.1 Color Palette & Theme Tokens
- Background Base: `#1e1f22` (Minimalist dark canvas)
- Sidebar Background: `#18191c`
- Header / Toolbar Background: `#26282d`
- Active Tab / Selected Item: `#2f3238`
- Border Stroke: `#35373c`
- Text Primary: `#e6e8ea`
- Text Secondary / Muted: `#8c919a`
- Accent Primary (Selection / Blue): `#3a82f7`
- Accent Key (Primary Key Gold): `#f5a623`
- Accent Foreign Key (Cyan): `#20c997`
- Destructive Warning (Drop / Delete): `#e05252`

### 5.2 ERD Canvas Structure (`@xyflow/react`)
- **Table Node Component**:
  - Compact rounded container with dark surface and subtle border.
  - Header: Table icon, table name, column count badge.
  - Body: List of columns with:
    - Primary Key indicator (golden key icon).
    - Foreign Key indicator (cyan link icon).
    - Column name (bold for PK, regular for standard columns).
    - Data type badge (e.g., `INT`, `VARCHAR(255)`, `UUID`).
    - Constraint flags (`NN` for NOT NULL, `UQ` for UNIQUE).
  - Handles: Left and Right handles positioned on each column row to anchor relationship curves.
- **Edges**:
  - Smooth step or bezier curves connecting foreign key source handles to primary key target handles.
  - Cardinality indicators (1 to N, 1 to 1).
- **Control Bar**:
  - Zoom in / Zoom out / Zoom to Fit buttons.
  - Auto Layout button (runs Dagre graph layout algorithm).
  - Add Table button.
  - Review & Sync button with active change counter badge.
  - Export button (PNG / SVG / JSON).

### 5.3 Interactive Diff & Migration Modal
- Side-by-side view:
  - Left: Tree of identified changes (e.g. `+ Table: orders`, `+ Column: orders.customer_id`, `- Column: users.legacy_token [DESTRUCTIVE]`).
  - Right: Monaco Editor showing the generated migration script with full SQL syntax highlighting, line numbers, and inline editing capability.
- Action controls:
  - Cancel / Close.
  - Copy Script to Clipboard.
  - "Execute Migration" button with confirmation prompt when destructive changes are detected.

---

## 6. Safety, Error Handling & Transactions

1. **Transactional Execution**:
   - All generated DDL statements execute within an explicit database transaction (`BEGIN ... COMMIT`) where supported by the target engine.
   - If any DDL statement fails, a full `ROLLBACK` is triggered and a detailed error diagnostics report is returned to the user.
2. **Destructive Operation Safeguards**:
   - Any `DROP TABLE` or `DROP COLUMN` operation is flagged with a high-priority warning badge in the Diff Review modal.
   - The user must explicitly acknowledge destructive changes before execution is enabled.
3. **Connection Credential Security**:
   - Connection strings and passwords are never logged or exposed in client telemetry.
   - Passwords can be stored securely in local OS storage / encrypted app preferences.

---

## 7. Testing Strategy

1. **Rust Unit Tests**:
   - Test Schema Diff Engine with unit test cases for table addition, column alterations, foreign key additions, and deletions.
   - Test Dialect DDL Generators for PostgreSQL, MySQL, SQLite, and MSSQL against expected SQL syntax strings.
2. **Integration Tests**:
   - Test `SqliteDriver` with an in-memory SQLite database (`:memory:`):
     - Introspect schema -> Verify extracted tables and columns.
     - Apply generated migration DDL -> Verify database schema was successfully mutated.
3. **Frontend Component Tests & Verification**:
   - Canvas table node rendering.
   - Diff modal state management and Monaco script generation.
   - Clean compilation via `bun run build` / `cargo check` / `cargo test`.
