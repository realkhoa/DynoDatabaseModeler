/**
 * @file sqlSafety.ts
 * @brief Conservative analysis of user SQL to decide whether result rows may be edited in place.
 * @details The data grid writes rows back with `UPDATE <table> SET ... WHERE <primary key> = ...`.
 * That is only safe when the statement is a single-table projection whose result columns map 1:1 to
 * real table columns. Anything else (joins, aggregates, expressions, aliases, sub-queries, multiple
 * statements) is refused so the grid can never update the wrong rows or produce invalid SQL.
 */

/**
 * @brief Result of analysing a SELECT statement for in-place editability.
 */
export interface EditableQueryAnalysis {
  /** @brief Whether the result grid may be edited and saved. */
  editable: boolean;
  /** @brief Table name (schema qualified when the statement qualifies it). */
  table?: string;
  /** @brief Human-readable explanation when editing is refused. */
  reason?: string;
}

/**
 * @brief Removes line and block comments and collapses whitespace.
 * @param sql Raw SQL text.
 * @return Normalized single-line SQL text.
 */
export function stripSqlComments(sql: string): string {
  return sql
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/--[^\n\r]*/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * @brief Matches a single quoted-or-bare SQL identifier.
 * @param token Candidate identifier text.
 * @return `true` when the token is exactly one identifier.
 */
function isPlainIdentifier(token: string): boolean {
  return /^(?:"[^"]+"|`[^`]+`|\[[^\]]+\]|[A-Za-z_][A-Za-z0-9_$]*)$/.test(token.trim());
}

/**
 * @brief Matches an optionally schema-qualified identifier such as `orders` or `sales.orders`.
 * @param token Candidate identifier text.
 * @return `true` when the token is one identifier or two dot-separated identifiers.
 */
function isQualifiedIdentifier(token: string): boolean {
  const parts = token.trim().split('.');
  return parts.length <= 2 && parts.every((part) => isPlainIdentifier(part));
}

/**
 * @brief Normalizes an identifier by removing quoting characters.
 * @param token Identifier text, possibly quoted.
 * @return Unquoted identifier text.
 */
function unquoteIdentifier(token: string): string {
  return token.trim().replace(/^["`[]|["`\]]$/g, '');
}

/**
 * @brief Analyses a SELECT statement to decide whether its rows can be edited in place.
 * @param sql SQL statement text.
 * @return Analysis describing editability, the target table, and the refusal reason when blocked.
 */
export function analyzeEditableQuery(sql: string): EditableQueryAnalysis {
  const normalized = stripSqlComments(sql);

  if (!normalized) {
    return { editable: false, reason: 'No statement to edit.' };
  }

  if (!/^select\b/i.test(normalized)) {
    return { editable: false, reason: 'Only SELECT statements can be edited in the grid.' };
  }

  // Multiple statements cannot be mapped to one editable result set.
  if (normalized.replace(/;\s*$/, '').includes(';')) {
    return { editable: false, reason: 'Multiple statements cannot be edited in the grid.' };
  }

  const blockedKeywords: Array<[RegExp, string]> = [
    [/\bjoin\b/i, 'the query joins tables'],
    [/\bgroup\s+by\b/i, 'the query aggregates rows'],
    [/\bhaving\b/i, 'the query aggregates rows'],
    [/\bunion\b/i, 'the query unions result sets'],
    [/\bdistinct\b/i, 'the query removes duplicates'],
    [/\bwith\b/i, 'the query starts with a common table expression'],
    [/\bover\s*\(/i, 'the query uses a window function'],
    [/\binto\b/i, 'the query writes into another table'],
  ];
  for (const [pattern, reason] of blockedKeywords) {
    if (pattern.test(normalized)) {
      return { editable: false, reason: `Editing disabled: ${reason}.` };
    }
  }

  const fromMatches = normalized.match(/\bfrom\b/gi) ?? [];
  if (fromMatches.length !== 1) {
    return {
      editable: false,
      reason: 'Editing disabled: the query must read from exactly one table.',
    };
  }

  const fromIndex = normalized.search(/\bfrom\b/i);
  const selectList = normalized.slice('select'.length, fromIndex).trim();
  const fromRemainder = normalized
    .slice(fromIndex + 'from'.length)
    .trim()
    .replace(/;\s*$/, '');

  // The FROM target must be a plain (optionally qualified) identifier, not a sub-query or table list.
  const tableToken = fromRemainder.split(/\s+/)[0] ?? '';
  if (!isQualifiedIdentifier(tableToken) || fromRemainder.includes('(')) {
    return {
      editable: false,
      reason: 'Editing disabled: the query must read from a single plain table.',
    };
  }

  const afterTable = fromRemainder.slice(tableToken.length).trim();
  if (afterTable.length > 0 && !/^(order\s+by|limit|offset|fetch)\b/i.test(afterTable)) {
    return {
      editable: false,
      reason: 'Editing disabled: the query adds clause types the grid cannot locate rows with.',
    };
  }

  // Result columns must map 1:1 to real columns: `*` or a comma separated identifier list.
  if (selectList !== '*') {
    const items = selectList.split(',').map((item) => item.trim());
    if (items.length === 0 || items.some((item) => !isPlainIdentifier(item))) {
      return {
        editable: false,
        reason:
          'Editing disabled: result columns must be plain column names (no expressions or aliases).',
      };
    }
  }

  return { editable: true, table: unquoteQualified(tableToken) };
}

/**
 * @brief Normalizes a qualified table reference into `schema.name` form without quoting.
 * @param token Qualified identifier text.
 * @return Unquoted qualified table reference.
 */
function unquoteQualified(token: string): string {
  return token
    .split('.')
    .map((part) => unquoteIdentifier(part))
    .join('.');
}

/**
 * @brief Splits a SQL script into individual statements, ignoring separators inside literals.
 * @details A naive `split(';')` corrupts statements containing semicolons inside string literals,
 * quoted identifiers, comments or dollar-quoted bodies. This scanner tracks quoting state so
 * generated DDL and hand-edited scripts are split the same way a SQL client would.
 * @param script SQL script text.
 * @return Individual statements, trimmed, with empty fragments removed and terminators retained.
 */
export function splitSqlStatements(script: string): string[] {
  const statements: string[] = [];
  let current = '';
  let index = 0;

  while (index < script.length) {
    const char = script[index];
    const next = script[index + 1];

    // Line comment: copy verbatim until end of line.
    if (char === '-' && next === '-') {
      while (index < script.length && script[index] !== '\n') {
        current += script[index];
        index += 1;
      }
      continue;
    }

    // Block comment: copy verbatim.
    if (char === '/' && next === '*') {
      current += '/*';
      index += 2;
      while (index < script.length && !(script[index] === '*' && script[index + 1] === '/')) {
        current += script[index];
        index += 1;
      }
      current += '*/';
      index = Math.min(index + 2, script.length);
      continue;
    }

    // Quoted literal or identifier: copy verbatim, honouring doubled quote escapes.
    if (char === "'" || char === '"' || char === '`') {
      const quote = char;
      current += quote;
      index += 1;
      while (index < script.length) {
        if (script[index] === quote) {
          if (script[index + 1] === quote) {
            current += quote + quote;
            index += 2;
            continue;
          }
          current += quote;
          index += 1;
          break;
        }
        current += script[index];
        index += 1;
      }
      continue;
    }

    // Dollar-quoted body (PostgreSQL functions): copy verbatim between matching tags.
    if (char === '$') {
      const tagMatch = script.slice(index).match(/^\$[A-Za-z0-9_]*\$/);
      if (tagMatch) {
        const tag = tagMatch[0];
        const end = script.indexOf(tag, index + tag.length);
        if (end !== -1) {
          current += script.slice(index, end + tag.length);
          index = end + tag.length;
          continue;
        }
      }
    }

    if (char === ';') {
      const statement = current.trim();
      if (statement) {
        statements.push(`${statement};`);
      }
      current = '';
      index += 1;
      continue;
    }

    current += char;
    index += 1;
  }

  const trailing = current.trim();
  if (trailing) {
    statements.push(`${trailing};`);
  }

  return statements;
}
