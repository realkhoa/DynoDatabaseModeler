/**
 * @file ormExporter.ts
 * @brief Canonical schema to multi-language ORM & Entity generator.
 * @details Compiles canonical TableSchema definitions into production-ready schemas and models
 * across Prisma, Drizzle (PostgreSQL, SQLite), Golang GORM, Rust SeaORM, C# EF Core,
 * Python SQLAlchemy 2.0, and TypeORM.
 */

import type { ColumnSchema, TableSchema } from '../types/database';
import { formatCanonicalType } from '../types/database';

/**
 * @brief Supported ORM and entity code generator targets.
 */
export type OrmTarget =
  | 'prisma'
  | 'drizzle-pg'
  | 'drizzle-sqlite'
  | 'gorm'
  | 'seaorm'
  | 'efcore'
  | 'sqlalchemy'
  | 'typeorm';

/**
 * @brief Metadata descriptor for each ORM target framework.
 */
export interface OrmTargetMeta {
  readonly id: OrmTarget;
  readonly label: string;
  readonly language: 'typescript' | 'prisma' | 'go' | 'rust' | 'csharp' | 'python';
  readonly extension: string;
  readonly defaultFileName: string;
  readonly description: string;
}

/**
 * @brief Catalog of supported ORM targets and their code editor configurations.
 */
export const ORM_TARGETS: Record<OrmTarget, OrmTargetMeta> = {
  prisma: {
    id: 'prisma',
    label: 'Prisma Schema',
    language: 'prisma',
    extension: '.prisma',
    defaultFileName: 'schema.prisma',
    description: 'Next-generation TypeScript & Node.js ORM schema definition',
  },
  'drizzle-pg': {
    id: 'drizzle-pg',
    label: 'Drizzle (PostgreSQL)',
    language: 'typescript',
    extension: '.ts',
    defaultFileName: 'schema.ts',
    description: 'Type-safe TypeScript SQL schema using drizzle-orm/pg-core',
  },
  'drizzle-sqlite': {
    id: 'drizzle-sqlite',
    label: 'Drizzle (SQLite)',
    language: 'typescript',
    extension: '.ts',
    defaultFileName: 'schema.ts',
    description: 'Type-safe TypeScript SQL schema using drizzle-orm/sqlite-core',
  },
  gorm: {
    id: 'gorm',
    label: 'Golang GORM',
    language: 'go',
    extension: '.go',
    defaultFileName: 'models.go',
    description: 'The fantastic Go ORM structs with gorm and json tags',
  },
  seaorm: {
    id: 'seaorm',
    label: 'Rust SeaORM',
    language: 'rust',
    extension: '.rs',
    defaultFileName: 'entities.rs',
    description: 'Async & dynamic Rust ORM entity structs and DeriveEntityModel',
  },
  efcore: {
    id: 'efcore',
    label: 'C# EF Core',
    language: 'csharp',
    extension: '.cs',
    defaultFileName: 'Entities.cs',
    description: 'Entity Framework Core POCO classes with DataAnnotations',
  },
  sqlalchemy: {
    id: 'sqlalchemy',
    label: 'Python SQLAlchemy 2.0',
    language: 'python',
    extension: '.py',
    defaultFileName: 'models.py',
    description: 'Modern Python 3.10+ typed models with Mapped and mapped_column',
  },
  typeorm: {
    id: 'typeorm',
    label: 'TypeORM',
    language: 'typescript',
    extension: '.ts',
    defaultFileName: 'entities.ts',
    description: 'TypeScript entities with class decorators and column definitions',
  },
};

/**
 * @brief Converts a plural or singular identifier to singular form heuristically.
 * @param str Target word.
 * @return Singularized form.
 */
export function singularize(str: string): string {
  if (str.endsWith('ies')) {
    return str.slice(0, -3) + 'y';
  }
  if (str.endsWith('ses')) {
    return str.slice(0, -2);
  }
  if (str.endsWith('s') && !str.endsWith('ss')) {
    return str.slice(0, -1);
  }
  return str;
}

/**
 * @brief Converts an identifier (snake_case, kebab-case, or camelCase) to PascalCase.
 * @param str Input string.
 * @return PascalCase string.
 */
export function toPascalCase(str: string): string {
  if (!str) return '';
  const cleaned = singularize(str);
  const words = cleaned.split(/[_\-\s]+/);
  return words
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join('');
}

/**
 * @brief Converts an identifier to camelCase.
 * @param str Input string.
 * @return camelCase string.
 */
export function toCamelCase(str: string): string {
  if (!str) return '';
  const words = str.split(/[_\-\s]+/);
  return words
    .filter(Boolean)
    .map((w, index) => {
      const lower = w.toLowerCase();
      return index === 0 ? lower : lower.charAt(0).toUpperCase() + lower.slice(1);
    })
    .join('');
}

/**
 * @brief Converts a camelCase or PascalCase identifier to snake_case.
 * @param str Input string.
 * @return snake_case string.
 */
export function toSnakeCase(str: string): string {
  if (!str) return '';
  return str
    .replace(/([A-Z])/g, '_$1')
    .toLowerCase()
    .replace(/^_/, '')
    .replace(/[_\-\s]+/g, '_');
}

/**
 * @brief Sanitizes reserved words in programming languages.
 * @param name Target identifier.
 * @param language Target programming language.
 * @return Safe identifier.
 */
function sanitizeIdentifier(name: string, language: string): string {
  const pythonKeywords = new Set([
    'from', 'class', 'def', 'global', 'import', 'in', 'is', 'lambda',
    'pass', 'raise', 'return', 'try', 'while', 'with', 'yield', 'metadata'
  ]);
  if (language === 'python' && pythonKeywords.has(name)) {
    return `${name}_field`;
  }
  return name;
}

/**
 * @brief Maps canonical column type to Prisma scalar type.
 * @param col Column metadata.
 * @return Prisma type string.
 */
function mapPrismaType(col: ColumnSchema): string {
  const typeStr = (typeof col.data_type === 'string' ? col.data_type : formatCanonicalType(col.data_type)).toUpperCase();
  if (typeStr.includes('INT')) {
    return typeStr.includes('BIG') ? 'BigInt' : 'Int';
  }
  if (typeStr.includes('FLOAT') || typeStr.includes('DOUBLE')) return 'Float';
  if (typeStr.includes('DECIMAL') || typeStr.includes('NUMERIC')) return 'Decimal';
  if (typeStr.includes('BOOL')) return 'Boolean';
  if (typeStr.includes('DATE') || typeStr.includes('TIME')) return 'DateTime';
  if (typeStr.includes('JSON')) return 'Json';
  if (typeStr.includes('BYTES') || typeStr.includes('BLOB') || typeStr.includes('BYTEA')) return 'Bytes';
  return 'String';
}

/**
 * @brief Generates Prisma Schema file content.
 * @param tables Array of table schemas.
 * @return Complete schema.prisma code.
 */
export function generatePrismaSchema(tables: TableSchema[]): string {
  const lines: string[] = [
    '// This is your Prisma schema file,',
    '// generated by DynoDbModeler.',
    '',
    'datasource db {',
    '  provider = "postgresql"',
    '  url      = env("DATABASE_URL")',
    '}',
    '',
    'generator client {',
    '  provider = "prisma-client-js"',
    '}',
    '',
  ];

  for (const table of tables) {
    const modelName = toPascalCase(table.name);
    lines.push(`model ${modelName} {`);

    for (const col of table.columns) {
      const fieldName = toCamelCase(col.name);
      let pType = mapPrismaType(col);
      if (col.is_nullable && !col.is_primary_key) {
        pType += '?';
      }

      const attributes: string[] = [];
      if (col.is_primary_key) {
        attributes.push('@id');
        if (col.is_auto_increment) {
          attributes.push('@default(autoincrement())');
        }
      } else if (col.default_value) {
        if (col.default_value.toUpperCase().includes('CURRENT_TIMESTAMP') || col.default_value.toUpperCase().includes('NOW()')) {
          attributes.push('@default(now())');
        } else if (col.default_value === 'true' || col.default_value === 'false') {
          attributes.push(`@default(${col.default_value})`);
        } else if (!Number.isNaN(Number(col.default_value))) {
          attributes.push(`@default(${col.default_value})`);
        }
      }

      // Check if this column is a foreign key
      const fk = table.foreign_keys?.find((k) => k.source_column === col.name);
      const attrStr = attributes.length > 0 ? ` ${attributes.join(' ')}` : '';
      lines.push(`  ${fieldName} ${pType}${attrStr}`);

      if (fk) {
        const relModel = toPascalCase(fk.target_table);
        const relField = toCamelCase(fk.target_table.replace(/s$/, ''));
        const refCol = toCamelCase(fk.target_column);
        lines.push(`  ${relField} ${relModel} @relation(fields: [${fieldName}], references: [${refCol}])`);
      }
    }

    lines.push(`  @@map("${table.name}")`);
    lines.push('}');
    lines.push('');
  }

  return lines.join('\n').trim();
}

/**
 * @brief Generates Drizzle ORM schema for PostgreSQL.
 * @param tables Array of table schemas.
 * @return Complete TypeScript schema.
 */
export function generateDrizzlePg(tables: TableSchema[]): string {
  const lines: string[] = [
    "import { pgTable, serial, integer, varchar, boolean, timestamp, jsonb, text, doublePrecision } from 'drizzle-orm/pg-core';",
    '',
  ];

  for (const table of tables) {
    const varName = toCamelCase(table.name);
    lines.push(`export const ${varName} = pgTable('${table.name}', {`);

    for (const col of table.columns) {
      const propName = toCamelCase(col.name);
      const typeStr = (typeof col.data_type === 'string' ? col.data_type : formatCanonicalType(col.data_type)).toUpperCase();
      let colDef = '';

      if (col.is_primary_key && col.is_auto_increment) {
        colDef = `serial('${col.name}').primaryKey()`;
      } else if (typeStr.includes('INT')) {
        colDef = `integer('${col.name}')`;
        if (col.is_primary_key) colDef += '.primaryKey()';
      } else if (typeStr.includes('VARCHAR') || typeStr.includes('CHAR')) {
        const lenMatch = typeStr.match(/\((\d+)\)/);
        const len = lenMatch ? lenMatch[1] : '255';
        colDef = `varchar('${col.name}', { length: ${len} })`;
      } else if (typeStr.includes('BOOL')) {
        colDef = `boolean('${col.name}')`;
      } else if (typeStr.includes('DATE') || typeStr.includes('TIME')) {
        colDef = `timestamp('${col.name}')`;
      } else if (typeStr.includes('JSON')) {
        colDef = `jsonb('${col.name}')`;
      } else if (typeStr.includes('FLOAT') || typeStr.includes('DOUBLE')) {
        colDef = `doublePrecision('${col.name}')`;
      } else {
        colDef = `text('${col.name}')`;
      }

      if (!col.is_nullable && !col.is_primary_key) {
        colDef += '.notNull()';
      }
      if (col.default_value) {
        if (col.default_value === 'true' || col.default_value === 'false') {
          colDef += `.default(${col.default_value})`;
        } else if (col.default_value.toUpperCase().includes('NOW') || col.default_value.toUpperCase().includes('CURRENT_TIMESTAMP')) {
          colDef += '.defaultNow()';
        }
      }

      lines.push(`  ${propName}: ${colDef},`);
    }

    lines.push('});');
    lines.push('');
  }

  return lines.join('\n').trim();
}

/**
 * @brief Generates Drizzle ORM schema for SQLite.
 * @param tables Array of table schemas.
 * @return Complete TypeScript schema.
 */
export function generateDrizzleSqlite(tables: TableSchema[]): string {
  const lines: string[] = [
    "import { sqliteTable, integer, text, real } from 'drizzle-orm/sqlite-core';",
    '',
  ];

  for (const table of tables) {
    const varName = toCamelCase(table.name);
    lines.push(`export const ${varName} = sqliteTable('${table.name}', {`);

    for (const col of table.columns) {
      const propName = toCamelCase(col.name);
      const typeStr = (typeof col.data_type === 'string' ? col.data_type : formatCanonicalType(col.data_type)).toUpperCase();
      let colDef = '';

      if (col.is_primary_key && col.is_auto_increment) {
        colDef = `integer('${col.name}').primaryKey({ autoIncrement: true })`;
      } else if (typeStr.includes('INT') || typeStr.includes('BOOL')) {
        colDef = `integer('${col.name}')`;
        if (col.is_primary_key) colDef += '.primaryKey()';
      } else if (typeStr.includes('FLOAT') || typeStr.includes('DOUBLE') || typeStr.includes('REAL')) {
        colDef = `real('${col.name}')`;
      } else {
        colDef = `text('${col.name}')`;
      }

      if (!col.is_nullable && !col.is_primary_key) {
        colDef += '.notNull()';
      }

      lines.push(`  ${propName}: ${colDef},`);
    }

    lines.push('});');
    lines.push('');
  }

  return lines.join('\n').trim();
}

/**
 * @brief Generates Golang GORM models.
 * @param tables Array of table schemas.
 * @return Complete Go source file content.
 */
export function generateGorm(tables: TableSchema[]): string {
  const lines: string[] = [
    'package models',
    '',
    'import (',
    '\t"time"',
    ')',
    '',
  ];

  for (const table of tables) {
    const structName = toPascalCase(table.name);
    lines.push(`type ${structName} struct {`);

    for (const col of table.columns) {
      let fieldName = toPascalCase(col.name);
      if (col.name.toLowerCase() === 'id') fieldName = 'ID';

      const typeStr = (typeof col.data_type === 'string' ? col.data_type : formatCanonicalType(col.data_type)).toUpperCase();
      let goType = 'string';

      if (typeStr.includes('INT')) {
        goType = col.is_primary_key ? 'uint' : 'int';
      } else if (typeStr.includes('FLOAT') || typeStr.includes('DOUBLE')) {
        goType = 'float64';
      } else if (typeStr.includes('BOOL')) {
        goType = 'bool';
      } else if (typeStr.includes('DATE') || typeStr.includes('TIME')) {
        goType = 'time.Time';
      } else if (typeStr.includes('JSON')) {
        goType = 'string';
      }

      if (col.is_nullable && !col.is_primary_key) {
        goType = `*${goType}`;
      }

      const gormTags: string[] = [];
      if (col.is_primary_key) gormTags.push('primaryKey');
      gormTags.push(`column:${col.name}`);
      if (!col.is_nullable && !col.is_primary_key) gormTags.push('not null');
      if (col.default_value) gormTags.push(`default:${col.default_value}`);

      const tag = `\`gorm:"${gormTags.join(';')}" json:"${col.name}"\``;
      lines.push(`\t${fieldName} ${goType} ${tag}`);
    }

    lines.push('}');
    lines.push('');
    lines.push(`func (${structName}) TableName() string {`);
    lines.push(`\treturn "${table.name}"`);
    lines.push('}');
    lines.push('');
  }

  return lines.join('\n').trim();
}

/**
 * @brief Generates Rust SeaORM entity models.
 * @param tables Array of table schemas.
 * @return Complete Rust source file content.
 */
export function generateSeaOrm(tables: TableSchema[]): string {
  const lines: string[] = [
    'use sea_orm::entity::prelude::*;',
    'use serde::{Deserialize, Serialize};',
    '',
  ];

  for (const table of tables) {
    lines.push('#[derive(Clone, Debug, PartialEq, DeriveEntityModel, Serialize, Deserialize)]');
    lines.push(`#[sea_orm(table_name = "${table.name}")]`);
    lines.push('pub struct Model {');

    for (const col of table.columns) {
      const typeStr = (typeof col.data_type === 'string' ? col.data_type : formatCanonicalType(col.data_type)).toUpperCase();
      let rustType = 'String';

      if (typeStr.includes('BIGINT')) rustType = 'i64';
      else if (typeStr.includes('INT')) rustType = 'i32';
      else if (typeStr.includes('FLOAT') || typeStr.includes('DOUBLE')) rustType = 'f64';
      else if (typeStr.includes('BOOL')) rustType = 'bool';
      else if (typeStr.includes('DATE') || typeStr.includes('TIME')) rustType = 'DateTimeUtc';
      else if (typeStr.includes('JSON')) rustType = 'Json';

      if (col.is_nullable && !col.is_primary_key) {
        rustType = `Option<${rustType}>`;
      }

      if (col.is_primary_key) {
        lines.push('    #[sea_orm(primary_key)]');
      }
      lines.push(`    pub ${col.name}: ${rustType},`);
    }

    lines.push('}');
    lines.push('');
    lines.push('#[derive(Copy, Clone, Debug, EnumIter, DeriveRelation)]');
    lines.push('pub enum Relation {}');
    lines.push('');
    lines.push('impl ActiveModelBehavior for ActiveModel {}');
    lines.push('');
  }

  return lines.join('\n').trim();
}

/**
 * @brief Generates C# Entity Framework Core POCO classes with DataAnnotations.
 * @param tables Array of table schemas.
 * @return Complete C# source file content.
 */
export function generateEfCore(tables: TableSchema[]): string {
  const lines: string[] = [
    'using System;',
    'using System.ComponentModel.DataAnnotations;',
    'using System.ComponentModel.DataAnnotations.Schema;',
    '',
    'namespace App.Models',
    '{',
  ];

  for (const table of tables) {
    const className = toPascalCase(table.name);
    lines.push(`    [Table("${table.name}")]`);
    lines.push(`    public class ${className}`);
    lines.push('    {');

    for (const col of table.columns) {
      let propName = toPascalCase(col.name);
      if (col.name.toLowerCase() === 'id') propName = 'Id';

      const typeStr = (typeof col.data_type === 'string' ? col.data_type : formatCanonicalType(col.data_type)).toUpperCase();
      let csType = 'string';
      let isValueType = false;

      if (typeStr.includes('BIGINT')) { csType = 'long'; isValueType = true; }
      else if (typeStr.includes('INT')) { csType = 'int'; isValueType = true; }
      else if (typeStr.includes('FLOAT') || typeStr.includes('DOUBLE')) { csType = 'double'; isValueType = true; }
      else if (typeStr.includes('DECIMAL') || typeStr.includes('NUMERIC')) { csType = 'decimal'; isValueType = true; }
      else if (typeStr.includes('BOOL')) { csType = 'bool'; isValueType = true; }
      else if (typeStr.includes('DATE') || typeStr.includes('TIME')) { csType = 'DateTime'; isValueType = true; }
      else if (typeStr.includes('UUID') || typeStr.includes('GUID')) { csType = 'Guid'; isValueType = true; }

      if (col.is_nullable && isValueType) {
        csType = `${csType}?`;
      }

      if (col.is_primary_key) {
        lines.push('        [Key]');
      }
      lines.push(`        [Column("${col.name}")]`);
      const defaultSuffix = csType === 'string' && !col.is_nullable ? ' = string.Empty;' : '';
      lines.push(`        public ${csType} ${propName} { get; set; }${defaultSuffix}`);
      lines.push('');
    }

    lines.push('    }');
    lines.push('');
  }

  lines.push('}');
  return lines.join('\n').trim();
}

/**
 * @brief Generates Python SQLAlchemy 2.0 modern typed models.
 * @param tables Array of table schemas.
 * @return Complete Python source file content.
 */
export function generateSqlAlchemy(tables: TableSchema[]): string {
  const lines: string[] = [
    'from datetime import datetime',
    'from sqlalchemy import String, Integer, BigInteger, Boolean, DateTime, Float, JSON',
    'from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column',
    '',
    'class Base(DeclarativeBase):',
    '    pass',
    '',
  ];

  for (const table of tables) {
    const className = toPascalCase(table.name);
    lines.push(`class ${className}(Base):`);
    lines.push(`    __tablename__ = "${table.name}"`);
    lines.push('');

    for (const col of table.columns) {
      const fieldName = sanitizeIdentifier(toSnakeCase(col.name), 'python');
      const typeStr = (typeof col.data_type === 'string' ? col.data_type : formatCanonicalType(col.data_type)).toUpperCase();

      let pyType = 'str';
      let saType = 'String(255)';

      if (typeStr.includes('BIGINT')) { pyType = 'int'; saType = 'BigInteger'; }
      else if (typeStr.includes('INT')) { pyType = 'int'; saType = 'Integer'; }
      else if (typeStr.includes('FLOAT') || typeStr.includes('DOUBLE')) { pyType = 'float'; saType = 'Float'; }
      else if (typeStr.includes('BOOL')) { pyType = 'bool'; saType = 'Boolean'; }
      else if (typeStr.includes('DATE') || typeStr.includes('TIME')) { pyType = 'datetime'; saType = 'DateTime'; }
      else if (typeStr.includes('JSON')) { pyType = 'dict'; saType = 'JSON'; }

      const typeAnnotation = col.is_nullable && !col.is_primary_key ? `${pyType} | None` : pyType;
      const args: string[] = [];

      if (fieldName !== col.name) {
        args.push(`"${col.name}"`);
      }

      if (col.is_primary_key) {
        args.push('primary_key=True');
        if (col.is_auto_increment) args.push('autoincrement=True');
      } else {
        const lenMatch = typeStr.match(/\((\d+)\)/);
        if (lenMatch && typeStr.includes('VARCHAR')) {
          args.push(`String(${lenMatch[1]})`);
        } else if (saType !== 'String(255)') {
          args.push(saType);
        }
        args.push(col.is_nullable ? 'nullable=True' : 'nullable=False');
      }

      lines.push(`    ${fieldName}: Mapped[${typeAnnotation}] = mapped_column(${args.join(', ')})`);
    }

    lines.push('');
  }

  return lines.join('\n').trim();
}

/**
 * @brief Generates TypeORM TypeScript entity classes with decorators.
 * @param tables Array of table schemas.
 * @return Complete TypeScript source file content.
 */
export function generateTypeOrm(tables: TableSchema[]): string {
  const lines: string[] = [
    "import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn } from 'typeorm';",
    '',
  ];

  for (const table of tables) {
    const className = toPascalCase(table.name);
    lines.push(`@Entity('${table.name}')`);
    lines.push(`export class ${className} {`);

    for (const col of table.columns) {
      const propName = toCamelCase(col.name);
      const typeStr = (typeof col.data_type === 'string' ? col.data_type : formatCanonicalType(col.data_type)).toUpperCase();

      if (col.is_primary_key && col.is_auto_increment) {
        lines.push('  @PrimaryGeneratedColumn()');
        lines.push(`  ${propName}: number;`);
        lines.push('');
        continue;
      }

      let tsType = 'string';
      let ormType = 'varchar';

      if (typeStr.includes('INT')) { tsType = 'number'; ormType = 'int'; }
      else if (typeStr.includes('FLOAT') || typeStr.includes('DOUBLE')) { tsType = 'number'; ormType = 'float'; }
      else if (typeStr.includes('BOOL')) { tsType = 'boolean'; ormType = 'boolean'; }
      else if (typeStr.includes('DATE') || typeStr.includes('TIME')) { tsType = 'Date'; ormType = 'timestamp'; }
      else if (typeStr.includes('JSON')) { tsType = 'Record<string, any>'; ormType = 'json'; }

      const options: string[] = [`name: '${col.name}'`, `type: '${ormType}'`];
      const lenMatch = typeStr.match(/\((\d+)\)/);
      if (lenMatch && ormType === 'varchar') {
        options.push(`length: ${lenMatch[1]}`);
      }
      if (col.is_nullable) {
        options.push('nullable: true');
      }

      lines.push(`  @Column({ ${options.join(', ')} })`);
      lines.push(`  ${propName}: ${col.is_nullable ? `${tsType} | null` : tsType};`);
      lines.push('');
    }

    lines.push('}');
    lines.push('');
  }

  return lines.join('\n').trim();
}

/**
 * @brief Master dispatcher compiling table schemas to the specified target ORM.
 * @param tables Array of canonical table schemas to compile.
 * @param target Target ORM framework.
 * @return Formatted source code string.
 */
export function generateOrmCode(tables: TableSchema[], target: OrmTarget): string {
  if (!tables || tables.length === 0) {
    return '// No tables provided for ORM generation';
  }

  switch (target) {
    case 'prisma':
      return generatePrismaSchema(tables);
    case 'drizzle-pg':
      return generateDrizzlePg(tables);
    case 'drizzle-sqlite':
      return generateDrizzleSqlite(tables);
    case 'gorm':
      return generateGorm(tables);
    case 'seaorm':
      return generateSeaOrm(tables);
    case 'efcore':
      return generateEfCore(tables);
    case 'sqlalchemy':
      return generateSqlAlchemy(tables);
    case 'typeorm':
      return generateTypeOrm(tables);
    default:
      return generatePrismaSchema(tables);
  }
}
