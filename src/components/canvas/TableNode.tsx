/**
 * @file TableNode.tsx
 * @brief Custom React Flow node rendering relational database table schema cards.
 * @details Visualizes table title, column specifications, primary key markers, foreign key
 * associations, nullability indicators, and per-column connection handles for relationship curves.
 */

import { memo, useMemo } from 'react';
import { Handle, Position } from '@xyflow/react';
import { Eye, Key, Link as LinkIcon, Table as TableIcon } from 'lucide-react';
import {
  ColumnSchema,
  ForeignKeySchema,
  formatCanonicalType,
} from '../../types/database';

/**
 * @brief Data payload carried by each TableNode instance in React Flow.
 */
export interface TableNodeData extends Record<string, unknown> {
  /** @brief Table identifier name. */
  label: string;
  /** @brief Schema namespace, e.g. 'public' or 'dbo'. */
  schema?: string;
  /** @brief Ordered list of column schemas defined within the table. */
  columns: ColumnSchema[];
  /** @brief Foreign keys originating from or targeting this table. */
  foreignKeys?: ForeignKeySchema[];
  /** @brief Callback triggered when the user requests editing this table. */
  onEdit?: (tableName: string) => void;
  /** @brief Optional callback triggered when the user requests viewing rows of this table. */
  onViewData?: (tableKey: string) => void;
}

/**
 * @brief Properties accepted by the TableNode component.
 */
export interface TableNodeProps {
  /** @brief Unique node identifier in the React Flow graph. */
  id: string;
  /** @brief React Flow node type identifier. */
  type?: string;
  /** @brief Data payload containing table metadata and action callbacks. */
  data: TableNodeData;
  /** @brief Indicates whether this node is currently selected on the canvas. */
  selected?: boolean;
}

/**
 * @brief Custom React Flow node rendering a sleek database entity card.
 * @param props Node props including table metadata payload and selection state.
 * @return Rendered table card element.
 */
export const TableNode = memo(
  ({ data, selected }: TableNodeProps) => {
    const { label, schema, columns = [], foreignKeys = [], onEdit, onViewData } = data;

    const fkColumnNames = useMemo(() => {
      const set = new Set<string>();
      for (const fk of foreignKeys) {
        if (fk.source_column) set.add(fk.source_column);
        if (fk.target_column) set.add(fk.target_column);
      }
      return set;
    }, [foreignKeys]);

  /**
   * @brief Handles double click on the table header to trigger inspection/edit drawer.
   */
  const handleHeaderDoubleClick = () => {
    if (onEdit) {
      onEdit(label);
    }
  };

  return (
    <div
      className={`bg-[#24262b] border rounded-md shadow-2xl min-w-[220px] max-w-[300px] overflow-hidden text-xs transition-shadow ${
        selected ? 'border-[#3a82f7] ring-1 ring-[#3a82f7]' : 'border-[#3a3d45] hover:border-[#4f535d]'
      }`}
    >
      {/* Table Header */}
      <div
        onDoubleClick={handleHeaderDoubleClick}
        className="bg-[#2b2e36] px-3 py-2 border-b border-[#3a3d45] flex items-center justify-between font-semibold text-[#e6e8ea] cursor-pointer select-none group"
        title="Double-click to edit table"
      >
        <div className="flex items-center space-x-1.5 truncate">
          <TableIcon className="w-3.5 h-3.5 text-[#3a82f7] shrink-0" />
          <span className="truncate text-xs font-bold text-[#e6e8ea] group-hover:text-white">
            {label}
          </span>
        </div>
        <div className="flex items-center shrink-0 ml-2">
          {onViewData && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                const key = schema ? `${schema}.${label}` : label;
                onViewData(key);
              }}
              title={`View table rows for ${label}`}
              aria-label={`View table rows for ${label}`}
              className="p-1 text-[#8c919a] hover:text-[#3a82f7] hover:bg-[#1e2024] rounded transition-colors cursor-pointer mr-1"
            >
              <Eye className="w-3.5 h-3.5" />
            </button>
          )}
          <span className="text-[10px] text-[#8c919a] bg-[#1e2024] px-1.5 py-0.5 rounded font-mono">
            {columns.length}
          </span>
        </div>
      </div>

      {/* Columns List */}
      <div className="divide-y divide-[#2f323a]">
        {columns.map((col) => {
          const typeStr = formatCanonicalType(col.data_type);
          const isForeignKey = fkColumnNames.has(col.name);

          return (
            <div
              key={col.name}
              className="relative px-3 py-1.5 flex items-center justify-between text-[#c4c7cc] hover:bg-[#2b2d33] transition-colors"
            >
              {/* Left Handle (Target for incoming foreign key references) */}
              <Handle
                type="target"
                position={Position.Left}
                id={`${col.name}-target`}
                style={{
                  top: '50%',
                  background: '#3a82f7',
                  width: 8,
                  height: 8,
                  border: '2px solid #1e2024',
                }}
              />

              {/* Column Identifiers & Key Icons */}
              <div className="flex items-center space-x-1.5 truncate mr-2">
                {col.is_primary_key && (
                  <span title="Primary Key" className="inline-flex shrink-0">
                    <Key
                      className="w-3 h-3 text-[#f5a623]"
                      data-testid={`pk-icon-${col.name}`}
                    />
                  </span>
                )}
                {isForeignKey && (
                  <span title="Foreign Key" className="inline-flex shrink-0">
                    <LinkIcon
                      className="w-3 h-3 text-[#20c997]"
                      data-testid={`fk-icon-${col.name}`}
                    />
                  </span>
                )}
                <span
                  className={`truncate font-mono ${
                    col.is_primary_key ? 'font-semibold text-[#e6e8ea]' : 'text-[#c4c7cc]'
                  }`}
                >
                  {col.name}
                </span>
              </div>

              {/* Data Type & Not Null Badges */}
              <div className="flex items-center space-x-1.5 text-[10px] shrink-0 font-mono">
                <span className="text-[#8c919a] uppercase text-[9px] tracking-tight">
                  {typeStr}
                </span>
                {!col.is_nullable && (
                  <span
                    className="text-[#e05252] font-mono text-[8px] bg-red-950/40 px-1 py-0.5 rounded border border-red-800/40 font-bold"
                    title="NOT NULL"
                  >
                    NN
                  </span>
                )}
              </div>

              {/* Right Handle (Source for outgoing foreign key references) */}
              <Handle
                type="source"
                position={Position.Right}
                id={`${col.name}-source`}
                style={{
                  top: '50%',
                  background: '#20c997',
                  width: 8,
                  height: 8,
                  border: '2px solid #1e2024',
                }}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
  },
  areTableNodesEqual
);

/**
 * @brief Custom memoization comparator for TableNode to eliminate unnecessary canvas re-renders.
 * @param prev Previous node properties.
 * @param next Next node properties.
 * @return True if table node props are visually identical.
 */
function areTableNodesEqual(
  prev: TableNodeProps,
  next: TableNodeProps
): boolean {
  return (
    prev.selected === next.selected &&
    prev.id === next.id &&
    prev.data.label === next.data.label &&
    prev.data.schema === next.data.schema &&
    prev.data.columns === next.data.columns &&
    prev.data.foreignKeys === next.data.foreignKeys &&
    prev.data.onEdit === next.data.onEdit &&
    prev.data.onViewData === next.data.onViewData
  );
}

TableNode.displayName = 'TableNode';
