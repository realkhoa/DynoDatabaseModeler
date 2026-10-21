/**
 * @file mockDataGenerator.ts
 * @brief Synthetic mock data generator for relational database tables.
 * @details Generates realistic test rows matching column canonical types and naming patterns,
 * inspired by Antares SQL faker rows and DBeaver mock data generation.
 */

import type { ColumnSchema, DatabaseType } from '../types/database';
import { formatCanonicalType } from '../types/database';

/**
 * @brief Supported mock data generation strategy types.
 */
export type MockGeneratorType =
  | 'FullName'
  | 'FirstName'
  | 'LastName'
  | 'Email'
  | 'Uuid'
  | 'PhoneNumber'
  | 'Company'
  | 'City'
  | 'Country'
  | 'StreetAddress'
  | 'Integer'
  | 'Float'
  | 'Boolean'
  | 'Date'
  | 'Timestamp'
  | 'LoremSentence'
  | 'Constant';

/**
 * @brief Configuration parameters for a single column's mock data generator.
 */
export interface ColumnGeneratorConfig {
  /** @brief Selected generator algorithm strategy. */
  generatorType: MockGeneratorType;
  /** @brief Static literal value used if generatorType is 'Constant'. */
  constantValue?: string;
  /** @brief Minimum numeric value if generatorType is Integer/Float. */
  minValue?: number;
  /** @brief Maximum numeric value if generatorType is Integer/Float. */
  maxValue?: number;
  /** @brief Whether to generate sequential autoincrement numbers instead of random. */
  isAutoIncrement?: boolean;
  /** @brief Percentage (0-100) probability of outputting a NULL value for nullable columns. */
  nullPercentage?: number;
}

const SAMPLE_FIRST_NAMES = [
  'James', 'Mary', 'John', 'Patricia', 'Robert', 'Jennifer', 'Michael', 'Linda',
  'William', 'Elizabeth', 'David', 'Barbara', 'Richard', 'Susan', 'Joseph', 'Jessica',
  'Thomas', 'Sarah', 'Charles', 'Karen', 'Daniel', 'Nancy', 'Matthew', 'Lisa',
  'Anthony', 'Betty', 'Donald', 'Margaret', 'Mark', 'Sandra', 'Paul', 'Ashley',
];

const SAMPLE_LAST_NAMES = [
  'Smith', 'Johnson', 'Williams', 'Brown', 'Jones', 'Garcia', 'Miller', 'Davis',
  'Rodriguez', 'Martinez', 'Hernandez', 'Lopez', 'Gonzalez', 'Wilson', 'Anderson',
  'Thomas', 'Taylor', 'Moore', 'Jackson', 'Martin', 'Lee', 'Perez', 'Thompson',
  'White', 'Harris', 'Sanchez', 'Clark', 'Ramirez', 'Lewis', 'Robinson', 'Walker',
];

const SAMPLE_DOMAINS = ['example.com', 'acme.org', 'testcorp.io', 'dynomail.net', 'databox.dev'];

const SAMPLE_CITIES = ['New York', 'London', 'Tokyo', 'Paris', 'Berlin', 'Singapore', 'Sydney', 'Toronto', 'Hanoi', 'Seoul'];
const SAMPLE_COUNTRIES = ['United States', 'United Kingdom', 'Germany', 'Japan', 'France', 'Canada', 'Australia', 'Vietnam'];
const SAMPLE_STREETS = ['Oak Street', 'Pine Avenue', 'Maple Road', 'Cedar Blvd', 'Main Street', 'Market Street', 'Broadway'];
const SAMPLE_COMPANIES = ['Acme Industries', 'Globex Corporation', 'Soylent Corp', 'Initech', 'Umbrella Co', 'Cyberdyne Systems'];

const LOREM_WORDS = [
  'lorem', 'ipsum', 'dolor', 'sit', 'amet', 'consectetur', 'adipiscing', 'elit',
  'sed', 'do', 'eiusmod', 'tempor', 'incididunt', 'ut', 'labore', 'et', 'dolore',
  'magna', 'aliqua', 'enim', 'ad', 'minim', 'veniam', 'quis', 'nostrud',
];

/**
 * @brief Resolves canonical data type string name for matching.
 * @param col Column schema.
 * @return Uppercase canonical type name.
 */
function getCanonicalTypeName(col: ColumnSchema): string {
  if (typeof col.data_type === 'string') return col.data_type.toUpperCase();
  return formatCanonicalType(col.data_type).toUpperCase();
}

/**
 * @brief Intelligently detects the most suitable mock generator type based on column name and type.
 * @param col Column schema metadata.
 * @return Recommended generator strategy type.
 */
export function detectDefaultGenerator(col: ColumnSchema): MockGeneratorType {
  const name = col.name.toLowerCase();
  const typeStr = getCanonicalTypeName(col);

  if (name === 'id' || name.endsWith('_id') || name.startsWith('id_')) {
    if (typeStr.includes('UUID')) return 'Uuid';
    if (typeStr.includes('INT')) return 'Integer';
  }

  if (name.includes('email') || name.includes('mail')) return 'Email';
  if (name.includes('phone') || name.includes('mobile') || name.includes('tel')) return 'PhoneNumber';
  if (name === 'name' || name.includes('fullname') || name.includes('full_name')) return 'FullName';
  if (name.includes('first_name') || name.includes('firstname')) return 'FirstName';
  if (name.includes('last_name') || name.includes('lastname') || name.includes('surname')) return 'LastName';
  if (name.includes('company') || name.includes('org')) return 'Company';
  if (name.includes('city')) return 'City';
  if (name.includes('country')) return 'Country';
  if (name.includes('street') || name.includes('address')) return 'StreetAddress';
  if (name.includes('uuid') || name.includes('guid')) return 'Uuid';

  if (typeStr.includes('DATE') || typeStr.includes('TIME')) {
    return name.includes('date') && !name.includes('time') ? 'Date' : 'Timestamp';
  }

  if (typeStr.includes('BOOL')) return 'Boolean';
  if (typeStr.includes('FLOAT') || typeStr.includes('DOUBLE') || typeStr.includes('DECIMAL')) return 'Float';
  if (typeStr.includes('INT')) return 'Integer';
  if (typeStr.includes('UUID')) return 'Uuid';

  return 'LoremSentence';
}

/**
 * @brief Generates a pseudo-random UUID v4 string.
 * @return Formatted UUID string.
 */
export function generateMockUuid(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

/**
 * @brief Generates a mock cell value for a column based on configuration rules.
 * @param col Column schema.
 * @param config Column generator configuration.
 * @param rowIndex Zero-based index of the row being generated.
 * @return Generated raw cell value (string, number, boolean, or null).
 */
export function generateRowValue(
  col: ColumnSchema,
  config: ColumnGeneratorConfig,
  rowIndex: number
): unknown {
  if (col.is_nullable && config.nullPercentage && config.nullPercentage > 0) {
    if (Math.random() * 100 < config.nullPercentage) {
      return null;
    }
  }

  if (config.isAutoIncrement) {
    return rowIndex + 1;
  }

  switch (config.generatorType) {
    case 'Constant':
      return config.constantValue ?? '';

    case 'FullName': {
      const f = SAMPLE_FIRST_NAMES[Math.floor(Math.random() * SAMPLE_FIRST_NAMES.length)];
      const l = SAMPLE_LAST_NAMES[Math.floor(Math.random() * SAMPLE_LAST_NAMES.length)];
      return `${f} ${l}`;
    }

    case 'FirstName':
      return SAMPLE_FIRST_NAMES[Math.floor(Math.random() * SAMPLE_FIRST_NAMES.length)];

    case 'LastName':
      return SAMPLE_LAST_NAMES[Math.floor(Math.random() * SAMPLE_LAST_NAMES.length)];

    case 'Email': {
      const f = SAMPLE_FIRST_NAMES[Math.floor(Math.random() * SAMPLE_FIRST_NAMES.length)].toLowerCase();
      const l = SAMPLE_LAST_NAMES[Math.floor(Math.random() * SAMPLE_LAST_NAMES.length)].toLowerCase();
      const d = SAMPLE_DOMAINS[Math.floor(Math.random() * SAMPLE_DOMAINS.length)];
      const salt = Math.floor(Math.random() * 900) + 100;
      return `${f}.${l}${salt}@${d}`;
    }

    case 'PhoneNumber': {
      const p1 = Math.floor(Math.random() * 800) + 200;
      const p2 = Math.floor(Math.random() * 900) + 100;
      const p3 = Math.floor(Math.random() * 9000) + 1000;
      return `+1 (${p1}) ${p2}-${p3}`;
    }

    case 'City':
      return SAMPLE_CITIES[Math.floor(Math.random() * SAMPLE_CITIES.length)];

    case 'Country':
      return SAMPLE_COUNTRIES[Math.floor(Math.random() * SAMPLE_COUNTRIES.length)];

    case 'StreetAddress': {
      const num = Math.floor(Math.random() * 9900) + 100;
      const street = SAMPLE_STREETS[Math.floor(Math.random() * SAMPLE_STREETS.length)];
      return `${num} ${street}`;
    }

    case 'Company':
      return SAMPLE_COMPANIES[Math.floor(Math.random() * SAMPLE_COMPANIES.length)];

    case 'Uuid':
      return generateMockUuid();

    case 'Integer': {
      const min = config.minValue ?? 1;
      const max = config.maxValue ?? 1000;
      return Math.floor(Math.random() * (max - min + 1)) + min;
    }

    case 'Float': {
      const min = config.minValue ?? 0;
      const max = config.maxValue ?? 100;
      const val = Math.random() * (max - min) + min;
      return Number(val.toFixed(2));
    }

    case 'Boolean':
      return Math.random() > 0.5;

    case 'Date': {
      const date = new Date(Date.now() - Math.floor(Math.random() * 365 * 24 * 3600 * 1000));
      return date.toISOString().split('T')[0];
    }

    case 'Timestamp': {
      const date = new Date(Date.now() - Math.floor(Math.random() * 30 * 24 * 3600 * 1000));
      return date.toISOString().replace('T', ' ').slice(0, 19);
    }

    case 'LoremSentence':
    default: {
      const count = Math.floor(Math.random() * 6) + 4;
      const words: string[] = [];
      for (let i = 0; i < count; i++) {
        words.push(LOREM_WORDS[Math.floor(Math.random() * LOREM_WORDS.length)]);
      }
      const sentence = words.join(' ');
      return sentence.charAt(0).toUpperCase() + sentence.slice(1) + '.';
    }
  }
}

/**
 * @brief Formats a raw value as an escaped SQL literal string.
 * @param val Raw value.
 * @param col Column metadata.
 * @return SQL literal string.
 */
export function formatSqlLiteral(val: unknown, col: ColumnSchema): string {
  if (val === null || val === undefined) {
    return 'NULL';
  }
  if (typeof val === 'number') {
    return String(val);
  }
  if (typeof val === 'boolean') {
    return val ? 'TRUE' : 'FALSE';
  }
  const typeStr = getCanonicalTypeName(col);
  if (typeStr.includes('JSON')) {
    const str = typeof val === 'string' ? val : JSON.stringify(val);
    return `'${str.replace(/'/g, "''")}'`;
  }
  const str = String(val).replace(/'/g, "''");
  return `'${str}'`;
}

/**
 * @brief Quotes an identifier safely based on database engine dialect.
 * @param identifier Table or column name.
 * @param dbType Database engine dialect.
 * @return Quoted identifier.
 */
export function quoteIdentifier(identifier: string, dbType: DatabaseType = 'Postgres'): string {
  if (dbType === 'MySql') {
    return `\`${identifier.replace(/`/g, '``')}\``;
  }
  if (dbType === 'Mssql') {
    return `[${identifier.replace(/]/g, ']]')}]`;
  }
  return `"${identifier.replace(/"/g, '""')}"`;
}

/**
 * @brief Generates complete multi-row SQL INSERT statements for mock dataset creation.
 * @param tableName Target database table name.
 * @param columns Array of table column schemas.
 * @param configs Record of generator configurations for each column.
 * @param rowCount Number of rows to generate.
 * @param dbType Database engine dialect.
 * @return Formatted SQL INSERT query string.
 */
export function generateMockSql(
  tableName: string,
  columns: ColumnSchema[],
  configs: Record<string, ColumnGeneratorConfig>,
  rowCount: number,
  dbType: DatabaseType = 'Postgres'
): string {
  if (rowCount <= 0 || columns.length === 0) {
    return '';
  }

  const quotedTable = quoteIdentifier(tableName, dbType);
  const quotedCols = columns.map((c) => quoteIdentifier(c.name, dbType)).join(', ');

  const rowTuples: string[] = [];
  for (let r = 0; r < rowCount; r++) {
    const values = columns.map((col) => {
      const cfg = configs[col.name] ?? { generatorType: detectDefaultGenerator(col) };
      const rawVal = generateRowValue(col, cfg, r);
      return formatSqlLiteral(rawVal, col);
    });
    rowTuples.push(`(${values.join(', ')})`);
  }

  // SQLite, Postgres, MySQL support multi-row INSERT INTO tbl (cols) VALUES (...), (...)
  const sql = `INSERT INTO ${quotedTable} (${quotedCols})\nVALUES\n  ${rowTuples.join(',\n  ')};`;
  return sql;
}
