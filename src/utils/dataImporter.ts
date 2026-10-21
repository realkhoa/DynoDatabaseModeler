/**
 * @file dataImporter.ts
 * @brief High-performance CSV & JSON data import parser, column mapping, and batch SQL insert generator.
 * @details Supports RFC 4180 CSV parsing (with quoted cells, multiline text, custom delimiters),
 * structured JSON array parsing, data type inference, heuristic column auto-mapping, and dialect-aware
 * chunked SQL INSERT generation with conflict resolution (Postgres, MySQL, SQLite, MSSQL).
 */

import type { CanonicalType, ColumnSchema, DatabaseType } from '../types/database';

/**
 * @brief Conflict resolution strategy when inserting imported rows.
 */
export type ImportConflictResolution = 'abort' | 'ignore' | 'replace';

/**
 * @brief Column mapping dictionary mapping source data header name to target database column name.
 * A value of null indicates the source column should be skipped during import.
 */
export type ColumnMapping = Record<string, string | null>;

/**
 * @brief Result of parsing CSV or JSON import source text.
 */
export interface ParsedImportData {
  /** Ordered list of detected header / property names */
  readonly headers: string[];
  /** 2D matrix of row values corresponding to headers */
  readonly rows: unknown[][];
  /** Total number of rows parsed */
  readonly totalRows: number;
  /** Format of the source payload ('csv' or 'json') */
  readonly format: 'csv' | 'json';
  /** Detected delimiter if CSV */
  readonly delimiter?: string;
}

/**
 * @brief Options configuring batch SQL insert generation.
 */
export interface BatchInsertOptions {
  /** Name of the target database table */
  readonly tableName: string;
  /** Mapping of source header -> target column */
  readonly columnMapping: ColumnMapping;
  /** Ordered list of source headers */
  readonly headers: string[];
  /** Matrix of raw parsed row values */
  readonly rows: unknown[][];
  /** Target database engine dialect */
  readonly dbType?: DatabaseType;
  /** Conflict handling strategy ('abort', 'ignore', 'replace') */
  readonly onConflict?: ImportConflictResolution;
  /** Maximum number of rows per single multi-row INSERT statement (default: 200) */
  readonly chunkSize?: number;
}

/**
 * @brief Detects the delimiter character used in a CSV text sample.
 * @param sampleText First few lines of CSV content.
 * @return Detected delimiter character (',', ';', '\t', or '|').
 */
export function detectDelimiter(sampleText: string): string {
  if (!sampleText) return ',';
  const firstLine = sampleText.split(/\r?\n/)[0] || '';
  const counts: Record<string, number> = {
    ',': (firstLine.match(/,/g) || []).length,
    ';': (firstLine.match(/;/g) || []).length,
    '\t': (firstLine.match(/\t/g) || []).length,
    '|': (firstLine.match(/\|/g) || []).length,
  };

  let bestDelimiter = ',';
  let maxCount = -1;
  for (const [delim, count] of Object.entries(counts)) {
    if (count > maxCount) {
      maxCount = count;
      bestDelimiter = delim;
    }
  }
  return maxCount > 0 ? bestDelimiter : ',';
}

/**
 * @brief Parses RFC 4180 compliant CSV text into headers and row matrix.
 * @details Handles escaped quotes (""), commas inside quotes, and multiline text cells.
 * @param text Raw CSV content.
 * @param customDelimiter Optional explicit delimiter. If omitted, automatically detected.
 * @return Parsed headers and rows.
 */
export function parseCsv(text: string, customDelimiter?: string): ParsedImportData {
  const cleanText = text.trim();
  if (!cleanText) {
    return { headers: [], rows: [], totalRows: 0, format: 'csv', delimiter: ',' };
  }

  const delimiter = customDelimiter || detectDelimiter(cleanText);
  const rows: string[][] = [];
  let currentRow: string[] = [];
  let currentCell = '';
  let insideQuotes = false;
  let i = 0;
  const len = cleanText.length;

  while (i < len) {
    const char = cleanText[i];
    const nextChar = cleanText[i + 1];

    if (insideQuotes) {
      if (char === '"') {
        if (nextChar === '"') {
          // Escaped quote: "" -> "
          currentCell += '"';
          i += 2;
          continue;
        } else {
          // End of quoted cell
          insideQuotes = false;
          i++;
          continue;
        }
      } else {
        currentCell += char;
        i++;
        continue;
      }
    } else {
      if (char === '"') {
        insideQuotes = true;
        i++;
        continue;
      } else if (char === delimiter) {
        currentRow.push(currentCell.trim());
        currentCell = '';
        i++;
        continue;
      } else if (char === '\r') {
        if (nextChar === '\n') {
          i += 2;
        } else {
          i++;
        }
        currentRow.push(currentCell.trim());
        rows.push(currentRow);
        currentRow = [];
        currentCell = '';
        continue;
      } else if (char === '\n') {
        currentRow.push(currentCell.trim());
        rows.push(currentRow);
        currentRow = [];
        currentCell = '';
        i++;
        continue;
      } else {
        currentCell += char;
        i++;
        continue;
      }
    }
  }

  // Push remaining cell and row if non-empty
  if (currentCell.length > 0 || currentRow.length > 0) {
    currentRow.push(currentCell.trim());
    rows.push(currentRow);
  }

  if (rows.length === 0) {
    return { headers: [], rows: [], totalRows: 0, format: 'csv', delimiter };
  }

  const headers = rows[0].map((h, idx) => h || `column_${idx + 1}`);
  const dataRows = rows.slice(1).filter((r) => r.some((cell) => cell.length > 0));

  return {
    headers,
    rows: dataRows,
    totalRows: dataRows.length,
    format: 'csv',
    delimiter,
  };
}

/**
 * @brief Parses JSON content (array of objects or object with array property) into headers and rows.
 * @param text Raw JSON text.
 * @return Parsed headers and rows.
 * @throws Error if JSON syntax is invalid or structure is unsupported.
 */
export function parseJsonData(text: string): ParsedImportData {
  const clean = text.trim();
  if (!clean) {
    return { headers: [], rows: [], totalRows: 0, format: 'json' };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(clean);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`Invalid JSON syntax: ${msg}`);
  }

  let records: Record<string, unknown>[] = [];

  if (Array.isArray(parsed)) {
    records = parsed.filter((item): item is Record<string, unknown> => item !== null && typeof item === 'object');
  } else if (parsed !== null && typeof parsed === 'object') {
    // Check if an array property exists (e.g. { data: [...], records: [...] })
    const obj = parsed as Record<string, unknown>;
    const firstArrayKey = Object.keys(obj).find((k) => Array.isArray(obj[k]));
    if (firstArrayKey && Array.isArray(obj[firstArrayKey])) {
      records = (obj[firstArrayKey] as unknown[]).filter(
        (item): item is Record<string, unknown> => item !== null && typeof item === 'object'
      );
    } else {
      // Single object as 1 row
      records = [obj];
    }
  }

  if (records.length === 0) {
    return { headers: [], rows: [], totalRows: 0, format: 'json' };
  }

  // Collect all unique keys across all records
  const headerSet = new Set<string>();
  for (const record of records) {
    for (const key of Object.keys(record)) {
      headerSet.add(key);
    }
  }
  const headers = Array.from(headerSet);

  const rows = records.map((record) => {
    return headers.map((header) => {
      const val = record[header];
      return val === undefined ? null : val;
    });
  });

  return {
    headers,
    rows,
    totalRows: rows.length,
    format: 'json',
  };
}

/**
 * @brief Infers canonical database type from a sample array of column values.
 * @param values Array of sample row values.
 * @return Inferred CanonicalType.
 */
export function inferColumnType(values: unknown[]): CanonicalType {
  const nonNull = values.filter((v) => v !== null && v !== undefined && v !== '');
  if (nonNull.length === 0) {
    return { Varchar: 255 };
  }

  let canBeBoolean = true;
  let canBeInteger = true;
  let canBeFloat = true;
  let canBeTimestamp = true;
  let canBeJson = true;

  for (const v of nonNull) {
    const str = String(v).trim();

    // Check boolean
    if (typeof v === 'boolean') {
      // boolean primitive
    } else if (['true', 'false', '1', '0', 'yes', 'no'].includes(str.toLowerCase())) {
      // boolean string
    } else {
      canBeBoolean = false;
    }

    // Check integer
    if (!/^-?\d+$/.test(str)) {
      canBeInteger = false;
    }

    // Check float
    if (!/^-?\d+(\.\d+)?([eE][+-]?\d+)?$/.test(str)) {
      canBeFloat = false;
    }

    // Check timestamp / date
    if (canBeTimestamp) {
      const isDatePattern = /^\d{4}-\d{2}-\d{2}/.test(str) || /^\d{2}\/\d{2}\/\d{4}/.test(str);
      const parsedTime = Date.parse(str);
      if (!isDatePattern || Number.isNaN(parsedTime)) {
        canBeTimestamp = false;
      }
    }

    // Check JSON
    if (canBeJson) {
      if (typeof v === 'object') {
        // already object/array
      } else if ((str.startsWith('{') && str.endsWith('}')) || (str.startsWith('[') && str.endsWith(']'))) {
        try {
          JSON.parse(str);
        } catch {
          canBeJson = false;
        }
      } else {
        canBeJson = false;
      }
    }
  }

  if (canBeBoolean) return 'Boolean';
  if (canBeInteger) {
    const isBig = nonNull.some((v) => {
      const num = Number(v);
      return num > 2147483647 || num < -2147483648;
    });
    return isBig ? 'BigInt' : 'Integer';
  }
  if (canBeFloat) return 'Float';
  if (canBeTimestamp) return 'Timestamp';
  if (canBeJson) return 'Json';

  const maxLen = Math.max(...nonNull.map((v) => String(v).length));
  if (maxLen > 255) return 'Text';
  return { Varchar: Math.max(50, Math.ceil(maxLen / 50) * 50) };
}

/**
 * @brief Normalizes an identifier string for fuzzy matching (strips underscores, hyphens, and lowercase).
 * @param str Input identifier.
 * @return Normalized lowercase alphanumeric string.
 */
function normalizeIdentifier(str: string): string {
  return str.toLowerCase().replace(/[_\-\s]+/g, '');
}

/**
 * @brief Heuristically maps source headers to target table column names.
 * @param sourceHeaders Headers from parsed CSV or JSON.
 * @param targetColumns Columns of the selected database table.
 * @return Map of sourceHeader -> targetColumnName (or null if unmapped).
 */
export function autoMapColumns(
  sourceHeaders: string[],
  targetColumns: ColumnSchema[]
): ColumnMapping {
  const mapping: ColumnMapping = {};
  const targetColMap = new Map<string, string>();

  for (const col of targetColumns) {
    // Exact lowercase
    targetColMap.set(col.name.toLowerCase(), col.name);
    // Stripped
    targetColMap.set(normalizeIdentifier(col.name), col.name);
  }

  for (const header of sourceHeaders) {
    const lower = header.toLowerCase();
    const normalized = normalizeIdentifier(header);

    if (targetColMap.has(lower)) {
      mapping[header] = targetColMap.get(lower)!;
    } else if (targetColMap.has(normalized)) {
      mapping[header] = targetColMap.get(normalized)!;
    } else {
      // Try singular / plural variations
      const noS = lower.replace(/s$/, '');
      if (targetColMap.has(noS)) {
        mapping[header] = targetColMap.get(noS)!;
      } else {
        mapping[header] = null;
      }
    }
  }

  return mapping;
}

/**
 * @brief Escapes an identifier according to database dialect.
 * @param name Table or column identifier.
 * @param dbType Relational database engine dialect.
 * @return Dialect-escaped identifier.
 */
function escapeIdentifier(name: string, dbType?: DatabaseType): string {
  switch (dbType) {
    case 'MySql':
    case 'MariaDb':
    case 'TiDb':
      return `\`${name.replace(/`/g, '``')}\``;
    case 'Mssql':
      return `[${name.replace(/]/g, ']]')}]`;
    default:
      // Postgres, Sqlite, DuckDb, Universal
      return `"${name.replace(/"/g, '""')}"`;
  }
}

/**
 * @brief Formats a raw value into a safe SQL literal expression.
 * @param val Cell value to format.
 * @return Formatted SQL literal string (e.g. 'text', 123, TRUE, NULL).
 */
export function formatSqlValue(val: unknown): string {
  if (val === null || val === undefined || val === '') {
    return 'NULL';
  }

  if (typeof val === 'number') {
    return Number.isFinite(val) ? String(val) : 'NULL';
  }

  if (typeof val === 'boolean') {
    return val ? 'TRUE' : 'FALSE';
  }

  if (typeof val === 'object') {
    const jsonStr = JSON.stringify(val);
    return `'${jsonStr.replace(/'/g, "''")}'`;
  }

  const str = String(val);
  return `'${str.replace(/'/g, "''")}'`;
}

/**
 * @brief Generates executable batch SQL INSERT statements for the imported rows.
 * @param options Batch insert generation configuration options.
 * @return Complete SQL script including transactions and chunked multi-row INSERTs.
 */
export function generateBatchInsertSql(options: BatchInsertOptions): string {
  const {
    tableName,
    columnMapping,
    headers,
    rows,
    dbType = 'Postgres',
    onConflict = 'abort',
    chunkSize = 200,
  } = options;

  // Identify active mapped columns
  const activePairs: { headerIdx: number; targetCol: string }[] = [];
  headers.forEach((header, idx) => {
    const target = columnMapping[header];
    if (target) {
      activePairs.push({ headerIdx: idx, targetCol: target });
    }
  });

  if (activePairs.length === 0 || rows.length === 0) {
    return `-- No mapped columns or rows to import for table ${tableName}`;
  }

  const escapedTableName = escapeIdentifier(tableName, dbType);
  const escapedColumns = activePairs
    .map((p) => escapeIdentifier(p.targetCol, dbType))
    .join(', ');

  const sqlStatements: string[] = [];

  // Transaction header
  if (dbType === 'Mssql') {
    sqlStatements.push('BEGIN TRANSACTION;');
  } else {
    sqlStatements.push('BEGIN;');
  }

  // Conflict clause preparation
  let conflictClause = '';
  let insertVerb = 'INSERT INTO';

  if (onConflict === 'ignore') {
    switch (dbType) {
      case 'Postgres':
      case 'CockroachDb':
        conflictClause = ' ON CONFLICT DO NOTHING';
        break;
      case 'Sqlite':
        insertVerb = 'INSERT OR IGNORE INTO';
        break;
      case 'MySql':
      case 'MariaDb':
      case 'TiDb':
        insertVerb = 'INSERT IGNORE INTO';
        break;
      default:
        break;
    }
  } else if (onConflict === 'replace') {
    switch (dbType) {
      case 'Sqlite':
        insertVerb = 'INSERT OR REPLACE INTO';
        break;
      case 'MySql':
      case 'MariaDb':
      case 'TiDb':
        insertVerb = 'REPLACE INTO';
        break;
      default:
        break;
    }
  }

  // Chunk rows into blocks of chunkSize
  const effectiveChunk = Math.max(1, chunkSize);
  for (let c = 0; c < rows.length; c += effectiveChunk) {
    const chunkRows = rows.slice(c, c + effectiveChunk);
    const valueTuples: string[] = [];

    for (const row of chunkRows) {
      const values = activePairs.map((p) => formatSqlValue(row[p.headerIdx]));
      valueTuples.push(`(${values.join(', ')})`);
    }

    const insertSql = `${insertVerb} ${escapedTableName} (${escapedColumns})\nVALUES\n  ${valueTuples.join(',\n  ')}${conflictClause};`;
    sqlStatements.push(insertSql);
  }

  // Transaction footer
  sqlStatements.push('COMMIT;');

  return sqlStatements.join('\n\n');
}
