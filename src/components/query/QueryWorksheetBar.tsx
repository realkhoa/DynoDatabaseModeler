/**
 * @file QueryWorksheetBar.tsx
 * @brief Horizontal tab bar component for managing multiple SQL query worksheets.
 * @details Provides multi-tab navigation, tab switching, inline double-click renaming,
 * tab closure, and creation of new query tabs in dark aesthetic.
 */

import React, { useState, useRef, useEffect, useCallback } from 'react';
import { Plus, X, FileCode } from 'lucide-react';
import type { QueryResult, ExecutionPlanNode } from '../../types/database';

/**
 * @brief Execution plan type alias for query worksheet compatibility.
 */
export type ExplainPlanResult = ExecutionPlanNode;

/**
 * @brief Data model representing an isolated query worksheet tab session.
 */
export interface QueryWorksheet {
  /** @brief Unique worksheet identifier (e.g., 'ws-1'). */
  id: string;
  /** @brief Display title on the tab bar (e.g., 'Query 1', 'users'). */
  title: string;
  /** @brief Current SQL query buffer text. */
  query: string;
  /** @brief Most recent query execution result or null. */
  result: QueryResult | null;
  /** @brief Tab-specific safe limit constraint (e.g., 500, 1000, 0=Off). */
  safeLimit: number;
  /** @brief Safe limit notification badge text or null. */
  safeLimitNotice: string | null;
  /** @brief Zero-based current page index for server-side pagination. */
  pageIndex: number;
  /** @brief Page size limit for server-side pagination. */
  pageSize: number;
  /** @brief Total row count in target table/result or null. */
  totalRows: number | null;
  /** @brief Execution error message or null. */
  error: string | null;
  /** @brief Query execution plan tree if analyzed. */
  explainPlan: ExecutionPlanNode | null;
}

/**
 * @brief Configuration properties accepted by the QueryWorksheetBar component.
 */
export interface QueryWorksheetBarProps {
  /** @brief Ordered list of active query worksheets. */
  worksheets: QueryWorksheet[];
  /** @brief Unique identifier of the currently active worksheet. */
  activeId: string;
  /** @brief Callback triggered when user selects a worksheet tab. */
  onSelect: (id: string) => void;
  /** @brief Callback triggered when user clicks the '+' button to add a worksheet. */
  onAdd: () => void;
  /** @brief Callback triggered when user clicks the close button on a worksheet. */
  onClose: (id: string) => void;
  /** @brief Callback triggered when user renames a worksheet tab. */
  onRename: (id: string, newTitle: string) => void;
}

/**
 * @brief Horizontal tab bar component for managing multi-tab SQL worksheets.
 * @param props Component properties configuring tabs and lifecycle handlers.
 * @return Rendered QueryWorksheetBar React element.
 */
export const QueryWorksheetBar: React.FC<QueryWorksheetBarProps> = ({
  worksheets,
  activeId,
  onSelect,
  onAdd,
  onClose,
  onRename,
}) => {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingTitle, setEditingTitle] = useState<string>('');
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (editingId && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [editingId]);

  /**
   * @brief Initiates inline rename mode for the specified worksheet tab.
   * @param ws Target query worksheet to rename.
   */
  const handleStartRename = useCallback((ws: QueryWorksheet) => {
    setEditingId(ws.id);
    setEditingTitle(ws.title);
  }, []);

  /**
   * @brief Commits the pending title rename and exits edit mode.
   */
  const handleCommitRename = useCallback(() => {
    if (!editingId) return;
    const trimmed = editingTitle.trim();
    const currentWorksheet = worksheets.find((w) => w.id === editingId);

    if (trimmed.length > 0 && currentWorksheet && trimmed !== currentWorksheet.title) {
      onRename(editingId, trimmed);
    }
    setEditingId(null);
  }, [editingId, editingTitle, worksheets, onRename]);

  /**
   * @brief Cancels pending inline rename and reverts to previous title.
   */
  const handleCancelRename = useCallback(() => {
    setEditingId(null);
    setEditingTitle('');
  }, []);

  /**
   * @brief Handles keyboard events inside the inline rename text input.
   * @param event Keyboard event triggered inside input element.
   */
  const handleInputKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLInputElement>) => {
      event.stopPropagation();
      if (event.key === 'Enter') {
        event.preventDefault();
        handleCommitRename();
      } else if (event.key === 'Escape') {
        event.preventDefault();
        handleCancelRename();
      }
    },
    [handleCommitRename, handleCancelRename]
  );

  /**
   * @brief Handles keyboard navigation for tab pill selection.
   * @param event Keyboard event on tab pill element.
   * @param id Target worksheet identifier.
   */
  const handleTabKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>, id: string) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        onSelect(id);
      }
    },
    [onSelect]
  );

  return (
    <div
      role="tablist"
      aria-label="SQL Worksheets"
      className={
        'flex items-center overflow-x-auto no-scrollbar border-b ' +
        'border-[#2b2d31] bg-[#18191c] px-2 pt-1 gap-1 select-none'
      }
    >
      {worksheets.map((ws) => {
        const isActive = ws.id === activeId;
        const isEditing = editingId === ws.id;

        return (
          <div
            key={ws.id}
            role="tab"
            aria-selected={isActive}
            tabIndex={0}
            onClick={() => onSelect(ws.id)}
            onDoubleClick={() => handleStartRename(ws)}
            onKeyDown={(e) => handleTabKeyDown(e, ws.id)}
            className={[
              'group relative flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium',
              'rounded-t transition-colors cursor-pointer border-r border-[#26282c] border-t-2',
              isActive
                ? 'bg-[#1e1f22] text-[#e6e8ea] border-t-[#3a82f7]'
                : 'text-[#8c919a] hover:bg-[#202226] hover:text-[#e6e8ea] border-t-transparent',
            ].join(' ')}
          >
            <FileCode
              className={`w-3.5 h-3.5 shrink-0 ${
                isActive ? 'text-[#3a82f7]' : 'text-[#8c919a] group-hover:text-[#e6e8ea]'
              }`}
            />

            {isEditing ? (
              <input
                ref={inputRef}
                type="text"
                value={editingTitle}
                onChange={(e) => setEditingTitle(e.target.value)}
                onKeyDown={handleInputKeyDown}
                onBlur={handleCommitRename}
                onClick={(e) => e.stopPropagation()}
                className={[
                  'bg-[#141517] text-[#e6e8ea] px-1 py-0.5 rounded text-xs',
                  'outline-none border border-[#3a82f7] w-28',
                ].join(' ')}
              />
            ) : (
              <span className="truncate max-w-[160px]" title={ws.title}>
                {ws.title}
              </span>
            )}

            {worksheets.length > 1 && (
              <button
                type="button"
                data-testid="close-worksheet-btn"
                aria-label={`Close ${ws.title}`}
                title={`Close ${ws.title}`}
                onClick={(e) => {
                  e.stopPropagation();
                  onClose(ws.id);
                }}
                className={
                  'ml-1 p-0.5 rounded hover:bg-[#2e3035] ' +
                  'text-[#8c919a] hover:text-[#e6e8ea] transition-colors'
                }
              >
                <X className="w-3 h-3" />
              </button>
            )}
          </div>
        );
      })}

      <button
        type="button"
        data-testid="add-worksheet-btn"
        aria-label="New Query Worksheet"
        title="New Query Worksheet"
        onClick={onAdd}
        className={
          'flex items-center justify-center p-1.5 ml-1 text-[#8c919a] ' +
          'hover:text-[#e6e8ea] hover:bg-[#202226] rounded transition-colors cursor-pointer'
        }
      >
        <Plus className="w-3.5 h-3.5" />
      </button>
    </div>
  );
};
