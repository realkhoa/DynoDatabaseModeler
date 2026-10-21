# Changelog

All notable changes to the **DynoDbModeler** project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
