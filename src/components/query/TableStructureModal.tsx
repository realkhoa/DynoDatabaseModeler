/**
 * @file TableStructureModal.tsx
 * @brief Modal dialog inspecting full structural metadata, columns, indexes, foreign keys, and DDL.
 * @details Provides a multi-tab view for examining detailed table columns, data types, constraints,
 * indexes, foreign key relationships, and formatted dialect DDL scripts, inspired by Antares SQL
 * table properties and DBeaver table metadata editor.
 */

import React, { useState, useMemo, useCallback } from 'react';
import {
  X,
  Table as TableIcon,
  Columns,
  Key,
  GitFork,
  FileCode,
  Copy,
  Check,
  Sparkles,
  Search,
} from 'lucide-react';
import type { DatabaseSchema, DatabaseType, TableSchema, ForeignKeySchema } from '../../types/database';
import { formatCanonicalType } from '../../types/database';
import { generateTableDdl } from '../../utils/ddlExporter';

/**
 * @brief Properties accepted by the TableStructureModal component.
 */
export interface TableStructureModalProps {
  /** @brief Whether the modal dialog is currently visible. */
  isOpen: boolean;
  /** @brief Callback triggered when user requests closing the modal. */
  onClose: () => void;
  /** @brief Active database schema containing table definitions. */
  schema?: DatabaseSchema | null;
  /** @brief Name of the table to inspect. */
  tableName?: string;
  /** @brief Direct TableSchema object to inspect (alternative to schema + tableName). */
  table?: TableSchema | null;
  /** @brief Database engine dialect. */
  dbType?: DatabaseType;
  /** @brief Callback invoked when user requests opening the DDL in a new query worksheet. */
  onOpenInWorksheet?: (sql: string, title?: string) => void;
  /** @brief Callback invoked when user requests generating mock data for this table. */
  onOpenMockGenerator?: (tableName: string) => void;
}

type TabType = 'columns' | 'indexes' | 'foreignKeys' | 'ddl';

/**
 * @brief Interactive Table Structure & Metadata Inspector Modal component.
 * @param props Component properties.
 * @return Rendered modal element or null if closed.
 */
export function TableStructureModal({
  isOpen,
  onClose,
  schema,
  tableName,
  table,
  dbType = 'Postgres',
  onOpenInWorksheet,
  onOpenMockGenerator,
}: TableStructureModalProps): React.ReactElement | null {
  const [activeTab, setActiveTab] = useState<TabType>('columns');
  const [copied, setCopied] = useState<boolean>(false);
  const [columnFilter, setColumnFilter] = useState<string>('');

    const tableSchema = useMemo<TableSchema | undefined>(() => {
    if (table) return table;
    if (!schema || !tableName) return undefined;
    return schema.tables.find(
      (t) => t.name.toLowerCase() === tableName.toLowerCase()
    );
  }, [table, schema, tableName]);

  const ddlScript = useMemo(() => {
    if (!tableSchema) return '';
    return generateTableDdl(tableSchema, dbType);
  }, [tableSchema, dbType]);

  const filteredColumns = useMemo(() => {
    if (!tableSchema) return [];
    if (!columnFilter.trim()) return tableSchema.columns;
    const q = columnFilter.toLowerCase();
    return tableSchema.columns.filter(
      (c) =>
        c.name.toLowerCase().includes(q) ||
        formatCanonicalType(c.data_type).toLowerCase().includes(q)
    );
  }, [tableSchema, columnFilter]);

  const handleCopyDdl = useCallback(async () => {
    if (!ddlScript) return;
    try {
      await navigator.clipboard.writeText(ddlScript);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Fallback
    }
  }, [ddlScript]);

  if (!isOpen || !tableSchema) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="table-structure-modal-title"
    >
      <div className="flex flex-col w-full max-w-5xl h-[85vh] bg-[#1e1f22] border border-[#35383f] rounded-xl shadow-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-150">
        {/* Header Bar */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-[#2d3139] bg-[#24262b]">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-blue-500/10 border border-blue-500/20 rounded-lg text-blue-400">
              <TableIcon className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 id="table-structure-modal-title" className="text-base font-semibold text-[#f1f2f4]">
                  {tableSchema.name}
                </h2>
                {tableSchema.schema && (
                  <span className="px-2 py-0.5 text-[10px] font-mono bg-[#1a1b1e] border border-[#35383f] text-[#8c919a] rounded">
                    {tableSchema.schema}
                  </span>
                )}
                <span className="px-2 py-0.5 text-[10px] font-medium bg-blue-500/10 text-blue-400 border border-blue-500/20 rounded">
                  {tableSchema.columns.length} columns
                </span>
              </div>
              <p className="text-xs text-[#8c919a]">
                Table structure, columns, indexes, foreign keys, and DDL ({dbType})
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {onOpenMockGenerator && (
              <button
                type="button"
                onClick={() => {
                  onClose();
                  onOpenMockGenerator(tableSchema.name);
                }}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-purple-500/10 hover:bg-purple-500/20 text-purple-400 border border-purple-500/20 rounded-lg text-xs font-medium transition-colors"
                title="Synthesize mock rows"
              >
                <Sparkles className="w-3.5 h-3.5" />
                <span>Mock Data</span>
              </button>
            )}

            <button
              onClick={onClose}
              className="p-1.5 text-[#8c919a] hover:text-[#f1f2f4] hover:bg-[#2d3139] rounded-lg transition-colors"
              title="Close"
              aria-label="Close modal"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Tab Navigation Toolbar */}
        <div className="flex items-center justify-between px-6 border-b border-[#2d3139] bg-[#1a1b1e]">
          <div className="flex items-center gap-1">
            <button
              onClick={() => setActiveTab('columns')}
              className={`flex items-center gap-2 px-4 py-3 text-xs font-medium border-b-2 transition-colors ${
                activeTab === 'columns'
                  ? 'border-blue-500 text-blue-400'
                  : 'border-transparent text-[#8c919a] hover:text-[#f1f2f4]'
              }`}
            >
              <Columns className="w-4 h-4" />
              <span>Columns ({tableSchema.columns.length})</span>
            </button>

            <button
              onClick={() => setActiveTab('indexes')}
              className={`flex items-center gap-2 px-4 py-3 text-xs font-medium border-b-2 transition-colors ${
                activeTab === 'indexes'
                  ? 'border-blue-500 text-blue-400'
                  : 'border-transparent text-[#8c919a] hover:text-[#f1f2f4]'
              }`}
            >
              <Key className="w-4 h-4" />
              <span>Indexes ({tableSchema.indexes?.length ?? 0})</span>
            </button>

            <button
              onClick={() => setActiveTab('foreignKeys')}
              className={`flex items-center gap-2 px-4 py-3 text-xs font-medium border-b-2 transition-colors ${
                activeTab === 'foreignKeys'
                  ? 'border-blue-500 text-blue-400'
                  : 'border-transparent text-[#8c919a] hover:text-[#f1f2f4]'
              }`}
            >
              <GitFork className="w-4 h-4" />
              <span>Foreign Keys ({tableSchema.foreign_keys?.length ?? 0})</span>
            </button>

            <button
              onClick={() => setActiveTab('ddl')}
              className={`flex items-center gap-2 px-4 py-3 text-xs font-medium border-b-2 transition-colors ${
                activeTab === 'ddl'
                  ? 'border-blue-500 text-blue-400'
                  : 'border-transparent text-[#8c919a] hover:text-[#f1f2f4]'
              }`}
            >
              <FileCode className="w-4 h-4" />
              <span>DDL Script</span>
            </button>
          </div>

          {activeTab === 'columns' && (
            <div className="relative">
              <Search className="w-3.5 h-3.5 absolute left-2.5 top-2 text-[#8c919a]" />
              <input
                type="text"
                placeholder="Filter columns..."
                value={columnFilter}
                onChange={(e) => setColumnFilter(e.target.value)}
                className="pl-8 pr-3 py-1 bg-[#24262b] border border-[#35383f] text-xs text-[#f1f2f4] placeholder-[#8c919a] rounded-md focus:outline-hidden focus:border-blue-500"
              />
            </div>
          )}
        </div>

        {/* Tab Content Panels */}
        <div className="flex-1 overflow-auto bg-[#141518]">
          {/* Columns Tab */}
          {activeTab === 'columns' && (
            <table className="w-full text-left text-xs border-collapse">
              <thead className="sticky top-0 bg-[#1e1f22] border-b border-[#2d3139] text-[#8c919a] uppercase text-[10px] tracking-wider">
                <tr>
                  <th className="py-2.5 px-4 font-semibold w-12 text-center">#</th>
                  <th className="py-2.5 px-4 font-semibold">Column Name</th>
                  <th className="py-2.5 px-4 font-semibold">Data Type</th>
                  <th className="py-2.5 px-4 font-semibold text-center">Primary Key</th>
                  <th className="py-2.5 px-4 font-semibold text-center">Nullable</th>
                  <th className="py-2.5 px-4 font-semibold">Default</th>
                  <th className="py-2.5 px-4 font-semibold">Extra</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#24262b]">
                {filteredColumns.map((col, idx) => (
                  <tr key={col.name} className="hover:bg-[#1a1b1e] transition-colors">
                    <td className="py-2 px-4 text-center text-[#8c919a] font-mono">{idx + 1}</td>
                    <td className="py-2 px-4 font-semibold text-[#f1f2f4] flex items-center gap-2">
                      <span>{col.name}</span>
                      {col.is_primary_key && (
                        <Key className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                      )}
                    </td>
                    <td className="py-2 px-4 font-mono text-blue-400">{formatCanonicalType(col.data_type)}</td>
                    <td className="py-2 px-4 text-center">
                      {col.is_primary_key ? (
                        <span className="px-1.5 py-0.5 text-[10px] font-bold bg-amber-500/10 text-amber-400 border border-amber-500/20 rounded">
                          YES
                        </span>
                      ) : (
                        <span className="text-[#8c919a]">-</span>
                      )}
                    </td>
                    <td className="py-2 px-4 text-center">
                      {col.is_nullable ? (
                        <span className="text-emerald-400 font-medium">YES</span>
                      ) : (
                        <span className="text-red-400 font-medium">NO</span>
                      )}
                    </td>
                    <td className="py-2 px-4 font-mono text-[#8c919a]">
                      {col.default_value !== undefined && col.default_value !== null
                        ? String(col.default_value)
                        : '-'}
                    </td>
                    <td className="py-2 px-4 text-[#8c919a]">
                      {col.is_auto_increment ? 'Auto-increment' : '-'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          {/* Indexes Tab */}
          {activeTab === 'indexes' && (
            <table className="w-full text-left text-xs border-collapse">
              <thead className="sticky top-0 bg-[#1e1f22] border-b border-[#2d3139] text-[#8c919a] uppercase text-[10px] tracking-wider">
                <tr>
                  <th className="py-2.5 px-4 font-semibold">Index Name</th>
                  <th className="py-2.5 px-4 font-semibold">Columns</th>
                  <th className="py-2.5 px-4 font-semibold text-center">Unique</th>
                  <th className="py-2.5 px-4 font-semibold">Algorithm / Type</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#24262b]">
                {!tableSchema.indexes || tableSchema.indexes.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="py-8 text-center text-[#8c919a]">
                      No secondary indexes defined on this table.
                    </td>
                  </tr>
                ) : (
                  tableSchema.indexes.map((idx) => (
                    <tr key={idx.name} className="hover:bg-[#1a1b1e] transition-colors">
                      <td className="py-2.5 px-4 font-mono font-medium text-[#f1f2f4]">{idx.name}</td>
                      <td className="py-2.5 px-4 font-mono text-blue-400">
                        {idx.columns.join(', ')}
                      </td>
                      <td className="py-2.5 px-4 text-center">
                        {idx.is_unique ? (
                          <span className="px-1.5 py-0.5 text-[10px] font-bold bg-purple-500/10 text-purple-400 border border-purple-500/20 rounded">
                            UNIQUE
                          </span>
                        ) : (
                          <span className="text-[#8c919a]">-</span>
                        )}
                      </td>
                      <td className="py-2.5 px-4 text-[#8c919a]">BTREE</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          )}

          {/* Foreign Keys Tab */}
          {activeTab === 'foreignKeys' && (
            <table className="w-full text-left text-xs border-collapse">
              <thead className="sticky top-0 bg-[#1e1f22] border-b border-[#2d3139] text-[#8c919a] uppercase text-[10px] tracking-wider">
                <tr>
                  <th className="py-2.5 px-4 font-semibold">Constraint Name</th>
                  <th className="py-2.5 px-4 font-semibold">Source Column</th>
                  <th className="py-2.5 px-4 font-semibold">Referenced Table & Column</th>
                  <th className="py-2.5 px-4 font-semibold">On Delete</th>
                  <th className="py-2.5 px-4 font-semibold">On Update</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#24262b]">
                {!tableSchema.foreign_keys || tableSchema.foreign_keys.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="py-8 text-center text-[#8c919a]">
                      No foreign key relationships originating from this table.
                    </td>
                  </tr>
                ) : (
                  tableSchema.foreign_keys.map((fk: ForeignKeySchema) => (
                    <tr key={fk.constraint_name} className="hover:bg-[#1a1b1e] transition-colors">
                      <td className="py-2.5 px-4 font-mono font-medium text-[#f1f2f4]">{fk.constraint_name}</td>
                      <td className="py-2.5 px-4 font-mono text-blue-400">
                        {fk.source_column}
                      </td>
                      <td className="py-2.5 px-4 font-mono text-emerald-400">
                        {fk.target_table} ({fk.target_column})
                      </td>
                      <td className="py-2.5 px-4 uppercase text-[#8c919a]">{fk.on_delete ?? 'NO ACTION'}</td>
                      <td className="py-2.5 px-4 uppercase text-[#8c919a]">{fk.on_update ?? 'NO ACTION'}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          )}

          {/* DDL Script Tab */}
          {activeTab === 'ddl' && (
            <div className="p-4 h-full flex flex-col">
              <div className="flex items-center justify-between pb-3">
                <span className="text-xs text-[#8c919a]">
                  Dialect: <strong className="text-[#f1f2f4]">{dbType}</strong>
                </span>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={handleCopyDdl}
                    className="flex items-center gap-1.5 px-3 py-1.5 bg-[#24262b] hover:bg-[#2d3139] text-[#f1f2f4] text-xs font-medium rounded-lg border border-[#35383f] transition-colors"
                  >
                    {copied ? (
                      <>
                        <Check className="w-3.5 h-3.5 text-emerald-400" />
                        <span className="text-emerald-400">Copied</span>
                      </>
                    ) : (
                      <>
                        <Copy className="w-3.5 h-3.5" />
                        <span>Copy DDL</span>
                      </>
                    )}
                  </button>

                  {onOpenInWorksheet && (
                    <button
                      type="button"
                      onClick={() => {
                        onClose();
                        onOpenInWorksheet(ddlScript, `DDL: ${tableSchema.name}`);
                      }}
                      className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-600 hover:bg-blue-500 text-white text-xs font-medium rounded-lg transition-colors"
                    >
                      <FileCode className="w-3.5 h-3.5" />
                      <span>Open in Worksheet</span>
                    </button>
                  )}
                </div>
              </div>
              <div className="flex-1 overflow-auto p-4 bg-[#1a1b1e] border border-[#2d3139] rounded-lg font-mono text-xs text-[#a9b1d6] whitespace-pre leading-relaxed select-text">
                {ddlScript}
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-6 py-3 border-t border-[#2d3139] bg-[#24262b]">
          <span className="text-xs text-[#8c919a]">
            Table: <code className="text-[#c3c6cd] font-mono">{tableSchema.name}</code>
          </span>
          <button
            onClick={onClose}
            className="px-4 py-1.5 text-xs font-medium text-[#f1f2f4] bg-[#2d3139] hover:bg-[#35383f] rounded-lg border border-[#3d424d] transition-colors"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
