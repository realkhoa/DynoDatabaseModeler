/**
 * @file QueryEditorTab.tsx
 * @brief Modern SQL query workspace tab with Monaco Editor and results grid.
 * @details Embeds Monaco Editor for SQL authoring, supports keyboard shortcuts (Ctrl+Enter / Cmd+Enter),
 * executes statements via Tauri IPC, and renders tabular results with sticky headers and value type formatting.
 */

import React, { useState, useRef, useCallback } from 'react';
import Editor, { OnMount } from '@monaco-editor/react';
import { Play, Loader2, AlertCircle, FileCode, CheckCircle2, Eye } from 'lucide-react';
import { api } from '../../api/ipc';
import type { ConnectionConfig, QueryResult, RowUpdatePayload } from '../../types/database';
import { EditableDataGrid, EditableDataGridHandle } from './EditableDataGrid';
import { ValueInspectorDrawer } from './ValueInspectorDrawer';

/**
 * @brief Properties accepted by the QueryEditorTab component.
 */
export interface QueryEditorTabProps {
  /** @brief Currently active database connection configuration or null if disconnected. */
  activeConnection?: ConnectionConfig | null;
  /** @brief Optional initial SQL query statement text. */
  initialQuery?: string;
  /** @brief Optional callback triggered upon successful query execution. */
  onQuerySuccess?: (result: QueryResult) => void;
}

/**
 * @brief Formats an arbitrary tabular cell value for clean tabular rendering.
 * @param val Cell value of unknown data type (string, number, boolean, object, or null/undefined).
 * @return Rendered React node with appropriate formatting.
 */
export function formatCellValue(val: unknown): React.ReactNode {
  if (val === null || val === undefined) {
    return <span className="text-[#8c919a] italic">NULL</span>;
  }
  if (typeof val === 'object') {
    return <span className="text-[#e6e8ea] font-mono">{JSON.stringify(val)}</span>;
  }
  if (typeof val === 'boolean') {
    return <span className="text-[#3a82f7] font-mono">{String(val)}</span>;
  }
  if (typeof val === 'number') {
    return <span className="text-[#20c997] font-mono">{String(val)}</span>;
  }
  return <span className="text-[#e6e8ea]">{String(val)}</span>;
}

/**
 * @brief Attempts to extract table name from a SELECT SQL query string.
 * @param sql SQL statement string to analyze.
 * @return Extracted table identifier or 'unknown'.
 */
export function extractTableNameFromSql(sql: string): string {
  const match = sql.match(/\bfrom\s+([`"']?[a-zA-Z0-9_]+[`"']?\.)?([`"']?([a-zA-Z0-9_]+)[`"']?)/i);
  if (match && match[3]) {
    return match[3];
  }
  return 'unknown';
}

/**
 * @brief Coordinates and metadata for the currently active/inspected tabular cell.
 */
interface SelectedCellState {
  /** @brief Zero-based row index in dataset. */
  rowIndex: number;
  /** @brief Zero-based column index in dataset. */
  colIndex: number;
  /** @brief Column header name. */
  columnName: string;
  /** @brief Current effective value of the cell. */
  value: any;
}

/**
 * @brief Interactive SQL Query Editor and results grid tab component.
 * @param props Component configuration properties.
 * @return Rendered QueryEditorTab React element.
 */
export const QueryEditorTab: React.FC<QueryEditorTabProps> = ({
  activeConnection,
  initialQuery = 'SELECT 1 as id, "Hello DynoDbModeler" as message;',
  onQuerySuccess,
}) => {
  const [query, setQuery] = useState(initialQuery);
  const [result, setResult] = useState<QueryResult | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [saveStatus, setSaveStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selectedCell, setSelectedCell] = useState<SelectedCellState | null>(null);
  const [isInspectorOpen, setIsInspectorOpen] = useState(false);

  const gridRef = useRef<EditableDataGridHandle | null>(null);

  // Keep latest query in ref for Monaco action callback
  const queryRef = useRef(query);
  queryRef.current = query;

  /**
   * @brief Handles cell selection in the results data grid.
   * @param colName Column name.
   * @param val Current cell value.
   */
  const handleCellSelect = useCallback(
    (colName: string, val: any) => {
      setSelectedCell((prev) => ({
        columnName: colName,
        value: val,
        rowIndex: prev?.rowIndex ?? 0,
        colIndex: prev?.colIndex ?? 0,
      }));
    },
    []
  );

  /**
   * @brief Captures full cell coordinate position on selection.
   * @param pos Position and value metadata.
   */
  const handleCellPositionSelect = useCallback(
    (pos: { rowIndex: number; colIndex: number; columnName: string; value: any }) => {
      setSelectedCell(pos);
    },
    []
  );

  /**
   * @brief Opens the Value Inspector Drawer for the selected cell or first cell by default.
   */
  const handleOpenInspector = useCallback(() => {
    if (!selectedCell && result && result.rows.length > 0 && result.columns.length > 0) {
      setSelectedCell({
        rowIndex: 0,
        colIndex: 0,
        columnName: result.columns[0],
        value: result.rows[0][0],
      });
    }
    setIsInspectorOpen(true);
  }, [result, selectedCell]);

  /**
   * @brief Applies modifications made in the inspector drawer back to the data grid.
   * @param newValue Modified value from the drawer editor.
   */
  const handleApplyDrawerEdit = useCallback(
    (newValue: any) => {
      if (!selectedCell) return;
      gridRef.current?.updateCell(selectedCell.rowIndex, selectedCell.colIndex, newValue);
      setSelectedCell((prev) => (prev ? { ...prev, value: newValue } : null));
    },
    [selectedCell]
  );

  /**
   * @brief Executes the current SQL statement string via Tauri IPC backend.
   */
  const handleRun = useCallback(async () => {
    const sqlToRun = queryRef.current.trim();
    if (!sqlToRun) return;

    setIsLoading(true);
    setError(null);
    setSaveStatus(null);

    try {
      const res = await api.executeQuery(sqlToRun);
      setResult(res);
      if (onQuerySuccess) {
        onQuerySuccess(res);
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg || 'Execution failed');
      setResult(null);
    } finally {
      setIsLoading(false);
    }
  }, [onQuerySuccess]);

  /**
   * @brief Persists batch row updates via backend Tauri IPC and refreshes current query results.
   * @param updates List of row update payloads to commit transactionally.
   */
  const handleSave = useCallback(
    async (updates: RowUpdatePayload[]) => {
      setIsSaving(true);
      setError(null);
      setSaveStatus(null);

      try {
        const count = await api.updateRows(updates);
        setSaveStatus(`Successfully saved ${count} row update(s)`);

        // Refresh grid data by re-executing active query
        const sqlToRun = queryRef.current.trim();
        if (sqlToRun) {
          const res = await api.executeQuery(sqlToRun);
          setResult(res);
          if (onQuerySuccess) {
            onQuerySuccess(res);
          }
        }
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        setError(msg || 'Failed to save changes');
      } finally {
        setIsSaving(false);
      }
    },
    [onQuerySuccess]
  );


  /**
   * @brief Configures Monaco Editor keyboard shortcuts on editor mount.
   * @param editor Monaco editor instance.
   * @param monaco Global Monaco namespace.
   */
  const handleEditorDidMount: OnMount = useCallback(
    (editor, monaco) => {
      // Register Ctrl+Enter / Cmd+Enter shortcut
      editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter, () => {
        handleRun();
      });
    },
    [handleRun]
  );

  /**
   * @brief Captures keyboard events on the editor container as a fallback for shortcut handling.
   * @param e React keyboard event.
   */
  const handleContainerKeyDown = (e: React.KeyboardEvent) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
      e.preventDefault();
      handleRun();
    }
  };

  return (
    <div
      className="flex-1 flex flex-col h-full bg-[#1e1f22] text-xs overflow-hidden select-none"
      onKeyDown={handleContainerKeyDown}
      tabIndex={-1}
    >
      {/* Top Toolbar */}
      <div className="h-10 p-2 bg-[#26282d] border-b border-[#35373c] flex items-center justify-between shrink-0">
        <div className="flex items-center space-x-3">
          <div className="flex items-center space-x-1.5">
            <FileCode className="w-4 h-4 text-[#3a82f7]" />
            <span className="font-semibold text-[#e6e8ea]">SQL Query Console</span>
          </div>

          <button
            type="button"
            onClick={handleRun}
            disabled={isLoading}
            className="flex items-center space-x-1.5 bg-[#3a82f7] hover:bg-[#2b6fd6] text-white px-3 py-1 rounded font-semibold disabled:opacity-50 transition-colors shadow-xs cursor-pointer"
          >
            {isLoading ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <Play className="w-3.5 h-3.5 fill-current" />
            )}
            <span>{isLoading ? 'Running...' : 'Run Query (Ctrl+Enter)'}</span>
          </button>

          {activeConnection && (
            <span className="text-[10px] text-[#8c919a] font-mono hidden sm:inline">
              Target: {activeConnection.name} ({activeConnection.db_type})
            </span>
          )}
        </div>

        {/* Execution Metadata Telemetry */}
        {result && (
          <div className="flex items-center space-x-3 text-[#8c919a] font-mono text-[11px]">
            <div className="flex items-center space-x-2">
              <span data-testid="row-count">{result.rows.length} rows returned</span>
              <span>•</span>
              <span data-testid="exec-duration">{result.execution_time_ms} ms</span>
            </div>

            <button
              type="button"
              data-testid="inspect-value-btn"
              onClick={handleOpenInspector}
              className="flex items-center space-x-1.5 px-2.5 py-1 bg-[#26282d] hover:bg-[#35373c] text-[#e6e8ea] rounded border border-[#35373c] text-[11px] font-mono cursor-pointer transition-colors shadow-xs"
              title="Inspect cell value in drawer"
            >
              <Eye className="w-3.5 h-3.5 text-[#3a82f7]" />
              <span>Inspect Value</span>
            </button>
          </div>
        )}
      </div>

      {/* Editor Area */}
      <div className="h-52 border-b border-[#35373c] shrink-0 bg-[#1e1f22]">
        <Editor
          height="100%"
          defaultLanguage="sql"
          language="sql"
          theme="vs-dark"
          value={query}
          onChange={(v) => setQuery(v || '')}
          onMount={handleEditorDidMount}
          options={{
            minimap: { enabled: false },
            fontSize: 12,
            fontFamily: 'JetBrains Mono, monospace',
            lineNumbers: 'on',
            automaticLayout: true,
            scrollBeyondLastLine: false,
            wordWrap: 'on',
          }}
        />
      </div>

      {/* Results Table Grid Area */}
      <div className="flex-1 flex flex-col overflow-hidden bg-[#18191c] relative select-text">
        {/* Error Banner */}
        {error && (
          <div
            data-testid="query-error-banner"
            className="p-3 m-3 bg-red-500/10 border border-red-500/30 rounded text-[#e05252] font-mono text-xs flex items-start gap-2 shadow-sm shrink-0"
          >
            <AlertCircle className="w-4 h-4 shrink-0 mt-0.5 text-red-400" />
            <div>
              <div className="font-bold">Query Execution Error</div>
              <div className="mt-0.5 whitespace-pre-wrap">{error}</div>
            </div>
          </div>
        )}

        {/* Save Status Banner */}
        {saveStatus && (
          <div
            data-testid="save-status-banner"
            className="p-2.5 m-3 mb-0 bg-emerald-500/10 border border-emerald-500/30 rounded text-emerald-400 font-mono text-xs flex items-center justify-between shadow-sm shrink-0"
          >
            <div className="flex items-center space-x-2">
              <CheckCircle2 className="w-4 h-4 shrink-0 text-emerald-400" />
              <span>{saveStatus}</span>
            </div>
            <button
              type="button"
              onClick={() => setSaveStatus(null)}
              className="text-emerald-400/80 hover:text-emerald-200 cursor-pointer font-bold px-1"
            >
              ✕
            </button>
          </div>
        )}

        {/* Tabular Results Editable Data Grid */}
        {result && !error && (
          <div className="flex-1 min-h-0 overflow-hidden">
            <EditableDataGrid
              ref={gridRef}
              tableName={extractTableNameFromSql(query)}
              columns={result.columns}
              rows={result.rows}
              onSave={handleSave}
              isSaving={isSaving}
              onCellSelect={handleCellSelect}
              onCellPositionSelect={handleCellPositionSelect}
            />
          </div>
        )}

        {/* Value Inspector Drawer */}
        <ValueInspectorDrawer
          isOpen={isInspectorOpen}
          columnName={selectedCell?.columnName}
          value={selectedCell?.value}
          onClose={() => setIsInspectorOpen(false)}
          onApplyEdit={handleApplyDrawerEdit}
        />

        {/* Empty / Initial Placeholder */}
        {!result && !error && !isLoading && (
          <div className="h-full flex items-center justify-center p-8 text-center text-[#8c919a]">
            <div>
              <p className="text-xs">Click &ldquo;Run Query&rdquo; or press Ctrl+Enter to execute.</p>
              {!activeConnection && (
                <p className="text-[11px] text-[#636770] mt-1">
                  (Note: Connect to a database to execute live queries)
                </p>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
