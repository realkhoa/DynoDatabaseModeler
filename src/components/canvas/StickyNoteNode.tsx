/**
 * @file StickyNoteNode.tsx
 * @brief Custom React Flow node providing interactive sticky notes on the ERD canvas.
 * @details Allows database architects and developers to leave annotations, architectural
 * decisions, and documentation notes directly adjacent to relational entities.
 */

import { memo, useState } from 'react';
import { Trash2, Palette } from 'lucide-react';

/**
 * @brief Available color themes for StickyNoteNode.
 */
export type StickyNoteColor = 'yellow' | 'blue' | 'green' | 'purple';

/**
 * @brief Data payload carried by each StickyNoteNode instance.
 */
export interface StickyNoteNodeData extends Record<string, unknown> {
  /** @brief Unique note identifier. */
  id: string;
  /** @brief Note content text or markdown. */
  text: string;
  /** @brief Optional title or header. */
  title?: string;
  /** @brief Selected color theme variant. */
  color?: StickyNoteColor;
  /** @brief Callback triggered when text content is modified. */
  onChangeText?: (id: string, text: string) => void;
  /** @brief Callback triggered when color theme is changed. */
  onChangeColor?: (id: string, color: StickyNoteColor) => void;
  /** @brief Callback triggered when delete button is clicked. */
  onDelete?: (id: string) => void;
}

/**
 * @brief Component props for StickyNoteNode.
 */
export interface StickyNoteNodeProps {
  /** @brief Node identifier in React Flow graph. */
  id: string;
  /** @brief Node data containing note content and callbacks. */
  data: StickyNoteNodeData;
  /** @brief Whether node is currently selected. */
  selected?: boolean;
}

/**
 * @brief Color style mapping for sticky note variants.
 */
const COLOR_STYLES: Record<
  StickyNoteColor,
  { bg: string; border: string; text: string; header: string }
> = {
  yellow: {
    bg: 'bg-amber-950/80',
    border: 'border-amber-600/70',
    text: 'text-amber-100',
    header: 'bg-amber-900/60 text-amber-200 border-amber-700/50',
  },
  blue: {
    bg: 'bg-sky-950/80',
    border: 'border-sky-600/70',
    text: 'text-sky-100',
    header: 'bg-sky-900/60 text-sky-200 border-sky-700/50',
  },
  green: {
    bg: 'bg-emerald-950/80',
    border: 'border-emerald-600/70',
    text: 'text-emerald-100',
    header: 'bg-emerald-900/60 text-emerald-200 border-emerald-700/50',
  },
  purple: {
    bg: 'bg-purple-950/80',
    border: 'border-purple-600/70',
    text: 'text-purple-100',
    header: 'bg-purple-900/60 text-purple-200 border-purple-700/50',
  },
};

/**
 * @brief Custom React Flow node rendering an editable sticky note annotation card.
 * @param props Node props including note data and selection status.
 * @return Rendered sticky note element.
 */
export const StickyNoteNode = memo(({ id, data, selected }: StickyNoteNodeProps) => {
  const color = data.color || 'yellow';
  const styles = COLOR_STYLES[color];
  const [isEditing, setIsEditing] = useState(false);
  const [currentText, setCurrentText] = useState(data.text || '');
  const [showColorPicker, setShowColorPicker] = useState(false);

  /**
   * @brief Handles blurring or committing text changes.
   */
  const handleBlur = () => {
    setIsEditing(false);
    if (data.onChangeText && currentText !== data.text) {
      data.onChangeText(id, currentText);
    }
  };

  /**
   * @brief Switches the color of the sticky note.
   * @param newColor Target color variant to switch to.
   */
  const handleColorChange = (newColor: StickyNoteColor) => {
    setShowColorPicker(false);
    if (data.onChangeColor) {
      data.onChangeColor(id, newColor);
    }
  };

  return (
    <div
      data-testid="sticky-note-node"
      className={`min-w-[200px] max-w-[280px] rounded-lg border backdrop-blur-sm shadow-xl transition-all ${
        styles.bg
      } ${styles.border} ${
        selected ? 'ring-2 ring-cyan-400 shadow-cyan-500/20' : ''
      }`}
    >
      {/* Header Bar */}
      <div
        className={`flex items-center justify-between px-3 py-1.5 border-b rounded-t-lg ${styles.header}`}
      >
        <span className="text-xs font-semibold tracking-wide uppercase">
          {data.title || 'Note'}
        </span>
        <div className="flex items-center gap-1">
          {/* Color Switcher Button */}
          <button
            type="button"
            data-testid="sticky-note-color-picker-btn"
            onClick={(e) => {
              e.stopPropagation();
              setShowColorPicker(!showColorPicker);
            }}
            className="p-1 rounded hover:bg-black/20 text-current/80 hover:text-current transition-colors"
            title="Change color"
          >
            <Palette className="w-3.5 h-3.5" />
          </button>

          {/* Delete Button */}
          {data.onDelete && (
            <button
              type="button"
              data-testid="sticky-note-delete-btn"
              onClick={(e) => {
                e.stopPropagation();
                data.onDelete?.(id);
              }}
              className="p-1 rounded hover:bg-rose-500/20 text-current/80 hover:text-rose-400 transition-colors"
              title="Delete note"
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      </div>

      {/* Color Swatch Dropdown */}
      {showColorPicker && (
        <div
          data-testid="sticky-note-color-menu"
          className="flex items-center justify-around p-2 bg-[#1c1d21] border border-[#2c2e33] rounded mx-2 my-1 shadow-lg"
        >
          {(['yellow', 'blue', 'green', 'purple'] as StickyNoteColor[]).map((c) => (
            <button
              key={c}
              type="button"
              data-testid={`color-swatch-${c}`}
              onClick={(e) => {
                e.stopPropagation();
                handleColorChange(c);
              }}
              className={`w-5 h-5 rounded-full border ${
                c === 'yellow'
                  ? 'bg-amber-400 border-amber-600'
                  : c === 'blue'
                  ? 'bg-sky-400 border-sky-600'
                  : c === 'green'
                  ? 'bg-emerald-400 border-emerald-600'
                  : 'bg-purple-400 border-purple-600'
              } hover:scale-110 transition-transform`}
              title={c}
            />
          ))}
        </div>
      )}

      {/* Note Body */}
      <div className="p-3">
        {isEditing ? (
          <textarea
            data-testid="sticky-note-textarea"
            autoFocus
            rows={4}
            value={currentText}
            onChange={(e) => setCurrentText(e.target.value)}
            onBlur={handleBlur}
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                setIsEditing(false);
                setCurrentText(data.text || '');
              }
            }}
            className={`w-full bg-black/20 rounded p-2 text-xs font-mono resize-none focus:outline-none focus:ring-1 focus:ring-cyan-400 ${styles.text}`}
            placeholder="Type your note here..."
          />
        ) : (
          <div
            data-testid="sticky-note-content"
            onDoubleClick={() => setIsEditing(true)}
            className={`text-xs whitespace-pre-wrap min-h-[50px] cursor-text leading-relaxed ${styles.text}`}
          >
            {currentText || (
              <span className="italic opacity-60">Double-click to write note...</span>
            )}
          </div>
        )}
      </div>
    </div>
  );
});

StickyNoteNode.displayName = 'StickyNoteNode';
