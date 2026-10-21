/**
 * @file processQueries.ts
 * @brief Dialect-specific database process inspection and termination utilities.
 * @details Formulates catalog queries to fetch active connections, long-running queries,
 * and lock states across PostgreSQL, MySQL, MSSQL, DuckDB, and SQLite, inspired by Antares SQL
 * processes list and DBeaver session manager.
 */

import type { DatabaseType, QueryResult } from '../types/database';
import { getEngineDialectFamily, isEmbeddedEngine } from '../types/database';

/**
 * @brief Standardized representation of an active database server process or session.
 */
export interface ProcessItem {
  /** @brief Server Process ID or Session ID. */
  pid: string | number;
  /** @brief Database user / login name. */
  user: string;
  /** @brief Database catalog or schema name. */
  database: string;
  /** @brief Client network address or hostname. */
  client: string;
  /** @brief Current execution state (e.g., 'active', 'idle', 'sleeping', 'running'). */
  state: string;
  /** @brief Elapsed execution duration string. */
  duration: string;
  /** @brief Currently executing SQL statement text. */
  query: string;
}

/**
 * @brief Returns the appropriate SQL catalog query to inspect active processes for a database dialect.
 * @param dbType Database engine dialect.
 * @return SQL statement text.
 */
export function getProcessListQuery(dbType: DatabaseType = 'Postgres'): string {
  const family = getEngineDialectFamily(dbType);
  switch (family) {
    case 'postgres':
      return `SELECT pid, usename AS "user", datname AS "database", COALESCE(client_addr::text, 'local') AS "client", state, COALESCE(TO_CHAR(NOW() - query_start, 'HH24:MI:SS'), '00:00:00') AS duration, query FROM pg_stat_activity WHERE query NOT LIKE '%pg_stat_activity%' ORDER BY query_start ASC NULLS LAST LIMIT 100;`;
    case 'mysql':
      return `SHOW FULL PROCESSLIST;`;
    case 'mssql':
      return `SELECT r.session_id AS pid, s.login_name AS [user], COALESCE(DB_NAME(r.database_id), 'master') AS [database], COALESCE(s.client_net_address, 'local') AS [client], r.status AS state, CAST(DATEADD(ms, r.total_elapsed_time, '1900-01-01') AS TIME) AS duration, t.text AS query FROM sys.dm_exec_requests r CROSS APPLY sys.dm_exec_sql_text(r.sql_handle) t JOIN sys.dm_exec_sessions s ON r.session_id = s.session_id WHERE r.session_id <> @@SPID;`;
    case 'duckdb':
      return `SELECT query_id AS pid, 'duckdb' AS "user", 'memory' AS "database", 'localhost' AS "client", 'running' AS state, '00:00:01' AS duration, query FROM duckdb_queries() WHERE query NOT LIKE '%duckdb_queries%' LIMIT 50;`;
    case 'sqlite':
      return `SELECT 1 AS pid, 'sqlite' AS "user", 'main' AS "database", 'local' AS "client", 'active' AS state, '00:00:00' AS duration, 'SQLite in-process active connection' AS query;`;
    case 'redis':
      return `CLIENT LIST`;
    default:
      return `SELECT 1 AS pid, 'user' AS "user", 'db' AS "database", 'localhost' AS "client", 'active' AS state, '00:00:00' AS duration, 'Active session' AS query;`;
  }
}

/**
 * @brief Constructs a safe termination / kill SQL statement for a runaway process ID.
 * @param pid Process or session identifier to terminate.
 * @param dbType Database engine dialect.
 * @return SQL statement to terminate process.
 */
export function getKillQuery(pid: string | number, dbType: DatabaseType = 'Postgres'): string {
  const numericPid = Number(pid);
  if (isNaN(numericPid) || numericPid <= 0) {
    throw new Error(`Invalid process ID: ${pid}`);
  }

  if (isEmbeddedEngine(dbType)) {
    throw new Error(`Process termination is not supported for embedded engine: ${dbType}`);
  }
  const family = getEngineDialectFamily(dbType);
  switch (family) {
    case 'postgres':
      return `SELECT pg_terminate_backend(${numericPid});`;
    case 'mysql':
      return `KILL ${numericPid};`;
    case 'mssql':
      return `KILL ${numericPid};`;
    case 'redis':
      return `CLIENT KILL ID ${numericPid};`;
    default:
      throw new Error(`Unsupported database dialect for process kill: ${dbType}`);
  }
}

/**
 * @brief Parses dialect-specific raw tabular query results into standardized ProcessItem models.
 * @param result Raw QueryResult returned from database execution.
 * @param dbType Database engine dialect.
 * @return Array of standardized ProcessItem objects.
 */
export function parseProcessListResult(
  result: QueryResult,
  _dbType: DatabaseType = 'Postgres'
): ProcessItem[] {
  if (!result || !result.columns || !result.rows) {
    return [];
  }

  const colIndexes = new Map<string, number>();
  result.columns.forEach((col, idx) => {
    colIndexes.set(col.toLowerCase(), idx);
  });

  const getCol = (row: any[], possibleNames: string[]): any => {
    for (const name of possibleNames) {
      const idx = colIndexes.get(name.toLowerCase());
      if (idx !== undefined && row[idx] !== undefined) {
        return row[idx];
      }
    }
    return '';
  };

  return result.rows.map((row) => {
    const pid = getCol(row, ['pid', 'id', 'session_id', 'query_id']);
    const user = getCol(row, ['user', 'usename', 'login_name']);
    const database = getCol(row, ['database', 'datname', 'db']);
    const client = getCol(row, ['client', 'client_addr', 'host', 'client_net_address']);
    const state = getCol(row, ['state', 'status', 'command']);
    const duration = getCol(row, ['duration', 'time', 'total_elapsed_time']);
    const query = getCol(row, ['query', 'info', 'text']);

    return {
      pid: pid ?? 0,
      user: String(user ?? 'unknown'),
      database: String(database ?? 'default'),
      client: String(client ?? 'local'),
      state: String(state ?? 'active'),
      duration: typeof duration === 'number' ? `${duration}s` : String(duration ?? '0s'),
      query: String(query ?? ''),
    };
  });
}
