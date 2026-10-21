/**
 * @file ddlExporter.test.ts
 * @brief Unit tests for dialect-accurate table DDL generation.
 */

import { describe, it, expect } from 'vitest';
import { generateTableDdl, formatColumnType } from './ddlExporter';
import type { TableSchema } from '../types/database';

describe('ddlExporter', () => {
  const sampleTable: TableSchema = {
    name: 'customers',
    columns: [
      { name: 'id', data_type: 'Integer', is_nullable: false, is_primary_key: true, is_auto_increment: true },
      { name: 'name', data_type: { Varchar: 100 }, is_nullable: false, is_primary_key: false, is_auto_increment: false },
      { name: 'email', data_type: { Varchar: 255 }, is_nullable: true, is_primary_key: false, is_auto_increment: false },
      { name: 'is_active', data_type: 'Boolean', is_nullable: false, is_primary_key: false, is_auto_increment: false, default_value: 'true' },
    ],
    foreign_keys: [
      {
        constraint_name: 'fk_customers_tenant',
        source_column: 'tenant_id',
        target_table: 'tenants',
        target_column: 'id',
        on_delete: 'Cascade',
        on_update: 'NoAction',
      },
    ],
    indexes: [
      {
        name: 'idx_customers_email',
        columns: ['email'],
        is_unique: true,
      },
    ],
  };

  describe('formatColumnType', () => {
    it('maps canonical types per dialect', () => {
      expect(formatColumnType({ name: 'flag', data_type: 'Boolean', is_nullable: false, is_primary_key: false, is_auto_increment: false }, 'MySql')).toBe('TINYINT(1)');
      expect(formatColumnType({ name: 'flag', data_type: 'Boolean', is_nullable: false, is_primary_key: false, is_auto_increment: false }, 'Mssql')).toBe('BIT');
      expect(formatColumnType({ name: 'u', data_type: 'Uuid', is_nullable: false, is_primary_key: false, is_auto_increment: false }, 'Postgres')).toBe('UUID');
    });
  });

  describe('generateTableDdl', () => {
    it('generates CREATE TABLE statement with columns and constraints for Postgres', () => {
      const ddl = generateTableDdl(sampleTable, 'Postgres');
      expect(ddl).toContain('CREATE TABLE "customers" (');
      expect(ddl).toContain('"id" SERIAL NOT NULL');
      expect(ddl).toContain('PRIMARY KEY ("id")');
      expect(ddl).toContain('CONSTRAINT "fk_customers_tenant" FOREIGN KEY ("tenant_id") REFERENCES "tenants" ("id") ON DELETE CASCADE');
      expect(ddl).toContain('CREATE UNIQUE INDEX "idx_customers_email" ON "customers" ("email");');
    });

    it('generates backtick quoting and MySQL syntax for MySQL', () => {
      const ddl = generateTableDdl(sampleTable, 'MySql');
      expect(ddl).toContain('CREATE TABLE `customers` (');
      expect(ddl).toContain('`id` INT AUTO_INCREMENT NOT NULL');
      expect(ddl).toContain('PRIMARY KEY (`id`)');
    });

    it('generates square bracket quoting for MSSQL', () => {
      const ddl = generateTableDdl(sampleTable, 'Mssql');
      expect(ddl).toContain('CREATE TABLE [customers] (');
      expect(ddl).toContain('[id] INT IDENTITY(1,1) NOT NULL');
      expect(ddl).toContain('PRIMARY KEY ([id])');
    });

    it('generates INTEGER PRIMARY KEY AUTOINCREMENT for SQLite', () => {
      const ddl = generateTableDdl(sampleTable, 'Sqlite');
      expect(ddl).toContain('"id" INTEGER PRIMARY KEY AUTOINCREMENT');
    });
  });
});
