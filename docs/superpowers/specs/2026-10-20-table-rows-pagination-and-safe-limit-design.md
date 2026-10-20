# Design Specification: Table Rows Pagination & Safe Query Limiting

- **Date**: 2026-10-20
- **Author**: Antigravity Pair Programming Agent & User
- **Status**: Approved (Brainstorming Complete)
- **Target Location**: `docs/superpowers/specs/2026-10-20-table-rows-pagination-and-safe-limit-design.md`

---

## 1. Executive Summary

In DynoDbModeler, users inspecting database schemas in the ERD canvas or Sidebar require an intuitive, instant way to view table rows. Previously, there was no direct interaction on a table to inspect its records, forcing users to manually open the SQL Query tab and hand-craft `SELECT *` queries. Furthermore, querying large tables with millions of rows loaded all records across Tauri IPC into webview memory without pagination, causing severe UI freezing, high latency, and memory spikes.

This specification defines a comprehensive solution:
1. **Direct Table Rows Trigger**: Clicking a table in the Sidebar or clicking a dedicated "View Data" (eye) icon on any ERD table node automatically routes to the SQL Query Editor, loads a dialect-aware paginated query, and executes it immediately.
2. **Dialect-Aware Pagination Generator**: Automatically formats SQL queries with correct `LIMIT ... OFFSET ...` or `OFFSET ... FETCH NEXT ...` syntax depending on the active database engine (SQLite, PostgreSQL, MySQL, DuckDB, or MSSQL).
3. **Interactive Pagination Bar in DataGrid**: Provides first/prev/next/last controls, page size selector (25, 50, 100, 200), total record counter via background `SELECT COUNT(*)`, and smooth re-execution when changing pages or page sizes.
4. **Safe Query Limit Interceptor**: Adds a toggleable "Safe Limit" control in the SQL Query Editor toolbar (default: 500 rows) that prevents runaway `SELECT *` queries from stalling the application.

---

## 2. Requirements & User Intent

### 2.1 Functional Requirements
- **FR-1**: In `Sidebar`, clicking on an introspected table opens the SQL Query tab, configures a paginated query `SELECT * FROM <tableKey> LIMIT 50 OFFSET 0;`, and executes it immediately.
- **FR-2**: In `TableNode` (ERD Canvas), add a "View Data" icon button (`Eye`) in the header that performs the same action as FR-1.
- **FR-3**: Support database dialect variations:
  - SQLite, DuckDB, PostgreSQL: `SELECT * FROM "schema"."table" LIMIT 50 OFFSET 0;`
  - MySQL: `SELECT * FROM `table` LIMIT 50 OFFSET 0;`
  - MSSQL: `SELECT * FROM [schema].[table] ORDER BY (SELECT NULL) OFFSET 0 ROWS FETCH NEXT 50 ROWS ONLY;` (or ORDER BY primary key if known).
- **FR-4**: In `EditableDataGrid` / `QueryEditorTab`, render a persistent bottom Pagination Bar displaying:
  - Page navigation buttons: First (`<<`), Previous (`<`), Next (`>`), Last (`>>`).
  - Current status: "Page X of Y" and "Showing A – B of Total rows".
  - Page size dropdown selector: `[25, 50, 100, 200]`.
  - Refresh button to reload current page.
- **FR-5**: In `QueryEditorTab`, calculate total row count using `SELECT COUNT(*) FROM <table>` when viewing table data, enabling accurate total page calculation.
- **FR-6**: Implement "Safe Limit" toolbar toggle in `QueryEditorTab`:
  - Toggle switch or dropdown: `[Safe Limit: 100 / 500 / 1000 / Off]` (default: 500).
  - If a user submits a custom `SELECT` query lacking `LIMIT` or `FETCH NEXT`, automatically inject or append the safe limit clause before sending to Tauri IPC.
  - Display a visual indicator/pill showing "Safe limit applied: N rows".

### 2.2 Non-Functional Requirements
- **NFR-1 (Performance)**: The UI must never freeze when opening a table with millions of rows; each query payload is strictly bounded by the pagination limit.
- **NFR-2 (Non-Destructive)**: Retain full inline editing and dirty-cell tracking in `EditableDataGrid` when viewing rows that have primary keys.
- **NFR-3 (Documentation & Testing)**: 100% Doxygen/TSDoc coverage for all new functions, and unit tests covering SQL query generation, pagination calculations, and UI event triggers.

---

## 3. Architecture & Detailed Design

### 3.1 Component Architecture Overview

```
┌────────────────────────────────────────────────────────────────────────┐
│                        Tauri Frontend (React 19)                       │
│                                                                        │
│  ┌───────────────────────┐           ┌──────────────────────────────┐  │
│  │   Sidebar (Tables)    │           │  ErdCanvas (TableNode Card)  │  │
│  │  - click table row    │           │  - click "View Data" (Eye)   │  │
│  └───────────┬───────────┘           └──────────────┬───────────────┘  │
│              │                                      │                  │
│              └───────────────────┬──────────────────┘                  │
│                                  ▼                                     │
│                     [ App.tsx: onInspectTableData ]                    │
│                                  │                                     │
│                                  ▼ (Switch Tab & set initialQuery)     │
│                     ┌──────────────────────────────┐                   │
│                     │       QueryEditorTab         │                   │
│                     │  - Safe Limit Toggle Bar     │                   │
│                     │  - Monaco SQL Editor         │                   │
│                     │  - Query Execution Controller│                   │
│                     └──────────────┬───────────────┘                   │
│                                    ▼                                   │
│                     ┌──────────────────────────────┐                   │
│                     │      EditableDataGrid        │                   │
│                     │  - Tabular Results Table     │                   │
│                     │  - Dirty-Cell Mutation Bar   │                   │
│                     │  - Fixed Pagination Bar      │                   │
│                     └──────────────┬───────────────┘                   │
└────────────────────────────────────┼───────────────────────────────────┘
                                     │
                                     ▼ (Tauri IPC)
                      [ cmd_execute_query (bounded) ]
```

### 3.2 SQL Pagination & Dialect Helpers (`src/utils/sqlSafety.ts` or new `src/utils/sqlPagination.ts`)

A new dedicated utility module `src/utils/sqlPagination.ts` will provide pure, testable functions:

1. **`escapeIdentifier(ident: string, dbType?: DatabaseType): string`**:
   - Escapes table and schema names correctly (Postgres/SQLite/DuckDB `""`, MySQL ````, MSSQL `[]`).
2. **`buildPaginatedQuery(tableName: string, dbType: DatabaseType, pageSize: number, pageIndex: number, primaryKey?: string): string`**:
   - Computes `offset = pageIndex * pageSize`.
   - Produces engine-accurate pagination query.
3. **`buildCountQuery(tableName: string, dbType: DatabaseType): string`**:
   - Produces `SELECT COUNT(*) AS total_count FROM <escapedTable>;`.
4. **`applySafeLimit(sql: string, dbType: DatabaseType, limit: number): { sql: string; applied: boolean }`**:
   - Analyzes whether `sql` is a `SELECT` statement and whether it already contains `LIMIT` or `FETCH NEXT`.
   - If missing, appends dialect-specific limit clause safely.
5. **`extractPaginationInfo(sql: string): { limit?: number; offset?: number } | null`**:
   - Parses existing limit and offset from an active query to synchronize the pagination bar state.

### 3.3 ERD Canvas & Sidebar Integration

1. **`TableNode.tsx`**:
   - Add a small icon button `<Eye className="w-3.5 h-3.5 text-[#8c919a] hover:text-[#3a82f7]" />` in the table header card right next to the column count badge.
   - Click handler stops propagation and calls `data.onViewData?.(data.label, data.schema)`.
2. **`Sidebar.tsx`**:
   - Add `onViewTableData?: (tableKey: string) => void` callback.
   - Clicking a table item (or an explicit view icon) triggers `onViewTableData`.
3. **`App.tsx`**:
   - Provide `handleViewTableData(tableKey: string)`:
     - Sets `activeTab = 'sql'`.
     - Synthesizes the initial paginated query for `tableKey` based on `activeConnection.db_type`.
     - Passes initial query and auto-run flag to `QueryEditorTab`.

### 3.4 DataGrid Pagination Bar (`EditableDataGrid.tsx`)

Add pagination props to `EditableDataGrid`:
```typescript
export interface DataPaginationProps {
  currentPage: number; // 0-based
  pageSize: number;
  totalRows?: number | null;
  onPageChange: (newPage: number) => void;
  onPageSizeChange: (newPageSize: number) => void;
  onRefresh?: () => void;
  isLoading?: boolean;
}
```

When `pagination` is provided:
- Render a sleek bottom toolbar beneath the table grid:
  - Left: "Showing (page * pageSize + 1) - min((page + 1) * pageSize, totalRows) of totalRows rows".
  - Center: First (`<<`), Prev (`<`), "Page X of Y", Next (`>`), Last (`>>`).
  - Right: Page size selector `<select>` with options 25, 50, 100, 200.

### 3.5 Safe Limit Toggle (`QueryEditorTab.tsx`)

- Add toolbar state: `safeLimit: 100 | 500 | 1000 | 0` (0 = off, default: 500).
- When executing custom queries:
  - If `safeLimit > 0`, call `applySafeLimit(sqlToRun, activeConnection.db_type, safeLimit)`.
  - If modified, run the modified SQL while keeping the user's editor text intact (or optionally show the applied limit in a banner/toast).
  - When viewing table data, table data pagination automatically manages limit/offset.

---

## 4. Error Handling & Invariants

1. **Invalid or Complex Queries**: If a user runs a non-SELECT query (`UPDATE`, `INSERT`, `CREATE`), Safe Limit is bypassed completely.
2. **Count Query Failures**: If `SELECT COUNT(*)` fails (e.g. view without count permissions), totalRows falls back to `null`, displaying "Showing 1 - 50 rows (total unknown)" with Prev/Next buttons remaining functional.
3. **Unsaved Dirty Edits**: If the user has unsaved edits in `EditableDataGrid` and clicks Next/Prev page, prompt the user with a confirmation dialog before discarding uncommitted mutations.

---

## 5. Testing & Verification Plan

1. **Unit Tests (`sqlPagination.test.ts`)**:
   - Verify pagination query generation across SQLite, PostgreSQL, MySQL, DuckDB, and MSSQL.
   - Verify count query formatting with schemas and special characters.
   - Verify safe limit injection:
     - Injects limit when none exists.
     - Does not inject limit when `LIMIT 10` or `FETCH NEXT` is already present.
     - Leaves non-SELECT statements untouched.
2. **Component Tests**:
   - `TableNode.test.tsx`: Click eye icon calls `onViewData`.
   - `Sidebar.test.tsx`: Click table calls `onViewTableData`.
   - `EditableDataGrid.test.tsx`: Pagination bar renders, page changes trigger callback, page size dropdown updates.
   - `QueryEditorTab.test.tsx`: Safe limit toggle works; pagination navigation updates query.
3. **Build & Regression Verification**:
   - Run `bun run test` (vitest) to ensure all tests pass (0 failures).
   - Run `tsc --noEmit` to verify type cleanliness.
   - Run deterministic code review tool.
