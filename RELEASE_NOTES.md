# DynoDbModeler v0.3.0 Release Notes

### 🚀 Major Highlights

#### 1. Multi-Engine Native Database Drivers (16 Engines)
DynoDbModeler now natively supports **16 database engines** spanning relational, columnar analytical, distributed NewSQL, document, and wide-column NoSQL:
- **ClickHouse**: Native HTTP 1.1 JSONCompact analytical driver over port 8123 with catalog introspection (`system.tables`, `system.columns`), column type normalization (`DateTime64`, `LowCardinality`, `Array`), and execution plans.
- **MongoDB**: Pure Rust `OP_MSG` wire protocol (opcode 2013) driver over TCP port 27017 with pure Rust BSON encoder/decoder, collection catalog discovery, document sampling schema inference, raw JSON commands, and pseudo-SQL translation.
- **Apache Cassandra & ScyllaDB**: Native CQL v4 binary protocol driver over TCP port 9042 with frame encoder/decoder, `STARTUP` handshakes, `system_schema` introspection (mapping partition and clustering keys into primary keys), and CQL execution.
- **SurrealDB**: SurrealQL REST HTTP driver over port 8000 supporting namespace & database catalogs, `INFO FOR DB` / `INFO FOR NS` schema reverse-engineering, and record-to-grid tabular mapping.
- **Distributed NewSQL (CockroachDB & TiDB)**: Specialized adapters for CockroachDB distributed PostgreSQL consensus and TiDB hybrid HTAP (TiKV/TiFlash) execution.
- **MariaDB**: Dedicated driver adapter.
- **Universal Protocol Router**: Auto-routing URL connection strings (`clickhouse://`, `mongodb://`, `cassandra://`, `surreal://`, `postgres://`, `mysql://`, `sqlite:`).

#### 2. Categorized Engine Selector
- Reorganized connection dialog into 4 distinct categories:
  - *Relational Databases* (PostgreSQL, MySQL, MariaDB, SQLite, MSSQL)
  - *NoSQL, Document & Multi-Model* (MongoDB, Cassandra, ScyllaDB, SurrealDB)
  - *Cloud, NewSQL & Analytics* (ClickHouse, DuckDB, CockroachDB, TiDB, Universal URL)
  - *In-Memory & Cache* (Redis, KeyDB, Valkey)
- Dynamic contextual input placeholders, port mappings, and database/keyspace/namespace guidance.

#### 3. Complete Visual Theme Synchronization (Zero Mismatch)
- Systematically eliminated all theme mismatches across **GitIngest** (warm cream paper `#faf8f5`), **GitHub Light** (`#ffffff`), **Midnight OLED** (`#000000`), and **Dark (Default Dyno)** (`#1e1f22`).
- Mapped all 102 hardcoded hex utility classes to semantic CSS custom properties in `src/index.css`.
- **ERD Canvas & Table Nodes**: Canvas container background, dot grid patterns, and React Flow zoom/pan controls now seamlessly adapt to the selected theme.
- **TableNode Cards**: Fixed hardcoded dark headers, column count pills, hover row highlights, and handle rings so they cleanly render on light backgrounds.
- **Crow's Foot Edges**: Replaced hardcoded `#1e1f22` SVG circle cutouts with `var(--color-bg-base)`, eliminating dark spots on cream and white canvas backgrounds.
- **Sticky Notes & Group Frames**: Added theme-aware light post-it note variants (soft yellow, blue, green, purple with high-contrast text) for light modes and dark saturated variants for dark modes.
- **Live Monaco Editor Theme Switching**: Added reactive theme subscriptions to `DiffModal` and `ValueInspectorDrawer` to immediately update editor styling upon theme toggling.

---
### 📦 Verification & Quality Evidence
- **Backend**: 90/90 Rust unit tests pass (`cargo test`).
- **Frontend**: 37 test files, 392/392 Vitest tests pass (`bun run test`).
- **Bundle**: Production build passes cleanly with zero TypeScript errors (`tsc && vite build`).
