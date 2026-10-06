# DynoDbModeler

DynoDbModeler is a cross-platform desktop SQL management and interactive database entity-relationship (ERD) modeler built with **Tauri v2**, **Rust**, and **React 19**, featuring a sleek dark aesthetic inspired by **TablePlus**.

DynoDbModeler bridges visual database architecture and live SQL administration. It enables engineers to connect directly to relational database engines, instantly reverse-engineer live catalogs into visual schema graphs, visually modify schemas and relationships, safely review computed DDL diffs, apply atomic migrations, and execute raw SQL queries with instant data grid feedback.

---

## 1. Overview & Purpose

DynoDbModeler is designed for developers, database administrators, and architects who need a fast, native, and visually elegant database companion without the bloat of traditional heavyweight IDEs.

### Key Capabilities
- **Native Multi-Database Connectivity**: Direct asynchronous drivers for **SQLite**, **PostgreSQL**, **MySQL / MariaDB**, and **Microsoft SQL Server (MSSQL)**.
- **Reverse Engineering**: Instant live catalog introspection converting foreign keys, primary keys, and data types into an interactive ERD graph.
- **Visual Schema Modeler**: Drag-and-drop table cards powered by `@xyflow/react` with animated foreign key relation handles, inline column search, and one-click Dagre hierarchical auto-layout.
- **Safe Bidirectional Synchronization**: Deterministic schema diffing engine highlighting added tables, altered columns, and foreign key modifications, paired with a safe transactional DDL migration runner.
- **Interactive SQL Query Workbench**: Multi-tab Monaco Editor with SQL syntax highlighting, keyboard execution shortcuts (`Ctrl+Enter` / `Cmd+Enter`), execution timing metrics, and responsive virtualized data grids.
- **High-Fidelity ERD Export**: Clean schema definition export in JSON format, high-resolution SVG vector diagrams, and raster PNG renderings.
- **TablePlus-Inspired Minimalist Dark UI**: Compact typography, high-contrast dark palette (`#1e1f22`, `#24262b`), and non-intrusive modal drawers.

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
│  │     MySQL, MSSQL)        │  │  - MssqlDriver (tiberius)          │  │
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

DynoDbModeler provides first-class support for four major relational database engines:

| Engine | Driver Crate | Introspection Source | Key Features & Safeguards |
| :--- | :--- | :--- | :--- |
| **SQLite** | `sqlx` (sqlite) | `sqlite_master`, `PRAGMA table_info`, `PRAGMA foreign_key_list` | File-based & `:memory:` support, foreign key pragma enforcement, transactional DDL. |
| **PostgreSQL** | `sqlx` (postgres) | `information_schema`, `pg_catalog.pg_constraint`, `pg_attribute` | Fully-qualified schema quoting (`"schema"."table"`), CASCADE/RESTRICT referential actions. |
| **MySQL / MariaDB** | `sqlx` (mysql) | `information_schema.tables`, `columns`, `key_column_usage` | Backtick quoting, safe `MODIFY COLUMN` omitting redundant `PRIMARY KEY` (prevents error 1068). |
| **Microsoft SQL Server** | `tiberius` (TDS) | `sys.tables`, `sys.columns`, `sys.types`, `sys.foreign_keys` | Square bracket quoting (`[dbo].[table]`), Windows & SQL authentication, identity column mapping. |

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
1. **Destructive Action Highlighting**: Dropped tables and dropped columns are clearly marked in the diff viewer before execution.
2. **Transaction Isolation**: Migration statements execute within an atomic transaction. Any syntax error or foreign key violation triggers an immediate rollback.
3. **Foreign Key Integrity**: Generated DDL guarantees table creation before foreign key addition to prevent circular or missing reference errors.

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
- **Code & Graph Layout**: `@monaco-editor/react 4.7.0`, `dagre 0.8.5`
- **Backend Drivers**: `sqlx 0.8` (sqlite, postgres, mysql), `tiberius 0.12` (mssql), `tokio 1.x`

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
   ├──▶ bun run test ──────────────────────────────▶ 87/87 Vitest Unit Tests PASS (100%)
   ├──▶ cargo test ────────────────────────────────▶ 47/47 Rust Unit Tests PASS (100%)
   ├──▶ cargo clippy (-D warnings) ────────────────▶ 0 Warnings
   └──▶ bun run build (tsc + vite) ────────────────▶ Clean bundle (All chunks < 400 kB)
```

### Test Coverage Highlights
- **Backend (`src-tauri`)**:
  - In-memory SQLite driver introspection, query execution, and transaction rollback verification.
  - Multi-dialect DDL generation tests across SQLite, PostgreSQL, MySQL, and MSSQL.
  - Schema diff computation covering table additions/drops, column alterations, and foreign key modifications.
  - Tauri command execution and `AppState` transition tests.
- **Frontend (`src`)**:
  - `ErdCanvas`: Toolbar interactions, Dagre auto-layout triggers, table drawer opening, and node positioning.
  - `DiffModal`: Visual diff card rendering, dialect SQL display, and migration execution trigger.
  - `QueryEditorTab`: Monaco editor rendering, SQL query execution, result table display, and timing indicators.
  - `export`: JSON, SVG foreignObject viewport export, and PNG offscreen canvas rendering without toolbar icon bias.

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
│   ├── utils/                         # Layout (Dagre), diff count, and diagram export
│   ├── App.tsx                        # Root application shell and state orchestrator
│   └── main.tsx                       # React DOM entry point
├── src-tauri/                         # Rust desktop runtime crate (Tauri v2)
│   ├── src/
│   │   ├── diff/                      # Schema diff comparator and DDL generators
│   │   │   ├── ddl/                   # Dialect DDL compilers (sqlite, postgres, mysql, mssql)
│   │   │   └── mod.rs                 # SchemaDiff engine
│   │   ├── driver/                    # Asynchronous database drivers
│   │   │   ├── factory.rs             # Driver factory and connection dispatcher
│   │   │   ├── sqlite.rs              # SQLite driver implementation
│   │   │   ├── postgres.rs            # PostgreSQL driver implementation
│   │   │   ├── mysql.rs               # MySQL / MariaDB driver implementation
│   │   │   └── mssql.rs               # Microsoft SQL Server driver implementation
│   │   ├── model/                     # Rust canonical domain types and serialization
│   │   ├── commands.rs                # Tauri IPC command definitions
│   │   ├── state.rs                   # Shared thread-safe AppState manager
│   │   └── lib.rs                     # Tauri builder and plugin setup
│   ├── Cargo.toml                     # Rust workspace dependencies and build configuration
│   └── tauri.conf.json                # Tauri v2 desktop window and security settings
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

### 3. Canvas SVG/PNG Export Selector Bias
- **Problem**: Inspecting the root canvas element for the first `<svg>` selects the toolbar Lucide icons (such as the Plus or LayoutGrid icon) instead of the actual entity-relationship graph.
- **Resolution**: The export utilities in `src/utils/export.ts` explicitly target the `.react-flow__viewport` container, wrapping both HTML table nodes (`.react-flow__nodes`) and SVG relationship edges (`.react-flow__edges`) inside an SVG `<foreignObject>` for high-fidelity export.

### 4. Rollup Chunk Size Limit (> 500 kB)
- **Problem**: Heavy editor and graph dependencies (`@monaco-editor/react`, `@xyflow/react`) can exceed standard single-chunk size budgets.
- **Resolution**: Configured `build.rollupOptions.output.manualChunks` in `vite.config.ts` cleanly isolates Monaco Editor, XYFlow, and Lucide into independent chunks, keeping the main application bundle under 370 kB.

---

## 10. License

DynoDbModeler is open source under the [MIT License](LICENSE).
