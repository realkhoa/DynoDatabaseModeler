# SQL Query Editor, Tabular Results & Data Transfer Wizard (`src/components/query`)

## 1. Overview & Purpose
The `src/components/query` module provides an interactive SQL query workspace and comprehensive data transfer toolkit within **DynoDbModeler**. Styled in a modern minimalist dark aesthetic, it features:
- **Multi-Tab Query Worksheets (`QueryWorksheetBar`)**:
  - Independent SQL tabs (`Query 1`, `Query 2`, etc.) with persistent query buffers, separate results grids, and execution metadata per tab.
  - Interactive tab management: tab switching, double-click inline tab renaming, close tab `✕` (locked when only 1 tab exists to prevent empty states), and quick new tab creation (`+`).
  - **Dedicated Table View Tabs**: Automatically opens a dedicated named tab (e.g., `users (Data)`) when "View Data" is clicked from ERD Canvas or Sidebar.
  - **Dirty Unsaved Grid Edit Protection**: Warns the user via confirmation modal before switching tabs or creating new tabs when pending cell mutations exist.
- An embedded **Monaco Editor** with SQL syntax highlighting, line numbers, automatic layout, and `vs-dark` theme.
- **Run Selection (Thực thi đoạn SQL bôi đen)**:
  - Dynamically detects text highlights in Monaco Editor via `onDidChangeCursorSelection`.
  - Seamlessly updates toolbar action to `Run Selection (Ctrl+Enter)` and executes only the highlighted SQL snippet. When no selection is present, executes the entire worksheet query buffer.
- **Pure SQL Beautifier / Formatter Engine (`src/utils/sqlFormatter.ts`)**:
  - Formats raw SQL into structured, readable statements: capitalizes SQL keywords, indents clauses by 2 spaces, and aligns query bodies.
  - Safely handles single-line comments (`--`), block comments (`/* */`), single/double-quoted strings, and dialect-specific identifier delimiters (`""`, `[]`, `` ` ``).
  - Accessible via toolbar "Format" button (`Sparkles` icon) and Monaco's native document formatting provider shortcut (`Shift+Alt+F`).
- **Intelligent Schema-Aware SQL Autocompletion Engine (`src/utils/sqlCompletion.ts`)**:
  - Context-sensitive suggestions for standard ANSI SQL keywords and aggregate/scalar functions (`COUNT`, `SUM`, `AVG`, `COALESCE`, `NOW`, etc.).
  - Schema-aware table completions displaying column counts and rich Markdown documentation listing all columns and data types.
  - Schema-aware column completions with normalized data types (`VARCHAR(255)`, `INTEGER`, etc.), primary key badges (`[PK]`), and nullability indicators.
  - **Dot-Triggered Table Column Filtering**: When typing `<table_name>.`, automatically restricts completion suggestions strictly to columns belonging to that table, sorting Primary Key columns first.
  - **Clause-Aware Priority Sorting**: Automatically boosts table suggestions to top priority (`sortText: '0_'`) following table reference clauses (`FROM`, `JOIN`, `INTO`, `UPDATE`, `TABLE`).
  - Zero memory leaks and zero duplicate popups through lifecycle-managed Monaco completion provider registration with dynamic `schemaRef` synchronization.
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
- **`@monaco-editor/react` & `monaco-editor`**: Web-standard Monaco code editor runtime and language services.
- **`lucide-react`**: Clean minimalist icons (`Play`, `Loader2`, `AlertCircle`, `FileCode`, `Download`, `Eye`, `Copy`, `Check`, `FileSpreadsheet`, `FileJson`, `Database`, `ShieldCheck`, `ShieldAlert`, `ChevronLeft`, `ChevronRight`, `ChevronsLeft`, `ChevronsRight`, `RotateCw`).
- **`src/types/database.ts`**: Core `QueryResult`, `DatabaseSchema`, `TableSchema`, and `ConnectionConfig` models.
- **`src/utils/sqlFormatter.ts`**: Pure functional SQL beautifier and formatting engine (`formatSql`).
- **`src/utils/sqlCompletion.ts`**: Pure functional SQL autocompletion engine (`formatCanonicalType`, `detectCompletionContext`, `getTableCompletions`, `getColumnCompletions`, `buildSqlCompletions`).
- **`src/utils/sqlPagination.ts`**: Dialect-aware pagination generators (`LIMIT/OFFSET` vs `OFFSET/FETCH NEXT`), identifier escaping, safe query limit interception, and background count queries.
- **`src/utils/dataTransfer.ts`**: High-performance serialization engines (CSV RFC 4180, JSON, Markdown, SQL INSERT).
- **Tauri IPC (`src/api/ipc.ts`)**: Invokes backend query execution (`cmd_execute_query`) and mutation persistence (`cmd_update_rows`).

---

## 3. Component Props & API Reference

### `QueryEditorTabProps`
| Property | Type | Required | Description |
| :--- | :--- | :---: | :--- |
| `activeConnection` | `ConnectionConfig \| null` | No | Currently active database session profile displayed in the target badge. |
| `schema` | `DatabaseSchema \| null` | No | Introspected database schema containing tables and columns used to power autocompletion. |
| `initialQuery` | `string` | No | Initial SQL statement loaded into the editor buffer (defaults to sample query). |
| `onQuerySuccess` | `(result: QueryResult) => void` | No | Optional callback invoked upon successful query completion. |
| `autoRun` | `boolean` | No | When `true`, automatically executes the query on mount or when `initialQuery` changes. |

### `QueryWorksheetBarProps` & `QueryWorksheet`
```typescript
export interface QueryWorksheet {
  /** Unique worksheet identifier (e.g., 'ws-1') */
  id: string;
  /** Display title on the tab bar (e.g., 'Query 1', 'users') */
  title: string;
  /** Current SQL query buffer text */
  query: string;
  /** Most recent query execution result or null */
  result: QueryResult | null;
  /** Tab-specific safe limit constraint (e.g., 500, 1000, 0=Off) */
  safeLimit: number;
  /** Safe limit notification badge text or null */
  safeLimitNotice: string | null;
  /** Zero-based current page index for server-side pagination */
  pageIndex: number;
  /** Page size limit for server-side pagination */
  pageSize: number;
  /** Total row count in target table/result or null */
  totalRows: number | null;
  /** Execution error message or null */
  error: string | null;
  /** Query execution plan tree if analyzed */
  explainPlan: ExecutionPlanNode | null;
}

export interface QueryWorksheetBarProps {
  /** Ordered list of active query worksheets */
  worksheets: QueryWorksheet[];
  /** Unique identifier of the currently active worksheet */
  activeId: string;
  /** Callback triggered when user selects a worksheet tab */
  onSelect: (id: string) => void;
  /** Callback triggered when user clicks '+' button to add a worksheet */
  onAdd: () => void;
  /** Callback triggered when user clicks close button on a worksheet */
  onClose: (id: string) => void;
  /** Callback triggered when user renames a worksheet tab */
  onRename: (id: string, newTitle: string) => void;
}
```

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

### SQL Formatter Engine (`src/utils/sqlFormatter.ts`)
- **`formatSql(sql: string): string`**:
  Beautifies and normalizes raw SQL statements. Converts keywords (`SELECT`, `FROM`, `WHERE`, `JOIN`, `ORDER BY`, `LIMIT`, etc.) to uppercase, breaks major clauses onto new lines, indents expressions by 2 spaces, and preserves quoted strings, comments, and dialect identifiers.
- **`MAJOR_CLAUSES: readonly string[]`**:
  List of recognized clause boundaries used to structure queries into readable multiline blocks.

### SQL Completion Utilities (`src/utils/sqlCompletion.ts`)
- **`formatCanonicalType(type: CanonicalType): string`**:
  Normalizes canonical data types to clean uppercase strings (e.g. `INTEGER`, `VARCHAR(255)`, `DECIMAL(10, 2)`).
- **`detectCompletionContext(lineTextBeforeCursor: string): CompletionContextResult`**:
  Analyzes cursor context to return `dot_column`, `from_table`, or `general` mode.
- **`getTableCompletions(tables: TableSchema[], range?: any, kind?: number, sortPrefix?: string): SqlCompletionItem[]`**:
  Builds Monaco completions for all schema tables with column count details and Markdown documentation.
- **`getColumnCompletions(tables: TableSchema[], targetTable?: string, range?: any, kind?: number): SqlCompletionItem[]`**:
  Generates column completions; when `targetTable` is supplied, filters strictly to that table and prioritizes Primary Keys.
- **`buildSqlCompletions(lineContent: string, schema: DatabaseSchema | null, wordRange: any, monaco: any): SqlCompletionItem[]`**:
  Orchestrates context-aware suggestion assembly for Monaco Editor.

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

### Formatting SQL Queries
```typescript
import { formatSql } from './utils/sqlFormatter';

const messySql = 'select id,name from users where active=1 and role in (select id from roles) order by id desc';
const cleanSql = formatSql(messySql);
/*
SELECT
  id,
  name
FROM
  users
WHERE
  active = 1
  AND role IN (
    SELECT
      id
    FROM
      roles
  )
ORDER BY
  id DESC;
*/
```

### Standalone Query Worksheet Tab Bar
```tsx
import React, { useState } from 'react';
import { QueryWorksheetBar, QueryWorksheet } from './components/query/QueryWorksheetBar';

export const MyTabs: React.FC = () => {
  const [tabs, setTabs] = useState<QueryWorksheet[]>([
    {
      id: 'ws-1',
      title: 'Query 1',
      query: 'SELECT * FROM users;',
      result: null,
      safeLimit: 500,
      safeLimitNotice: null,
      pageIndex: 0,
      pageSize: 50,
      totalRows: null,
      error: null,
      explainPlan: null,
    },
  ]);
  const [activeId, setActiveId] = useState('ws-1');

  return (
    <QueryWorksheetBar
      worksheets={tabs}
      activeId={activeId}
      onSelect={(id) => setActiveId(id)}
      onAdd={() => {
        const id = `ws-${Date.now()}`;
        setTabs([...tabs, { id, title: `Query ${tabs.length + 1}`, query: '', result: null, safeLimit: 500, safeLimitNotice: null, pageIndex: 0, pageSize: 50, totalRows: null, error: null, explainPlan: null }]);
        setActiveId(id);
      }}
      onClose={(id) => {
        if (tabs.length <= 1) return;
        setTabs(tabs.filter((t) => t.id !== id));
      }}
      onRename={(id, newTitle) => {
        setTabs(tabs.map((t) => t.id === id ? { ...t, title: newTitle } : t));
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
- **Autocomplete on Disconnected State**: If no database is connected (`schema === null`), the completion engine gracefully provides standard SQL keywords and aggregate functions without error.
- **Unsaved Dirty Cell Edits on Tab Switch**: If cells were edited in the active worksheet grid without committing mutations, attempting to switch to another worksheet or open a new one triggers a confirmation dialog to guard against accidental data loss.
- **Single Tab Close Guard**: The last remaining query worksheet tab cannot be closed; the close button is hidden to ensure a valid query editing canvas is always available.
- **Run Selection with Partial SQL**: When text is selected in Monaco Editor, `Run Selection` executes only the selected snippet. If the selection is an incomplete statement (e.g., missing `FROM` clause), the database driver will return a parse error diagnostic directly in the error banner.
- **Formatter Handling of String Literals and Comments**: The SQL formatter never modifies keywords or line breaks inside single-quoted strings, double-quoted identifiers, or comment blocks (`--` or `/* */`).
