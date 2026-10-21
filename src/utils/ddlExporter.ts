/**
 * @file ddlExporter.ts
 * @brief Canonical schema to dialect-accurate DDL compiler utility.
 * @details Synthesizes CREATE TABLE and CREATE INDEX DDL statements from canonical TableSchema models
 * across PostgreSQL, MySQL, MSSQL, DuckDB, and SQLite, inspired by Antares SQL and DBeaver table DDL exports.
 */

import type { DatabaseType, TableSchema, ColumnSchema } from '../types/database';
import { formatCanonicalType } from '../types/database';
import { quoteIdentifier } from './mockDataGenerator';

/**
 * @brief Maps canonical column type to a dialect-specific SQL column definition.
 * @param col Column schema metadata.
 * @param dbType Target database dialect.
 * @return Dialect SQL type string.
 */
export function formatColumnType(col: ColumnSchema, dbType: DatabaseType = 'Postgres'): string {
  const typeStr = typeof col.data_type === 'string' ? col.data_type : formatCanonicalType(col.data_type);
  const upper = typeStr.toUpperCase();

  if (upper.includes('INT')) {
    if (col.is_primary_key && col.is_auto_increment) {
      if (dbType === 'Postgres') return upper.includes('BIG') ? 'BIGSERIAL' : 'SERIAL';
      if (dbType === 'MySql') return 'INT AUTO_INCREMENT';
      if (dbType === 'Mssql') return 'INT IDENTITY(1,1)';
      if (dbType === 'Sqlite') return 'INTEGER PRIMARY KEY AUTOINCREMENT';
    }
    if (upper.includes('BIG')) return 'BIGINT';
    if (upper.includes('SMALL')) return 'SMALLINT';
    return 'INTEGER';
  }

  if (upper.includes('FLOAT') || upper.includes('DOUBLE')) {
    if (dbType === 'Postgres') return 'DOUBLE PRECISION';
    if (dbType === 'Sqlite') return 'REAL';
    return 'FLOAT';
  }

  if (upper.includes('DECIMAL')) {
    return typeStr;
  }

  if (upper.includes('BOOL')) {
    if (dbType === 'MySql') return 'TINYINT(1)';
    if (dbType === 'Mssql') return 'BIT';
    if (dbType === 'Sqlite') return 'INTEGER';
    return 'BOOLEAN';
  }

  if (upper.includes('DATE') || upper.includes('TIME')) {
    if (dbType === 'Postgres') return 'TIMESTAMPTZ';
    if (dbType === 'MySql') return 'DATETIME';
    if (dbType === 'Mssql') return 'DATETIME2';
    return 'TEXT';
  }

  if (upper.includes('UUID')) {
    if (dbType === 'Postgres') return 'UUID';
    if (dbType === 'Mssql') return 'UNIQUEIDENTIFIER';
    return 'VARCHAR(36)';
  }

  if (upper.includes('JSON')) {
    if (dbType === 'Postgres') return 'JSONB';
    if (dbType === 'MySql') return 'JSON';
    return 'TEXT';
  }

  if (upper.includes('BINARY') || upper.includes('BYTEA') || upper.includes('BLOB')) {
    if (dbType === 'Postgres') return 'BYTEA';
    if (dbType === 'Mssql') return 'VARBINARY(MAX)';
    return 'BLOB';
  }

  return typeStr;
}

/**
 * @brief Generates formatted, syntax-highlighted DDL statement for a table.
 * @param table Table schema object including columns, primary keys, and foreign keys.
 * @param dbType Database engine dialect.
 * @return Formatted CREATE TABLE statement with secondary index statements.
 */
export function generateTableDdl(table: TableSchema, dbType: DatabaseType = 'Postgres'): string {
  const quotedTableName = quoteIdentifier(table.name, dbType);
  const schemaPrefix = table.schema ? `${quoteIdentifier(table.schema, dbType)}.` : '';
  const fullTableName = `${schemaPrefix}${quotedTableName}`;

  const lines: string[] = [];
  const pkCols = table.columns.filter((c) => c.is_primary_key);

  // Column definitions
  for (const col of table.columns) {
    const quotedColName = quoteIdentifier(col.name, dbType);
    const typeStr = formatColumnType(col, dbType);
    let colLine = `  ${quotedColName} ${typeStr}`;

    // SQLite AUTOINCREMENT handles PK in column definition
    if (dbType === 'Sqlite' && col.is_primary_key && col.is_auto_increment) {
      lines.push(colLine);
      continue;
    }

    if (!col.is_nullable) {
      colLine += ' NOT NULL';
    }

    if (col.default_value !== undefined && col.default_value !== null && col.default_value !== '') {
      colLine += ` DEFAULT ${col.default_value}`;
    }

    lines.push(colLine);
  }

  // Primary Key constraint
  if (pkCols.length > 0 && !(dbType === 'Sqlite' && pkCols.some((c) => c.is_auto_increment))) {
    const pkQuoted = pkCols.map((c) => quoteIdentifier(c.name, dbType)).join(', ');
    lines.push(`  PRIMARY KEY (${pkQuoted})`);
  }

  // Foreign Key constraints
  if (table.foreign_keys && table.foreign_keys.length > 0) {
    for (const fk of table.foreign_keys) {
      const srcQuoted = quoteIdentifier(fk.source_column, dbType);
      const targetQuoted = quoteIdentifier(fk.target_column, dbType);
      const targetTableQuoted = quoteIdentifier(fk.target_table, dbType);

      let fkLine = `  CONSTRAINT ${quoteIdentifier(fk.constraint_name, dbType)} FOREIGN KEY (${srcQuoted}) REFERENCES ${targetTableQuoted} (${targetQuoted})`;

      if (fk.on_delete && fk.on_delete !== 'NoAction') {
        fkLine += ` ON DELETE ${fk.on_delete.toUpperCase()}`;
      }
      if (fk.on_update && fk.on_update !== 'NoAction') {
        fkLine += ` ON UPDATE ${fk.on_update.toUpperCase()}`;
      }

      lines.push(fkLine);
    }
  }

  let ddl = `CREATE TABLE ${fullTableName} (\n${lines.join(',\n')}\n);`;

  // Secondary indexes
  if (table.indexes && table.indexes.length > 0) {
    const indexStmts: string[] = [];
    for (const idx of table.indexes) {
      // Don't duplicate primary key index
      if (idx.is_unique && pkCols.length > 0 && idx.columns.join(',') === pkCols.map((c) => c.name).join(',')) {
        continue;
      }
      const uniqueStr = idx.is_unique ? 'UNIQUE ' : '';
      const idxQuoted = quoteIdentifier(idx.name, dbType);
      const idxColsQuoted = idx.columns.map((c: string) => quoteIdentifier(c, dbType)).join(', ');
      indexStmts.push(
        `CREATE ${uniqueStr}INDEX ${idxQuoted} ON ${fullTableName} (${idxColsQuoted});`
      );
    }

    if (indexStmts.length > 0) {
      ddl += '\n\n' + indexStmts.join('\n');
    }
  }

  return ddl;
}
