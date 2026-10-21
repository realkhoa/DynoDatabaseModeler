/**
 * @file QueryHistoryModal.tsx
 * @brief Modal dialog presenting persistent SQL query execution history and saved snippets.
 * @details Allows filtering queries by keyword and favorite status, toggling bookmarks,
 * copying queries, and injecting previous queries directly back into the editor.
 */

import React, { useState, useEffect, useMemo, useCallback } from 'react';
import {
  History,
  X,
  Search,
  Star,
  Copy,
  Check,
  Play,
  Trash2,
  Clock,
  CheckCircle2,
  AlertCircle,
  Database,
} from 'lucide-react';
import { api } from '../../api/ipc';
import type { QueryHistoryRecord } from '../../types/database';

/**
 * @brief Properties accepted by the QueryHistoryModal component.
 */
export interface QueryHistoryModalProps {
  /** @brief Whether the history modal dialog is currently visible. */
  isOpen: boolean;
  /** @brief Callback invoked to dismiss the modal dialog. */
  onClose: () => void;
  /** @brief Callback invoked when user selects a query to load into the editor. */
  onSelectQuery: (query: string) => void;
}

/**
 * @brief Formats an ISO 8601 timestamp into a readable localized date and time string.
 * @param isoString ISO timestamp string.
 * @return Human-readable date time string.
 */
function formatTimestamp(isoString: string): string {
  try {
    const date = new Date(isoString);
    if (isNaN(date.getTime())) return isoString;
    return date.toLocaleString(undefined, {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
  } catch {
    return isoString;
  }
}

/**
 * @brief Modal component for browsing and reusing recorded query executions.
 * @param props Component properties.
 * @return Rendered modal element or null when closed.
 */
export const QueryHistoryModal: React.FC<QueryHistoryModalProps> = ({
  isOpen,
  onClose,
  onSelectQuery,
}) => {
  const [records, setRecords] = useState<QueryHistoryRecord[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [searchFilter, setSearchFilter] = useState<string>('');
  const [onlyFavorites, setOnlyFavorites] = useState<boolean>(false);
  const [copiedId, setCopiedId] = useState<number | null>(null);

  const fetchHistory = useCallback(async () => {
    setIsLoading(true);
    try {
      const data = await api.getQueryHistory(200);
      setRecords(data);
    } catch (err) {
      console.error('Failed to load query history:', err);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (isOpen) {
      fetchHistory();
    }
  }, [isOpen, fetchHistory]);

  const handleToggleFavorite = async (id: number) => {
    try {
      const nextFav = await api.toggleFavoriteQuery(id);
      setRecords((prev) =>
        prev.map((r) => (r.id === id ? { ...r, is_favorite: nextFav } : r))
      );
    } catch (err) {
      console.error('Failed to toggle favorite query:', err);
    }
  };

  const handleClearHistory = async () => {
    if (!window.confirm('Clear all non-starred query history?')) return;
    try {
      await api.clearQueryHistory();
      setRecords((prev) => prev.filter((r) => r.is_favorite));
    } catch (err) {
      console.error('Failed to clear history:', err);
    }
  };

  const handleCopyQuery = (id: number, text: string) => {
    navigator.clipboard.writeText(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 1500);
  };

  const handleSelectQuery = (text: string) => {
    onSelectQuery(text);
    onClose();
  };

  const filteredRecords = useMemo(() => {
    return records.filter((r) => {
      if (onlyFavorites && !r.is_favorite) return false;
      if (searchFilter.trim() !== '') {
        const queryLower = r.query_text.toLowerCase();
        const searchLower = searchFilter.toLowerCase();
        if (!queryLower.includes(searchLower)) return false;
      }
      return true;
    });
  }, [records, onlyFavorites, searchFilter]);

  if (!isOpen) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="history-modal-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 animate-in fade-in duration-150"
    >
      <div className="flex flex-col w-full max-w-4xl h-[85vh] bg-[#18191c] border border-[#2c2e33] rounded-lg shadow-2xl overflow-hidden text-[#e6e8ea]">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-[#2c2e33] bg-[#1f2024] shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="p-1.5 rounded bg-blue-500/10 text-blue-400">
              <History className="w-5 h-5" />
            </div>
            <div>
              <h2 id="history-modal-title" className="text-sm font-semibold text-[#e6e8ea]">
                Query Execution History
              </h2>
              <p className="text-xs text-[#8c919a]">
                Persistent log of executed SQL statements, duration metrics, and saved snippets
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 text-[#8c919a] hover:text-[#e6e8ea] rounded hover:bg-[#2c2e33] transition-colors"
            title="Close dialog"
            aria-label="Close dialog"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Toolbar & Filters */}
        <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-3 border-b border-[#2c2e33] bg-[#1a1b1e] shrink-0">
          <div className="flex items-center gap-2 flex-1 min-w-[240px]">
            <div className="relative flex-1 max-w-md">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[#8c919a]" />
              <input
                type="text"
                placeholder="Search history by query text..."
                value={searchFilter}
                onChange={(e) => setSearchFilter(e.target.value)}
                className="w-full pl-9 pr-3 py-1.5 bg-[#121315] border border-[#2c2e33] rounded text-xs text-[#e6e8ea] placeholder-[#8c919a] focus:outline-none focus:border-blue-500"
              />
              {searchFilter && (
                <button
                  onClick={() => setSearchFilter('')}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[#8c919a] hover:text-[#e6e8ea]"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>

            <button
              onClick={() => setOnlyFavorites(!onlyFavorites)}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-medium border transition-colors ${
                onlyFavorites
                  ? 'bg-amber-500/15 border-amber-500/40 text-amber-400'
                  : 'bg-[#232428] border-[#2c2e33] text-[#c4c7cc] hover:bg-[#2c2e33]'
              }`}
              title="Show only bookmarked queries"
            >
              <Star className={`w-3.5 h-3.5 ${onlyFavorites ? 'fill-amber-400 text-amber-400' : ''}`} />
              Favorites Only
            </button>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={handleClearHistory}
              disabled={records.length === 0}
              className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs text-[#8c919a] hover:text-red-400 hover:bg-red-500/10 rounded transition-colors disabled:opacity-40 disabled:pointer-events-none"
              title="Clear non-starred history"
            >
              <Trash2 className="w-3.5 h-3.5" />
              Clear History
            </button>
          </div>
        </div>

        {/* Content List */}
        <div className="flex-1 overflow-y-auto p-4 space-y-2.5 bg-[#121315]">
          {isLoading ? (
            <div className="flex flex-col items-center justify-center h-48 text-[#8c919a] gap-2">
              <Clock className="w-6 h-6 animate-spin text-blue-400" />
              <span className="text-xs">Loading query history...</span>
            </div>
          ) : filteredRecords.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-64 text-[#8c919a] gap-2.5">
              <Database className="w-8 h-8 opacity-40" />
              <span className="text-xs text-[#8c919a] font-medium">No execution history found</span>
              <span className="text-[11px] text-[#8c919a]">
                {searchFilter || onlyFavorites
                  ? 'Try adjusting your search filters.'
                  : 'Executed SQL queries will appear here automatically.'}
              </span>
            </div>
          ) : (
            filteredRecords.map((record) => {
              const isSuccess = record.status === 'success';
              const isCopied = copiedId === record.id;

              return (
                <div
                  key={record.id}
                  className="group flex flex-col bg-[#18191c] border border-[#24262b] hover:border-[#383a42] rounded-md overflow-hidden transition-colors shadow-sm"
                >
                  {/* Top Bar of Record */}
                  <div className="flex items-center justify-between px-3.5 py-2 bg-[#1b1c20] border-b border-[#24262b] text-[11px]">
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => handleToggleFavorite(record.id)}
                        className="text-[#8c919a] hover:text-amber-400 transition-colors"
                        title={record.is_favorite ? 'Remove bookmark' : 'Bookmark as favorite snippet'}
                        aria-label={record.is_favorite ? 'Remove favorite' : 'Add favorite'}
                      >
                        <Star
                          className={`w-3.5 h-3.5 ${
                            record.is_favorite ? 'fill-amber-400 text-amber-400' : ''
                          }`}
                        />
                      </button>

                      <span
                        className={`inline-flex items-center gap-1 font-medium px-1.5 py-0.5 rounded text-[10px] ${
                          isSuccess
                            ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
                            : 'bg-red-500/10 text-red-400 border border-red-500/20'
                        }`}
                      >
                        {isSuccess ? (
                          <CheckCircle2 className="w-3 h-3" />
                        ) : (
                          <AlertCircle className="w-3 h-3" />
                        )}
                        {record.status.toUpperCase()}
                      </span>

                      <span className="text-[#8c919a] flex items-center gap-1">
                        <Clock className="w-3 h-3 text-[#8c919a]" />
                        {formatTimestamp(record.executed_at)}
                      </span>
                    </div>

                    <div className="flex items-center gap-3">
                      <span className="text-[#8c919a] font-mono text-[10px]">
                        {record.duration_ms} ms
                      </span>
                      <span className="text-[#8c919a] font-mono text-[10px]">
                        {record.rows_count} {record.rows_count === 1 ? 'row' : 'rows'}
                      </span>

                      <div className="flex items-center gap-1 ml-2">
                        <button
                          onClick={() => handleCopyQuery(record.id, record.query_text)}
                          className="flex items-center gap-1 px-2 py-0.5 text-[#8c919a] hover:text-[#e6e8ea] bg-[#222428] hover:bg-[#2c2e33] rounded transition-colors text-[10px]"
                          title="Copy SQL to clipboard"
                        >
                          {isCopied ? (
                            <>
                              <Check className="w-3 h-3 text-emerald-400" />
                              <span className="text-emerald-400">Copied</span>
                            </>
                          ) : (
                            <>
                              <Copy className="w-3 h-3" />
                              <span>Copy</span>
                            </>
                          )}
                        </button>

                        <button
                          onClick={() => handleSelectQuery(record.query_text)}
                          className="flex items-center gap-1 px-2 py-0.5 text-blue-400 hover:text-[#e6e8ea] bg-blue-500/10 hover:bg-blue-600 rounded transition-colors text-[10px] font-medium"
                          title="Load SQL query into editor"
                        >
                          <Play className="w-2.5 h-2.5 fill-current" />
                          <span>Use Query</span>
                        </button>
                      </div>
                    </div>
                  </div>

                  {/* SQL Statement Content */}
                  <div className="p-3 bg-[#131416] font-mono text-xs text-[#c4c7cc] overflow-x-auto whitespace-pre-wrap select-text leading-relaxed">
                    {record.query_text}
                  </div>
                </div>
              );
            })
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-5 py-2.5 border-t border-[#2c2e33] bg-[#1a1b1e] text-xs text-[#8c919a] shrink-0">
          <span>
            Showing {filteredRecords.length} of {records.length} queries
          </span>
          <button
            onClick={onClose}
            className="px-3.5 py-1 text-[#c4c7cc] hover:text-[#e6e8ea] bg-[#26282d] hover:bg-[#2f3137] rounded transition-colors text-xs"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
};
