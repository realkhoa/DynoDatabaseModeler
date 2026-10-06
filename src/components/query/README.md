# SQL Query Editor & Tabular Results Console (`src/components/query`)

## 1. Overview & Purpose
The `src/components/query` module provides an interactive SQL query workspace within **DynoDbModeler**. Styled in a modern minimalist dark aesthetic, it features:
- An embedded **Monaco Editor** with SQL syntax highlighting, line numbers, automatic layout, and `vs-dark` theme.
- Convenient keyboard shortcuts (`Ctrl+Enter` / `Cmd+Enter`) to trigger rapid query execution directly from the editor without switching focus.
- Top toolbar controls with execution indicators, spinner states, active database target badges, and precise query execution telemetry (rows returned and duration in milliseconds).
- A clean, modern tabular results grid featuring a sticky column header row, alternating row hover highlights, and smart data cell formatters for `NULL`, boolean flags, numbers, strings, and JSON objects/arrays.
- Prominent error banners displaying actionable dialect error diagnostics whenever execution fails.

---

## 2. Prerequisites & Dependencies
- **React 19 / TypeScript 5.7+**: Frontend component architecture and strict typing.
- **`@monaco-editor/react`**: Web-standard Monaco code editor runtime.
- **`lucide-react`**: Clean minimalist icons (`Play`, `Loader2`, `AlertCircle`, `FileCode`).
- **`src/types/database.ts`**: Core `QueryResult` and `ConnectionConfig` models.
- **Tauri IPC (`src/api/ipc.ts`)**: Invokes backend query execution (`cmd_execute_query`).

---

## 3. Component Props & API Reference

### `QueryEditorTabProps`
| Property | Type | Required | Description |
| :--- | :--- | :---: | :--- |
| `activeConnection` | `ConnectionConfig \| null` | No | Currently active database session profile displayed in the target badge. |
| `initialQuery` | `string` | No | Initial SQL statement loaded into the editor buffer (defaults to sample query). |
| `onQuerySuccess` | `(result: QueryResult) => void` | No | Optional callback invoked upon successful query completion. |

### Helper Functions
- **`formatCellValue(val: unknown): React.ReactNode`**: Formats raw column data into styled React nodes (`NULL` in italic gray, JSON in formatted code, numbers in emerald green, booleans in blue).

---

## 4. Usage Examples

### Integration within React Workspace Tab
```tsx
import React from 'react';
import { QueryEditorTab } from './components/query/QueryEditorTab';
import type { ConnectionConfig } from './types/database';

export const WorkspaceView: React.FC<{ activeConnection: ConnectionConfig | null }> = ({
  activeConnection,
}) => {
  return (
    <div className="h-full w-full flex flex-col">
      <QueryEditorTab
        activeConnection={activeConnection}
        initialQuery="SELECT id, name, created_at FROM users LIMIT 50;"
        onQuerySuccess={(result) => {
          console.log(`Query finished: ${result.rows.length} rows in ${result.execution_time_ms}ms`);
        }}
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

Cell rendering adheres to the following visual tokens:
- **`NULL`**: `#8c919a` italic text.
- **`boolean`**: `#3a82f7` monospace text.
- **`number`**: `#20c997` monospace text.
- **`object / json`**: `#e6e8ea` stringified monospace JSON text.
- **`string`**: `#e6e8ea` truncated with ellipsis if exceeding column width.

---

## 6. Troubleshooting & Edge Cases
- **No Active Connection**: Running queries without an active connection will return backend error diagnostics; the toolbar displays a helper hint recommending connection to a target database.
- **Keyboard Shortcut Handling**: `Ctrl+Enter` and `Cmd+Enter` shortcuts are bound both via Monaco's `addCommand` API and via an outer container `onKeyDown` fallback for cross-platform reliability.
- **Large Result Sets**: Result tables use horizontal and vertical scrolling with sticky header positioning (`sticky top-0 bg-[#24262b] z-10`), ensuring column headers remain pinned during deep scrolling.
