/**
 * @file EditableDataGrid.tsx
 * @brief High-performance interactive editable data grid with dirty-cell tracking.
 * @details Supports single-click cell selection, double-click inline cell editing and visual dirty
 * state highlighting. Saving is only possible when a real primary key is known: every payload is
 * built from the primary key columns, sent in strict single-row mode, and rows without a complete
 * key are refused locally so an edit can never update unrelated rows.
 */

import React, { useState, useEffect, useRef, useCallback, useMemo, useImperativeHandle } from 'react';
import {
  Save,
  Undo2,
  AlertCircle,
  Loader2,
  Lock,
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  RotateCw,
  Search,
  X,
} from 'lucide-react';
import type { RowUpdatePayload } from '../../types/database';
import { useVirtualRows } from '../../utils/useVirtualRows';
import { useDebouncedValue } from '../../utils/useDebouncedValue';

/**
 * @brief Fixed row height in pixels for virtual windowing calculations.
 */
const ROW_HEIGHT = 28;

/**
 * @brief State and navigation callbacks for interactive pagination in EditableDataGrid.
 */
export interface DataPaginationState {
  /** @brief Current zero-based active page index. */
  currentPage: number;
  /** @brief Number of rows fetched per page. */
  pageSize: number;
  /** @brief Total row count across entire table or result set, or null/undefined if unknown. */
  totalRows?: number | null;
  /**
   * @brief Callback invoked when user requests navigating to a different page index.
   * @param newPage Target zero-based page number.
   */
  onPageChange: (newPage: number) => void;
  /**
   * @brief Callback invoked when user selects a different page size option.
   * @param newPageSize Selected rows per page number.
   */
  onPageSizeChange: (newPageSize: number) => void;
  /** @brief Optional callback invoked when user clicks the refresh page action. */
  onRefresh?: () => void;
}

/**
 * @brief Imperative handle exposed by EditableDataGrid for external cell mutations.
 */
export interface EditableDataGridHandle {
  /**
   * @brief Programmatically updates a specific cell value and marks it dirty.
   * @param rowIndex Zero-based row index.
   * @param colIndex Zero-based column index.
   * @param newValue New value to set for the cell.
   */
  updateCell: (rowIndex: number, colIndex: number, newValue: any) => void;
  /**
   * @brief Retrieves the current number of pending unsaved dirty cell modifications.
   * @return Count of modified cells.
   */
  getDirtyCount?: () => number;
}

/**
 * @brief Properties accepted by the EditableDataGrid component.
 */
export interface EditableDataGridProps {
  /** @brief Optional name of the underlying table being queried/edited. */
  tableName?: string;
  /**
   * @brief Primary key column names that uniquely identify a row.
   * @details When empty or omitted the grid is read-only: without a verified key there is no safe
   * way to target a single row.
   */
  primaryKeyColumns?: string[];
  /** @brief Explanation shown when editing is unavailable. */
  editDisabledReason?: string;
  /** @brief List of column header names to render in the grid. */
  columns: string[];
  /** @brief Two-dimensional array of row values to display. */
  rows: any[][];
  /** @brief Async callback triggered when user confirms changes in the mutation bar. */
  onSave?: (updates: RowUpdatePayload[]) => Promise<void>;
  /** @brief Flag indicating whether a save mutation is actively in flight. */
  isSaving?: boolean;
  /** @brief Callback triggered when user selects a cell. */
  onCellSelect?: (colName: string, value: any) => void;
  /** @brief Optional callback triggered with full cell coordinate metadata when selected. */
  onCellPositionSelect?: (pos: { rowIndex: number; colIndex: number; columnName: string; value: any }) => void;
  /** @brief Selected cell coordinate if controlled externally. */
  selectedCell?: { rowIndex: number; colIndex: number } | null;
  /** @brief Optional pagination configuration and callbacks to render the interactive pagination toolbar. */
  pagination?: DataPaginationState;
  /** @brief Optional fixed row height in pixels for virtual windowing calculations. Defaults to 28. */
  rowHeight?: number;
}

/**
 * @brief Tracked dirty cell representation storing original and pending values.
 */
interface DirtyCellRecord {
  /** @brief Original row value before editing. */
  originalValue: any;
  /** @brief New modified value entered by user. */
  newValue: any;
  /** @brief Zero-based row index in dataset. */
  rowIndex: number;
  /** @brief Zero-based column index in dataset. */
  colIndex: number;
}

/**
 * @brief Coordinates identifying a specific cell within the grid.
 */
interface CellCoord {
  /** @brief Zero-based row index. */
  rowIndex: number;
  /** @brief Zero-based column index. */
  colIndex: number;
}

/**
 * @brief Formats an arbitrary cell value for read-only tabular presentation.
 * @param val Value to format (string, number, boolean, object, or null/undefined).
 * @return Rendered React node.
 */
export function renderGridCellValue(val: unknown): React.ReactNode {
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
 * @brief Converts an input string into a typed value matching the original type if possible.
 * @param input Raw text string entered by user.
 * @param original Original value previously stored in the cell.
 * @return Parsed typed value.
 */
export function parseEditedValue(input: string, original: unknown): unknown {
  if (original === null || original === undefined) {
    if (input === '' || input.trim().toUpperCase() === 'NULL') {
      return null;
    }
    if (!isNaN(Number(input)) && input.trim() !== '') {
      return Number(input);
    }
    return input;
  }

  if (typeof original === 'number') {
    if (input.trim() !== '' && !isNaN(Number(input))) {
      return Number(input);
    }
    return input;
  }

  if (typeof original === 'boolean') {
    const lower = input.trim().toLowerCase();
    if (lower === 'true') return true;
    if (lower === 'false') return false;
    return input;
  }

  return input;
}

/**
 * @brief Interactive Editable Data Grid component with inline editing and dirty-cell tracking.
 * @param props Component properties.
 * @return Rendered EditableDataGrid element.
 */
/**
 * @brief Properties accepted by the memoized GridRow component.
 */
interface GridRowProps {
  /** @brief Zero-based row index. */
  rIdx: number;
  /** @brief Raw data cells for this row. */
  row: any[];
  /** @brief Header column names array. */
  columns: string[];
  /** @brief Selected column index in this row, or null if no cell in this row is selected. */
  selectedColIndex: number | null;
  /** @brief Editing column index in this row, or null if no cell in this row is being edited. */
  editingColIndex: number | null;
  /** @brief Map of dirty cell records in this row keyed by column index. */
  dirtyMap?: Record<number, DirtyCellRecord>;
  /** @brief Text value for the active input element if editing. */
  editValue: string;
  /** @brief Ref forwarded to the input element when editing. */
  inputRef: React.RefObject<HTMLInputElement | null>;
  /** @brief Callback triggered on single cell click. */
  onCellClick: (r: number, c: number) => void;
  /** @brief Callback triggered on double cell click. */
  onCellDoubleClick: (r: number, c: number) => void;
  /** @brief Callback triggered when edit input changes. */
  onEditChange: (val: string) => void;
  /** @brief Callback triggered on keyboard events in edit input. */
  onInputKeyDown: (e: React.KeyboardEvent<HTMLInputElement>) => void;
  /** @brief Callback triggered when edit input loses focus. */
  onInputBlur: () => void;
  /** @brief Row height in pixels for virtual row rendering. */
  rowHeight?: number;
}

/**
 * @brief Memoized individual row component inside EditableDataGrid.
 * @details Isolates rendering so that cell clicks and edits in one row do not force
 * other unaffected rows to re-render, optimizing performance for large result sets.
 * @param props GridRow properties.
 * @return Rendered HTML table row.
 */
const GridRow: React.FC<GridRowProps> = React.memo(
  ({
    rIdx,
    row,
    columns,
    selectedColIndex,
    editingColIndex,
    dirtyMap,
    editValue,
    inputRef,
    onCellClick,
    onCellDoubleClick,
    onEditChange,
    onInputKeyDown,
    onInputBlur,
    rowHeight = ROW_HEIGHT,
  }) => {
    return (
      <tr style={{ height: `${rowHeight}px` }} className="border-b border-[#2b2d30] hover:bg-[#24262b]/80 transition-colors">
        {columns.map((_, cIdx) => {
          const isDirty = dirtyMap?.[cIdx] !== undefined;
          const isEditing = editingColIndex === cIdx;
          const isSelected = selectedColIndex === cIdx;
          const effectiveValue = isDirty ? dirtyMap![cIdx].newValue : row?.[cIdx];

          return (
            <td
              key={cIdx}
              data-dirty={isDirty ? 'true' : undefined}
              data-selected={isSelected ? 'true' : undefined}
              onClick={() => onCellClick(rIdx, cIdx)}
              onDoubleClick={() => onCellDoubleClick(rIdx, cIdx)}
              className={`px-3 py-1.5 text-[11px] whitespace-nowrap max-w-[320px] truncate border-r border-[#2b2d30]/50 last:border-r-0 cursor-pointer relative transition-colors ${
                isDirty
                  ? 'border-amber-500/60 bg-amber-500/10 text-amber-200'
                  : isSelected
                  ? 'ring-1 ring-[#3a82f7] ring-inset bg-[#26282d]'
                  : ''
              }`}
            >
              {isEditing ? (
                <input
                  ref={inputRef}
                  type="text"
                  value={editValue}
                  onChange={(e) => onEditChange(e.target.value)}
                  onKeyDown={onInputKeyDown}
                  onBlur={onInputBlur}
                  className="w-full bg-[#121316] text-[#e6e8ea] border border-[#3a82f7] rounded-xs px-1 py-0.5 outline-hidden text-[11px] font-mono shadow-inner"
                />
              ) : (
                <div className="flex items-center justify-between gap-1 overflow-hidden">
                  <span className="truncate">
                    {renderGridCellValue(effectiveValue)}
                  </span>
                  {isDirty && (
                    <span
                      className="w-1.5 h-1.5 rounded-full bg-amber-400 shrink-0"
                      title="Modified cell"
                    />
                  )}
                </div>
              )}
            </td>
          );
        })}
      </tr>
    );
  }
);
GridRow.displayName = 'GridRow';

export const EditableDataGrid = React.memo(
  React.forwardRef<EditableDataGridHandle, EditableDataGridProps>(
  (
    {
      tableName = 'unknown',
      primaryKeyColumns,
      editDisabledReason,
      columns,
      rows,
      pagination,
      onSave,
      isSaving = false,
      onCellSelect,
      onCellPositionSelect,
      selectedCell: controlledSelectedCell,
      rowHeight: customRowHeight,
    },
    ref
  ) => {
    const effectiveRowHeight = customRowHeight ?? ROW_HEIGHT;
    // Editing requires a verified primary key; there is no safe fallback locator.
    const canEdit = Boolean(primaryKeyColumns && primaryKeyColumns.length > 0);

    // Dirty cells map keyed by `${rowIndex}_${colIndex}`
    const [dirtyCells, setDirtyCells] = useState<Record<string, DirtyCellRecord>>({});

    // Active cell being edited
    const [editingCell, setEditingCell] = useState<CellCoord | null>(null);
    const [editValue, setEditValue] = useState<string>('');

    // Internal selected cell tracking when uncontrolled
    const [internalSelectedCell, setInternalSelectedCell] = useState<CellCoord | null>(null);
    const [saveError, setSaveError] = useState<string | null>(null);
    const [filterText, setFilterText] = useState<string>('');
    const debouncedFilter = useDebouncedValue(filterText, 150);

    const activeSelectedCell =
      controlledSelectedCell !== undefined ? controlledSelectedCell : internalSelectedCell;

    const inputRef = useRef<HTMLInputElement | null>(null);
    const tableContainerRef = useRef<HTMLDivElement | null>(null);

    // Reset dirty cells when rows dataset changes
    useEffect(() => {
      setDirtyCells({});
      setEditingCell(null);
      setSaveError(null);
    }, [rows]);

    // Focus and select input text when entering edit mode
    useEffect(() => {
      if (editingCell && inputRef.current) {
        inputRef.current.focus();
        inputRef.current.select();
      }
    }, [editingCell]);

    // Expose programmatic updateCell and getDirtyCount methods via ref
    useImperativeHandle(
      ref,
      () => ({
        updateCell: (rowIndex: number, colIndex: number, newValue: any) => {
          const originalVal = rows[rowIndex]?.[colIndex];
          setDirtyCells((prev) => {
            const key = `${rowIndex}_${colIndex}`;
            const next = { ...prev };
            const isSameAsOriginal =
              newValue === originalVal ||
              (Number.isNaN(newValue) && Number.isNaN(originalVal));

            if (isSameAsOriginal) {
              delete next[key];
            } else {
              next[key] = {
                originalValue: originalVal,
                newValue,
                rowIndex,
                colIndex,
              };
            }
            return next;
          });
        },
        getDirtyCount: () => Object.keys(dirtyCells).length,
      }),
      [rows, dirtyCells]
    );

    /**
     * @brief Resolves current effective value of a cell (modified or original).
     * @param r Row index.
     * @param c Column index.
     * @return Effective cell value.
     */
    const getCellValue = useCallback(
      (r: number, c: number): unknown => {
        const key = `${r}_${c}`;
        if (dirtyCells[key] !== undefined) {
          return dirtyCells[key].newValue;
        }
        return rows[r]?.[c];
      },
      [dirtyCells, rows]
    );

    /**
     * @brief Handles single-click cell selection.
     * @param r Row index.
     * @param c Column index.
     */
    const handleCellClick = useCallback(
      (r: number, c: number) => {
        setInternalSelectedCell({ rowIndex: r, colIndex: c });
        const colName = columns[c];
        const val = getCellValue(r, c);
        if (onCellSelect) {
          onCellSelect(colName, val);
        }
        if (onCellPositionSelect) {
          onCellPositionSelect({
            rowIndex: r,
            colIndex: c,
            columnName: colName,
            value: val,
          });
        }
      },
      [columns, getCellValue, onCellPositionSelect, onCellSelect]
    );

    /**
     * @brief Activates inline edit mode on double-click, when editing is permitted.
     * @param r Row index.
     * @param c Column index.
     */
    const handleCellDoubleClick = useCallback(
      (r: number, c: number) => {
        if (!canEdit) return;
        const currentVal = getCellValue(r, c);
        setEditingCell({ rowIndex: r, colIndex: c });
        setEditValue(currentVal === null || currentVal === undefined ? '' : String(currentVal));
      },
      [canEdit, getCellValue]
    );

    /**
     * @brief Commits currently pending inline cell edit.
     */
    const commitEdit = useCallback(() => {
      if (!editingCell) return;
      const { rowIndex, colIndex } = editingCell;
      const originalVal = rows[rowIndex]?.[colIndex];
      const parsedVal = parseEditedValue(editValue, originalVal);

      setDirtyCells((prev) => {
        const key = `${rowIndex}_${colIndex}`;
        const next = { ...prev };

        // Check if value is identical to original
        const isSameAsOriginal =
          parsedVal === originalVal ||
          (Number.isNaN(parsedVal) && Number.isNaN(originalVal));

        if (isSameAsOriginal) {
          delete next[key];
        } else {
          next[key] = {
            originalValue: originalVal,
            newValue: parsedVal,
            rowIndex,
            colIndex,
          };
        }
        return next;
      });

      setEditingCell(null);
    }, [editValue, editingCell, rows]);

    /**
     * @brief Cancels inline cell editing without committing changes.
     */
    const cancelEdit = useCallback(() => {
      setEditingCell(null);
    }, []);

    /**
     * @brief Handles keyboard events inside the inline cell input.
     * @param e React keyboard event.
     */
    const handleInputKeyDown = useCallback(
      (e: React.KeyboardEvent<HTMLInputElement>) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          commitEdit();
        } else if (e.key === 'Escape') {
          e.preventDefault();
          cancelEdit();
        }
      },
      [cancelEdit, commitEdit]
    );

    /**
     * @brief Discards all tracked dirty changes and restores original dataset values.
     */
    const handleDiscard = useCallback(() => {
      setDirtyCells({});
      setEditingCell(null);
      setSaveError(null);
    }, []);

    /**
     * @brief Gathers modified rows, builds RowUpdatePayload batch, and calls onSave.
     * @details Every payload is keyed by the verified primary key and marked as strict single-row.
     * Rows whose key is incomplete are refused instead of being sent with a weak locator.
     */
    const handleSave = useCallback(async () => {
      if (!onSave || !canEdit || !primaryKeyColumns) return;

      // Group dirty cells by row index
      const dirtyByRow = new Map<number, DirtyCellRecord[]>();
      for (const record of Object.values(dirtyCells)) {
        const list = dirtyByRow.get(record.rowIndex) || [];
        list.push(record);
        dirtyByRow.set(record.rowIndex, list);
      }

      const payloads: RowUpdatePayload[] = [];
      const pkIndexes = primaryKeyColumns.map((pkCol) =>
        columns.findIndex((c) => c === pkCol)
      );

      if (pkIndexes.some((idx) => idx < 0)) {
        setSaveError(
          `Cannot save: primary key column(s) ${primaryKeyColumns
            .filter((_, i) => pkIndexes[i] < 0)
            .join(', ')} are missing from the result set. Include them in the query.`
        );
        return;
      }

      for (const [rIdx, records] of dirtyByRow.entries()) {
        const primaryKeys: Record<string, unknown> = {};
        let complete = true;

        primaryKeyColumns.forEach((pkCol, position) => {
          const value = rows[rIdx]?.[pkIndexes[position]];
          if (value === null || value === undefined) {
            complete = false;
            return;
          }
          primaryKeys[pkCol] = value;
        });

        if (!complete) {
          setSaveError(
            `Cannot save row ${rIdx + 1}: one or more primary key values are NULL, so the row cannot be identified uniquely.`
          );
          return;
        }

        const updatedValues: Record<string, unknown> = {};
        for (const record of records) {
          updatedValues[columns[record.colIndex]] = record.newValue;
        }

        payloads.push({
          table: tableName,
          primary_keys: primaryKeys,
          updated_values: updatedValues,
          expect_single_row: true,
        });
      }

      setSaveError(null);
      await onSave(payloads);
    }, [canEdit, columns, dirtyCells, onSave, primaryKeyColumns, rows, tableName]);

    const dirtyCount = useMemo(() => Object.keys(dirtyCells).length, [dirtyCells]);

    /**
     * @brief Prompts user confirmation before executing pagination transitions if unsaved edits exist.
     * @param action Callback performing the page transition or reload action.
     */
    const handleSafePageTransition = useCallback(
      (action: () => void) => {
        if (dirtyCount > 0) {
          const proceed = window.confirm(
            'You have unsaved cell modifications. Changing pages will discard these changes. Continue?'
          );
          if (!proceed) return;
        }
        action();
      },
      [dirtyCount]
    );

    const dirtyRowsMap = useMemo(() => {
      const map: Record<number, Record<number, DirtyCellRecord>> = {};
      for (const record of Object.values(dirtyCells)) {
        if (!map[record.rowIndex]) {
          map[record.rowIndex] = {};
        }
        map[record.rowIndex][record.colIndex] = record;
      }
      return map;
    }, [dirtyCells]);

    /**
     * @brief Filtered row set preserving original row indices for dirty tracking and cell editing.
     */
    const filteredRowsWithIndices = useMemo(() => {
      const q = (filterText ? debouncedFilter : '').trim().toLowerCase();
      if (!q) {
        return rows.map((row, idx) => ({ row, originalIndex: idx }));
      }
      return rows
        .map((row, idx) => ({ row, originalIndex: idx }))
        .filter(({ row }) => {
          return row.some((cell) => {
            if (cell === null || cell === undefined) return false;
            const str = typeof cell === 'object' ? JSON.stringify(cell) : String(cell);
            return str.toLowerCase().includes(q);
          });
        });
    }, [rows, filterText, debouncedFilter]);

    const {
      startIndex,
      endIndex,
      topPadding,
      bottomPadding,
      onScroll,
    } = useVirtualRows({
      totalCount: filteredRowsWithIndices.length,
      rowHeight: effectiveRowHeight,
      containerRef: tableContainerRef,
      overscan: 5,
    });

    const visibleRows = useMemo(() => {
      return filteredRowsWithIndices.slice(startIndex, endIndex);
    }, [filteredRowsWithIndices, startIndex, endIndex]);

    // Reset container scroll position when filter query or dataset changes
    useEffect(() => {
      if (tableContainerRef.current) {
        tableContainerRef.current.scrollTop = 0;
      }
    }, [debouncedFilter, rows]);

    return (
      <div className="relative flex flex-col h-full w-full bg-[#18191c] overflow-hidden select-text font-mono text-xs">
        {/* Read-only notice when no safe row locator is available */}
        {!canEdit && editDisabledReason && (
          <div
            data-testid="grid-readonly-notice"
            className="flex items-center gap-2 px-3 py-1.5 bg-[#24262b] border-b border-[#35373c] text-[11px] text-[#8c919a] shrink-0"
          >
            <Lock className="w-3.5 h-3.5 shrink-0" />
            <span>{editDisabledReason}</span>
          </div>
        )}

        {/* Local refusal reason, e.g. an incomplete primary key */}
        {saveError && (
          <div
            data-testid="grid-save-error"
            className="flex items-center gap-2 px-3 py-1.5 bg-red-500/10 border-b border-red-500/30 text-[11px] text-red-300 shrink-0"
          >
            <AlertCircle className="w-3.5 h-3.5 shrink-0" />
            <span>{saveError}</span>
          </div>
        )}

        {/* Quick Filter Bar */}
        <div
          data-testid="grid-filter-bar"
          className="flex items-center justify-between px-3 py-1.5 bg-[#202226] border-b border-[#2e3035] text-xs shrink-0"
        >
          <div className="flex items-center gap-2 relative max-w-xs w-full">
            <Search className="w-3.5 h-3.5 text-[#8c919a] absolute left-2 pointer-events-none" />
            <input
              type="text"
              data-testid="grid-filter-input"
              value={filterText}
              onChange={(e) => setFilterText(e.target.value)}
              placeholder="Filter results..."
              aria-label="Filter results"
              className="w-full bg-[#141517] border border-[#35373c] rounded pl-7 pr-6 py-1 text-[11px] text-[#e6e8ea] placeholder-[#6b7280] outline-none focus:border-[#3a82f7] transition-colors"
            />
            {filterText && (
              <button
                type="button"
                data-testid="grid-filter-clear-btn"
                onClick={() => setFilterText('')}
                aria-label="Clear filter"
                className="absolute right-1.5 text-[#8c919a] hover:text-[#e6e8ea] p-0.5 rounded cursor-pointer"
              >
                <X className="w-3 h-3" />
              </button>
            )}
          </div>
          {filterText && (
            <span data-testid="grid-filter-count" className="text-[11px] font-mono text-[#8c919a]">
              Showing {filteredRowsWithIndices.length} of {rows.length} rows
            </span>
          )}
        </div>

        {/* Scrollable Data Table Container */}
        <div
          ref={tableContainerRef}
          onScroll={onScroll}
          data-testid="grid-scroll-container"
          className="flex-1 overflow-auto"
        >
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="sticky top-0 bg-[#24262b] text-[#8c919a] border-b border-[#35373c] z-10 shadow-xs">
                {columns.map((col, cidx) => (
                  <th
                    key={`${col}-${cidx}`}
                    className="px-3 py-1.5 font-semibold text-[11px] whitespace-nowrap border-r border-[#35373c]/50 last:border-r-0 select-none"
                  >
                    {col}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-[#2b2d30]">
              {rows.length === 0 ? (
                <tr>
                  <td
                    colSpan={columns.length || 1}
                    className="px-3 py-6 text-center text-[#8c919a] italic"
                  >
                    (0 rows returned)
                  </td>
                </tr>
              ) : filteredRowsWithIndices.length === 0 ? (
                <tr>
                  <td
                    colSpan={columns.length || 1}
                    className="px-3 py-6 text-center text-[#8c919a] italic"
                  >
                    (No rows match filter &quot;{filterText}&quot;)
                  </td>
                </tr>
              ) : (
                <>
                  {topPadding > 0 && (
                    <tr style={{ height: `${topPadding}px` }} aria-hidden="true">
                      <td colSpan={columns.length || 1} style={{ padding: 0, border: 0, height: `${topPadding}px` }} />
                    </tr>
                  )}
                  {visibleRows.map(({ row, originalIndex }) => (
                    <GridRow
                      key={originalIndex}
                      rIdx={originalIndex}
                      row={row}
                      rowHeight={effectiveRowHeight}
                      columns={columns}
                      selectedColIndex={
                        activeSelectedCell?.rowIndex === originalIndex ? activeSelectedCell.colIndex : null
                      }
                      editingColIndex={
                        editingCell?.rowIndex === originalIndex ? editingCell.colIndex : null
                      }
                      dirtyMap={dirtyRowsMap[originalIndex]}
                      editValue={editValue}
                      inputRef={inputRef}
                      onCellClick={handleCellClick}
                      onCellDoubleClick={handleCellDoubleClick}
                      onEditChange={setEditValue}
                      onInputKeyDown={handleInputKeyDown}
                      onInputBlur={commitEdit}
                    />
                  ))}
                  {bottomPadding > 0 && (
                    <tr style={{ height: `${bottomPadding}px` }} aria-hidden="true">
                      <td colSpan={columns.length || 1} style={{ padding: 0, border: 0, height: `${bottomPadding}px` }} />
                    </tr>
                  )}
                </>
              )}
            </tbody>
          </table>
        </div>

        {/* Floating Bottom Mutation Bar */}
        {dirtyCount > 0 && (
          <div
            data-testid="mutation-bar"
            className="sticky bottom-0 left-0 right-0 z-20 bg-[#24262b] border-t border-[#35373c] px-4 py-2 flex items-center justify-between shadow-xl animate-in fade-in duration-150"
          >
            {/* Unsaved Changes Indicator */}
            <div className="flex items-center space-x-2 text-amber-400 font-mono text-xs">
              <AlertCircle className="w-4 h-4 shrink-0 text-amber-400" />
              <span className="font-semibold">
                {dirtyCount} unsaved change{dirtyCount === 1 ? '' : 's'}
              </span>
            </div>

            {/* Action Buttons */}
            <div className="flex items-center space-x-2">
              <button
                type="button"
                onClick={handleDiscard}
                disabled={isSaving}
                className="flex items-center space-x-1.5 px-3 py-1 bg-[#35373c] hover:bg-[#404349] text-[#e6e8ea] rounded text-xs font-semibold disabled:opacity-50 transition-colors cursor-pointer"
              >
                <Undo2 className="w-3.5 h-3.5" />
                <span>Discard</span>
              </button>

              <button
                type="button"
                onClick={handleSave}
                disabled={isSaving || !canEdit}
                title={canEdit ? undefined : editDisabledReason}
                className="flex items-center space-x-1.5 px-3 py-1 bg-amber-600 hover:bg-amber-500 text-white rounded text-xs font-semibold disabled:opacity-50 transition-colors shadow-xs cursor-pointer"
              >
                {isSaving ? (
                  <>
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    <span>Saving...</span>
                  </>
                ) : (
                  <>
                    <Save className="w-3.5 h-3.5" />
                    <span>Save Changes</span>
                  </>
                )}
              </button>
            </div>
          </div>
        )}

        {/* Interactive Pagination Bar */}
        {pagination && (
          <div
            data-testid="pagination-bar"
            className="sticky bottom-0 left-0 right-0 z-10 bg-[#1e1f22] border-t border-[#35373c] px-3 py-1.5 flex items-center justify-between text-xs text-[#8c919a] select-none shrink-0"
          >
            {/* Row range summary */}
            <div className="flex items-center space-x-2 font-mono text-[11px]">
              <span>
                {pagination.totalRows !== null && pagination.totalRows !== undefined
                  ? `Showing ${pagination.currentPage * pagination.pageSize + (rows.length > 0 ? 1 : 0)} - ${
                      pagination.currentPage * pagination.pageSize + rows.length
                    } of ${pagination.totalRows.toLocaleString()} rows`
                  : `Showing ${rows.length} rows`}
              </span>
              {pagination.onRefresh && (
                <button
                  type="button"
                  onClick={() => handleSafePageTransition(() => pagination.onRefresh?.())}
                  className="p-1 hover:text-[#e6e8ea] hover:bg-[#2b2d30] rounded transition-colors cursor-pointer"
                  title="Refresh current page"
                  aria-label="Refresh data"
                >
                  <RotateCw className="w-3 h-3" />
                </button>
              )}
            </div>

            {/* Navigation buttons and Page indicator */}
            <div className="flex items-center space-x-1">
              <button
                type="button"
                disabled={pagination.currentPage <= 0}
                onClick={() => handleSafePageTransition(() => pagination.onPageChange(0))}
                aria-label="First page"
                title="First page"
                className="p-1 text-[#8c919a] hover:text-[#e6e8ea] hover:bg-[#2b2d30] rounded disabled:opacity-30 disabled:pointer-events-none transition-colors cursor-pointer"
              >
                <ChevronsLeft className="w-3.5 h-3.5" />
              </button>
              <button
                type="button"
                disabled={pagination.currentPage <= 0}
                onClick={() =>
                  handleSafePageTransition(() => pagination.onPageChange(pagination.currentPage - 1))
                }
                aria-label="Previous page"
                title="Previous page"
                className="p-1 text-[#8c919a] hover:text-[#e6e8ea] hover:bg-[#2b2d30] rounded disabled:opacity-30 disabled:pointer-events-none transition-colors cursor-pointer"
              >
                <ChevronLeft className="w-3.5 h-3.5" />
              </button>

              <span className="px-2 text-[11px] font-mono text-[#e6e8ea]">
                Page {pagination.currentPage + 1}
                {pagination.totalRows !== null && pagination.totalRows !== undefined
                  ? ` of ${Math.max(1, Math.ceil(pagination.totalRows / pagination.pageSize))}`
                  : ''}
              </span>

              <button
                type="button"
                disabled={
                  pagination.totalRows !== null && pagination.totalRows !== undefined
                    ? (pagination.currentPage + 1) * pagination.pageSize >= pagination.totalRows
                    : rows.length < pagination.pageSize
                }
                onClick={() =>
                  handleSafePageTransition(() => pagination.onPageChange(pagination.currentPage + 1))
                }
                aria-label="Next page"
                title="Next page"
                className="p-1 text-[#8c919a] hover:text-[#e6e8ea] hover:bg-[#2b2d30] rounded disabled:opacity-30 disabled:pointer-events-none transition-colors cursor-pointer"
              >
                <ChevronRight className="w-3.5 h-3.5" />
              </button>
              <button
                type="button"
                disabled={
                  pagination.totalRows !== null && pagination.totalRows !== undefined
                    ? (pagination.currentPage + 1) * pagination.pageSize >= pagination.totalRows
                    : true
                }
                onClick={() => {
                  handleSafePageTransition(() => {
                    if (pagination.totalRows !== null && pagination.totalRows !== undefined) {
                      pagination.onPageChange(
                        Math.max(0, Math.ceil(pagination.totalRows / pagination.pageSize) - 1)
                      );
                    }
                  });
                }}
                aria-label="Last page"
                title="Last page"
                className="p-1 text-[#8c919a] hover:text-[#e6e8ea] hover:bg-[#2b2d30] rounded disabled:opacity-30 disabled:pointer-events-none transition-colors cursor-pointer"
              >
                <ChevronsRight className="w-3.5 h-3.5" />
              </button>
            </div>

            {/* Page size dropdown */}
            <div className="flex items-center space-x-1.5">
              <span className="text-[11px]">Rows:</span>
              <select
                aria-label="Rows per page"
                value={pagination.pageSize}
                onChange={(e) => {
                  const newPageSize = Number(e.target.value);
                  handleSafePageTransition(() => pagination.onPageSizeChange(newPageSize));
                }}
                className="bg-[#121316] text-[#e6e8ea] border border-[#35373c] rounded px-1.5 py-0.5 text-[11px] font-mono outline-none focus:border-[#3a82f7] cursor-pointer"
              >
                {![25, 50, 100, 200].includes(pagination.pageSize) && (
                  <option value={pagination.pageSize}>{pagination.pageSize}</option>
                )}
                <option value={25}>25</option>
                <option value={50}>50</option>
                <option value={100}>100</option>
                <option value={200}>200</option>
              </select>
            </div>
          </div>
        )}
      </div>
    );
  })
);

EditableDataGrid.displayName = 'EditableDataGrid';
