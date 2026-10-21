/**
 * @file schemaHealth.ts
 * @brief Domain types and interfaces for Schema Health Advisor & Database Linter.
 */

/**
 * @brief Severity level for a schema health finding.
 */
export type HealthSeverity = 'critical' | 'warning' | 'info';

/**
 * @brief Functional category of a schema health finding.
 */
export type HealthRuleCategory =
  | 'integrity'
  | 'performance'
  | 'naming'
  | 'optimization';

/**
 * @brief Individual issue or recommendation discovered during schema analysis.
 */
export interface HealthIssue {
  /** Unique deterministic identifier for the finding */
  readonly id: string;
  /** Severity rating */
  readonly severity: HealthSeverity;
  /** Category grouping */
  readonly category: HealthRuleCategory;
  /** Name of the table where the issue occurs */
  readonly tableName: string;
  /** Optional specific column associated with the issue */
  readonly columnName?: string;
  /** Short descriptive rule title */
  readonly ruleTitle: string;
  /** Detailed description of the detected anomaly */
  readonly description: string;
  /** Architectural or operational impact if left unresolved */
  readonly impact: string;
  /** Optional one-click executable SQL remediation statement */
  readonly quickFixSql?: string;
}

/**
 * @brief Complete diagnostic health report for a database schema.
 */
export interface SchemaHealthReport {
  /** Overall health score from 0 (worst) to 100 (flawless) */
  readonly score: number;
  /** Semantic grade label */
  readonly scoreGrade: 'Excellent' | 'Good' | 'Fair' | 'Poor';
  /** Total number of tables evaluated */
  readonly totalTables: number;
  /** Ordered list of detected issues */
  readonly issues: HealthIssue[];
  /** Count of critical integrity or performance flaws */
  readonly criticalCount: number;
  /** Count of performance and structural warnings */
  readonly warningCount: number;
  /** Count of stylistic and optimization recommendations */
  readonly infoCount: number;
  /** Bundled single migration script applying all safe quick fixes */
  readonly bundledQuickFixSql: string;
}
