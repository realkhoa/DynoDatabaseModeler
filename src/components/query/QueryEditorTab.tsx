/**
 * @file QueryEditorTab.tsx
 * @brief Modern SQL query workspace tab with Monaco Editor and results grid.
 * @details Embeds Monaco Editor for SQL authoring, supports keyboard shortcuts (Ctrl+Enter / Cmd+Enter),
 * executes statements via Tauri IPC, and renders tabular results with sticky headers and value type formatting.
 */

import React, { useState, useRef, useCallback, useEffect } from 'react';
import Editor, { OnMount } from '@monaco-editor/react';
import {
  Play,
  Loader2,
  AlertCircle,
  FileCode,
  CheckCircle2,
  Eye,
  Download,
  Zap,
  History,
  Lock,
  ShieldCheck,
  ShieldAlert,
} from 'lucide-react';
import { api } from '../../api/ipc';
import type {
  ConnectionConfig,
  QueryResult,
  RowUpdatePayload,
  ExecutionPlanNode,
  DatabaseType,
  DatabaseSchema,
} from '../../types/database';
import { buildSqlCompletions } from '../../utils/sqlCompletion';
import { EditableDataGrid, EditableDataGridHandle } from './EditableDataGrid';
import { ValueInspectorDrawer } from './ValueInspectorDrawer';
import { ExportModal } from './ExportModal';
import { ExplainPlanModal } from './ExplainPlanModal';
import { QueryHistoryModal } from './QueryHistoryModal';
import { analyzeEditableQuery } from '../../utils/sqlSafety';
import type { EditableQueryAnalysis } from '../../utils/sqlSafety';
import {
  applySafeLimit,
  buildCountQuery,
  extractPaginationInfo,
} from '../../utils/sqlPagination';

/**
 * @brief Properties accepted by the QueryEditorTab component.
 */
export interface QueryEditorTabProps {
  /** @brief Currently active database connection configuration or null if disconnected. */
  activeConnection?: ConnectionConfig | null;
  /** @brief Optional active database schema containing tables and columns for autocompletion. */
  schema?: DatabaseSchema | null;
  /** @brief Optional initial SQL query statement text. */
  initialQuery?: string;
  /** @brief Optional callback triggered upon successful query execution. */
  onQuerySuccess?: (result: QueryResult) => void;
  /** @brief Whether to automatically execute the query on mount or when initialQuery changes. */
  autoRun?: boolean;
}

/**
 * @brief Updates or appends pagination clauses (LIMIT/OFFSET or MSSQL OFFSET/FETCH) in a SQL query.
 * @details Targets the trailing pagination clause so that subqueries or CTE expressions
 * containing nested LIMIT/OFFSET clauses remain untouched.
 * @param sql Existing SQL query text.
 * @param dbType Database dialect.
 * @param pageSize Number of rows per page.
 * @param pageIndex Zero-based page index.
 * @return Updated SQL statement with adjusted pagination clauses.
 */
export function updateQueryPagination(
  sql: string,
  dbType: DatabaseType = 'Postgres',
  pageSize: number,
  pageIndex: number
): string {
  const offset = Math.max(0, pageIndex * pageSize);
  const trimmed = sql.trim().replace(/;+$/, '').trimEnd();

  if (dbType === 'Mssql') {
    const mssqlTrailingRegex = /OFFSET\s+\d+\s+ROWS\s+FETCH\s+(?:FIRST|NEXT)\s+\d+\s+ROWS(?:\s+ONLY)?\s*$/i;
    if (mssqlTrailingRegex.test(trimmed)) {
      return trimmed.replace(mssqlTrailingRegex, `OFFSET ${offset} ROWS FETCH NEXT ${pageSize} ROWS ONLY`) + ';';
    }
    const hasOrderBy = /\bORDER\s+BY\b/i.test(trimmed);
    const orderPrefix = hasOrderBy ? '' : ' ORDER BY (SELECT NULL)';
    return `${trimmed}${orderPrefix} OFFSET ${offset} ROWS FETCH NEXT ${pageSize} ROWS ONLY;`;
  }

  const trailingLimitOffsetRegex = /(?:LIMIT\s+\d+\s+OFFSET\s+\d+|OFFSET\s+\d+\s+LIMIT\s+\d+|LIMIT\s+\d+\s*,\s*\d+)\s*$/i;
  const trailingLimitRegex = /LIMIT\s+\d+\s*$/i;
  const trailingOffsetRegex = /OFFSET\s+\d+\s*$/i;

  if (trailingLimitOffsetRegex.test(trimmed)) {
    return trimmed.replace(trailingLimitOffsetRegex, `LIMIT ${pageSize} OFFSET ${offset}`) + ';';
  } else if (trailingLimitRegex.test(trimmed)) {
    return trimmed.replace(trailingLimitRegex, `LIMIT ${pageSize} OFFSET ${offset}`) + ';';
  } else if (trailingOffsetRegex.test(trimmed)) {
    return trimmed.replace(trailingOffsetRegex, `LIMIT ${pageSize} OFFSET ${offset}`) + ';';
  } else {
    return `${trimmed} LIMIT ${pageSize} OFFSET ${offset};`;
  }
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
  schema,
  initialQuery = 'SELECT 1 as id, "Hello DynoDbModeler" as message;',
  onQuerySuccess,
  autoRun = false,
}) => {
  const [query, setQuery] = useState(initialQuery);
  const [result, setResult] = useState<QueryResult | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [saveStatus, setSaveStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selectedCell, setSelectedCell] = useState<SelectedCellState | null>(null);
  const [isInspectorOpen, setIsInspectorOpen] = useState(false);
  const [isExportOpen, setIsExportOpen] = useState(false);
  const [explainPlan, setExplainPlan] = useState<ExecutionPlanNode | null>(null);
  const [isExplainOpen, setIsExplainOpen] = useState(false);
  const [isExplaining, setIsExplaining] = useState(false);
  const [explainError, setExplainError] = useState<string | null>(null);
  const [isHistoryOpen, setIsHistoryOpen] = useState(false);

  // Safe limit state
  const [safeLimit, setSafeLimit] = useState<number>(500);
  const [safeLimitNotice, setSafeLimitNotice] = useState<string | null>(null);

  // Server-side pagination state
  const [pageIndex, setPageIndex] = useState<number>(0);
  const [pageSize, setPageSize] = useState<number>(50);
  const [totalRows, setTotalRows] = useState<number | null>(null);
  const [activeTableTarget, setActiveTableTarget] = useState<string | null>(null);

  // In-place editing is gated on a verified primary key for a single-table projection.
  const [editAnalysis, setEditAnalysis] = useState<EditableQueryAnalysis | null>(null);
  const [primaryKeyColumns, setPrimaryKeyColumns] = useState<string[]>([]);

  const gridRef = useRef<EditableDataGridHandle | null>(null);
  const primaryKeyCache = useRef<Map<string, string[]>>(new Map());

  // Schema ref for autocomplete completion provider
  const schemaRef = useRef(schema);
  useEffect(() => {
    schemaRef.current = schema;
  }, [schema]);

  const completionProviderRef = useRef<{ dispose: () => void } | null>(null);

  useEffect(() => {
    return () => {
      completionProviderRef.current?.dispose();
      completionProviderRef.current = null;
    };
  }, []);

  const detectedTableName = extractTableNameFromSql(query);

  // Keep latest query and props in refs for callbacks
  const queryRef = useRef(query);
  queryRef.current = query;

  const safeLimitRef = useRef(safeLimit);
  safeLimitRef.current = safeLimit;

  const activeConnectionRef = useRef(activeConnection);
  activeConnectionRef.current = activeConnection;

  const pageSizeRef = useRef(pageSize);
  pageSizeRef.current = pageSize;

  const totalRowsRef = useRef(totalRows);
  totalRowsRef.current = totalRows;

  const activeTableTargetRef = useRef(activeTableTarget);
  activeTableTargetRef.current = activeTableTarget;

  /**
   * @brief Selects a query from execution history modal and populates the editor.
   * @param historySql Selected SQL query string.
   */
  const handleSelectHistoryQuery = useCallback((historySql: string) => {
    setQuery(historySql);
    queryRef.current = historySql;
  }, []);

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
   * @brief Determines whether the executed statement may be edited and resolves its primary key.
   * @details Without a real primary key there is no safe row locator, so the grid stays read-only.
   * The lookup is cached per table to avoid re-introspecting on every execution.
   * @param sql Executed SQL statement text.
   * @return Analysis describing editability plus the resolved primary key columns.
   */
  const resolveEditability = useCallback(
    async (sql: string): Promise<{ analysis: EditableQueryAnalysis; keys: string[] }> => {
      const analysis = analyzeEditableQuery(sql);
      if (!analysis.editable || !analysis.table) {
        return { analysis, keys: [] };
      }

      const cached = primaryKeyCache.current.get(analysis.table);
      if (cached) {
        return {
          analysis: cached.length
            ? analysis
            : {
                editable: false,
                table: analysis.table,
                reason: `Read-only: table "${analysis.table}" has no primary key, so rows cannot be identified safely.`,
              },
          keys: cached,
        };
      }

      try {
        const keys = await api.getPrimaryKeys(analysis.table);
        primaryKeyCache.current.set(analysis.table, keys);
        if (keys.length === 0) {
          return {
            analysis: {
              editable: false,
              table: analysis.table,
              reason: `Read-only: table "${analysis.table}" has no primary key, so rows cannot be identified safely.`,
            },
            keys,
          };
        }
        return { analysis, keys };
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        return {
          analysis: {
            editable: false,
            table: analysis.table,
            reason: `Read-only: could not resolve the primary key of "${analysis.table}" (${message}).`,
          },
          keys: [],
        };
      }
    },
    []
  );

  /**
   * @brief Executes the current SQL statement string via Tauri IPC backend.
   * @details Intercepts unbounded queries with safe limit when active, resolves single-table editability,
   * extracts pagination parameters, and triggers background count resolution.
   * @param sqlOverride Optional SQL statement string to run instead of current editor text.
   * @param forceCountRefresh When true, re-executes table COUNT(*) query even if table has not changed.
   */
  const handleRun = useCallback(
    async (sqlOverride?: string, forceCountRefresh?: boolean) => {
      const sqlToRun = (typeof sqlOverride === 'string' ? sqlOverride : queryRef.current).trim();
      if (!sqlToRun) return;

      setIsLoading(true);
      setError(null);
      setSaveStatus(null);
      const startTime = Date.now();

      // Apply Safe Limit if enabled and connection exists
      let effectiveSql = sqlToRun;
      let limitApplied = false;
      if (safeLimitRef.current > 0 && activeConnectionRef.current) {
        const safeRes = applySafeLimit(
          sqlToRun,
          activeConnectionRef.current.db_type,
          safeLimitRef.current
        );
        effectiveSql = safeRes.sql;
        limitApplied = safeRes.applied;
      }

      if (limitApplied) {
        setSafeLimitNotice(`Safe Limit: ${safeLimitRef.current}`);
      } else {
        setSafeLimitNotice(null);
      }

      // Synchronize pagination state from the query statement
      const paginationInfo = extractPaginationInfo(sqlToRun);
      if (paginationInfo) {
        if (paginationInfo.limit !== undefined) {
          setPageSize(paginationInfo.limit);
        }
        if (paginationInfo.offset !== undefined && paginationInfo.limit !== undefined) {
          setPageIndex(Math.floor(paginationInfo.offset / paginationInfo.limit));
        } else if (paginationInfo.offset !== undefined) {
          setPageIndex(Math.floor(paginationInfo.offset / pageSizeRef.current));
        }
      } else if (limitApplied) {
        setPageSize(safeLimitRef.current);
        setPageIndex(0);
      } else {
        setPageIndex(0);
      }

      try {
        const res = await api.executeQuery(effectiveSql);
        const durationMs = Date.now() - startTime;
        setResult(res);

        const { analysis, keys } = await resolveEditability(effectiveSql);
        setEditAnalysis(analysis);
        setPrimaryKeyColumns(keys);

        // Record history using original user query text
        api
          .recordQueryHistory(sqlToRun, durationMs, res.rows.length, 'success')
          .catch((e) => console.error('Failed to log query history:', e));
        if (onQuerySuccess) {
          onQuerySuccess(res);
        }

        // Automatic background count resolution for single-table queries
        const targetTable =
          analysis.table || (detectedTableName !== 'unknown' ? detectedTableName : null);
        const hasPagination = paginationInfo !== null || limitApplied;

        if (activeConnectionRef.current && targetTable && hasPagination) {
          setActiveTableTarget(targetTable);
          if (
            forceCountRefresh ||
            totalRowsRef.current === null ||
            activeTableTargetRef.current !== targetTable
          ) {
            api
              .executeQuery(
                buildCountQuery(targetTable, activeConnectionRef.current.db_type)
              )
              .then((countRes) => {
                const rawCount = countRes.rows?.[0]?.[0];
                const parsedCount = Number(rawCount);
                if (!Number.isNaN(parsedCount)) {
                  setTotalRows(parsedCount);
                }
              })
              .catch((err) => {
                console.warn('Failed to resolve total table row count:', err);
                setTotalRows(null);
              });
          }
        } else if (!targetTable) {
          setActiveTableTarget(null);
          setTotalRows(null);
        }
      } catch (err: unknown) {
        const durationMs = Date.now() - startTime;
        const msg = err instanceof Error ? err.message : String(err);
        api
          .recordQueryHistory(sqlToRun, durationMs, 0, 'error')
          .catch((e) => console.error('Failed to log query history:', e));
        setError(msg || 'Execution failed');
        setResult(null);
        setEditAnalysis(null);
        setPrimaryKeyColumns([]);
        setTotalRows(null);
      } finally {
        setIsLoading(false);
      }
    },
    [detectedTableName, onQuerySuccess, resolveEditability]
  );

  /**
   * @brief Navigates to a new page index by rebuilding the paginated query and re-executing.
   * @param newPage Zero-based target page index.
   */
  const handlePageChange = useCallback(
    async (newPage: number) => {
      setPageIndex(newPage);
      const currentSql = queryRef.current;
      const dbType = activeConnection?.db_type ?? 'Postgres';
      const updatedSql = updateQueryPagination(currentSql, dbType, pageSize, newPage);
      setQuery(updatedSql);
      queryRef.current = updatedSql;
      await handleRun(updatedSql);
    },
    [activeConnection?.db_type, handleRun, pageSize]
  );

  /**
   * @brief Updates the pagination page size, resets to page 0, rebuilds the query, and re-executes.
   * @param newPageSize Target rows per page.
   */
  const handlePageSizeChange = useCallback(
    async (newPageSize: number) => {
      setPageSize(newPageSize);
      setPageIndex(0);
      const currentSql = queryRef.current;
      const dbType = activeConnection?.db_type ?? 'Postgres';
      const updatedSql = updateQueryPagination(currentSql, dbType, newPageSize, 0);
      setQuery(updatedSql);
      queryRef.current = updatedSql;
      await handleRun(updatedSql);
    },
    [activeConnection?.db_type, handleRun]
  );

  /**
   * @brief Refreshes the currently active query and resolves an updated table count.
   */
  const handleRefresh = useCallback(async () => {
    await handleRun(queryRef.current, true);
  }, [handleRun]);

  // Synchronize initialQuery updates from parent
  const prevInitialQueryRef = useRef(initialQuery);
  useEffect(() => {
    if (initialQuery !== prevInitialQueryRef.current) {
      prevInitialQueryRef.current = initialQuery;
      setQuery(initialQuery);
      queryRef.current = initialQuery;
      if (autoRun && initialQuery.trim()) {
        handleRun(initialQuery, true);
      }
    }
  }, [initialQuery, autoRun, handleRun]);

  // Handle autoRun on initial mount
  const hasAutoRunOnMount = useRef(false);
  useEffect(() => {
    if (autoRun && !hasAutoRunOnMount.current && initialQuery.trim()) {
      hasAutoRunOnMount.current = true;
      handleRun(initialQuery, true);
    }
  }, [autoRun, initialQuery, handleRun]);

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
   * @brief Analyzes query execution plan via backend explainQuery command and displays ExplainPlanModal.
   */
  const handleExplain = useCallback(async () => {
    const sqlToExplain = queryRef.current.trim();
    if (!sqlToExplain) return;

    setIsExplainOpen(true);
    setIsExplaining(true);
    setExplainError(null);

    try {
      const plan = await api.explainQuery(sqlToExplain);
      setExplainPlan(plan);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setExplainError(msg || 'Failed to analyze query execution plan');
    } finally {
      setIsExplaining(false);
    }
  }, []);


  /**
   * @brief Configures Monaco Editor keyboard shortcuts and registers SQL autocomplete provider.
   * @param editor Monaco editor instance.
   * @param monaco Global Monaco namespace.
   */
  const handleEditorDidMount: OnMount = useCallback(
    (editor, monaco) => {
      // Register Ctrl+Enter / Cmd+Enter shortcut
      editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter, () => {
        handleRun();
      });

      // Register schema-aware SQL completion provider
      if (!completionProviderRef.current && monaco?.languages?.registerCompletionItemProvider) {
        completionProviderRef.current = monaco.languages.registerCompletionItemProvider('sql', {
          triggerCharacters: ['.', ' '],
          provideCompletionItems: (model: any, position: any) => {
            const word = model.getWordUntilPosition(position);
            const range = {
              startLineNumber: position.lineNumber,
              endLineNumber: position.lineNumber,
              startColumn: word.startColumn,
              endColumn: word.endColumn,
            };
            const lineContent = model.getValueInRange({
              startLineNumber: position.lineNumber,
              startColumn: 1,
              endLineNumber: position.lineNumber,
              endColumn: position.column,
            });
            const suggestions = buildSqlCompletions(
              lineContent,
              schemaRef.current ?? null,
              range,
              monaco
            );
            return { suggestions };
          },
        });
      }
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
      data-testid="sql-query-editor-tab"
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
            onClick={() => handleRun()}
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

          <button
            type="button"
            data-testid="explain-plan-btn"
            onClick={handleExplain}
            disabled={isExplaining || !query.trim()}
            className="flex items-center space-x-1.5 bg-[#26282d] hover:bg-[#35373c] text-[#e6e8ea] px-3 py-1 rounded font-semibold border border-[#35373c] disabled:opacity-50 transition-colors shadow-xs cursor-pointer"
            title="Analyze query execution plan (EXPLAIN)"
          >
            {isExplaining ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin text-amber-400" />
            ) : (
              <Zap className="w-3.5 h-3.5 text-amber-400" />
            )}
            <span>Explain Plan</span>
          </button>

          <button
            type="button"
            data-testid="query-history-btn"
            onClick={() => setIsHistoryOpen(true)}
            className="flex items-center space-x-1.5 bg-[#26282d] hover:bg-[#35373c] text-[#e6e8ea] px-3 py-1 rounded font-semibold border border-[#35373c] transition-colors shadow-xs cursor-pointer"
            title="View query execution history"
          >
            <History className="w-3.5 h-3.5 text-blue-400" />
            <span>History</span>
          </button>

          {/* Safe Limit Selector Dropdown */}
          <div className="flex items-center space-x-1.5 bg-[#18191c] px-2 py-1 rounded border border-[#35373c] text-xs">
            <ShieldCheck
              className={`w-3.5 h-3.5 ${safeLimit > 0 ? 'text-[#20c997]' : 'text-[#8c919a]'}`}
            />
            <span className="text-[11px] text-[#8c919a]">Safe Limit:</span>
            <select
              aria-label="Safe Limit"
              value={safeLimit}
              onChange={(e) => setSafeLimit(Number(e.target.value))}
              className="bg-transparent text-[#e6e8ea] text-[11px] font-mono outline-none cursor-pointer"
            >
              <option value={100} className="bg-[#1e1f22]">
                100 rows
              </option>
              <option value={500} className="bg-[#1e1f22]">
                500 rows
              </option>
              <option value={1000} className="bg-[#1e1f22]">
                1000 rows
              </option>
              <option value={0} className="bg-[#1e1f22]">
                Off
              </option>
            </select>
          </div>

          {activeConnection && (
            <span className="text-[10px] text-[#8c919a] font-mono hidden sm:inline">
              Target: {activeConnection.name} ({activeConnection.db_type})
            </span>
          )}
        </div>

        {/* Execution Metadata Telemetry */}
        <div className="flex items-center space-x-3 text-[#8c919a] font-mono text-[11px]">
          {safeLimitNotice && (
            <span
              data-testid="safe-limit-badge"
              className="flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] bg-amber-500/10 border border-amber-500/30 text-amber-300 font-mono"
              title="Safe limit was automatically applied to this query."
            >
              <ShieldAlert className="w-3 h-3 text-amber-400" />
              <span>{safeLimitNotice}</span>
            </span>
          )}

          {result && editAnalysis && (
            <span
              data-testid="grid-edit-mode"
              className={`flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] border ${
                editAnalysis.editable
                  ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-300'
                  : 'bg-[#24262b] border-[#35373c] text-[#8c919a]'
              }`}
              title={editAnalysis.reason ?? `Editable via primary key (${primaryKeyColumns.join(', ')})`}
            >
              {editAnalysis.editable ? (
                <CheckCircle2 className="w-3 h-3" />
              ) : (
                <Lock className="w-3 h-3" />
              )}
              <span>{editAnalysis.editable ? 'Editable' : 'Read-only'}</span>
            </span>
          )}

          {result && (
            <div className="flex items-center space-x-2">
              <span data-testid="row-count">{result.rows.length} rows returned</span>
              <span>•</span>
              <span data-testid="exec-duration">{result.execution_time_ms} ms</span>
            </div>
          )}

          {result && (
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
          )}

          <button
            type="button"
            data-testid="export-data-btn"
            onClick={() => setIsExportOpen(true)}
            disabled={!result || result.rows.length === 0}
            className="flex items-center space-x-1.5 px-2.5 py-1 bg-[#26282d] hover:bg-[#35373c] disabled:opacity-50 disabled:cursor-not-allowed text-[#e6e8ea] rounded border border-[#35373c] text-[11px] font-mono cursor-pointer transition-colors shadow-xs"
            title="Export query results"
          >
            <Download className="w-3.5 h-3.5 text-[#3a82f7]" />
            <span>Export Data</span>
          </button>
        </div>
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
              tableName={editAnalysis?.table ?? detectedTableName}
              primaryKeyColumns={primaryKeyColumns}
              editDisabledReason={
                editAnalysis && !editAnalysis.editable
                  ? editAnalysis.reason
                  : primaryKeyColumns.length > 0
                  ? undefined
                  : 'Read-only: run a single-table SELECT to load the table primary key before editing.'
              }
              columns={result.columns}
              rows={result.rows}
              pagination={{
                currentPage: pageIndex,
                pageSize: pageSize,
                totalRows: totalRows,
                onPageChange: handlePageChange,
                onPageSizeChange: handlePageSizeChange,
                onRefresh: handleRefresh,
              }}
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

        {/* Export Data Wizard Modal */}
        <ExportModal
          isOpen={isExportOpen}
          tableName={detectedTableName === 'unknown' ? 'exported_table' : detectedTableName}
          columns={result?.columns ?? []}
          rows={result?.rows ?? []}
          onClose={() => setIsExportOpen(false)}
        />

        {/* Visual EXPLAIN Query Execution Plan Modal */}
        <ExplainPlanModal
          isOpen={isExplainOpen}
          onClose={() => setIsExplainOpen(false)}
          query={query}
          plan={explainPlan}
          isLoading={isExplaining}
          error={explainError}
        />

        {/* Persistent Query Execution History Modal */}
        <QueryHistoryModal
          isOpen={isHistoryOpen}
          onClose={() => setIsHistoryOpen(false)}
          onSelectQuery={handleSelectHistoryQuery}
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
