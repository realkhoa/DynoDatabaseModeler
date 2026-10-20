import { describe, it, expect } from 'vitest';
import {
  escapeIdentifier,
  buildPaginatedSelectQuery,
  buildCountQuery,
  applySafeLimit,
  extractPaginationInfo,
} from './sqlPagination';

describe('sqlPagination utilities', () => {
  describe('escapeIdentifier', () => {
    it('escapes with double quotes for SQLite, Postgres, and DuckDB', () => {
      expect(escapeIdentifier('users', 'Sqlite')).toBe('"users"');
      expect(escapeIdentifier('public.users', 'Postgres')).toBe('"public"."users"');
      expect(escapeIdentifier('items', 'DuckDb')).toBe('"items"');
    });

    it('escapes with backticks for MySQL', () => {
      expect(escapeIdentifier('users', 'MySql')).toBe('`users`');
      expect(escapeIdentifier('db.users', 'MySql')).toBe('`db`.`users`');
    });

    it('escapes with square brackets for Mssql', () => {
      expect(escapeIdentifier('users', 'Mssql')).toBe('[users]');
      expect(escapeIdentifier('dbo.users', 'Mssql')).toBe('[dbo].[users]');
    });
  });

  describe('buildPaginatedSelectQuery', () => {
    it('generates LIMIT and OFFSET for SQLite, Postgres, MySQL, DuckDB', () => {
      const pgSql = buildPaginatedSelectQuery('users', 'Postgres', 50, 0);
      expect(pgSql).toBe('SELECT * FROM "users" LIMIT 50 OFFSET 0;');

      const pgPage2 = buildPaginatedSelectQuery('public.orders', 'Postgres', 25, 2);
      expect(pgPage2).toBe('SELECT * FROM "public"."orders" LIMIT 25 OFFSET 50;');

      const mySql = buildPaginatedSelectQuery('customers', 'MySql', 100, 1);
      expect(mySql).toBe('SELECT * FROM `customers` LIMIT 100 OFFSET 100;');
    });

    it('generates ORDER BY and OFFSET FETCH NEXT for Mssql', () => {
      const mssqlWithPk = buildPaginatedSelectQuery('dbo.users', 'Mssql', 50, 0, 'id');
      expect(mssqlWithPk).toBe('SELECT * FROM [dbo].[users] ORDER BY [id] OFFSET 0 ROWS FETCH NEXT 50 ROWS ONLY;');

      const mssqlNoPk = buildPaginatedSelectQuery('logs', 'Mssql', 25, 1);
      expect(mssqlNoPk).toBe('SELECT * FROM [logs] ORDER BY (SELECT NULL) OFFSET 25 ROWS FETCH NEXT 25 ROWS ONLY;');
    });
  });

  describe('buildCountQuery', () => {
    it('generates SELECT COUNT(*) with escaped table name', () => {
      expect(buildCountQuery('users', 'Sqlite')).toBe('SELECT COUNT(*) AS total_count FROM "users";');
      expect(buildCountQuery('public.orders', 'Postgres')).toBe('SELECT COUNT(*) AS total_count FROM "public"."orders";');
      expect(buildCountQuery('dbo.users', 'Mssql')).toBe('SELECT COUNT(*) AS total_count FROM [dbo].[users];');
    });
  });

  describe('applySafeLimit', () => {
    it('injects LIMIT clause if SELECT lacks LIMIT and db is Postgres/MySQL/SQLite/DuckDB', () => {
      const res = applySafeLimit('SELECT * FROM users', 'Postgres', 500);
      expect(res.applied).toBe(true);
      expect(res.sql).toBe('SELECT * FROM users LIMIT 500;');
    });

    it('injects FETCH NEXT if SELECT lacks limit and db is Mssql', () => {
      const res = applySafeLimit('SELECT * FROM users', 'Mssql', 500);
      expect(res.applied).toBe(true);
      expect(res.sql).toBe('SELECT * FROM users ORDER BY (SELECT NULL) OFFSET 0 ROWS FETCH NEXT 500 ROWS ONLY;');
    });

    it('does not inject limit if query already has LIMIT or FETCH', () => {
      const res1 = applySafeLimit('SELECT * FROM users LIMIT 10', 'Postgres', 500);
      expect(res1.applied).toBe(false);
      expect(res1.sql).toBe('SELECT * FROM users LIMIT 10');

      const res2 = applySafeLimit('SELECT * FROM users OFFSET 0 ROWS FETCH NEXT 50 ROWS ONLY', 'Mssql', 500);
      expect(res2.applied).toBe(false);
    });

    it('does not alter non-SELECT statements', () => {
      const res = applySafeLimit('UPDATE users SET name = "Test"', 'Sqlite', 500);
      expect(res.applied).toBe(false);
      expect(res.sql).toBe('UPDATE users SET name = "Test"');
    });
  });

  describe('extractPaginationInfo', () => {
    it('extracts limit and offset from standard SQL', () => {
      const info = extractPaginationInfo('SELECT * FROM users LIMIT 50 OFFSET 100;');
      expect(info).toEqual({ limit: 50, offset: 100 });
    });

    it('extracts limit and offset from MSSQL FETCH query', () => {
      const info = extractPaginationInfo('SELECT * FROM users ORDER BY id OFFSET 50 ROWS FETCH NEXT 25 ROWS ONLY;');
      expect(info).toEqual({ limit: 25, offset: 50 });
    });

    it('returns null when no pagination is present', () => {
      expect(extractPaginationInfo('SELECT * FROM users')).toBeNull();
    });
  });
});
