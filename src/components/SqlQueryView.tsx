/**
 * @file SqlQueryView.tsx
 * @brief Subcomponent rendering interactive SQL query console and tabular result inspector.
 * @details Handles query statement editing, execution triggers, error displays, and tabular results.
 */

import React from 'react';
import {
  Play,
  Loader2,
  AlertCircle,
  FileCode,
} from 'lucide-react';
import type { ConnectionConfig, QueryResult } from '../types/database';

/**
 * @brief Properties accepted by the SqlQueryView component.
 */
export interface SqlQueryViewProps {
  /** @brief Currently active database connection configuration or null. */
  activeConnection: ConnectionConfig | null;
  /** @brief Current SQL query text in the editor. */
  sqlQuery: string;
  /** @brief State setter for SQL query text. */
  setSqlQuery: (val: string) => void;
  /** @brief Callback triggered to execute the query against the active database. */
  onExecuteQuery: () => void;
  /** @brief Indicates whether query execution is currently running. */
  isExecutingQuery: boolean;
  /** @brief Tabular results produced by successful query execution. */
  queryResult: QueryResult | null;
  /** @brief Error message produced by query execution failure. */
  queryError: string | null;
}

/**
 * @brief Renders the SQL query editor and tabular result view.
 * @param props SQL query state, execution callbacks, and results telemetry.
 * @return Rendered SQL Query view element.
 */
export const SqlQueryView: React.FC<SqlQueryViewProps> = ({
  activeConnection,
  sqlQuery,
  setSqlQuery,
  onExecuteQuery,
  isExecutingQuery,
  queryResult,
  queryError,
}) => {
  return (
    <div className="flex-1 flex flex-col h-full overflow-hidden">
      {/* Query Editor Toolbar */}
      <div className="h-10 border-b border-[#35373c] bg-[#18191c] px-4 flex items-center justify-between text-xs">
        <div className="flex items-center space-x-2">
          <FileCode className="w-4 h-4 text-[#3a82f7]" />
          <span className="font-semibold text-[#e6e8ea]">SQL Query Console</span>
          {activeConnection && (
            <span className="text-[10px] text-[#8c919a] font-mono">
              Target: {activeConnection.name} ({activeConnection.db_type})
            </span>
          )}
        </div>

        <button
          type="button"
          onClick={onExecuteQuery}
          disabled={!activeConnection || isExecutingQuery}
          className="flex items-center gap-1.5 px-3 py-1 bg-[#20c997] hover:bg-[#1bb285] disabled:opacity-50 text-[#18191c] font-bold rounded shadow-xs transition-colors"
        >
          {isExecutingQuery ? (
            <Loader2 className="w-3.5 h-3.5 animate-spin" />
          ) : (
            <Play className="w-3.5 h-3.5 fill-current" />
          )}
          <span>Run Query</span>
        </button>
      </div>

      {/* SQL Text Area Input */}
      <div className="p-3 bg-[#18191c] border-b border-[#35373c]">
        <textarea
          value={sqlQuery}
          onChange={(e) => setSqlQuery(e.target.value)}
          placeholder="SELECT * FROM table_name;"
          rows={4}
          className="w-full bg-[#1e1f22] border border-[#35373c] rounded p-2.5 font-mono text-xs text-[#e6e8ea] focus:outline-none focus:border-[#3a82f7] resize-none"
        />
      </div>

      {/* Query Results / Errors */}
      <div className="flex-1 overflow-auto p-3">
        {!activeConnection ? (
          <div className="py-12 text-center text-[#8c919a] text-xs">
            Connect to a database to execute SQL queries.
          </div>
        ) : queryError ? (
          <div className="p-4 bg-red-500/10 border border-red-500/30 rounded text-red-400 font-mono text-xs">
            <div className="font-bold flex items-center gap-1 mb-1">
              <AlertCircle className="w-4 h-4" />
              <span>Query Execution Error</span>
            </div>
            <pre className="whitespace-pre-wrap">{queryError}</pre>
          </div>
        ) : queryResult ? (
          <div className="space-y-2">
            <div className="text-[11px] text-[#8c919a] flex items-center justify-between font-mono">
              <span>{queryResult.rows.length} rows returned</span>
              <span>Executed in {queryResult.execution_time_ms} ms</span>
            </div>

            <div className="bg-[#18191c] border border-[#35373c] rounded overflow-hidden shadow">
              <table className="w-full text-left text-xs border-collapse">
                <thead>
                  <tr className="bg-[#26282d] border-b border-[#35373c] text-[#8c919a] font-mono text-[11px]">
                    {queryResult.columns.map((col) => (
                      <th key={col} className="py-2 px-3">
                        {col}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#35373c]/40 font-mono text-[11px]">
                  {queryResult.rows.map((row, rIdx) => (
                    <tr key={rIdx} className="hover:bg-[#26282d]/50">
                      {row.map((cell, cIdx) => (
                        <td key={cIdx} className="py-1.5 px-3 truncate max-w-[200px]">
                          {cell === null ? (
                            <span className="text-[#8c919a] italic">NULL</span>
                          ) : typeof cell === 'object' ? (
                            JSON.stringify(cell)
                          ) : (
                            String(cell)
                          )}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ) : (
          <div className="py-12 text-center text-[#8c919a] text-xs">
            Click &ldquo;Run Query&rdquo; to execute the statement.
          </div>
        )}
      </div>
    </div>
  );
};
