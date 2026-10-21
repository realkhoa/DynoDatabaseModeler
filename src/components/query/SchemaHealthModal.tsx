/**
 * @file SchemaHealthModal.tsx
 * @brief Interactive Schema Health Advisor & Database Linter modal dialog.
 * @details Displays diagnostic health score, categorized findings (integrity, performance,
 * naming, data types), and generates executable one-click remediation SQL statements.
 */

import React, { useId, useState, useMemo, useCallback, useEffect } from 'react';
import { X, CheckCircle2 } from 'lucide-react';
import type { DatabaseSchema, DatabaseType } from '../../types/database';
import type {
  HealthIssue,
  HealthRuleCategory,
  HealthSeverity,
  SchemaHealthReport,
} from '../../types/schemaHealth';
import { analyzeSchemaHealth } from '../../utils/schemaHealthAdvisor';
import { HealthFilterToolbar } from './HealthFilterToolbar';
import { HealthIssueCard } from './HealthIssueCard';
import { HealthSummaryBanner } from './HealthSummaryBanner';

export type { HealthIssue, HealthRuleCategory, HealthSeverity, SchemaHealthReport };

/**
 * @brief Evaluates whether an issue matches current UI filter criteria.
 * @param issue Diagnostic issue to evaluate.
 * @param severity Selected severity rating.
 * @param category Selected category.
 * @param table Selected table name.
 * @param trimmed Lowercase search query.
 * @return True if issue passes all active filters.
 */
function matchesIssueFilter(
  issue: HealthIssue,
  severity: HealthSeverity | 'all',
  category: HealthRuleCategory | 'all',
  table: string,
  trimmed: string
): boolean {
  const matchesSeverity = severity === 'all' || issue.severity === severity;
  const matchesCategory = category === 'all' || issue.category === category;
  const matchesTable = table === 'all' || issue.tableName === table;
  const matchesText =
    !trimmed ||
    issue.ruleTitle.toLowerCase().includes(trimmed) ||
    issue.description.toLowerCase().includes(trimmed) ||
    issue.tableName.toLowerCase().includes(trimmed);

  return matchesSeverity && matchesCategory && matchesTable && matchesText;
}

/**
 * @brief Properties accepted by the SchemaHealthModal dialog component.
 */
export interface SchemaHealthModalProps {
  /** Controls modal visibility */
  readonly isOpen: boolean;
  /** Callback triggered to close the modal */
  readonly onClose: () => void;
  /** Introspected database schema to evaluate */
  readonly schema: DatabaseSchema;
  /** Target database engine dialect for migration statements (default: Postgres) */
  readonly dbType?: DatabaseType;
  /** Callback to execute a single quick fix SQL query directly */
  readonly onExecuteFix?: (sql: string) => Promise<void> | void;
  /** Callback to load bundled quick-fix script into a query worksheet */
  readonly onOpenInWorksheet?: (sql: string) => void;
}

/**
 * @brief Interactive Schema Health Advisor modal dialog.
 * @param props Component properties and execution triggers.
 * @return Rendered modal element or null when closed.
 */
export const SchemaHealthModal: React.FC<SchemaHealthModalProps> = ({
  isOpen,
  onClose,
  schema,
  dbType = 'Postgres',
  onExecuteFix,
  onOpenInWorksheet,
}) => {
  const [selectedSeverity, setSelectedSeverity] = useState<HealthSeverity | 'all'>('all');
  const [selectedCategory, setSelectedCategory] = useState<HealthRuleCategory | 'all'>('all');
  const [selectedTable, setSelectedTable] = useState<string>('all');
  const [searchFilter, setSearchFilter] = useState<string>('');
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [copiedBundle, setCopiedBundle] = useState<boolean>(false);
  const [executingId, setExecutingId] = useState<string | null>(null);

  const modalTitleId = useId();

  // Run schema diagnostics
  const report = useMemo(() => {
    return analyzeSchemaHealth(schema, dbType);
  }, [schema, dbType]);

  /**
   * @brief Handles window keydown events to dismiss modal on Escape key.
   * @param e Window keyboard event.
   */
  const handleWindowKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen) {
        onClose();
      }
    },
    [isOpen, onClose]
  );

  useEffect(() => {
    if (!isOpen) return;
    window.addEventListener('keydown', handleWindowKeyDown);
    return () => window.removeEventListener('keydown', handleWindowKeyDown);
  }, [isOpen, handleWindowKeyDown]);

  // Filter issues based on active filters
  const filteredIssues = useMemo(() => {
    const trimmed = searchFilter.trim().toLowerCase();
    return report.issues.filter((issue) =>
      matchesIssueFilter(issue, selectedSeverity, selectedCategory, selectedTable, trimmed)
    );
  }, [report.issues, selectedSeverity, selectedCategory, selectedTable, searchFilter]);

  /**
   * @brief Copies an individual quick-fix SQL statement to clipboard.
   * @param id Issue identifier.
   * @param sql Fix SQL statement text.
   */
  const handleCopyFix = useCallback(async (id: string, sql: string) => {
    try {
      await navigator.clipboard.writeText(sql);
      setCopiedId(id);
      setTimeout(() => setCopiedId(null), 2000);
    } catch (err: unknown) {
      console.error('Failed to copy fix SQL:', err);
    }
  }, []);

  /**
   * @brief Copies the bundled auto-remediation migration script to clipboard.
   */
  const handleCopyBundle = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(report.bundledQuickFixSql);
      setCopiedBundle(true);
      setTimeout(() => setCopiedBundle(false), 2000);
    } catch (err: unknown) {
      console.error('Failed to copy bundled SQL:', err);
    }
  }, [report.bundledQuickFixSql]);

  /**
   * @brief Executes a single quick fix SQL statement directly.
   * @param issue Target issue.
   */
  const handleExecuteSingle = async (issue: HealthIssue) => {
    if (!issue.quickFixSql || !onExecuteFix) return;
    setExecutingId(issue.id);
    try {
      await onExecuteFix(issue.quickFixSql);
    } finally {
      setExecutingId(null);
    }
  };

  if (!isOpen) return null;

  // Grade color scheme
  const scoreColor =
    report.score >= 90
      ? 'text-[#20c997] border-[#20c997]/40 bg-[#20c997]/10'
      : report.score >= 75
      ? 'text-[#3a82f7] border-[#3a82f7]/40 bg-[#3a82f7]/10'
      : report.score >= 50
      ? 'text-amber-400 border-amber-400/40 bg-amber-400/10'
      : 'text-red-400 border-red-500/40 bg-red-500/10';

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby={modalTitleId}
      className={
        'fixed inset-0 z-50 flex items-center justify-center p-4 ' +
        'bg-black/60 backdrop-blur-sm animate-in fade-in duration-150'
      }
    >
      <div
        className={
          'bg-[#1e1f22] border border-[#35373c] rounded-xl shadow-2xl ' +
          'w-full max-w-4xl max-h-[90vh] flex flex-col overflow-hidden text-[#e6e8ea]'
        }
      >
        {/* Header with Title and Close Button */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-[#35373c]">
          <div className="flex items-center space-x-3">
            <div className={`w-3.5 h-3.5 rounded-full border ${scoreColor}`} />
            <div>
              <h3 id={modalTitleId} className="text-base font-semibold text-[#e6e8ea]">
                Database Schema Health Advisor & Linter
              </h3>
              <p className="text-xs text-[#8c919a]">
                Automated schema design linter evaluating primary keys, foreign key indexing, and performance.
              </p>
            </div>
          </div>

          <button
            type="button"
            data-testid="health-modal-close-btn"
            onClick={onClose}
            aria-label="Close schema health advisor dialog"
            className={
              'text-[#8c919a] hover:text-[#e6e8ea] hover:bg-[#35373c] ' +
              'p-1.5 rounded-lg transition-colors cursor-pointer'
            }
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Health Score & Metrics Summary Banner */}
        <HealthSummaryBanner
          report={report}
          scoreColor={scoreColor}
          copiedBundle={copiedBundle}
          onCopyBundle={handleCopyBundle}
          onOpenInWorksheet={onOpenInWorksheet}
          onClose={onClose}
        />

        {/* Filter Toolbar */}
        <HealthFilterToolbar
          totalIssuesCount={report.issues.length}
          criticalCount={report.criticalCount}
          warningCount={report.warningCount}
          infoCount={report.infoCount}
          selectedSeverity={selectedSeverity}
          onSelectSeverity={setSelectedSeverity}
          searchFilter={searchFilter}
          onSearchChange={setSearchFilter}
          selectedCategory={selectedCategory}
          onSelectCategory={setSelectedCategory}
          selectedTable={selectedTable}
          onSelectTable={setSelectedTable}
          tables={schema.tables}
        />

        {/* Issue Cards Body */}
        <div className="flex-1 overflow-y-auto p-6 space-y-3">
          {filteredIssues.length === 0 ? (
            <div className="p-12 text-center text-[#8c919a] bg-[#18191c] rounded-xl border border-[#35373c] space-y-2">
              <CheckCircle2 className="w-8 h-8 text-[#20c997] mx-auto opacity-80" />
              <p className="text-sm font-semibold text-[#e6e8ea]">Zero issues found matching criteria!</p>
              <p className="text-xs">Your database schema conforms to industry best practices.</p>
            </div>
          ) : (
            filteredIssues.map((issue) => (
              <HealthIssueCard
                key={issue.id}
                issue={issue}
                onCopyFix={handleCopyFix}
                isCopied={copiedId === issue.id}
                onExecuteFix={onExecuteFix ? handleExecuteSingle : undefined}
                isExecuting={executingId === issue.id}
              />
            ))
          )}
        </div>

        {/* Modal Footer */}
        <div
          className={
            'px-6 py-3 border-t border-[#35373c] bg-[#18191c] ' +
            'flex items-center justify-between text-xs text-[#8c919a]'
          }
        >
          <span>
            Found {filteredIssues.length} matching {filteredIssues.length === 1 ? 'issue' : 'issues'}
          </span>
          <button
            type="button"
            onClick={onClose}
            className={
              'px-4 py-1.5 bg-[#2b2d30] hover:bg-[#35373c] text-[#e6e8ea] ' +
              'text-xs font-medium rounded transition-colors cursor-pointer'
            }
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
};
