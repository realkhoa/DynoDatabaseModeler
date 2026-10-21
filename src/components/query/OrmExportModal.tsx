/**
 * @file OrmExportModal.tsx
 * @brief Modal dialog for generating and exporting multi-language ORM & Entity models.
 * @details Synthesizes production-ready schemas and models for Prisma, Drizzle, GORM,
 * SeaORM, EF Core, SQLAlchemy, and TypeORM with live Monaco editor preview and downloads.
 */

import React, { useId, useMemo, useState } from 'react';
import Editor from '@monaco-editor/react';
import {
  Check,
  Code2,
  Copy,
  Download,
  FileCode,
  Layers,
  X,
} from 'lucide-react';
import type { TableSchema } from '../../types/database';
import type { AppTheme } from '../../types/theme';
import { THEMES } from '../../types/theme';
import type { OrmTarget } from '../../utils/ormExporter';
import { generateOrmCode, ORM_TARGETS } from '../../utils/ormExporter';
import { getSavedTheme, onThemeChange } from '../../utils/themeManager';

/**
 * @brief Props for the OrmExportModal component.
 */
export interface OrmExportModalProps {
  /** Whether the modal is visibly mounted and open. */
  readonly isOpen: boolean;
  /** Callback invoked to close the modal dialog. */
  readonly onClose: () => void;
  /** Available introspected or modeled table schemas. */
  readonly tables: TableSchema[];
  /** Optional pre-selected table name to filter initially. */
  readonly initialSelectedTable?: string;
  /** Optional alias for initialSelectedTable. */
  readonly selectedTable?: string;
}

/**
 * @brief Interactive modal dialog for previewing and downloading generated ORM code.
 * @param props Component configuration options.
 * @return Rendered modal element or null when closed.
 */
export const OrmExportModal: React.FC<OrmExportModalProps> = ({
  isOpen,
  onClose,
  tables,
  initialSelectedTable,
  selectedTable,
}) => {
  const activeInitial = selectedTable ?? initialSelectedTable;
  const [selectedTarget, setSelectedTarget] = useState<OrmTarget>('prisma');
  const [selectedTableName, setSelectedTableName] = useState<string>(
    activeInitial || '__all__'
  );
  const [copied, setCopied] = useState<boolean>(false);
  const [activeTheme, setActiveTheme] = useState<AppTheme>(getSavedTheme());

  const modalTitleId = useId();

  // Synchronize Monaco theme with global theme changes
  React.useEffect(() => {
    return onThemeChange((theme) => setActiveTheme(theme));
  }, []);

  // Update selected table if initialSelectedTable / selectedTable prop changes
  React.useEffect(() => {
    if (activeInitial) {
      setSelectedTableName(activeInitial);
    }
  }, [activeInitial]);

  // Filter tables based on user scope choice
  const activeTables = useMemo(() => {
    if (selectedTableName === '__all__') {
      return tables;
    }
    return tables.filter((t) => t.name === selectedTableName);
  }, [tables, selectedTableName]);

  // Compute generated code buffer
  const generatedCode = useMemo(() => {
    return generateOrmCode(activeTables, selectedTarget);
  }, [activeTables, selectedTarget]);

  const targetMeta = ORM_TARGETS[selectedTarget];

  /**
   * @brief Copies the current generated code buffer to the clipboard.
   */
  const handleCopy = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(generatedCode);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Fallback for sandboxed clipboard environments
    }
  };

  /**
   * @brief Triggers a browser download of the active ORM code file.
   */
  const handleDownload = (): void => {
    const blob = new Blob([generatedCode], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = targetMeta.defaultFileName;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  if (!isOpen) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby={modalTitleId}
      data-testid="orm-export-modal"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4 animate-in fade-in duration-150"
    >
      <div className="flex flex-col w-full max-w-5xl h-[88vh] bg-[#1e1f22] border border-[#35383f] rounded-xl shadow-2xl overflow-hidden text-xs text-[#e6e8ea]">
        {/* Header Bar */}
        <div className="flex items-center justify-between px-6 py-3.5 border-b border-[#2d3139] bg-[#24262b] shrink-0">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-[#3a82f7]/15 border border-[#3a82f7]/30 rounded-lg text-[#3a82f7]">
              <Code2 className="w-5 h-5" />
            </div>
            <div>
              <h2 id={modalTitleId} className="text-base font-semibold text-[#e6e8ea]">
                ORM &amp; Entity Code Generator
              </h2>
              <p className="text-xs text-[#8c919a]">
                Export type-safe models for Prisma, Drizzle, GORM, SeaORM, EF Core, and SQLAlchemy
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              data-testid="orm-modal-close-btn"
              onClick={onClose}
              className="p-1.5 text-[#8c919a] hover:text-[#e6e8ea] hover:bg-[#2d3139] rounded-lg transition-colors cursor-pointer"
              title="Close modal"
              aria-label="Close modal"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Target Framework Tabs & Scope Selector */}
        <div className="flex flex-wrap items-center justify-between gap-3 px-6 py-2.5 border-b border-[#2d3139] bg-[#1a1b1e] shrink-0">
          {/* Target Tabs */}
          <div role="tablist" aria-label="ORM Framework" className="flex items-center space-x-1 overflow-x-auto py-0.5">
            {(Object.keys(ORM_TARGETS) as OrmTarget[]).map((tId) => {
              const meta = ORM_TARGETS[tId];
              const isSelected = selectedTarget === tId;
              return (
                <button
                  key={tId}
                  role="tab"
                  type="button"
                  data-testid={`orm-tab-${tId}`}
                  aria-selected={isSelected}
                  onClick={() => setSelectedTarget(tId)}
                  className={`px-3 py-1.5 rounded font-medium transition-colors cursor-pointer whitespace-nowrap text-xs ${
                    isSelected
                      ? 'bg-[#3a82f7] text-white shadow-xs'
                      : 'bg-[#24262b] text-[#8c919a] hover:text-[#e6e8ea] hover:bg-[#2e3138]'
                  }`}
                  title={meta.description}
                >
                  {meta.label}
                </button>
              );
            })}
          </div>

          {/* Scope Selector: Single Table vs All Tables */}
          <div className="flex items-center gap-2 shrink-0">
            <label htmlFor="orm-table-scope" className="text-xs text-[#8c919a] flex items-center gap-1">
              <Layers className="w-3.5 h-3.5 text-[#3a82f7]" />
              <span>Scope:</span>
            </label>
            <select
              id="orm-table-scope"
              data-testid="orm-table-select"
              value={selectedTableName}
              onChange={(e) => setSelectedTableName(e.target.value)}
              className="bg-[#24262b] border border-[#35383f] text-[#e6e8ea] text-xs font-mono rounded px-2.5 py-1 focus:outline-hidden focus:border-[#3a82f7] cursor-pointer"
            >
              <option value="__all__">All Tables ({tables.length})</option>
              {tables.map((t) => (
                <option key={t.name} value={t.name}>
                  {t.name} ({t.columns.length} cols)
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* Code Editor Preview Area */}
        <div className="flex-1 min-h-0 bg-[#141517] relative">
          <Editor
            height="100%"
            language={targetMeta.language}
            value={generatedCode}
            theme={THEMES[activeTheme]?.monacoTheme || 'vs-dark'}
            options={{
              readOnly: true,
              minimap: { enabled: false },
              fontSize: 12,
              fontFamily: "'JetBrains Mono', 'Fira Code', Menlo, Consolas, monospace",
              lineNumbers: 'on',
              scrollBeyondLastLine: false,
              wordWrap: 'on',
              automaticLayout: true,
              domReadOnly: true,
              renderWhitespace: 'none',
              padding: { top: 12, bottom: 12 },
            }}
          />
        </div>

        {/* Footer Actions */}
        <div className="flex items-center justify-between px-6 py-3 border-t border-[#2d3139] bg-[#24262b] shrink-0">
          <div className="flex items-center gap-2 text-xs text-[#8c919a] font-mono">
            <FileCode className="w-4 h-4 text-[#3a82f7]" />
            <span>Target File: </span>
            <code className="text-[#e6e8ea] bg-[#1e2024] px-2 py-0.5 rounded border border-[#35383f]">
              {targetMeta.defaultFileName}
            </code>
            <span className="text-[11px] text-[#8c919a]">
              ({activeTables.length} {activeTables.length === 1 ? 'table' : 'tables'} included)
            </span>
          </div>

          <div className="flex items-center gap-3">
            <button
              type="button"
              data-testid="orm-copy-code-btn"
              onClick={handleCopy}
              className="flex items-center gap-1.5 px-3.5 py-1.5 bg-[#2c2e33] hover:bg-[#35383f] text-[#e6e8ea] rounded font-semibold transition-colors cursor-pointer text-xs"
            >
              {copied ? (
                <>
                  <Check className="w-3.5 h-3.5 text-emerald-400" />
                  <span className="text-emerald-400">Copied!</span>
                </>
              ) : (
                <>
                  <Copy className="w-3.5 h-3.5 text-[#8c919a]" />
                  <span>Copy Code</span>
                </>
              )}
            </button>

            <button
              type="button"
              data-testid="orm-download-file-btn"
              onClick={handleDownload}
              className="flex items-center gap-1.5 px-4 py-1.5 bg-[#3a82f7] hover:bg-[#2b6fd6] text-white rounded font-semibold transition-colors shadow-xs cursor-pointer text-xs"
            >
              <Download className="w-3.5 h-3.5" />
              <span>Download {targetMeta.extension}</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
