# DynoDbModeler

DynoDbModeler is a cross-platform desktop SQL management and interactive database entity-relationship (ERD) modeler built with **Tauri v2**, **Rust**, and **React 19**, featuring a sleek, modern minimalist dark aesthetic.

DynoDbModeler bridges visual database architecture and live SQL administration. It enables engineers to connect directly to relational database engines, instantly reverse-engineer live catalogs into visual schema graphs, visually modify schemas and relationships, safely review computed DDL diffs, apply atomic migrations, and execute raw SQL queries with instant data grid feedback.

---

## 1. Overview & Purpose

DynoDbModeler is designed for developers, database administrators, and architects who need a fast, native, and visually elegant database companion without the bloat of traditional heavyweight IDEs.

### Key Capabilities
- **Native Multi-Database Connectivity**: Direct asynchronous drivers for **SQLite**, **PostgreSQL**, **MySQL / MariaDB**, **Microsoft SQL Server (MSSQL)**, and **DuckDB** (analytical embedded).
- **Reverse Engineering**: Instant live catalog introspection converting foreign keys, primary keys, indexes, and data types into an interactive ERD graph.
- **Visual Schema Modeler**: Drag-and-drop table cards powered by `@xyflow/react` with animated foreign key relation handles, inline column search, and one-click Dagre hierarchical auto-layout.
- **Rename-Safe Migrations**: Renaming a table in the modeler is recorded and applied as `ALTER TABLE ... RENAME TO`; every foreign key that referenced the old name follows it, so a rename never becomes a drop plus create.
- **Safe Bidirectional Synchronization**: Deterministic schema diffing engine highlighting added tables, altered columns, and foreign key modifications, paired with a safe transactional DDL migration runner. Any change a dialect cannot express is reported explicitly instead of being silently skipped.
- **Interactive SQL Query Workbench**: Multi-tab Monaco Editor with SQL syntax highlighting, keyboard execution shortcuts (`Ctrl+Enter` / `Cmd+Enter`), execution timing metrics, and responsive data grids with primary-key-verified inline editing.
- **Synthetic Mock Data / Faker Generator (DBeaver / Antares inspired)**: Intelligent fake data generation engine with 12+ column heuristics (UUID, Email, Name, Address, Timestamps, Integers, Floats, Booleans, Custom Constant), configurable row counts, nullability ratio, auto-increment detection, and instant live SQL insertion or worksheet DDL script generation.
- **Active Database Process Monitor & Session Manager (DBeaver / Antares inspired)**: Live process introspection for PostgreSQL (`pg_stat_activity`), MySQL (`SHOW FULL PROCESSLIST`), and MSSQL (`sys.dm_exec_requests`), displaying client IP, duration, status, and active query text with one-click query termination (`KILL` / `pg_terminate_backend`) backed by safety confirmation.
- **Table Structure, Metadata & DDL Inspector (DBeaver / Antares inspired)**: In-depth table structure inspector providing full column specifications, canonical & dialect types, primary keys, nullability, defaults, secondary indexes, foreign key relationships, and a full dialect DDL script previewer with one-click copy and "Open in Worksheet".
- **SQL Snippets & Scratchpad Manager (Antares / Beekeeper inspired)**: Categorized reusable SQL queries, built-in diagnostic and maintenance templates for PostgreSQL, MySQL, MSSQL, and SQLite, instant cursor insertion into active Monaco editors, and new worksheet tab creation.
- **High-Performance Quick Filter Bar in Editable Data Grid (DBeaver / TablePlus inspired)**: Client-side regex & text filtering across all visible result columns with match counters and persistent dirty cell modification tracking.
- **High-Fidelity ERD Export**: Schema definition export in JSON format, high-resolution SVG vector diagrams with inline computed styles, and raster PNG renderings.
- **Secure Credential Handling**: Database and SSH passwords are stored in the operating system credential store (Windows Credential Manager, macOS Keychain, Linux Secret Service) and are never written to browser storage.
- **Real SSH Bastion Tunnelling**: Database connections can be routed through an SSH bastion using genuine `direct-tcpip` forwarding with known-hosts verification.
- **Offline by Default**: Monaco Editor and all assets are bundled locally; the application loads no executable code from a CDN and runs under a restrictive Content Security Policy.
- **Modern Minimalist Dark UI**: Compact typography, high-contrast dark palette (`#1e1f22`, `#24262b`), and non-intrusive modal drawers.

---

## 2. Architecture Overview

DynoDbModeler employs a modern multi-process desktop architecture leveraging Tauri v2. The Rust backend handles connection management, database introspection, diff algorithms, and DDL compilation. The React frontend provides a responsive 60fps canvas and code editor.

```text
┌────────────────────────────────────────────────────────────────────────┐
│                        Frontend (React 19 / Vite)                      │
│                                                                        │
│  ┌──────────────────┐  ┌──────────────────┐  ┌──────────────────────┐  │
│  │   ErdCanvas      │  │  DiffModal       │  │  QueryEditorTab      │  │
│  │  (@xyflow/react) │  │  (Monaco Editor) │  │  (Data Grid & SQL)   │  │
│  └────────┬─────────┘  └────────┬─────────┘  └──────────┬───────────┘  │
│           │                     │                       │              │
│           └─────────────────────┼───────────────────────┘              │
│                                 │ Tauri IPC (`invoke`)                 │
└─────────────────────────────────┼──────────────────────────────────────┘
                                  ▼
┌────────────────────────────────────────────────────────────────────────┐
│                     Backend Runtime (`src-tauri` / Rust)                │
│                                                                        │
│  ┌──────────────────────────────────────────────────────────────────┐  │
│  │                 Tauri IPC Command Dispatcher                     │  │
│  │   (cmd_connect, cmd_introspect_schema, cmd_compute_diff, etc.)   │  │
│  └──────────────────────────────────┬───────────────────────────────┘  │
│                                     │                                  │
│  ┌──────────────────────────────────▼───────────────────────────────┐  │
│  │              Application State (`AppState`, Arc<RwLock>)         │  │
│  └──────────┬───────────────────────┬───────────────────────────────┘  │
│             │                       │                                  │
│  ┌──────────▼───────────────┐  ┌────▼───────────────────────────────┐  │
│  │      Diff Engine         │  │       Database Drivers             │  │
│  │  - Schema comparator     │  │  - SqliteDriver (sqlx)             │  │
│  │  - Dialect DDL compilers │  │  - PostgresDriver (sqlx)           │  │
│  │    (Postgres, SQLite,    │  │  - MySqlDriver (sqlx)              │  │
│  │     MySQL, MSSQL, DuckDB)│  │  - MssqlDriver (tiberius)          │  │
│  │                          │  │  - DuckDbDriver (duckdb)           │  │
│  └──────────────────────────┘  └────────────────────────────────────┘  │
└────────────────────────────────────────────────────────────────────────┘
```

### Backend Architecture
- **State Management (`src-tauri/src/state.rs`)**: Thread-safe `AppState` wrapping an `Arc<RwLock<Option<Box<dyn DatabaseDriver>>>>` ensuring safe concurrency across async Tauri command invocations.
- **Driver Abstraction (`src-tauri/src/driver/mod.rs`)**: Unified `DatabaseDriver` async trait standardizing connection testing, schema catalog introspection, DDL transaction execution, and raw SQL queries.
- **Schema Diffing & DDL Compilation (`src-tauri/src/diff/`)**: Canonical representation of database entities (`CanonicalType`, `TableSchema`, `ColumnSchema`, `ForeignKeySchema`), decoupled from dialect-specific quirks.
- **Dialect DDL Generators (`src-tauri/src/diff/ddl/`)**: Specialized compilers generating dialect-accurate DDL statements for PostgreSQL, SQLite, MySQL, and MSSQL.

### Frontend Architecture
- **Canvas Engine (`src/components/canvas/ErdCanvas.tsx`)**: Reactive graph workspace visualizing tables as custom interactive cards with column data types and animated relationship splines.
- **Safe Diff & Migration Modal (`src/components/diff/DiffModal.tsx`)**: Split-view visual inspector showing structural change pills, Monaco SQL preview, and confirmation gates.
- **SQL Workbench (`src/components/query/QueryEditorTab.tsx`)**: Lightweight query editor with execution history, latency metrics, and tabular cell navigation.
- **Optimized Bundling (`vite.config.ts`)**: Granular manual chunk splitting (`monaco-editor`, `@xyflow/react`, `lucide-react`) keeping bundle assets below 400 kB for fast startup.

---

## 3. Multi-Database Engine Support

DynoDbModeler provides first-class support for five database engines:

| Engine | Driver Crate | Introspection Source | Key Features & Safeguards |
| :--- | :--- | :--- | :--- |
| **SQLite** | `sqlx` (sqlite) | `sqlite_master`, `PRAGMA table_info`/`table_xinfo`, `PRAGMA foreign_key_list`, `PRAGMA index_list` | File-based & `:memory:` support, secondary index introspection, transactional DDL with foreign keys disabled for the batch, rebuild-based column changes. |
| **PostgreSQL** | `sqlx` (postgres) | `pg_class`/`pg_namespace`, `information_schema.columns`, `pg_constraint`, `pg_index` | Fully-qualified schema quoting (`"schema"."table"`), composite-safe foreign key introspection, numeric precision/scale, identity columns, TLS via `sslmode=require`. |
| **MySQL / MariaDB** | `sqlx` (mysql) | `information_schema.tables`, `columns`, `key_column_usage`, `statistics` | Backtick quoting, index introspection, safe `MODIFY COLUMN` omitting redundant `PRIMARY KEY` (prevents error 1068), TLS via `MySqlSslMode::Required`. |
| **Microsoft SQL Server** | `tiberius` (TDS) | `sys.tables`, `sys.columns`, `sys.types`, `sys.foreign_keys`, `sys.indexes` | Parameterized catalog queries, square bracket quoting (`[dbo].[table]`), `COLUMNPROPERTY` identity detection, real execution plans via `SET SHOWPLAN_XML ON`. |
| **DuckDB** | `duckdb` (bundled) | `information_schema.tables`, `PRAGMA table_info`, `PRAGMA foreign_key_list` | In-process analytical engine (file or `:memory:`), JSON execution plans, parameterized row updates. |

### Dialect Capability Notes

| Change | PostgreSQL | MySQL / MariaDB | SQL Server | SQLite |
| :--- | :--- | :--- | :--- | :--- |
| Rename table | `ALTER TABLE … RENAME TO` | `RENAME TABLE` | `sp_rename` | `ALTER TABLE … RENAME TO` |
| Alter column type / nullability | Native `ALTER COLUMN` (with `USING` cast) | `MODIFY COLUMN` | `ALTER COLUMN` | Full table rebuild |
| Change default | `SET/DROP DEFAULT` | `MODIFY COLUMN` | Reported as unsupported (named constraint) | Full table rebuild |
| Add / drop foreign key | Native | Native | Native | Full table rebuild |
| Change primary key | Reported as unsupported | Reported as unsupported | Reported as unsupported | Full table rebuild |

Anything listed as unsupported is surfaced in the migration dialog as an explicit warning; the
application never reports a successful migration for a change that produced no SQL.

---

## 4. Bidirectional Sync Workflow

DynoDbModeler implements a safe, deterministic bidirectional synchronization workflow:

```text
  Live Database
       │
       ▼ [Reverse Engineering via Catalog Introspection]
  Canonical Schema Model
       │
       ▼ [Interactive ERD Canvas]
  Visual Schema Modifications (Add tables, alter columns, link foreign keys)
       │
       ▼ [Deterministic Schema Diff Engine]
  Structured Schema Diff (Added/Dropped Tables, Modified Columns, Altered FKs)
       │
       ▼ [Dialect-Specific DDL Generation]
  Safe SQL Migration Script (Validated in Monaco Editor)
       │
       ▼ [Atomic Transactional Execution]
  Synchronized Live Database
```

### Safety Features
1. **Destructive Action Highlighting**: Dropped tables, dropped columns, and narrowing alterations are marked in the diff viewer, and executing a migration that contains any of them requires an explicit acknowledgement checkbox.
2. **Transaction Isolation**: Migration statements execute within an atomic transaction. Any syntax error or foreign key violation triggers an immediate rollback.
3. **Foreign Key Integrity**: Generated DDL guarantees table creation before foreign key addition to prevent circular or missing reference errors, and every foreign key target is stored schema-qualified.
4. **Primary-Key-Verified Row Editing**: The data grid only enables in-place editing for a single-table `SELECT` whose table has a real primary key; each write is sent in strict single-row mode, so a locator that matches zero or several rows is rolled back instead of updating the wrong data.
5. **Bounded Execution**: Queries, migrations, and row updates are cancelled at the application layer after a wall-clock limit (120 s for queries, 300 s for mutations) so a runaway statement cannot freeze the workbench indefinitely.

---

## 4b. Security Posture

| Area | Implementation |
| :--- | :--- |
| **Credentials** | Stored in the OS credential store via the `keyring` crate. The frontend can write and delete secrets but never reads them back; connection profiles in `localStorage` never contain a password. Legacy plaintext passwords are stripped on first start. |
| **Frontend code loading** | Monaco Editor and its workers are bundled locally; no runtime CDN fetch. A strict CSP (`script-src 'self'`, `connect-src 'self' ipc:`) blocks remote script execution even if a dependency attempts it. |
| **SQL construction** | Row mutations use bound parameters on SQLite, PostgreSQL, MySQL and DuckDB; catalog queries are parameterized; identifiers are quote-escaped per dialect. |
| **Host key verification** | SSH bastion connections verify the server key against `~/.ssh/known_hosts`; a changed key aborts the connection (first-use trust otherwise). |
| **Local data** | Query history and diagram metadata live in the application data directory; published Docker development ports bind to `127.0.0.1` only. |

---

## 4c. Open-Source SQL Client Power Features (DBeaver, Antares, Sqlectron)

DynoDbModeler synthesizes the best productivity workflows from leading open-source database tools:

### 1. Synthetic Mock Data & Faker Generator (DBeaver / Antares)
- **Heuristic Type Auto-Mapping**: Automatically detects column names and canonical types to assign generators (e.g., `email`, `uuid`, `first_name`, `last_name`, `company`, `city`, `country`, `street_address`, `phone`, `date_past`, `date_future`, `random_int`, `random_float`, `boolean`, `constant`).
- **Batch Insertion**: Generates deterministic batches of 1 to 50,000 synthetic records.
- **Null Percentage Control**: Fine-tune per-column null likelihood (0% to 100%) respecting database nullable constraints.
- **Dual Insertion Mode**: Execute batch `INSERT` statements directly against the live database or export the formatted script into a new query worksheet tab for manual review.

### 2. Active Database Process Monitor & Session Manager (Antares / DBeaver)
- **Real-Time Introspection**:
  - **PostgreSQL**: Queries `pg_stat_activity` for `pid`, `usename`, `datname`, `client_addr`, `state`, elapsed duration, and running SQL text.
  - **MySQL**: Invokes `SHOW FULL PROCESSLIST` parsing connection IDs, database context, command state, and elapsed seconds.
  - **MSSQL**: Interrogates `sys.dm_exec_requests` joined with `sys.dm_exec_sql_text`.
- **Search & Filter**: Live client-side regex and keyword filtering across active queries and connected users.
- **Safe Query Termination**: One-click kill button with a double-confirmation modal prompting before executing `KILL <id>` or `SELECT pg_terminate_backend(<pid>)`.

### 3. Table Structure, Metadata & DDL Inspector (Antares / DBeaver)
- **Columns View**: Inspect column ordinal positions, canonical types, dialect types, primary keys, nullability, defaults, and auto-increment properties.
- **Indexes View**: Inspect primary and secondary index names, key column order, uniqueness, and algorithm types.
- **Foreign Keys View**: Trace relationship constraints, source column mappings, referenced tables, referenced columns, and cascade actions (`ON DELETE`, `ON UPDATE`).
- **Compiled DDL View**: Instantly generate clean, dialect-compliant `CREATE TABLE` and constraint statements with one-click clipboard copy or direct opening in a fresh worksheet editor.

### 4. SQL Snippets & Scratchpad Manager (Antares / Beekeeper)
- **Categorized Snippets**: Organize queries into categories (`Analysis`, `Diagnostics`, `Maintenance`, `Templates`, `Custom`).
- **Pre-loaded Dialect Templates**: Includes standard diagnostic scripts:
  - PostgreSQL: Active locks, cache hit ratio, table disk sizes, index usage.
  - MySQL: InnoDB buffer pool hit rate, table sizes, slow query inspection.
  - MSSQL: Missing index suggestions, top CPU queries, wait statistics.
  - SQLite: Integrity checks, freelist counts, schema dumps.
- **One-Click Insertion**: Insert snippet SQL directly into the active Monaco Editor at the cursor position or launch it into an isolated worksheet tab.

### 5. High-Performance Quick Filter Bar in Editable Data Grid (DBeaver / TablePlus)
- **Client-Side Real-Time Filter**: Filter thousands of tabular rows across any column with instant sub-millisecond feedback.
- **Match Counter**: Visual feedback badge displaying filtered match counts (e.g., `42 / 1000 rows`).
- **Dirty State Persistence**: Tracks modified cell coordinates against original row indices, ensuring pending inline updates remain intact during active filtering.

---

## 5. Prerequisites & Dependencies

### Runtime & System Prerequisites
- **Rust Toolchain**: Rust 1.80+ (`cargo`, `rustc`)
- **JavaScript Runtime**: Bun 1.2+ (recommended) or Node.js 22+ (`npm`, `npx`)
- **Desktop System Libraries**:
  - **Windows**: Microsoft Edge WebView2 (installed by default on Windows 10/11)
  - **macOS**: macOS 11+ with Xcode Command Line Tools
  - **Linux**: `libwebkit2gtk-4.1-dev`, `build-essential`, `curl`, `wget`, `file`, `libssl-dev`, `libgtk-3-dev`, `libayatana-appindicator3-dev`, `librsvg2-dev`

### Core Project Dependencies
- **Tauri**: `tauri 2.2.0`, `@tauri-apps/api 2.2.0`
- **Frontend UI & Visuals**: `react 19.0.0`, `@xyflow/react 12.4.2`, `lucide-react 1.16.0`, `tailwindcss 4.0.0`
- **Code & Graph Layout**: `monaco-editor 0.55.1` (bundled locally), `@monaco-editor/react 4.7.0`, `dagre 0.8.5`
- **Backend Drivers**: `sqlx 0.8` (sqlite, postgres, mysql, `tls-rustls-ring`), `tiberius 0.12` (mssql), `duckdb 1.1` (bundled), `russh 0.64` (SSH tunnelling), `keyring 3` (OS credential store), `tokio 1.x`

---

## 6. Development & Build Commands

All primary workflows are supported via Bun and Cargo scripts:

| Command | Working Directory | Description |
| :--- | :--- | :--- |
| `bun install` | Root | Installs frontend dependencies and development tooling. |
| `bun run dev` | Root | Starts the Vite web development server at `http://localhost:1420`. |
| `bun run tauri dev` | Root | Launches the Tauri desktop application in full development mode with hot reload. |
| `bun run build` | Root | Runs TypeScript type checking (`tsc`) and compiles optimized Vite production bundles. |
| `bun run test` | Root | Executes all frontend unit and component tests via Vitest in Happy-DOM. |
| `cargo test --manifest-path src-tauri/Cargo.toml` | `src-tauri` | Compiles and executes all Rust unit and integration tests across drivers and DDL generators. |
| `cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings` | `src-tauri` | Runs Rust linter ensuring zero warnings and strict idiom adherence. |
| `cargo build --manifest-path src-tauri/Cargo.toml` | `src-tauri` | Compiles the Rust backend in debug mode. |
| `bun run preview` | Root | Previews the production Vite bundle locally. |

---

## 7. Testing & Quality Gates

DynoDbModeler enforces a strict zero-regression quality gate across both backend and frontend layers:

```text
[Commit / PR Gate]
   │
   ├──▶ bun run test ──────────────────────────────▶ 373/373 Vitest Unit Tests PASS (36 test suites)
   ├──▶ cargo test ────────────────────────────────▶ 82/82 Rust Unit Tests PASS
   ├──▶ cargo clippy (-D warnings) ────────────────▶ 0 Warnings
   └──▶ bun run build (tsc + vite) ────────────────▶ Clean bundle (no runtime CDN)
```

### Build Output (measured)

| Asset | Size |
| :--- | :--- |
| `dist/assets/monaco-editor-*.js` | ~3.7 MB (editor core, SQL grammar, JSON service) |
| `dist/assets/index-*.js` | ~450 kB (application shell) |
| `dist/assets/xyflow-*.js` | ~190 kB |
| `dist/assets/lucide-react-*.js` | ~34 kB |
| **Total `dist/`** | **~5.3 MB** |

Monaco is bundled rather than fetched from a CDN, which is why the editor chunk is large. Only the
SQL grammar and the JSON language service are imported, so the TypeScript, CSS and HTML language
workers (about 9 MB) are not shipped.

### Test Coverage Highlights
- **Backend (`src-tauri`)**:
  - In-memory and file-backed SQLite driver introspection, query execution, and transaction rollback verification.
  - Query history persistence across simulated application restarts, including schema self-healing.
  - Real SSH tunnel forwarding: an in-process SSH server plus a TCP echo server push bytes through `direct-tcpip`.
  - Multi-dialect DDL generation tests across SQLite, PostgreSQL, MySQL, MSSQL, and DuckDB, including rename, rebuild and unsupported-change reporting.
  - Schema diff computation covering table additions/drops, renames, multi-schema identity, column alterations, and foreign key modifications.
  - Tauri command execution and `AppState` transition tests.
- **Frontend (`src`)**:
  - `ErdCanvas`: Toolbar interactions, Dagre auto-layout triggers, table drawer opening, and node positioning.
  - `DiffModal`: Visual diff card rendering, dialect SQL display, destructive-change acknowledgement gating, and migration execution.
  - `QueryEditorTab` / `EditableDataGrid`: SQL execution, primary-key-gated editing, strict single-row payloads, and refusal of NULL keys.
  - `export`: JSON, SVG and PNG export, including computed-style inlining.
  - `sqlSafety`: conservative single-table editability analysis and quote-aware statement splitting.

---

## 8. Output Structure & Schema

```text
DynoDbModeler/
├── src/                               # Frontend source code (React 19 + TypeScript)
│   ├── api/                           # Tauri IPC client wrappers (`ipc.ts`)
│   ├── components/                    # Modular UI components
│   │   ├── canvas/                    # ERD Canvas, TableNode, and TableDrawer
│   │   ├── diff/                      # Safe Diff Modal and migration previewer
│   │   ├── query/                     # SQL Query Editor tab and results table
│   │   ├── ConnectionModal.tsx        # Database connection configuration modal
│   │   ├── HeaderBar.tsx              # Top navigation and connection status bar
│   │   └── Sidebar.tsx                # Left navigation and table list explorer
│   ├── types/                         # TypeScript canonical schema and driver models
│   ├── utils/                         # Layout (Dagre), diff count, SQL safety analysis,
│   │                                  #   connection scoping, and diagram export
│   ├── monacoSetup.ts                 # Bundled Monaco wiring (no CDN, local workers)
│   ├── App.tsx                        # Root application shell and state orchestrator
│   └── main.tsx                       # React DOM entry point
├── src-tauri/                         # Rust desktop runtime crate (Tauri v2)
│   ├── src/
│   │   ├── diff/                      # Schema diff comparator and DDL generators
│   │   │   ├── ddl/                   # Dialect DDL compilers (sqlite, postgres, mysql, mssql)
│   │   │   └── mod.rs                 # SchemaDiff engine (renames, multi-schema identity)
│   │   ├── driver/                    # Asynchronous database drivers
│   │   │   ├── factory.rs             # Driver factory, connection dispatcher, tunnel ownership
│   │   │   ├── tunnel.rs              # SSH bastion forwarding via russh
│   │   │   ├── sqlite.rs              # SQLite driver implementation
│   │   │   ├── postgres.rs            # PostgreSQL driver implementation
│   │   │   ├── mysql.rs               # MySQL / MariaDB driver implementation
│   │   │   ├── mssql.rs               # Microsoft SQL Server driver implementation
│   │   │   └── duckdb.rs              # DuckDB driver implementation
│   │   ├── model/                     # Rust canonical domain types and serialization
│   │   ├── storage/                   # File-backed query history and OS credential storage
│   │   ├── commands.rs                # Tauri IPC command definitions
│   │   ├── state.rs                   # Shared thread-safe AppState manager
│   │   └── lib.rs                     # Tauri builder, CSP-driven plugin setup
│   ├── Cargo.toml                     # Rust workspace dependencies and build configuration
│   └── tauri.conf.json                # Tauri v2 desktop window and CSP settings
├── docker-compose.yml                 # Loopback-bound test database environment
├── package.json                       # Frontend dependencies and npm/bun scripts
├── tsconfig.json                      # Strict TypeScript compiler options
├── vite.config.ts                     # Vite bundler, Vitest, and chunk splitting configuration
└── README.md                          # Comprehensive project documentation
```

---

## 9. Troubleshooting & Edge Cases

### 1. MySQL Error 1068: Multiple Primary Key Defined
- **Problem**: When generating DDL to alter columns, MySQL throws `ERROR 1068 (42000): Multiple primary key defined` if the `ALTER TABLE ... MODIFY COLUMN` statement contains the `PRIMARY KEY` clause on an already existing primary key column.
- **Resolution**: DynoDbModeler uses a dedicated `modify_column_def()` generator in MySQL that omits the `PRIMARY KEY` constraint when mutating column types or nullability.

### 2. Multi-Schema Identifier Qualification (PostgreSQL & MSSQL)
- **Problem**: In databases utilizing multiple schemas (e.g. `sales.orders` or `[dbo].[users]`), unquoted or unqualified foreign keys can bind to the wrong default schema.
- **Resolution**: Both the PostgreSQL and MSSQL DDL generators preserve the table's schema namespace, quoting identifiers as `"schema"."table"` or `[schema].[table]` respectively.

### 3. Canvas SVG/PNG Export Styling
- **Problem**: The ERD canvas is styled with utility classes, so exporting raw markup produced an
  SVG or PNG that lost all styling (and rendered blank or unstyled outside the application).
- **Resolution**: `src/utils/export.ts` resolves every element's computed style into an inline `style`
  attribute on a clone of the `.react-flow__viewport` subtree before serializing it, so the exported
  SVG/PNG is self-contained.

### 4. SQLite Column Changes Require a Rebuild
- **Problem**: SQLite cannot change a column's type, nullability or default in place, and it cannot
  add or drop a foreign key on an existing table. Silently emitting no SQL for those changes produced
  a migration that "succeeded" while changing nothing.
- **Resolution**: The diff engine schedules such tables for a rebuild; the SQLite generator emits a
  shadow-table rebuild that copies data and recreates indexes, and it disables foreign key
  enforcement for the duration of the batch. If the table contains objects a rebuild cannot preserve
  (triggers, CHECK constraints, generated columns, `WITHOUT ROWID`, COLLATE overrides, dependent
  views) the rebuild is **refused with an explicit warning** rather than silently dropping them.

### 5. Unsupported Changes Are Reported, Never Silently Skipped
- **Problem**: Some changes cannot be generated safely (for example a primary key change on
  PostgreSQL, MySQL or SQL Server, an IDENTITY change on SQL Server, or a default change backed by a
  named T-SQL constraint). Previously these produced no SQL while the UI reported success.
- **Resolution**: `cmd_generate_ddl` returns both `statements` and `warnings`. Warnings are shown in
  the migration dialog, and the change list marks them separately, so the user always knows what the
  script does and does not cover.

### 6. Query Timeouts
- **Problem**: A long-running statement had no upper bound and left the workbench unresponsive.
- **Resolution**: Queries and execution plans are abandoned after 120 s, migrations and row updates
  after 300 s, with an explanatory error. The database server may still be finishing the abandoned
  statement, and the message says so; reconnect if a session stops responding.

### 7. MySQL 8 `information_schema` Returns `VARBINARY`
- **Problem**: MySQL 8.4 reports several `information_schema` string columns (`TABLE_NAME`,
  `COLUMN_NAME`, `INDEX_NAME`, …) as `VARBINARY`. Decoding them directly as `String` failed with
  `mismatched types … VARCHAR … VARBINARY` and aborted the whole introspection, so MySQL showed no
  tables at all.
- **Resolution**: Catalog string reads go through `mysql_text()`, which falls back to a UTF-8 decode
  of the raw bytes, and catalog counters (often `BIGINT UNSIGNED`) go through `mysql_int()`.

### 8. SQL Server Catalog Integer Widths
- **Problem**: `INFORMATION_SCHEMA.COLUMNS.NUMERIC_PRECISION` is `tinyint` while
  `NUMERIC_SCALE`/`CHARACTER_MAXIMUM_LENGTH` are `int` and `COLUMNPROPERTY` returns `int`. Requesting
  `i32` for the tinyint column failed with `cannot interpret U8 as an i32 value` and broke MSSQL
  introspection.
- **Resolution**: Catalog integers are read through `mssql_int()`, which tries `i32`, `i16`, `u8` and
  `i64`, and `try_get` is used everywhere so a mismatched type can never panic a query.

### 9. `DECIMAL` / `TIMESTAMP` Cells Rendered as NULL
- **Problem**: The row formatters only attempted text, integer, float and boolean decodes, so
  `NUMERIC`/`DECIMAL` and `TIMESTAMP`/`DATETIME` columns were displayed as NULL in the results grid
  even though the data was present.
- **Resolution**: `sqlx`/`tiberius` now enable the `rust_decimal` feature, and the formatters attempt
  decimal, `NaiveDateTime`, `DateTime<Utc>`, `NaiveDate`, `NaiveTime`, JSON and binary decodes before
  giving up. Binary values render as `<binary N bytes>` instead of NULL.

---

## 10. Release Builds

```bash
bun run tauri build
```

Produces, on Windows:

| Artifact | Path |
| :--- | :--- |
| Executable | `src-tauri/target/release/dyno-db-modeler.exe` |
| MSI installer | `src-tauri/target/release/bundle/msi/DynoDbModeler_0.1.0_x64_en-US.msi` |
| NSIS installer | `src-tauri/target/release/bundle/nsis/DynoDbModeler_0.1.0_x64-setup.exe` |

Tauri warns that the bundle identifier ends with `.app`, which is discouraged because it conflicts
with the application bundle extension on macOS; rename `identifier` before shipping a macOS build.

---

## 11. Known Limitations

- **Identifier dots**: A table or column name containing a literal `.` is treated as `schema.name`,
  so such names must be managed manually.
- **Primary key changes** on existing PostgreSQL, MySQL and SQL Server tables are not generated
  automatically (reported as warnings); SQLite performs them through a rebuild.
- **Composite foreign keys** are modelled one column pair at a time, which matches the ERD
  representation but means a multi-column constraint is shown as several relationships.
- **SSH agent authentication** is not implemented; use a password or a private key file.
- **DuckDB indexes** are physical optimisations and are intentionally not round-tripped into
  migrations.
- **Migrations that mix dialects**: the generated script targets the connected dialect only.

---



## 12. License & Acknowledgements

DynoDbModeler is open source software dual-licensed under either:

- **[MIT License](LICENSE-MIT)**
- **[Apache License, Version 2.0](LICENSE-APACHE)**

at your option. This dual-licensing scheme ensures maximum compatibility with both the Rust and JavaScript open-source ecosystems (including Apache-2.0 crates like `russh`, `uuid`, and `sqlx`).

### Third-Party Open-Source Credits
- **Tauri** (https://github.com/tauri-apps/tauri) - MIT or Apache-2.0
- **React 19** (https://github.com/facebook/react) - MIT
- **Monaco Editor** (https://github.com/microsoft/monaco-editor) - MIT
- **@xyflow/react** (https://github.com/xyflow/xyflow) - MIT
- **SQLx** (https://github.com/launchbadge/sqlx) - MIT or Apache-2.0
- **DuckDB** (https://github.com/duckdb/duckdb) - MIT
- **Tiberius** (https://github.com/prisma/tiberius) - MIT or Apache-2.0
- **russh** (https://github.com/warp-tech/russh) - Apache-2.0
- **Tokio** (https://github.com/tokio-rs/tokio) - MIT
- **Lucide Icons** (https://github.com/lucide-icons/lucide) - ISC

Inspired by the developer experience of open-source database tools:
- **DBeaver** (https://github.com/dbeaver/dbeaver) - Apache-2.0
- **Antares SQL** (https://github.com/antares-sql/antares) - MIT
- **Sqlectron** (https://github.com/sqlectron/sqlectron-gui) - MIT
- **Beekeeper Studio** (https://github.com/beekeeper-studio/beekeeper-studio) - GPLv3 / MIT
