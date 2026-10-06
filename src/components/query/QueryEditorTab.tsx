/**
 * @file QueryEditorTab.tsx
 * @brief Modern SQL query workspace tab with Monaco Editor and results grid.
 * @details Embeds Monaco Editor for SQL authoring, supports keyboard shortcuts (Ctrl+Enter / Cmd+Enter),
 * executes statements via Tauri IPC, and renders tabular results with sticky headers and value type formatting.
 */

import React, { useState, useRef, useCallback } from 'react';
import Editor, { OnMount } from '@monaco-editor/react';
import { Play, Loader2, AlertCircle, FileCode } from 'lucide-react';
import { api } from '../../api/ipc';
import type { ConnectionConfig, QueryResult } from '../../types/database';

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
  const [error, setError] = useState<string | null>(null);

  // Keep latest query in ref for Monaco action callback
  const queryRef = useRef(query);
  queryRef.current = query;

  /**
   * @brief Executes the current SQL statement string via Tauri IPC backend.
   */
  const handleRun = useCallback(async () => {
    const sqlToRun = queryRef.current.trim();
    if (!sqlToRun) return;

    setIsLoading(true);
    setError(null);

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
          <div className="flex items-center space-x-2 text-[#8c919a] font-mono text-[11px]">
            <span data-testid="row-count">{result.rows.length} rows returned</span>
            <span>•</span>
            <span data-testid="exec-duration">{result.execution_time_ms} ms</span>
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
      <div className="flex-1 overflow-auto bg-[#18191c] relative select-text">
        {/* Error Banner */}
        {error && (
          <div
            data-testid="query-error-banner"
            className="p-3 m-3 bg-red-500/10 border border-red-500/30 rounded text-[#e05252] font-mono text-xs flex items-start gap-2 shadow-sm"
          >
            <AlertCircle className="w-4 h-4 shrink-0 mt-0.5 text-red-400" />
            <div>
              <div className="font-bold">Query Execution Error</div>
              <div className="mt-0.5 whitespace-pre-wrap">{error}</div>
            </div>
          </div>
        )}

        {/* Tabular Results Table */}
        {result && !error && (
          <div className="min-w-full inline-block align-middle">
            <table className="w-full text-left border-collapse text-xs font-mono">
              <thead>
                <tr className="sticky top-0 bg-[#24262b] text-[#8c919a] border-b border-[#35373c] z-10 shadow-xs">
                  {result.columns.map((col, cidx) => (
                    <th
                      key={`${col}-${cidx}`}
                      className="px-3 py-1.5 font-semibold text-[11px] whitespace-nowrap border-r border-[#35373c]/50 last:border-r-0"
                    >
                      {col}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-[#2b2d30]">
                {result.rows.length === 0 ? (
                  <tr>
                    <td
                      colSpan={result.columns.length || 1}
                      className="px-3 py-6 text-center text-[#8c919a] italic"
                    >
                      (0 rows returned)
                    </td>
                  </tr>
                ) : (
                  result.rows.map((row, idx) => (
                    <tr
                      key={idx}
                      className="border-b border-[#2b2d30] hover:bg-[#24262b] transition-colors"
                    >
                      {row.map((val, cidx) => (
                        <td
                          key={cidx}
                          className="px-3 py-1.5 text-[11px] whitespace-nowrap max-w-[320px] truncate border-r border-[#2b2d30]/50 last:border-r-0"
                        >
                          {formatCellValue(val)}
                        </td>
                      ))}
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        )}

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
