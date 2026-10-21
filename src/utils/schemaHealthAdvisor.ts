/**
 * @file schemaHealthAdvisor.ts
 * @brief Autonomous Database Schema Health Advisor & Linter for DynoDbModeler.
 * @details Inspects database schemas and scores overall design health (0-100%) across
 * referential integrity, unindexed foreign keys, redundant indexes, reserved keyword collisions,
 * and data type optimization, producing executable quick-fix SQL scripts.
 */

import type { DatabaseSchema, DatabaseType, IndexSchema, TableSchema } from '../types/database';
import { formatCanonicalType } from '../types/database';
import type {
  HealthIssue,
  HealthRuleCategory,
  HealthSeverity,
  SchemaHealthReport,
} from '../types/schemaHealth';

export type { HealthIssue, HealthRuleCategory, HealthSeverity, SchemaHealthReport };

/**
 * @brief List of common SQL reserved keywords that cause syntax collisions if unquoted.
 */
const SQL_RESERVED_KEYWORDS = new Set([
  'order', 'user', 'group', 'table', 'select', 'where', 'from', 'join',
  'check', 'index', 'key', 'database', 'value', 'values', 'column', 'by',
  'primary', 'foreign', 'constraint', 'default', 'limit', 'offset', 'view',
]);

/**
 * @brief Escapes an identifier according to database dialect.
 * @param name Identifier name.
 * @param dbType Relational database engine dialect.
 * @return Escaped identifier.
 */
function escapeIdentifier(name: string, dbType: DatabaseType = 'Postgres'): string {
  switch (dbType) {
    case 'MySql':
    case 'MariaDb':
    case 'TiDb':
      return `\`${name.replace(/`/g, '``')}\``;
    case 'Mssql':
      return `[${name.replace(/]/g, ']]')}]`;
    default:
      return `"${name.replace(/"/g, '""')}"`;
  }
}

/**
 * @brief Evaluates whether an index covers a given column as its leading key.
 * @param table Table schema.
 * @param columnName Name of the column to check.
 * @return `true` if an index covers this column as leading prefix.
 */
function hasCoveringIndex(table: TableSchema, columnName: string): boolean {
  if (!table.indexes) return false;
  return table.indexes.some((idx) => {
    return idx.columns && idx.columns.length > 0 && idx.columns[0].toLowerCase() === columnName.toLowerCase();
  });
}

/**
 * @brief Checks if a table or column name has an unquoted reserved keyword collision.
 * @param name Identifier name.
 * @return `true` if identifier matches a standard SQL keyword.
 */
export function isReservedKeyword(name: string): boolean {
  return SQL_RESERVED_KEYWORDS.has(name.toLowerCase());
}

/**
 * @brief Checks if a specific index is covered as a prefix by any composite index.
 * @param target Target index to check.
 * @param allIndexes All indexes on the table.
 * @return Redundant covering index or null.
 */
function findCoveringSuperIndex(target: IndexSchema, allIndexes: IndexSchema[]): IndexSchema | null {
  if (!target.columns || target.columns.length === 0) return null;
  const match = allIndexes.find((candidate) => {
    if (candidate === target) return false;
    if (!candidate.columns || candidate.columns.length <= target.columns.length) return false;
    return target.columns.every(
      (col, idx) => candidate.columns[idx]?.toLowerCase() === col.toLowerCase()
    );
  });
  return match ?? null;
}

/**
 * @brief Identifies redundant or duplicate leading indexes on a table.
 * @param table Table schema to evaluate.
 * @param dbType Database engine dialect.
 * @return Array of redundant index health issues.
 */
function findRedundantIndexIssues(table: TableSchema, dbType: DatabaseType): HealthIssue[] {
  if (!table.indexes || table.indexes.length <= 1) return [];

  return table.indexes.flatMap((idxA) => {
    const coveringIdx = findCoveringSuperIndex(idxA, table.indexes);
    if (!coveringIdx) return [];

    return [
      {
        id: `redundant-index-${table.name}-${idxA.name}`,
        severity: 'warning',
        category: 'performance',
        tableName: table.name,
        ruleTitle: 'Redundant Leading Index',
        description:
          `Index "${idxA.name}" (${idxA.columns.join(', ')}) is redundant because ` +
          `composite index "${coveringIdx.name}" (${coveringIdx.columns.join(', ')}) already covers it.`,
        impact:
          'Duplicate indexes consume unnecessary storage and degrade INSERT, UPDATE, and DELETE write throughput.',
        quickFixSql: `DROP INDEX ${escapeIdentifier(idxA.name, dbType)};`,
      },
    ];
  });
}

/**
 * @brief Autonomous schema health analyzer and linter.
 * @details Evaluates 8 deterministic heuristics across referential integrity, indexes, and naming.
 * @param schema Introspected or modeled database schema.
 * @param dbType Relational database engine dialect.
 * @return Comprehensive SchemaHealthReport.
 */
export function analyzeSchemaHealth(
  schema: DatabaseSchema,
  dbType: DatabaseType = 'Postgres'
): SchemaHealthReport {
  const issues: HealthIssue[] = [];
  const tables = schema?.tables || [];

  if (tables.length === 0) {
    return {
      score: 100,
      scoreGrade: 'Excellent',
      totalTables: 0,
      issues: [],
      criticalCount: 0,
      warningCount: 0,
      infoCount: 0,
      bundledQuickFixSql: '-- Schema has no tables.',
    };
  }

  // Detect naming casing convention across all tables
  let snakeCount = 0;
  let camelCount = 0;
  for (const t of tables) {
    if (t.name.includes('_') || /^[a-z0-9_]+$/.test(t.name)) {
      snakeCount++;
    } else if (/^[a-z]+[A-Z0-9]/.test(t.name) || /^[A-Z][a-zA-Z0-9]+$/.test(t.name)) {
      camelCount++;
    }
  }

  if (snakeCount > 0 && camelCount > 0) {
    issues.push({
      id: 'global-inconsistent-casing',
      severity: 'info',
      category: 'naming',
      tableName: '*',
      ruleTitle: 'Mixed Table Naming Conventions',
      description: `Schema contains ${snakeCount} snake_case tables and ${camelCount} camelCase/PascalCase tables.`,
      impact:
        'Inconsistent naming creates developer friction and can trigger query failures on case-sensitive OS.',
    });
  }

  for (const table of tables) {
    const escapedTable = escapeIdentifier(table.name, dbType);

    // Rule 1: Missing Primary Key
    const pkColumns = table.columns.filter((c) => c.is_primary_key);
    if (table.columns.length > 0 && pkColumns.length === 0) {
      const idCol = table.columns.find((c) => c.name.toLowerCase() === 'id');
      const fixSql = idCol
        ? `ALTER TABLE ${escapedTable} ADD PRIMARY KEY (${escapeIdentifier(idCol.name, dbType)});`
        : `ALTER TABLE ${escapedTable} ADD COLUMN ${escapeIdentifier('id', dbType)} ` +
          'BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY;';

      issues.push({
        id: `missing-pk-${table.name}`,
        severity: 'critical',
        category: 'integrity',
        tableName: table.name,
        ruleTitle: 'Missing Primary Key',
        description: `Table "${table.name}" has no primary key defined.`,
        impact:
          'Without a primary key, UPDATE/DELETE operations perform slow table scans, and CDC tools cannot track rows.',
        quickFixSql: fixSql,
      });
    }

    // Rule 2: Unindexed Foreign Keys
    if (table.foreign_keys) {
      for (const fk of table.foreign_keys) {
        const sourceColName = fk.source_column;
        const sourceCol = table.columns.find((c) => c.name === sourceColName);

        // If source column is single primary key, it is already indexed
        const isSinglePk = pkColumns.length === 1 && pkColumns[0].name === sourceColName;
        const hasIndex = hasCoveringIndex(table, sourceColName);

        if (!isSinglePk && !hasIndex && sourceCol) {
          const idxName = `idx_${table.name}_${sourceColName}`.replace(/[^a-zA-Z0-9_]/g, '_');
          const fixSql =
            `CREATE INDEX ${escapeIdentifier(idxName, dbType)} ` +
            `ON ${escapedTable} (${escapeIdentifier(sourceColName, dbType)});`;

          issues.push({
            id: `unindexed-fk-${table.name}-${sourceColName}`,
            severity: 'warning',
            category: 'performance',
            tableName: table.name,
            columnName: sourceColName,
            ruleTitle: 'Unindexed Foreign Key',
            description: `Foreign key "${sourceColName}" in table "${table.name}" lacks a supporting index.`,
            impact:
              'JOIN queries filtering on this key perform full-table scans, and parent updates may lock table.',
            quickFixSql: fixSql,
          });
        }
      }
    }

    // Rule 3: Redundant / Duplicate Indexes
    issues.push(...findRedundantIndexIssues(table, dbType));

    // Rule 4: Reserved Keyword Table Name
    if (isReservedKeyword(table.name)) {
      issues.push({
        id: `reserved-keyword-table-${table.name}`,
        severity: 'warning',
        category: 'naming',
        tableName: table.name,
        ruleTitle: 'Reserved SQL Keyword in Table Name',
        description: `Table name "${table.name}" is a standard SQL reserved keyword.`,
        impact: 'Queries must always explicitly quote this table identifier to avoid syntax parsing errors.',
      });
    }

    // Column-level Rules
    for (const col of table.columns) {
      const colNameLower = col.name.toLowerCase();

      // Rule 5: Reserved Keyword Column Name
      if (isReservedKeyword(col.name)) {
        issues.push({
          id: `reserved-keyword-col-${table.name}-${col.name}`,
          severity: 'warning',
          category: 'naming',
          tableName: table.name,
          columnName: col.name,
          ruleTitle: 'Reserved SQL Keyword in Column Name',
          description: `Column "${col.name}" in table "${table.name}" is a standard SQL reserved keyword.`,
          impact: 'Requires quoting in SQL queries and may conflict with code generation in some ORMs.',
        });
      }

      // Rule 6: Apparent Relational Key Without Foreign Key Constraint
      const isRelationalSuffix = colNameLower.endsWith('_id') || colNameLower.endsWith('id');
      const isPk = col.is_primary_key;
      const hasFk = table.foreign_keys?.some((fk) => fk.source_column === col.name);

      if (isRelationalSuffix && !isPk && !hasFk && colNameLower !== 'id' && colNameLower !== 'uuid') {
        issues.push({
          id: `missing-fk-${table.name}-${col.name}`,
          severity: 'info',
          category: 'integrity',
          tableName: table.name,
          columnName: col.name,
          ruleTitle: 'Missing Foreign Key Constraint',
          description: `Column "${col.name}" appears to reference another entity but has no foreign key constraint.`,
          impact:
            'Without referential constraints, orphaned records can be inserted, violating data integrity.',
        });
      }

      // Rule 7: Monetary / Price Values Stored as Float or Double
      const typeStr = formatCanonicalType(col.data_type).toLowerCase();
      const isFinancialName =
        colNameLower.includes('price') ||
        colNameLower.includes('amount') ||
        colNameLower.includes('salary') ||
        colNameLower.includes('cost') ||
        colNameLower.includes('balance');
      const isFloatType = typeStr.includes('float') || typeStr.includes('double');

      if (isFinancialName && isFloatType) {
        issues.push({
          id: `float-financial-${table.name}-${col.name}`,
          severity: 'warning',
          category: 'optimization',
          tableName: table.name,
          columnName: col.name,
          ruleTitle: 'Financial Value Stored as Approximate Float',
          description: `Column "${col.name}" represents financial amounts but is typed as ${typeStr}.`,
          impact:
            'Floating-point values suffer from IEEE-754 binary rounding inaccuracies. Use DECIMAL for precision.',
          quickFixSql:
            `ALTER TABLE ${escapedTable} ALTER COLUMN ` +
            `${escapeIdentifier(col.name, dbType)} TYPE DECIMAL(12, 2);`,
        });
      }
    }
  }

  // Calculate summary metrics
  const criticalCount = issues.filter((i) => i.severity === 'critical').length;
  const warningCount = issues.filter((i) => i.severity === 'warning').length;
  const infoCount = issues.filter((i) => i.severity === 'info').length;

  const rawScore = 100 - criticalCount * 25 - warningCount * 8 - infoCount * 2;
  const score = Math.max(0, Math.min(100, rawScore));

  let scoreGrade: 'Excellent' | 'Good' | 'Fair' | 'Poor';
  if (score >= 90) scoreGrade = 'Excellent';
  else if (score >= 75) scoreGrade = 'Good';
  else if (score >= 50) scoreGrade = 'Fair';
  else scoreGrade = 'Poor';

  // Bundle all available quick fixes into a single migration script
  const quickFixes = issues.map((i) => i.quickFixSql).filter(Boolean) as string[];
  const bundledQuickFixSql =
    quickFixes.length > 0
      ? ['-- DynoDbModeler Schema Health Advisor Auto-Remediation Script', 'BEGIN;', ...quickFixes, 'COMMIT;'].join(
          '\n\n'
        )
      : '-- No automatic quick fixes available.';

  return {
    score,
    scoreGrade,
    totalTables: tables.length,
    issues,
    criticalCount,
    warningCount,
    infoCount,
    bundledQuickFixSql,
  };
}
