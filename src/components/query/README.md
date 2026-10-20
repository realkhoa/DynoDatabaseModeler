# SQL Query Editor, Tabular Results & Data Transfer Wizard (`src/components/query`)

## 1. Overview & Purpose
The `src/components/query` module provides an interactive SQL query workspace and comprehensive data transfer toolkit within **DynoDbModeler**. Styled in a modern minimalist dark aesthetic, it features:
- An embedded **Monaco Editor** with SQL syntax highlighting, line numbers, automatic layout, and `vs-dark` theme.
- Convenient keyboard shortcuts (`Ctrl+Enter` / `Cmd+Enter`) to trigger rapid query execution directly from the editor without switching focus.
- Top toolbar controls with execution indicators, spinner states, active database target badges, and precise query execution telemetry (rows returned and duration in milliseconds).
- **Safe Limit Query Interceptor**: Automatically caps unbounded `SELECT` statements with a configurable row limit (100, 500, 1000, or Off; default: 500 rows) to eliminate UI freezes, IPC latency, and memory spikes when querying large enterprise tables. Displays a visual telemetry badge when applied.
- **Server-Side Interactive Pagination Bar (`EditableDataGrid`)**: Sticky bottom pagination controls with First/Previous/Next/Last page navigation, page size selector (25, 50, 100, 200), refresh trigger, and asynchronous background `SELECT COUNT(*)` record counting.
- **Interactive Multi-Format Data Transfer Wizard (`ExportModal`)**: Inspired by DBeaver's data export stream engine, allows exporting tabular query results to CSV, JSON, Markdown tables, and SQL INSERT statements, complete with live preview, formatting options, copy-to-clipboard, and direct file download.
- **Deep Value Inspector Drawer (`ValueInspectorDrawer`)**: Slide-out drawer for inspecting cell contents with syntax highlighting (JSON/XML/Text/Image), edit application, and comprehensive telemetry metrics (characters, words, lines, byte size).
- A clean, modern tabular results grid (`EditableDataGrid`) featuring inline cell editing, dirty-cell tracking, staging mutations bar, sticky headers, and smart data cell formatters for `NULL`, boolean flags, numbers, strings, and JSON objects/arrays.
- Prominent error banners displaying actionable dialect error diagnostics whenever execution fails.

---

## 2. Prerequisites & Dependencies
- **React 19 / TypeScript 5.7+**: Frontend component architecture and strict typing.
- **`@monaco-editor/react`**: Web-standard Monaco code editor runtime.
- **`lucide-react`**: Clean minimalist icons (`Play`, `Loader2`, `AlertCircle`, `FileCode`, `Download`, `Eye`, `Copy`, `Check`, `FileSpreadsheet`, `FileJson`, `Database`, `ShieldCheck`, `ShieldAlert`, `ChevronLeft`, `ChevronRight`, `ChevronsLeft`, `ChevronsRight`, `RotateCw`).
- **`src/types/database.ts`**: Core `QueryResult` and `ConnectionConfig` models.
- **`src/utils/sqlPagination.ts`**: Dialect-aware pagination generators (`LIMIT/OFFSET` vs `OFFSET/FETCH NEXT`), identifier escaping, safe query limit interception, and background count queries.
- **`src/utils/dataTransfer.ts`**: High-performance serialization engines (CSV RFC 4180, JSON, Markdown, SQL INSERT).
- **Tauri IPC (`src/api/ipc.ts`)**: Invokes backend query execution (`cmd_execute_query`) and mutation persistence (`cmd_update_rows`).

---

## 3. Component Props & API Reference

### `QueryEditorTabProps`
| Property | Type | Required | Description |
| :--- | :--- | :---: | :--- |
| `activeConnection` | `ConnectionConfig \| null` | No | Currently active database session profile displayed in the target badge. |
| `initialQuery` | `string` | No | Initial SQL statement loaded into the editor buffer (defaults to sample query). |
| `onQuerySuccess` | `(result: QueryResult) => void` | No | Optional callback invoked upon successful query completion. |
| `autoRun` | `boolean` | No | When `true`, automatically executes the query on mount or when `initialQuery` changes. |

### `EditableDataGridProps` & `DataPaginationState`
```typescript
export interface DataPaginationState {
  /** Zero-based index of the currently displayed page */
  currentPage: number;
  /** Number of rows displayed per page (e.g. 25, 50, 100, 200) */
  pageSize: number;
  /** Total row count across entire table or null if uncomputed */
  totalRows?: number | null;
  /** Callback triggered when user navigates to a new page */
  onPageChange: (newPage: number) => void;
  /** Callback triggered when user selects a different page size */
  onPageSizeChange: (newPageSize: number) => void;
  /** Optional callback triggered to reload current page dataset */
  onRefresh?: () => void;
}
```

### `ExportModalProps`
| Property | Type | Required | Description |
| :--- | :--- | :---: | :--- |
| `isOpen` | `boolean` | Yes | Whether the export wizard modal dialog is currently visible. |
| `tableName` | `string` | No | Suggested target table name derived from query context (defaults to `exported_table`). |
| `columns` | `string[]` | Yes | Ordered array of column header names. |
| `rows` | `any[][]` | Yes | 2D array of tabular dataset values. |
| `onClose` | `() => void` | Yes | Callback invoked when modal is requested to close. |

### `ValueInspectorDrawerProps`
| Property | Type | Required | Description |
| :--- | :--- | :---: | :--- |
| `isOpen` | `boolean` | Yes | Whether the slide-out inspector drawer is visible. |
| `columnName` | `string` | No | Name of the column currently being inspected. |
| `value` | `any` | Yes | Cell value under inspection. |
| `onClose` | `() => void` | Yes | Callback invoked to close the drawer. |
| `onApplyEdit` | `(newValue: any) => void` | No | Callback invoked to commit edited value back into the data grid. |

### SQL Pagination Utilities (`src/utils/sqlPagination.ts`)
- **`escapeIdentifier(ident: string, dbType?: DatabaseType): string`**:
  Escapes identifiers safely for Postgres/SQLite/DuckDB (`""`), MySQL (`` ` ``), and MSSQL (`[]`).
- **`buildPaginatedSelectQuery(tableKey: string, dbType: DatabaseType, pageSize: number, pageIndex: number, primaryKey?: string): string`**:
  Synthesizes dialect-aware paginated SELECT queries (`LIMIT n OFFSET m` or `ORDER BY ... OFFSET m ROWS FETCH NEXT n ROWS ONLY`).
- **`buildCountQuery(tableKey: string, dbType: DatabaseType): string`**:
  Generates `SELECT COUNT(*) AS total_count FROM <table>;`.
- **`applySafeLimit(sql: string, dbType: DatabaseType, limit: number): SafeLimitResult`**:
  Analyzes user queries and injects safe limit clauses if unbounded SELECT is detected.
- **`extractPaginationInfo(sql: string): { limit?: number; offset?: number } | null`**:
  Parses existing limit and offset parameters from SQL strings.

---

## 4. Usage Examples

### Configuring Paginated DataGrid
```tsx
import React, { useState } from 'react';
import { EditableDataGrid } from './components/query/EditableDataGrid';

export const TableRowsViewer: React.FC = () => {
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(50);

  return (
    <EditableDataGrid
      columns={['id', 'username', 'email']}
      rows={[[1, 'john_doe', 'john@example.com']]}
      pagination={{
        currentPage: page,
        pageSize: pageSize,
        totalRows: 1250,
        onPageChange: (newPage) => setPage(newPage),
        onPageSizeChange: (newSize) => {
          setPageSize(newSize);
          setPage(0);
        },
        onRefresh: () => console.log('Reloading data...'),
      }}
    />
  );
};
```

---

## 5. Output Structure & Schema
`QueryEditorTab` operates against the `QueryResult` data model:
```ts
export interface QueryResult {
  /** Ordered array of column names returned by database engine */
  columns: string[];
  /** 2D grid containing rows of typed cell values */
  rows: unknown[][];
  /** Count of rows affected (for DML) or rows returned (for SELECT) */
  rows_affected: number;
  /** Elapsed backend execution duration in milliseconds */
  execution_time_ms: number;
}
```

---

## 6. Troubleshooting & Edge Cases
- **No Active Connection**: Running queries without an active connection will return backend error diagnostics; the toolbar displays a helper hint recommending connection to a target database.
- **Safe Limit on Large Tables**: When querying tables with millions of rows, the default Safe Limit (500 rows) automatically intercepts the query, preventing browser freezes and memory exhaustion. Toggle to "Off" in the toolbar if you specifically require unbounded raw data retrieval.
- **Server Count Fallback**: If `SELECT COUNT(*)` fails due to lack of permission on a complex view, `totalRows` gracefully falls back to `null`, displaying "Showing N rows" with Previous/Next buttons continuing to operate seamlessly.
