/**
 * @file sqlCompletion.test.ts
 * @brief Unit tests for schema-aware SQL autocompletion utility functions.
 */

import { describe, it, expect } from 'vitest';
import {
  formatCanonicalType,
  detectCompletionContext,
  getStandardKeywords,
  getStandardFunctions,
  getTableCompletions,
  getColumnCompletions,
  buildSqlCompletions,
  STANDARD_SQL_KEYWORDS,
  STANDARD_SQL_FUNCTIONS,
} from './sqlCompletion';
import type { DatabaseSchema, CanonicalType } from '../types/database';

describe('sqlCompletion utilities', () => {
  describe('formatCanonicalType', () => {
    it('formats simple string canonical types', () => {
      expect(formatCanonicalType('Integer')).toBe('INTEGER');
      expect(formatCanonicalType('BigInt')).toBe('BIGINT');
      expect(formatCanonicalType('SmallInt')).toBe('SMALLINT');
      expect(formatCanonicalType('Float')).toBe('FLOAT');
      expect(formatCanonicalType('Double')).toBe('DOUBLE');
      expect(formatCanonicalType('Text')).toBe('TEXT');
      expect(formatCanonicalType('Boolean')).toBe('BOOLEAN');
      expect(formatCanonicalType('Date')).toBe('DATE');
      expect(formatCanonicalType('Time')).toBe('TIME');
      expect(formatCanonicalType('Timestamp')).toBe('TIMESTAMP');
      expect(formatCanonicalType('Json')).toBe('JSON');
      expect(formatCanonicalType('Uuid')).toBe('UUID');
      expect(formatCanonicalType('Binary')).toBe('BINARY');
    });

    it('formats object canonical types with parameters', () => {
      expect(formatCanonicalType({ Varchar: 255 })).toBe('VARCHAR(255)');
      expect(formatCanonicalType({ Varchar: null })).toBe('VARCHAR');
      expect(formatCanonicalType({ Char: 10 })).toBe('CHAR(10)');
      expect(formatCanonicalType({ Char: null })).toBe('CHAR');
      expect(formatCanonicalType({ Decimal: { precision: 10, scale: 2 } })).toBe('DECIMAL(10, 2)');
      expect(formatCanonicalType({ Decimal: { precision: 8, scale: null } })).toBe('DECIMAL(8, 0)');
      expect(formatCanonicalType({ Decimal: { precision: null, scale: null } })).toBe('DECIMAL');
      expect(formatCanonicalType({ Custom: 'citext' })).toBe('CITEXT');
    });

    it('handles unknown or unexpected canonical types gracefully', () => {
      expect(formatCanonicalType({} as unknown as CanonicalType)).toBe('UNKNOWN');
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
      expect(detectCompletionContext('SELECT * FROM users RIGHT JOIN ')).toEqual({
        context: 'from_table',
      });
      expect(detectCompletionContext('SELECT * FROM users INNER JOIN ')).toEqual({
        context: 'from_table',
      });
      expect(detectCompletionContext('SELECT * FROM users FULL JOIN ')).toEqual({
        context: 'from_table',
      });
      expect(detectCompletionContext('SELECT * FROM users CROSS JOIN ')).toEqual({
        context: 'from_table',
      });
      expect(detectCompletionContext('INSERT INTO ')).toEqual({
        context: 'from_table',
      });
      expect(detectCompletionContext('UPDATE ')).toEqual({
        context: 'from_table',
      });
      expect(detectCompletionContext('DELETE FROM ')).toEqual({
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

  describe('standard keywords and functions', () => {
    it('returns keywords list without mutating source', () => {
      const keywords = getStandardKeywords();
      expect(keywords.length).toBeGreaterThan(20);
      expect(keywords).toContain('SELECT');
      expect(keywords).toContain('FROM');
      expect(keywords).toContain('WHERE');

      keywords.push('CUSTOM_KW');
      expect(STANDARD_SQL_KEYWORDS).not.toContain('CUSTOM_KW');
    });

    it('returns functions list matching standard function definitions', () => {
      const functions = getStandardFunctions();
      expect(functions.length).toBe(STANDARD_SQL_FUNCTIONS.length);
      expect(functions).toContain('COUNT');
      expect(functions).toContain('COALESCE');
      expect(functions).toContain('NOW');
    });
  });

  describe('table and column completions', () => {
    const mockSchema: DatabaseSchema = {
      database_name: 'test_db',
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
              default_value: "'unknown@example.com'",
            },
            {
              name: 'created_at',
              data_type: 'Timestamp',
              is_primary_key: false,
              is_nullable: true,
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
      expect(items[0].detail).toContain('3 columns');
      expect(items[0].documentation).toContain('**id**: `INTEGER` [PK]');
      expect(items[0].documentation).toContain('**email**: `VARCHAR(255)`');
      expect(items[0].documentation).toContain('**created_at**: `TIMESTAMP` (Nullable)');
      expect(items[0].sortText).toBe('1_users');
    });

    it('filters columns strictly to target table in dot_column context', () => {
      const userCols = getColumnCompletions(mockSchema.tables, 'users');
      expect(userCols).toHaveLength(3);
      expect(userCols.map((c) => c.label)).toEqual(['id', 'email', 'created_at']);
      expect(userCols[0].detail).toContain('[PK]');
      expect(userCols[0].sortText).toBe('00_id'); // Primary key sorted first
      expect(userCols[1].sortText).toBe('01_email');
      expect(userCols[1].documentation).toContain("Default:* `'unknown@example.com'`");
    });

    it('handles case-insensitive target table name matching', () => {
      const userCols = getColumnCompletions(mockSchema.tables, 'USERS');
      expect(userCols).toHaveLength(3);
      expect(userCols[0].label).toBe('id');
    });

    it('falls back to all columns when target table is unknown', () => {
      const allCols = getColumnCompletions(mockSchema.tables, 'nonexistent');
      expect(allCols).toHaveLength(5);
      // In dot_column context with fallback, primary keys are still prioritized first
      expect(allCols.some((c) => c.sortText.startsWith('00_'))).toBe(true);
    });

    it('uses prefix 2_ for column sortText when targetTable is undefined (general context)', () => {
      const allCols = getColumnCompletions(mockSchema.tables);
      expect(allCols).toHaveLength(5);
      expect(allCols.every((c) => c.sortText.startsWith('2_'))).toBe(true);
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
      expect(tableItem?.kind).toBe(6);
    });

    it('returns only target table columns when dot_column context is detected', () => {
      const mockMonaco = {
        languages: {
          CompletionItemKind: { Keyword: 13, Function: 2, Class: 6, Field: 4 },
          CompletionItemInsertTextRule: { InsertAsSnippet: 4 },
        },
      };
      const range = { startLineNumber: 1, startColumn: 1, endLineNumber: 1, endColumn: 7 };
      const suggestions = buildSqlCompletions('SELECT users.', mockSchema, range, mockMonaco);

      expect(suggestions).toHaveLength(3);
      expect(suggestions.map((s) => s.label)).toEqual(['id', 'email', 'created_at']);
      expect(suggestions.every((s) => s.kind === 4)).toBe(true);
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
      expect(suggestions.some((s) => s.label === 'COUNT')).toBe(true);
    });

    it('handles missing monaco object gracefully using fallback kinds', () => {
      const range = { startLineNumber: 1, startColumn: 1, endLineNumber: 1, endColumn: 1 };
      const suggestions = buildSqlCompletions('SELECT ', null, range, null);
      expect(suggestions.length).toBeGreaterThan(0);
      expect(suggestions[0].kind).toBeDefined();
    });
  });
});
