/**
 * @file HealthFilterToolbar.tsx
 * @brief Filter toolbar for Schema Health Advisor issues list.
 */

import React from 'react';
import { Search } from 'lucide-react';
import type { HealthRuleCategory, HealthSeverity } from '../../types/schemaHealth';

/**
 * @brief Properties accepted by HealthFilterToolbar.
 */
export interface HealthFilterToolbarProps {
  /** Total count of all findings */
  readonly totalIssuesCount: number;
  /** Count of critical findings */
  readonly criticalCount: number;
  /** Count of warning findings */
  readonly warningCount: number;
  /** Count of suggestion findings */
  readonly infoCount: number;
  /** Active severity filter */
  readonly selectedSeverity: HealthSeverity | 'all';
  /** Callback when severity tab changes */
  readonly onSelectSeverity: (s: HealthSeverity | 'all') => void;
  /** Current text search filter */
  readonly searchFilter: string;
  /** Callback when search text changes */
  readonly onSearchChange: (q: string) => void;
  /** Active category filter */
  readonly selectedCategory: HealthRuleCategory | 'all';
  /** Callback when category filter changes */
  readonly onSelectCategory: (c: HealthRuleCategory | 'all') => void;
  /** Active table filter */
  readonly selectedTable: string;
  /** Callback when table filter changes */
  readonly onSelectTable: (t: string) => void;
  /** Available schema tables for dropdown options */
  readonly tables: Array<{ name: string }>;
}

/**
 * @brief Renders severity tabs, search input, category dropdown, and table dropdown filters.
 * @param props Component properties and callbacks.
 * @return Rendered toolbar element.
 */
export const HealthFilterToolbar: React.FC<HealthFilterToolbarProps> = ({
  totalIssuesCount,
  criticalCount,
  warningCount,
  infoCount,
  selectedSeverity,
  onSelectSeverity,
  searchFilter,
  onSearchChange,
  selectedCategory,
  onSelectCategory,
  selectedTable,
  onSelectTable,
  tables,
}) => {
  const tabs = [
    { id: 'all' as const, label: `All (${totalIssuesCount})` },
    { id: 'critical' as const, label: `Critical (${criticalCount})` },
    { id: 'warning' as const, label: `Warnings (${warningCount})` },
    { id: 'info' as const, label: `Info (${infoCount})` },
  ];

  return (
    <div
      className={
        'px-6 py-2.5 bg-[#24262b] border-b border-[#35373c] ' +
        'flex items-center justify-between gap-3 text-xs'
      }
    >
      <div className="flex items-center space-x-1.5">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            type="button"
            data-testid={`health-filter-${tab.id}`}
            onClick={() => onSelectSeverity(tab.id)}
            className={`px-2.5 py-1 rounded transition-colors font-medium cursor-pointer ${
              selectedSeverity === tab.id
                ? 'bg-[#3a82f7] text-white shadow-sm'
                : 'text-[#8c919a] hover:bg-[#2b2d30] hover:text-[#e6e8ea]'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      <div className="flex items-center space-x-2">
        <div className="relative flex items-center">
          <Search className="w-3 h-3 text-[#8c919a] absolute left-2 pointer-events-none" />
          <input
            type="text"
            placeholder="Search issues..."
            value={searchFilter}
            onChange={(e) => onSearchChange(e.target.value)}
            className={
              'bg-[#18191c] border border-[#35373c] text-xs text-[#e6e8ea] placeholder-[#8c919a] ' +
              'rounded pl-6 pr-2.5 py-1 w-36 focus:w-48 focus:outline-none focus:border-[#3a82f7] transition-all'
            }
          />
        </div>

        <select
          value={selectedCategory}
          onChange={(e) => onSelectCategory(e.target.value as HealthRuleCategory | 'all')}
          className={
            'bg-[#18191c] border border-[#35373c] text-xs text-[#e6e8ea] ' +
            'rounded px-2.5 py-1 focus:outline-none focus:border-[#3a82f7]'
          }
        >
          <option value="all">All Categories</option>
          <option value="integrity">Integrity</option>
          <option value="performance">Performance</option>
          <option value="naming">Naming</option>
          <option value="storage">Storage</option>
          <option value="security">Security</option>
        </select>

        <select
          value={selectedTable}
          onChange={(e) => onSelectTable(e.target.value)}
          className={
            'bg-[#18191c] border border-[#35373c] text-xs text-[#e6e8ea] ' +
            'rounded px-2.5 py-1 focus:outline-none focus:border-[#3a82f7]'
          }
        >
          <option value="all">All Tables</option>
          {tables.map((t) => (
            <option key={t.name} value={t.name}>
              {t.name}
            </option>
          ))}
        </select>
      </div>
    </div>
  );
};
