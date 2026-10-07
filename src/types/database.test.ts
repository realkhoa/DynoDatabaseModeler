/**
 * @file database.test.ts
 * @brief Unit tests for database types and type helper utilities.
 */

import { describe, it, expect } from 'vitest';
import {
  formatCanonicalType,
  getDefaultPort,
  type ConnectionConfig,
  type TableSchema,
  type DatabaseSchema,
  type RowUpdatePayload,
} from './database';

describe('database type helpers', () => {
  /**
   * @brief Verifies formatting of primitive CanonicalType variants.
   */
  it('formats primitive canonical types into uppercase strings', () => {
    expect(formatCanonicalType('Integer')).toBe('INTEGER');
    expect(formatCanonicalType('SmallInt')).toBe('SMALLINT');
    expect(formatCanonicalType('BigInt')).toBe('BIGINT');
    expect(formatCanonicalType('Boolean')).toBe('BOOLEAN');
    expect(formatCanonicalType('Text')).toBe('TEXT');
    expect(formatCanonicalType('Uuid')).toBe('UUID');
  });

  /**
   * @brief Verifies formatting of parameterized CanonicalType variants.
   */
  it('formats parameterized types correctly', () => {
    expect(formatCanonicalType({ Varchar: 255 })).toBe('VARCHAR(255)');
    expect(formatCanonicalType({ Varchar: null })).toBe('VARCHAR');
    expect(formatCanonicalType({ Char: 10 })).toBe('CHAR(10)');
    expect(formatCanonicalType({ Char: null })).toBe('CHAR');
    expect(formatCanonicalType({ Decimal: { precision: 10, scale: 2 } })).toBe('DECIMAL(10,2)');
    expect(formatCanonicalType({ Decimal: { precision: 8 } })).toBe('DECIMAL(8)');
    expect(formatCanonicalType({ Decimal: {} })).toBe('DECIMAL');
    expect(formatCanonicalType({ Custom: 'citext' })).toBe('CITEXT');
  });

  /**
   * @brief Verifies default port numbers per database engine.
   */
  it('resolves correct default ports for each database dialect', () => {
    expect(getDefaultPort('Postgres')).toBe(5432);
    expect(getDefaultPort('MySql')).toBe(3306);
    expect(getDefaultPort('Mssql')).toBe(1433);
    expect(getDefaultPort('Sqlite')).toBe(0);
    expect(getDefaultPort('DuckDb')).toBe(0);
  });

  /**
   * @brief Validates TypeScript structural compatibility with ConnectionConfig and DatabaseSchema.
   */
  it('creates valid typed schema structures', () => {
    const config: ConnectionConfig = {
      id: 'conn-1',
      name: 'Test SQLite',
      db_type: 'Sqlite',
      database: 'test.db',
      ssl: false,
    };
    expect(config.db_type).toBe('Sqlite');

    const table: TableSchema = {
      name: 'users',
      columns: [
        {
          name: 'id',
          data_type: 'Integer',
          is_primary_key: true,
          is_nullable: false,
          is_auto_increment: true,
        },
      ],
      foreign_keys: [],
      indexes: [],
    };

    const schema: DatabaseSchema = {
      database_name: 'test_db',
      tables: [table],
    };

    expect(schema.tables).toHaveLength(1);
    expect(schema.tables[0].columns[0].name).toBe('id');
  });

  /**
   * @brief Validates TypeScript structural compatibility with RowUpdatePayload.
   */
  it('creates valid typed RowUpdatePayload structures', () => {
    const payload: RowUpdatePayload = {
      table: 'users',
      primary_keys: { id: 1 },
      updated_values: { username: 'alice_new', is_active: false },
    };

    expect(payload.table).toBe('users');
    expect(payload.primary_keys).toEqual({ id: 1 });
    expect(payload.updated_values).toEqual({ username: 'alice_new', is_active: false });
  });
});

