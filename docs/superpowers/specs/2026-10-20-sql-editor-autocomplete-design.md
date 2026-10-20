# SQL Editor Syntax, Table & Column Autocompletion Design Specification

## 1. Overview & Goals

DynoDbModeler includes an interactive SQL Query Editor powered by Monaco Editor (`@monaco-editor/react`). Currently, the SQL editor lacks schema-aware autocomplete, requiring users to manually memorize and type out table names, column names, and SQL syntax.

This feature introduces an intelligent, context-sensitive SQL completion engine that provides:
1. Standard SQL Keywords (`SELECT`, `WHERE`, `ORDER BY`, `GROUP BY`, `JOIN`, `LIMIT`, etc.).
2. Standard SQL Aggregate and Scalar Functions (`COUNT`, `SUM`, `AVG`, `COALESCE`, `NOW`, etc.).
3. Schema-Aware Table Suggestions (displaying table column counts and schema documentation).
4. Schema-Aware Column Suggestions (with canonical data types, primary key indicators, and nullability flags).
5. Dot-Triggered Table Column Filtering: when the user types `<table_name>.`, the completion provider detects the table name and restricts completions strictly to columns belonging to that table.
6. Contextual Priority Boosting: after table clauses (`FROM`, `JOIN`, `INTO`, `UPDATE`), table completions are prioritized at the top of the completion list.
7. Clean lifecycle management ensuring zero duplicate completions and zero memory leaks upon tab switching or unmounting.

---

## 2. Architecture & Module Responsibilities

```
┌─────────────────────────────────────────────────────────────┐
│ App.tsx                                                     │
│ - Holds active DatabaseSchema                               │
│ - Passes `schema={schema}` to QueryEditorTab                │
└──────────────────────────────┬──────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────┐
│ QueryEditorTab.tsx                                          │
│ - Keeps mutable `schemaRef` synchronized                    │
│ - Registers Monaco completion provider on mount             │
│ - Cleans up (disposes) provider on unmount                  │
└──────────────────────────────┬──────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────┐
│ src/utils/sqlCompletion.ts (Pure Functional Engine)         │
│ - detectCompletionContext(prefix)                           │
│ - formatCanonicalType(dataType)                             │
│ - getStandardKeywords()                                     │
│ - getStandardFunctions()                                    │
│ - getTableCompletions(tables)                               │
│ - getColumnCompletions(tables, targetTable?)                │
│ - buildSqlCompletions(prefix, schema, wordRange, monaco)    │
└─────────────────────────────────────────────────────────────┘
```

### Module Responsibilities:
1. **`src/utils/sqlCompletion.ts` (Pure Business Logic)**:
   - Framework-independent pure TypeScript utility functions.
   - Fully unit testable without requiring DOM or browser rendering.
   - Formats Monaco-compatible completion items (`label`, `kind`, `detail`, `documentation`, `insertText`, `sortText`, `range`).
2. **`src/components/query/QueryEditorTab.tsx`**:
   - Accepts `schema?: DatabaseSchema | null` in `QueryEditorTabProps`.
   - Maintains `schemaRef = useRef(schema)` to supply the most up-to-date table/column schema to Monaco completion queries without re-registering the provider on every schema mutation.
   - Registers `monaco.languages.registerCompletionItemProvider('sql', ...)` on editor mount with trigger characters `['.', ' ']`.
   - Stores the registration in `completionProviderRef` and invokes `.dispose()` in `useEffect` cleanup.
3. **`src/App.tsx`**:
   - Forwards current `schema` state to `<QueryEditorTab schema={schema} ... />`.

---

## 3. Completion Context Detection & Rules

### 3.1 Context Classification
`detectCompletionContext(lineTextBeforeCursor: string)` inspects the current line text up to the cursor:

| Context | Trigger & Pattern | Suggestions Returned | Sort Priority (`sortText`) |
| :--- | :--- | :--- | :--- |
| **`dot_column`** | Trailing pattern matches `(?:([a-zA-Z0-9_`"\[\]]+)\.)([a-zA-Z0-9_]*)$` | Only columns belonging to the matched table. If table not found in schema, falls back to all columns. | Primary keys (`00_<col>`), Other columns (`01_<col>`). |
| **`from_table`** | Trailing pattern matches `\b(?:FROM\|JOIN\|LEFT\s+JOIN\|RIGHT\s+JOIN\|INNER\s+JOIN\|FULL\s+JOIN\|CROSS\s+JOIN\|INTO\|UPDATE\|TABLE)\s+([a-zA-Z0-9_]*)$` (case-insensitive) | All tables in the database schema prioritized at the top. SQL keywords and columns available at lower priority. | Tables (`0_<tbl>`), Keywords (`1_<kw>`), Columns (`2_<col>`). |
| **`general`** | Any other cursor location (e.g., after `SELECT`, `WHERE`, line start) | Full palette of SQL Keywords, Standard Functions, Tables, and Columns. | Keywords & Functions (`0_<name>`), Tables (`1_<name>`), Columns (`2_<name>`). |

### 3.2 Identifier Stripping
When extracting the table name before a dot (e.g. `[users].`, `"users".`, \`users\`.), enclosing quotes, brackets, and backticks are stripped. Table matching against `table.name` is performed case-insensitively.

---

## 4. Visual Completion Item Formatting

Monaco completion items will be rich and clearly differentiated by icon kind:

1. **Tables**:
   - `kind`: `monaco.languages.CompletionItemKind.Class`
   - `label`: `table.name`
   - `detail`: `table (${table.columns.length} columns)`
   - `documentation`: Markdown containing schema/table name and a markdown table of columns:
     ```markdown
     ### Table: users
     *Columns:*
     - **id**: `INTEGER` (PK)
     - **username**: `VARCHAR(255)`
     - **email**: `VARCHAR(255)`
     ```
2. **Columns**:
   - `kind`: `monaco.languages.CompletionItemKind.Field`
   - `label`: `column.name`
   - `detail`: `${formattedType}${is_primary_key ? ' • [PK]' : ''}${is_nullable ? ' • Nullable' : ''}`
   - `documentation`: Markdown indicating parent table and default expression if present:
     ```markdown
     **Column:** `users.email`
     **Type:** `VARCHAR(255)`
     **Nullable:** `YES`
     ```
3. **Keywords**:
   - `kind`: `monaco.languages.CompletionItemKind.Keyword`
   - `label`: SQL keyword in UPPERCASE (e.g. `SELECT`, `WHERE`, `ORDER BY`)
   - `detail`: `SQL Keyword`
4. **Functions**:
   - `kind`: `monaco.languages.CompletionItemKind.Function`
   - `label`: Function name (e.g. `COUNT`, `SUM`, `AVG`, `COALESCE`)
   - `detail`: `SQL Function`
   - `insertText`: Function with parameter placeholder (e.g. `COUNT($0)` or `COALESCE($1, $2)`)
   - `insertTextRules`: `monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet`

---

## 5. Type Formatting Helper

`formatCanonicalType(type: CanonicalType): string` normalizes DynoDbModeler's `CanonicalType` enum/objects into clean human-readable strings:
- `'Integer'` -> `'INTEGER'`
- `'BigInt'` -> `'BIGINT'`
- `'SmallInt'` -> `'SMALLINT'`
- `'Float'` / `'Double'` -> `'FLOAT'` / `'DOUBLE'`
- `'Boolean'` -> `'BOOLEAN'`
- `'Text'` -> `'TEXT'`
- `'Date'` / `'Time'` / `'Timestamp'` -> `'DATE'` / `'TIME'` / `'TIMESTAMP'`
- `'Json'` -> `'JSON'`
- `'Uuid'` -> `'UUID'`
- `'Binary'` -> `'BINARY'`
- `{ Varchar: length }` -> length ? `VARCHAR(${length})` : `'VARCHAR'`
- `{ Char: length }` -> length ? `CHAR(${length})` : `'CHAR'`
- `{ Decimal: { precision, scale } }` -> precision ? `DECIMAL(${precision}, ${scale ?? 0})` : `'DECIMAL'`
- `{ Custom: name }` -> `name.toUpperCase()`

---

## 6. Error Handling & Edge Cases

1. **Schema is null/empty**:
   - No database connected: returns standard SQL keywords and functions without error.
2. **Incomplete or malformed queries**:
   - Token regex scanning uses graceful fallback to `general` context if syntax does not match `dot_column` or `from_table`.
3. **Disposal on unmount**:
   - Switching tabs (`erd` <-> `sql`) or closing the app unmounts `QueryEditorTab`. The `useEffect` cleanup hook calls `completionProviderRef.current?.dispose()`, preventing duplicate provider registrations across re-renders.

---

## 7. Testing Strategy

1. **Unit Tests (`src/utils/sqlCompletion.test.ts`)**:
   - `formatCanonicalType`: verifies all canonical type variants.
   - `detectCompletionContext`:
     - Identifies `dot_column` for `users.`, `orders.col`, `"users".`, \`users\`..
     - Identifies `from_table` for `SELECT * FROM `, `FROM users JOIN `, `INSERT INTO `, `UPDATE `.
     - Identifies `general` for `SELECT `, `WHERE `, and blank lines.
   - `getTableCompletions`: produces valid table completion items with column count details and markdown docs.
   - `getColumnCompletions`:
     - When `targetTable` matches, returns only that table's columns.
     - Primary key columns receive priority sort keys (`00_`).
     - When `targetTable` does not match, returns all available columns across schema.
   - `buildSqlCompletions`: validates full suggestions array generation under various prefixes.
2. **Integration & Component Tests (`src/components/query/QueryEditorTab.test.tsx`)**:
   - Renders `QueryEditorTab` with `schema` prop.
   - Verifies Monaco editor mounts without throwing.
3. **Full Vitest Suite Regression**:
   - Execute all 25+ test suites (245+ tests) to guarantee 100% pass rate.
