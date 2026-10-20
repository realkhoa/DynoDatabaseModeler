# Multi-Tab Query Worksheets, Run Selection & SQL Formatter Design Specification

## 1. Overview & Goals

Professional SQL clients like DataGrip, DBeaver, and TablePlus excel at multi-tasking and daily productivity through three cornerstone developer features:
1. **Multi-Tab Query Worksheets**: Allows engineers to maintain multiple independent query tabs (`+ New Query`), rename tabs (e.g. `Query 1`, `User Report`, `users`), switch between queries without losing work, and open dedicated view tabs when clicking tables from ERD Canvas or Sidebar.
2. **Execution of Highlighted Query (Run Selection)**: Allows executing only the highlighted block of SQL when text is selected in Monaco Editor, dynamically switching toolbar labels and shortcuts to `Run Selection (Ctrl+Enter)`.
3. **SQL Beautifier / Formatter (`Format SQL`)**: Automatically prettifies, indents clauses, and capitalizes ANSI SQL keywords while preserving comments and string literals, integrated via a toolbar button and Monaco's native document formatting provider (`Shift+Alt+F`).

---

## 2. Architecture & Component Boundaries

```
┌────────────────────────────────────────────────────────────────────────┐
│ App.tsx                                                                │
│ - Holds active ConnectionConfig and DatabaseSchema                     │
│ - Orchestrates onViewTableData(tableKey) -> forwards to QueryEditorTab │
└───────────────────────────────────┬────────────────────────────────────┘
                                    │
                                    ▼
┌────────────────────────────────────────────────────────────────────────┐
│ QueryEditorTab.tsx                                                     │
│ - State: `worksheets: QueryWorksheet[]`, `activeWorksheetId: string`   │
│ - Child: `QueryWorksheetBar` (tabs, add tab, close tab, rename tab)    │
│ - Top Toolbar: [Run Query / Selection] [Explain] [Format SQL] [...]    │
│ - Monaco Editor (bound to activeWorksheet.query)                       │
│ - EditableDataGrid (bound to activeWorksheet.result & pagination)      │
└─────────────┬───────────────────────────────────────────┬──────────────┘
              │                                           │
              ▼                                           ▼
┌──────────────────────────────┐        ┌────────────────────────────────┐
│ src/utils/sqlFormatter.ts    │        │ src/utils/sqlCompletion.ts     │
│ - formatSql(sql, options)    │        │ - Schema autocomplete (Task 1) │
└──────────────────────────────┘        └────────────────────────────────┘
```

### Module Responsibilities:
1. **`src/utils/sqlFormatter.ts` (Pure Business Logic)**:
   - Zero-dependency functional SQL formatter.
   - Capitalizes SQL keywords (`SELECT`, `FROM`, `WHERE`, `JOIN`, `ORDER BY`, etc.).
   - Breaks lines on major clauses and applies 2-space indentation.
   - Preserves string literals (`'...'`), quoted identifiers (`"..."`, \`...\`, `[...]`), and comments (`--`, `/* */`).
2. **`src/components/query/QueryWorksheetBar.tsx` (Component)**:
   - Renders scrollable tab pills for active worksheets.
   - Shows active tab highlight, close button `✕` (when tabs > 1), and `+` button.
   - Double-click inline editing to rename tabs.
   - Prompts confirmation if current tab has unsaved grid edits before switching.
3. **`src/components/query/QueryEditorTab.tsx`**:
   - Manages worksheet list and active tab state.
   - Tracks text selection in Monaco Editor via `onDidChangeCursorSelection`.
   - Executes selection if active, or full buffer if empty.
   - Registers Monaco DocumentFormattingEditProvider.
   - Handles `onViewTableData(tableKey)` by opening or focusing a dedicated table tab.

---

## 3. Data Models

```typescript
export interface QueryWorksheet {
  /** Unique worksheet identifier (e.g. 'ws-1') */
  id: string;
  /** Display title on tab bar (e.g. 'Query 1', 'users') */
  title: string;
  /** Current SQL query buffer text */
  query: string;
  /** Most recent query result or null */
  result: QueryResult | null;
  /** Tab-specific Safe Limit (100, 500, 1000, 0=Off) */
  safeLimit: number;
  /** Safe limit notice badge */
  safeLimitNotice: string | null;
  /** Pagination state for the results grid */
  pageIndex: number;
  pageSize: number;
  totalRows: number | null;
  /** Execution error banner string */
  error: string | null;
  /** Execution plan result if analyzed */
  explainPlan: ExplainPlanResult | null;
}
```

---

## 4. Run Selection Mechanics

1. In `QueryEditorTab`:
   - Keep `editorRef` pointing to the mounted Monaco editor instance.
   - In `handleEditorDidMount`:
     - Register `editor.onDidChangeCursorSelection(() => { ... })` to update `hasSelection` state.
   - In `handleRun`:
     - Inspect `editor.getSelection()`.
     - If selection exists and is not collapsed (`!selection.isEmpty()`):
       - Extract `selectedText = editor.getModel().getValueInRange(selection).trim()`.
       - If `selectedText.length > 0`, execute `selectedText`.
     - Otherwise, execute full `query.trim()`.
2. Visual Indicator:
   - When `hasSelection === true`:
     - Toolbar Run button text: `Run Selection (Ctrl+Enter)`
     - Tooltip: `Execute highlighted SQL query`
   - When `hasSelection === false`:
     - Toolbar Run button text: `Run Query (Ctrl+Enter)`

---

## 5. SQL Formatter Engine (`src/utils/sqlFormatter.ts`)

### Formatting Specification:
- **Major Clauses**: Each starts on a new line:
  `SELECT`, `FROM`, `WHERE`, `GROUP BY`, `HAVING`, `ORDER BY`, `LIMIT`, `OFFSET`,
  `JOIN`, `INNER JOIN`, `LEFT JOIN`, `RIGHT JOIN`, `FULL JOIN`, `CROSS JOIN`,
  `INSERT INTO`, `VALUES`, `UPDATE`, `SET`, `DELETE FROM`, `UNION`, `UNION ALL`.
- **Indentation**:
  - Clause bodies (e.g. columns under `SELECT`, conditions under `WHERE`, updates under `SET`) indented by 2 spaces.
  - Commas in column lists placed at the end of the line followed by a newline and indent.
- **Tokens Preserved**:
  - String literals `'...'` including escaped quotes `''` preserved exactly as written.
  - Quoted identifiers `"..."`, \`...\`, `[...]` preserved exactly.
  - Single-line comments (`-- ...`) and block comments (`/* ... */`) preserved on their own lines.

---

## 6. Error Handling & Edge Cases

1. **Closing Tabs**:
   - At least 1 tab must always remain open. If user closes the only tab, automatically spawn a blank `Query 1` tab.
2. **Unsaved Grid Edits**:
   - When switching tabs, if `dirtyCount > 0` on the active grid, confirm with user before switching.
3. **Empty or Malformed SQL on Format**:
   - `formatSql('')` returns empty string.
   - Malformed SQL formatted gracefully without throwing exceptions or corrupting text.

---

## 7. Testing Strategy

1. **Unit Tests (`src/utils/sqlFormatter.test.ts`)**:
   - Uppercases keywords in simple and complex queries.
   - Formats clauses with newlines and 2-space indentation.
   - Preserves string literals with spaces and SQL keywords inside quotes.
   - Preserves comments (`--` and `/* */`).
2. **Component Tests (`src/components/query/QueryWorksheetBar.test.tsx`)**:
   - Renders tab pills, switches active tab, adds new tab `+`, closes tab `✕`.
   - Renames tab on double-click inline input.
3. **Integration Tests (`src/components/query/QueryEditorTab.test.tsx`)**:
   - Verifies Run Selection vs Run Full Query execution.
   - Verifies Format SQL button formats Monaco editor model.
   - Verifies viewing table data from Canvas/Sidebar opens a dedicated worksheet tab.
4. **Full Regression Suite**:
   - Ensure all 266+ existing tests continue to pass.
