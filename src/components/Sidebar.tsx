/**
 * @file Sidebar.tsx
 * @brief Modern left navigation sidebar component for DynoDbModeler with responsive tri-state modes.
 * @details Displays connection selector, active database status, schema refresh trigger,
 * connection creator trigger, table search filter, and list of database tables with column counts.
 * Supports expanded, rail, and zen layout modes with debounced filtering.
 */

import React, { useState, useMemo } from 'react';
import {
  Database,
  Plus,
  Table as TableIcon,
  RefreshCw,
  Search,
  X,
  ChevronDown,
  Layers,
  Eye,
  FileCode2,
  PanelLeftClose,
  PanelLeftOpen,
} from 'lucide-react';
import type { ConnectionConfig, TableSchema } from '../types/database';
import { tableKey } from '../types/database';
import { useDebouncedValue } from '../utils/useDebouncedValue';

/**
 * @brief Display mode for the sidebar navigation pane.
 * @details
 * - 'expanded': Standard 256px wide pane with full database switchers, search filter, and table tree.
 * - 'rail': Ultra-compact 48px micro-icon rail preserving quick actions and visual database status.
 * - 'zen': Hidden 0px width sidebar maximizing editor or canvas workspace.
 */
export type SidebarMode = 'expanded' | 'rail' | 'zen';

/**
 * @brief Properties accepted by the Sidebar component.
 */
export interface SidebarProps {
  /** @brief List of saved connection profiles. */
  connections: ConnectionConfig[];
  /** @brief Currently active database connection configuration or null if disconnected. */
  activeConnection: ConnectionConfig | null;
  /** @brief List of introspected database tables in the active database. */
  tables: TableSchema[];
  /** @brief Fully-qualified key of the currently selected table. */
  selectedTableKey?: string | null;
  /** @brief Callback triggered to open the connection modal dialog. */
  onOpenNewConnection: () => void;
  /** @brief Callback triggered when user selects a different connection from the list. */
  onSelectConnection: (conn: ConnectionConfig) => void;
  /** @brief Callback triggered when a table item is clicked, receiving its qualified key. */
  onSelectTable: (tableKey: string) => void;
  /** @brief Callback triggered when user requests a schema refresh. */
  onRefresh: () => void;
  /** @brief Optional loading state indicator during schema introspection. */
  isLoading?: boolean;
  /** @brief Discovered databases available on the active connection server. */
  serverDatabases?: string[];
  /** @brief Callback triggered when user chooses a different database catalog on the active server. */
  onSwitchDatabase?: (dbName: string) => void;
  /** @brief Callback triggered when user refreshes list of databases on server. */
  onRefreshDatabases?: () => void;
  /** @brief Loading state while discovering databases on server. */
  isLoadingDatabases?: boolean;
  /** @brief Callback triggered when user requests to view the rows of a specific table. */
  onViewTableData?: (tableKey: string) => void;
  /** @brief Callback triggered when user requests to inspect table structure, columns, and DDL. */
  onInspectTableStructure?: (table: TableSchema) => void;
  /** @brief Responsive sidebar display mode ('expanded', 'rail', or 'zen'). Defaults to 'expanded'. */
  mode?: SidebarMode;
  /** @brief Callback triggered when the sidebar mode is toggled or switched. */
  onToggleMode?: (nextMode: SidebarMode) => void;
  /** @brief Debounce duration in milliseconds for table search input. Defaults to 150ms. */
  debounceMs?: number;
  /** @brief Optional callback triggered when search filter changes. */
  onFilterChange?: (filter: string) => void;
  /** @brief Optional callback triggered to create a new table. */
  onNewTable?: () => void;
}

/**
 * @brief Modern dark-themed sidebar component providing database and table navigation.
 * @details Supports three distinct view modes:
 * - expanded (256px wide, full table tree, active connection dropdown, search input).
 * - rail (48px wide, vertical icon rail for high screen real estate).
 * - zen (hidden 0px width container for focused canvas/editor work).
 * @param props Component properties configuring connections, tables, and interaction handlers.
 * @return Rendered Sidebar element.
 */
export const Sidebar: React.FC<SidebarProps> = React.memo(({
  connections,
  activeConnection,
  tables,
  selectedTableKey,
  onOpenNewConnection,
  onSelectConnection,
  onSelectTable,
  onRefresh,
  isLoading = false,
  serverDatabases = [],
  onSwitchDatabase,
  onRefreshDatabases,
  isLoadingDatabases = false,
  onViewTableData,
  onInspectTableStructure,
  mode = 'expanded',
  onToggleMode,
  debounceMs = 150,
  onFilterChange,
  onNewTable: _onNewTable,
}) => {
  const [filter, setFilter] = useState('');
  const debouncedFilter = useDebouncedValue(filter, debounceMs);
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);

  // Filter on the qualified name so schema-qualified tables are both visible and searchable.
  const filteredTables = useMemo(() => {
    const q = debouncedFilter.toLowerCase().trim();
    if (!q) return tables;
    return tables.filter((t) => tableKey(t).toLowerCase().includes(q));
  }, [tables, debouncedFilter]);

  // Zen mode: 0px width, hidden
  if (mode === 'zen') {
    return (
      <aside
        aria-label="Database Sidebar"
        data-mode="zen"
        className="hidden w-0 overflow-hidden"
        style={{ display: 'none', width: 0 }}
      />
    );
  }

  // Rail mode: 48px sleek micro-icon rail
  if (mode === 'rail') {
    return (
      <aside
        aria-label="Database Sidebar"
        data-mode="rail"
        className="w-12 bg-[#18191c] border-r border-[#35373c] flex flex-col items-center justify-between py-2 h-full text-xs select-none shrink-0"
      >
        <div className="flex flex-col items-center space-y-2 w-full px-1">
          {/* Active Database Engine Icon with connection dot */}
          <div
            role="button"
            tabIndex={0}
            onClick={() => onToggleMode?.('expanded')}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                onToggleMode?.('expanded');
              }
            }}
            title={
              activeConnection
                ? `${activeConnection.name} (${activeConnection.db_type}) · ${activeConnection.database}`
                : 'No Connection'
            }
            aria-label={
              activeConnection
                ? `${activeConnection.name} (${activeConnection.db_type})`
                : 'No Connection'
            }
            className="relative p-2 rounded hover:bg-[#26282d] transition-colors cursor-pointer group flex items-center justify-center text-[#8c919a] hover:text-[#e6e8ea]"
          >
            <Database className="w-4 h-4 text-[#3a82f7] shrink-0" />
            <span
              className={`absolute bottom-1 right-1 w-2 h-2 rounded-full border border-[#18191c] ${
                activeConnection ? 'bg-[#20c997]' : 'bg-[#8c919a]'
              }`}
            />
          </div>

          {/* Search Trigger Icon (expands sidebar) */}
          <button
            type="button"
            onClick={() => onToggleMode?.('expanded')}
            title="Search tables"
            aria-label="Search tables"
            className="p-2 text-[#8c919a] hover:text-[#e6e8ea] hover:bg-[#26282d] rounded transition-colors"
          >
            <Search className="w-4 h-4" />
          </button>

          {/* Refresh Schema Button with Tooltip */}
          <button
            type="button"
            onClick={onRefresh}
            disabled={!activeConnection || isLoading}
            title="Refresh Schema"
            aria-label="Refresh Schema"
            className="p-2 text-[#8c919a] hover:text-[#e6e8ea] hover:bg-[#26282d] disabled:opacity-40 disabled:hover:bg-transparent rounded transition-colors"
          >
            <RefreshCw
              className={`w-4 h-4 ${isLoading ? 'animate-spin text-[#3a82f7]' : ''}`}
            />
          </button>

          {/* New Connection Button */}
          <button
            type="button"
            onClick={onOpenNewConnection}
            title="New Connection"
            aria-label="New Connection"
            className="p-2 text-[#8c919a] hover:text-[#e6e8ea] hover:bg-[#26282d] rounded transition-colors"
          >
            <Plus className="w-4 h-4" />
          </button>
        </div>

        {/* Bottom Expand Button */}
        <div className="pt-2 border-t border-[#35373c] w-full flex justify-center">
          <button
            type="button"
            onClick={() => onToggleMode?.('expanded')}
            title="Expand sidebar"
            aria-label="Expand sidebar"
            className="p-2 text-[#8c919a] hover:text-[#e6e8ea] hover:bg-[#26282d] rounded transition-colors"
          >
            <PanelLeftOpen className="w-4 h-4" />
          </button>
        </div>
      </aside>
    );
  }

  // Expanded mode: 256px wide (w-64)
  return (
    <aside
      aria-label="Database Sidebar"
      data-mode="expanded"
      className="w-64 bg-[#18191c] border-r border-[#35373c] flex flex-col h-full text-xs select-none shrink-0"
    >
      {/* Workspace & Connection Header */}
      <div className="p-3 border-b border-[#35373c] flex items-center justify-between gap-1 relative bg-[#18191c]">
        <div className="flex-1 min-w-0">
          <button
            type="button"
            onClick={() => setIsDropdownOpen((prev) => !prev)}
            className="flex items-center gap-1.5 w-full text-left p-1 rounded hover:bg-[#26282d] transition-colors group"
            title="Switch database connection"
          >
            <Database className="w-4 h-4 text-[#3a82f7] shrink-0" />
            <div className="flex flex-col min-w-0 flex-1">
              <span className="font-semibold text-[#e6e8ea] truncate text-xs">
                {activeConnection ? activeConnection.name : 'No Connection'}
              </span>
              {activeConnection && (
                <span className="text-[10px] text-[#8c919a] truncate font-mono">
                  {activeConnection.db_type} · {activeConnection.database}
                </span>
              )}
            </div>
            <ChevronDown className="w-3 h-3 text-[#8c919a] group-hover:text-[#e6e8ea] shrink-0 transition-transform" />
          </button>

          {/* Connection Switcher Dropdown */}
          {isDropdownOpen && (
            <>
              <div
                className="fixed inset-0 z-20"
                onClick={() => setIsDropdownOpen(false)}
              />
              <div className="absolute left-2 top-12 w-60 bg-[#1e1f22] border border-[#35373c] rounded-md shadow-xl py-1 z-30">
                <div className="px-2 py-1 text-[10px] uppercase font-bold text-[#8c919a] border-b border-[#35373c]/50">
                  Saved Connections ({connections.length})
                </div>
                <div className="max-h-48 overflow-y-auto py-1">
                  {connections.length === 0 ? (
                    <div className="px-3 py-2 text-[#8c919a] text-[11px] italic">
                      No saved connections.
                    </div>
                  ) : (
                    connections.map((conn) => {
                      const isActive = activeConnection?.id === conn.id;
                      return (
                        <button
                          key={conn.id}
                          type="button"
                          onClick={() => {
                            setIsDropdownOpen(false);
                            onSelectConnection(conn);
                          }}
                          className={`w-full flex items-center justify-between px-2.5 py-1.5 text-left text-xs hover:bg-[#2b2d30] transition-colors ${
                            isActive
                              ? 'text-[#3a82f7] font-medium bg-[#26282d]'
                              : 'text-[#e6e8ea]'
                          }`}
                        >
                          <div className="flex items-center gap-2 truncate">
                            <span
                              className={`w-1.5 h-1.5 rounded-full ${
                                isActive ? 'bg-[#20c997]' : 'bg-[#8c919a]'
                              }`}
                            />
                            <span className="truncate">{conn.name}</span>
                          </div>
                          <span className="text-[10px] text-[#8c919a] uppercase font-mono ml-2">
                            {conn.db_type}
                          </span>
                        </button>
                      );
                    })
                  )}
                </div>
                <div className="border-t border-[#35373c]/50 pt-1 mt-1">
                  <button
                    type="button"
                    onClick={() => {
                      setIsDropdownOpen(false);
                      onOpenNewConnection();
                    }}
                    className="w-full flex items-center gap-1.5 px-2.5 py-1.5 text-left text-xs text-[#3a82f7] hover:bg-[#2b2d30] font-medium"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    <span>New Connection...</span>
                  </button>
                </div>
              </div>
            </>
          )}
        </div>

        {/* Action Buttons */}
        <div className="flex items-center space-x-1 shrink-0">
          <button
            type="button"
            onClick={onRefresh}
            disabled={!activeConnection || isLoading}
            title="Refresh Schema"
            aria-label="Refresh Schema"
            className="p-1 hover:bg-[#2b2d30] disabled:opacity-40 disabled:hover:bg-transparent rounded text-[#8c919a] hover:text-[#e6e8ea] transition-colors"
          >
            <RefreshCw
              className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin text-[#3a82f7]' : ''}`}
            />
          </button>
          <button
            type="button"
            onClick={onOpenNewConnection}
            title="New Connection"
            aria-label="New Connection"
            className="p-1 hover:bg-[#2b2d30] rounded text-[#8c919a] hover:text-[#e6e8ea] transition-colors"
          >
            <Plus className="w-3.5 h-3.5" />
          </button>
          {onToggleMode && (
            <button
              type="button"
              onClick={() => onToggleMode('rail')}
              title="Collapse sidebar"
              aria-label="Collapse sidebar"
              className="p-1 hover:bg-[#2b2d30] rounded text-[#8c919a] hover:text-[#e6e8ea] transition-colors"
            >
              <PanelLeftClose className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      </div>

      {/* Active Database Selector on Connected Server */}
      {activeConnection &&
        activeConnection.db_type !== 'Sqlite' &&
        activeConnection.db_type !== 'DuckDb' && (
          <div className="px-3 py-1.5 border-b border-[#35373c] bg-[#141517] flex items-center justify-between gap-2">
            <div className="flex items-center gap-1.5 min-w-0 flex-1">
              <span className="text-[10px] font-semibold text-[#8c919a] uppercase tracking-wider shrink-0">
                DB:
              </span>
              {serverDatabases && serverDatabases.length > 0 ? (
                <select
                  value={activeConnection.database}
                  onChange={(e) => onSwitchDatabase?.(e.target.value)}
                  className="bg-[#1e1f22] border border-[#35373c] rounded px-1.5 py-0.5 text-xs text-[#e6e8ea] font-mono focus:outline-none focus:border-[#3a82f7] w-full truncate cursor-pointer"
                  title="Switch database catalog on this server"
                  aria-label="Switch active database"
                >
                  {serverDatabases.map((db) => (
                    <option key={db} value={db}>
                      {db}
                    </option>
                  ))}
                </select>
              ) : (
                <span className="font-mono text-xs text-[#e6e8ea] truncate" title={activeConnection.database}>
                  {activeConnection.database}
                </span>
              )}
            </div>
            {onRefreshDatabases && (
              <button
                type="button"
                onClick={onRefreshDatabases}
                disabled={isLoadingDatabases}
                className="p-1 text-[#8c919a] hover:text-[#e6e8ea] hover:bg-[#26282d] rounded transition-colors shrink-0 cursor-pointer disabled:opacity-50"
                title="Discover databases on this server"
                aria-label="Refresh server databases"
              >
                <RefreshCw
                  className={`w-3 h-3 ${isLoadingDatabases ? 'animate-spin text-[#3a82f7]' : ''}`}
                />
              </button>
            )}
          </div>
        )}

      {/* Tables filter input */}
      <div className="p-2 border-b border-[#35373c] bg-[#18191c]">
        <div className="relative flex items-center">
          <Search className="w-3.5 h-3.5 absolute left-2 text-[#8c919a] pointer-events-none" />
          <input
            type="text"
            value={filter}
            onChange={(e) => {
              const val = e.target.value;
              setFilter(val);
              onFilterChange?.(val);
            }}
            placeholder="Filter tables..."
            aria-label="Filter tables"
            className="w-full bg-[#1e1f22] border border-[#35373c] rounded pl-7 pr-6 py-1 text-xs text-[#e6e8ea] placeholder-[#8c919a] focus:outline-none focus:border-[#3a82f7] transition-colors"
          />
          {filter && (
            <button
              type="button"
              onClick={() => {
                setFilter('');
                onFilterChange?.('');
              }}
              title="Clear filter"
              className="absolute right-1.5 text-[#8c919a] hover:text-[#e6e8ea] p-0.5"
            >
              <X className="w-3 h-3" />
            </button>
          )}
        </div>
      </div>

      {/* Tables List */}
      <div className="flex-1 overflow-y-auto p-1 space-y-0.5">
        <div className="flex items-center justify-between text-[10px] uppercase font-semibold text-[#8c919a] px-2 py-1">
          <span>Tables ({filteredTables.length})</span>
          {activeConnection && (
            <span className="text-[#20c997] font-normal lowercase flex items-center gap-1">
              <span className="w-1.5 h-1.5 rounded-full bg-[#20c997] inline-block" />
              connected
            </span>
          )}
        </div>

        {!activeConnection ? (
          <div className="px-3 py-6 text-center text-[#8c919a] space-y-2">
            <Layers className="w-6 h-6 mx-auto text-[#8c919a]/50" />
            <p className="text-xs">No active connection.</p>
            <button
              type="button"
              onClick={onOpenNewConnection}
              className="text-[#3a82f7] hover:underline text-xs"
            >
              Connect to a database
            </button>
          </div>
        ) : filteredTables.length === 0 ? (
          <div className="px-3 py-6 text-center text-[#8c919a] space-y-1">
            <p className="text-xs">
              {debouncedFilter ? `No tables matching "${debouncedFilter}"` : 'No tables in database.'}
            </p>
          </div>
        ) : (
          filteredTables.map((t) => {
            const key = tableKey(t);
            const isSelected = selectedTableKey === key;
            return (
              <div
                key={key}
                onClick={() => onSelectTable(key)}
                onDoubleClick={() => onViewTableData?.(key)}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    onSelectTable(key);
                  }
                }}
                className={`group flex items-center justify-between px-2 py-1.5 rounded cursor-pointer transition-colors ${
                  isSelected
                    ? 'bg-[#2b2d30] text-white border-l-2 border-[#3a82f7]'
                    : 'text-[#e6e8ea] hover:bg-[#26282d]'
                }`}
              >
                <div className="flex items-center space-x-2 truncate min-w-0">
                  <TableIcon
                    className={`w-3.5 h-3.5 shrink-0 ${
                      isSelected ? 'text-[#3a82f7]' : 'text-[#8c919a]'
                    }`}
                  />
                  <span className="truncate font-mono text-[11px]" title={key}>
                    {key}
                  </span>
                </div>
                <div className="flex items-center shrink-0 ml-1">
                  <span className="text-[10px] text-[#8c919a] bg-[#222428] px-1.5 py-0.5 rounded font-mono">
                    {t.columns.length}
                  </span>
                  {onViewTableData && (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        onViewTableData(key);
                      }}
                      title={`View rows for ${key}`}
                      aria-label={`View rows for ${key}`}
                      className="p-1 text-[#8c919a] hover:text-[#3a82f7] hover:bg-[#1e2024] rounded transition-colors opacity-0 group-hover:opacity-100 focus:opacity-100 shrink-0 ml-1 cursor-pointer"
                    >
                      <Eye className="w-3.5 h-3.5" />
                    </button>
                  )}
                  {onInspectTableStructure && (
                    <button
                      type="button"
                      data-testid={`inspect-table-${key}`}
                      onClick={(e) => {
                        e.stopPropagation();
                        onInspectTableStructure(t);
                      }}
                      title={`Inspect structure & DDL for ${key}`}
                      aria-label={`Inspect structure & DDL for ${key}`}
                      className="p-1 text-[#8c919a] hover:text-amber-400 hover:bg-[#1e2024] rounded transition-colors opacity-0 group-hover:opacity-100 focus:opacity-100 shrink-0 ml-1 cursor-pointer"
                    >
                      <FileCode2 className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
              </div>
            );
          })
        )}
      </div>
    </aside>
  );
});
Sidebar.displayName = 'Sidebar';
