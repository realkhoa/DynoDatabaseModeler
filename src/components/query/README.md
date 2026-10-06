# SQL Query Editor, Tabular Results & Data Transfer Wizard (`src/components/query`)

## 1. Overview & Purpose
The `src/components/query` module provides an interactive SQL query workspace and comprehensive data transfer toolkit within **DynoDbModeler**. Styled in a modern minimalist dark aesthetic, it features:
- An embedded **Monaco Editor** with SQL syntax highlighting, line numbers, automatic layout, and `vs-dark` theme.
- Convenient keyboard shortcuts (`Ctrl+Enter` / `Cmd+Enter`) to trigger rapid query execution directly from the editor without switching focus.
- Top toolbar controls with execution indicators, spinner states, active database target badges, and precise query execution telemetry (rows returned and duration in milliseconds).
- **Interactive Multi-Format Data Transfer Wizard (`ExportModal`)**: Inspired by DBeaver's data export stream engine, allows exporting tabular query results to CSV, JSON, Markdown tables, and SQL INSERT statements, complete with live preview, formatting options, copy-to-clipboard, and direct file download.
- **Deep Value Inspector Drawer (`ValueInspectorDrawer`)**: Slide-out drawer for inspecting cell contents with syntax highlighting (JSON/XML/Text/Image), edit application, and comprehensive telemetry metrics (characters, words, lines, byte size).
- A clean, modern tabular results grid (`EditableDataGrid`) featuring inline cell editing, dirty-cell tracking, staging mutations bar, sticky headers, and smart data cell formatters for `NULL`, boolean flags, numbers, strings, and JSON objects/arrays.
- Prominent error banners displaying actionable dialect error diagnostics whenever execution fails.

---

## 2. Prerequisites & Dependencies
- **React 19 / TypeScript 5.7+**: Frontend component architecture and strict typing.
- **`@monaco-editor/react`**: Web-standard Monaco code editor runtime.
- **`lucide-react`**: Clean minimalist icons (`Play`, `Loader2`, `AlertCircle`, `FileCode`, `Download`, `Eye`, `Copy`, `Check`, `FileSpreadsheet`, `FileJson`, `Database`).
- **`src/types/database.ts`**: Core `QueryResult` and `ConnectionConfig` models.
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

### Data Transfer Utilities (`src/utils/dataTransfer.ts`)
- **`exportAsCsv(columns: string[], rows: any[][], options?: CsvExportOptions): string`**:
  Generates RFC 4180 compliant CSV output. Supports comma, semicolon, or tab delimiters, handles quotes, newlines, and provides a `quoteAll` option.
- **`exportAsJson(columns: string[], rows: any[][], pretty?: boolean): string`**:
  Serializes rows into an array of objects keyed by column names, with optional 2-space indentation.
- **`exportAsMarkdown(columns: string[], rows: any[][]): string`**:
  Generates GitHub-flavored Markdown tables with escaped pipe characters and preserved line breaks.
- **`exportAsSqlInserts(columns: string[], rows: any[][], options: SqlExportOptions): string`**:
  Generates dialect-safe SQL INSERT statements with escaped string literals, boolean keywords, and numeric formatting.
- **`downloadExportFile(content: string, filename: string, mimeType: string): void`**:
  Triggers a client-side browser file download using temporary `Blob` and anchor elements.

---

## 4. Usage Examples

### Launching Export Wizard from Results Toolbar
```tsx
import React, { useState } from 'react';
import { ExportModal } from './components/query/ExportModal';

export const ResultsViewer: React.FC<{ columns: string[]; rows: any[][] }> = ({
  columns,
  rows,
}) => {
  const [isExportOpen, setIsExportOpen] = useState(false);

  return (
    <div>
      <button onClick={() => setIsExportOpen(true)}>Export Data</button>
      <ExportModal
        isOpen={isExportOpen}
        tableName="customers"
        columns={columns}
        rows={rows}
        onClose={() => setIsExportOpen(false)}
      />
    </div>
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

Export formats produce the following structure:
- **CSV**: Comma/Semicolon/Tab-separated values with RFC 4180 quotes for delimiters, quotes (`""`), and multiline strings.
- **JSON**: Valid JSON array of row objects `[{ "col1": "val1" }, ...]`.
- **Markdown**: GFM table `| col1 | col2 |\n| --- | --- |\n| val1 | val2 |`.
- **SQL INSERT**: `INSERT INTO table_name (col1, col2) VALUES ('val1', 123);`.

---

## 6. Troubleshooting & Edge Cases
- **No Active Connection**: Running queries without an active connection will return backend error diagnostics; the toolbar displays a helper hint recommending connection to a target database.
- **Large Result Sets in Export**: The modal preview displays up to the first 50 rows for optimal UI responsiveness, while the "Download File" and "Copy to Clipboard" operations always operate on the entire dataset.
- **Cell Value Escaping**: Markdown export escapes internal `|` characters as `\|` and newline characters as `<br/>` to avoid breaking table layout. SQL INSERT statements double single quotes (`''`) to ensure valid literal syntax.
