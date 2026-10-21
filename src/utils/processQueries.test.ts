/**
 * @file processQueries.test.ts
 * @brief Unit tests for database process list inspection and query termination utilities.
 */

import { describe, it, expect } from 'vitest';
import {
  getProcessListQuery,
  getKillQuery,
  parseProcessListResult,
} from './processQueries';
import type { QueryResult } from '../types/database';

describe('processQueries', () => {
  describe('getProcessListQuery', () => {
    it('returns pg_stat_activity query for Postgres', () => {
      const sql = getProcessListQuery('Postgres');
      expect(sql).toContain('pg_stat_activity');
      expect(sql).toContain('query_start');
    });

    it('returns SHOW FULL PROCESSLIST for MySQL', () => {
      const sql = getProcessListQuery('MySql');
      expect(sql).toBe('SHOW FULL PROCESSLIST;');
    });

    it('returns sys.dm_exec_requests for MSSQL', () => {
      const sql = getProcessListQuery('Mssql');
      expect(sql).toContain('sys.dm_exec_requests');
    });

    it('returns fallback queries for DuckDB and SQLite', () => {
      expect(getProcessListQuery('DuckDb')).toContain('duckdb_queries');
      expect(getProcessListQuery('Sqlite')).toContain('sqlite');
    });

    it('returns CLIENT LIST for Redis', () => {
      const sql = getProcessListQuery('Redis');
      expect(sql).toBe('CLIENT LIST');
    });
  });

  describe('getKillQuery', () => {
    it('generates pg_terminate_backend for Postgres', () => {
      expect(getKillQuery(1234, 'Postgres')).toBe('SELECT pg_terminate_backend(1234);');
      expect(getKillQuery('5678', 'Postgres')).toBe('SELECT pg_terminate_backend(5678);');
    });

    it('generates KILL command for MySQL and MSSQL', () => {
      expect(getKillQuery(99, 'MySql')).toBe('KILL 99;');
      expect(getKillQuery(88, 'Mssql')).toBe('KILL 88;');
    });

    it('generates CLIENT KILL ID command for Redis', () => {
      expect(getKillQuery(102, 'Redis')).toBe('CLIENT KILL ID 102;');
    });

    it('throws error for invalid pid or unsupported engines', () => {
      expect(() => getKillQuery(0, 'Postgres')).toThrow();
      expect(() => getKillQuery('invalid', 'Postgres')).toThrow();
      expect(() => getKillQuery(1, 'Sqlite')).toThrow(/not supported/i);
      expect(() => getKillQuery(1, 'DuckDb')).toThrow(/not supported/i);
    });
  });

  describe('parseProcessListResult', () => {
    it('handles empty results gracefully', () => {
      expect(parseProcessListResult({ columns: [], rows: [], execution_time_ms: 0, rows_affected: 0 })).toEqual([]);
    });

    it('parses PostgreSQL pg_stat_activity output', () => {
      const mockResult: QueryResult = {
        columns: ['pid', 'user', 'database', 'client', 'state', 'duration', 'query'],
        rows: [
          [101, 'postgres', 'testdb', '127.0.0.1', 'active', '00:00:15', 'SELECT * FROM users'],
          [102, 'app_user', 'testdb', '192.168.1.10', 'idle', '00:01:30', 'COMMIT'],
        ],
        execution_time_ms: 5,
        rows_affected: 2,
      };

      const processes = parseProcessListResult(mockResult, 'Postgres');
      expect(processes).toHaveLength(2);
      expect(processes[0]).toEqual({
        pid: 101,
        user: 'postgres',
        database: 'testdb',
        client: '127.0.0.1',
        state: 'active',
        duration: '00:00:15',
        query: 'SELECT * FROM users',
      });
    });

    it('parses MySQL SHOW PROCESSLIST output with varying column casings', () => {
      const mockResult: QueryResult = {
        columns: ['Id', 'User', 'Host', 'db', 'Command', 'Time', 'State', 'Info'],
        rows: [
          [42, 'root', 'localhost:3306', 'ecommerce', 'Query', 12, 'executing', 'SELECT SLEEP(10)'],
        ],
        execution_time_ms: 1,
        rows_affected: 1,
      };

      const processes = parseProcessListResult(mockResult, 'MySql');
      expect(processes).toHaveLength(1);
      expect(processes[0].pid).toBe(42);
      expect(processes[0].user).toBe('root');
      expect(processes[0].database).toBe('ecommerce');
      expect(processes[0].duration).toBe('12s');
      expect(processes[0].query).toBe('SELECT SLEEP(10)');
    });
  });
});
