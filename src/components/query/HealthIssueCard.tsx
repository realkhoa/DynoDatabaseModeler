/**
 * @file HealthIssueCard.tsx
 * @brief Individual diagnostic issue card for Schema Health Advisor.
 */

import React from 'react';
import { Check, Copy, Play, RefreshCw, Sparkles } from 'lucide-react';
import type { HealthIssue } from '../../types/schemaHealth';

/**
 * @brief Properties for rendering an individual health issue card.
 */
export interface HealthIssueCardProps {
  /** Health finding data model */
  readonly issue: HealthIssue;
  /** Callback to copy SQL quick fix to clipboard */
  readonly onCopyFix: (id: string, sql: string) => void;
  /** Whether the quick fix was copied recently */
  readonly isCopied: boolean;
  /** Optional execution trigger to apply fix directly */
  readonly onExecuteFix?: (issue: HealthIssue) => void;
  /** Whether this issue is currently executing */
  readonly isExecuting: boolean;
}

/**
 * @brief Renders a single schema health finding card with severity badge, impact, and quick fix.
 * @param props Card properties and handlers.
 * @return Rendered issue card element.
 */
export const HealthIssueCard: React.FC<HealthIssueCardProps> = ({
  issue,
  onCopyFix,
  isCopied,
  onExecuteFix,
  isExecuting,
}) => {
  const isCrit = issue.severity === 'critical';
  const isWarn = issue.severity === 'warning';

  const cardBorder = isCrit
    ? 'border-red-500/40 bg-red-950/10'
    : isWarn
    ? 'border-amber-500/30 bg-amber-950/10'
    : 'border-[#35373c] bg-[#18191c]';

  const badgeColor = isCrit
    ? 'bg-red-500/20 text-red-300 border-red-500/30'
    : isWarn
    ? 'bg-amber-500/20 text-amber-300 border-amber-500/30'
    : 'bg-[#3a82f7]/20 text-[#3a82f7] border-[#3a82f7]/30';

  return (
    <div
      data-testid={`health-issue-card-${issue.id}`}
      className={`border rounded-lg p-4 space-y-2.5 transition-all ${cardBorder}`}
    >
      <div className="flex items-start justify-between">
        <div className="flex items-center space-x-2">
          <span
            className={`text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded border ${badgeColor}`}
          >
            {issue.severity}
          </span>
          <span className="text-xs font-mono px-2 py-0.5 rounded bg-[#2b2d30] text-[#c4c7cc]">
            {issue.tableName}
            {issue.columnName ? `.${issue.columnName}` : ''}
          </span>
          <h4 className="text-xs font-bold text-[#e6e8ea]">{issue.ruleTitle}</h4>
        </div>

        <span className="text-[10px] font-mono uppercase text-[#8c919a]">
          Category: {issue.category}
        </span>
      </div>

      <p className="text-xs text-[#c4c7cc] leading-relaxed">{issue.description}</p>

      <div className="p-2.5 bg-[#141517] rounded border border-[#2d2f34] text-[11px] text-[#8c919a]">
        <strong className="text-amber-300 font-semibold">Impact: </strong>
        {issue.impact}
      </div>

      {issue.quickFixSql && (
        <div className="flex items-center justify-between pt-1">
          <div className="flex items-center space-x-2">
            <Sparkles className="w-3.5 h-3.5 text-amber-400" />
            <span className="text-[11px] font-semibold text-[#e6e8ea]">Quick Fix Available:</span>
          </div>
          <div className="flex items-center space-x-2">
            <button
              type="button"
              data-testid={`copy-fix-${issue.id}`}
              onClick={() => onCopyFix(issue.id, issue.quickFixSql!)}
              className={
                'inline-flex items-center gap-1 px-2.5 py-1 rounded bg-[#2b2d30] ' +
                'hover:bg-[#35373c] text-[11px] text-[#e6e8ea] transition-colors cursor-pointer'
              }
            >
              {isCopied ? (
                <Check className="w-3 h-3 text-[#20c997]" />
              ) : (
                <Copy className="w-3 h-3" />
              )}
              <span>{isCopied ? 'Copied' : 'Copy Fix'}</span>
            </button>

            {onExecuteFix && (
              <button
                type="button"
                data-testid={`run-fix-${issue.id}`}
                onClick={() => onExecuteFix(issue)}
                disabled={isExecuting}
                className={
                  'inline-flex items-center gap-1 px-2.5 py-1 rounded bg-[#20c997] ' +
                  'hover:bg-[#1bb587] disabled:opacity-50 text-[11px] font-semibold text-white ' +
                  'transition-colors cursor-pointer shadow-sm'
                }
              >
                {isExecuting ? (
                  <RefreshCw className="w-3 h-3 animate-spin" />
                ) : (
                  <Play className="w-3 h-3" />
                )}
                <span>Apply Fix</span>
              </button>
            )}
          </div>
        </div>
      )}

      {issue.quickFixSql && (
        <pre
          className={
            'p-2.5 bg-[#0f1012] border border-[#26282d] rounded font-mono text-[11px] ' +
            'text-[#20c997] overflow-x-auto select-all'
          }
        >
          {issue.quickFixSql}
        </pre>
      )}
    </div>
  );
};
