# Table Rows Pagination & Safe Query Limiting Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Provide direct table row inspection from ERD canvas and sidebar with dialect-aware pagination, an interactive pagination bar in `EditableDataGrid`, and safe query limiting for large tables in `QueryEditorTab`.

**Architecture:** A standalone pure utility `src/utils/sqlPagination.ts` generates engine-accurate pagination (`LIMIT/OFFSET` vs `OFFSET/FETCH NEXT`), row count queries, and safe query interception. UI triggers on `TableNode` and `Sidebar` dispatch a table data inspection event to `App.tsx`, which switches to `QueryEditorTab` and executes the paginated query immediately. `EditableDataGrid` renders a dedicated pagination bar at the bottom, dynamically updating query offset upon page transitions.

**Tech Stack:** React 19, TypeScript, Vitest, Happy-DOM, `@xyflow/react`, Lucide Icons, Tailwind CSS v4, Monaco Editor.

## Global Constraints

- Mandatory English for all code, identifiers, comments, tests, and documentation.
- Mandatory 100% Doxygen / TSDoc coverage (`@brief`, `@param`, `@return`) for all exported and helper functions.
- Every task must strictly follow TDD (Red -> Green -> Refactor) and end with verified passing tests.
- Zero unresolved lint/type errors (`tsc --noEmit`) and zero broken existing tests across the 196-test vitest suite.

---

### Task 1: Dialect-Aware SQL Pagination Utilities (`src/utils/sqlPagination.ts`)

**Files:**
- Create: `src/utils/sqlPagination.ts`
- Test: `src/utils/sqlPagination.test.ts`

**Interfaces:**
- Produces:
  - `escapeIdentifier(ident: string, dbType?: DatabaseType): string`
  - `buildPaginatedSelectQuery(tableKey: string, dbType: DatabaseType, pageSize: number, pageIndex: number, primaryKey?: string): string`
  - `buildCountQuery(tableKey: string, dbType: DatabaseType): string`
  - `applySafeLimit(sql: string, dbType: DatabaseType, limit: number): { sql: string; applied: boolean }`
  - `extractPaginationInfo(sql: string): { limit?: number; offset?: number } | null`

- [ ] **Step 1: Write the failing unit tests for `sqlPagination.ts`**

Create `src/utils/sqlPagination.test.ts`:
```typescript
import { describe, it, expect } from 'vitest';
import {
  escapeIdentifier,
  buildPaginatedSelectQuery,
  buildCountQuery,
  applySafeLimit,
  extractPaginationInfo,
} from './sqlPagination';
import type { DatabaseType } from '../types/database';

describe('sqlPagination utilities', () => {
  describe('escapeIdentifier', () => {
    it('escapes with double quotes for SQLite, Postgres, and DuckDB', () => {
      expect(escapeIdentifier('users', 'Sqlite')).toBe('"users"');
      expect(escapeIdentifier('public.users', 'Postgres')).toBe('"public"."users"');
      expect(escapeIdentifier('items', 'DuckDb')).toBe('"items"');
    });

    it('escapes with backticks for MySQL', () => {
      expect(escapeIdentifier('users', 'MySql')).toBe('`users`');
      expect(escapeIdentifier('db.users', 'MySql')).toBe('`db`.`users`');
    });

    it('escapes with square brackets for Mssql', () => {
      expect(escapeIdentifier('users', 'Mssql')).toBe('[users]');
      expect(escapeIdentifier('dbo.users', 'Mssql')).toBe('[dbo].[users]');
    });
  });

  describe('buildPaginatedSelectQuery', () => {
    it('generates LIMIT and OFFSET for SQLite, Postgres, MySQL, DuckDB', () => {
      const pgSql = buildPaginatedSelectQuery('users', 'Postgres', 50, 0);
      expect(pgSql).toBe('SELECT * FROM "users" LIMIT 50 OFFSET 0;');

      const pgPage2 = buildPaginatedSelectQuery('public.orders', 'Postgres', 25, 2);
      expect(pgPage2).toBe('SELECT * FROM "public"."orders" LIMIT 25 OFFSET 50;');

      const mySql = buildPaginatedSelectQuery('customers', 'MySql', 100, 1);
      expect(mySql).toBe('SELECT * FROM `customers` LIMIT 100 OFFSET 100;');
    });

    it('generates ORDER BY and OFFSET FETCH NEXT for Mssql', () => {
      const mssqlWithPk = buildPaginatedSelectQuery('dbo.users', 'Mssql', 50, 0, 'id');
      expect(mssqlWithPk).toBe('SELECT * FROM [dbo].[users] ORDER BY [id] OFFSET 0 ROWS FETCH NEXT 50 ROWS ONLY;');

      const mssqlNoPk = buildPaginatedSelectQuery('logs', 'Mssql', 25, 1);
      expect(mssqlNoPk).toBe('SELECT * FROM [logs] ORDER BY (SELECT NULL) OFFSET 25 ROWS FETCH NEXT 25 ROWS ONLY;');
    });
  });

  describe('buildCountQuery', () => {
    it('generates SELECT COUNT(*) with escaped table name', () => {
      expect(buildCountQuery('users', 'Sqlite')).toBe('SELECT COUNT(*) AS total_count FROM "users";');
      expect(buildCountQuery('public.orders', 'Postgres')).toBe('SELECT COUNT(*) AS total_count FROM "public"."orders";');
      expect(buildCountQuery('dbo.users', 'Mssql')).toBe('SELECT COUNT(*) AS total_count FROM [dbo].[users];');
    });
  });

  describe('applySafeLimit', () => {
    it('injects LIMIT clause if SELECT lacks LIMIT and db is Postgres/MySQL/SQLite/DuckDB', () => {
      const res = applySafeLimit('SELECT * FROM users', 'Postgres', 500);
      expect(res.applied).toBe(true);
      expect(res.sql).toBe('SELECT * FROM users LIMIT 500;');
    });

    it('injects FETCH NEXT if SELECT lacks limit and db is Mssql', () => {
      const res = applySafeLimit('SELECT * FROM users', 'Mssql', 500);
      expect(res.applied).toBe(true);
      expect(res.sql).toBe('SELECT * FROM users ORDER BY (SELECT NULL) OFFSET 0 ROWS FETCH NEXT 500 ROWS ONLY;');
    });

    it('does not inject limit if query already has LIMIT or FETCH', () => {
      const res1 = applySafeLimit('SELECT * FROM users LIMIT 10', 'Postgres', 500);
      expect(res1.applied).toBe(false);
      expect(res1.sql).toBe('SELECT * FROM users LIMIT 10');

      const res2 = applySafeLimit('SELECT * FROM users OFFSET 0 ROWS FETCH NEXT 50 ROWS ONLY', 'Mssql', 500);
      expect(res2.applied).toBe(false);
    });

    it('does not alter non-SELECT statements', () => {
      const res = applySafeLimit('UPDATE users SET name = "Test"', 'Sqlite', 500);
      expect(res.applied).toBe(false);
      expect(res.sql).toBe('UPDATE users SET name = "Test"');
    });
  });

  describe('extractPaginationInfo', () => {
    it('extracts limit and offset from standard SQL', () => {
      const info = extractPaginationInfo('SELECT * FROM users LIMIT 50 OFFSET 100;');
      expect(info).toEqual({ limit: 50, offset: 100 });
    });

    it('extracts limit and offset from MSSQL FETCH query', () => {
      const info = extractPaginationInfo('SELECT * FROM users ORDER BY id OFFSET 50 ROWS FETCH NEXT 25 ROWS ONLY;');
      expect(info).toEqual({ limit: 25, offset: 50 });
    });

    it('returns null when no pagination is present', () => {
      expect(extractPaginationInfo('SELECT * FROM users')).toBeNull();
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun run test src/utils/sqlPagination.test.ts`
Expected: FAIL (cannot find module `src/utils/sqlPagination`)

- [ ] **Step 3: Implement `src/utils/sqlPagination.ts`**

```typescript
/**
 * @file sqlPagination.ts
 * @brief Dialect-aware SQL query pagination and query safety limit utilities.
 * @details Synthesizes engine-specific pagination clauses (LIMIT/OFFSET and OFFSET/FETCH NEXT),
 * count queries, identifier escaping, and query safety limit interceptors.
 */

import type { DatabaseType } from '../types/database';

/**
 * @brief Escapes a table or column identifier according to database dialect conventions.
 * @param ident Identifier string, which may contain dot notation for schema qualification (e.g. "public.users").
 * @param dbType Relational database engine dialect.
 * @return Safely escaped identifier string.
 */
export function escapeIdentifier(ident: string, dbType?: DatabaseType): string {
  const parts = ident.split('.').map((p) => p.trim().replace(/^["`\[]|["`\]]$/g, ''));

  switch (dbType) {
    case 'MySql':
      return parts.map((p) => `\`${p}\``).join('.');
    case 'Mssql':
      return parts.map((p) => `[${p}]`).join('.');
    case 'Postgres':
    case 'Sqlite':
    case 'DuckDb':
    default:
      return parts.map((p) => `"${p}"`).join('.');
  }
}

/**
 * @brief Builds a dialect-aware paginated SELECT query for inspecting table rows.
 * @param tableKey Table name, optionally schema-qualified (e.g. 'public.users' or 'users').
 * @param dbType Target database engine type.
 * @param pageSize Number of rows to fetch per page.
 * @param pageIndex Zero-based page number.
 * @param primaryKey Optional primary key column name for deterministic ordering in MSSQL.
 * @return Executable SQL SELECT statement with pagination.
 */
export function buildPaginatedSelectQuery(
  tableKey: string,
  dbType: DatabaseType,
  pageSize: number,
  pageIndex: number,
  primaryKey?: string
): string {
  const escapedTable = escapeIdentifier(tableKey, dbType);
  const offset = Math.max(0, pageIndex * pageSize);

  if (dbType === 'Mssql') {
    const orderClause = primaryKey ? `ORDER BY ${escapeIdentifier(primaryKey, dbType)}` : 'ORDER BY (SELECT NULL)';
    return `SELECT * FROM ${escapedTable} ${orderClause} OFFSET ${offset} ROWS FETCH NEXT ${pageSize} ROWS ONLY;`;
  }

  return `SELECT * FROM ${escapedTable} LIMIT ${pageSize} OFFSET ${offset};`;
}

/**
 * @brief Builds a COUNT(*) query to determine the total number of records in a table.
 * @param tableKey Table name, optionally schema-qualified.
 * @param dbType Target database engine type.
 * @return SQL statement returning `total_count`.
 */
export function buildCountQuery(tableKey: string, dbType: DatabaseType): string {
  const escapedTable = escapeIdentifier(tableKey, dbType);
  return `SELECT COUNT(*) AS total_count FROM ${escapedTable};`;
}

/**
 * @brief Result object returned by applySafeLimit.
 */
export interface SafeLimitResult {
  /** @brief Effective SQL query string after checking/applying limit. */
  sql: string;
  /** @brief Indicates whether an artificial safe limit was appended to the statement. */
  applied: boolean;
}

/**
 * @brief Injects a safe limit clause into a custom SELECT query if it lacks an explicit limit.
 * @param sql User-submitted SQL statement string.
 * @param dbType Relational database engine dialect.
 * @param limit Maximum allowed rows threshold.
 * @return SafeLimitResult containing the resulting SQL and whether a limit was injected.
 */
export function applySafeLimit(
  sql: string,
  dbType: DatabaseType,
  limit: number
): SafeLimitResult {
  const trimmed = sql.trim().replace(/;+$/, '');
  const isSelect = /^\s*SELECT\b/i.test(trimmed);

  if (!isSelect || limit <= 0) {
    return { sql, applied: false };
  }

  // Check if LIMIT or FETCH NEXT is already specified
  const hasLimit = /\bLIMIT\s+\d+/i.test(trimmed);
  const hasFetchNext = /\bFETCH\s+(FIRST|NEXT)\s+\d+\s+ROWS/i.test(trimmed);

  if (hasLimit || hasFetchNext) {
    return { sql, applied: false };
  }

  if (dbType === 'Mssql') {
    const hasOrderBy = /\bORDER\s+BY\b/i.test(trimmed);
    const orderPrefix = hasOrderBy ? '' : ' ORDER BY (SELECT NULL)';
    return {
      sql: `${trimmed}${orderPrefix} OFFSET 0 ROWS FETCH NEXT ${limit} ROWS ONLY;`,
      applied: true,
    };
  }

  return {
    sql: `${trimmed} LIMIT ${limit};`,
    applied: true,
  };
}

/**
 * @brief Extracts limit and offset values from an existing SQL query string.
 * @param sql SQL statement string to analyze.
 * @return Extracted limit and offset numbers, or null if no pagination is present.
 */
export function extractPaginationInfo(
  sql: string
): { limit?: number; offset?: number } | null {
  const limitMatch = sql.match(/\bLIMIT\s+(\d+)/i);
  const offsetMatch = sql.match(/\bOFFSET\s+(\d+)/i);

  const mssqlMatch = sql.match(/OFFSET\s+(\d+)\s+ROWS\s+FETCH\s+(?:FIRST|NEXT)\s+(\d+)\s+ROWS/i);

  if (mssqlMatch) {
    return {
      offset: parseInt(mssqlMatch[1], 10),
      limit: parseInt(mssqlMatch[2], 10),
    };
  }

  if (limitMatch || offsetMatch) {
    return {
      limit: limitMatch ? parseInt(limitMatch[1], 10) : undefined,
      offset: offsetMatch ? parseInt(offsetMatch[1], 10) : undefined,
    };
  }

  return null;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun run test src/utils/sqlPagination.test.ts`
Expected: PASS (all tests pass)

- [ ] **Step 5: Commit**

```bash
git add src/utils/sqlPagination.ts src/utils/sqlPagination.test.ts
git commit -m "feat(sql): add dialect-aware SQL pagination and safe query limit utilities"
```

---

### Task 2: Direct "View Data" Trigger on ERD Canvas (`TableNode.tsx`)

**Files:**
- Modify: `src/components/canvas/TableNode.tsx`
- Modify: `src/components/canvas/ErdCanvas.tsx`
- Test: `src/components/canvas/TableNode.test.tsx`

**Interfaces:**
- Consumes: `TableNodeData.onViewData?: (tableKey: string) => void`
- Produces: Visual eye icon button in table card header that invokes `onViewData(tableKey)`.

- [ ] **Step 1: Write the failing test for `TableNode` View Data trigger**

Modify `src/components/canvas/TableNode.test.tsx`:
Add a test case:
```typescript
it('triggers onViewData callback when clicking the view data eye icon button', () => {
  const onViewData = vi.fn();
  render(
    <TableNode
      id="test-node"
      data={{
        label: 'users',
        schema: 'public',
        columns: [{ name: 'id', data_type: 'Integer', is_primary_key: true, is_nullable: false, is_auto_increment: true }],
        onViewData,
      }}
    />
  );

  const viewDataBtn = screen.getByRole('button', { name: /view table rows/i });
  expect(viewDataBtn).toBeInTheDocument();
  fireEvent.click(viewDataBtn);
  expect(onViewData).toHaveBeenCalledWith('public.users');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun run test src/components/canvas/TableNode.test.tsx`
Expected: FAIL (button with name /view table rows/i not found)

- [ ] **Step 3: Modify `TableNode.tsx` and `ErdCanvas.tsx`**

In `src/components/canvas/TableNode.tsx`:
1. Import `Eye` from `lucide-react`.
2. Add `onViewData?: (tableKey: string) => void` to `TableNodeData`.
3. In header, render an icon button:
```tsx
<button
  type="button"
  onClick={(e) => {
    e.stopPropagation();
    const key = schema ? `${schema}.${label}` : label;
    onViewData?.(key);
  }}
  title="View table rows in Query Editor"
  aria-label={`View table rows for ${label}`}
  className="p-1 text-[#8c919a] hover:text-[#3a82f7] hover:bg-[#1e2024] rounded transition-colors cursor-pointer mr-1"
>
  <Eye className="w-3.5 h-3.5" />
</button>
```
In `src/components/canvas/ErdCanvas.tsx`:
Add `onViewTableData?: (tableKey: string) => void` to `ErdCanvasProps`, and pass it to each `TableNode` data payload as `onViewData: onViewTableData`.

- [ ] **Step 4: Run test to verify it passes**

Run: `bun run test src/components/canvas/TableNode.test.tsx src/components/canvas/ErdCanvas.test.tsx`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/components/canvas/TableNode.tsx src/components/canvas/ErdCanvas.tsx src/components/canvas/TableNode.test.tsx
git commit -m "feat(canvas): add direct view table rows button to ERD table nodes"
```

---

### Task 3: Table Click Action in Navigation Sidebar (`Sidebar.tsx`)

**Files:**
- Modify: `src/components/Sidebar.tsx`
- Test: `src/components/Sidebar.test.tsx`

**Interfaces:**
- Consumes: `SidebarProps.onViewTableData?: (tableKey: string) => void`
- Produces: Clicking a table in the Sidebar notifies `onViewTableData` (or provides a quick view data icon action).

- [ ] **Step 1: Write test in `Sidebar.test.tsx`**

Add test to `src/components/Sidebar.test.tsx`:
```typescript
it('invokes onViewTableData when clicking view data action button on a table item', () => {
  const onViewTableData = vi.fn();
  render(
    <Sidebar
      connections={mockConnections}
      activeConnection={mockConnections[0]}
      tables={mockTables}
      onOpenNewConnection={vi.fn()}
      onSelectConnection={vi.fn()}
      onSelectTable={vi.fn()}
      onRefresh={vi.fn()}
      onViewTableData={onViewTableData}
    />
  );

  const viewBtn = screen.getByRole('button', { name: /view rows for users/i });
  fireEvent.click(viewBtn);
  expect(onViewTableData).toHaveBeenCalledWith('users');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun run test src/components/Sidebar.test.tsx`
Expected: FAIL

- [ ] **Step 3: Implement changes in `Sidebar.tsx`**

In `src/components/Sidebar.tsx`:
1. Import `Eye` from `lucide-react`.
2. Add `onViewTableData?: (tableKey: string) => void` to `SidebarProps`.
3. In each table item row, add an accessible view data button:
```tsx
{onViewTableData && (
  <button
    type="button"
    onClick={(e) => {
      e.stopPropagation();
      onViewTableData(key);
    }}
    title={`View rows for ${key}`}
    aria-label={`View rows for ${key}`}
    className="p-1 text-[#8c919a] hover:text-[#3a82f7] hover:bg-[#1e1f22] rounded transition-colors opacity-0 group-hover:opacity-100 focus:opacity-100 shrink-0 ml-1 cursor-pointer"
  >
    <Eye className="w-3.5 h-3.5" />
  </button>
)}
```
Also, ensure double-clicking the table row or clicking `onViewTableData` seamlessly triggers table row view.

- [ ] **Step 4: Run test to verify it passes**

Run: `bun run test src/components/Sidebar.test.tsx`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/components/Sidebar.tsx src/components/Sidebar.test.tsx
git commit -m "feat(sidebar): add view table rows action to database table list"
```

---

### Task 4: Interactive Pagination Bar in `EditableDataGrid.tsx`

**Files:**
- Modify: `src/components/query/EditableDataGrid.tsx`
- Test: `src/components/query/EditableDataGrid.test.tsx`

**Interfaces:**
- Consumes:
  ```typescript
  export interface DataPaginationState {
    currentPage: number; // 0-based
    pageSize: number;
    totalRows?: number | null;
    onPageChange: (newPage: number) => void;
    onPageSizeChange: (newPageSize: number) => void;
    onRefresh?: () => void;
  }
  ```
- Produces: Persistent pagination bar rendered at the bottom of the table grid with page buttons and page size selector.

- [ ] **Step 1: Write the failing tests for pagination in `EditableDataGrid.test.tsx`**

Add tests to `src/components/query/EditableDataGrid.test.tsx`:
```typescript
describe('EditableDataGrid pagination', () => {
  it('renders pagination bar with page information and page size options', () => {
    const onPageChange = vi.fn();
    const onPageSizeChange = vi.fn();

    render(
      <EditableDataGrid
        columns={['id', 'name']}
        rows={[[1, 'Alice'], [2, 'Bob']]}
        pagination={{
          currentPage: 0,
          pageSize: 50,
          totalRows: 120,
          onPageChange,
          onPageSizeChange,
        }}
      />
    );

    expect(screen.getByText(/showing 1 - 2 of 120 rows/i)).toBeInTheDocument();
    expect(screen.getByText(/page 1 of 3/i)).toBeInTheDocument();

    const nextBtn = screen.getByRole('button', { name: /next page/i });
    fireEvent.click(nextBtn);
    expect(onPageChange).toHaveBeenCalledWith(1);

    const pageSizeSelect = screen.getByRole('combobox', { name: /rows per page/i });
    fireEvent.change(pageSizeSelect, { target: { value: '100' } });
    expect(onPageSizeChange).toHaveBeenCalledWith(100);
  });

  it('disables previous button on first page and next button on last page', () => {
    const onPageChange = vi.fn();
    render(
      <EditableDataGrid
        columns={['id']}
        rows={[[1]]}
        pagination={{
          currentPage: 0,
          pageSize: 50,
          totalRows: 40,
          onPageChange,
          onPageSizeChange: vi.fn(),
        }}
      />
    );

    const prevBtn = screen.getByRole('button', { name: /previous page/i });
    const nextBtn = screen.getByRole('button', { name: /next page/i });
    expect(prevBtn).toBeDisabled();
    expect(nextBtn).toBeDisabled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun run test src/components/query/EditableDataGrid.test.tsx`
Expected: FAIL

- [ ] **Step 3: Implement pagination bar in `EditableDataGrid.tsx`**

In `src/components/query/EditableDataGrid.tsx`:
1. Import `ChevronLeft`, `ChevronRight`, `ChevronsLeft`, `ChevronsRight`, `RotateCw` from `lucide-react`.
2. Define `DataPaginationState` interface.
3. Add `pagination?: DataPaginationState` prop to `EditableDataGridProps`.
4. Render the pagination bar at the bottom:
```tsx
{pagination && (
  <div
    data-testid="pagination-bar"
    className="sticky bottom-0 left-0 right-0 z-10 bg-[#1e1f22] border-t border-[#35373c] px-3 py-1.5 flex items-center justify-between text-xs text-[#8c919a] select-none"
  >
    {/* Row range summary */}
    <div className="flex items-center space-x-2 font-mono text-[11px]">
      <span>
        {pagination.totalRows !== null && pagination.totalRows !== undefined
          ? `Showing ${pagination.currentPage * pagination.pageSize + (rows.length > 0 ? 1 : 0)} - ${
              pagination.currentPage * pagination.pageSize + rows.length
            } of ${pagination.totalRows.toLocaleString()} rows`
          : `Showing ${rows.length} rows`}
      </span>
      {pagination.onRefresh && (
        <button
          type="button"
          onClick={pagination.onRefresh}
          className="p-1 hover:text-[#e6e8ea] hover:bg-[#2b2d30] rounded transition-colors"
          title="Refresh current page"
          aria-label="Refresh data"
        >
          <RotateCw className="w-3 h-3" />
        </button>
      )}
    </div>

    {/* Navigation buttons and Page indicator */}
    <div className="flex items-center space-x-1">
      <button
        type="button"
        disabled={pagination.currentPage <= 0}
        onClick={() => pagination.onPageChange(0)}
        aria-label="First page"
        title="First page"
        className="p-1 text-[#8c919a] hover:text-[#e6e8ea] hover:bg-[#2b2d30] rounded disabled:opacity-30 disabled:pointer-events-none transition-colors cursor-pointer"
      >
        <ChevronsLeft className="w-3.5 h-3.5" />
      </button>
      <button
        type="button"
        disabled={pagination.currentPage <= 0}
        onClick={() => pagination.onPageChange(pagination.currentPage - 1)}
        aria-label="Previous page"
        title="Previous page"
        className="p-1 text-[#8c919a] hover:text-[#e6e8ea] hover:bg-[#2b2d30] rounded disabled:opacity-30 disabled:pointer-events-none transition-colors cursor-pointer"
      >
        <ChevronLeft className="w-3.5 h-3.5" />
      </button>

      <span className="px-2 text-[11px] font-mono text-[#e6e8ea]">
        Page {pagination.currentPage + 1}
        {pagination.totalRows !== null && pagination.totalRows !== undefined
          ? ` of ${Math.max(1, Math.ceil(pagination.totalRows / pagination.pageSize))}`
          : ''}
      </span>

      <button
        type="button"
        disabled={
          pagination.totalRows !== null && pagination.totalRows !== undefined
            ? (pagination.currentPage + 1) * pagination.pageSize >= pagination.totalRows
            : rows.length < pagination.pageSize
        }
        onClick={() => pagination.onPageChange(pagination.currentPage + 1)}
        aria-label="Next page"
        title="Next page"
        className="p-1 text-[#8c919a] hover:text-[#e6e8ea] hover:bg-[#2b2d30] rounded disabled:opacity-30 disabled:pointer-events-none transition-colors cursor-pointer"
      >
        <ChevronRight className="w-3.5 h-3.5" />
      </button>
      <button
        type="button"
        disabled={
          pagination.totalRows !== null && pagination.totalRows !== undefined
            ? (pagination.currentPage + 1) * pagination.pageSize >= pagination.totalRows
            : rows.length < pagination.pageSize
        }
        onClick={() => {
          if (pagination.totalRows) {
            pagination.onPageChange(Math.max(0, Math.ceil(pagination.totalRows / pagination.pageSize) - 1));
          }
        }}
        aria-label="Last page"
        title="Last page"
        className="p-1 text-[#8c919a] hover:text-[#e6e8ea] hover:bg-[#2b2d30] rounded disabled:opacity-30 disabled:pointer-events-none transition-colors cursor-pointer"
      >
        <ChevronsRight className="w-3.5 h-3.5" />
      </button>
    </div>

    {/* Page size dropdown */}
    <div className="flex items-center space-x-1.5">
      <span className="text-[11px]">Rows:</span>
      <select
        aria-label="Rows per page"
        value={pagination.pageSize}
        onChange={(e) => pagination.onPageSizeChange(Number(e.target.value))}
        className="bg-[#121316] text-[#e6e8ea] border border-[#35373c] rounded px-1.5 py-0.5 text-[11px] font-mono outline-none focus:border-[#3a82f7] cursor-pointer"
      >
        <option value={25}>25</option>
        <option value={50}>50</option>
        <option value={100}>100</option>
        <option value={200}>200</option>
      </select>
    </div>
  </div>
)}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun run test src/components/query/EditableDataGrid.test.tsx`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/components/query/EditableDataGrid.tsx src/components/query/EditableDataGrid.test.tsx
git commit -m "feat(grid): implement interactive pagination toolbar in EditableDataGrid"
```

---

### Task 5: Safe Limit Toggle & Auto-Pagination Integration (`QueryEditorTab.tsx`)

**Files:**
- Modify: `src/components/query/QueryEditorTab.tsx`
- Test: `src/components/query/QueryEditorTab.test.tsx`

**Interfaces:**
- Consumes:
  - `applySafeLimit` from `src/utils/sqlPagination.ts`
  - `buildPaginatedSelectQuery` and `buildCountQuery` from `src/utils/sqlPagination.ts`
  - `QueryEditorTabProps.autoRun?: boolean`
- Produces:
  - Safe Limit selector in toolbar `[Safe Limit: 100 / 500 / 1000 / Off]`
  - Automatic `COUNT(*)` background query execution for table inspection
  - Pagination navigation callbacks connected to `EditableDataGrid`

- [ ] **Step 1: Write unit tests in `QueryEditorTab.test.tsx`**

Add tests to `src/components/query/QueryEditorTab.test.tsx`:
```typescript
it('applies safe limit to unbounded SELECT query when safe limit is enabled', async () => {
  const executeSpy = vi.spyOn(api, 'executeQuery').mockResolvedValue({
    columns: ['id'],
    rows: [[1]],
    rows_affected: 1,
    execution_time_ms: 10,
  });

  render(
    <QueryEditorTab
      activeConnection={{ id: 'c1', name: 'Test', db_type: 'Postgres', database: 'test' }}
      initialQuery="SELECT * FROM large_table"
    />
  );

  const runButton = screen.getByRole('button', { name: /run/i });
  fireEvent.click(runButton);

  await waitFor(() => {
    expect(executeSpy).toHaveBeenCalledWith(expect.stringContaining('LIMIT 500'));
  });
});

it('renders Safe Limit selector in toolbar and allows changing limit', () => {
  render(
    <QueryEditorTab
      activeConnection={{ id: 'c1', name: 'Test', db_type: 'Postgres', database: 'test' }}
    />
  );

  const safeLimitSelect = screen.getByRole('combobox', { name: /safe limit/i });
  expect(safeLimitSelect).toHaveValue('500');

  fireEvent.change(safeLimitSelect, { target: { value: '100' } });
  expect(safeLimitSelect).toHaveValue('100');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun run test src/components/query/QueryEditorTab.test.tsx`
Expected: FAIL

- [ ] **Step 3: Implement Safe Limit and Pagination in `QueryEditorTab.tsx`**

In `src/components/query/QueryEditorTab.tsx`:
1. Import `ShieldAlert`, `ShieldCheck` from `lucide-react`.
2. Import `applySafeLimit`, `buildPaginatedSelectQuery`, `buildCountQuery`, `extractPaginationInfo` from `../../utils/sqlPagination`.
3. Add `autoRun?: boolean` to `QueryEditorTabProps`.
4. Add state:
   - `safeLimit: number` (default: 500).
   - `safeLimitNotice: string | null`.
   - `activeTableTarget: string | null`.
   - `pageIndex: number` (default: 0).
   - `pageSize: number` (default: 50).
   - `totalRows: number | null` (default: null).
5. In `handleRun`:
   - If `safeLimit > 0` and connection is present, evaluate `applySafeLimit(sqlToRun, activeConnection.db_type, safeLimit)`.
   - If applied, execute the limited SQL and set `safeLimitNotice` badge.
   - If query targets a specific single table, query `buildCountQuery(table, activeConnection.db_type)` to resolve `totalRows`.
6. Pass `pagination` object to `EditableDataGrid`:
   - `currentPage: pageIndex`
   - `pageSize: pageSize`
   - `totalRows: totalRows`
   - `onPageChange`: rebuild query with new offset, update editor content, and run.
   - `onPageSizeChange`: rebuild query with new pageSize and offset 0, and run.
7. Support `autoRun`: On mount or when `initialQuery` updates with `autoRun: true`, automatically trigger query execution.

- [ ] **Step 4: Run test to verify it passes**

Run: `bun run test src/components/query/QueryEditorTab.test.tsx`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/components/query/QueryEditorTab.tsx src/components/query/QueryEditorTab.test.tsx
git commit -m "feat(query): add safe limit query interception and server-side pagination"
```

---

### Task 6: Workspace Orchestration in `App.tsx`

**Files:**
- Modify: `src/App.tsx`
- Test: `src/App.test.tsx`

**Interfaces:**
- Consumes:
  - `Sidebar.onViewTableData`
  - `ErdCanvas.onViewTableData`
  - `buildPaginatedSelectQuery` from `src/utils/sqlPagination.ts`
- Produces: Coordinates tab navigation from ERD/Sidebar to `QueryEditorTab` with auto-executed paginated query.

- [ ] **Step 1: Write test in `App.test.tsx`**

Add test in `src/App.test.tsx`:
```typescript
it('navigates to SQL query tab with paginated query when viewing table data from sidebar or canvas', async () => {
  render(<App />);
  // Simulate active connection and table selection
  const viewButton = await screen.findByRole('button', { name: /view rows for/i });
  fireEvent.click(viewButton);

  // Tab switches to SQL
  expect(screen.getByRole('tab', { name: /sql query/i })).toHaveAttribute('data-active', 'true');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun run test src/App.test.tsx`
Expected: FAIL

- [ ] **Step 3: Implement handler in `App.tsx`**

In `src/App.tsx`:
1. Import `buildPaginatedSelectQuery` from `./utils/sqlPagination`.
2. Add state:
   - `pendingSqlStatement: string | null`
   - `autoRunQuery: boolean`
3. Define `handleViewTableData(tableKey: string)`:
```typescript
const handleViewTableData = useCallback((key: string) => {
  if (!activeConnection) return;
  const initialPaginatedSql = buildPaginatedSelectQuery(
    key,
    activeConnection.db_type,
    50,
    0
  );
  setPendingSqlStatement(initialPaginatedSql);
  setAutoRunQuery(true);
  setActiveTab('sql');
}, [activeConnection]);
```
4. Pass `onViewTableData={handleViewTableData}` to `Sidebar` and `ErdCanvas`.
5. Pass `initialQuery={pendingSqlStatement || undefined}` and `autoRun={autoRunQuery}` to `QueryEditorTab`.

- [ ] **Step 4: Run test to verify it passes**

Run: `bun run test src/App.test.tsx`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/App.tsx src/App.test.tsx
git commit -m "feat(app): orchestrate table row navigation and instant paginated query execution"
```

---

### Task 7: Documentation & Full Regression Suite

**Files:**
- Modify: `src/components/query/README.md`
- Modify: `src/components/canvas/README.md`

- [ ] **Step 1: Update README documentation**
Document the pagination toolbar, dialect query generation, safe limit controls, and canvas trigger buttons.

- [ ] **Step 2: Run full regression test suite**
Run: `bun run test`
Expected: 24+ test files pass, 200+ tests pass, 0 failed.

- [ ] **Step 3: Run TypeScript compiler check**
Run: `bun x tsc --noEmit`
Expected: Exit code 0, no type errors.

- [ ] **Step 4: Commit documentation and plan completion**

```bash
git add src/components/query/README.md src/components/canvas/README.md
git commit -m "docs: document table rows pagination and query safety limit architecture"
```
