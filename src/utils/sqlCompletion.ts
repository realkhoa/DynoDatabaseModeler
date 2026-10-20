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
  documentation?: { value: string };
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
  if ('Custom' in type && typeof type.Custom === 'string') {
    return type.Custom.toUpperCase();
  }
  return 'UNKNOWN';
}

/**
 * @brief Standard ANSI SQL keywords supported across relational databases.
 */
export const STANDARD_SQL_KEYWORDS: readonly string[] = [
  'SELECT', 'FROM', 'WHERE', 'AND', 'OR', 'NOT', 'IN', 'IS NULL', 'IS NOT NULL',
  'JOIN', 'INNER JOIN', 'LEFT JOIN', 'RIGHT JOIN', 'FULL JOIN', 'CROSS JOIN', 'ON',
  'GROUP BY', 'HAVING', 'ORDER BY', 'ASC', 'DESC', 'LIMIT', 'OFFSET',
  'INSERT INTO', 'VALUES', 'UPDATE', 'SET', 'DELETE FROM',
  'CREATE TABLE', 'ALTER TABLE', 'DROP TABLE', 'AS', 'DISTINCT',
  'UNION', 'UNION ALL', 'CASE', 'WHEN', 'THEN', 'ELSE', 'END',
  'EXISTS', 'BETWEEN', 'LIKE', 'ILIKE',
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
  {
    name: 'COALESCE',
    snippet: 'COALESCE(${1:expr1}, ${2:expr2})',
    detail: 'COALESCE(val, ...) - Returns first non-null',
  },
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
  const dotRegex =
    /(?:[a-zA-Z0-9_`"\[\]]+\.)*([a-zA-Z0-9_`"\[\]]+)\.([a-zA-Z0-9_]*)$/;
  const dotMatch = lineTextBeforeCursor.match(dotRegex);
  if (dotMatch && dotMatch[1]) {
    const rawTableName = dotMatch[1].replace(/[`"\[\]]/g, '');
    // Numeric literals (e.g. 10. or 3.14) should not be treated as table names
    if (/^\d+$/.test(rawTableName) && !/[`"\[]/.test(dotMatch[1])) {
      return {
        context: 'general',
      };
    }
    return {
      context: 'dot_column',
      tableName: rawTableName,
    };
  }

  // Check for table reference clauses: FROM, JOIN, INTO, UPDATE, TABLE
  const fromTableRegex =
    /\b(?:FROM|JOIN|LEFT\s+JOIN|RIGHT\s+JOIN|INNER\s+JOIN|FULL\s+JOIN|CROSS\s+JOIN|INTO|UPDATE|TABLE)\s+([a-zA-Z0-9_]*)$/i;
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
      .map((c) => {
        const pk = c.is_primary_key ? ' [PK]' : '';
        const nullable = c.is_nullable ? ' (Nullable)' : '';
        return `- **${c.name}**: \`${formatCanonicalType(c.data_type)}\`${pk}${nullable}`;
      })
      .join('\n');

    const documentation = `### Table: **${t.name}**\n\n*Columns (${t.columns.length}):*\n${colList}`;

    return {
      label: t.name,
      kind,
      detail: `table (${t.columns.length} columns)`,
      documentation: { value: documentation },
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
      const docHeader = `**Column:** \`${table.name}.${col.name}\``;
      const docType = `**Type:** \`${formattedType}\`${pkBadge}${nullBadge}`;
      const documentation = `${docHeader}\n\n${docType}${defaultText}`;

      // In dot_column context, sort primary keys first with '00_', regular with '01_'
      const sortKey = col.is_primary_key ? `00_${col.name}` : `01_${col.name}`;

      items.push({
        label: col.name,
        kind,
        detail: `${formattedType}${pkBadge}${nullBadge}`,
        documentation: { value: documentation },
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
): SqlCompletionItem[] {
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

  const suggestions: SqlCompletionItem[] = [];

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
      documentation: { value: fn.detail },
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
