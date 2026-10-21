# Changelog

All notable changes to the **DynoDbModeler** project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
