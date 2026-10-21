/**
 * @file schemaHealth.test.ts
 * @brief Unit tests for schemaHealth domain models and validation types.
 */

import { describe, it, expect } from 'vitest';
import type {
  HealthIssue,
  HealthRuleCategory,
  HealthSeverity,
  SchemaHealthReport,
} from './schemaHealth';

describe('schemaHealth types', () => {
  it('validates HealthIssue structure and fields', () => {
    const issue: HealthIssue = {
      id: 'missing-pk-users',
      severity: 'critical',
      category: 'integrity',
      tableName: 'users',
      ruleTitle: 'Missing Primary Key',
      description: 'Table users has no primary key.',
      impact: 'Slow operations',
      quickFixSql: 'ALTER TABLE "users" ADD PRIMARY KEY ("id");',
    };

    expect(issue.id).toBe('missing-pk-users');
    expect(issue.severity).toBe('critical');
    expect(issue.category).toBe('integrity');
    expect(issue.tableName).toBe('users');
    expect(issue.quickFixSql).toBeDefined();
  });

  it('validates SchemaHealthReport data contract', () => {
    const report: SchemaHealthReport = {
      score: 95,
      scoreGrade: 'Excellent',
      totalTables: 4,
      issues: [],
      criticalCount: 0,
      warningCount: 0,
      infoCount: 0,
      bundledQuickFixSql: '-- No fixes required',
    };

    expect(report.score).toBe(95);
    expect(report.scoreGrade).toBe('Excellent');
    expect(report.totalTables).toBe(4);
    expect(report.issues).toHaveLength(0);
  });

  it('supports all valid severities and categories', () => {
    const severities: HealthSeverity[] = ['critical', 'warning', 'info'];
    const categories: HealthRuleCategory[] = ['integrity', 'performance', 'naming', 'optimization'];

    expect(severities).toHaveLength(3);
    expect(categories).toHaveLength(4);
  });
});
