/**
 * @file MockDataGeneratorModal.tsx
 * @brief Interactive modal dialog for synthesizing and inserting mock rows into tables.
 * @details Configures column generator rules (Faker names, emails, UUIDs, numbers, dates),
 * previewing generated SQL batch insert statements with options to copy, open in a worksheet,
 * or execute directly into the database.
 */

import React, { useState, useMemo, useCallback } from 'react';
import {
  X,
  Sparkles,
  Copy,
  Check,
  Play,
  FileCode,
  Sliders,
  Loader2,
  AlertCircle,
} from 'lucide-react';
import type { DatabaseSchema, DatabaseType, TableSchema, ColumnSchema } from '../../types/database';
import { formatCanonicalType } from '../../types/database';
import {
  detectDefaultGenerator,
  generateMockSql,
  type ColumnGeneratorConfig,
  type MockGeneratorType,
} from '../../utils/mockDataGenerator';

/**
 * @brief Properties accepted by the MockDataGeneratorModal component.
 */
export interface MockDataGeneratorModalProps {
  /** @brief Whether the modal dialog is visibly open. */
  isOpen: boolean;
  /** @brief Callback triggered when user requests closing the modal. */
  onClose: () => void;
  /** @brief Active database schema containing tables and column definitions. */
  schema?: DatabaseSchema | null;
  /** @brief Currently selected table name to generate data for. */
  initialTableName?: string;
  /** @brief Target table name alias. */
  targetTable?: string;
  /** @brief Optional direct column list if schema is not provided. */
  columns?: ColumnSchema[];
  /** @brief Database engine dialect. */
  dbType?: DatabaseType;
  /** @brief Callback invoked when user chooses to open generated SQL in a new worksheet tab. */
  onOpenInWorksheet?: (sql: string, title?: string) => void;
  /** @brief Callback invoked when user chooses to insert generated SQL into the active editor. */
  onInsertGeneratedSql?: (sql: string) => void;
  /** @brief Async callback to execute the generated SQL directly into the live database. */
  onExecuteSql?: (sql: string) => Promise<void>;
}

const GENERATOR_OPTIONS: { label: string; value: MockGeneratorType }[] = [
  { label: 'Full Name', value: 'FullName' },
  { label: 'First Name', value: 'FirstName' },
  { label: 'Last Name', value: 'LastName' },
  { label: 'Email Address', value: 'Email' },
  { label: 'UUID (v4)', value: 'Uuid' },
  { label: 'Phone Number', value: 'PhoneNumber' },
  { label: 'Company Name', value: 'Company' },
  { label: 'City', value: 'City' },
  { label: 'Country', value: 'Country' },
  { label: 'Street Address', value: 'StreetAddress' },
  { label: 'Random Integer', value: 'Integer' },
  { label: 'Random Decimal / Float', value: 'Float' },
  { label: 'Boolean (True / False)', value: 'Boolean' },
  { label: 'Date (YYYY-MM-DD)', value: 'Date' },
  { label: 'Timestamp (ISO)', value: 'Timestamp' },
  { label: 'Lorem Ipsum Text', value: 'LoremSentence' },
  { label: 'Fixed Constant', value: 'Constant' },
];

/**
 * @brief Interactive Mock Data Generator Modal component.
 * @param props Component properties.
 * @return Rendered modal element or null if closed.
 */
export function MockDataGeneratorModal({
  isOpen,
  onClose,
  schema,
  initialTableName,
  targetTable,
  columns,
  dbType = 'Postgres',
  onOpenInWorksheet,
  onInsertGeneratedSql,
  onExecuteSql,
}: MockDataGeneratorModalProps): React.ReactElement | null {
  const activeTableName = targetTable || initialTableName;
  const tables = useMemo(() => schema?.tables ?? [], [schema]);

  const [selectedTable, setSelectedTable] = useState<string>(() => {
    if (activeTableName && tables.some((t) => t.name === activeTableName)) {
      return activeTableName;
    }
    return activeTableName || tables[0]?.name || 'users';
  });

  const prevInitialRef = React.useRef<string | undefined>(activeTableName);
  React.useEffect(() => {
    if (activeTableName !== prevInitialRef.current) {
      prevInitialRef.current = activeTableName;
      if (activeTableName) {
        setSelectedTable(activeTableName);
      }
    }
  }, [activeTableName]);

  const currentTableSchema = useMemo<TableSchema | undefined>(() => {
    if (columns && columns.length > 0) {
      return {
        name: selectedTable || 'users',
        columns,
        foreign_keys: [],
        indexes: [],
      };
    }
    return tables.find((t) => t.name.toLowerCase() === selectedTable.toLowerCase());
  }, [columns, selectedTable, tables]);

  const [rowCount, setRowCount] = useState<number>(10);
  const [copied, setCopied] = useState<boolean>(false);
  const [isExecuting, setIsExecuting] = useState<boolean>(false);
  const [executionError, setExecutionError] = useState<string | null>(null);
  const [executionSuccess, setExecutionSuccess] = useState<string | null>(null);

  // Column generator configurations state
  const [configs, setConfigs] = useState<Record<string, ColumnGeneratorConfig>>({});

  // Initialize configurations when table changes
  React.useEffect(() => {
    if (!currentTableSchema) return;
    const initialConfigs: Record<string, ColumnGeneratorConfig> = {};
    for (const col of currentTableSchema.columns) {
      const defaultType = detectDefaultGenerator(col);
      const typeStr = typeof col.data_type === 'string' ? col.data_type.toUpperCase() : formatCanonicalType(col.data_type).toUpperCase();
      const isPkInt = col.is_primary_key && typeStr.includes('INT');
      initialConfigs[col.name] = {
        generatorType: defaultType,
        isAutoIncrement: isPkInt,
        minValue: typeStr.includes('INT') ? 1 : 0,
        maxValue: typeStr.includes('INT') ? 1000 : 100,
        nullPercentage: col.is_nullable ? 0 : undefined,
      };
    }
    setConfigs(initialConfigs);
    setExecutionError(null);
    setExecutionSuccess(null);
  }, [currentTableSchema]);

  const updateColumnConfig = useCallback(
    (colName: string, updates: Partial<ColumnGeneratorConfig>) => {
      setConfigs((prev) => ({
        ...prev,
        [colName]: {
          ...(prev[colName] ?? { generatorType: 'LoremSentence' }),
          ...updates,
        },
      }));
    },
    []
  );

  // Generate preview SQL script
  const generatedSql = useMemo(() => {
    if (!currentTableSchema) return '';
    return generateMockSql(
      currentTableSchema.name,
      currentTableSchema.columns,
      configs,
      rowCount,
      dbType
    );
  }, [currentTableSchema, configs, rowCount, dbType]);

  const handleCopy = useCallback(async () => {
    if (!generatedSql) return;
    try {
      await navigator.clipboard.writeText(generatedSql);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard fallback
    }
  }, [generatedSql]);

  const handleOpenWorksheet = useCallback(() => {
    if (!generatedSql) return;
    if (onInsertGeneratedSql) {
      onInsertGeneratedSql(generatedSql);
      onClose();
      return;
    }
    if (onOpenInWorksheet) {
      onOpenInWorksheet(generatedSql, `Mock: ${selectedTable}`);
      onClose();
    }
  }, [generatedSql, onInsertGeneratedSql, onOpenInWorksheet, selectedTable, onClose]);

  const handleDirectExecute = useCallback(async () => {
    if (!generatedSql || !onExecuteSql) return;
    setIsExecuting(true);
    setExecutionError(null);
    setExecutionSuccess(null);
    try {
      await onExecuteSql(generatedSql);
      setExecutionSuccess(`Successfully inserted ${rowCount} mock rows into ${selectedTable}!`);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setExecutionError(msg);
    } finally {
      setIsExecuting(false);
    }
  }, [generatedSql, onExecuteSql, rowCount, selectedTable]);

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="mock-data-modal-title"
    >
      <div className="flex flex-col w-full max-w-5xl h-[88vh] bg-[#1e1f22] border border-[#35383f] rounded-xl shadow-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-150">
        {/* Header Bar */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-[#2d3139] bg-[#24262b]">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-purple-500/10 border border-purple-500/20 rounded-lg text-purple-400">
              <Sparkles className="w-5 h-5" />
            </div>
            <div>
              <h2 id="mock-data-modal-title" className="text-base font-semibold text-[#f1f2f4]">
                Synthetic Mock Data Generator
              </h2>
              <p className="text-xs text-[#8c919a]">
                Generate realistic test rows for table development and benchmarking
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 text-[#8c919a] hover:text-[#f1f2f4] hover:bg-[#2d3139] rounded-lg transition-colors cursor-pointer"
            title="Close"
            aria-label="Close modal"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Global Generator Controls Bar */}
        <div className="flex flex-wrap items-center justify-between gap-4 px-6 py-3 border-b border-[#2d3139] bg-[#1a1b1e]">
          <div className="flex items-center gap-3">
            {/* Table Selector */}
            <div className="flex items-center gap-2">
              <label htmlFor="mock-target-table" className="text-xs text-[#8c919a]">
                Target Table:
              </label>
              <select
                id="mock-target-table"
                value={selectedTable}
                onChange={(e) => setSelectedTable(e.target.value)}
                className="bg-[#24262b] border border-[#35383f] text-[#f1f2f4] text-xs font-mono rounded-md px-2.5 py-1 focus:outline-hidden focus:border-purple-500 cursor-pointer"
              >
                {tables.length > 0 ? (
                  tables.map((t) => (
                    <option key={t.name} value={t.name}>
                      {t.name} ({t.columns.length} cols)
                    </option>
                  ))
                ) : (
                  <option value={selectedTable}>{selectedTable}</option>
                )}
              </select>
            </div>

            {/* Row Count */}
            <div className="flex items-center gap-2">
              <label htmlFor="mock-row-count" className="text-xs text-[#8c919a]">
                Rows:
              </label>
              <input
                id="mock-row-count"
                type="number"
                min={1}
                max={5000}
                value={rowCount}
                onChange={(e) => setRowCount(Math.max(1, Math.min(5000, Number(e.target.value) || 1)))}
                className="w-20 bg-[#24262b] border border-[#35383f] text-[#f1f2f4] text-xs font-mono rounded-md px-2 py-1 focus:outline-hidden focus:border-purple-500 text-center"
              />
            </div>
          </div>

          <div className="flex items-center gap-2 text-xs text-[#8c919a]">
            <span>Dialect:</span>
            <span className="font-mono text-[#a9b1d6] px-2 py-0.5 bg-[#24262b] rounded border border-[#35383f]">
              {dbType}
            </span>
          </div>
        </div>

        {/* Content Body: Split Layout */}
        <div className="flex-1 grid grid-cols-1 md:grid-cols-12 min-h-0 overflow-hidden">
          {/* Left Panel: Column Generators List */}
          <div className="md:col-span-6 border-r border-[#2d3139] flex flex-col h-full bg-[#1e1f22] overflow-hidden">
            <div className="px-4 py-2.5 border-b border-[#2d3139] bg-[#24262b] flex items-center justify-between">
              <span className="text-xs font-semibold text-[#f1f2f4] flex items-center gap-2">
                <Sliders className="w-4 h-4 text-purple-400" />
                Column Generator Rules
              </span>
              <span className="text-[11px] text-[#8c919a]">
                {currentTableSchema?.columns.length ?? 0} columns
              </span>
            </div>

            <div className="flex-1 overflow-y-auto p-4 space-y-3">
              {currentTableSchema?.columns.map((col) => {
                const cfg = configs[col.name] ?? { generatorType: 'LoremSentence' };
                const typeStr = typeof col.data_type === 'string' ? col.data_type : formatCanonicalType(col.data_type);
                const upperType = typeStr.toUpperCase();
                const isNumeric = upperType.includes('INT') || upperType.includes('FLOAT') || upperType.includes('DECIMAL');

                return (
                  <div
                    key={col.name}
                    className="p-3 bg-[#24262b] border border-[#2d3139] rounded-lg space-y-2 hover:border-[#3d424d] transition-colors"
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-semibold text-[#f1f2f4]">{col.name}</span>
                        {col.is_primary_key && (
                          <span className="px-1.5 py-0.5 text-[10px] font-bold bg-amber-500/10 text-amber-400 border border-amber-500/20 rounded">
                            PK
                          </span>
                        )}
                        <span className="text-[10px] text-[#8c919a] font-mono">
                          {typeStr}
                        </span>
                      </div>
                      <span className="text-[10px] text-[#8c919a]">
                        {col.is_nullable ? 'Nullable' : 'NOT NULL'}
                      </span>
                    </div>

                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <label className="block text-[10px] text-[#8c919a] mb-1">Generator</label>
                        <select
                          value={cfg.generatorType}
                          onChange={(e) =>
                            updateColumnConfig(col.name, {
                              generatorType: e.target.value as MockGeneratorType,
                            })
                          }
                          className="w-full bg-[#1a1b1e] border border-[#35383f] text-[#f1f2f4] text-xs rounded px-2 py-1 focus:outline-hidden focus:border-purple-500 cursor-pointer"
                        >
                          {GENERATOR_OPTIONS.map((opt) => (
                            <option key={opt.value} value={opt.value}>
                              {opt.label}
                            </option>
                          ))}
                        </select>
                      </div>

                      {col.is_primary_key && upperType.includes('INT') ? (
                        <div className="flex items-center gap-2 pt-4">
                          <input
                            type="checkbox"
                            id={`autoincrement-${col.name}`}
                            checked={cfg.isAutoIncrement ?? false}
                            onChange={(e) =>
                              updateColumnConfig(col.name, { isAutoIncrement: e.target.checked })
                            }
                            className="rounded border-[#35383f] text-purple-600 focus:ring-purple-500"
                          />
                          <label htmlFor={`autoincrement-${col.name}`} className="text-xs text-[#c3c6cd]">
                            Sequential (1, 2, 3...)
                          </label>
                        </div>
                      ) : cfg.generatorType === 'Constant' ? (
                        <div>
                          <label className="block text-[10px] text-[#8c919a] mb-1">Fixed Value</label>
                          <input
                            type="text"
                            value={cfg.constantValue ?? ''}
                            onChange={(e) => updateColumnConfig(col.name, { constantValue: e.target.value })}
                            className="w-full bg-[#1a1b1e] border border-[#35383f] text-[#f1f2f4] text-xs rounded px-2 py-1 focus:outline-hidden focus:border-purple-500 font-mono"
                          />
                        </div>
                      ) : isNumeric ? (
                        <div className="grid grid-cols-2 gap-1">
                          <div>
                            <label className="block text-[10px] text-[#8c919a] mb-1">Min</label>
                            <input
                              type="number"
                              value={cfg.minValue ?? 0}
                              onChange={(e) => updateColumnConfig(col.name, { minValue: Number(e.target.value) })}
                              className="w-full bg-[#1a1b1e] border border-[#35383f] text-[#f1f2f4] text-xs rounded px-2 py-1 focus:outline-hidden focus:border-purple-500"
                            />
                          </div>
                          <div>
                            <label className="block text-[10px] text-[#8c919a] mb-1">Max</label>
                            <input
                              type="number"
                              value={cfg.maxValue ?? 100}
                              onChange={(e) => updateColumnConfig(col.name, { maxValue: Number(e.target.value) })}
                              className="w-full bg-[#1a1b1e] border border-[#35383f] text-[#f1f2f4] text-xs rounded px-2 py-1 focus:outline-hidden focus:border-purple-500"
                            />
                          </div>
                        </div>
                      ) : null}
                    </div>

                    {col.is_nullable && (
                      <div className="flex items-center justify-between text-xs pt-1">
                        <span className="text-[#8c919a] text-[10px]">NULL Rate: {cfg.nullPercentage ?? 0}%</span>
                        <input
                          type="range"
                          min={0}
                          max={100}
                          step={5}
                          value={cfg.nullPercentage ?? 0}
                          onChange={(e) => updateColumnConfig(col.name, { nullPercentage: Number(e.target.value) })}
                          className="w-32 accent-purple-500"
                        />
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          {/* Right Panel: SQL Output Preview */}
          <div className="md:col-span-6 flex flex-col h-full bg-[#141518] overflow-hidden">
            <div className="px-4 py-2.5 border-b border-[#2d3139] bg-[#24262b] flex items-center justify-between">
              <span className="text-xs font-semibold text-[#f1f2f4] flex items-center gap-2">
                <FileCode className="w-4 h-4 text-blue-400" />
                Generated SQL Preview
              </span>
              <button
                type="button"
                onClick={handleCopy}
                className="flex items-center gap-1.5 px-2 py-1 text-xs font-medium text-[#8c919a] hover:text-[#f1f2f4] hover:bg-[#2d3139] rounded transition-colors cursor-pointer"
                title="Copy SQL to Clipboard"
              >
                {copied ? (
                  <>
                    <Check className="w-3.5 h-3.5 text-emerald-400" />
                    <span className="text-emerald-400">Copied</span>
                  </>
                ) : (
                  <>
                    <Copy className="w-3.5 h-3.5" />
                    <span>Copy</span>
                  </>
                )}
              </button>
            </div>

            <div className="flex-1 overflow-auto p-4 font-mono text-xs text-[#a9b1d6] bg-[#141518] leading-relaxed select-text whitespace-pre">
              {generatedSql || '-- No columns or rows to generate'}
            </div>

            {/* Notification messages */}
            {executionError && (
              <div className="m-4 p-3 bg-red-500/10 border border-red-500/30 rounded-lg flex items-center gap-2 text-xs text-red-400">
                <AlertCircle className="w-4 h-4 shrink-0" />
                <span className="truncate">{executionError}</span>
              </div>
            )}
            {executionSuccess && (
              <div className="m-4 p-3 bg-emerald-500/10 border border-emerald-500/30 rounded-lg flex items-center gap-2 text-xs text-emerald-400">
                <Check className="w-4 h-4 shrink-0" />
                <span>{executionSuccess}</span>
              </div>
            )}
          </div>
        </div>

        {/* Footer Actions */}
        <div className="flex items-center justify-between px-6 py-4 border-t border-[#2d3139] bg-[#24262b]">
          <span className="text-xs text-[#8c919a]">
            Target: <code className="text-[#c3c6cd] font-mono">{selectedTable}</code> ({dbType})
          </span>

          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-xs font-medium text-[#8c919a] hover:text-[#f1f2f4] hover:bg-[#2d3139] rounded-lg transition-colors cursor-pointer"
            >
              Cancel
            </button>

            {(onOpenInWorksheet || onInsertGeneratedSql) && (
              <button
                type="button"
                onClick={handleOpenWorksheet}
                className="flex items-center gap-2 px-4 py-2 text-xs font-medium bg-[#2d3139] hover:bg-[#35383f] text-[#f1f2f4] rounded-lg border border-[#3d424d] transition-colors cursor-pointer"
              >
                <FileCode className="w-4 h-4 text-blue-400" />
                {onInsertGeneratedSql ? 'Insert into Editor' : 'Open in Worksheet'}
              </button>
            )}

            {onExecuteSql && (
              <button
                type="button"
                onClick={handleDirectExecute}
                disabled={isExecuting || !generatedSql}
                className="flex items-center gap-2 px-4 py-2 text-xs font-medium bg-purple-600 hover:bg-purple-500 text-white rounded-lg shadow-sm transition-colors disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
              >
                {isExecuting ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <Play className="w-4 h-4" />
                )}
                <span>Insert Live Rows</span>
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
