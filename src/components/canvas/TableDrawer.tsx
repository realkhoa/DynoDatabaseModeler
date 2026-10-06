/**
 * @file TableDrawer.tsx
 * @brief Slide-out drawer panel for inspecting and modifying database table schemas.
 * @details Supports editing existing tables, managing column definitions (types, nullability,
 * primary keys, auto-increment), creating new tables, and updating working schemas.
 */

import React, { useState, useEffect } from 'react';
import {
  X,
  Plus,
  Trash2,
  Table as TableIcon,
  Key,
  Save,
} from 'lucide-react';
import {
  TableSchema,
  ColumnSchema,
  CanonicalType,
  formatCanonicalType,
} from '../../types/database';

/**
 * @brief List of standard SQL types available for selection in the column editor.
 */
export const AVAILABLE_DATA_TYPES = [
  'INTEGER',
  'BIGINT',
  'SMALLINT',
  'VARCHAR(255)',
  'VARCHAR(100)',
  'VARCHAR(50)',
  'TEXT',
  'BOOLEAN',
  'FLOAT',
  'DOUBLE',
  'DECIMAL(10,2)',
  'DATE',
  'TIME',
  'TIMESTAMP',
  'JSON',
  'UUID',
  'BINARY',
] as const;

/**
 * @brief Parses a data type string into its canonical frontend representation.
 * @param typeStr String specification of the data type (e.g. 'VARCHAR(255)').
 * @return CanonicalType variant corresponding to the string.
 */
export function parseCanonicalTypeString(typeStr: string): CanonicalType {
  const upper = typeStr.trim().toUpperCase();

  if (upper.startsWith('VARCHAR')) {
    const match = upper.match(/VARCHAR\((\d+)\)/);
    const len = match ? parseInt(match[1], 10) : 255;
    return { Varchar: len };
  }

  if (upper.startsWith('CHAR')) {
    const match = upper.match(/CHAR\((\d+)\)/);
    const len = match ? parseInt(match[1], 10) : 1;
    return { Char: len };
  }

  if (upper.startsWith('DECIMAL')) {
    const match = upper.match(/DECIMAL\((\d+),(\d+)\)/);
    if (match) {
      return {
        Decimal: {
          precision: parseInt(match[1], 10),
          scale: parseInt(match[2], 10),
        },
      };
    }
    return { Decimal: { precision: 10, scale: 2 } };
  }

  switch (upper) {
    case 'INTEGER':
    case 'INT':
      return 'Integer';
    case 'BIGINT':
      return 'BigInt';
    case 'SMALLINT':
      return 'SmallInt';
    case 'FLOAT':
      return 'Float';
    case 'DOUBLE':
      return 'Double';
    case 'BOOLEAN':
    case 'BOOL':
      return 'Boolean';
    case 'TEXT':
      return 'Text';
    case 'DATE':
      return 'Date';
    case 'TIME':
      return 'Time';
    case 'TIMESTAMP':
      return 'Timestamp';
    case 'JSON':
      return 'Json';
    case 'UUID':
      return 'Uuid';
    case 'BINARY':
      return 'Binary';
    default:
      return { Custom: typeStr };
  }
}

/**
 * @brief Properties accepted by the TableDrawer component.
 */
export interface TableDrawerProps {
  /** @brief Indicates whether the drawer panel is visible. */
  isOpen: boolean;
  /** @brief Table schema currently selected for inspection/editing, or null if creating new table. */
  table: TableSchema | null;
  /** @brief Callback triggered to close the drawer panel. */
  onClose: () => void;
  /** @brief Callback triggered when saving changes to the table schema. */
  onSaveTable: (updatedTable: TableSchema, originalName?: string) => void;
  /** @brief Optional callback triggered when deleting the inspected table. */
  onDeleteTable?: (tableName: string) => void;
}

/**
 * @brief Slide-out drawer panel for inspecting and modifying table schema and column definitions.
 * @param props Drawer control props and table mutation callbacks.
 * @return Rendered drawer element or null if closed.
 */
export const TableDrawer: React.FC<TableDrawerProps> = ({
  isOpen,
  table,
  onClose,
  onSaveTable,
  onDeleteTable,
}) => {
  const isCreatingNew = !table;

  const [tableName, setTableName] = useState('');
  const [columns, setColumns] = useState<ColumnSchema[]>([]);
  const [validationError, setValidationError] = useState<string | null>(null);

  // Synchronize state when table prop changes or drawer opens
  useEffect(() => {
    if (table) {
      setTableName(table.name);
      setColumns([...table.columns]);
    } else {
      setTableName('');
      setColumns([
        {
          name: 'id',
          data_type: 'Integer',
          is_primary_key: true,
          is_nullable: false,
          is_auto_increment: true,
        },
      ]);
    }
    setValidationError(null);
  }, [table, isOpen]);

  if (!isOpen) return null;

  /**
   * @brief Adds a new empty column to the working table definition.
   */
  const handleAddColumn = () => {
    const newColName =
      columns.length === 0
        ? 'id'
        : columns.some((c) => c.name === 'new_column')
        ? `new_column_${columns.length + 1}`
        : 'new_column';

    setColumns((prev) => [
      ...prev,
      {
        name: newColName,
        data_type: { Varchar: 255 },
        is_primary_key: false,
        is_nullable: true,
        is_auto_increment: false,
      },
    ]);
  };

  /**
   * @brief Removes a column by index from the working table definition.
   * @param index Array index of the column to remove.
   */
  const handleRemoveColumn = (index: number) => {
    setColumns((prev) => prev.filter((_, idx) => idx !== index));
  };

  /**
   * @brief Updates a specific property on a column definition.
   * @param index Column index in array.
   * @param updates Partial column properties to apply.
   */
  const handleUpdateColumn = (index: number, updates: Partial<ColumnSchema>) => {
    setColumns((prev) =>
      prev.map((col, idx) => (idx === index ? { ...col, ...updates } : col))
    );
  };

  /**
   * @brief Handles saving table schema modifications or creating new table.
   */
  const handleSave = () => {
    const trimmedName = tableName.trim();
    if (!trimmedName) {
      setValidationError('Table name cannot be empty.');
      return;
    }

    if (columns.length === 0) {
      setValidationError('Table must contain at least one column.');
      return;
    }

    // Check for duplicate column names
    const colNames = new Set<string>();
    for (const col of columns) {
      const cname = col.name.trim();
      if (!cname) {
        setValidationError('Column name cannot be blank.');
        return;
      }
      if (colNames.has(cname.toLowerCase())) {
        setValidationError(`Duplicate column name "${cname}".`);
        return;
      }
      colNames.add(cname.toLowerCase());
    }

    const updatedTable: TableSchema = {
      name: trimmedName,
      schema: table?.schema,
      columns,
      foreign_keys: table?.foreign_keys || [],
      indexes: table?.indexes || [],
      ui_position: table?.ui_position,
    };

    onSaveTable(updatedTable, table?.name);
    onClose();
  };

  return (
    <div className="fixed inset-y-0 right-0 z-50 flex max-w-full pl-10 animate-in slide-in-from-right duration-200">
      <div className="w-screen max-w-md bg-[#1e2024] border-l border-[#35373c] shadow-2xl flex flex-col text-[#e6e8ea]">
        {/* Drawer Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-[#35373c] bg-[#18191c]">
          <div className="flex items-center space-x-2">
            <TableIcon className="w-4 h-4 text-[#3a82f7]" />
            <h2 className="text-sm font-semibold text-[#e6e8ea]">
              {isCreatingNew ? 'Create New Table' : `Edit Table: ${table?.name}`}
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close table drawer"
            className="text-[#8c919a] hover:text-[#e6e8ea] p-1 rounded hover:bg-[#2b2d30] transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Drawer Body */}
        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {/* Validation Error Banner */}
          {validationError && (
            <div className="p-2.5 bg-red-950/40 border border-red-800/60 rounded text-xs text-red-300">
              {validationError}
            </div>
          )}

          {/* Table Name Field */}
          <div>
            <label className="block text-[11px] font-semibold text-[#8c919a] uppercase tracking-wider mb-1">
              Table Name
            </label>
            <input
              type="text"
              value={tableName}
              onChange={(e) => setTableName(e.target.value)}
              placeholder="Table name"
              className="w-full bg-[#18191c] border border-[#35373c] rounded px-3 py-1.5 text-xs text-[#e6e8ea] font-mono focus:outline-none focus:border-[#3a82f7]"
            />
          </div>

          {/* Columns Section */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="text-[11px] font-semibold text-[#8c919a] uppercase tracking-wider">
                Columns ({columns.length})
              </label>
              <button
                type="button"
                onClick={handleAddColumn}
                className="inline-flex items-center gap-1 text-[11px] text-[#3a82f7] hover:text-[#2f6fd6] font-medium"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>Add Column</span>
              </button>
            </div>

            <div className="space-y-2">
              {columns.map((col, idx) => {
                const currentTypeStr = formatCanonicalType(col.data_type);

                return (
                  <div
                    key={idx}
                    className="p-2.5 bg-[#18191c] border border-[#2b2d30] rounded-md space-y-2 hover:border-[#35373c] transition-colors"
                  >
                    {/* Name and Type Inputs */}
                    <div className="flex items-center gap-2">
                      <input
                        type="text"
                        value={col.name}
                        onChange={(e) =>
                          handleUpdateColumn(idx, { name: e.target.value })
                        }
                        placeholder="column_name"
                        className="flex-1 bg-[#222428] border border-[#35373c] rounded px-2 py-1 text-xs text-[#e6e8ea] font-mono focus:outline-none focus:border-[#3a82f7]"
                      />

                      <select
                        value={currentTypeStr}
                        onChange={(e) =>
                          handleUpdateColumn(idx, {
                            data_type: parseCanonicalTypeString(e.target.value),
                          })
                        }
                        className="w-36 bg-[#222428] border border-[#35373c] rounded px-2 py-1 text-xs text-[#e6e8ea] font-mono focus:outline-none focus:border-[#3a82f7]"
                      >
                        {AVAILABLE_DATA_TYPES.map((typeOption) => (
                          <option key={typeOption} value={typeOption}>
                            {typeOption}
                          </option>
                        ))}
                        {/* Fallback if current type is not in common list */}
                        {!AVAILABLE_DATA_TYPES.includes(
                          currentTypeStr as (typeof AVAILABLE_DATA_TYPES)[number]
                        ) && (
                          <option value={currentTypeStr}>{currentTypeStr}</option>
                        )}
                      </select>

                      <button
                        type="button"
                        onClick={() => handleRemoveColumn(idx)}
                        disabled={columns.length <= 1}
                        title="Delete Column"
                        aria-label={`Delete column ${col.name}`}
                        className="text-[#8c919a] hover:text-red-400 p-1 disabled:opacity-30 disabled:cursor-not-allowed"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>

                    {/* Column Property Checkboxes */}
                    <div className="flex items-center space-x-4 text-[11px] text-[#8c919a] pt-1">
                      <label className="flex items-center space-x-1.5 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={col.is_primary_key}
                          onChange={(e) =>
                            handleUpdateColumn(idx, {
                              is_primary_key: e.target.checked,
                              is_nullable: e.target.checked ? false : col.is_nullable,
                            })
                          }
                          aria-label={`Primary Key for ${col.name}`}
                          className="rounded border-[#35373c] bg-[#222428] text-[#3a82f7] focus:ring-0"
                        />
                        <span className="flex items-center gap-1 text-[#e6e8ea]">
                          <Key className="w-3 h-3 text-[#f5a623]" />
                          <span>PK</span>
                        </span>
                      </label>

                      <label className="flex items-center space-x-1.5 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={col.is_nullable}
                          disabled={col.is_primary_key}
                          onChange={(e) =>
                            handleUpdateColumn(idx, { is_nullable: e.target.checked })
                          }
                          aria-label={`Nullable for ${col.name}`}
                          className="rounded border-[#35373c] bg-[#222428] text-[#3a82f7] focus:ring-0 disabled:opacity-40"
                        />
                        <span>Nullable</span>
                      </label>

                      <label className="flex items-center space-x-1.5 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={col.is_auto_increment}
                          onChange={(e) =>
                            handleUpdateColumn(idx, {
                              is_auto_increment: e.target.checked,
                            })
                          }
                          aria-label={`Auto-Increment for ${col.name}`}
                          className="rounded border-[#35373c] bg-[#222428] text-[#3a82f7] focus:ring-0"
                        />
                        <span>Auto-inc</span>
                      </label>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        {/* Drawer Footer Actions */}
        <div className="px-4 py-3 border-t border-[#35373c] bg-[#18191c] flex items-center justify-between">
          <div>
            {!isCreatingNew && onDeleteTable && (
              <button
                type="button"
                onClick={() => {
                  if (table) {
                    onDeleteTable(table.name);
                    onClose();
                  }
                }}
                className="text-xs text-red-400 hover:text-red-300 font-medium px-2 py-1 rounded hover:bg-red-950/30 transition-colors"
              >
                Delete Table
              </button>
            )}
          </div>

          <div className="flex items-center space-x-2">
            <button
              type="button"
              onClick={onClose}
              className="px-3 py-1.5 bg-[#2b2d30] hover:bg-[#35373c] text-[#c4c7cc] text-xs rounded transition-colors"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleSave}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-[#3a82f7] hover:bg-[#2f6fd6] text-white text-xs font-semibold rounded shadow transition-colors"
            >
              <Save className="w-3.5 h-3.5" />
              <span>{isCreatingNew ? 'Create Table' : 'Save Changes'}</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
