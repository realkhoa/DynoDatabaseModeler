/**
 * @file EditableDataGrid.tsx
 * @brief High-performance interactive editable data grid with dirty-cell tracking.
 * @details Supports single-click cell selection, double-click inline cell editing,
 * visual dirty state highlighting with amber accents, and transactional save submission
 * computing RowUpdatePayload models with primary key matching.
 */

import React, { useState, useEffect, useRef, useCallback, useMemo, useImperativeHandle } from 'react';
import { Save, Undo2, AlertCircle, Loader2 } from 'lucide-react';
import type { RowUpdatePayload } from '../../types/database';

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
}

/**
 * @brief Properties accepted by the EditableDataGrid component.
 */
export interface EditableDataGridProps {
  /** @brief Optional name of the underlying table being queried/edited. */
  tableName?: string;
  /** @brief Optional list of primary key column names used to uniquely identify rows for updates. */
  primaryKeyColumns?: string[];
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
export const EditableDataGrid = React.forwardRef<EditableDataGridHandle, EditableDataGridProps>(
  (
    {
      tableName = 'unknown',
      primaryKeyColumns,
      columns,
      rows,
      onSave,
      isSaving = false,
      onCellSelect,
      onCellPositionSelect,
      selectedCell: controlledSelectedCell,
    },
    ref
  ) => {
    // Dirty cells map keyed by `${rowIndex}_${colIndex}`
    const [dirtyCells, setDirtyCells] = useState<Record<string, DirtyCellRecord>>({});

    // Active cell being edited
    const [editingCell, setEditingCell] = useState<CellCoord | null>(null);
    const [editValue, setEditValue] = useState<string>('');

    // Internal selected cell tracking when uncontrolled
    const [internalSelectedCell, setInternalSelectedCell] = useState<CellCoord | null>(null);

    const activeSelectedCell =
      controlledSelectedCell !== undefined ? controlledSelectedCell : internalSelectedCell;

    const inputRef = useRef<HTMLInputElement | null>(null);

    // Reset dirty cells when rows dataset changes
    useEffect(() => {
      setDirtyCells({});
      setEditingCell(null);
    }, [rows]);

    // Focus and select input text when entering edit mode
    useEffect(() => {
      if (editingCell && inputRef.current) {
        inputRef.current.focus();
        inputRef.current.select();
      }
    }, [editingCell]);

    // Expose programmatic updateCell method via ref
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
      }),
      [rows]
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
   * @brief Activates inline edit mode on double-click.
   * @param r Row index.
   * @param c Column index.
   */
  const handleCellDoubleClick = useCallback(
    (r: number, c: number) => {
      const currentVal = getCellValue(r, c);
      setEditingCell({ rowIndex: r, colIndex: c });
      setEditValue(currentVal === null || currentVal === undefined ? '' : String(currentVal));
    },
    [getCellValue]
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
  }, []);

  /**
   * @brief Gathers modified rows, builds RowUpdatePayload batch, and calls onSave.
   */
  const handleSave = useCallback(async () => {
    if (!onSave) return;

    // Group dirty cells by row index
    const dirtyByRow = new Map<number, DirtyCellRecord[]>();
    for (const record of Object.values(dirtyCells)) {
      const list = dirtyByRow.get(record.rowIndex) || [];
      list.push(record);
      dirtyByRow.set(record.rowIndex, list);
    }

    const payloads: RowUpdatePayload[] = [];

    for (const [rIdx, records] of dirtyByRow.entries()) {
      const primary_keys: Record<string, any> = {};

      if (primaryKeyColumns && primaryKeyColumns.length > 0) {
        for (const pkCol of primaryKeyColumns) {
          const cIdx = columns.findIndex((c) => c === pkCol);
          if (cIdx >= 0) {
            primary_keys[pkCol] = rows[rIdx]?.[cIdx];
          }
        }
      } else {
        // Fallback: look for column named 'id' (case-insensitive) or index 0
        const idColIdx = columns.findIndex((c) => c.toLowerCase() === 'id');
        const pkIdx = idColIdx >= 0 ? idColIdx : 0;
        if (columns[pkIdx]) {
          primary_keys[columns[pkIdx]] = rows[rIdx]?.[pkIdx];
        }
      }

      const updated_values: Record<string, any> = {};
      for (const rec of records) {
        const colName = columns[rec.colIndex];
        updated_values[colName] = rec.newValue;
      }

      payloads.push({
        table: tableName,
        primary_keys,
        updated_values,
      });
    }

    await onSave(payloads);
  }, [columns, dirtyCells, onSave, primaryKeyColumns, rows, tableName]);

  const dirtyCount = useMemo(() => Object.keys(dirtyCells).length, [dirtyCells]);

  return (
    <div className="relative flex flex-col h-full w-full bg-[#18191c] overflow-hidden select-text font-mono text-xs">
      {/* Scrollable Data Table Container */}
      <div className="flex-1 overflow-auto">
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
            ) : (
              rows.map((_row, rIdx) => (
                <tr
                  key={rIdx}
                  className="border-b border-[#2b2d30] hover:bg-[#24262b]/80 transition-colors"
                >
                  {columns.map((_, cIdx) => {
                    const key = `${rIdx}_${cIdx}`;
                    const isDirty = dirtyCells[key] !== undefined;
                    const isEditing =
                      editingCell?.rowIndex === rIdx && editingCell?.colIndex === cIdx;
                    const isSelected =
                      activeSelectedCell?.rowIndex === rIdx &&
                      activeSelectedCell?.colIndex === cIdx;

                    const effectiveValue = getCellValue(rIdx, cIdx);

                    return (
                      <td
                        key={cIdx}
                        data-dirty={isDirty ? 'true' : undefined}
                        data-selected={isSelected ? 'true' : undefined}
                        onClick={() => handleCellClick(rIdx, cIdx)}
                        onDoubleClick={() => handleCellDoubleClick(rIdx, cIdx)}
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
                            onChange={(e) => setEditValue(e.target.value)}
                            onKeyDown={handleInputKeyDown}
                            onBlur={commitEdit}
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
              ))
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
              disabled={isSaving}
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
    </div>
  );
});

EditableDataGrid.displayName = 'EditableDataGrid';
