/**
 * @file ProcessListModal.tsx
 * @brief Modal dialog for monitoring active database queries and terminating runaway processes.
 * @details Displays currently active server sessions, query execution runtime, client addresses,
 * and enables database administrators to safely terminate runaway queries, inspired by Antares SQL
 * process manager and DBeaver session manager.
 */

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  X,
  Activity,
  RotateCw,
  Search,
  AlertTriangle,
  Loader2,
} from 'lucide-react';
import { api } from '../../api/ipc';
import type { DatabaseType, ConnectionConfig } from '../../types/database';
import {
  getProcessListQuery,
  getKillQuery,
  parseProcessListResult,
  type ProcessItem,
} from '../../utils/processQueries';

/**
 * @brief Properties accepted by the ProcessListModal component.
 */
export interface ProcessListModalProps {
  /** @brief Whether the modal dialog is currently visible. */
  isOpen: boolean;
  /** @brief Callback triggered when user requests closing the modal. */
  onClose: () => void;
  /** @brief Database engine dialect of the active connection. */
  dbType?: DatabaseType;
  /** @brief Active connection profile. */
  activeConnection?: ConnectionConfig | null;
  /** @brief Optional callback to execute custom SQL queries (defaults to api.executeQuery). */
  customExecuteSql?: (sql: string) => Promise<any>;
}

/**
 * @brief Interactive Process List Modal component.
 * @param props Component properties.
 * @return Rendered modal element or null if closed.
 */
export function ProcessListModal({
  isOpen,
  onClose,
  dbType: propDbType,
  activeConnection,
  customExecuteSql,
}: ProcessListModalProps): React.ReactElement | null {
  const dbType: DatabaseType = propDbType ?? activeConnection?.db_type ?? 'Postgres';
  const [processes, setProcesses] = useState<ProcessItem[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [autoRefreshSec, setAutoRefreshSec] = useState<number>(0);
  const [terminatingPid, setTerminatingPid] = useState<string | number | null>(null);
  const [killConfirmPid, setKillConfirmPid] = useState<ProcessItem | null>(null);
  const [actionMessage, setActionMessage] = useState<string | null>(null);

  const execute = useCallback(
    async (sql: string) => {
      if (customExecuteSql) {
        return customExecuteSql(sql);
      }
      return api.executeQuery(sql);
    },
    [customExecuteSql]
  );

  const fetchProcesses = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const sql = getProcessListQuery(dbType);
      const result = await execute(sql);
      const parsed = parseProcessListResult(result, dbType);
      setProcesses(parsed);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg || 'Failed to fetch active database processes');
    } finally {
      setIsLoading(false);
    }
  }, [dbType, execute]);

  useEffect(() => {
    if (isOpen) {
      fetchProcesses();
      setActionMessage(null);
      setKillConfirmPid(null);
    }
  }, [isOpen, fetchProcesses]);

  // Auto-refresh interval
  useEffect(() => {
    if (!isOpen || autoRefreshSec <= 0) return;
    const interval = setInterval(() => {
      fetchProcesses();
    }, autoRefreshSec * 1000);
    return () => clearInterval(interval);
  }, [isOpen, autoRefreshSec, fetchProcesses]);

  const handleKill = useCallback(
    async (item: ProcessItem) => {
      setTerminatingPid(item.pid);
      setActionMessage(null);
      setError(null);
      try {
        const killSql = getKillQuery(item.pid, dbType);
        await execute(killSql);
        setActionMessage(`Process #${item.pid} terminated successfully.`);
        setKillConfirmPid(null);
        await fetchProcesses();
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        setError(`Failed to terminate process #${item.pid}: ${msg}`);
      } finally {
        setTerminatingPid(null);
      }
    },
    [dbType, execute, fetchProcesses]
  );

  const filteredProcesses = useMemo(() => {
    if (!searchQuery.trim()) return processes;
    const q = searchQuery.toLowerCase();
    return processes.filter(
      (p) =>
        String(p.pid).includes(q) ||
        (p.user && p.user.toLowerCase().includes(q)) ||
        (p.database && p.database.toLowerCase().includes(q)) ||
        (p.client && p.client.toLowerCase().includes(q)) ||
        (p.state && p.state.toLowerCase().includes(q)) ||
        (p.query && p.query.toLowerCase().includes(q))
    );
  }, [processes, searchQuery]);

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="process-list-modal-title"
    >
      <div className="flex flex-col w-full max-w-5xl h-[85vh] bg-[#1e1f22] border border-[#35383f] rounded-xl shadow-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-150">
        {/* Header Bar */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-[#2d3139] bg-[#24262b]">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-emerald-500/10 border border-emerald-500/20 rounded-lg text-emerald-400">
              <Activity className="w-5 h-5" />
            </div>
            <div>
              <h2 id="process-list-modal-title" className="text-base font-semibold text-[#f1f2f4]">
                Active Database Processes & Queries
              </h2>
              <p className="text-xs text-[#8c919a]">
                Live server sessions, ongoing execution threads, and query termination ({dbType})
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

        {/* Toolbar */}
        <div className="flex flex-wrap items-center justify-between gap-4 px-6 py-3 border-b border-[#2d3139] bg-[#1a1b1e]">
          <div className="flex items-center gap-2 flex-1 max-w-md">
            <div className="relative w-full">
              <Search className="w-4 h-4 absolute left-3 top-2.5 text-[#8c919a]" />
              <input
                type="text"
                placeholder="Search processes by query, user, database..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full pl-9 pr-3 py-1.5 bg-[#24262b] border border-[#35383f] text-xs text-[#f1f2f4] placeholder-[#8c919a] rounded-lg focus:outline-hidden focus:border-emerald-500 transition-colors"
              />
            </div>
          </div>

          <div className="flex items-center gap-3">
            {/* Auto refresh select */}
            <div className="flex items-center gap-2 text-xs text-[#8c919a]">
              <span>Auto-refresh:</span>
              <select
                value={autoRefreshSec}
                onChange={(e) => setAutoRefreshSec(Number(e.target.value))}
                className="bg-[#24262b] border border-[#35383f] text-[#f1f2f4] text-xs rounded-md px-2 py-1 focus:outline-hidden focus:border-emerald-500 cursor-pointer"
              >
                <option value={0}>Off</option>
                <option value={2}>2s</option>
                <option value={5}>5s</option>
                <option value={10}>10s</option>
                <option value={30}>30s</option>
              </select>
            </div>

            <button
              onClick={fetchProcesses}
              disabled={isLoading}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-[#24262b] hover:bg-[#2d3139] disabled:opacity-50 text-[#f1f2f4] text-xs font-medium rounded-lg border border-[#35383f] transition-colors cursor-pointer"
              title="Refresh process list"
            >
              <RotateCw className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin text-emerald-400' : ''}`} />
              <span>Refresh</span>
            </button>
          </div>
        </div>

        {/* Feedback / Alert Banners */}
        {error && (
          <div className="px-6 py-2.5 bg-red-500/10 border-b border-red-500/20 text-red-300 text-xs flex items-center justify-between">
            <span>{error}</span>
            <button onClick={() => setError(null)} className="text-red-400 hover:text-red-200">
              <X className="w-4 h-4" />
            </button>
          </div>
        )}

        {actionMessage && (
          <div className="px-6 py-2.5 bg-emerald-500/10 border-b border-emerald-500/20 text-emerald-300 text-xs flex items-center justify-between">
            <span>{actionMessage}</span>
            <button onClick={() => setActionMessage(null)} className="text-emerald-400 hover:text-emerald-200">
              <X className="w-4 h-4" />
            </button>
          </div>
        )}

        {/* Processes Table Container */}
        <div className="flex-1 overflow-auto bg-[#141518]">
          <table className="w-full text-left text-xs border-collapse">
            <thead className="sticky top-0 bg-[#1e1f22] border-b border-[#2d3139] text-[#8c919a] uppercase text-[10px] tracking-wider z-10">
              <tr>
                <th className="py-2.5 px-4 font-semibold w-24">PID</th>
                <th className="py-2.5 px-4 font-semibold">User</th>
                <th className="py-2.5 px-4 font-semibold">Database</th>
                <th className="py-2.5 px-4 font-semibold">Client</th>
                <th className="py-2.5 px-4 font-semibold">State</th>
                <th className="py-2.5 px-4 font-semibold">Duration</th>
                <th className="py-2.5 px-4 font-semibold min-w-[280px]">Active Query</th>
                <th className="py-2.5 px-4 font-semibold text-right w-24">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#24262b] text-[#f1f2f4]">
              {filteredProcesses.length === 0 ? (
                <tr>
                  <td colSpan={8} className="py-12 text-center text-[#8c919a]">
                    {isLoading ? (
                      <div className="flex items-center justify-center gap-2">
                        <Loader2 className="w-4 h-4 animate-spin text-emerald-400" />
                        <span>Querying server activity...</span>
                      </div>
                    ) : (
                      <span>No active query processes matching filter.</span>
                    )}
                  </td>
                </tr>
              ) : (
                filteredProcesses.map((proc) => {
                  const isTerminating = terminatingPid === proc.pid;
                  const isRunaway = proc.duration && (proc.duration.startsWith('00:') === false || Number(proc.duration.split(':')[1]) > 5);

                  return (
                    <tr
                      key={String(proc.pid)}
                      className={`hover:bg-[#1a1b1e] transition-colors ${
                        isRunaway ? 'bg-amber-500/5' : ''
                      }`}
                    >
                      <td className="py-2.5 px-4 font-mono font-bold text-emerald-400">
                        {proc.pid}
                      </td>
                      <td className="py-2.5 px-4 text-[#8c919a]">{proc.user ?? '-'}</td>
                      <td className="py-2.5 px-4 font-mono text-[#a9b1d6]">{proc.database ?? '-'}</td>
                      <td className="py-2.5 px-4 text-[#8c919a] font-mono">{proc.client ?? '-'}</td>
                      <td className="py-2.5 px-4">
                        <span
                          className={`px-2 py-0.5 rounded text-[10px] font-medium ${
                            proc.state === 'active' || proc.state === 'running'
                              ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
                              : 'bg-zinc-700/30 text-[#8c919a]'
                          }`}
                        >
                          {proc.state ?? 'unknown'}
                        </span>
                      </td>
                      <td className="py-2.5 px-4 font-mono text-[#8c919a]">{proc.duration ?? '-'}</td>
                      <td className="py-2.5 px-4 font-mono text-[11px] text-[#a9b1d6] max-w-md truncate select-text" title={proc.query}>
                        {proc.query || <span className="text-[#565f89] italic">-- idle</span>}
                      </td>
                      <td className="py-2.5 px-4 text-right">
                        {dbType !== 'Sqlite' && dbType !== 'DuckDb' && (
                          <button
                            type="button"
                            onClick={() => setKillConfirmPid(proc)}
                            disabled={isTerminating}
                            className="px-2.5 py-1 text-[11px] font-medium bg-red-500/10 hover:bg-red-500/20 text-red-400 border border-red-500/20 rounded transition-colors disabled:opacity-50 cursor-pointer"
                            title={`Terminate process #${proc.pid}`}
                          >
                            {isTerminating ? (
                              <Loader2 className="w-3 h-3 animate-spin mx-auto" />
                            ) : (
                              'Kill'
                            )}
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-6 py-3 border-t border-[#2d3139] bg-[#24262b] text-xs text-[#8c919a]">
          <div>
            <span>Total processes: {processes.length}</span>
            {searchQuery && (
              <span className="ml-2">({filteredProcesses.length} matching filter)</span>
            )}
          </div>
          <div>Dialect: <span className="font-mono text-[#f1f2f4]">{dbType}</span></div>
        </div>
      </div>

      {/* Kill Process Confirmation Dialog */}
      {killConfirmPid && (
        <div className="fixed inset-0 z-60 flex items-center justify-center bg-black/70 p-4 animate-in fade-in duration-100">
          <div className="max-w-md w-full bg-[#1e1f22] border border-red-500/30 rounded-xl p-5 shadow-2xl space-y-4">
            <div className="flex items-center gap-3 text-red-400">
              <div className="p-2 bg-red-500/10 rounded-lg">
                <AlertTriangle className="w-5 h-5" />
              </div>
              <div>
                <h3 className="font-semibold text-sm text-[#f1f2f4]">Terminate Process #{killConfirmPid.pid}?</h3>
                <p className="text-xs text-[#8c919a]">This will immediately abort the query session.</p>
              </div>
            </div>

            {killConfirmPid.query && (
              <div className="p-2.5 bg-[#141518] border border-[#2d3139] rounded font-mono text-[11px] text-[#a9b1d6] max-h-24 overflow-auto">
                {killConfirmPid.query}
              </div>
            )}

            <div className="flex items-center justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setKillConfirmPid(null)}
                className="px-3 py-1.5 bg-[#24262b] hover:bg-[#2d3139] text-[#f1f2f4] text-xs font-medium rounded-lg border border-[#35383f] transition-colors cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => handleKill(killConfirmPid)}
                className="px-3.5 py-1.5 bg-red-600 hover:bg-red-500 text-white text-xs font-medium rounded-lg shadow-sm transition-colors cursor-pointer"
              >
                Terminate Query
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
