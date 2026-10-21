/**
 * @file GroupNode.tsx
 * @brief Custom React Flow container node grouping relational database tables by domain.
 * @details Provides visual boundary frames (e.g., 'Auth Domain', 'Billing Domain') on the ERD canvas
 * to organize complex database architectures into cohesive modular clusters.
 */

import { memo, useState } from 'react';
import { Layers, Trash2 } from 'lucide-react';

/**
 * @brief Data payload carried by each GroupNode instance.
 */
export interface GroupNodeData extends Record<string, unknown> {
  /** @brief Unique group identifier. */
  id: string;
  /** @brief Domain title or label. */
  label: string;
  /** @brief Accent theme color for border and header badge. */
  color?: string;
  /** @brief Width in pixels. */
  width?: number;
  /** @brief Height in pixels. */
  height?: number;
  /** @brief Callback triggered when group title is updated. */
  onChangeLabel?: (id: string, newLabel: string) => void;
  /** @brief Callback triggered when group is deleted. */
  onDelete?: (id: string) => void;
}

/**
 * @brief Component props for GroupNode.
 */
export interface GroupNodeProps {
  /** @brief Node identifier in React Flow graph. */
  id: string;
  /** @brief Group metadata payload and callbacks. */
  data: GroupNodeData;
  /** @brief Indicates whether group container is currently selected. */
  selected?: boolean;
}

/**
 * @brief Custom React Flow container node visualizing domain clusters.
 * @param props Group node props including title and callbacks.
 * @return Rendered group boundary element.
 */
export const GroupNode = memo(({ id, data, selected }: GroupNodeProps) => {
  const [isEditing, setIsEditing] = useState(false);
  const [label, setLabel] = useState(data.label || 'Domain Group');
  const accentColor = data.color || '#3b82f6'; // default blue

  const handleBlur = () => {
    setIsEditing(false);
    if (data.onChangeLabel && label !== data.label) {
      data.onChangeLabel(id, label);
    }
  };

  return (
    <div
      data-testid="group-node"
      style={{
        borderColor: accentColor,
        minWidth: data.width || 320,
        minHeight: data.height || 220,
      }}
      className={`relative rounded-xl border-2 border-dashed bg-black/30 backdrop-blur-[2px] transition-all p-3 ${
        selected ? 'ring-2 ring-cyan-400 ring-offset-2 ring-offset-black/50' : ''
      }`}
    >
      {/* Header Bar */}
      <div className="flex items-center justify-between pb-2 mb-2 border-b border-white/10">
        <div className="flex items-center gap-2">
          <div
            style={{ backgroundColor: `${accentColor}33`, color: accentColor }}
            className="p-1.5 rounded-md"
          >
            <Layers className="w-4 h-4" />
          </div>

          {isEditing ? (
            <input
              type="text"
              data-testid="group-label-input"
              autoFocus
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              onBlur={handleBlur}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleBlur();
                if (e.key === 'Escape') {
                  setIsEditing(false);
                  setLabel(data.label || 'Domain Group');
                }
              }}
              className="bg-black/40 border border-white/20 rounded px-2 py-0.5 text-xs font-semibold text-current focus:outline-none focus:ring-1 focus:ring-cyan-400"
            />
          ) : (
            <span
              data-testid="group-label"
              onDoubleClick={() => setIsEditing(true)}
              className="text-xs font-bold tracking-wider uppercase text-[#e6e8ea] cursor-text hover:opacity-80 transition-opacity"
            >
              {label}
            </span>
          )}
        </div>

        {data.onDelete && (
          <button
            type="button"
            data-testid="group-delete-btn"
            onClick={(e) => {
              e.stopPropagation();
              data.onDelete?.(id);
            }}
            className="p-1 rounded text-[#8c919a] hover:text-rose-400 hover:bg-rose-500/10 transition-colors"
            title="Delete group"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        )}
      </div>

      {/* Interior Placeholder / Description */}
      <div className="text-[10px] text-[#8c919a] pointer-events-none select-none pl-1">
        Drag related entity tables inside this domain frame
      </div>
    </div>
  );
});

GroupNode.displayName = 'GroupNode';
