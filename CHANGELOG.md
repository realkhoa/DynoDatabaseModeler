# Changelog

All notable changes to the **DynoDbModeler** project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [0.4.0] - 2026-10-21

### 🚀 Next-Gen Tooling Suite

#### 1. Multi-Language ORM & Entity Code Generator (`OrmExportModal`, `ormExporter`)
- Multi-target model compilation supporting 7 major frameworks:
  - **Prisma Schema** (`schema.prisma`): Maps models, primary keys, `@default(autoincrement())`, `@map()`, `@relation()`, and foreign key references.
  - **Drizzle ORM** (`schema.ts`): Dual dialect support for `pgTable` (PostgreSQL) and `sqliteTable` (SQLite).
  - **Golang GORM** (`models.go`): Idiomatic Go structs with `gorm:"primaryKey;column:..."` and JSON tags.
  - **Rust SeaORM** (`entities.rs`): `DeriveEntityModel`, `DeriveRelation`, `ActiveModelBehavior`, and relation annotations.
  - **C# Entity Framework Core** (`Entities.cs`): Data annotations `[Table]`, `[Key]`, `[Column]`, `[ForeignKey]`, and `[DatabaseGenerated]`.
  - **Python SQLAlchemy 2.0** (`models.py`): Modern typed declarative models (`Mapped[T]`, `mapped_column`, `relationship`).
  - **TypeScript TypeORM** (`entities.ts`): Decorator-driven entities (`@Entity`, `@PrimaryGeneratedColumn`, `@Column`, `@ManyToOne`, `@JoinColumn`).
- Monaco Editor preview with real-time framework switching, table scope filtering (`All Tables` vs. single table), and 1-click Copy / Download.

#### 2. Smart CSV & JSON Data Import Wizard (`DataImportModal`, `dataImporter`)
- **RFC 4180 CSV & Multiline Parser**: Robust parser handling quote escaping, commas inside values, and multiline row data, with auto-detection of delimiters (`,`, `;`, `\t`, `|`).
- **JSON Objects Array Parser**: Structured JSON validation and row extraction.
- **Intelligent Heuristic Column Auto-Mapping**: Matches target columns across exact names, case-insensitive variants, and snake_case / camelCase formats.
- **Dialect-Aware Chunked Batch SQL Generation**:
  - Generates 500-row batch `INSERT` chunks with dialect conflict handling (`ignore`, `replace`, `abort`).
  - Supports PostgreSQL (`ON CONFLICT DO NOTHING / UPDATE`), MySQL (`INSERT IGNORE` / `ON DUPLICATE KEY UPDATE`), SQLite (`INSERT OR IGNORE / REPLACE`), and MSSQL / Oracle.

#### 3. Autonomous Database Schema Health Advisor & Database Linter (`SchemaHealthModal`, `schemaHealthAdvisor`)
- **Deterministic Heuristic Rules Engine**: Evaluates 8 critical database design best practices:
  - Missing Primary Keys (with 1-click `ADD PRIMARY KEY` remediation).
  - Unindexed Foreign Keys (with automatic `CREATE INDEX` SQL generation).
  - Redundant & Prefix-Covered Composite Indexes (with `DROP INDEX` generation).
  - Reserved SQL Keyword Collisions (`order`, `user`, `group`, etc.).
  - Unconstrained Foreign Key candidate columns (`*_id`).
  - Approximate Float storage for financial/monetary fields (`price`, `amount`, `salary` to `DECIMAL(12, 2)`).
  - Inconsistent naming conventions across tables.
- **Dynamic Health Scoring (0–100%)**: Color-coded score badges (`Excellent`, `Good`, `Fair`, `Poor`) and severity breakdown counters.
- **1-Click Auto-Remediation & Bundled Migration Script**: Single fix execution via active database connection, single fix clipboard copy, or bundled transaction script (`BEGIN ... COMMIT`) opened directly into SQL query worksheet.

---

## [0.3.1] - 2026-10-21

### ⚡ Performance & Scalability
- **Virtual Windowing Data Grid Engine (`useVirtualRows`)**:
  - Implemented lightweight mathematical virtual row windowing with fixed 28px row height and customizable `rowHeight` prop.
  - Maintains silky-smooth **60 FPS** scrolling across tables with 500 to 100,000+ rows by mounting only 25-35 DOM rows in the active viewport.
  - Preserves cell selection, dirty mutation tracking, and single-row atomic save payloads mapped via `originalIndex`.
- **Debounced Search Subsystem (`useDebouncedValue`)**:
  - Added 150ms debounce hook for text search inputs across `EditableDataGrid` and `Sidebar`, eliminating typing lag during rapid filtering.
- **Canvas Viewport Frustum Culling**:
  - Enabled `onlyRenderVisibleElements={true}` on React Flow canvas, skipping DOM node rendering and Crow's Foot SVG calculations for off-screen tables in complex schemas (30-100+ tables).

### 🎨 Minimalist UI & Zen Mode
- **Tri-State Responsive Sidebar (`Sidebar`)**:
  - Introduced 3 flexible workspace modes: `expanded` (256px), `rail` (48px icon strip with tooltips and connection dot), and `zen` (0px full distraction-free workspace).
  - Global `Ctrl+B` (Windows/Linux) / `Cmd+B` (macOS) keyboard shortcut with smart Monaco Editor / input suppression.
- **Ultra-Clean HeaderBar**:
  - Streamlined header to a flat 40px (`h-10`) height with dynamic panel toggle icons (`PanelLeftClose` / `PanelLeftOpen`).
  - Added minimalist micro-status indicator dot (pulsing emerald green when connected, muted gray when disconnected).
- **Minimalist Floating Pill Toolbar on ERD Canvas**:
  - Consolidated canvas controls into a floating pill bar at `top-4 left-4` with `backdrop-blur-md bg-[#24262b]/85`, fine borders, and accessible micro-buttons.

---

## [0.3.0] - 2026-10-21

### 🚀 Added
- **Multi-Engine Native Database Drivers (16 Engines)**:
  - **ClickHouse**: Native HTTP 1.1 JSONCompact analytical driver over port 8123 with catalog introspection (`system.tables`, `system.columns`), column type normalization (`DateTime64`, `LowCardinality`, `Array`), and execution plans.
  - **MongoDB**: Pure Rust `OP_MSG` wire protocol (opcode 2013) driver over TCP port 27017 with pure Rust BSON encoder/decoder, collection catalog discovery, document sampling schema inference, raw JSON commands, and pseudo-SQL translation.
  - **Apache Cassandra & ScyllaDB**: Native CQL v4 binary protocol driver over TCP port 9042 with frame encoder/decoder, `STARTUP` handshakes, `system_schema` introspection (mapping partition and clustering keys into primary keys), and CQL execution.
  - **SurrealDB**: SurrealQL REST HTTP driver over port 8000 supporting namespace & database catalogs, `INFO FOR DB` / `INFO FOR NS` schema reverse-engineering, and record-to-grid tabular mapping.
  - **Distributed NewSQL (CockroachDB & TiDB)**: Specialized adapters for CockroachDB distributed PostgreSQL consensus and TiDB hybrid HTAP (TiKV/TiFlash) execution.
  - **MariaDB**: Dedicated driver adapter.
  - **Universal Protocol Router**: Auto-routing URL connection strings (`clickhouse://`, `mongodb://`, `cassandra://`, `surreal://`, `postgres://`, `mysql://`, `sqlite:`).
- **Categorized Engine Selector in Connection Dialog**:
  - Reorganized connection dialog into 4 clear categories: *Relational Databases*, *NoSQL, Document & Multi-Model*, *Cloud, NewSQL & Analytics*, and *In-Memory & Cache*.
  - Added contextual placeholders, default ports, and catalog guidance (e.g. `Keyspace` for Cassandra, `Namespace/Database` for SurrealDB, `DB Index` for Redis).

### 🎨 Fixed & Improved
- **Comprehensive Theme Alignment (Zero Mismatch)**:
  - Systematically resolved visual theme mismatches across **GitIngest** (warm cream paper `#faf8f5`), **GitHub Light** (`#ffffff`), **Midnight OLED** (`#000000`), and **Dark (Default Dyno)** (`#1e1f22`).
  - Mapped all 102 hardcoded hex utility classes to semantic CSS custom properties in `src/index.css`.
  - **ERD Canvas & Table Nodes**: Canvas container background, dot grid patterns, and React Flow zoom/pan controls now seamlessly adapt to the selected theme.
  - **TableNode Cards**: Fixed hardcoded dark headers, column count pills, hover row highlights, and handle rings so they cleanly render on light backgrounds.
  - **Crow's Foot Edges**: Replaced hardcoded `#1e1f22` SVG circle cutouts with `var(--color-bg-base)`, eliminating dark spots on cream and white canvas backgrounds.
  - **Sticky Notes & Group Frames**: Added theme-aware light post-it note variants (soft yellow, blue, green, purple with high-contrast text) for light modes and dark saturated variants for dark modes.
  - **Live Monaco Editor Theme Switching**: Added reactive theme subscriptions to `DiffModal` and `ValueInspectorDrawer` to immediately update editor styling upon theme toggling.

---

## [0.2.0] - 2026-10-21

### 🚀 Added
- **Redis / KeyDB / Valkey Native Driver**: In-memory key-value cache and store support with RESP2/RESP3 protocol.
- **Interactive Multi-Theme Personalization**:
  - Introduced 4 built-in visual themes: Dark (Default), GitIngest, GitHub Light, and Midnight OLED.
  - One-click switcher dropdown in HeaderBar with live DOM synchronization and localStorage persistence.
- **Synthetic Mock Data / Faker Generator**: Configurable row counts, nullability ratio, and 12+ heuristics.
- **Active Database Process Monitor & Session Manager**: Live process introspection for PostgreSQL, MySQL, and MSSQL with one-click query termination.
- **Table Structure, Metadata & DDL Inspector**: Deep schema inspection and DDL script previewer.
- **SQL Snippets & Scratchpad Manager**: Built-in maintenance templates and reusable query snippets.
- **High-Performance Quick Filter Bar**: Client-side filtering in editable data grid.

---

## [0.1.0] - 2026-10-21

### 🚀 Initial Release
- Interactive ERD diagram workspace with `@xyflow/react` and Dagre hierarchical auto-layout.
- Direct asynchronous drivers for SQLite, PostgreSQL, MySQL, MSSQL, and DuckDB.
- Live catalog introspection into interactive visual ERD graphs.
- Rename-safe transactional DDL diff calculation and migration runner.
- Monaco Editor multi-tab query worksheets with editable data grids and dirty-cell tracking.
- Secure credential management via OS secret store and real SSH bastion tunnelling.
