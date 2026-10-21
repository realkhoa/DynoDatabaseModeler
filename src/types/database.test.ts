/**
 * @file database.test.ts
 * @brief Unit tests for database types and type helper utilities.
 */

import { describe, it, expect } from 'vitest';
import {
  formatCanonicalType,
  isSameCanonicalType,
  getDefaultPort,
  isEmbeddedEngine,
  isUniversalEngine,
  getEngineDialectFamily,
  DATABASE_ENGINES,
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
   * @brief Verifies high-performance isSameCanonicalType equality checks.
   */
  it('accurately checks equality of primitive and parameterized canonical types', () => {
    expect(isSameCanonicalType('Integer', 'Integer')).toBe(true);
    expect(isSameCanonicalType('Integer', 'BigInt')).toBe(false);
    expect(isSameCanonicalType('Text', { Varchar: 255 })).toBe(false);
    expect(isSameCanonicalType({ Varchar: 255 }, { Varchar: 255 })).toBe(true);
    expect(isSameCanonicalType({ Varchar: 255 }, { Varchar: 100 })).toBe(false);
    expect(
      isSameCanonicalType(
        { Decimal: { precision: 10, scale: 2 } },
        { Decimal: { precision: 10, scale: 2 } }
      )
    ).toBe(true);
    expect(
      isSameCanonicalType({ Decimal: { precision: 10 } }, { Decimal: { precision: 10, scale: null } })
    ).toBe(true);
    expect(isSameCanonicalType({ Decimal: { precision: 10 } }, { Decimal: { precision: 8 } })).toBe(false);
    expect(isSameCanonicalType({ Char: 10 }, { Char: 10 })).toBe(true);
    expect(isSameCanonicalType({ Char: 10 }, { Char: 20 })).toBe(false);
    expect(isSameCanonicalType({ Custom: 'citext' }, { Custom: 'citext' })).toBe(true);
    expect(isSameCanonicalType({ Custom: 'citext' }, { Custom: 'jsonb' })).toBe(false);
  });

  /**
   * @brief Verifies default port numbers across all supported database engines.
   */
  it('resolves correct default ports for all database dialects', () => {
    expect(getDefaultPort('Postgres')).toBe(5432);
    expect(getDefaultPort('Universal')).toBe(5432);
    expect(getDefaultPort('CockroachDb')).toBe(26257);
    expect(getDefaultPort('Redshift')).toBe(5439);
    expect(getDefaultPort('MySql')).toBe(3306);
    expect(getDefaultPort('MariaDb')).toBe(3306);
    expect(getDefaultPort('TiDb')).toBe(4000);
    expect(getDefaultPort('ClickHouse')).toBe(8123);
    expect(getDefaultPort('MongoDb')).toBe(27017);
    expect(getDefaultPort('Cassandra')).toBe(9042);
    expect(getDefaultPort('ScyllaDb')).toBe(9042);
    expect(getDefaultPort('SurrealDb')).toBe(8000);
    expect(getDefaultPort('Mssql')).toBe(1433);
    expect(getDefaultPort('Redis')).toBe(6379);
    expect(getDefaultPort('Sqlite')).toBe(0);
    expect(getDefaultPort('LibSql')).toBe(0);
    expect(getDefaultPort('DuckDb')).toBe(0);
  });

  /**
   * @brief Tests embedded engine detection helper.
   */
  it('correctly classifies embedded vs networked database engines', () => {
    expect(isEmbeddedEngine('Sqlite')).toBe(true);
    expect(isEmbeddedEngine('DuckDb')).toBe(true);
    expect(isEmbeddedEngine('LibSql')).toBe(true);
    expect(isEmbeddedEngine('Postgres')).toBe(false);
    expect(isEmbeddedEngine('MySql')).toBe(false);
    expect(isEmbeddedEngine('Universal')).toBe(false);
  });

  /**
   * @brief Tests universal engine detection helper.
   */
  it('identifies universal database engine adapter', () => {
    expect(isUniversalEngine('Universal')).toBe(true);
    expect(isUniversalEngine('Postgres')).toBe(false);
    expect(isUniversalEngine('Sqlite')).toBe(false);
  });

  /**
   * @brief Tests dialect family resolution across database engines.
   */
  it('resolves correct dialect family for all engines', () => {
    expect(getEngineDialectFamily('Postgres')).toBe('postgres');
    expect(getEngineDialectFamily('CockroachDb')).toBe('postgres');
    expect(getEngineDialectFamily('Redshift')).toBe('postgres');
    expect(getEngineDialectFamily('Universal')).toBe('postgres');
    expect(getEngineDialectFamily('MySql')).toBe('mysql');
    expect(getEngineDialectFamily('MariaDb')).toBe('mysql');
    expect(getEngineDialectFamily('TiDb')).toBe('mysql');
    expect(getEngineDialectFamily('ClickHouse')).toBe('clickhouse');
    expect(getEngineDialectFamily('MongoDb')).toBe('mongodb');
    expect(getEngineDialectFamily('Cassandra')).toBe('cassandra');
    expect(getEngineDialectFamily('ScyllaDb')).toBe('cassandra');
    expect(getEngineDialectFamily('SurrealDb')).toBe('surrealdb');
    expect(getEngineDialectFamily('Sqlite')).toBe('sqlite');
    expect(getEngineDialectFamily('LibSql')).toBe('sqlite');
    expect(getEngineDialectFamily('Mssql')).toBe('mssql');
    expect(getEngineDialectFamily('DuckDb')).toBe('duckdb');
    expect(getEngineDialectFamily('Redis')).toBe('redis');
  });

  /**
   * @brief Verifies DATABASE_ENGINES contains all 17 options with metadata.
   */
  it('provides complete DATABASE_ENGINES directory', () => {
    expect(DATABASE_ENGINES).toHaveLength(17);
    const types = DATABASE_ENGINES.map((e) => e.type);
    expect(types).toContain('Universal');
    expect(types).toContain('Redis');
    expect(types).toContain('MongoDb');
    expect(types).toContain('Cassandra');
    expect(types).toContain('ScyllaDb');
    expect(types).toContain('SurrealDb');
    expect(types).toContain('TiDb');
    expect(types).toContain('MariaDb');
    expect(types).toContain('CockroachDb');
    expect(types).toContain('LibSql');
    expect(types).toContain('Redshift');
    expect(types).toContain('ClickHouse');
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

    const universalConfig: ConnectionConfig = {
      id: 'conn-u',
      name: 'Universal DB',
      db_type: 'Universal',
      database: 'prod',
      ssl: true,
      connection_url: 'postgresql://postgres:secret@localhost:5432/prod',
      dialect_family: 'postgres',
    };
    expect(universalConfig.db_type).toBe('Universal');
    expect(universalConfig.connection_url).toContain('postgresql://');

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
