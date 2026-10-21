/**
 * @file DiffModal.tsx
 * @brief Modern dark-themed modal dialog for inspecting schema differences and executing safe DDL migrations.
 * @details Displays a structured hierarchical tree of detected modifications (renames, added/dropped
 * tables, columns, altered attributes, foreign keys), destructive warning telemetry, changes the
 * backend refused to generate, and an embedded Monaco SQL editor for reviewing, fine-tuning, copying,
 * or applying migration statements inside a transaction.
 */

import React, { useState, useEffect, useCallback } from 'react';
import Editor from '@monaco-editor/react';
import {
  AlertTriangle,
  Check,
  Copy,
  X,
  Loader2,
  ShieldAlert,
  FileCode,
  Info,
} from 'lucide-react';
import type { SchemaDiff } from '../../types/database';
import { splitSqlStatements } from '../../utils/sqlSafety';

/**
 * @brief Component properties accepted by DiffModal.
 */
export interface DiffModalProps {
  /** @brief Controls whether the modal dialog is visibly rendered. */
  isOpen: boolean;
  /** @brief Calculated structural schema difference between live and desired schemas. */
  diff: SchemaDiff | null;
  /** @brief Collection of generated dialect-accurate SQL DDL migration statements. */
  generatedDdl: string[];
  /** @brief Changes the backend could not express, with the reason for each. */
  warnings?: string[];
  /** @brief Callback triggered when the modal is closed or cancelled. */
  onClose: () => void;
  /** @brief Callback triggered to execute migration SQL statements. */
  onExecute: (statements: string[]) => Promise<void>;
}

/**
 * @brief Modal dialog presenting visual schema diffs and Monaco editor for DDL execution.
 * @param props Component configuration, diff data, DDL statements, and execution callbacks.
 * @return Rendered modal overlay or null when closed.
 */
export const DiffModal: React.FC<DiffModalProps> = React.memo(({

  isOpen,
  diff,
  generatedDdl,
  warnings = [],
  onClose,
  onExecute,
}) => {
  const [userEditedSql, setUserEditedSql] = useState<string | null>(null);
  const [isExecuting, setIsExecuting] = useState(false);
  const [copied, setCopied] = useState(false);
  const [destructiveAcknowledged, setDestructiveAcknowledged] = useState(false);
  const [executionError, setExecutionError] = useState<string | null>(null);

  // Synchronously compute SQL buffer, favoring user manual edits over generated DDL
  const customSql = userEditedSql ?? generatedDdl.join('\n\n');
  const isEdited = userEditedSql !== null;

  // Reset user manual edits and the destructive acknowledgement when the modal is closed or new
  // generated DDL is passed, so a previous confirmation can never carry over silently.
  useEffect(() => {
    if (!isOpen) {
      setUserEditedSql(null);
      setDestructiveAcknowledged(false);
      setExecutionError(null);
    }
  }, [isOpen, generatedDdl]);

  /**
   * @brief Copies the current Monaco editor SQL buffer to clipboard with animated visual feedback.
   */
  const handleCopy = useCallback(async () => {
    try {
      if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(customSql);
      }
    } catch {
      // Ignore clipboard write failures in non-secure or headless contexts
    }
    setCopied(true);
    setTimeout(() => {
      setCopied(false);
    }, 2000);
  }, [customSql]);

  /**
   * @brief Splits the SQL buffer into individual statements and executes them via callback.
   * @details Unedited DDL is passed through verbatim, exactly as the dialect generator produced it.
   * Edited scripts go through a quote-aware splitter so semicolons inside literals, comments or
   * function bodies do not corrupt the script.
   */
  const handleRun = useCallback(async () => {
    setExecutionError(null);
    setIsExecuting(true);
    try {
      const statements = isEdited ? splitSqlStatements(customSql) : generatedDdl;

      if (statements.length === 0) {
        setExecutionError('There are no statements to execute.');
        return;
      }

      await onExecute(statements);
      onClose();
    } catch (err: unknown) {
      // Surface the failure inside the modal instead of leaking an unhandled rejection.
      const message = err instanceof Error ? err.message : String(err);
      setExecutionError(message || 'Migration execution failed.');
    } finally {
      setIsExecuting(false);
    }
  }, [customSql, generatedDdl, isEdited, onExecute, onClose]);

  if (!isOpen || !diff) {
    return null;
  }

  const hasDestructive = Boolean(
    diff.tables_to_drop.length > 0 ||
      diff.columns_to_drop.length > 0 ||
      diff.columns_to_alter.some((a) => a.is_destructive)
  );

  const hasNoChanges =
    diff.tables_to_create.length === 0 &&
    diff.tables_to_drop.length === 0 &&
    diff.tables_to_rename.length === 0 &&
    diff.columns_to_add.length === 0 &&
    diff.columns_to_drop.length === 0 &&
    diff.columns_to_alter.length === 0 &&
    diff.foreign_keys_to_add.length === 0 &&
    diff.foreign_keys_to_drop.length === 0;

  const executeBlocked = isExecuting || (hasDestructive && !destructiveAcknowledged);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="diff-modal-title"
      className="fixed inset-0 bg-black/60 backdrop-blur-xs flex items-center justify-center z-50 p-6 select-none"
    >
      <div className="bg-[#24262b] border border-[#35373c] rounded-lg shadow-2xl w-[940px] max-h-[85vh] flex flex-col overflow-hidden text-xs text-[#e6e8ea]">
        {/* Modal Header */}
        <div className="px-4 py-3 bg-[#1e1f22] border-b border-[#35373c] flex items-center justify-between shrink-0">
          <div className="font-semibold text-sm flex items-center space-x-2">
            <span id="diff-modal-title">Review Schema Migration</span>
            {hasDestructive && (
              <span className="flex items-center space-x-1 text-[#e05252] bg-[#e05252]/10 border border-[#e05252]/30 px-2 py-0.5 rounded text-[11px]">
                <AlertTriangle className="w-3.5 h-3.5" />
                <span>Destructive Changes Detected</span>
              </span>
            )}
            {warnings.length > 0 && (
              <span
                data-testid="diff-warning-badge"
                className="flex items-center space-x-1 text-amber-300 bg-amber-500/10 border border-amber-500/30 px-2 py-0.5 rounded text-[11px]"
              >
                <Info className="w-3.5 h-3.5" />
                <span>{warnings.length} change(s) not generated</span>
              </span>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={isExecuting}
            aria-label="Close migration modal"
            className="p-1 hover:bg-[#35373c] rounded text-[#8c919a] hover:text-[#e6e8ea] transition-colors disabled:opacity-50"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Destructive Warning Alert Banner */}
        {hasDestructive && (
          <div className="bg-[#e05252]/10 border-b border-[#e05252]/30 px-4 py-2 text-[#e05252] flex items-center space-x-2 text-[11px] shrink-0">
            <ShieldAlert className="w-4 h-4 shrink-0 text-[#e05252]" />
            <span>
              <strong>Caution:</strong> Dropping tables/columns or narrowing types permanently
              destroys data. Verify the generated SQL before executing.
            </span>
          </div>
        )}

        {/* Changes the dialect could not generate */}
        {warnings.length > 0 && (
          <div
            data-testid="diff-warning-panel"
            className="bg-amber-500/10 border-b border-amber-500/30 px-4 py-2 text-amber-200 text-[11px] shrink-0 max-h-32 overflow-y-auto"
          >
            <div className="font-semibold mb-1">
              Not generated automatically — these changes need manual SQL:
            </div>
            <ul className="list-disc pl-4 space-y-0.5">
              {warnings.map((warning, index) => (
                <li key={index}>{warning}</li>
              ))}
            </ul>
          </div>
        )}

        {/* Execution failure surfaced in place */}
        {executionError && (
          <div
            data-testid="diff-execution-error"
            className="bg-red-500/10 border-b border-red-500/30 px-4 py-2 text-red-300 text-[11px] shrink-0"
          >
            <strong>Migration failed:</strong> {executionError}
          </div>
        )}

        {/* Modal Body */}
        <div className="flex-1 flex overflow-hidden min-h-[340px]">
          {/* Left: Changes Tree */}
          <div className="w-80 border-r border-[#35373c] p-3 overflow-y-auto space-y-3 bg-[#18191c] shrink-0">
            <div className="font-semibold text-[#8c919a] uppercase text-[10px] tracking-wider">
              Detected Changes
            </div>

            {hasNoChanges && (
              <div className="text-[#8c919a] italic text-[11px] py-4 text-center">
                No structural changes detected.
              </div>
            )}

            {/* Tables to Rename */}
            {diff.tables_to_rename.map((rename) => (
              <div
                key={`rename-${rename.from}-${rename.to}`}
                className="text-[#3a82f7] flex items-center space-x-1.5 font-mono text-[11px]"
              >
                <span className="font-bold">→</span>
                <span>
                  Rename: <strong>{rename.from}</strong> → <strong>{rename.to}</strong>
                </span>
              </div>
            ))}

            {/* Tables to Create */}
            {diff.tables_to_create.map((t) => (
              <div
                key={`create-tbl-${t.name}`}
                className="text-[#20c997] flex items-center space-x-1.5 font-mono text-[11px]"
              >
                <span className="font-bold">+</span>
                <span>
                  Create Table: <strong>{t.name}</strong>
                </span>
              </div>
            ))}

            {/* Tables to Drop */}
            {diff.tables_to_drop.map((t) => (
              <div
                key={`drop-tbl-${t}`}
                className="text-[#e05252] font-semibold flex items-center space-x-1.5 font-mono text-[11px]"
              >
                <span className="font-bold">-</span>
                <span>
                  Drop Table: <strong>{t}</strong>
                </span>
              </div>
            ))}

            {/* Columns to Add */}
            {diff.columns_to_add.map(([tbl, col]) => (
              <div
                key={`add-col-${tbl}-${col.name}`}
                className="text-[#3a82f7] flex items-center space-x-1.5 font-mono text-[11px]"
              >
                <span className="font-bold">+</span>
                <span>
                  {tbl}.<strong>{col.name}</strong>
                </span>
              </div>
            ))}

            {/* Columns to Drop */}
            {diff.columns_to_drop.map(([tbl, col]) => (
              <div
                key={`drop-col-${tbl}-${col}`}
                className="text-[#e05252] flex items-center space-x-1.5 font-mono text-[11px]"
              >
                <span className="font-bold">-</span>
                <span>
                  {tbl}.<strong>{col}</strong>
                </span>
              </div>
            ))}

            {/* Columns to Alter */}
            {diff.columns_to_alter.map((alt) => (
              <div
                key={`alter-col-${alt.table_name}-${alt.target_column.name}`}
                className={`flex items-center space-x-1.5 font-mono text-[11px] ${
                  alt.is_destructive ? 'text-[#e05252]' : 'text-[#f59e0b]'
                }`}
              >
                <span className="font-bold">~</span>
                <span>
                  {alt.table_name}.<strong>{alt.target_column.name}</strong>
                  {alt.is_destructive ? ' (Destructive)' : ''}
                </span>
              </div>
            ))}

            {/* Foreign Keys to Add */}
            {diff.foreign_keys_to_add.map(([tbl, fk]) => (
              <div
                key={`add-fk-${tbl}-${fk.constraint_name || fk.source_column}`}
                className="text-[#20c997] flex items-center space-x-1.5 font-mono text-[11px]"
              >
                <span className="font-bold">+</span>
                <span>
                  FK: {tbl}.<strong>{fk.source_column}</strong> &rarr; {fk.target_table}.
                  {fk.target_column}
                </span>
              </div>
            ))}

            {/* Foreign Keys to Drop */}
            {diff.foreign_keys_to_drop.map(([tbl, fkName]) => (
              <div
                key={`drop-fk-${tbl}-${fkName}`}
                className="text-[#e05252] flex items-center space-x-1.5 font-mono text-[11px]"
              >
                <span className="font-bold">-</span>
                <span>
                  Drop FK: {tbl}.<strong>{fkName}</strong>
                </span>
              </div>
            ))}

            {/* Tables requiring a rebuild */}
            {diff.tables_to_rebuild.map((rebuild) => (
              <div
                key={`rebuild-${rebuild.table_name}`}
                className="text-[#8c919a] flex items-center space-x-1.5 font-mono text-[11px]"
              >
                <span className="font-bold">⟳</span>
                <span>
                  Rebuild: <strong>{rebuild.table_name}</strong>
                </span>
              </div>
            ))}
          </div>

          {/* Right: Monaco Editor DDL Preview */}
          <div className="flex-1 flex flex-col bg-[#1e1f22] overflow-hidden">
            <div className="px-3 py-1.5 bg-[#26282d] border-b border-[#35373c] flex items-center justify-between text-[#8c919a] shrink-0">
              <div className="flex items-center space-x-1.5 text-xs">
                <FileCode className="w-3.5 h-3.5 text-[#3a82f7]" />
                <span>Generated SQL Script (Editable)</span>
              </div>
              <button
                type="button"
                onClick={handleCopy}
                className="flex items-center space-x-1 hover:text-[#e6e8ea] transition-colors text-xs px-2 py-0.5 rounded hover:bg-[#35373c]"
              >
                {copied ? (
                  <Check className="w-3.5 h-3.5 text-[#20c997]" />
                ) : (
                  <Copy className="w-3.5 h-3.5" />
                )}
                <span>{copied ? 'Copied' : 'Copy'}</span>
              </button>
            </div>
            <div className="flex-1 w-full h-full min-h-[300px]">
              <Editor
                height="100%"
                defaultLanguage="sql"
                theme="vs-dark"
                value={customSql}
                onChange={(val) => setUserEditedSql(val ?? '')}
                options={{
                  minimap: { enabled: false },
                  fontSize: 12,
                  fontFamily: 'JetBrains Mono, monospace',
                  lineNumbers: 'on',
                  scrollBeyondLastLine: false,
                  automaticLayout: true,
                }}
              />
            </div>
          </div>
        </div>

        {/* Modal Footer */}
        <div className="px-4 py-3 bg-[#1e1f22] border-t border-[#35373c] flex items-center justify-between shrink-0 gap-4">
          {hasDestructive ? (
            <label
              data-testid="destructive-confirm"
              className="flex items-center gap-2 text-[11px] text-[#e05252] cursor-pointer select-none"
            >
              <input
                type="checkbox"
                checked={destructiveAcknowledged}
                onChange={(e) => setDestructiveAcknowledged(e.target.checked)}
                className="rounded bg-[#18191c] border-[#35373c] text-[#e05252] focus:ring-0"
              />
              <span>
                I understand this permanently deletes data and I have reviewed the SQL above.
              </span>
            </label>
          ) : (
            <div className="text-[#8c919a] text-[11px]">
              Execution runs inside a safe transaction block.
            </div>
          )}
          <div className="flex space-x-2 shrink-0">
            <button
              type="button"
              onClick={onClose}
              disabled={isExecuting}
              className="px-3 py-1.5 rounded bg-[#2b2d30] hover:bg-[#35373c] text-[#e6e8ea] transition-colors disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleRun}
              disabled={executeBlocked || !customSql.trim()}
              title={
                hasDestructive && !destructiveAcknowledged
                  ? 'Confirm the destructive change warning to enable execution'
                  : undefined
              }
              className="flex items-center space-x-1.5 px-4 py-1.5 rounded bg-[#3a82f7] hover:bg-[#2b6fd6] font-semibold text-white disabled:opacity-50 disabled:cursor-not-allowed transition-colors shadow-xs"
            >
              {isExecuting && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
              <span>{isExecuting ? 'Executing...' : 'Execute Migration'}</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
});
DiffModal.displayName = 'DiffModal';
