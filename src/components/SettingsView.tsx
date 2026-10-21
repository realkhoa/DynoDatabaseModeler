/**
 * @file SettingsView.tsx
 * @brief Subcomponent rendering the Connection Manager settings view.
 * @details Lists saved database profiles with actions to connect, disconnect, edit, and delete.
 */

import React from 'react';
import { Database, Plus, Trash2 } from 'lucide-react';
import type { ConnectionConfig } from '../types/database';

/**
 * @brief Properties accepted by the SettingsView component.
 */
export interface SettingsViewProps {
  /** @brief List of saved connection profiles. */
  connections: ConnectionConfig[];
  /** @brief Currently active database connection configuration or null. */
  activeConnection: ConnectionConfig | null;
  /** @brief Callback triggered when user requests connecting to a profile. */
  onConnect: (conn: ConnectionConfig) => void;
  /** @brief Callback triggered when user requests disconnecting. */
  onDisconnect: () => void;
  /** @brief Callback triggered when user requests editing a connection profile. */
  onEdit: (conn: ConnectionConfig) => void;
  /** @brief Callback triggered when user requests deleting a connection profile. */
  onDelete: (id: string) => void;
  /** @brief Callback triggered to open the new connection modal dialog. */
  onOpenNewConnection: () => void;
}

/**
 * @brief Renders the connection manager list and profile management controls.
 * @param props Connection list, active connection state, and management callbacks.
 * @return Rendered Settings view element.
 */
export const SettingsView: React.FC<SettingsViewProps> = React.memo(({

  connections,
  activeConnection,
  onConnect,
  onDisconnect,
  onEdit,
  onDelete,
  onOpenNewConnection,
}) => {
  return (
    <div className="flex-1 overflow-auto p-6 max-w-4xl mx-auto w-full space-y-6">
      <div>
        <h2 className="text-base font-bold text-[#e6e8ea]">Connection Manager</h2>
        <p className="text-xs text-[#8c919a] mt-0.5">
          Manage your saved database connection configurations and endpoints.
        </p>
      </div>

      <div className="space-y-3">
        {connections.map((conn) => {
          const isActive = activeConnection?.id === conn.id;
          return (
            <div
              key={conn.id}
              className="bg-[#18191c] border border-[#35373c] rounded-lg p-4 flex items-center justify-between"
            >
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded bg-[#26282d] flex items-center justify-center text-[#3a82f7]">
                  <Database className="w-4 h-4" />
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <span className="font-semibold text-xs text-[#e6e8ea]">
                      {conn.name}
                    </span>
                    <span className="text-[10px] uppercase font-mono px-1.5 py-0.5 rounded bg-[#26282d] text-[#8c919a]">
                      {conn.db_type}
                    </span>
                    {isActive && (
                      <span className="text-[10px] text-[#20c997] font-medium flex items-center gap-1">
                        <span className="w-1.5 h-1.5 rounded-full bg-[#20c997]" />
                        Active
                      </span>
                    )}
                  </div>
                  <p className="text-[11px] text-[#8c919a] font-mono mt-0.5">
                    {conn.db_type === 'Sqlite' || conn.db_type === 'DuckDb'
                      ? conn.database
                      : `${conn.host}:${conn.port}/${conn.database}`}
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-2">
                {!isActive ? (
                  <button
                    type="button"
                    aria-label={`Connect to ${conn.name}`}
                    onClick={() => onConnect(conn)}
                    className="px-3 py-1 bg-[#3a82f7] hover:bg-[#2f6fd6] text-white rounded text-xs font-medium"
                  >
                    Connect
                  </button>
                ) : (
                  <button
                    type="button"
                    aria-label={`Disconnect from ${conn.name}`}
                    onClick={onDisconnect}
                    className="px-3 py-1 bg-[#26282d] hover:bg-[#35373c] text-red-400 rounded text-xs font-medium border border-[#35373c]"
                  >
                    Disconnect
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => onEdit(conn)}
                  className="px-2.5 py-1 text-[#8c919a] hover:text-[#e6e8ea] hover:bg-[#26282d] rounded text-xs"
                >
                  Edit
                </button>
                <button
                  type="button"
                  onClick={() => onDelete(conn.id)}
                  title="Delete Connection"
                  className="p-1.5 text-[#8c919a] hover:text-red-400 hover:bg-[#26282d] rounded"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          );
        })}
      </div>

      <div className="pt-4 border-t border-[#35373c] flex items-center justify-between text-xs text-[#8c919a]">
        <span>DynoDbModeler v0.1.0 · Modern Minimalist Shell</span>
        <button
          type="button"
          onClick={onOpenNewConnection}
          className="flex items-center gap-1.5 text-[#3a82f7] hover:underline"
        >
          <Plus className="w-3.5 h-3.5" />
          <span>Add Another Connection</span>
        </button>
      </div>
    </div>
  );
});
SettingsView.displayName = 'SettingsView';
