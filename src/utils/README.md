# DynoDbModeler Utility Functions & React Hooks

## Overview & Purpose
The `src/utils` directory provides utility functions, algorithms, and custom React hooks for **DynoDbModeler**. These modules encapsulate core non-visual business logic, including:
- **High-Performance Virtualization (`useVirtualRows`)**: High-performance windowing calculation for rendering tens of thousands of rows without DOM bloat.
- **Debounced State Synchronization (`useDebouncedValue`)**: Clean hook to debounce rapid user inputs (search filters, typing) with automatic timer cancellation.
- **Dialect-Aware SQL Pagination (`sqlPagination`)**: Cross-dialect pagination query generation supporting standard SQL (`LIMIT`/`OFFSET`) and T-SQL (`OFFSET...FETCH NEXT`).
- **Graph Layout Calculation (`layout`)**: Dagre-based hierarchical graph arrangement for automatic ERD diagram alignment.
- **SQL Parsing, Formatting & Autocompletion**: Monaco autocompletion provider (`sqlCompletion`), AST-based formatter (`sqlFormatter`), and destructive statement detection (`sqlSafety`).
- **Data Export & Transformation**: Multi-format serializers (`export`, `dataTransfer`, `ddlExporter`) for CSV, JSON, Markdown, SVG, and SQL INSERT scripts.
- **Local Client State Managers**: Schema diff counter (`diffCount`), virtual relationships manager (`virtualRelations`), and scratchpad storage (`scratchpad`).

---

## Prerequisites & Dependencies
- **Runtime**: Bun 1.2+ or Node.js 20+
- **Libraries**:
  - `react`: React 18+ hooks (`useState`, `useEffect`, `useMemo`)
  - `dagre`: Directed graph layout calculation
  - `sql-formatter`: SQL query formatting and indentation

---

## API Reference & Hook Signatures

### 1. `useVirtualRows`

A zero-dependency React hook for calculating virtual row windowing in high-performance data grids and lists.

```typescript
export interface UseVirtualRowsOptions {
  totalCount: number;         // Total number of rows in the dataset
  rowHeight: number;          // Fixed height of each row in pixels (e.g. 36)
  containerHeight: number;    // Height of the visible scrolling container in pixels
  scrollTop: number;          // Current vertical scroll offset in pixels
  overscan?: number;          // Buffer rows to render above and below visible viewport (default: 5)
}

export interface VirtualRowsResult {
  startIndex: number;         // Index of the first row to slice and render
  endIndex: number;           // Index of the last row (exclusive) to slice and render
  visibleCount: number;       // Number of rows currently rendered in DOM
  topSpacerHeight: number;    // Height in pixels of top empty spacer div
  bottomSpacerHeight: number; // Height in pixels of bottom empty spacer div
  totalHeight: number;        // Total virtual height in pixels of all rows
}

export function useVirtualRows(options: UseVirtualRowsOptions): VirtualRowsResult;
```

#### Invariants & Boundary Handling:
- When `totalCount <= 0` or `containerHeight <= 0`, returns empty window (`startIndex: 0`, `endIndex: 0`, `topSpacerHeight: 0`, `bottomSpacerHeight: 0`).
- Clamps `scrollTop` to non-negative values (`Math.max(0, scrollTop)`) to gracefully handle iOS-style elastic bouncing or negative scroll events.
- Safely clamps `startIndex >= 0` and `endIndex <= totalCount`.

---

### 2. `useDebouncedValue`

A lightweight hook that returns a debounced version of a rapidly changing value (e.g. text search input).

```typescript
export function useDebouncedValue<T>(value: T, delayMs: number = 150): T;
```

#### Behavior:
- Updates immediately on first mount.
- On subsequent value changes, sets a timer for `delayMs` milliseconds before updating the returned debounced value.
- Cleans up and cancels pending timers on unmount or whenever `value` or `delayMs` changes, preventing memory leaks and updates to unmounted components.

---

### 3. `sqlPagination`

Utilities for parsing and generating database pagination queries across database dialects.

```typescript
export function buildPaginatedQuery(
  rawSql: string,
  page: number,
  pageSize: number,
  dialect: 'sqlite' | 'postgres' | 'mysql' | 'mssql' | 'duckdb' | 'libsql',
  primaryKeyColumn?: string
): string;
```

- **PostgreSQL / MySQL / SQLite / DuckDB / LibSQL**: Appends or modifies `LIMIT <pageSize> OFFSET <offset>`.
- **Microsoft SQL Server (MSSQL)**: Wraps or injects `ORDER BY <pk> OFFSET <offset> ROWS FETCH NEXT <pageSize> ROWS ONLY`.

---

### 4. `ormExporter`

Compiles database schemas or selected tables into production-ready ORM entity and model code across 8 popular frameworks:
- **Prisma** (`schema.prisma`): Models, `@id`, `@default(autoincrement())`, `@map()`, `@relation()`.
- **Drizzle ORM (PostgreSQL)** (`schema.ts`): `pgTable`, `serial`, `integer`, `varchar`, `text`, `timestamp`, `references()`.
- **Drizzle ORM (SQLite)** (`schema.ts`): `sqliteTable`, `integer`, `text`, `real`, `blob`.
- **Golang GORM** (`models.go`): Go structs with `gorm:"primaryKey;autoIncrement;column:..."` tags.
- **Rust SeaORM** (`entities.rs`): `DeriveEntityModel`, `PrimaryProp`, `ColumnType`, `RelationDef` attributes.
- **C# EF Core** (`Entities.cs`): `[Table]`, `[Key]`, `[Column]`, `[DatabaseGenerated]`, `[ForeignKey]` attributes.
- **Python SQLAlchemy 2.0** (`models.py`): `Mapped[T]`, `mapped_column`, `ForeignKey`, `relationship`.
- **TypeORM** (`entities.ts`): `@Entity`, `@PrimaryGeneratedColumn`, `@Column`, `@ManyToOne`, `@JoinColumn`.

```typescript
export function exportOrmCode(
  target: OrmTarget,
  tables: TableSchema[],
  options?: OrmExportOptions
): OrmExportResult;
```

---

### 5. `layout`

Computes automatic 2D graph layout coordinates for database tables on the ERD canvas using Dagre.

```typescript
export function getLayoutedElements(
  nodes: Node[],
  edges: Edge[],
  direction: 'TB' | 'LR' = 'TB'
): { nodes: Node[]; edges: Edge[] };
```

---

### 6. `dataImporter`

High-performance data import engine supporting RFC 4180 CSV parsing, multiline text cells, JSON array of objects, heuristic column auto-mapping, and dialect-aware chunked batch SQL generation with conflict handling (`ignore`, `replace`, `abort`):

```typescript
export function parseCsv(text: string, delimiter?: string): ParsedImportData;
export function parseJsonData(text: string): ParsedImportData;
export function inferColumnType(values: unknown[]): CanonicalType;
export function autoMapColumns(sourceHeaders: string[], targetColumns: ColumnSchema[]): ColumnMapping;
export function generateBatchInsertSql(options: BatchInsertOptions): string;
```

---

### 7. `schemaHealthAdvisor`

Autonomous database schema health analyzer and linter evaluating primary keys, foreign key index coverage, redundant indexes, reserved keyword collisions, and data type optimizations:

```typescript
export function analyzeSchemaHealth(
  schema: DatabaseSchema,
  dbType?: DatabaseType
): SchemaHealthReport;
```

---

### 8. `export`

Exports tabular query results to external file formats.

```typescript
export function exportToCsv(data: Record<string, unknown>[], filename?: string): void;
export function exportToJson(data: Record<string, unknown>[], filename?: string): void;
export function exportToMarkdown(data: Record<string, unknown>[]): string;
export function exportToSqlInsert(tableName: string, data: Record<string, unknown>[]): string;
```

---

### 6. `virtualRelations`

Persists user-drawn diagram-only relationships in browser `localStorage`.

```typescript
export function loadVirtualRelationships(dbName: string): VirtualRelationship[];
export function saveVirtualRelationships(dbName: string, relations: VirtualRelationship[]): void;
export function addVirtualRelationship(dbName: string, rel: VirtualRelationship): void;
export function removeVirtualRelationship(dbName: string, relId: string): void;
```

---

## Usage Examples

### Example 1: Implementing a Virtualized List with `useVirtualRows`

```tsx
import React, { useRef, useState } from 'react';
import { useVirtualRows } from '../utils/useVirtualRows';

interface VirtualListProps {
  items: string[];
}

export const VirtualList: React.FC<VirtualListProps> = ({ items }) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = useState(0);

  const rowHeight = 36;
  const containerHeight = 400;

  const {
    startIndex,
    endIndex,
    topSpacerHeight,
    bottomSpacerHeight,
    totalHeight,
  } = useVirtualRows({
    totalCount: items.length,
    rowHeight,
    containerHeight,
    scrollTop,
    overscan: 4,
  });

  const visibleItems = items.slice(startIndex, endIndex);

  return (
    <div
      ref={containerRef}
      onScroll={(e) => setScrollTop(e.currentTarget.scrollTop)}
      style={{ height: containerHeight, overflowY: 'auto' }}
      className="border rounded divide-y"
    >
      <div style={{ height: totalHeight, position: 'relative' }}>
        {topSpacerHeight > 0 && <div style={{ height: topSpacerHeight }} />}
        {visibleItems.map((item, idx) => (
          <div
            key={startIndex + idx}
            style={{ height: rowHeight }}
            className="flex items-center px-4"
          >
            Row {startIndex + idx + 1}: {item}
          </div>
        ))}
        {bottomSpacerHeight > 0 && <div style={{ height: bottomSpacerHeight }} />}
      </div>
    </div>
  );
};
```

### Example 2: Debounced Search Input with `useDebouncedValue`

```tsx
import React, { useState, useMemo } from 'react';
import { useDebouncedValue } from '../utils/useDebouncedValue';

export const FilterableTableList: React.FC<{ tables: string[] }> = ({ tables }) => {
  const [query, setQuery] = useState('');
  const debouncedQuery = useDebouncedValue(query, 150);

  const filteredTables = useMemo(() => {
    if (!debouncedQuery.trim()) return tables;
    const lower = debouncedQuery.toLowerCase();
    return tables.filter((t) => t.toLowerCase().includes(lower));
  }, [tables, debouncedQuery]);

  return (
    <div className="flex flex-col gap-2">
      <input
        type="text"
        placeholder="Search tables..."
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        className="px-2 py-1 rounded border bg-input text-foreground text-sm"
      />
      <ul className="text-sm">
        {filteredTables.map((t) => (
          <li key={t}>{t}</li>
        ))}
      </ul>
    </div>
  );
};
```

---

## Directory Structure

```
src/utils/
├── connectionScope.ts         # Connection lifecycle and scope management
├── dataImporter.ts            # CSV/JSON import parser, column mapping, batch SQL
├── dataImporter.test.ts       # Data importer unit tests
├── dataTransfer.ts            # CSV/JSON clipboard and file parsing
├── dataTransfer.test.ts       # Data transfer parser unit tests
├── ddlExporter.ts             # Generates CREATE TABLE DDL scripts from schema
├── ddlExporter.test.ts        # DDL exporter unit tests
├── diffCount.ts               # Computes count of unapplied schema diffs
├── diffCount.test.ts          # Diff count unit tests
├── export.ts                  # Export to CSV, JSON, Markdown, and SQL INSERT
├── export.test.ts             # Export utilities unit tests
├── layout.ts                  # Dagre graph layout engine for ERD diagram
├── layout.test.ts             # Layout calculation unit tests
├── mockDataGenerator.ts       # Fake mock data generator for tables
├── mockDataGenerator.test.ts  # Mock data generator unit tests
├── ormExporter.ts             # Multi-target ORM & Entity code generator
├── ormExporter.test.ts        # ORM exporter unit tests
├── processQueries.ts          # Database process listing and thread management
├── processQueries.test.ts     # Process queries unit tests
├── schemaHealthAdvisor.ts     # Schema linter and health advisor engine
├── schemaHealthAdvisor.test.ts # Schema health advisor unit tests
├── scratchpad.ts              # LocalStorage query scratchpad manager
├── scratchpad.test.ts         # Scratchpad unit tests
├── sqlCompletion.ts           # Schema-aware Monaco autocompletion provider
├── sqlCompletion.test.ts      # SQL completion unit tests
├── sqlFormatter.ts            # SQL AST formatting and indentation
├── sqlFormatter.test.ts       # SQL formatter unit tests
├── sqlPagination.ts           # Dialect-aware SQL LIMIT/OFFSET pagination
├── sqlPagination.test.ts      # SQL pagination unit tests
├── sqlSafety.ts               # Detection of destructive queries (DROP/TRUNCATE)
├── themeManager.ts            # Dark/light theme switching and CSS variables
├── themeManager.test.ts       # Theme manager unit tests
├── useDebouncedValue.ts       # Debounced state synchronization hook
├── useDebouncedValue.test.ts  # useDebouncedValue hook unit tests
├── useVirtualRows.ts          # Virtual list row windowing calculation hook
├── useVirtualRows.test.ts     # useVirtualRows hook unit tests
├── virtualRelations.ts        # LocalStorage virtual relations manager
├── virtualRelations.test.ts   # Virtual relations unit tests
└── README.md                  # Utilities and hooks documentation (this file)
```

---

## Troubleshooting & Edge Cases

1. **Jittery Virtual Scrolling**:
   - Ensure the `rowHeight` option in `useVirtualRows` accurately matches the CSS rendered height of each table row. Variable height rows are not supported by the fixed-height formula.
2. **Scroll Lag on High-Resolution Screens**:
   - The default `overscan` buffer is 5 rows above and below the viewport. If blank rows appear during rapid fling scrolling, increase `overscan` to 10 or 15.
3. **Debounced Input State Delay**:
   - In automated test suites or synchronous event handlers, use Vitest's `vi.useFakeTimers()` and `vi.advanceTimersByTime(150)` to advance the debounce delay cleanly.
