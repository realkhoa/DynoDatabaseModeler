/**
 * @file mockDataGenerator.test.ts
 * @brief Unit tests for the synthetic mock data generator.
 */

import { describe, it, expect } from 'vitest';
import {
  detectDefaultGenerator,
  generateRowValue,
  formatSqlLiteral,
  quoteIdentifier,
  generateMockSql,
  generateMockUuid,
} from './mockDataGenerator';
import type { ColumnSchema } from '../types/database';

describe('mockDataGenerator', () => {
  const dummyCol = (name: string, data_type: any, is_nullable = false): ColumnSchema => ({
    name,
    data_type,
    is_nullable,
    is_primary_key: false,
    is_auto_increment: false,
  });

  describe('detectDefaultGenerator', () => {
    it('detects email generator from column name', () => {
      expect(detectDefaultGenerator(dummyCol('user_email', 'String'))).toBe('Email');
      expect(detectDefaultGenerator(dummyCol('contact_mail', 'String'))).toBe('Email');
    });

    it('detects names and phone numbers', () => {
      expect(detectDefaultGenerator(dummyCol('full_name', 'String'))).toBe('FullName');
      expect(detectDefaultGenerator(dummyCol('first_name', 'String'))).toBe('FirstName');
      expect(detectDefaultGenerator(dummyCol('last_name', 'String'))).toBe('LastName');
      expect(detectDefaultGenerator(dummyCol('mobile_phone', 'String'))).toBe('PhoneNumber');
    });

    it('detects UUIDs and IDs', () => {
      expect(detectDefaultGenerator(dummyCol('id', 'Uuid'))).toBe('Uuid');
      expect(detectDefaultGenerator(dummyCol('user_id', 'Integer'))).toBe('Integer');
      expect(detectDefaultGenerator(dummyCol('external_uuid', 'String'))).toBe('Uuid');
    });

    it('detects addresses and companies', () => {
      expect(detectDefaultGenerator(dummyCol('company_name', 'String'))).toBe('Company');
      expect(detectDefaultGenerator(dummyCol('city', 'String'))).toBe('City');
      expect(detectDefaultGenerator(dummyCol('country', 'String'))).toBe('Country');
      expect(detectDefaultGenerator(dummyCol('street_address', 'String'))).toBe('StreetAddress');
    });

    it('detects dates and timestamps', () => {
      expect(detectDefaultGenerator(dummyCol('created_at', 'Timestamp'))).toBe('Timestamp');
      expect(detectDefaultGenerator(dummyCol('birth_date', 'Date'))).toBe('Date');
    });

    it('falls back to column type when name does not match pattern', () => {
      expect(detectDefaultGenerator(dummyCol('flag_x', 'Boolean'))).toBe('Boolean');
      expect(detectDefaultGenerator(dummyCol('score_val', 'Float'))).toBe('Float');
      expect(detectDefaultGenerator(dummyCol('notes', 'Text'))).toBe('LoremSentence');
    });
  });

  describe('generateRowValue', () => {
    it('generates sequential autoincrement integers', () => {
      const col = dummyCol('id', 'Integer');
      const val0 = generateRowValue(col, { generatorType: 'Integer', isAutoIncrement: true }, 0);
      const val1 = generateRowValue(col, { generatorType: 'Integer', isAutoIncrement: true }, 1);
      expect(val0).toBe(1);
      expect(val1).toBe(2);
    });

    it('generates UUIDs', () => {
      const col = dummyCol('uuid', 'Uuid');
      const val = generateRowValue(col, { generatorType: 'Uuid' }, 0);
      expect(typeof val).toBe('string');
      expect(val).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
    });

    it('generates boolean values', () => {
      const col = dummyCol('is_active', 'Boolean');
      const val = generateRowValue(col, { generatorType: 'Boolean' }, 0);
      expect(typeof val).toBe('boolean');
    });

    it('respects constant value generator', () => {
      const col = dummyCol('role', 'String');
      const val = generateRowValue(col, { generatorType: 'Constant', constantValue: 'ADMIN' }, 0);
      expect(val).toBe('ADMIN');
    });

    it('respects nullPercentage for nullable columns', () => {
      const col = dummyCol('middle_name', 'String', true);
      const val = generateRowValue(col, { generatorType: 'FirstName', nullPercentage: 100 }, 0);
      expect(val).toBeNull();
    });
  });

  describe('generateMockUuid', () => {
    it('returns a standard UUID v4 string', () => {
      const uuid = generateMockUuid();
      expect(uuid.length).toBe(36);
      expect(uuid.charAt(14)).toBe('4');
    });
  });

  describe('formatSqlLiteral', () => {
    it('formats null values as NULL literal', () => {
      expect(formatSqlLiteral(null, dummyCol('x', 'String'))).toBe('NULL');
      expect(formatSqlLiteral(undefined, dummyCol('x', 'String'))).toBe('NULL');
    });

    it('formats numbers directly without quotes', () => {
      expect(formatSqlLiteral(42, dummyCol('x', 'Integer'))).toBe('42');
      expect(formatSqlLiteral(3.14, dummyCol('x', 'Float'))).toBe('3.14');
    });

    it('formats booleans as TRUE/FALSE', () => {
      expect(formatSqlLiteral(true, dummyCol('x', 'Boolean'))).toBe('TRUE');
      expect(formatSqlLiteral(false, dummyCol('x', 'Boolean'))).toBe('FALSE');
    });

    it('escapes single quotes in string values', () => {
      expect(formatSqlLiteral("O'Connor", dummyCol('x', 'String'))).toBe("'O''Connor'");
    });
  });

  describe('quoteIdentifier', () => {
    it('quotes with double quotes for Postgres and SQLite', () => {
      expect(quoteIdentifier('users', 'Postgres')).toBe('"users"');
      expect(quoteIdentifier('users', 'Sqlite')).toBe('"users"');
    });

    it('quotes with backticks for MySQL', () => {
      expect(quoteIdentifier('users', 'MySql')).toBe('`users`');
    });

    it('quotes with square brackets for MSSQL', () => {
      expect(quoteIdentifier('users', 'Mssql')).toBe('[users]');
    });
  });

  describe('generateMockSql', () => {
    it('returns empty string if rowCount is zero or columns are empty', () => {
      expect(generateMockSql('users', [], {}, 10)).toBe('');
      expect(generateMockSql('users', [dummyCol('id', 'Integer')], {}, 0)).toBe('');
    });

    it('synthesizes multi-row INSERT statement with correct column count', () => {
      const cols = [
        dummyCol('id', 'Integer'),
        dummyCol('name', 'String'),
        dummyCol('email', 'String'),
      ];
      const sql = generateMockSql(
        'users',
        cols,
        {
          id: { generatorType: 'Integer', isAutoIncrement: true },
          name: { generatorType: 'FullName' },
          email: { generatorType: 'Email' },
        },
        3,
        'Postgres'
      );

      expect(sql).toContain('INSERT INTO "users" ("id", "name", "email")');
      expect(sql).toContain('VALUES');
      const lines = sql.split('\n');
      expect(lines.length).toBeGreaterThan(3);
      expect(sql.endsWith(';')).toBe(true);
    });
  });
});
