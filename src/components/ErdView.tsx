/**
 * @file ErdView.tsx
 * @brief Subcomponent rendering ERD canvas placeholder and table schema inspector.
 * @details Displays empty database state, table column structure, constraints, and relationships.
 */

import React from 'react';
import {
  Database,
  Plus,
  Table as TableIcon,
  Layers,
  Key,
  Link as LinkIcon,
} from 'lucide-react';
import {
  ConnectionConfig,
  TableSchema,
  formatCanonicalType,
} from '../types/database';

/**
 * @brief Properties accepted by the ErdView component.
 */
export interface ErdViewProps {
  /** @brief Currently active database connection configuration or null. */
  activeConnection: ConnectionConfig | null;
  /** @brief Currently selected table schema for detail inspection. */
  selectedTable?: TableSchema;
  /** @brief Callback triggered to open the new connection modal dialog. */
  onOpenNewConnection: () => void;
}

/**
 * @brief Renders the ERD canvas workspace or table structure inspection grid.
 * @param props Active connection, selected table metadata, and connection triggers.
 * @return Rendered ERD view element.
 */
export const ErdView: React.FC<ErdViewProps> = ({
  activeConnection,
  selectedTable,
  onOpenNewConnection,
}) => {
  if (!activeConnection) {
    return (
      <div className="flex-1 flex items-center justify-center p-8">
        <div className="max-w-md w-full bg-[#18191c] border border-[#35373c] rounded-lg p-8 text-center shadow-xl space-y-4">
          <div className="w-12 h-12 bg-[#3a82f7]/10 text-[#3a82f7] rounded-full flex items-center justify-center mx-auto">
            <Database className="w-6 h-6" />
          </div>
          <div>
            <h2 className="text-base font-semibold text-[#e6e8ea]">
              No Database Connected
            </h2>
            <p className="mt-1 text-xs text-[#8c919a]">
              Connect to SQLite, PostgreSQL, MySQL, or SQL Server to introspect schemas
              and visualize entity relationships.
            </p>
          </div>
          <button
            type="button"
            onClick={onOpenNewConnection}
            className="inline-flex items-center gap-2 px-4 py-2 bg-[#3a82f7] hover:bg-[#2f6fd6] text-white rounded font-medium text-xs shadow transition-colors"
          >
            <Plus className="w-4 h-4" />
            <span>Connect Database</span>
          </button>
        </div>
      </div>
    );
  }

  if (!selectedTable) {
    return (
      <div className="flex-1 flex items-center justify-center p-8 text-center text-[#8c919a]">
        <div className="space-y-2">
          <Layers className="w-8 h-8 mx-auto text-[#8c919a]/60" />
          <p className="text-sm font-medium text-[#e6e8ea]">Select a table from the sidebar</p>
          <p className="text-xs">
            Choose any table in {activeConnection.name} to view structure and relations.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {/* Table Details Sub-header */}
      <div className="h-10 border-b border-[#35373c] bg-[#18191c] px-4 flex items-center justify-between text-xs">
        <div className="flex items-center space-x-2">
          <TableIcon className="w-4 h-4 text-[#3a82f7]" />
          <span className="font-bold text-[#e6e8ea] font-mono">
            {selectedTable.schema ? `${selectedTable.schema}.${selectedTable.name}` : selectedTable.name}
          </span>
          <span className="text-[10px] text-[#8c919a] bg-[#26282d] px-2 py-0.5 rounded">
            {selectedTable.columns.length} columns · {selectedTable.foreign_keys.length} foreign keys
          </span>
        </div>

        <div className="text-[11px] text-[#8c919a]">
          Interactive Modern ERD Visualizer
        </div>
      </div>

      {/* Schema Columns & Structure Table */}
      <div className="flex-1 overflow-auto p-4">
        <div className="bg-[#18191c] border border-[#35373c] rounded-md overflow-hidden shadow">
          <table className="w-full text-left text-xs border-collapse">
            <thead>
              <tr className="bg-[#26282d] border-b border-[#35373c] text-[#8c919a] text-[10px] uppercase tracking-wider font-semibold">
                <th className="py-2 px-3 w-10 text-center">PK</th>
                <th className="py-2 px-3">Column Name</th>
                <th className="py-2 px-3">Data Type</th>
                <th className="py-2 px-3">Nullable</th>
                <th className="py-2 px-3">Default</th>
                <th className="py-2 px-3">Foreign Key</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#35373c]/50 font-mono text-[11px]">
              {selectedTable.columns.map((col) => {
                const fk = selectedTable.foreign_keys.find(
                  (f) => f.source_column === col.name
                );
                return (
                  <tr
                    key={col.name}
                    className="hover:bg-[#26282d]/50 transition-colors"
                  >
                    <td className="py-2 px-3 text-center">
                      {col.is_primary_key && (
                        <Key className="w-3.5 h-3.5 text-[#f5a623] inline-block" />
                      )}
                    </td>
                    <td className="py-2 px-3 font-semibold text-[#e6e8ea]">
                      {col.name}
                    </td>
                    <td className="py-2 px-3 text-[#3a82f7]">
                      {formatCanonicalType(col.data_type)}
                    </td>
                    <td className="py-2 px-3 text-[#8c919a]">
                      {col.is_nullable ? 'YES' : 'NO'}
                    </td>
                    <td className="py-2 px-3 text-[#8c919a]">
                      {col.default_value || '-'}
                    </td>
                    <td className="py-2 px-3 text-[#20c997]">
                      {fk ? (
                        <span className="flex items-center gap-1">
                          <LinkIcon className="w-3 h-3" />
                          <span>
                            {fk.target_table}({fk.target_column})
                          </span>
                        </span>
                      ) : (
                        '-'
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
