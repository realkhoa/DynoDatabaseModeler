/**
 * @file ScratchpadModal.tsx
 * @brief Modal dialog managing reusable SQL queries, diagnostic templates, and scratchpad notes.
 * @details Enables creating, searching, categorizing, and inserting reusable SQL statements,
 * inspired by Antares SQL scratchpad notes and Beekeeper Studio saved queries.
 */

import React, { useState, useEffect, useMemo, useCallback } from 'react';
import {
  X,
  Bookmark,
  Plus,
  Search,
  Trash2,
  Copy,
  Check,
  FileCode,
  Sparkles,
  Save,
  ArrowRight,
} from 'lucide-react';
import type { DatabaseType } from '../../types/database';
import {
  loadSavedSnippets,
  saveSnippet,
  deleteSnippet,
  filterSnippets,
  type SqlSnippet,
} from '../../utils/scratchpad';

/**
 * @brief Properties accepted by the ScratchpadModal component.
 */
export interface ScratchpadModalProps {
  /** @brief Whether the modal dialog is currently visible. */
  isOpen: boolean;
  /** @brief Callback triggered when user requests closing the modal. */
  onClose: () => void;
  /** @brief Active database engine dialect. */
  dbType?: DatabaseType;
  /** @brief Callback invoked when user requests opening the snippet in a new worksheet tab. */
  onOpenInWorksheet?: (sql: string, title?: string) => void;
  /** @brief Callback invoked to insert the snippet SQL into the active editor at the cursor position. */
  onInsertAtCursor?: (sql: string) => void;
}

/**
 * @brief Interactive SQL Snippets & Scratchpad Modal component.
 * @param props Component properties.
 * @return Rendered modal element or null if closed.
 */
export function ScratchpadModal({
  isOpen,
  onClose,
  dbType = 'Postgres',
  onOpenInWorksheet,
  onInsertAtCursor,
}: ScratchpadModalProps): React.ReactElement | null {
  const [snippets, setSnippets] = useState<SqlSnippet[]>([]);
  const [selectedSnippetId, setSelectedSnippetId] = useState<string>('');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [selectedTag, setSelectedTag] = useState<string>('All');
  const [copied, setCopied] = useState<boolean>(false);

  // Edit draft state
  const [draftTitle, setDraftTitle] = useState<string>('');
  const [draftDescription, setDraftDescription] = useState<string>('');
  const [draftTags, setDraftTags] = useState<string>('');
  const [draftSql, setDraftSql] = useState<string>('');
  const [isCreatingNew, setIsCreatingNew] = useState<boolean>(false);
  const [saveSuccess, setSaveSuccess] = useState<boolean>(false);

  const reloadSnippets = useCallback(() => {
    const loaded = loadSavedSnippets(dbType);
    setSnippets(loaded);
    if (!selectedSnippetId && loaded.length > 0) {
      setSelectedSnippetId(loaded[0].id);
    }
  }, [dbType, selectedSnippetId]);

  useEffect(() => {
    if (isOpen) {
      reloadSnippets();
    }
  }, [isOpen, reloadSnippets]);

  // Derive unique tags across snippets
  const allTags = useMemo(() => {
    const tagSet = new Set<string>();
    for (const s of snippets) {
      for (const t of s.tags) {
        tagSet.add(t);
      }
    }
    return ['All', ...Array.from(tagSet).sort()];
  }, [snippets]);

  // Filtered snippet list
  const filteredSnippets = useMemo(() => {
    return filterSnippets(snippets, searchQuery, selectedTag);
  }, [snippets, searchQuery, selectedTag]);

  const activeSnippet = useMemo<SqlSnippet | undefined>(() => {
    return snippets.find((s) => s.id === selectedSnippetId);
  }, [snippets, selectedSnippetId]);

  // Sync draft form with selected snippet
  useEffect(() => {
    if (isCreatingNew) return;
    if (activeSnippet) {
      setDraftTitle(activeSnippet.title);
      setDraftDescription(activeSnippet.description ?? '');
      setDraftTags(activeSnippet.tags.join(', '));
      setDraftSql(activeSnippet.sql);
      setSaveSuccess(false);
    }
  }, [activeSnippet, isCreatingNew]);

  const handleStartNew = useCallback(() => {
    setIsCreatingNew(true);
    setSelectedSnippetId('');
    setDraftTitle('New SQL Snippet');
    setDraftDescription('');
    setDraftTags('Custom');
    setDraftSql('SELECT * FROM your_table LIMIT 10;');
    setSaveSuccess(false);
  }, []);

  const handleSaveDraft = useCallback(() => {
    if (!draftTitle.trim() || !draftSql.trim()) return;

    const parsedTags = draftTags
      .split(',')
      .map((t) => t.trim())
      .filter((t) => t.length > 0);

    const targetId = isCreatingNew || !activeSnippet || activeSnippet.isTemplate
      ? `snippet-${Date.now()}`
      : activeSnippet.id;

    const newSnippet: SqlSnippet = {
      id: targetId,
      title: draftTitle.trim(),
      description: draftDescription.trim() || undefined,
      tags: parsedTags.length > 0 ? parsedTags : ['General'],
      sql: draftSql.trim(),
      createdAt: activeSnippet && !isCreatingNew && !activeSnippet.isTemplate ? activeSnippet.createdAt : new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      isTemplate: false,
    };

    saveSnippet(newSnippet);
    setIsCreatingNew(false);
    setSelectedSnippetId(targetId);
    reloadSnippets();
    setSaveSuccess(true);
    setTimeout(() => setSaveSuccess(false), 2000);
  }, [draftTitle, draftDescription, draftTags, draftSql, isCreatingNew, activeSnippet, reloadSnippets]);

  const handleDeleteActive = useCallback(() => {
    if (!activeSnippet || activeSnippet.isTemplate) return;
    if (window.confirm(`Delete snippet "${activeSnippet.title}"?`)) {
      deleteSnippet(activeSnippet.id);
      setSelectedSnippetId('');
      reloadSnippets();
    }
  }, [activeSnippet, reloadSnippets]);

  const handleCopySql = useCallback(async () => {
    if (!draftSql) return;
    try {
      await navigator.clipboard.writeText(draftSql);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Fallback
    }
  }, [draftSql]);

  const handleOpenWorksheet = useCallback(() => {
    if (!draftSql || !onOpenInWorksheet) return;
    onOpenInWorksheet(draftSql, draftTitle || 'Saved Query');
    onClose();
  }, [draftSql, draftTitle, onOpenInWorksheet, onClose]);

  const handleInsertAtCursor = useCallback(() => {
    if (!draftSql || !onInsertAtCursor) return;
    onInsertAtCursor(draftSql);
    onClose();
  }, [draftSql, onInsertAtCursor, onClose]);

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="scratchpad-modal-title"
    >
      <div className="flex flex-col w-full max-w-5xl h-[85vh] bg-[#1e1f22] border border-[#35383f] rounded-xl shadow-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-150">
        {/* Header Bar */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-[#2d3139] bg-[#24262b]">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-amber-500/10 border border-amber-500/20 rounded-lg text-amber-400">
              <Bookmark className="w-5 h-5" />
            </div>
            <div>
              <h2 id="scratchpad-modal-title" className="text-base font-semibold text-[#f1f2f4]">
                SQL Snippets & Scratchpad
              </h2>
              <p className="text-xs text-[#8c919a]">
                Reusable queries, diagnostic templates, and team scratchpad notes
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 text-[#8c919a] hover:text-[#f1f2f4] hover:bg-[#2d3139] rounded-lg transition-colors"
            title="Close"
            aria-label="Close modal"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content Layout */}
        <div className="flex-1 grid grid-cols-1 md:grid-cols-12 min-h-0 overflow-hidden">
          {/* Left Panel: Search & Snippets List */}
          <div className="md:col-span-5 border-r border-[#2d3139] flex flex-col h-full bg-[#1e1f22] overflow-hidden">
            <div className="p-3 border-b border-[#2d3139] space-y-2.5 bg-[#1a1b1e]">
              <div className="flex items-center gap-2">
                <div className="relative flex-1">
                  <Search className="w-3.5 h-3.5 absolute left-2.5 top-2.5 text-[#8c919a]" />
                  <input
                    type="text"
                    placeholder="Search queries, tags..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="w-full pl-8 pr-3 py-1.5 bg-[#24262b] border border-[#35383f] text-xs text-[#f1f2f4] placeholder-[#8c919a] rounded-lg focus:outline-hidden focus:border-amber-500"
                  />
                </div>
                <button
                  type="button"
                  onClick={handleStartNew}
                  className="flex items-center gap-1 px-3 py-1.5 bg-amber-600 hover:bg-amber-500 text-white text-xs font-medium rounded-lg shadow-sm transition-colors shrink-0"
                  title="Create new snippet"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>New</span>
                </button>
              </div>

              {/* Tag Badges Filter */}
              <div className="flex items-center gap-1.5 overflow-x-auto pb-1 no-scrollbar">
                {allTags.map((tag) => (
                  <button
                    key={tag}
                    type="button"
                    onClick={() => setSelectedTag(tag)}
                    className={`px-2 py-0.5 text-[10px] font-medium rounded-full transition-colors shrink-0 ${
                      selectedTag === tag
                        ? 'bg-amber-500/20 text-amber-400 border border-amber-500/40'
                        : 'bg-[#24262b] text-[#8c919a] hover:text-[#f1f2f4] border border-[#35383f]'
                    }`}
                  >
                    {tag}
                  </button>
                ))}
              </div>
            </div>

            {/* Snippets List */}
            <div className="flex-1 overflow-y-auto divide-y divide-[#24262b]">
              {filteredSnippets.length === 0 ? (
                <div className="py-12 text-center text-xs text-[#8c919a]">
                  No matching snippets found.
                </div>
              ) : (
                filteredSnippets.map((s) => {
                  const isSelected = !isCreatingNew && selectedSnippetId === s.id;
                  return (
                    <button
                      key={s.id}
                      type="button"
                      onClick={() => {
                        setIsCreatingNew(false);
                        setSelectedSnippetId(s.id);
                      }}
                      className={`w-full text-left p-3.5 transition-colors flex flex-col gap-1.5 ${
                        isSelected
                          ? 'bg-[#24262b] border-l-2 border-amber-500'
                          : 'hover:bg-[#1a1b1e]'
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-semibold text-[#f1f2f4] truncate">
                          {s.title}
                        </span>
                        {s.isTemplate ? (
                          <span className="px-1.5 py-0.5 text-[9px] font-bold uppercase bg-blue-500/10 text-blue-400 border border-blue-500/20 rounded">
                            Template
                          </span>
                        ) : null}
                      </div>

                      {s.description && (
                        <p className="text-[11px] text-[#8c919a] line-clamp-1">{s.description}</p>
                      )}

                      <div className="flex flex-wrap items-center gap-1 pt-0.5">
                        {s.tags.map((t) => (
                          <span
                            key={t}
                            className="px-1.5 py-0.5 text-[9px] bg-[#1a1b1e] text-[#8c919a] rounded border border-[#35383f]"
                          >
                            {t}
                          </span>
                        ))}
                      </div>
                    </button>
                  );
                })
              )}
            </div>
          </div>

          {/* Right Panel: Snippet Editor & Actions */}
          <div className="md:col-span-7 flex flex-col h-full bg-[#141518] overflow-hidden">
            {/* Editor Toolbar Header */}
            <div className="p-4 border-b border-[#2d3139] bg-[#1e1f22] space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex-1 mr-4">
                  <input
                    type="text"
                    value={draftTitle}
                    onChange={(e) => setDraftTitle(e.target.value)}
                    placeholder="Snippet Title..."
                    className="w-full bg-[#24262b] border border-[#35383f] text-[#f1f2f4] text-sm font-semibold rounded-lg px-3 py-1.5 focus:outline-hidden focus:border-amber-500"
                  />
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={handleCopySql}
                    className="flex items-center gap-1.5 px-3 py-1.5 bg-[#24262b] hover:bg-[#2d3139] text-[#f1f2f4] text-xs font-medium rounded-lg border border-[#35383f] transition-colors"
                    title="Copy SQL"
                  >
                    {copied ? (
                      <>
                        <Check className="w-3.5 h-3.5 text-emerald-400" />
                        <span className="text-emerald-400">Copied</span>
                      </>
                    ) : (
                      <>
                        <Copy className="w-3.5 h-3.5" />
                        <span>Copy</span>
                      </>
                    )}
                  </button>

                  <button
                    type="button"
                    onClick={handleSaveDraft}
                    className="flex items-center gap-1.5 px-3 py-1.5 bg-amber-600 hover:bg-amber-500 text-white text-xs font-medium rounded-lg shadow-sm transition-colors"
                  >
                    <Save className="w-3.5 h-3.5" />
                    <span>{saveSuccess ? 'Saved!' : 'Save'}</span>
                  </button>

                  {activeSnippet && !activeSnippet.isTemplate && !isCreatingNew && (
                    <button
                      type="button"
                      onClick={handleDeleteActive}
                      className="p-1.5 text-[#8c919a] hover:text-red-400 hover:bg-red-500/10 rounded-lg transition-colors border border-transparent hover:border-red-500/20"
                      title="Delete snippet"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  )}
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <input
                  type="text"
                  value={draftDescription}
                  onChange={(e) => setDraftDescription(e.target.value)}
                  placeholder="Optional description / intent..."
                  className="bg-[#24262b] border border-[#35383f] text-[#c3c6cd] text-xs rounded-lg px-3 py-1 focus:outline-hidden focus:border-amber-500"
                />
                <input
                  type="text"
                  value={draftTags}
                  onChange={(e) => setDraftTags(e.target.value)}
                  placeholder="Tags (comma-separated)..."
                  className="bg-[#24262b] border border-[#35383f] text-[#c3c6cd] text-xs rounded-lg px-3 py-1 focus:outline-hidden focus:border-amber-500"
                />
              </div>
            </div>

            {/* SQL Text Area / Editor */}
            <div className="flex-1 p-4 bg-[#141518] overflow-hidden flex flex-col">
              <label className="text-[10px] uppercase font-semibold text-[#8c919a] mb-2 tracking-wider flex items-center gap-1.5">
                <FileCode className="w-3.5 h-3.5 text-blue-400" />
                SQL Statement
              </label>
              <textarea
                value={draftSql}
                onChange={(e) => setDraftSql(e.target.value)}
                placeholder="Write your SQL query statement here..."
                className="flex-1 w-full bg-[#1a1b1e] border border-[#2d3139] rounded-lg p-3 font-mono text-xs text-[#a9b1d6] leading-relaxed resize-none focus:outline-hidden focus:border-amber-500"
                spellCheck={false}
              />
            </div>

            {/* Bottom Actions Bar */}
            <div className="flex items-center justify-between p-4 border-t border-[#2d3139] bg-[#1e1f22]">
              <div className="text-xs text-[#8c919a] flex items-center gap-2">
                {activeSnippet?.isTemplate && (
                  <span className="flex items-center gap-1 text-blue-400">
                    <Sparkles className="w-3.5 h-3.5" />
                    Built-in Template (Editing saves as a custom snippet)
                  </span>
                )}
              </div>

              <div className="flex items-center gap-3">
                {onInsertAtCursor && (
                  <button
                    type="button"
                    onClick={handleInsertAtCursor}
                    className="flex items-center gap-1.5 px-3 py-1.5 bg-[#24262b] hover:bg-[#2d3139] text-[#f1f2f4] text-xs font-medium rounded-lg border border-[#35383f] transition-colors"
                  >
                    <ArrowRight className="w-3.5 h-3.5 text-amber-400" />
                    <span>Insert at Cursor</span>
                  </button>
                )}

                {onOpenInWorksheet && (
                  <button
                    type="button"
                    onClick={handleOpenWorksheet}
                    className="flex items-center gap-1.5 px-4 py-1.5 bg-blue-600 hover:bg-blue-500 text-white text-xs font-medium rounded-lg shadow-sm transition-colors"
                  >
                    <FileCode className="w-3.5 h-3.5" />
                    <span>Open in Worksheet</span>
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
