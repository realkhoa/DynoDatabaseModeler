/**
 * @file schemaHealthAdvisor.test.ts
 * @brief Unit tests for Database Schema Health Advisor & Linter.
 */

import { describe, it, expect } from 'vitest';
import type { DatabaseSchema } from '../types/database';
import { analyzeSchemaHealth, isReservedKeyword } from './schemaHealthAdvisor';

describe('schemaHealthAdvisor utilities', () => {
  describe('isReservedKeyword', () => {
    it('identifies standard SQL keywords correctly', () => {
      expect(isReservedKeyword('order')).toBe(true);
      expect(isReservedKeyword('user')).toBe(true);
      expect(isReservedKeyword('table')).toBe(true);
      expect(isReservedKeyword('custom_accounts')).toBe(false);
    });
  });

  describe('analyzeSchemaHealth', () => {
    it('returns score 100 and Excellent grade for empty schema', () => {
      const emptySchema: DatabaseSchema = {
        database_name: 'test_db',
        tables: [],
      };
      const report = analyzeSchemaHealth(emptySchema);

      expect(report.score).toBe(100);
      expect(report.scoreGrade).toBe('Excellent');
      expect(report.issues.length).toBe(0);
    });

    it('detects missing primary key as a critical issue with quick-fix SQL', () => {
      const badSchema: DatabaseSchema = {
        database_name: 'test_db',
        tables: [
          {
            name: 'logs',
            columns: [
              {
                name: 'message',
                data_type: 'Text',
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

      const report = analyzeSchemaHealth(badSchema, 'Postgres');
      expect(report.criticalCount).toBe(1);
      expect(report.score).toBeLessThan(100);

      const pkIssue = report.issues.find((i) => i.id.startsWith('missing-pk'));
      expect(pkIssue).toBeDefined();
      expect(pkIssue?.severity).toBe('critical');
      expect(pkIssue?.quickFixSql).toContain('ALTER TABLE "logs" ADD COLUMN');
    });

    it('detects unindexed foreign keys and provides CREATE INDEX quick-fix', () => {
      const fkSchema: DatabaseSchema = {
        database_name: 'test_db',
        tables: [
          {
            name: 'orders',
            columns: [
              {
                name: 'id',
                data_type: 'Integer',
                is_primary_key: true,
                is_nullable: false,
                is_auto_increment: true,
              },
              {
                name: 'customer_id',
                data_type: 'Integer',
                is_primary_key: false,
                is_nullable: false,
                is_auto_increment: false,
              },
            ],
            foreign_keys: [
              {
                constraint_name: 'fk_orders_customer',
                source_column: 'customer_id',
                target_table: 'customers',
                target_column: 'id',
                on_delete: 'Cascade',
                on_update: 'NoAction',
              },
            ],
            indexes: [], // No index covering customer_id
          },
        ],
      };

      const report = analyzeSchemaHealth(fkSchema, 'Postgres');
      expect(report.warningCount).toBeGreaterThanOrEqual(1);

      const unindexedFk = report.issues.find((i) => i.id.startsWith('unindexed-fk'));
      expect(unindexedFk).toBeDefined();
      expect(unindexedFk?.quickFixSql).toContain('CREATE INDEX "idx_orders_customer_id" ON "orders" ("customer_id")');
    });

    it('detects redundant duplicate index and offers DROP INDEX fix', () => {
      const redundantSchema: DatabaseSchema = {
        database_name: 'test_db',
        tables: [
          {
            name: 'items',
            columns: [
              {
                name: 'id',
                data_type: 'Integer',
                is_primary_key: true,
                is_nullable: false,
                is_auto_increment: true,
              },
              {
                name: 'category_id',
                data_type: 'Integer',
                is_primary_key: false,
                is_nullable: false,
                is_auto_increment: false,
              },
              {
                name: 'status',
                data_type: { Varchar: 50 },
                is_primary_key: false,
                is_nullable: false,
                is_auto_increment: false,
              },
            ],
            foreign_keys: [],
            indexes: [
              {
                name: 'idx_items_cat',
                columns: ['category_id'],
                is_unique: false,
              },
              {
                name: 'idx_items_cat_status',
                columns: ['category_id', 'status'], // Composite index already covers category_id!
                is_unique: false,
              },
            ],
          },
        ],
      };

      const report = analyzeSchemaHealth(redundantSchema, 'Postgres');
      const redundantIssue = report.issues.find((i) => i.id.startsWith('redundant-index'));
      expect(redundantIssue).toBeDefined();
      expect(redundantIssue?.quickFixSql).toContain('DROP INDEX "idx_items_cat";');
    });

    it('detects financial amounts stored as Float/Double', () => {
      const moneySchema: DatabaseSchema = {
        database_name: 'test_db',
        tables: [
          {
            name: 'payments',
            columns: [
              {
                name: 'id',
                data_type: 'Integer',
                is_primary_key: true,
                is_nullable: false,
                is_auto_increment: true,
              },
              {
                name: 'total_amount',
                data_type: 'Float',
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

      const report = analyzeSchemaHealth(moneySchema, 'Postgres');
      const moneyIssue = report.issues.find((i) => i.id.startsWith('float-financial'));
      expect(moneyIssue).toBeDefined();
      expect(moneyIssue?.quickFixSql).toContain('TYPE DECIMAL(12, 2);');
    });

    it('bundles all available quick fixes into a transaction script', () => {
      const mixedSchema: DatabaseSchema = {
        database_name: 'test_db',
        tables: [
          {
            name: 'orders',
            columns: [
              {
                name: 'id',
                data_type: 'Integer',
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
            foreign_keys: [
              {
                constraint_name: 'fk_orders_user',
                source_column: 'user_id',
                target_table: 'users',
                target_column: 'id',
                on_delete: 'Cascade',
                on_update: 'NoAction',
              },
            ],
            indexes: [],
          },
        ],
      };

      const report = analyzeSchemaHealth(mixedSchema, 'Postgres');
      expect(report.bundledQuickFixSql).toContain('BEGIN;');
      expect(report.bundledQuickFixSql).toContain('CREATE INDEX "idx_orders_user_id"');
      expect(report.bundledQuickFixSql).toContain('COMMIT;');
    });
  });
});
