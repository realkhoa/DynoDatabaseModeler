/**
 * @file ValueInspectorDrawer.tsx
 * @brief Slide-out inspector drawer for deep examination of cell values.
 * @details Detects content format (JSON, XML, Image, Plain Text, Null),
 * provides syntax-highlighted Monaco Editor or image preview, calculates telemetry
 * metrics (chars, lines, bytes, words), and provides copy & apply edit utilities.
 */

import React, { useState, useEffect, useMemo, useCallback } from 'react';
import Editor from '@monaco-editor/react';
import type { AppTheme } from '../../types/theme';
import { THEMES } from '../../types/theme';
import { getSavedTheme, onThemeChange } from '../../utils/themeManager';
import {
  X,
  Copy,
  Check,
  Download,
  Image as ImageIcon,
  FileCode,
  FileText,
  Braces,
  Save,
} from 'lucide-react';

/**
 * @brief Properties accepted by ValueInspectorDrawer component.
 */
export interface ValueInspectorDrawerProps {
  /** @brief Whether the inspector drawer is open and visible. */
  isOpen: boolean;
  /** @brief Optional name of the column being inspected. */
  columnName?: string;
  /** @brief Raw value stored in the inspected cell. */
  value: any;
  /** @brief Callback triggered when user requests to close the drawer. */
  onClose: () => void;
  /** @brief Optional callback invoked when user applies edits made in the drawer back to the cell. */
  onApplyEdit?: (newValue: any) => void;
}

/**
 * @brief Result object returned by content-type detection helper.
 */
export interface ContentTypeInfo {
  /** @brief Detected format category. */
  format: 'JSON' | 'XML' | 'IMAGE' | 'TEXT' | 'NULL';
  /** @brief Raw text representation of the value. */
  rawText: string;
  /** @brief Formatted, indented, or pretty-printed text representation. */
  formattedText: string;
  /** @brief Flag indicating if the value represents an image. */
  isImage: boolean;
  /** @brief Optional resolved image URL or data URI. */
  imageUrl?: string;
  /** @brief Monaco language identifier for syntax highlighting. */
  monacoLanguage: string;
}

/**
 * @brief Calculates UTF-8 byte size of a given string.
 * @param str Input string to measure.
 * @return Byte count in UTF-8 encoding.
 */
export function calculateByteSize(str: string): number {
  try {
    return new TextEncoder().encode(str).length;
  } catch {
    return str.length;
  }
}

/**
 * @brief Calculates line count of a given string.
 * @param str Input string.
 * @return Number of lines in the string.
 */
export function calculateLineCount(str: string): number {
  if (!str) return 0;
  return str.split('\n').length;
}

/**
 * @brief Calculates word count of a given string.
 * @param str Input string.
 * @return Number of words separated by whitespace.
 */
export function calculateWordCount(str: string): number {
  const trimmed = str.trim();
  if (!trimmed) return 0;
  return trimmed.split(/\s+/).length;
}

/**
 * @brief Formats byte count into human-readable units (B, KB, MB).
 * @param bytes Raw byte count.
 * @return Formatted string with appropriate unit.
 */
export function formatByteSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * @brief Analyzes an arbitrary cell value to identify its content format and prepare display strings.
 * @param value Raw cell value of unknown type.
 * @return Detected ContentTypeInfo structure.
 */
export function detectContentType(value: unknown): ContentTypeInfo {
  if (value === null || value === undefined) {
    return {
      format: 'NULL',
      rawText: '',
      formattedText: 'NULL',
      isImage: false,
      monacoLanguage: 'plaintext',
    };
  }

  // Object or Array -> JSON
  if (typeof value === 'object') {
    try {
      const formatted = JSON.stringify(value, null, 2);
      const raw = JSON.stringify(value);
      return {
        format: 'JSON',
        rawText: raw,
        formattedText: formatted,
        isImage: false,
        monacoLanguage: 'json',
      };
    } catch {
      const fallback = String(value);
      return {
        format: 'TEXT',
        rawText: fallback,
        formattedText: fallback,
        isImage: false,
        monacoLanguage: 'plaintext',
      };
    }
  }

  const strValue = String(value);
  const trimmed = strValue.trim();

  // Data URI Image detection
  if (trimmed.startsWith('data:image/')) {
    return {
      format: 'IMAGE',
      rawText: strValue,
      formattedText: strValue,
      isImage: true,
      imageUrl: trimmed,
      monacoLanguage: 'plaintext',
    };
  }

  // Raw base64 image signature check (PNG: iVBORw0KGgo, JPEG: /9j/, GIF: R0lGOD, WEBP: UklGR)
  const isRawBase64Png = trimmed.startsWith('iVBORw0KGgo');
  const isRawBase64Jpeg = trimmed.startsWith('/9j/');
  const isRawBase64Gif = trimmed.startsWith('R0lGOD');
  const isRawBase64Webp = trimmed.startsWith('UklGR');

  if (
    (isRawBase64Png || isRawBase64Jpeg || isRawBase64Gif || isRawBase64Webp) &&
    trimmed.length > 30 &&
    !trimmed.includes(' ')
  ) {
    let mime = 'image/png';
    if (isRawBase64Jpeg) mime = 'image/jpeg';
    else if (isRawBase64Gif) mime = 'image/gif';
    else if (isRawBase64Webp) mime = 'image/webp';

    return {
      format: 'IMAGE',
      rawText: strValue,
      formattedText: strValue,
      isImage: true,
      imageUrl: `data:${mime};base64,${trimmed}`,
      monacoLanguage: 'plaintext',
    };
  }

  // JSON string detection: starts with { or [ and parseable
  if (
    (trimmed.startsWith('{') && trimmed.endsWith('}')) ||
    (trimmed.startsWith('[') && trimmed.endsWith(']'))
  ) {
    try {
      const parsed = JSON.parse(trimmed);
      return {
        format: 'JSON',
        rawText: strValue,
        formattedText: JSON.stringify(parsed, null, 2),
        isImage: false,
        monacoLanguage: 'json',
      };
    } catch {
      // Continue to next format detection
    }
  }

  // XML string detection: <?xml ...> or <tag>...</tag>
  const isXmlDeclaration = trimmed.startsWith('<?xml');
  const hasXmlTags =
    trimmed.startsWith('<') &&
    trimmed.endsWith('>') &&
    (/<[a-zA-Z0-9_\-:]+[\s\S]*>[\s\S]*<\/[a-zA-Z0-9_\-:]+>/.test(trimmed) ||
      /<[a-zA-Z0-9_\-:]+[\s\S]*\/>/.test(trimmed));

  if (isXmlDeclaration || hasXmlTags) {
    return {
      format: 'XML',
      rawText: strValue,
      formattedText: strValue,
      isImage: false,
      monacoLanguage: 'xml',
    };
  }

  // Fallback: Plain text / number / boolean
  return {
    format: 'TEXT',
    rawText: strValue,
    formattedText: strValue,
    isImage: false,
    monacoLanguage: 'plaintext',
  };
}

/**
 * @brief ValueInspectorDrawer component rendering an interactive inspection panel.
 * @param props Drawer configuration properties.
 * @return Rendered drawer element or null if closed.
 */
export const ValueInspectorDrawer: React.FC<ValueInspectorDrawerProps> = ({
  isOpen,
  columnName,
  value,
  onClose,
  onApplyEdit,
}) => {
  const contentInfo = useMemo(() => detectContentType(value), [value]);
  const [editorContent, setEditorContent] = useState(contentInfo.formattedText);
  const [copiedType, setCopiedType] = useState<'formatted' | 'raw' | null>(null);
  const [activeTheme, setActiveTheme] = useState<AppTheme>(getSavedTheme());

  useEffect(() => {
    return onThemeChange((t) => setActiveTheme(t));
  }, []);
  const [imageDimensions, setImageDimensions] = useState<{
    width: number;
    height: number;
  } | null>(null);

  // Synchronize editor content when value changes
  useEffect(() => {
    setEditorContent(contentInfo.formattedText);
    setImageDimensions(null);
  }, [contentInfo]);

  // Handle Escape key to close drawer
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  /**
   * @brief Copies formatted text representation to user clipboard.
   */
  const handleCopyFormatted = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(contentInfo.formattedText);
      setCopiedType('formatted');
      setTimeout(() => setCopiedType(null), 2000);
    } catch {
      // Clipboard write failure fallback
    }
  }, [contentInfo.formattedText]);

  /**
   * @brief Copies raw unformatted text representation to user clipboard.
   */
  const handleCopyRaw = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(contentInfo.rawText);
      setCopiedType('raw');
      setTimeout(() => setCopiedType(null), 2000);
    } catch {
      // Clipboard write failure fallback
    }
  }, [contentInfo.rawText]);

  /**
   * @brief Downloads inspected image to local filesystem.
   */
  const handleDownloadImage = useCallback(() => {
    if (!contentInfo.imageUrl) return;
    const a = document.createElement('a');
    a.href = contentInfo.imageUrl;
    a.download = `${columnName || 'image'}.png`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  }, [columnName, contentInfo.imageUrl]);

  /**
   * @brief Applies modified editor content back to cell via onApplyEdit callback.
   */
  const handleApply = useCallback(() => {
    if (!onApplyEdit) return;

    if (contentInfo.format === 'JSON') {
      try {
        const parsed = JSON.parse(editorContent);
        onApplyEdit(parsed);
        return;
      } catch {
        // Fallback to raw string if JSON parsing fails
      }
    }

    if (typeof value === 'number') {
      const num = Number(editorContent);
      if (!isNaN(num) && editorContent.trim() !== '') {
        onApplyEdit(num);
        return;
      }
    }

    if (typeof value === 'boolean') {
      const lower = editorContent.trim().toLowerCase();
      if (lower === 'true') {
        onApplyEdit(true);
        return;
      }
      if (lower === 'false') {
        onApplyEdit(false);
        return;
      }
    }

    onApplyEdit(editorContent);
  }, [contentInfo.format, editorContent, onApplyEdit, value]);

  if (!isOpen) return null;

  const charCount = editorContent.length;
  const wordCount = calculateWordCount(editorContent);
  const lineCount = calculateLineCount(editorContent);
  const byteSize = calculateByteSize(editorContent);

  // Badge styling depending on detected format
  const formatBadgeStyles: Record<string, string> = {
    JSON: 'bg-cyan-500/15 text-cyan-400 border-cyan-500/30',
    XML: 'bg-amber-500/15 text-amber-400 border-amber-500/30',
    IMAGE: 'bg-purple-500/15 text-purple-400 border-purple-500/30',
    TEXT: 'bg-blue-500/15 text-blue-400 border-blue-500/30',
    NULL: 'bg-[#2b2d30] text-[#8c919a] border-[#35373c]',
  };

  const badgeClass =
    formatBadgeStyles[contentInfo.format] ||
    'bg-[#2b2d30] text-[#8c919a] border-[#35373c]';

  return (
    <div
      data-testid="value-inspector-drawer"
      className="fixed top-0 right-0 bottom-0 w-[420px] max-w-full bg-[#18191c] border-l border-[#2c2e33] shadow-2xl flex flex-col z-50 text-xs font-sans animate-in slide-in-from-right duration-200"
    >
      {/* Header */}
      <div className="h-12 px-4 bg-[#212328] border-b border-[#2c2e33] flex items-center justify-between shrink-0">
        <div className="flex items-center space-x-2 min-w-0">
          {contentInfo.isImage ? (
            <ImageIcon className="w-4 h-4 text-purple-400 shrink-0" />
          ) : contentInfo.format === 'JSON' ? (
            <Braces className="w-4 h-4 text-cyan-400 shrink-0" />
          ) : contentInfo.format === 'XML' ? (
            <FileCode className="w-4 h-4 text-amber-400 shrink-0" />
          ) : (
            <FileText className="w-4 h-4 text-blue-400 shrink-0" />
          )}

          <span
            className="font-semibold text-[#e6e8ea] truncate max-w-[180px]"
            title={columnName}
          >
            {columnName || 'Cell Value'}
          </span>

          <span
            className={`px-1.5 py-0.5 rounded text-[10px] font-mono font-bold border uppercase ${badgeClass}`}
          >
            {contentInfo.format}
          </span>
        </div>

        <button
          type="button"
          onClick={onClose}
          aria-label="Close drawer"
          className="p-1 text-[#8c919a] hover:text-[#e6e8ea] hover:bg-[#2c2e33] rounded transition-colors cursor-pointer"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Telemetry Bar */}
      <div className="px-4 py-1.5 bg-[#1b1c20] border-b border-[#2c2e33] flex items-center justify-between text-[11px] font-mono text-[#8c919a] shrink-0">
        <div className="flex items-center space-x-3">
          <span data-testid="telemetry-chars">
            {charCount.toLocaleString()} chars
          </span>
          <span>•</span>
          <span data-testid="telemetry-words">
            {wordCount.toLocaleString()} words
          </span>
          <span>•</span>
          <span data-testid="telemetry-lines">{lineCount} lines</span>
          <span>•</span>
          <span data-testid="telemetry-bytes">{formatByteSize(byteSize)}</span>
        </div>

        {contentInfo.isImage && imageDimensions && (
          <span className="text-purple-400">
            {imageDimensions.width} × {imageDimensions.height} px
          </span>
        )}
      </div>

      {/* Main Content Area */}
      <div className="flex-1 min-h-0 flex flex-col bg-[#141517] overflow-hidden">
        {contentInfo.isImage && contentInfo.imageUrl ? (
          <div className="flex-1 flex flex-col items-center justify-center p-4 overflow-auto">
            <div className="p-3 bg-[#1e2024] rounded-lg border border-[#2c2e33] max-w-full shadow-inner flex flex-col items-center">
              <img
                src={contentInfo.imageUrl}
                alt={`${columnName || 'Cell'} preview`}
                onLoad={(e) => {
                  setImageDimensions({
                    width: e.currentTarget.naturalWidth,
                    height: e.currentTarget.naturalHeight,
                  });
                }}
                className="max-h-72 max-w-full object-contain rounded border border-[#35373c]/50 shadow-md"
              />

              <div className="mt-3 flex items-center space-x-2">
                <button
                  type="button"
                  onClick={handleDownloadImage}
                  className="flex items-center space-x-1.5 px-3 py-1 bg-[#2c2e33] hover:bg-[#383a40] text-[#e6e8ea] rounded text-xs font-semibold transition-colors cursor-pointer"
                >
                  <Download className="w-3.5 h-3.5" />
                  <span>Download Image</span>
                </button>
              </div>
            </div>
          </div>
        ) : (
          <div className="flex-1 min-h-0 bg-[#121316]">
            <Editor
              height="100%"
              language={contentInfo.monacoLanguage}
              theme={THEMES[activeTheme]?.monacoTheme || 'vs-dark'}
              value={editorContent}
              onChange={(val) => setEditorContent(val ?? '')}
              options={{
                minimap: { enabled: false },
                fontSize: 12,
                fontFamily: 'JetBrains Mono, monospace',
                lineNumbers: 'on',
                automaticLayout: true,
                scrollBeyondLastLine: false,
                wordWrap: 'on',
                readOnly: !onApplyEdit,
              }}
            />
          </div>
        )}
      </div>

      {/* Footer Actions */}
      <div className="p-3 bg-[#212328] border-t border-[#2c2e33] flex items-center justify-between shrink-0">
        <div className="flex items-center space-x-2">
          <button
            type="button"
            onClick={handleCopyFormatted}
            className="flex items-center space-x-1.5 px-2.5 py-1 bg-[#2c2e33] hover:bg-[#383a40] text-[#e6e8ea] rounded font-semibold transition-colors cursor-pointer"
          >
            {copiedType === 'formatted' ? (
              <Check className="w-3.5 h-3.5 text-emerald-400" />
            ) : (
              <Copy className="w-3.5 h-3.5 text-[#8c919a]" />
            )}
            <span>
              {copiedType === 'formatted' ? 'Copied!' : 'Copy Formatted'}
            </span>
          </button>

          <button
            type="button"
            onClick={handleCopyRaw}
            className="flex items-center space-x-1.5 px-2.5 py-1 bg-[#2c2e33] hover:bg-[#383a40] text-[#8c919a] hover:text-[#e6e8ea] rounded font-semibold transition-colors cursor-pointer"
          >
            {copiedType === 'raw' ? (
              <Check className="w-3.5 h-3.5 text-emerald-400" />
            ) : (
              <Copy className="w-3.5 h-3.5" />
            )}
            <span>{copiedType === 'raw' ? 'Copied!' : 'Copy Raw'}</span>
          </button>
        </div>

        {onApplyEdit && (
          <button
            type="button"
            onClick={handleApply}
            className="flex items-center space-x-1.5 px-3 py-1 bg-[#3a82f7] hover:bg-[#2b6fd6] text-white rounded font-semibold transition-colors shadow-xs cursor-pointer"
          >
            <Save className="w-3.5 h-3.5" />
            <span>Apply to Cell</span>
          </button>
        )}
      </div>
    </div>
  );
};
