# SQL Editor Autocomplete Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement context-sensitive, schema-aware SQL syntax, table, and column autocompletion for Monaco Editor in DynoDbModeler.

**Architecture:** Pure functional completion logic in `src/utils/sqlCompletion.ts` (keywords, functions, tables, columns, context detection for `dot_column`, `from_table`, and `general`), mounted via a single, cleanly disposed Monaco CompletionItemProvider in `QueryEditorTab.tsx` reading live schema from `App.tsx`.

**Tech Stack:** React 19, TypeScript, Monaco Editor (`@monaco-editor/react`, `monaco-editor`), Vitest, Testing Library.

## Global Constraints

- Mandatory English for all code, identifiers, comments, tests, and documentation.
- Mandatory 100% Doxygen / TSDoc coverage (`@brief`, `@param`, `@return`) for all exported and helper functions.
- Every task must strictly follow TDD (Red -> Green -> Refactor) and end with verified passing tests.
- Zero unresolved lint/type errors (`bun x tsc --noEmit`) and zero broken existing tests across the Vitest suite.
- Exact file paths used at all times.

---

### Task 1: Pure SQL Completion Utilities (`src/utils/sqlCompletion.ts`)

**Files:**
- Create: `src/utils/sqlCompletion.ts`
- Create: `src/utils/sqlCompletion.test.ts`

**Interfaces:**
- Consumes: `DatabaseSchema`, `TableSchema`, `ColumnSchema`, `CanonicalType` from `src/types/database.ts`
- Produces:
  - `formatCanonicalType(type: CanonicalType): string`
  - `detectCompletionContext(lineTextBeforeCursor: string): { context: 'dot_column' | 'from_table' | 'general'; tableName?: string }`
  - `getStandardKeywords(): string[]`
  - `getStandardFunctions(): string[]`
  - `getTableCompletions(tables: TableSchema[], range?: any): SqlCompletionItem[]`
  - `getColumnCompletions(tables: TableSchema[], targetTable?: string, range?: any): SqlCompletionItem[]`
  - `buildSqlCompletions(lineContent: string, schema: DatabaseSchema | null, wordRange: any, monaco: any): any[]`

- [ ] **Step 1: Write the failing test for `formatCanonicalType` and `detectCompletionContext`**

Create `src/utils/sqlCompletion.test.ts`:
```typescript
import { describe, it, expect } from 'vitest';
import {
  formatCanonicalType,
  detectCompletionContext,
  getStandardKeywords,
  getStandardFunctions,
  getTableCompletions,
  getColumnCompletions,
  buildSqlCompletions,
} from './sqlCompletion';
import type { DatabaseSchema, TableSchema } from '../types/database';

describe('sqlCompletion utilities', () => {
  describe('formatCanonicalType', () => {
    it('formats simple string canonical types', () => {
      expect(formatCanonicalType('Integer')).toBe('INTEGER');
      expect(formatCanonicalType('BigInt')).toBe('BIGINT');
      expect(formatCanonicalType('Text')).toBe('TEXT');
      expect(formatCanonicalType('Boolean')).toBe('BOOLEAN');
    });

    it('formats object canonical types with parameters', () => {
      expect(formatCanonicalType({ Varchar: 255 })).toBe('VARCHAR(255)');
      expect(formatCanonicalType({ Varchar: null })).toBe('VARCHAR');
      expect(formatCanonicalType({ Char: 10 })).toBe('CHAR(10)');
      expect(formatCanonicalType({ Decimal: { precision: 10, scale: 2 } })).toBe('DECIMAL(10, 2)');
      expect(formatCanonicalType({ Custom: 'citext' })).toBe('CITEXT');
    });
  });

  describe('detectCompletionContext', () => {
    it('detects dot_column context for table. prefix', () => {
      expect(detectCompletionContext('SELECT users.')).toEqual({
        context: 'dot_column',
        tableName: 'users',
      });
      expect(detectCompletionContext('SELECT u.')).toEqual({
        context: 'dot_column',
        tableName: 'u',
      });
      expect(detectCompletionContext('WHERE `orders`.')).toEqual({
        context: 'dot_column',
        tableName: 'orders',
      });
      expect(detectCompletionContext('WHERE "customers".id')).toEqual({
        context: 'dot_column',
        tableName: 'customers',
      });
      expect(detectCompletionContext('WHERE [dbo].[products].')).toEqual({
        context: 'dot_column',
        tableName: 'products',
      });
    });

    it('detects from_table context after table clauses', () => {
      expect(detectCompletionContext('SELECT * FROM ')).toEqual({
        context: 'from_table',
      });
      expect(detectCompletionContext('SELECT * FROM users JOIN ')).toEqual({
        context: 'from_table',
      });
      expect(detectCompletionContext('SELECT * FROM users LEFT JOIN ')).toEqual({
        context: 'from_table',
      });
      expect(detectCompletionContext('INSERT INTO ')).toEqual({
        context: 'from_table',
      });
      expect(detectCompletionContext('UPDATE ')).toEqual({
        context: 'from_table',
      });
    });

    it('detects general context for other positions', () => {
      expect(detectCompletionContext('SELECT ')).toEqual({
        context: 'general',
      });
      expect(detectCompletionContext('WHERE id > 10 AND ')).toEqual({
        context: 'general',
      });
      expect(detectCompletionContext('')).toEqual({
        context: 'general',
      });
    });
  });

  describe('table and column completions', () => {
    const mockSchema: DatabaseSchema = {
      tables: [
        {
          name: 'users',
          columns: [
            {
              name: 'id',
              data_type: 'Integer',
              is_primary_key: true,
              is_nullable: false,
              is_auto_increment: true,
            },
            {
              name: 'email',
              data_type: { Varchar: 255 },
              is_primary_key: false,
              is_nullable: false,
              is_auto_increment: false,
            },
          ],
          foreign_keys: [],
          indexes: [],
        },
        {
          name: 'orders',
          columns: [
            {
              name: 'order_id',
              data_type: 'BigInt',
              is_primary_key: true,
              is_nullable: false,
              is_auto_increment: true,
            },
            {
              name: 'user_id',
              data_type: 'Integer',
              is_primary_key: false,
              is_nullable: false,
              is_auto_increment: false,
            },
          ],
          foreign_keys: [],
          indexes: [],
        },
      ],
    };

    it('generates table completions with column details and markdown docs', () => {
      const items = getTableCompletions(mockSchema.tables);
      expect(items).toHaveLength(2);
      expect(items[0].label).toBe('users');
      expect(items[0].detail).toContain('2 columns');
      expect(items[0].documentation).toContain('id: `INTEGER` [PK]');
      expect(items[0].documentation).toContain('email: `VARCHAR(255)`');
    });

    it('filters columns strictly to target table in dot_column context', () => {
      const userCols = getColumnCompletions(mockSchema.tables, 'users');
      expect(userCols).toHaveLength(2);
      expect(userCols.map((c) => c.label)).toEqual(['id', 'email']);
      expect(userCols[0].detail).toContain('[PK]');
      expect(userCols[0].sortText).toBe('00_id'); // PK sorted first
    });

    it('falls back to all columns when target table is unknown', () => {
      const allCols = getColumnCompletions(mockSchema.tables, 'nonexistent');
      expect(allCols).toHaveLength(4);
    });

    it('builds full completions list with keywords, functions, tables, and columns', () => {
      const mockMonaco = {
        languages: {
          CompletionItemKind: {
            Keyword: 13,
            Function: 2,
            Class: 6,
            Field: 4,
          },
          CompletionItemInsertTextRule: {
            InsertAsSnippet: 4,
          },
        },
      };

      const range = { startLineNumber: 1, startColumn: 1, endLineNumber: 1, endColumn: 5 };
      const suggestions = buildSqlCompletions('SELECT * FROM ', mockSchema, range, mockMonaco);
      expect(suggestions.length).toBeGreaterThan(10);

      // In from_table context, tables should have top sortText priority '0_'
      const tableItem = suggestions.find((s) => s.label === 'users');
      expect(tableItem).toBeDefined();
      expect(tableItem?.sortText.startsWith('0_')).toBe(true);
    });

    it('handles null schema gracefully in buildSqlCompletions', () => {
      const mockMonaco = {
        languages: {
          CompletionItemKind: { Keyword: 13, Function: 2, Class: 6, Field: 4 },
          CompletionItemInsertTextRule: { InsertAsSnippet: 4 },
        },
      };
      const range = { startLineNumber: 1, startColumn: 1, endLineNumber: 1, endColumn: 1 };
      const suggestions = buildSqlCompletions('SELECT ', null, range, mockMonaco);
      expect(suggestions.length).toBeGreaterThan(0);
      expect(suggestions.some((s) => s.label === 'SELECT')).toBe(true);
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test src/utils/sqlCompletion.test.ts`
Expected: FAIL ("Cannot find module './sqlCompletion'")

- [ ] **Step 3: Implement `src/utils/sqlCompletion.ts`**

Write implementation with full Doxygen / TSDoc comments:
```typescript
/**
 * @file sqlCompletion.ts
 * @brief Schema-aware SQL syntax, table, and column autocompletion engine for Monaco Editor.
 * @details Provides context-sensitive completions (keywords, functions, tables, and columns),
 * dot-triggered table column filtering, and clause-aware priority sorting.
 */

import type { CanonicalType, DatabaseSchema, TableSchema } from '../types/database';

/**
 * @brief Lightweight representation of a Monaco completion item.
 */
export interface SqlCompletionItem {
  /** @brief Label displayed in completion popup list. */
  label: string;
  /** @brief Monaco CompletionItemKind identifier number. */
  kind: number;
  /** @brief Subtitle / type indicator shown beside the label. */
  detail: string;
  /** @brief Markdown formatted documentation panel content. */
  documentation?: string | { value: string };
  /** @brief Actual text inserted into document upon acceptance. */
  insertText: string;
  /** @brief Insertion rules (e.g. snippet placeholders). */
  insertTextRules?: number;
  /** @brief Deterministic sort key used to prioritize suggestions. */
  sortText: string;
  /** @brief Text range in editor to replace upon insertion. */
  range?: any;
}

/**
 * @brief Normalizes a DynoDbModeler canonical data type into a clean uppercase string.
 * @param type Database column data type definition.
 * @return Formatted data type string (e.g. 'INTEGER', 'VARCHAR(255)').
 */
export function formatCanonicalType(type: CanonicalType): string {
  if (typeof type === 'string') {
    return type.toUpperCase();
  }
  if ('Varchar' in type) {
    return type.Varchar !== null && type.Varchar !== undefined
      ? `VARCHAR(${type.Varchar})`
      : 'VARCHAR';
  }
  if ('Char' in type) {
    return type.Char !== null && type.Char !== undefined
      ? `CHAR(${type.Char})`
      : 'CHAR';
  }
  if ('Decimal' in type) {
    const { precision, scale } = type.Decimal;
    return precision !== null && precision !== undefined
      ? `DECIMAL(${precision}, ${scale ?? 0})`
      : 'DECIMAL';
  }
  if ('Custom' in type) {
    return type.Custom.toUpperCase();
  }
  return 'UNKNOWN';
}

/**
 * @brief Standard ANSI SQL keywords supported across relational databases.
 */
export const STANDARD_SQL_KEYWORDS: readonly string[] = [
  'SELECT',
  'FROM',
  'WHERE',
  'AND',
  'OR',
  'NOT',
  'IN',
  'IS NULL',
  'IS NOT NULL',
  'JOIN',
  'INNER JOIN',
  'LEFT JOIN',
  'RIGHT JOIN',
  'FULL JOIN',
  'CROSS JOIN',
  'ON',
  'GROUP BY',
  'HAVING',
  'ORDER BY',
  'ASC',
  'DESC',
  'LIMIT',
  'OFFSET',
  'INSERT INTO',
  'VALUES',
  'UPDATE',
  'SET',
  'DELETE FROM',
  'CREATE TABLE',
  'ALTER TABLE',
  'DROP TABLE',
  'AS',
  'DISTINCT',
  'UNION',
  'UNION ALL',
  'CASE',
  'WHEN',
  'THEN',
  'ELSE',
  'END',
  'EXISTS',
  'BETWEEN',
  'LIKE',
  'ILIKE',
];

/**
 * @brief Standard SQL aggregate and scalar functions.
 */
export const STANDARD_SQL_FUNCTIONS: readonly { name: string; snippet: string; detail: string }[] = [
  { name: 'COUNT', snippet: 'COUNT(${1:*})', detail: 'COUNT(expr) - Counts rows or values' },
  { name: 'SUM', snippet: 'SUM(${1:column})', detail: 'SUM(expr) - Calculates total sum' },
  { name: 'AVG', snippet: 'AVG(${1:column})', detail: 'AVG(expr) - Computes average value' },
  { name: 'MIN', snippet: 'MIN(${1:column})', detail: 'MIN(expr) - Finds minimum value' },
  { name: 'MAX', snippet: 'MAX(${1:column})', detail: 'MAX(expr) - Finds maximum value' },
  { name: 'COALESCE', snippet: 'COALESCE(${1:expr1}, ${2:expr2})', detail: 'COALESCE(val, ...) - Returns first non-null' },
  { name: 'CONCAT', snippet: 'CONCAT(${1:str1}, ${2:str2})', detail: 'CONCAT(s1, s2) - Concatenates strings' },
  { name: 'NOW', snippet: 'NOW()', detail: 'NOW() - Current date and time' },
  { name: 'ROUND', snippet: 'ROUND(${1:val}, ${2:2})', detail: 'ROUND(n, decimals) - Rounds number' },
  { name: 'LOWER', snippet: 'LOWER(${1:str})', detail: 'LOWER(s) - Converts to lowercase' },
  { name: 'UPPER', snippet: 'UPPER(${1:str})', detail: 'UPPER(s) - Converts to uppercase' },
  { name: 'LENGTH', snippet: 'LENGTH(${1:str})', detail: 'LENGTH(s) - Returns string length' },
  { name: 'TRIM', snippet: 'TRIM(${1:str})', detail: 'TRIM(s) - Strips leading/trailing spaces' },
  { name: 'CAST', snippet: 'CAST(${1:expr} AS ${2:TYPE})', detail: 'CAST(expr AS type) - Converts data type' },
];

/**
 * @brief Returns a clone of standard SQL keywords.
 * @return Array of SQL keyword strings.
 */
export function getStandardKeywords(): string[] {
  return [...STANDARD_SQL_KEYWORDS];
}

/**
 * @brief Returns a list of standard SQL function names.
 * @return Array of function name strings.
 */
export function getStandardFunctions(): string[] {
  return STANDARD_SQL_FUNCTIONS.map((f) => f.name);
}

/**
 * @brief Context classification for cursor position in SQL text.
 */
export interface CompletionContextResult {
  /** @brief Detected syntactic completion mode. */
  context: 'dot_column' | 'from_table' | 'general';
  /** @brief Extracted target table name if in dot_column context. */
  tableName?: string;
}

/**
 * @brief Analyzes line content up to the cursor to determine the completion context.
 * @param lineTextBeforeCursor Line substring from beginning of line to cursor position.
 * @return CompletionContextResult indicating context and optional target table name.
 */
export function detectCompletionContext(lineTextBeforeCursor: string): CompletionContextResult {
  // Check for dot-triggered column access: e.g. "users.", "orders.id", `[dbo].[users].`, "users".
  const dotMatch = lineTextBeforeCursor.match(/(?:[a-zA-Z0-9_`"\[\]]+\.)*([a-zA-Z0-9_`"\[\]]+)\.([a-zA-Z0-9_]*)$/);
  if (dotMatch && dotMatch[1]) {
    const rawTableName = dotMatch[1].replace(/[`"\[\]]/g, '');
    return {
      context: 'dot_column',
      tableName: rawTableName,
    };
  }

  // Check for table reference clauses: FROM, JOIN, INTO, UPDATE, TABLE
  const fromTableRegex = /\b(?:FROM|JOIN|LEFT\s+JOIN|RIGHT\s+JOIN|INNER\s+JOIN|FULL\s+JOIN|CROSS\s+JOIN|INTO|UPDATE|TABLE)\s+([a-zA-Z0-9_]*)$/i;
  if (fromTableRegex.test(lineTextBeforeCursor)) {
    return {
      context: 'from_table',
    };
  }

  return {
    context: 'general',
  };
}

/**
 * @brief Constructs Monaco completion items for all database tables in the schema.
 * @param tables Collection of table definitions from active schema.
 * @param range Editor replacement range.
 * @param kind Monaco CompletionItemKind for classes/tables (default 6).
 * @param sortPrefix Priority prefix for sorting (default '1_').
 * @return Array of formatted SqlCompletionItem objects.
 */
export function getTableCompletions(
  tables: TableSchema[],
  range?: any,
  kind = 6,
  sortPrefix = '1_'
): SqlCompletionItem[] {
  return tables.map((t) => {
    const colList = t.columns
      .map(
        (c) =>
          `- **${c.name}**: \`${formatCanonicalType(c.data_type)}\`${c.is_primary_key ? ' [PK]' : ''}${c.is_nullable ? ' (Nullable)' : ''}`
      )
      .join('\n');

    const documentation = `### Table: **${t.name}**\n\n*Columns (${t.columns.length}):*\n${colList}`;

    return {
      label: t.name,
      kind,
      detail: `table (${t.columns.length} columns)`,
      documentation,
      insertText: t.name,
      sortText: `${sortPrefix}${t.name}`,
      range,
    };
  });
}

/**
 * @brief Constructs Monaco completion items for database columns.
 * @param tables Collection of table definitions.
 * @param targetTable Optional target table name to restrict columns to.
 * @param range Editor replacement range.
 * @param kind Monaco CompletionItemKind for fields/columns (default 4).
 * @return Array of formatted SqlCompletionItem objects.
 */
export function getColumnCompletions(
  tables: TableSchema[],
  targetTable?: string,
  range?: any,
  kind = 4
): SqlCompletionItem[] {
  let matchedTables = tables;
  if (targetTable) {
    const normalizedTarget = targetTable.toLowerCase();
    const filtered = tables.filter((t) => t.name.toLowerCase() === normalizedTarget);
    if (filtered.length > 0) {
      matchedTables = filtered;
    }
  }

  const items: SqlCompletionItem[] = [];
  for (const table of matchedTables) {
    for (const col of table.columns) {
      const formattedType = formatCanonicalType(col.data_type);
      const pkBadge = col.is_primary_key ? ' • [PK]' : '';
      const nullBadge = col.is_nullable ? ' • Nullable' : '';
      const defaultText = col.default_value ? `\n\n*Default:* \`${col.default_value}\`` : '';

      const documentation = `**Column:** \`${table.name}.${col.name}\`\n\n**Type:** \`${formattedType}\`${pkBadge}${nullBadge}${defaultText}`;

      // In dot_column context, sort primary keys first with '00_', regular with '01_'
      const sortKey = col.is_primary_key ? `00_${col.name}` : `01_${col.name}`;

      items.push({
        label: col.name,
        kind,
        detail: `${formattedType}${pkBadge}${nullBadge}`,
        documentation,
        insertText: col.name,
        sortText: targetTable ? sortKey : `2_${col.name}`,
        range,
      });
    }
  }

  return items;
}

/**
 * @brief Assembles full completion suggestions for Monaco Editor based on cursor position and schema.
 * @param lineContent Line content up to cursor.
 * @param schema Active database schema or null.
 * @param wordRange Replacement range for current word.
 * @param monaco Monaco namespace containing enum constants.
 * @return Array of Monaco completion item objects.
 */
export function buildSqlCompletions(
  lineContent: string,
  schema: DatabaseSchema | null,
  wordRange: any,
  monaco: any
): any[] {
  const Kinds = monaco?.languages?.CompletionItemKind || {
    Keyword: 13,
    Function: 2,
    Class: 6,
    Field: 4,
  };
  const InsertRules = monaco?.languages?.CompletionItemInsertTextRule || {
    InsertAsSnippet: 4,
  };

  const { context, tableName } = detectCompletionContext(lineContent);
  const tables = schema?.tables || [];

  // When typing after a dot: return ONLY columns for that table
  if (context === 'dot_column' && tableName) {
    return getColumnCompletions(tables, tableName, wordRange, Kinds.Field);
  }

  const suggestions: any[] = [];

  // Table completions (prioritized with '0_' when after FROM / JOIN)
  const tableSortPrefix = context === 'from_table' ? '0_' : '1_';
  if (tables.length > 0) {
    suggestions.push(...getTableCompletions(tables, wordRange, Kinds.Class, tableSortPrefix));
  }

  // Keywords
  const kwSortPrefix = context === 'from_table' ? '1_' : '0_';
  for (const kw of STANDARD_SQL_KEYWORDS) {
    suggestions.push({
      label: kw,
      kind: Kinds.Keyword,
      detail: 'SQL Keyword',
      insertText: kw,
      sortText: `${kwSortPrefix}${kw}`,
      range: wordRange,
    });
  }

  // Functions
  for (const fn of STANDARD_SQL_FUNCTIONS) {
    suggestions.push({
      label: fn.name,
      kind: Kinds.Function,
      detail: fn.detail,
      documentation: fn.detail,
      insertText: fn.snippet,
      insertTextRules: InsertRules.InsertAsSnippet,
      sortText: `${kwSortPrefix}${fn.name}`,
      range: wordRange,
    });
  }

  // Columns across all tables
  if (tables.length > 0) {
    suggestions.push(...getColumnCompletions(tables, undefined, wordRange, Kinds.Field));
  }

  return suggestions;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test src/utils/sqlCompletion.test.ts`
Expected: PASS (all tests pass cleanly)

- [ ] **Step 5: Commit Task 1**

```bash
git add src/utils/sqlCompletion.ts src/utils/sqlCompletion.test.ts
git commit -m "feat(query): implement schema-aware SQL autocompletion utility"
```

---

### Task 2: Monaco Completion Provider Integration (`src/components/query/QueryEditorTab.tsx`)

**Files:**
- Modify: `src/components/query/QueryEditorTab.tsx`
- Modify: `src/components/query/QueryEditorTab.test.tsx`

**Interfaces:**
- Consumes:
  - `DatabaseSchema` from `src/types/database.ts`
  - `buildSqlCompletions` from `src/utils/sqlCompletion.ts`
- Produces:
  - `schema?: DatabaseSchema | null` prop added to `QueryEditorTabProps`
  - Monaco `CompletionItemProvider` registered on editor mount with trigger characters `['.', ' ']`
  - Provider disposed on unmount via ref

- [ ] **Step 1: Write the failing tests in `QueryEditorTab.test.tsx`**

Add tests to `src/components/query/QueryEditorTab.test.tsx`:
```typescript
it('accepts schema prop without crashing and configures completion', () => {
  const mockSchema: DatabaseSchema = {
    tables: [
      {
        name: 'customers',
        columns: [
          {
            name: 'id',
            data_type: 'Integer',
            is_primary_key: true,
            is_nullable: false,
            is_auto_increment: true,
          },
        ],
        foreign_keys: [],
        indexes: [],
      },
    ],
  };

  render(
    <QueryEditorTab
      activeConnection={{
        id: 'conn-1',
        name: 'Test DB',
        db_type: 'Postgres',
        database: 'testdb',
        ssl: false,
      }}
      schema={mockSchema}
    />
  );

  expect(screen.getByTestId('sql-query-editor-tab')).toBeInTheDocument();
});
```

- [ ] **Step 2: Run test to verify failure**

Run: `bun test src/components/query/QueryEditorTab.test.tsx`
Expected: FAIL (or type error because `schema` is not in `QueryEditorTabProps`)

- [ ] **Step 3: Update `src/components/query/QueryEditorTab.tsx`**

1. Import `DatabaseSchema` from `../../types/database`.
2. Import `buildSqlCompletions` from `../../utils/sqlCompletion`.
3. Add `schema?: DatabaseSchema | null;` to `QueryEditorTabProps`.
4. Add `data-testid="sql-query-editor-tab"` to the root container `div`.
5. In `QueryEditorTab`:
   - Add `const schemaRef = useRef(schema);`
   - Add `useEffect(() => { schemaRef.current = schema; }, [schema]);`
   - Add `const completionProviderRef = useRef<{ dispose: () => void } | null>(null);`
   - In `handleEditorDidMount`:
     ```typescript
     if (!completionProviderRef.current) {
       completionProviderRef.current = monaco.languages.registerCompletionItemProvider('sql', {
         triggerCharacters: ['.', ' '],
         provideCompletionItems: (model: any, position: any) => {
           const word = model.getWordUntilPosition(position);
           const range = {
             startLineNumber: position.lineNumber,
             endLineNumber: position.lineNumber,
             startColumn: word.startColumn,
             endColumn: word.endColumn,
           };
           const lineContent = model.getValueInRange({
             startLineNumber: position.lineNumber,
             startColumn: 1,
             endLineNumber: position.lineNumber,
             endColumn: position.column,
           });
           const suggestions = buildSqlCompletions(lineContent, schemaRef.current ?? null, range, monaco);
           return { suggestions };
         },
       });
     }
     ```
   - In `useEffect` cleanup hook:
     ```typescript
     useEffect(() => {
       return () => {
         completionProviderRef.current?.dispose();
         completionProviderRef.current = null;
       };
     }, []);
     ```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test src/components/query/QueryEditorTab.test.tsx`
Expected: PASS

- [ ] **Step 5: Commit Task 2**

```bash
git add src/components/query/QueryEditorTab.tsx src/components/query/QueryEditorTab.test.tsx
git commit -m "feat(query): register schema-aware completion provider in QueryEditorTab"
```

---

### Task 3: Workspace Orchestration & Verification (`src/App.tsx`)

**Files:**
- Modify: `src/App.tsx:755-763`
- Modify: `src/App.test.tsx`

**Interfaces:**
- Consumes: `schema` state in `App.tsx`
- Produces: `<QueryEditorTab schema={schema} ... />`

- [ ] **Step 1: Write the test in `src/App.test.tsx`**

Verify that `QueryEditorTab` receives `schema` when the SQL tab is active:
Add assertion in `src/App.test.tsx` to verify `QueryEditorTab` renders properly with active schema.

- [ ] **Step 2: Update `src/App.tsx`**

In `src/App.tsx`, pass `schema={schema}` to `<QueryEditorTab />`:
```tsx
          {/* VIEW: SQL Query Editor Tab */}
          {(activeTab === 'sql' || (activeTab as string) === 'query') && (
            <QueryEditorTab
              activeConnection={activeConnection}
              schema={schema}
              initialQuery={activeSqlQuery || undefined}
              autoRun={autoRunQuery}
              onQuerySuccess={() => {
                setAutoRunQuery(false);
              }}
            />
          )}
```

- [ ] **Step 3: Run full regression test suite**

Run: `bun test`
Expected: All test suites PASS (245+ tests).

- [ ] **Step 4: Typecheck verification**

Run: `bun x tsc --noEmit`
Expected: Exit code 0, 0 errors.

- [ ] **Step 5: Static code review**

Run: `bun run scripts/code-review.ts` (or check for docstrings / style).
Expected: 0 violations.

- [ ] **Step 6: Commit Task 3**

```bash
git add src/App.tsx src/App.test.tsx
git commit -m "feat(app): forward active database schema to QueryEditorTab for autocomplete"
```
