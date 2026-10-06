/**
 * @file Sidebar.tsx
 * @brief Modern left navigation sidebar component for DynoDbModeler.
 * @details Displays connection selector, active database status, schema refresh trigger,
 * connection creator trigger, table search filter, and list of database tables with column counts.
 */

import React, { useState } from 'react';
import {
  Database,
  Plus,
  Table as TableIcon,
  RefreshCw,
  Search,
  X,
  ChevronDown,
  Layers,
} from 'lucide-react';
import type { ConnectionConfig, TableSchema } from '../types/database';

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
  /** @brief Currently selected table name for ERD/details view. */
  selectedTableName?: string | null;
  /** @brief Callback triggered to open the connection modal dialog. */
  onOpenNewConnection: () => void;
  /** @brief Callback triggered when user selects a different connection from the list. */
  onSelectConnection: (conn: ConnectionConfig) => void;
  /** @brief Callback triggered when a table item is clicked. */
  onSelectTable: (tableName: string) => void;
  /** @brief Callback triggered when user requests a schema refresh. */
  onRefresh: () => void;
  /** @brief Optional loading state indicator during schema introspection. */
  isLoading?: boolean;
}

/**
 * @brief Modern dark-themed sidebar component providing database and table navigation.
 * @param props Component properties configuring connections, tables, and interaction handlers.
 * @return Rendered Sidebar element.
 */
export const Sidebar: React.FC<SidebarProps> = ({
  connections,
  activeConnection,
  tables,
  selectedTableName,
  onOpenNewConnection,
  onSelectConnection,
  onSelectTable,
  onRefresh,
  isLoading = false,
}) => {
  const [filter, setFilter] = useState('');
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);

  const filteredTables = tables.filter((t) =>
    t.name.toLowerCase().includes(filter.toLowerCase())
  );

  return (
    <aside
      aria-label="Database Sidebar"
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
        </div>
      </div>

      {/* Tables filter input */}
      <div className="p-2 border-b border-[#35373c] bg-[#18191c]">
        <div className="relative flex items-center">
          <Search className="w-3.5 h-3.5 absolute left-2 text-[#8c919a] pointer-events-none" />
          <input
            type="text"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Filter tables..."
            aria-label="Filter tables"
            className="w-full bg-[#1e1f22] border border-[#35373c] rounded pl-7 pr-6 py-1 text-xs text-[#e6e8ea] placeholder-[#8c919a] focus:outline-none focus:border-[#3a82f7] transition-colors"
          />
          {filter && (
            <button
              type="button"
              onClick={() => setFilter('')}
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
              {filter ? `No tables matching "${filter}"` : 'No tables in database.'}
            </p>
          </div>
        ) : (
          filteredTables.map((t) => {
            const isSelected = selectedTableName === t.name;
            return (
              <div
                key={t.name}
                onClick={() => onSelectTable(t.name)}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    onSelectTable(t.name);
                  }
                }}
                className={`flex items-center justify-between px-2 py-1.5 rounded cursor-pointer transition-colors ${
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
                  <span className="truncate font-mono text-[11px]">{t.name}</span>
                </div>
                <span className="text-[10px] text-[#8c919a] bg-[#222428] px-1.5 py-0.5 rounded font-mono shrink-0 ml-1">
                  {t.columns.length}
                </span>
              </div>
            );
          })
        )}
      </div>
    </aside>
  );
};
