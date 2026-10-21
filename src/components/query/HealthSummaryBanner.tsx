/**
 * @file HealthSummaryBanner.tsx
 * @brief Summary telemetry banner for Schema Health Advisor displaying score and quick actions.
 */

import React from 'react';
import { Check, Copy, FileCode } from 'lucide-react';
import type { SchemaHealthReport } from '../../types/schemaHealth';

/**
 * @brief Properties accepted by HealthSummaryBanner.
 */
export interface HealthSummaryBannerProps {
  /** Complete schema health diagnostic report */
  readonly report: SchemaHealthReport;
  /** Tailwind CSS color classes for the health score circle */
  readonly scoreColor: string;
  /** Whether the bundled migration script was recently copied */
  readonly copiedBundle: boolean;
  /** Callback to copy bundled migration script to clipboard */
  readonly onCopyBundle: () => void;
  /** Optional callback to open bundled fixes in query worksheet */
  readonly onOpenInWorksheet?: (sql: string) => void;
  /** Callback to dismiss modal dialog */
  readonly onClose: () => void;
}

/**
 * @brief Renders the health score circle badge, severity breakdown, and bundled action buttons.
 * @param props Component properties and triggers.
 * @return Rendered banner element.
 */
export const HealthSummaryBanner: React.FC<HealthSummaryBannerProps> = ({
  report,
  scoreColor,
  copiedBundle,
  onCopyBundle,
  onOpenInWorksheet,
  onClose,
}) => {
  return (
    <div className="px-6 py-4 bg-[#141517] border-b border-[#35373c] flex items-center justify-between gap-4">
      <div className="flex items-center space-x-4">
        <div
          data-testid="health-score-badge"
          className={`w-14 h-14 rounded-full border-2 flex flex-col items-center justify-center ${scoreColor}`}
        >
          <span className="text-base font-extrabold leading-none">{report.score}</span>
          <span className="text-[9px] font-semibold tracking-wider uppercase opacity-80">Score</span>
        </div>

        <div>
          <div className="flex items-center space-x-2">
            <span className="text-sm font-bold text-[#e6e8ea]">{report.scoreGrade} Grade</span>
            <span className="text-xs text-[#8c919a]">({report.totalTables} tables scanned)</span>
          </div>
          <div className="flex items-center space-x-3 text-xs mt-1">
            <span className="text-red-400 font-medium">{report.criticalCount} Critical</span>
            <span className="text-[#8c919a]">•</span>
            <span className="text-amber-400 font-medium">{report.warningCount} Warnings</span>
            <span className="text-[#8c919a]">•</span>
            <span className="text-[#3a82f7] font-medium">{report.infoCount} Suggestions</span>
          </div>
        </div>
      </div>

      <div className="flex items-center space-x-2">
        <button
          type="button"
          data-testid="health-copy-bundle-btn"
          onClick={onCopyBundle}
          className={
            'inline-flex items-center gap-1.5 px-3 py-1.5 rounded bg-[#2b2d30] ' +
            'hover:bg-[#35373c] text-xs text-[#e6e8ea] font-medium transition-colors cursor-pointer'
          }
        >
          {copiedBundle ? <Check className="w-3.5 h-3.5 text-[#20c997]" /> : <Copy className="w-3.5 h-3.5" />}
          <span>{copiedBundle ? 'Copied All Fixes!' : 'Copy All Fixes'}</span>
        </button>

        {onOpenInWorksheet && (
          <button
            type="button"
            data-testid="health-bundle-worksheet-btn"
            onClick={() => {
              onOpenInWorksheet(report.bundledQuickFixSql);
              onClose();
            }}
            className={
              'inline-flex items-center gap-1.5 px-3 py-1.5 rounded bg-[#3a82f7] ' +
              'hover:bg-[#2f6fd6] text-xs font-semibold text-white shadow transition-colors cursor-pointer'
            }
          >
            <FileCode className="w-3.5 h-3.5" />
            <span>Open Fixes in Worksheet</span>
          </button>
        )}
      </div>
    </div>
  );
};
