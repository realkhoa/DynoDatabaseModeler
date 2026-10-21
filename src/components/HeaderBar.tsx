/**
 * @file HeaderBar.tsx
 * @brief Modern dark-styled top header navigation and status bar component.
 * @details Houses workspace navigation tabs (ERD Canvas, SQL Query, Settings),
 * active connection status badge, and disconnect / connection triggers.
 */

import React from 'react';
import {
  GitGraph,
  Code,
  Settings,
  Unplug,
  Plus,
  GitCompare,
  Activity,
} from 'lucide-react';
import type { ConnectionConfig } from '../types/database';

/**
 * @brief Tab identifier types available in DynoDbModeler workspace.
 */
export type WorkspaceTab = 'erd' | 'sql' | 'query' | 'settings';

/**
 * @brief Properties accepted by the HeaderBar component.
 */
export interface HeaderBarProps {
  /** @brief Currently selected active navigation tab. */
  activeTab: WorkspaceTab;
  /** @brief Callback triggered when user clicks a navigation tab. */
  onSelectTab: (tab: WorkspaceTab) => void;
  /** @brief Currently active database connection configuration or null if disconnected. */
  activeConnection: ConnectionConfig | null;
  /** @brief Callback triggered when user requests disconnecting the active session. */
  onDisconnect?: () => void;
  /** @brief Callback triggered to open the new connection modal dialog. */
  onOpenNewConnection: () => void;
  /** @brief Optional callback triggered to review schema diff and sync migrations. */
  onOpenDiff?: () => void;
  /** @brief Number of detected pending structural schema changes between live and desired schemas. */
  pendingChangesCount?: number;
  /** @brief Optional callback triggered to open the active database processes and query monitor. */
  onOpenProcesses?: () => void;
}

/**
 * @brief Modern dark-themed header bar displaying application tabs and connection telemetry.
 * @param props Component properties configuring active tabs and connection state.
 * @return Rendered HeaderBar element.
 */
export const HeaderBar: React.FC<HeaderBarProps> = React.memo(({
  activeTab,
  onSelectTab,
  activeConnection,
  onDisconnect,
  onOpenNewConnection,
  onOpenDiff,
  pendingChangesCount = 0,
  onOpenProcesses,
}) => {
  return (
    <header className="h-11 bg-[#18191c] border-b border-[#35373c] flex items-center justify-between px-3 select-none shrink-0 text-xs">
      {/* Brand & Logo */}
      <div className="flex items-center space-x-2 mr-4">
        <img
          src="/icon.png"
          alt="DynoDbModeler Logo"
          className="w-6 h-6 rounded-md shadow-xs object-contain"
        />
        <span className="font-semibold text-sm text-[#e6e8ea] tracking-tight">
          DynoDbModeler
        </span>
      </div>

      {/* Navigation Tabs */}
      <nav aria-label="Main Navigation" className="flex items-center space-x-1">
        <button
          type="button"
          onClick={() => onSelectTab('erd')}
          className={`flex items-center space-x-1.5 px-3 py-1.5 rounded transition-colors ${
            activeTab === 'erd'
              ? 'bg-[#2b2d30] text-[#ffffff] font-medium shadow-xs border-b-2 border-[#3a82f7]'
              : 'text-[#8c919a] hover:text-[#e6e8ea] hover:bg-[#222428]'
          }`}
        >
          <GitGraph className="w-3.5 h-3.5" />
          <span>ERD Canvas</span>
        </button>

        <button
          type="button"
          onClick={() => onSelectTab('sql')}
          className={`flex items-center space-x-1.5 px-3 py-1.5 rounded transition-colors ${
            activeTab === 'sql' || activeTab === 'query'
              ? 'bg-[#2b2d30] text-[#ffffff] font-medium shadow-xs border-b-2 border-[#3a82f7]'
              : 'text-[#8c919a] hover:text-[#e6e8ea] hover:bg-[#222428]'
          }`}
        >
          <Code className="w-3.5 h-3.5" />
          <span>SQL Query</span>
        </button>

        <button
          type="button"
          onClick={() => onSelectTab('settings')}
          className={`flex items-center space-x-1.5 px-3 py-1.5 rounded transition-colors ${
            activeTab === 'settings'
              ? 'bg-[#2b2d30] text-[#ffffff] font-medium shadow-xs border-b-2 border-[#3a82f7]'
              : 'text-[#8c919a] hover:text-[#e6e8ea] hover:bg-[#222428]'
          }`}
        >
          <Settings className="w-3.5 h-3.5" />
          <span>Settings</span>
        </button>
      </nav>

      {/* Connection Status & Actions */}
      <div className="flex items-center space-x-2 ml-auto">
        {activeConnection ? (
          <div className="flex items-center space-x-2">
            {onOpenDiff && (
              <button
                type="button"
                onClick={onOpenDiff}
                className="flex items-center space-x-1.5 px-2.5 py-1 bg-[#24262b] hover:bg-[#2f3238] border border-[#35373c] text-[#e6e8ea] rounded font-medium shadow-xs transition-colors cursor-pointer"
                title="Review schema differences and synchronize migrations"
              >
                <GitCompare className="w-3.5 h-3.5 text-[#3a82f7]" />
                <span>Review &amp; Sync</span>
                {pendingChangesCount > 0 && (
                  <span
                    data-testid="pending-changes-badge"
                    className="ml-1 px-1.5 py-0.2 rounded-full bg-[#3a82f7] text-white text-[10px] font-bold"
                  >
                    {pendingChangesCount}
                  </span>
                )}
              </button>
            )}

            {onOpenProcesses && (
              <button
                type="button"
                data-testid="header-processes-btn"
                onClick={onOpenProcesses}
                className="flex items-center space-x-1.5 px-2.5 py-1 bg-[#24262b] hover:bg-[#2f3238] border border-[#35373c] text-[#e6e8ea] rounded font-medium shadow-xs transition-colors cursor-pointer"
                title="Active database processes & query monitor"
              >
                <Activity className="w-3.5 h-3.5 text-amber-400" />
                <span>Processes</span>
              </button>
            )}

            <div className="flex items-center space-x-2 bg-[#1e1f22] border border-[#35373c] px-2.5 py-1 rounded">
              <span
                className="w-2 h-2 rounded-full bg-[#20c997] animate-pulse"
                title="Connected"
              />
              <span className="font-medium text-[#e6e8ea] truncate max-w-[140px]">
                {activeConnection.name}
              </span>
              <span className="text-[10px] uppercase font-mono px-1 rounded bg-[#2b2d30] text-[#8c919a]">
                {activeConnection.db_type}
              </span>
              {onDisconnect && (
                <button
                  type="button"
                  onClick={onDisconnect}
                  title="Disconnect from database"
                  aria-label="Disconnect database"
                  className="p-1 hover:bg-[#35373c] text-[#8c919a] hover:text-red-400 rounded transition-colors ml-1"
                >
                  <Unplug className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
          </div>
        ) : (
          <div className="flex items-center space-x-2">
            <div className="flex items-center space-x-1.5 text-[#8c919a] px-2 py-1">
              <span className="w-2 h-2 rounded-full bg-[#8c919a]" />
              <span>Disconnected</span>
            </div>
            <button
              type="button"
              onClick={onOpenNewConnection}
              className="flex items-center space-x-1 px-2.5 py-1 bg-[#3a82f7] hover:bg-[#2f6fd6] text-white rounded font-medium shadow-xs transition-colors"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>Connect</span>
            </button>
          </div>
        )}
      </div>
    </header>
  );
});
HeaderBar.displayName = 'HeaderBar';
