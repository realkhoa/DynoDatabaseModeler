/**
 * @file sqlFormatter.ts
 * @brief Pure SQL query beautifier and formatting engine.
 * @details Tokenizes and structures SQL queries with uppercase keyword normalization,
 * clause line-breaking, 2-space indentation, and preservation of comments and string literals.
 */

/**
 * @brief Ordered list of major SQL clauses for line breaking and indentation.
 */
export const MAJOR_CLAUSES: readonly string[] = [
  'SELECT',
  'FROM',
  'WHERE',
  'GROUP BY',
  'HAVING',
  'ORDER BY',
  'LIMIT',
  'OFFSET',
  'LEFT OUTER JOIN',
  'RIGHT OUTER JOIN',
  'FULL OUTER JOIN',
  'INNER JOIN',
  'LEFT JOIN',
  'RIGHT JOIN',
  'FULL JOIN',
  'CROSS JOIN',
  'JOIN',
  'INSERT INTO',
  'VALUES',
  'UPDATE',
  'SET',
  'DELETE FROM',
  'UNION ALL',
  'UNION',
] as const;

/**
 * @brief Internal metadata representing a matched major SQL clause header in the source text.
 */
interface ClauseMatch {
  /** Canonical uppercase clause keyword (e.g. 'SELECT', 'LEFT JOIN'). */
  keyword: string;
  /** Start index of the clause in the source text. */
  startIndex: number;
  /** End index of the clause header in the source text. */
  endIndex: number;
}

/**
 * @brief Set of standard SQL keywords normalized to uppercase when outside strings and comments.
 */
const SQL_KEYWORDS = new Set([
  'SELECT', 'DISTINCT', 'ALL', 'FROM', 'WHERE', 'AND', 'OR', 'NOT', 'IN', 'IS', 'NULL',
  'LIKE', 'ILIKE', 'BETWEEN', 'EXISTS', 'AS', 'JOIN', 'INNER', 'LEFT', 'RIGHT', 'FULL',
  'OUTER', 'CROSS', 'ON', 'GROUP', 'BY', 'HAVING', 'ORDER', 'ASC', 'DESC', 'LIMIT',
  'OFFSET', 'UNION', 'INTERSECT', 'EXCEPT', 'INSERT', 'INTO', 'VALUES', 'UPDATE', 'SET',
  'DELETE', 'CREATE', 'ALTER', 'DROP', 'TABLE', 'VIEW', 'INDEX', 'TRIGGER', 'PRIMARY',
  'KEY', 'FOREIGN', 'REFERENCES', 'CHECK', 'DEFAULT', 'CONSTRAINT', 'UNIQUE', 'CASCADE',
  'RESTRICT', 'CASE', 'WHEN', 'THEN', 'ELSE', 'END', 'CAST', 'COALESCE', 'NULLIF',
  'WITH', 'RECURSIVE', 'RETURNING', 'FETCH', 'FIRST', 'NEXT', 'ROWS', 'ONLY', 'TRUE', 'FALSE',
]);

/**
 * @brief Skips a single-quoted string literal, handling escaped quotes and backslashes.
 * @param sql Full SQL source string.
 * @param start Start index of opening quote.
 * @return Index immediately after closing quote, or sql.length if unclosed.
 */
function skipString(sql: string, start: number): number {
  let i = start + 1;
  while (i < sql.length) {
    if (sql[i] === "'") {
      if (i + 1 < sql.length && sql[i + 1] === "'") {
        i += 2;
        continue;
      }
      return i + 1;
    }
    if (sql[i] === '\\' && i + 1 < sql.length) i += 2;
    else i++;
  }
  return sql.length;
}

/**
 * @brief Skips a quoted identifier ("...", `...`, or [...]).
 * @param sql Full SQL source string.
 * @param start Start index of opening delimiter.
 * @return Index immediately after closing delimiter, or sql.length if unclosed.
 */
function skipQuotedIdent(sql: string, start: number): number {
  const close = sql[start] === '[' ? ']' : sql[start];
  let i = start + 1;
  while (i < sql.length) {
    if (sql[i] === close) {
      if (close !== ']' && i + 1 < sql.length && sql[i + 1] === close) {
        i += 2;
        continue;
      }
      return i + 1;
    }
    i++;
  }
  return sql.length;
}

/**
 * @brief Skips a single-line comment (-- ...) until a newline character or EOF.
 * @param sql Full SQL source string.
 * @param start Start index of '--'.
 * @return Index of newline character or sql.length if EOF.
 */
function skipLineComment(sql: string, start: number): number {
  let i = start + 2;
  while (i < sql.length && sql[i] !== '\n') i++;
  return i;
}

/**
 * @brief Skips a block comment (/* ... *​/) until closing token or EOF.
 * @param sql Full SQL source string.
 * @param start Start index of '/*'.
 * @return Index immediately after closing '*​/' or sql.length if EOF.
 */
function skipBlockComment(sql: string, start: number): number {
  const end = sql.indexOf('*/', start + 2);
  return end === -1 ? sql.length : end + 2;
}

/**
 * @brief Detects and skips string literals, quoted identifiers, or comments.
 * @param sql Source text string.
 * @param i Current position index.
 * @return End index of literal or comment if found, or -1 otherwise.
 */
function skipLiteralOrComment(sql: string, i: number): number {
  const ch = sql[i];
  if (ch === "'") return skipString(sql, i);
  if (ch === '"' || ch === '`' || ch === '[') return skipQuotedIdent(sql, i);
  if (sql.startsWith('--', i)) return skipLineComment(sql, i);
  if (sql.startsWith('/*', i)) return skipBlockComment(sql, i);
  return -1;
}

/**
 * @brief Uppercases recognized SQL keywords while preserving strings, identifiers, and comments.
 * @param text SQL text fragment to transform.
 * @return Normalized text with uppercase SQL keywords.
 */
function uppercaseKeywords(text: string): string {
  let result = '';
  let i = 0;

  while (i < text.length) {
    const nextLit = skipLiteralOrComment(text, i);
    if (nextLit !== -1) {
      result += text.slice(i, nextLit);
      i = nextLit;
    } else if (/[A-Za-z_]/.test(text[i])) {
      let j = i;
      while (j < text.length && /[A-Za-z0-9_]/.test(text[j])) j++;
      const word = text.slice(i, j);
      let prev = i - 1;
      while (prev >= 0 && /[ \t]/.test(text[prev])) prev--;
      const isDotted = prev >= 0 && text[prev] === '.';
      result += !isDotted && SQL_KEYWORDS.has(word.toUpperCase()) ? word.toUpperCase() : word;
      i = j;
    } else {
      result += text[i++];
    }
  }

  return result;
}

/**
 * @brief Splits a clause body by top-level commas outside parentheses, strings, and comments.
 * @param text Clause body text containing expressions and commas.
 * @return Array of trimmed sub-expression strings.
 */
function splitByCommas(text: string): string[] {
  const items: string[] = [];
  let current = '';
  let parenDepth = 0;
  let i = 0;

  while (i < text.length) {
    const nextLit = skipLiteralOrComment(text, i);
    if (nextLit !== -1) {
      current += text.slice(i, nextLit);
      i = nextLit;
    } else if (text[i] === '(') {
      parenDepth++;
      current += '(';
      i++;
    } else if (text[i] === ')') {
      if (parenDepth > 0) parenDepth--;
      current += ')';
      i++;
    } else if (text[i] === ',' && parenDepth === 0) {
      if (current.trim().length > 0) items.push(current.trim());
      current = '';
      i++;
    } else {
      current += text[i++];
    }
  }

  if (current.trim().length > 0) items.push(current.trim());
  return items;
}

/**
 * @brief Finds all top-level major clause matches in a single SQL statement.
 * @param sql Single SQL statement string.
 * @return Ordered list of clause match positions.
 */
function findTopLevelClauses(sql: string): ClauseMatch[] {
  const matches: ClauseMatch[] = [];
  let parenDepth = 0;
  let i = 0;
  const sortedClauses = [...MAJOR_CLAUSES].sort((a, b) => b.length - a.length);

  while (i < sql.length) {
    const nextLit = skipLiteralOrComment(sql, i);
    if (nextLit !== -1) {
      i = nextLit;
    } else if (sql[i] === '(') {
      parenDepth++;
      i++;
    } else if (sql[i] === ')') {
      if (parenDepth > 0) parenDepth--;
      i++;
    } else if (parenDepth === 0 && (i === 0 || /[\s,;()]/.test(sql[i - 1]))) {
      let matched = false;
      for (const clause of sortedClauses) {
        const pattern = new RegExp('^' + clause.replace(/\s+/g, '\\s+') + '(?=[\\s,;()]|$)', 'i');
        const m = sql.slice(i).match(pattern);
        if (m) {
          matches.push({ keyword: clause, startIndex: i, endIndex: i + m[0].length });
          i += m[0].length;
          matched = true;
          break;
        }
      }
      if (!matched) i++;
    } else {
      i++;
    }
  }

  return matches;
}

/**
 * @brief Formats a single SQL statement with clause breaking, body indentation, and keyword uppercase.
 * @param stmt Single SQL statement string (may include trailing semicolon).
 * @return Formatted multi-line SQL statement.
 */
function formatSingleStatement(stmt: string): string {
  const clauses = findTopLevelClauses(stmt);
  if (clauses.length === 0) return uppercaseKeywords(stmt.trim());

  const lines: string[] = [];
  const prefix = stmt.slice(0, clauses[0].startIndex).trim();
  if (prefix.length > 0) lines.push(uppercaseKeywords(prefix));

  for (let k = 0; k < clauses.length; k++) {
    const clause = clauses[k];
    const bodyStart = clause.endIndex;
    const bodyEnd = k + 1 < clauses.length ? clauses[k + 1].startIndex : stmt.length;
    const rawBody = stmt.slice(bodyStart, bodyEnd).trim();

    lines.push(clause.keyword);

    if (rawBody.length > 0) {
      const items = splitByCommas(uppercaseKeywords(rawBody));
      for (let idx = 0; idx < items.length; idx++) {
        const comma = idx < items.length - 1 ? ',' : '';
        const itemLines = items[idx].split('\n');
        for (let lIdx = 0; lIdx < itemLines.length; lIdx++) {
          const lineContent = itemLines[lIdx].trim();
          if (lineContent.length > 0) {
            const isLast = lIdx === itemLines.length - 1;
            lines.push(`  ${lineContent.replace(/,+$/, '')}${isLast ? comma : ''}`);
          }
        }
      }
    }
  }

  return lines.join('\n');
}

/**
 * @brief Splits a full SQL script into individual statements at top-level semicolons.
 * @param sql Full SQL script string.
 * @return Array of individual SQL statement strings.
 */
function splitStatements(sql: string): string[] {
  const statements: string[] = [];
  let current = '';
  let parenDepth = 0;
  let i = 0;

  while (i < sql.length) {
    const nextLit = skipLiteralOrComment(sql, i);
    if (nextLit !== -1) {
      current += sql.slice(i, nextLit);
      i = nextLit;
    } else if (sql[i] === '(') {
      parenDepth++;
      current += '(';
      i++;
    } else if (sql[i] === ')') {
      if (parenDepth > 0) parenDepth--;
      current += ')';
      i++;
    } else if (sql[i] === ';' && parenDepth === 0) {
      current += ';';
      i++;
      while (i < sql.length && (sql[i] === ' ' || sql[i] === '\t')) {
        current += sql[i++];
      }
      if (sql.startsWith('/*', i)) {
        const next = skipBlockComment(sql, i);
        current += sql.slice(i, next);
        i = next;
      }
      statements.push(current.trim());
      current = '';
    } else {
      current += sql[i++];
    }
  }

  if (current.trim().length > 0) statements.push(current.trim());
  return statements;
}

/**
 * @brief Beautifies and formats an arbitrary SQL query or multi-statement script.
 * @details Normalizes SQL keywords to uppercase, breaks major clauses onto new lines,
 * indents clause expressions by 2 spaces, and preserves string literals, comments, and identifiers.
 * @param sql Raw SQL query text.
 * @return Formatted and beautified SQL query text, or empty string if input is blank.
 */
export function formatSql(sql: string): string {
  if (!sql || sql.trim().length === 0) return '';
  const statements = splitStatements(sql);
  return statements.length === 0 ? '' : statements.map(formatSingleStatement).join('\n\n');
}
