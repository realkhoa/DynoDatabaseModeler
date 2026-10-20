/**
 * @file sqlPagination.ts
 * @brief Dialect-aware SQL query pagination and query safety limit utilities.
 * @details Synthesizes engine-specific pagination clauses (LIMIT/OFFSET and OFFSET/FETCH NEXT),
 * count queries, identifier escaping, and query safety limit interceptors.
 */

import type { DatabaseType } from '../types/database';

/**
 * @brief Escapes a table or column identifier according to database dialect conventions.
 * @details Splits schema-qualified identifiers on dot notation (e.g. "public.users"),
 * strips existing surrounding quotes or delimiters, and re-wraps each component using
 * dialect-specific quoting (backticks for MySQL, square brackets for MSSQL, double quotes
 * for SQLite/Postgres/DuckDB).
 * @param ident Identifier string, which may contain dot notation for schema qualification (e.g. "public.users").
 * @param dbType Relational database engine dialect.
 * @return Safely escaped identifier string.
 */
export function escapeIdentifier(ident: string, dbType: DatabaseType = 'Sqlite'): string {
  const parts = ident.split('.').map((p) => p.trim().replace(/^["`\[]|["`\]]$/g, ''));

  switch (dbType) {
    case 'MySql':
      return parts.map((p) => `\`${p}\``).join('.');
    case 'Mssql':
      return parts.map((p) => `[${p}]`).join('.');
    case 'Postgres':
    case 'Sqlite':
    case 'DuckDb':
    default:
      return parts.map((p) => `"${p}"`).join('.');
  }
}

/**
 * @brief Builds a dialect-aware paginated SELECT query for inspecting table rows.
 * @details Uses standard LIMIT/OFFSET for SQLite, Postgres, MySQL, and DuckDB.
 * For MSSQL, generates an ORDER BY clause (falling back to ORDER BY (SELECT NULL) if
 * no primary key is specified) followed by OFFSET/FETCH NEXT clauses.
 * @param tableKey Table name, optionally schema-qualified (e.g. 'public.users' or 'users').
 * @param dbType Target database engine type.
 * @param pageSize Number of rows to fetch per page.
 * @param pageIndex Zero-based page number.
 * @param primaryKey Optional primary key column name for deterministic ordering in MSSQL.
 * @return Executable SQL SELECT statement with pagination.
 */
export function buildPaginatedSelectQuery(
  tableKey: string,
  dbType: DatabaseType,
  pageSize: number,
  pageIndex: number,
  primaryKey?: string
): string {
  const escapedTable = escapeIdentifier(tableKey, dbType);
  const offset = Math.max(0, pageIndex * pageSize);

  if (dbType === 'Mssql') {
    const orderClause = primaryKey ? `ORDER BY ${escapeIdentifier(primaryKey, dbType)}` : 'ORDER BY (SELECT NULL)';
    return `SELECT * FROM ${escapedTable} ${orderClause} OFFSET ${offset} ROWS FETCH NEXT ${pageSize} ROWS ONLY;`;
  }

  return `SELECT * FROM ${escapedTable} LIMIT ${pageSize} OFFSET ${offset};`;
}

/**
 * @brief Builds a COUNT(*) query to determine the total number of records in a table.
 * @param tableKey Table name, optionally schema-qualified.
 * @param dbType Target database engine type.
 * @return SQL statement returning `total_count`.
 */
export function buildCountQuery(tableKey: string, dbType: DatabaseType): string {
  const escapedTable = escapeIdentifier(tableKey, dbType);
  return `SELECT COUNT(*) AS total_count FROM ${escapedTable};`;
}

/**
 * @brief Result object returned by applySafeLimit.
 */
export interface SafeLimitResult {
  /** @brief Effective SQL query string after checking/applying limit. */
  sql: string;
  /** @brief Indicates whether an artificial safe limit was appended to the statement. */
  applied: boolean;
}

/**
 * @brief Injects a safe limit clause into a custom SELECT query if it lacks an explicit limit.
 * @details Avoids modifying non-SELECT statements or queries that already contain LIMIT or
 * FETCH NEXT clauses. For MSSQL queries lacking an ORDER BY clause, appends ORDER BY (SELECT NULL)
 * before injecting OFFSET 0 ROWS FETCH NEXT.
 * @param sql User-submitted SQL statement string.
 * @param dbType Relational database engine dialect.
 * @param limit Maximum allowed rows threshold.
 * @return SafeLimitResult containing the resulting SQL and whether a limit was injected.
 */
export function applySafeLimit(
  sql: string,
  dbType: DatabaseType,
  limit: number
): SafeLimitResult {
  const trimmed = sql.trim().replace(/;+$/, '');
  const isSelect = /^\s*SELECT\b/i.test(trimmed);

  if (!isSelect || limit <= 0) {
    return { sql, applied: false };
  }

  // Check if LIMIT or FETCH NEXT is already specified
  const hasLimit = /\bLIMIT\s+\d+/i.test(trimmed);
  const hasFetchNext = /\bFETCH\s+(FIRST|NEXT)\s+\d+\s+ROWS/i.test(trimmed);

  if (hasLimit || hasFetchNext) {
    return { sql, applied: false };
  }

  if (dbType === 'Mssql') {
    const hasOrderBy = /\bORDER\s+BY\b/i.test(trimmed);
    const orderPrefix = hasOrderBy ? '' : ' ORDER BY (SELECT NULL)';
    return {
      sql: `${trimmed}${orderPrefix} OFFSET 0 ROWS FETCH NEXT ${limit} ROWS ONLY;`,
      applied: true,
    };
  }

  return {
    sql: `${trimmed} LIMIT ${limit};`,
    applied: true,
  };
}

/**
 * @brief Extracts limit and offset values from an existing SQL query string.
 * @details Inspects both standard LIMIT/OFFSET syntax and MSSQL OFFSET...ROWS FETCH NEXT syntax.
 * @param sql SQL statement string to analyze.
 * @return Extracted limit and offset numbers, or null if no pagination is present.
 */
export function extractPaginationInfo(
  sql: string
): { limit?: number; offset?: number } | null {
  const limitMatch = sql.match(/\bLIMIT\s+(\d+)/i);
  const offsetMatch = sql.match(/\bOFFSET\s+(\d+)/i);

  const mssqlMatch = sql.match(/OFFSET\s+(\d+)\s+ROWS\s+FETCH\s+(?:FIRST|NEXT)\s+(\d+)\s+ROWS/i);

  if (mssqlMatch) {
    return {
      offset: parseInt(mssqlMatch[1], 10),
      limit: parseInt(mssqlMatch[2], 10),
    };
  }

  if (limitMatch || offsetMatch) {
    return {
      limit: limitMatch ? parseInt(limitMatch[1], 10) : undefined,
      offset: offsetMatch ? parseInt(offsetMatch[1], 10) : undefined,
    };
  }

  return null;
}
