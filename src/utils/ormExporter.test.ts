/**
 * @file ormExporter.test.ts
 * @brief Unit test suite for the multi-language ORM & Entity generator.
 * @details Validates canonical TableSchema compilation to Prisma, Drizzle, GORM,
 * SeaORM, EF Core, SQLAlchemy, and TypeORM models with casing and relationship integrity.
 */

import { describe, expect, it } from 'vitest';
import type { TableSchema } from '../types/database';
import {
  generateOrmCode,
  toCamelCase,
  toPascalCase,
  toSnakeCase,
} from './ormExporter';

describe('ormExporter utilities', () => {
  const sampleTable: TableSchema = {
    name: 'users',
    columns: [
      {
        name: 'id',
        data_type: 'Integer',
        is_primary_key: true,
        is_nullable: false,
        is_auto_increment: true,
        default_value: undefined,
      },
      {
        name: 'first_name',
        data_type: { Varchar: 100 },
        is_primary_key: false,
        is_nullable: false,
        is_auto_increment: false,
        default_value: undefined,
      },
      {
        name: 'email',
        data_type: { Varchar: 255 },
        is_primary_key: false,
        is_nullable: false,
        is_auto_increment: false,
        default_value: undefined,
      },
      {
        name: 'is_active',
        data_type: 'Boolean',
        is_primary_key: false,
        is_nullable: false,
        is_auto_increment: false,
        default_value: 'true',
      },
      {
        name: 'created_at',
        data_type: 'Timestamp',
        is_primary_key: false,
        is_nullable: false,
        is_auto_increment: false,
        default_value: 'CURRENT_TIMESTAMP',
      },
      {
        name: 'metadata',
        data_type: 'Json',
        is_primary_key: false,
        is_nullable: true,
        is_auto_increment: false,
        default_value: undefined,
      },
    ],
    foreign_keys: [],
    indexes: [],
  };

  const sampleOrderTable: TableSchema = {
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
      {
        name: 'total_amount',
        data_type: { Decimal: { precision: 10, scale: 2 } },
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
  };

  describe('Casing converters', () => {
    it('converts snake_case and kebab-case to PascalCase', () => {
      expect(toPascalCase('users')).toBe('User');
      expect(toPascalCase('order_items')).toBe('OrderItem');
      expect(toPascalCase('customer-addresses')).toBe('CustomerAddress');
    });

    it('converts identifiers to camelCase', () => {
      expect(toCamelCase('first_name')).toBe('firstName');
      expect(toCamelCase('user_id')).toBe('userId');
      expect(toCamelCase('is_active')).toBe('isActive');
    });

    it('converts camelCase and PascalCase to snake_case', () => {
      expect(toSnakeCase('firstName')).toBe('first_name');
      expect(toSnakeCase('OrderItem')).toBe('order_item');
    });
  });

  describe('Prisma Schema Generator', () => {
    it('generates a syntactically valid Prisma model', () => {
      const code = generateOrmCode([sampleTable], 'prisma');
      expect(code).toContain('model User {');
      expect(code).toContain('id Int @id @default(autoincrement())');
      expect(code).toContain('firstName String');
      expect(code).toContain('email String');
      expect(code).toContain('isActive Boolean');
      expect(code).toContain('createdAt DateTime');
      expect(code).toContain('metadata Json?');
      expect(code).toContain('@@map("users")');
    });

    it('generates relation fields when foreign keys exist', () => {
      const code = generateOrmCode([sampleTable, sampleOrderTable], 'prisma');
      expect(code).toContain('model Order {');
      expect(code).toContain('user User @relation(fields: [userId], references: [id])');
      expect(code).toContain('userId Int');
    });
  });

  describe('Drizzle ORM Generator', () => {
    it('generates Drizzle PostgreSQL schema definitions', () => {
      const code = generateOrmCode([sampleTable], 'drizzle-pg');
      expect(code).toContain("from 'drizzle-orm/pg-core';");
      expect(code).toContain("export const users = pgTable('users', {");
      expect(code).toContain("id: serial('id').primaryKey()");
      expect(code).toContain("firstName: varchar('first_name', { length: 100 }).notNull()");
      expect(code).toContain("isActive: boolean('is_active').notNull().default(true)");
    });

    it('generates Drizzle SQLite schema definitions', () => {
      const code = generateOrmCode([sampleTable], 'drizzle-sqlite');
      expect(code).toContain("from 'drizzle-orm/sqlite-core';");
      expect(code).toContain("export const users = sqliteTable('users', {");
      expect(code).toContain("id: integer('id').primaryKey({ autoIncrement: true })");
    });
  });

  describe('Golang GORM Generator', () => {
    it('generates Go struct with gorm and json tags', () => {
      const code = generateOrmCode([sampleTable], 'gorm');
      expect(code).toContain('package models');
      expect(code).toContain('type User struct {');
      expect(code).toContain('ID uint `gorm:"primaryKey;column:id" json:"id"`');
      expect(code).toContain('FirstName string `gorm:"column:first_name;not null" json:"first_name"`');
      expect(code).toContain('IsActive bool `gorm:"column:is_active;not null;default:true" json:"is_active"`');
      expect(code).toContain('CreatedAt time.Time `gorm:"column:created_at;not null');
      expect(code).toContain('func (User) TableName() string {');
      expect(code).toContain('return "users"');
    });
  });

  describe('Rust SeaORM Generator', () => {
    it('generates SeaORM entity struct and derive macros', () => {
      const code = generateOrmCode([sampleTable], 'seaorm');
      expect(code).toContain('use sea_orm::entity::prelude::*;');
      expect(code).toContain('DeriveEntityModel');
      expect(code).toContain('#[sea_orm(table_name = "users")]');
      expect(code).toContain('pub struct Model {');
      expect(code).toContain('#[sea_orm(primary_key)]');
      expect(code).toContain('pub id: i32,');
      expect(code).toContain('pub first_name: String,');
      expect(code).toContain('pub is_active: bool,');
      expect(code).toContain('pub metadata: Option<Json>,');
    });
  });

  describe('C# EF Core Generator', () => {
    it('generates C# Entity Framework Core POCO class with DataAnnotations', () => {
      const code = generateOrmCode([sampleTable], 'efcore');
      expect(code).toContain('using System.ComponentModel.DataAnnotations;');
      expect(code).toContain('using System.ComponentModel.DataAnnotations.Schema;');
      expect(code).toContain('[Table("users")]');
      expect(code).toContain('public class User');
      expect(code).toContain('[Key]');
      expect(code).toContain('[Column("id")]');
      expect(code).toContain('public int Id { get; set; }');
      expect(code).toContain('[Column("first_name")]');
      expect(code).toContain('public string FirstName { get; set; } = string.Empty;');
    });
  });

  describe('Python SQLAlchemy 2.0 Generator', () => {
    it('generates modern Python 3.10+ Mapped entity classes', () => {
      const code = generateOrmCode([sampleTable], 'sqlalchemy');
      expect(code).toContain('from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column');
      expect(code).toContain('class User(Base):');
      expect(code).toContain('__tablename__ = "users"');
      expect(code).toContain('id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)');
      expect(code).toContain('first_name: Mapped[str] = mapped_column(String(100), nullable=False)');
      expect(code).toContain('metadata_field: Mapped[dict | None] = mapped_column("metadata", JSON, nullable=True)');
    });
  });

  describe('TypeORM Generator', () => {
    it('generates TypeORM TypeScript class with decorators', () => {
      const code = generateOrmCode([sampleTable], 'typeorm');
      expect(code).toContain("import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn } from 'typeorm';");
      expect(code).toContain("@Entity('users')");
      expect(code).toContain('export class User {');
      expect(code).toContain('@PrimaryGeneratedColumn()');
      expect(code).toContain('id: number;');
      expect(code).toContain("@Column({ name: 'first_name', type: 'varchar', length: 100 })");
      expect(code).toContain('firstName: string;');
    });
  });
});
