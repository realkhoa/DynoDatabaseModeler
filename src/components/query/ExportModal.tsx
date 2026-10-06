/**
 * @file ExportModal.tsx
 * @brief Modal wizard for multi-format tabular dataset export and data transfer.
 * @details Supports CSV (custom delimiter and quote options), JSON (formatted array of objects),
 * Markdown (GitHub-flavored tables), and SQL INSERT statements. Provides real-time preview,
 * clipboard copy with feedback, and direct file download.
 */

import React, { useState, useEffect, useMemo, useCallback } from 'react';
import {
  X,
  Copy,
  Check,
  Download,
  FileSpreadsheet,
  FileJson,
  FileCode,
  Database,
} from 'lucide-react';
import {
  ExportFormat,
  exportAsCsv,
  exportAsJson,
  exportAsMarkdown,
  exportAsSqlInserts,
  downloadExportFile,
} from '../../utils/dataTransfer';

/**
 * @brief Properties accepted by the ExportModal component.
 */
export interface ExportModalProps {
  /** @brief Whether the export wizard dialog is visible. */
  isOpen: boolean;
  /** @brief Suggested target table name derived from current query context. */
  tableName?: string;
  /** @brief Ordered array of column names. */
  columns: string[];
  /** @brief 2D array of tabular dataset rows. */
  rows: any[][];
  /** @brief Callback triggered when the modal is requested to close. */
  onClose: () => void;
}

/**
 * @brief Interactive data transfer and export wizard modal dialog.
 * @param props Component properties.
 * @return Rendered modal dialog element or null if not open.
 */
export const ExportModal: React.FC<ExportModalProps> = ({
  isOpen,
  tableName = 'exported_table',
  columns,
  rows,
  onClose,
}) => {
  const [format, setFormat] = useState<ExportFormat>('csv');
  const [delimiter, setDelimiter] = useState<string>(',');
  const [quoteAll, setQuoteAll] = useState<boolean>(false);
  const [customTableName, setCustomTableName] = useState<string>(tableName);
  const [copied, setCopied] = useState<boolean>(false);

  // Sync initial table name when prop updates or modal opens
  useEffect(() => {
    if (tableName) {
      setCustomTableName(tableName);
    }
  }, [tableName, isOpen]);

  // Handle Escape key to dismiss modal
  useEffect(() => {
    if (!isOpen) return;

    /**
     * @brief Keydown event listener for Escape key dismissal.
     * @param e Keyboard event.
     */
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  // Preview dataset limited to first 50 rows for performance
  const previewRows = useMemo(() => rows.slice(0, 50), [rows]);

  /**
   * @brief Generates real-time formatted preview text based on selected options.
   */
  const previewContent = useMemo(() => {
    switch (format) {
      case 'csv':
        return exportAsCsv(columns, previewRows, { delimiter, quoteAll });
      case 'json':
        return exportAsJson(columns, previewRows, true);
      case 'markdown':
        return exportAsMarkdown(columns, previewRows);
      case 'sql':
        return exportAsSqlInserts(columns, previewRows, {
          tableName: customTableName.trim() || 'exported_table',
        });
    }
  }, [columns, previewRows, format, delimiter, quoteAll, customTableName]);

  /**
   * @brief Generates the full formatted dataset for clipboard and download actions.
   */
  const fullContent = useMemo(() => {
    switch (format) {
      case 'csv':
        return exportAsCsv(columns, rows, { delimiter, quoteAll });
      case 'json':
        return exportAsJson(columns, rows, true);
      case 'markdown':
        return exportAsMarkdown(columns, rows);
      case 'sql':
        return exportAsSqlInserts(columns, rows, {
          tableName: customTableName.trim() || 'exported_table',
        });
    }
  }, [columns, rows, format, delimiter, quoteAll, customTableName]);

  /**
   * @brief Copies full formatted export content to clipboard and shows brief feedback.
   */
  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(fullContent);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error('Failed to copy to clipboard', err);
    }
  }, [fullContent]);

  /**
   * @brief Triggers browser file download with appropriate filename and MIME type.
   */
  const handleDownload = useCallback(() => {
    const baseName = customTableName.trim() || 'exported_data';
    let filename = `${baseName}.csv`;
    let mimeType = 'text/csv;charset=utf-8;';

    switch (format) {
      case 'csv':
        filename = `${baseName}.csv`;
        mimeType = 'text/csv;charset=utf-8;';
        break;
      case 'json':
        filename = `${baseName}.json`;
        mimeType = 'application/json;charset=utf-8;';
        break;
      case 'markdown':
        filename = `${baseName}.md`;
        mimeType = 'text/markdown;charset=utf-8;';
        break;
      case 'sql':
        filename = `${baseName}.sql`;
        mimeType = 'application/sql;charset=utf-8;';
        break;
    }

    downloadExportFile(fullContent, filename, mimeType);
  }, [customTableName, format, fullContent]);

  if (!isOpen) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Export Data Wizard"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-xs p-4 animate-in fade-in duration-150"
    >
      <div className="w-full max-w-3xl bg-[#1e1f22] border border-[#35373c] rounded-xl shadow-2xl flex flex-col max-h-[90vh] overflow-hidden text-xs text-[#e6e8ea]">
        {/* Header */}
        <div className="h-12 px-5 bg-[#26282d] border-b border-[#35373c] flex items-center justify-between shrink-0">
          <div className="flex items-center space-x-2.5">
            <Download className="w-4 h-4 text-[#3a82f7]" />
            <h2 className="text-sm font-semibold text-[#e6e8ea]">
              Export Data Wizard
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close modal"
            className="p-1 text-[#8c919a] hover:text-[#e6e8ea] hover:bg-[#35373c] rounded transition-colors cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Format Selector Tabs */}
        <div className="px-5 py-2.5 bg-[#212328] border-b border-[#35373c] flex items-center justify-between shrink-0">
          <div role="tablist" className="flex items-center space-x-1.5">
            <button
              type="button"
              role="tab"
              aria-selected={format === 'csv'}
              onClick={() => setFormat('csv')}
              className={`flex items-center space-x-1.5 px-3 py-1.5 rounded font-medium transition-colors cursor-pointer ${
                format === 'csv'
                  ? 'bg-[#3a82f7] text-white shadow-xs'
                  : 'bg-[#2c2e33] text-[#8c919a] hover:text-[#e6e8ea] hover:bg-[#35373c]'
              }`}
            >
              <FileSpreadsheet className="w-3.5 h-3.5" />
              <span>CSV</span>
            </button>

            <button
              type="button"
              role="tab"
              aria-selected={format === 'json'}
              onClick={() => setFormat('json')}
              className={`flex items-center space-x-1.5 px-3 py-1.5 rounded font-medium transition-colors cursor-pointer ${
                format === 'json'
                  ? 'bg-[#3a82f7] text-white shadow-xs'
                  : 'bg-[#2c2e33] text-[#8c919a] hover:text-[#e6e8ea] hover:bg-[#35373c]'
              }`}
            >
              <FileJson className="w-3.5 h-3.5" />
              <span>JSON</span>
            </button>

            <button
              type="button"
              role="tab"
              aria-selected={format === 'markdown'}
              onClick={() => setFormat('markdown')}
              className={`flex items-center space-x-1.5 px-3 py-1.5 rounded font-medium transition-colors cursor-pointer ${
                format === 'markdown'
                  ? 'bg-[#3a82f7] text-white shadow-xs'
                  : 'bg-[#2c2e33] text-[#8c919a] hover:text-[#e6e8ea] hover:bg-[#35373c]'
              }`}
            >
              <FileCode className="w-3.5 h-3.5" />
              <span>Markdown</span>
            </button>

            <button
              type="button"
              role="tab"
              aria-selected={format === 'sql'}
              onClick={() => setFormat('sql')}
              className={`flex items-center space-x-1.5 px-3 py-1.5 rounded font-medium transition-colors cursor-pointer ${
                format === 'sql'
                  ? 'bg-[#3a82f7] text-white shadow-xs'
                  : 'bg-[#2c2e33] text-[#8c919a] hover:text-[#e6e8ea] hover:bg-[#35373c]'
              }`}
            >
              <Database className="w-3.5 h-3.5" />
              <span>SQL</span>
            </button>
          </div>

          <div className="text-[11px] font-mono text-[#8c919a]">
            {rows.length > 50
              ? `Showing first 50 of ${rows.length} rows`
              : `Showing all ${rows.length} rows`}
          </div>
        </div>

        {/* Format Specific Options */}
        <div className="px-5 py-3 bg-[#1b1c20] border-b border-[#35373c] flex items-center flex-wrap gap-4 shrink-0">
          {format === 'csv' && (
            <>
              <div className="flex items-center space-x-2">
                <label htmlFor="csv-delimiter" className="text-[#8c919a]">
                  Delimiter:
                </label>
                <select
                  id="csv-delimiter"
                  aria-label="Delimiter"
                  value={delimiter}
                  onChange={(e) => setDelimiter(e.target.value)}
                  className="bg-[#26282d] border border-[#35373c] text-[#e6e8ea] rounded px-2 py-1 font-mono focus:outline-hidden focus:border-[#3a82f7]"
                >
                  <option value=",">Comma (,)</option>
                  <option value=";">Semicolon (;)</option>
                  <option value="&#9;">Tab (\t)</option>
                </select>
              </div>

              <div className="flex items-center space-x-2">
                <input
                  type="checkbox"
                  id="csv-quote-all"
                  aria-label="Quote all fields"
                  checked={quoteAll}
                  onChange={(e) => setQuoteAll(e.target.checked)}
                  className="rounded border-[#35373c] bg-[#26282d] text-[#3a82f7] focus:ring-0 focus:ring-offset-0 cursor-pointer"
                />
                <label
                  htmlFor="csv-quote-all"
                  className="text-[#8c919a] cursor-pointer"
                >
                  Quote all fields
                </label>
              </div>
            </>
          )}

          {format === 'sql' && (
            <div className="flex items-center space-x-2">
              <label htmlFor="sql-table-name" className="text-[#8c919a]">
                Table Name:
              </label>
              <input
                type="text"
                id="sql-table-name"
                aria-label="Table Name"
                value={customTableName}
                onChange={(e) => setCustomTableName(e.target.value)}
                placeholder="table_name"
                className="bg-[#26282d] border border-[#35373c] text-[#e6e8ea] rounded px-2.5 py-1 font-mono focus:outline-hidden focus:border-[#3a82f7] w-48"
              />
            </div>
          )}

          {format === 'json' && (
            <span className="text-[#8c919a] italic">
              Standard JSON array of objects with 2-space indentation.
            </span>
          )}

          {format === 'markdown' && (
            <span className="text-[#8c919a] italic">
              GitHub-flavored Markdown table with pipe escaping and line break preservation.
            </span>
          )}
        </div>

        {/* Real-time Preview Area */}
        <div className="flex-1 min-h-[220px] max-h-[380px] p-4 bg-[#141517] overflow-auto">
          <pre
            data-testid="export-preview"
            className="font-mono text-[11px] leading-relaxed text-[#dcdfe4] whitespace-pre selection:bg-[#3a82f7]/30"
          >
            {previewContent}
          </pre>
        </div>

        {/* Footer Actions */}
        <div className="px-5 py-3 bg-[#26282d] border-t border-[#35373c] flex items-center justify-between shrink-0">
          <div className="flex items-center space-x-2">
            <button
              type="button"
              onClick={handleCopy}
              className="flex items-center space-x-1.5 px-3 py-1.5 bg-[#2c2e33] hover:bg-[#35373c] text-[#e6e8ea] rounded font-semibold transition-colors cursor-pointer"
            >
              {copied ? (
                <Check className="w-3.5 h-3.5 text-emerald-400" />
              ) : (
                <Copy className="w-3.5 h-3.5 text-[#8c919a]" />
              )}
              <span>{copied ? 'Copied!' : 'Copy to Clipboard'}</span>
            </button>

            <button
              type="button"
              onClick={handleDownload}
              className="flex items-center space-x-1.5 px-3.5 py-1.5 bg-[#3a82f7] hover:bg-[#2b6fd6] text-white rounded font-semibold transition-colors shadow-xs cursor-pointer"
            >
              <Download className="w-3.5 h-3.5" />
              <span>Download File</span>
            </button>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="px-4 py-1.5 bg-[#2c2e33] hover:bg-[#35373c] text-[#8c919a] hover:text-[#e6e8ea] rounded font-semibold transition-colors cursor-pointer"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
};
