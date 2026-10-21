/**
 * @file dataImporter.test.ts
 * @brief Unit tests for CSV/JSON data importer utilities, parsers, type inference, and batch SQL generation.
 */

import { describe, it, expect } from 'vitest';
import type { ColumnSchema } from '../types/database';
import {
  detectDelimiter,
  parseCsv,
  parseJsonData,
  inferColumnType,
  autoMapColumns,
  formatSqlValue,
  generateBatchInsertSql,
} from './dataImporter';

describe('dataImporter utilities', () => {
  describe('detectDelimiter', () => {
    it('detects comma delimiter by default', () => {
      expect(detectDelimiter('id,name,email\n1,Alice,alice@example.com')).toBe(',');
    });

    it('detects semicolon delimiter', () => {
      expect(detectDelimiter('id;name;email\n1;Bob;bob@example.com')).toBe(';');
    });

    it('detects tab delimiter', () => {
      expect(detectDelimiter('id\tname\temail\n1\tCharlie\tcharlie@example.com')).toBe('\t');
    });

    it('detects pipe delimiter', () => {
      expect(detectDelimiter('id|name|email\n1|Dave|dave@example.com')).toBe('|');
    });
  });

  describe('parseCsv', () => {
    it('parses standard comma-separated CSV with headers and rows', () => {
      const csv = 'id,name,score\n1,Alice,95\n2,Bob,88';
      const result = parseCsv(csv);

      expect(result.headers).toEqual(['id', 'name', 'score']);
      expect(result.totalRows).toBe(2);
      expect(result.rows).toEqual([
        ['1', 'Alice', '95'],
        ['2', 'Bob', '88'],
      ]);
    });

    it('handles quoted cells with commas and escaped quotes', () => {
      const csv = 'id,name,bio\n1,"Doe, John","He said ""Hello world!"""\n2,"Smith, Jane","Developer"';
      const result = parseCsv(csv);

      expect(result.headers).toEqual(['id', 'name', 'bio']);
      expect(result.rows[0]).toEqual(['1', 'Doe, John', 'He said "Hello world!"']);
      expect(result.rows[1]).toEqual(['2', 'Smith, Jane', 'Developer']);
    });

    it('handles multiline cells enclosed in quotes', () => {
      const csv = 'id,description\n1,"Line 1\nLine 2\nLine 3"\n2,"Simple"';
      const result = parseCsv(csv);

      expect(result.totalRows).toBe(2);
      expect(result.rows[0][1]).toBe('Line 1\nLine 2\nLine 3');
      expect(result.rows[1][1]).toBe('Simple');
    });

    it('returns empty result on empty or blank CSV string', () => {
      expect(parseCsv('')).toEqual({
        headers: [],
        rows: [],
        totalRows: 0,
        format: 'csv',
        delimiter: ',',
      });
    });
  });

  describe('parseJsonData', () => {
    it('parses standard JSON array of objects', () => {
      const json = JSON.stringify([
        { id: 1, name: 'Alice', role: 'Admin' },
        { id: 2, name: 'Bob', role: 'User' },
      ]);
      const result = parseJsonData(json);

      expect(result.headers).toEqual(['id', 'name', 'role']);
      expect(result.totalRows).toBe(2);
      expect(result.rows).toEqual([
        [1, 'Alice', 'Admin'],
        [2, 'Bob', 'User'],
      ]);
    });

    it('handles objects with varying property sets across items', () => {
      const json = JSON.stringify([
        { id: 1, name: 'Alice' },
        { id: 2, role: 'Editor', is_active: true },
      ]);
      const result = parseJsonData(json);

      expect(result.headers).toContain('id');
      expect(result.headers).toContain('name');
      expect(result.headers).toContain('role');
      expect(result.headers).toContain('is_active');
      expect(result.totalRows).toBe(2);
    });

    it('handles wrapped payload containing an array property', () => {
      const json = JSON.stringify({
        data: [
          { sku: 'A1', price: 10.5 },
          { sku: 'B2', price: 20.0 },
        ],
      });
      const result = parseJsonData(json);

      expect(result.headers).toEqual(['sku', 'price']);
      expect(result.totalRows).toBe(2);
    });

    it('throws meaningful error on invalid JSON syntax', () => {
      expect(() => parseJsonData('{ bad: json')).toThrow(/invalid json/i);
    });
  });

  describe('inferColumnType', () => {
    it('infers Boolean for boolean values', () => {
      expect(inferColumnType(['true', 'false', 'true'])).toBe('Boolean');
      expect(inferColumnType([true, false])).toBe('Boolean');
      expect(inferColumnType(['1', '0', '1'])).toBe('Boolean');
    });

    it('infers Integer and BigInt for whole numbers', () => {
      expect(inferColumnType(['1', '42', '100'])).toBe('Integer');
      expect(inferColumnType(['9999999999999'])).toBe('BigInt');
    });

    it('infers Float for fractional numbers', () => {
      expect(inferColumnType(['1.5', '2.75', '3.14159'])).toBe('Float');
    });

    it('infers Timestamp for ISO date strings', () => {
      expect(inferColumnType(['2026-01-15T12:00:00Z', '2026-05-20'])).toBe('Timestamp');
    });

    it('infers Json for serialized objects and arrays', () => {
      expect(inferColumnType(['{"key": "value"}', '{"tags": [1, 2]}'])).toBe('Json');
    });

    it('infers Text for long string content and Varchar for short content', () => {
      expect(inferColumnType(['hello', 'world'])).toEqual({ Varchar: 50 });
      expect(inferColumnType(['a'.repeat(300)])).toBe('Text');
    });
  });

  describe('autoMapColumns', () => {
    const targetCols: ColumnSchema[] = [
      {
        name: 'id',
        data_type: 'Integer',
        is_primary_key: true,
        is_nullable: false,
        is_auto_increment: true,
      },
      {
        name: 'user_name',
        data_type: { Varchar: 100 },
        is_primary_key: false,
        is_nullable: false,
        is_auto_increment: false,
      },
      {
        name: 'email_address',
        data_type: { Varchar: 255 },
        is_primary_key: false,
        is_nullable: false,
        is_auto_increment: false,
      },
      {
        name: 'is_active',
        data_type: 'Boolean',
        is_primary_key: false,
        is_nullable: false,
        is_auto_increment: false,
      },
    ];

    it('maps exact and case-insensitive column names', () => {
      const mapping = autoMapColumns(['ID', 'user_name'], targetCols);
      expect(mapping['ID']).toBe('id');
      expect(mapping['user_name']).toBe('user_name');
    });

    it('maps camelCase and stripped names to snake_case target columns', () => {
      const mapping = autoMapColumns(['userName', 'emailaddress', 'isActive'], targetCols);
      expect(mapping['userName']).toBe('user_name');
      expect(mapping['emailaddress']).toBe('email_address');
      expect(mapping['isActive']).toBe('is_active');
    });

    it('sets unmapped source headers to null', () => {
      const mapping = autoMapColumns(['non_existent_column'], targetCols);
      expect(mapping['non_existent_column']).toBeNull();
    });
  });

  describe('formatSqlValue', () => {
    it('formats null, undefined, and empty string as NULL', () => {
      expect(formatSqlValue(null)).toBe('NULL');
      expect(formatSqlValue(undefined)).toBe('NULL');
      expect(formatSqlValue('')).toBe('NULL');
    });

    it('formats numbers and booleans as unquoted literals', () => {
      expect(formatSqlValue(42)).toBe('42');
      expect(formatSqlValue(3.14)).toBe('3.14');
      expect(formatSqlValue(true)).toBe('TRUE');
      expect(formatSqlValue(false)).toBe('FALSE');
    });

    it('escapes single quotes in strings', () => {
      expect(formatSqlValue("O'Connor")).toBe("'O''Connor'");
    });

    it('formats objects and arrays as escaped JSON string literals', () => {
      expect(formatSqlValue({ foo: "bar's" })).toBe("'{\"foo\":\"bar''s\"}'");
    });
  });

  describe('generateBatchInsertSql', () => {
    const headers = ['id', 'user_name', 'email'];
    const rows = [
      [1, 'alice', 'alice@test.com'],
      [2, 'bob', 'bob@test.com'],
      [3, 'charlie', 'charlie@test.com'],
    ];
    const mapping = {
      id: 'id',
      user_name: 'username',
      email: 'email',
    };

    it('generates PostgreSQL batch insert with transaction', () => {
      const sql = generateBatchInsertSql({
        tableName: 'users',
        columnMapping: mapping,
        headers,
        rows,
        dbType: 'Postgres',
        onConflict: 'ignore',
        chunkSize: 10,
      });

      expect(sql).toContain('BEGIN;');
      expect(sql).toContain('INSERT INTO "users" ("id", "username", "email")');
      expect(sql).toContain("VALUES\n  (1, 'alice', 'alice@test.com'),");
      expect(sql).toContain('ON CONFLICT DO NOTHING;');
      expect(sql).toContain('COMMIT;');
    });

    it('generates MySQL batch insert with backticks and INSERT IGNORE', () => {
      const sql = generateBatchInsertSql({
        tableName: 'users',
        columnMapping: mapping,
        headers,
        rows,
        dbType: 'MySql',
        onConflict: 'ignore',
        chunkSize: 10,
      });

      expect(sql).toContain('INSERT IGNORE INTO `users` (`id`, `username`, `email`)');
    });

    it('generates SQLite batch insert with INSERT OR REPLACE', () => {
      const sql = generateBatchInsertSql({
        tableName: 'users',
        columnMapping: mapping,
        headers,
        rows,
        dbType: 'Sqlite',
        onConflict: 'replace',
        chunkSize: 10,
      });

      expect(sql).toContain('INSERT OR REPLACE INTO "users" ("id", "username", "email")');
    });

    it('chunks large batches into multiple statements', () => {
      const sql = generateBatchInsertSql({
        tableName: 'users',
        columnMapping: mapping,
        headers,
        rows,
        dbType: 'Postgres',
        chunkSize: 2,
      });

      // 3 rows with chunk size 2 -> 2 INSERT statements
      const insertCount = (sql.match(/INSERT INTO/g) || []).length;
      expect(insertCount).toBe(2);
    });

    it('skips columns mapped to null', () => {
      const partialMapping = {
        id: 'id',
        user_name: null,
        email: 'email',
      };
      const sql = generateBatchInsertSql({
        tableName: 'users',
        columnMapping: partialMapping,
        headers,
        rows,
        dbType: 'Postgres',
      });

      expect(sql).toContain('("id", "email")');
      expect(sql).not.toContain('"username"');
      expect(sql).toContain("(1, 'alice@test.com')");
    });
  });
});
