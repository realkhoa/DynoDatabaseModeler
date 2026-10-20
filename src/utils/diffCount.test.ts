/**
 * @file diffCount.test.ts
 * @brief Unit tests for computePendingChangesCount schema diff counter utility.
 */

import { describe, it, expect } from 'vitest';
import { computePendingChangesCount } from './diffCount';
import type { DatabaseSchema } from '../types/database';

describe('computePendingChangesCount', () => {
  const baseSchema: DatabaseSchema = {
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
          },
        ],
        foreign_keys: [],
        indexes: [],
      },
    ],
  };

  /**
   * @brief Verifies that null or undefined inputs return zero count.
   */
  it('returns 0 when either live or desired schema is null or undefined', () => {
    expect(computePendingChangesCount(null, baseSchema)).toBe(0);
    expect(computePendingChangesCount(baseSchema, undefined)).toBe(0);
    expect(computePendingChangesCount(null, null)).toBe(0);
  });

  /**
   * @brief Verifies that identical schemas yield zero pending changes.
   */
  it('returns 0 when schemas are structurally identical', () => {
    const identicalSchema: DatabaseSchema = JSON.parse(JSON.stringify(baseSchema));
    expect(computePendingChangesCount(baseSchema, identicalSchema)).toBe(0);
  });

  /**
   * @brief Verifies counting newly added tables.
   */
  it('counts newly added tables correctly', () => {
    const desired: DatabaseSchema = {
      database_name: 'test_db',
      tables: [
        ...baseSchema.tables,
        {
          name: 'posts',
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
        },
      ],
    };

    expect(computePendingChangesCount(baseSchema, desired)).toBe(1);
  });

  /**
   * @brief Verifies counting dropped tables.
   */
  it('counts dropped tables correctly', () => {
    const desired: DatabaseSchema = {
      database_name: 'test_db',
      tables: [],
    };

    expect(computePendingChangesCount(baseSchema, desired)).toBe(1);
  });

  /**
   * @brief Verifies counting added and dropped columns in existing tables.
   */
  it('counts added and dropped columns correctly', () => {
    const desired: DatabaseSchema = {
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
            // email is dropped (-1)
            // age is added (+1)
            {
              name: 'age',
              data_type: 'SmallInt',
              is_primary_key: false,
              is_nullable: true,
              is_auto_increment: false,
            },
          ],
          foreign_keys: [],
          indexes: [],
        },
      ],
    };

    expect(computePendingChangesCount(baseSchema, desired)).toBe(2);
  });

  /**
   * @brief Verifies counting altered column definitions.
   */
  it('counts altered column types and nullability constraints', () => {
    const desired: DatabaseSchema = {
      database_name: 'test_db',
      tables: [
        {
          name: 'users',
          columns: [
            {
              name: 'id',
              data_type: 'BigInt', // Changed type
              is_primary_key: true,
              is_nullable: false,
              is_auto_increment: true,
            },
            {
              name: 'email',
              data_type: { Varchar: 255 },
              is_primary_key: false,
              is_nullable: true, // Changed nullable
              is_auto_increment: false,
            },
          ],
          foreign_keys: [],
          indexes: [],
        },
      ],
    };

    expect(computePendingChangesCount(baseSchema, desired)).toBe(2);
  });

  /**
   * @brief Verifies counting added, dropped, and altered foreign key constraints.
   */
  it('counts foreign key additions and alterations', () => {
    const withFk: DatabaseSchema = {
      database_name: 'test_db',
      tables: [
        {
          ...baseSchema.tables[0],
          foreign_keys: [
            {
              constraint_name: 'fk_users_org',
              source_column: 'org_id',
              target_table: 'organizations',
              target_column: 'id',
              on_delete: 'Cascade',
              on_update: 'NoAction',
            },
          ],
        },
      ],
    };

    // 1 FK added compared to baseSchema
    expect(computePendingChangesCount(baseSchema, withFk)).toBe(1);

    // Altered action on existing FK
    const withAlteredFk: DatabaseSchema = {
      database_name: 'test_db',
      tables: [
        {
          ...baseSchema.tables[0],
          foreign_keys: [
            {
              constraint_name: 'fk_users_org',
              source_column: 'org_id',
              target_table: 'organizations',
              target_column: 'id',
              on_delete: 'SetNull', // Changed action
              on_update: 'NoAction',
            },
          ],
        },
      ],
    };

    // An altered constraint is replaced: the old constraint is dropped and the new one added, and
    // the change tree shows both entries.
    expect(computePendingChangesCount(withFk, withAlteredFk)).toBe(2);
  });
});
