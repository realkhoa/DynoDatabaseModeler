/**
 * @file DataImportModal.tsx
 * @brief Interactive Smart Data Import Wizard modal for importing CSV and JSON into database tables.
 * @details Guides user through a 4-step workflow:
 * 1. File Upload / Paste (CSV, JSON, TSV) with auto-detection of delimiters and encoding.
 * 2. Visual Column Mapping with heuristic auto-matching and type compatibility inspection.
 * 3. Data Preview & Conflict Resolution settings (abort, ignore, replace).
 * 4. Batch SQL generation with Monaco syntax preview, copy, worksheet export, and direct execution.
 */

import React, { useState, useEffect, useMemo, useId, useCallback } from 'react';
import MonacoEditor from '@monaco-editor/react';
import {
  X,
  Upload,
  ArrowRight,
  Check,
  Copy,
  Play,
  FileCode,
  Sparkles,
  RefreshCw,
  AlertTriangle,
  ChevronRight,
  ChevronLeft,
} from 'lucide-react';
import type { DatabaseType, TableSchema } from '../../types/database';
import { formatCanonicalType } from '../../types/database';
import type { AppTheme } from '../../types/theme';
import { THEMES } from '../../types/theme';
import { getSavedTheme, onThemeChange } from '../../utils/themeManager';
import {
  parseCsv,
  parseJsonData,
  inferColumnType,
  autoMapColumns,
  generateBatchInsertSql,
  type ColumnMapping,
  type ImportConflictResolution,
  type ParsedImportData,
} from '../../utils/dataImporter';

/**
 * @brief Properties accepted by the DataImportModal component.
 */
export interface DataImportModalProps {
  /** Indicates whether the modal dialog is visibly mounted and open. */
  readonly isOpen: boolean;
  /** Callback triggered to close the modal dialog. */
  readonly onClose: () => void;
  /** Available database tables in the active schema. */
  readonly tables: TableSchema[];
  /** Optional pre-selected table name to import into. */
  readonly initialTable?: string;
  /** Target database engine dialect. */
  readonly dbType?: DatabaseType;
  /** Optional callback to execute generated batch SQL directly via IPC. */
  readonly onExecuteSql?: (sql: string) => Promise<void> | void;
  /** Optional callback to open the generated SQL into an active query worksheet. */
  readonly onOpenInWorksheet?: (sql: string) => void;
}

/**
 * @brief Wizard step index for the multi-step import process.
 */
export type ImportWizardStep = 1 | 2 | 3 | 4;

/**
 * @brief Interactive Data Import Wizard modal for CSV and JSON datasets.
 * @param props Modal configuration options and execution callbacks.
 * @return Rendered modal element or null when closed.
 */
export const DataImportModal: React.FC<DataImportModalProps> = ({
  isOpen,
  onClose,
  tables,
  initialTable,
  dbType = 'Postgres',
  onExecuteSql,
  onOpenInWorksheet,
}) => {
  const [currentStep, setCurrentStep] = useState<ImportWizardStep>(1);
  const [rawText, setRawText] = useState<string>('');
  const [fileFormat, setFileFormat] = useState<'auto' | 'csv' | 'json'>('auto');
  const [customDelimiter, setCustomDelimiter] = useState<string>('');
  const [selectedTableName, setSelectedTableName] = useState<string>(
    initialTable || (tables[0]?.name ?? '')
  );
  const [columnMapping, setColumnMapping] = useState<ColumnMapping>({});
  const [conflictStrategy, setConflictStrategy] = useState<ImportConflictResolution>('ignore');
  const [chunkSize, setChunkSize] = useState<number>(200);
  const [isExecuting, setIsExecuting] = useState<boolean>(false);
  const [executionError, setExecutionError] = useState<string | null>(null);
  const [copied, setCopied] = useState<boolean>(false);
  const [activeTheme, setActiveTheme] = useState<AppTheme>(getSavedTheme());

  const modalTitleId = useId();

  // Synchronize Monaco theme with global theme changes
  useEffect(() => {
    return onThemeChange((theme) => setActiveTheme(theme));
  }, []);

  // Sync initial table when changed or opened
  useEffect(() => {
    if (initialTable) {
      setSelectedTableName(initialTable);
    } else if (tables.length > 0 && !selectedTableName) {
      setSelectedTableName(tables[0].name);
    }
  }, [initialTable, tables, selectedTableName]);

  // Handle ESC key to dismiss modal
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen) {
        onClose();
      }
    };
    if (isOpen) {
      window.addEventListener('keydown', handleKeyDown);
      return () => window.removeEventListener('keydown', handleKeyDown);
    }
  }, [isOpen, onClose]);

  // Target table schema object
  const targetTable = useMemo(() => {
    return tables.find((t) => t.name === selectedTableName) || null;
  }, [tables, selectedTableName]);

  // Parse raw text into structured data
  const parsedData = useMemo<ParsedImportData | null>(() => {
    const trimmed = rawText.trim();
    if (!trimmed) return null;

    try {
      if (fileFormat === 'json' || (fileFormat === 'auto' && trimmed.startsWith('['))) {
        return parseJsonData(trimmed);
      } else {
        return parseCsv(trimmed, customDelimiter || undefined);
      }
    } catch {
      return null;
    }
  }, [rawText, fileFormat, customDelimiter]);

  // Infer types for each parsed column
  const inferredTypes = useMemo(() => {
    if (!parsedData || parsedData.rows.length === 0) return {};
    const result: Record<string, string> = {};
    parsedData.headers.forEach((h, idx) => {
      const colValues = parsedData.rows.slice(0, 50).map((r) => r[idx]);
      const canonical = inferColumnType(colValues);
      result[h] = formatCanonicalType(canonical);
    });
    return result;
  }, [parsedData]);

  // Auto-map columns when parsed data or target table changes
  useEffect(() => {
    if (parsedData && targetTable) {
      const auto = autoMapColumns(parsedData.headers, targetTable.columns);
      setColumnMapping(auto);
    } else {
      setColumnMapping({});
    }
  }, [parsedData, targetTable]);

  // Generate batch SQL script
  const generatedSql = useMemo(() => {
    if (!parsedData || !targetTable || parsedData.rows.length === 0) {
      return '-- Please select a valid data source and target table';
    }

    return generateBatchInsertSql({
      tableName: targetTable.name,
      columnMapping,
      headers: parsedData.headers,
      rows: parsedData.rows,
      dbType,
      onConflict: conflictStrategy,
      chunkSize,
    });
  }, [parsedData, targetTable, columnMapping, dbType, conflictStrategy, chunkSize]);

  /**
   * @brief Handles file upload via input element.
   * @param e File change event.
   */
  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      const content = event.target?.result;
      if (typeof content === 'string') {
        setRawText(content);
        if (file.name.endsWith('.json')) {
          setFileFormat('json');
        } else {
          setFileFormat('csv');
        }
      }
    };
    reader.readAsText(file);
  };

  /**
   * @brief Copies generated SQL to clipboard with visual feedback.
   */
  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(generatedSql);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err: unknown) {
      console.error('Failed to copy SQL:', err);
    }
  }, [generatedSql]);

  /**
   * @brief Executes generated batch SQL directly via IPC.
   */
  const handleExecute = async () => {
    if (!onExecuteSql) return;
    setIsExecuting(true);
    setExecutionError(null);
    try {
      await onExecuteSql(generatedSql);
      onClose();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setExecutionError(msg);
    } finally {
      setIsExecuting(false);
    }
  };

  /**
   * @brief Loads sample CSV data for rapid testing.
   */
  const handleLoadSample = () => {
    if (!targetTable || targetTable.columns.length === 0) {
      setRawText('id,name,email\n1,Alice,alice@example.com\n2,Bob,bob@example.com\n3,Charlie,charlie@example.com');
      return;
    }

    const sampleHeaders = targetTable.columns.slice(0, 4).map((c) => c.name);
    const sampleRow1 = targetTable.columns.slice(0, 4).map((c, i) => (c.is_primary_key ? '1' : `val_${i + 1}`));
    const sampleRow2 = targetTable.columns.slice(0, 4).map((c, i) => (c.is_primary_key ? '2' : `val_${i + 2}`));
    setRawText([sampleHeaders.join(','), sampleRow1.join(','), sampleRow2.join(',')].join('\n'));
    setFileFormat('csv');
  };

  if (!isOpen) return null;

  const currentTheme = THEMES[activeTheme];
  const monacoTheme = currentTheme?.monacoTheme || 'vs-dark';

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby={modalTitleId}
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-in fade-in duration-150"
    >
      <div className="bg-[#1e1f22] border border-[#35373c] rounded-xl shadow-2xl w-full max-w-4xl max-h-[90vh] flex flex-col overflow-hidden text-[#e6e8ea]">
        {/* Header */}
        <div className="px-6 py-4 border-b border-[#35373c] flex items-center justify-between bg-[#24262b]">
          <div className="flex items-center space-x-3">
            <div className="p-2 bg-[#20c997]/10 text-[#20c997] rounded-lg border border-[#20c997]/20">
              <Upload className="w-5 h-5" />
            </div>
            <div>
              <h2 id={modalTitleId} className="text-base font-semibold text-[#e6e8ea] flex items-center gap-2">
                <span>Smart Data Import Wizard</span>
                <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-[#35373c] text-[#8c919a]">
                  Step {currentStep} of 4
                </span>
              </h2>
              <p className="text-xs text-[#8c919a]">
                Import CSV or JSON data with automatic schema mapping and conflict-safe batch inserts.
              </p>
            </div>
          </div>
          <button
            type="button"
            data-testid="import-modal-close-btn"
            onClick={onClose}
            aria-label="Close import wizard"
            className="text-[#8c919a] hover:text-[#e6e8ea] hover:bg-[#35373c] p-1.5 rounded-lg transition-colors cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Stepper Navigation Pills */}
        <div className="px-6 py-2.5 bg-[#18191c] border-b border-[#35373c] flex items-center justify-between text-xs">
          <div className="flex items-center space-x-2">
            {[
              { step: 1, label: '1. Source Data' },
              { step: 2, label: '2. Column Mapping' },
              { step: 3, label: '3. Preview & Options' },
              { step: 4, label: '4. Batch SQL' },
            ].map((s) => (
              <button
                key={s.step}
                type="button"
                data-testid={`import-step-${s.step}`}
                onClick={() => setCurrentStep(s.step as ImportWizardStep)}
                className={`px-3 py-1 rounded-md font-medium transition-colors cursor-pointer ${
                  currentStep === s.step
                    ? 'bg-[#20c997] text-white shadow-sm'
                    : currentStep > s.step
                    ? 'bg-[#20c997]/15 text-[#20c997] hover:bg-[#20c997]/25'
                    : 'text-[#8c919a] hover:bg-[#26282d] hover:text-[#e6e8ea]'
                }`}
              >
                {s.label}
              </button>
            ))}
          </div>

          {parsedData && (
            <div className="text-[11px] text-[#8c919a] font-mono">
              {parsedData.totalRows} rows / {parsedData.headers.length} columns detected
            </div>
          )}
        </div>

        {/* Modal Body */}
        <div className="flex-1 overflow-y-auto p-6 space-y-4">
          {/* STEP 1: Source Data */}
          {currentStep === 1 && (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center space-x-2">
                  <label className="text-xs font-semibold text-[#c4c7cc]">Input Format:</label>
                  <select
                    data-testid="import-format-select"
                    value={fileFormat}
                    onChange={(e) => setFileFormat(e.target.value as 'auto' | 'csv' | 'json')}
                    className="bg-[#24262b] border border-[#35373c] text-xs text-[#e6e8ea] rounded px-2.5 py-1 focus:outline-none focus:border-[#20c997]"
                  >
                    <option value="auto">Auto Detect</option>
                    <option value="csv">CSV / Delimited</option>
                    <option value="json">JSON Array</option>
                  </select>

                  {fileFormat === 'csv' && (
                    <input
                      type="text"
                      placeholder="Delimiter (auto)"
                      value={customDelimiter}
                      onChange={(e) => setCustomDelimiter(e.target.value)}
                      className="bg-[#24262b] border border-[#35373c] text-xs text-[#e6e8ea] rounded px-2 py-1 w-28 focus:outline-none focus:border-[#20c997]"
                    />
                  )}
                </div>

                <div className="flex items-center space-x-2">
                  <button
                    type="button"
                    onClick={handleLoadSample}
                    className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded bg-[#2b2d30] hover:bg-[#35373c] text-[#c4c7cc] hover:text-white text-xs transition-colors cursor-pointer"
                  >
                    <Sparkles className="w-3.5 h-3.5 text-amber-400" />
                    <span>Load Sample Data</span>
                  </button>

                  <label className="inline-flex items-center gap-1.5 px-3 py-1 rounded bg-[#20c997] hover:bg-[#1bb587] text-white text-xs font-medium cursor-pointer shadow transition-colors">
                    <Upload className="w-3.5 h-3.5" />
                    <span>Upload File</span>
                    <input
                      type="file"
                      data-testid="import-file-input"
                      accept=".csv,.json,.tsv,.txt"
                      onChange={handleFileUpload}
                      className="hidden"
                    />
                  </label>
                </div>
              </div>

              {/* Raw Text Input */}
              <div className="space-y-1.5">
                <div className="flex items-center justify-between text-xs text-[#8c919a]">
                  <span>Paste raw CSV or JSON data here:</span>
                  <span>{rawText.length} characters</span>
                </div>
                <textarea
                  data-testid="import-raw-input"
                  rows={14}
                  value={rawText}
                  onChange={(e) => setRawText(e.target.value)}
                  placeholder="Paste CSV text (e.g. id,name,email) or JSON array [ { &quot;id&quot;: 1, ... } ]"
                  className="w-full bg-[#18191c] border border-[#35373c] rounded-lg p-3 font-mono text-xs text-[#e6e8ea] placeholder-[#8c919a] focus:outline-none focus:border-[#20c997] transition-colors resize-none"
                />
              </div>
            </div>
          )}

          {/* STEP 2: Column Mapping */}
          {currentStep === 2 && (
            <div className="space-y-4">
              {/* Target Table Selector */}
              <div className="flex items-center justify-between bg-[#24262b] p-3 rounded-lg border border-[#35373c]">
                <div className="flex items-center space-x-3">
                  <span className="text-xs font-semibold text-[#c4c7cc]">Target Table:</span>
                  <select
                    data-testid="import-target-table-select"
                    value={selectedTableName}
                    onChange={(e) => setSelectedTableName(e.target.value)}
                    className="bg-[#1e1f22] border border-[#35373c] text-xs text-[#e6e8ea] rounded px-3 py-1.5 font-medium focus:outline-none focus:border-[#20c997]"
                  >
                    {tables.map((t) => (
                      <option key={t.name} value={t.name}>
                        {t.name} ({t.columns.length} columns)
                      </option>
                    ))}
                  </select>
                </div>

                {targetTable && (
                  <div className="text-xs text-[#8c919a]">
                    Target has <strong className="text-[#e6e8ea]">{targetTable.columns.length}</strong> columns (
                    {targetTable.columns.filter((c) => c.is_primary_key).map((c) => c.name).join(', ') || 'No PK'}
                    )
                  </div>
                )}
              </div>

              {/* Column Mapping Table */}
              {!parsedData || parsedData.headers.length === 0 ? (
                <div className="p-8 text-center text-[#8c919a] bg-[#18191c] rounded-lg border border-[#35373c]">
                  Please enter or upload data in Step 1 first.
                </div>
              ) : (
                <div className="border border-[#35373c] rounded-lg overflow-hidden">
                  <table className="w-full text-xs text-left">
                    <thead className="bg-[#24262b] text-[#8c919a] uppercase font-semibold border-b border-[#35373c]">
                      <tr>
                        <th className="px-4 py-2.5">Source Header</th>
                        <th className="px-4 py-2.5">Inferred Type</th>
                        <th className="px-4 py-2.5 text-center">Map</th>
                        <th className="px-4 py-2.5">Target Column</th>
                        <th className="px-4 py-2.5">Target Type &amp; Key</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[#2a2c30] bg-[#18191c]">
                      {parsedData.headers.map((header) => {
                        const targetColName = columnMapping[header];
                        const targetCol = targetTable?.columns.find((c) => c.name === targetColName);
                        return (
                          <tr key={header} className="hover:bg-[#222428] transition-colors">
                            <td className="px-4 py-2.5 font-mono font-medium text-[#e6e8ea]">
                              {header}
                            </td>
                            <td className="px-4 py-2.5 text-[#8c919a]">
                              <span className="px-1.5 py-0.5 rounded bg-[#2b2d30] text-[10px] font-mono">
                                {inferredTypes[header] || 'Unknown'}
                              </span>
                            </td>
                            <td className="px-4 py-2.5 text-center text-[#8c919a]">
                              <ArrowRight className="w-3.5 h-3.5 mx-auto" />
                            </td>
                            <td className="px-4 py-2.5">
                              <select
                                data-testid={`map-select-${header}`}
                                value={targetColName || ''}
                                onChange={(e) => {
                                  const val = e.target.value;
                                  setColumnMapping((prev) => ({
                                    ...prev,
                                    [header]: val === '' ? null : val,
                                  }));
                                }}
                                className={`w-full text-xs rounded px-2.5 py-1 border transition-colors focus:outline-none ${
                                  targetColName
                                    ? 'bg-[#1e1f22] border-[#20c997]/40 text-[#20c997] font-medium'
                                    : 'bg-[#1e1f22] border-[#35373c] text-[#8c919a]'
                                }`}
                              >
                                <option value="">[Do Not Import / Skip]</option>
                                {targetTable?.columns.map((c) => (
                                  <option key={c.name} value={c.name}>
                                    {c.name} ({formatCanonicalType(c.data_type)})
                                  </option>
                                ))}
                              </select>
                            </td>
                            <td className="px-4 py-2.5 text-[#8c919a]">
                              {targetCol ? (
                                <div className="flex items-center space-x-1.5">
                                  <span className="font-mono text-[11px] text-[#c4c7cc]">
                                    {formatCanonicalType(targetCol.data_type)}
                                  </span>
                                  {targetCol.is_primary_key && (
                                    <span className="px-1 py-0.2 rounded bg-amber-500/20 text-amber-300 text-[10px] font-bold">
                                      PK
                                    </span>
                                  )}
                                  {!targetCol.is_nullable && (
                                    <span className="text-[10px] text-red-400 font-semibold">NOT NULL</span>
                                  )}
                                </div>
                              ) : (
                                <span className="text-[11px] text-[#8c919a] italic">Skipped</span>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}

          {/* STEP 3: Preview & Options */}
          {currentStep === 3 && (
            <div className="space-y-4">
              {/* Conflict & Batch Options */}
              <div className="grid grid-cols-2 gap-4 bg-[#24262b] p-4 rounded-lg border border-[#35373c]">
                <div>
                  <label className="block text-xs font-semibold text-[#c4c7cc] mb-1.5">
                    Duplicate / Conflict Resolution:
                  </label>
                  <select
                    data-testid="import-conflict-select"
                    value={conflictStrategy}
                    onChange={(e) => setConflictStrategy(e.target.value as ImportConflictResolution)}
                    className="w-full bg-[#1e1f22] border border-[#35373c] text-xs text-[#e6e8ea] rounded px-3 py-1.5 focus:outline-none focus:border-[#20c997]"
                  >
                    <option value="ignore">Skip Duplicates (ON CONFLICT DO NOTHING / INSERT IGNORE)</option>
                    <option value="replace">Overwrite Existing (REPLACE INTO / INSERT OR REPLACE)</option>
                    <option value="abort">Fail on Conflict (Standard INSERT)</option>
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-[#c4c7cc] mb-1.5">
                    Batch Chunk Size (rows per INSERT):
                  </label>
                  <input
                    type="number"
                    min={1}
                    max={2000}
                    value={chunkSize}
                    onChange={(e) => setChunkSize(Math.max(1, parseInt(e.target.value, 10) || 100))}
                    className="w-full bg-[#1e1f22] border border-[#35373c] text-xs text-[#e6e8ea] rounded px-3 py-1.5 focus:outline-none focus:border-[#20c997]"
                  />
                </div>
              </div>

              {/* Data Preview Table */}
              <div className="space-y-1.5">
                <div className="flex items-center justify-between text-xs text-[#8c919a]">
                  <span>Previewing first {Math.min(10, parsedData?.rows.length || 0)} mapped rows:</span>
                  <span>Target: <strong className="text-[#e6e8ea]">{targetTable?.name}</strong></span>
                </div>

                {!parsedData || parsedData.rows.length === 0 ? (
                  <div className="p-8 text-center text-[#8c919a] bg-[#18191c] rounded-lg border border-[#35373c]">
                    No rows to preview.
                  </div>
                ) : (
                  <div className="border border-[#35373c] rounded-lg overflow-x-auto">
                    <table className="w-full text-xs text-left font-mono">
                      <thead className="bg-[#24262b] text-[#8c919a] uppercase border-b border-[#35373c]">
                        <tr>
                          {parsedData.headers
                            .filter((h) => columnMapping[h])
                            .map((h) => (
                              <th key={h} className="px-3 py-2">
                                <div className="text-[#20c997] font-semibold">{columnMapping[h]}</div>
                                <div className="text-[10px] text-[#8c919a] lowercase">from {h}</div>
                              </th>
                            ))}
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-[#2a2c30] bg-[#18191c]">
                        {parsedData.rows.slice(0, 10).map((row, rIdx) => (
                          <tr key={rIdx} className="hover:bg-[#222428] transition-colors">
                            {parsedData.headers
                              .map((h, cIdx) => ({ h, val: row[cIdx] }))
                              .filter((item) => columnMapping[item.h])
                              .map((item, colIdx) => (
                                <td key={colIdx} className="px-3 py-1.5 truncate max-w-xs text-[#e6e8ea]">
                                  {String(item.val ?? 'NULL')}
                                </td>
                              ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* STEP 4: Batch SQL Preview & Execution */}
          {currentStep === 4 && (
            <div className="space-y-4">
              {executionError && (
                <div className="p-3 bg-red-950/40 border border-red-500/40 text-red-200 rounded-lg text-xs flex items-center gap-2">
                  <AlertTriangle className="w-4 h-4 text-red-400 shrink-0" />
                  <span>{executionError}</span>
                </div>
              )}

              <div className="flex items-center justify-between">
                <span className="text-xs text-[#8c919a]">
                  Generated executable SQL script for <strong className="text-[#e6e8ea]">{dbType}</strong>:
                </span>
                <div className="flex items-center space-x-2">
                  <button
                    type="button"
                    data-testid="import-copy-sql-btn"
                    onClick={handleCopy}
                    className="inline-flex items-center gap-1.5 px-3 py-1 rounded bg-[#2b2d30] hover:bg-[#35373c] text-xs text-[#e6e8ea] transition-colors cursor-pointer"
                  >
                    {copied ? <Check className="w-3.5 h-3.5 text-[#20c997]" /> : <Copy className="w-3.5 h-3.5" />}
                    <span>{copied ? 'Copied!' : 'Copy SQL'}</span>
                  </button>

                  {onOpenInWorksheet && (
                    <button
                      type="button"
                      data-testid="import-worksheet-btn"
                      onClick={() => {
                        onOpenInWorksheet(generatedSql);
                        onClose();
                      }}
                      className="inline-flex items-center gap-1.5 px-3 py-1 rounded bg-[#2b2d30] hover:bg-[#35373c] text-xs text-[#3a82f7] transition-colors cursor-pointer"
                    >
                      <FileCode className="w-3.5 h-3.5" />
                      <span>Open in Worksheet</span>
                    </button>
                  )}
                </div>
              </div>

              {/* Monaco Editor SQL Preview */}
              <div
                data-testid="import-monaco-wrapper"
                className="h-80 border border-[#35373c] rounded-lg overflow-hidden bg-[#18191c]"
              >
                <MonacoEditor
                  height="100%"
                  language="sql"
                  theme={monacoTheme}
                  value={generatedSql}
                  options={{
                    readOnly: true,
                    minimap: { enabled: false },
                    fontSize: 12,
                    lineNumbers: 'on',
                    scrollBeyondLastLine: false,
                    wordWrap: 'on',
                    automaticLayout: true,
                  }}
                />
              </div>
            </div>
          )}
        </div>

        {/* Modal Footer Controls */}
        <div className="px-6 py-3.5 border-t border-[#35373c] bg-[#18191c] flex items-center justify-between">
          <div>
            {currentStep > 1 && (
              <button
                type="button"
                data-testid="import-prev-btn"
                onClick={() => setCurrentStep((prev) => (prev - 1) as ImportWizardStep)}
                className="inline-flex items-center gap-1 px-3 py-1.5 bg-[#2b2d30] hover:bg-[#35373c] text-[#c4c7cc] hover:text-white text-xs rounded transition-colors cursor-pointer"
              >
                <ChevronLeft className="w-3.5 h-3.5" />
                <span>Previous</span>
              </button>
            )}
          </div>

          <div className="flex items-center space-x-2">
            <button
              type="button"
              onClick={onClose}
              className="px-3 py-1.5 bg-[#2b2d30] hover:bg-[#35373c] text-[#c4c7cc] text-xs rounded transition-colors cursor-pointer"
            >
              Cancel
            </button>

            {currentStep < 4 ? (
              <button
                type="button"
                data-testid="import-next-btn"
                onClick={() => setCurrentStep((prev) => (prev + 1) as ImportWizardStep)}
                disabled={!parsedData || parsedData.headers.length === 0}
                className="inline-flex items-center gap-1.5 px-4 py-1.5 bg-[#20c997] hover:bg-[#1bb587] disabled:opacity-40 disabled:pointer-events-none text-white text-xs font-semibold rounded shadow transition-colors cursor-pointer"
              >
                <span>Next</span>
                <ChevronRight className="w-3.5 h-3.5" />
              </button>
            ) : (
              onExecuteSql && (
                <button
                  type="button"
                  data-testid="import-execute-btn"
                  onClick={handleExecute}
                  disabled={isExecuting}
                  className="inline-flex items-center gap-1.5 px-4 py-1.5 bg-[#3a82f7] hover:bg-[#2f6fd6] disabled:opacity-50 text-white text-xs font-semibold rounded shadow transition-colors cursor-pointer"
                >
                  {isExecuting ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Play className="w-3.5 h-3.5" />}
                  <span>{isExecuting ? 'Executing Import...' : 'Execute Import'}</span>
                </button>
              )
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
