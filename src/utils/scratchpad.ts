/**
 * @file scratchpad.ts
 * @brief Persistent SQL query scratchpad, snippets manager, and diagnostics templates.
 * @details Manages saved queries, categories, tags, and pre-loaded diagnostic templates,
 * inspired by Antares SQL scratchpad notes and Beekeeper Studio saved queries.
 */

import type { DatabaseType } from '../types/database';

/**
 * @brief Saved SQL query snippet entity.
 */
export interface SqlSnippet {
  /** @brief Unique identifier string. */
  id: string;
  /** @brief Display title for the snippet. */
  title: string;
  /** @brief SQL query statement text. */
  sql: string;
  /** @brief Optional explanation or documentation for the query. */
  description?: string;
  /** @brief Categorization tags (e.g., 'Diagnostics', 'Performance', 'Reporting'). */
  tags: string[];
  /** @brief Creation ISO timestamp. */
  createdAt: string;
  /** @brief Last update ISO timestamp. */
  updatedAt: string;
  /** @brief Whether this snippet is a built-in diagnostic template. */
  isTemplate?: boolean;
}

const STORAGE_KEY = 'dyno_sql_scratchpad_snippets_v1';

/**
 * @brief Returns built-in SQL diagnostic and utility snippet templates.
 * @param _dbType Optional target database engine dialect.
 * @return Array of pre-loaded diagnostic snippet templates.
 */
export function getDefaultSnippets(_dbType: DatabaseType = 'Postgres'): SqlSnippet[] {
  return [
    {
      id: 'template-duplicate-rows',
      title: 'Find Duplicate Records in Table',
      description: 'Identifies rows sharing identical values across specified columns.',
      sql: `-- Replace 'your_table' and columns with target names\nSELECT col1, col2, COUNT(*)\nFROM your_table\nGROUP BY col1, col2\nHAVING COUNT(*) > 1\nORDER BY COUNT(*) DESC;`,
      tags: ['Diagnostics', 'Data Quality'],
      createdAt: '2026-01-01T00:00:00Z',
      updatedAt: '2026-01-01T00:00:00Z',
      isTemplate: true,
    },
    {
      id: 'template-row-counts',
      title: 'Table Row Counts Overview',
      description: 'Returns approximate row counts across all user tables.',
      sql: `-- Generic table inspection\nSELECT table_name, table_type\nFROM information_schema.tables\nWHERE table_schema = 'public'\nORDER BY table_name;`,
      tags: ['Catalog', 'Schema'],
      createdAt: '2026-01-01T00:00:00Z',
      updatedAt: '2026-01-01T00:00:00Z',
      isTemplate: true,
    },
    {
      id: 'template-missing-pks',
      title: 'Audit Tables Without Primary Keys',
      description: 'Detects tables in schema missing a primary key constraint.',
      sql: `-- Tables without primary key\nSELECT t.table_name\nFROM information_schema.tables t\nLEFT JOIN information_schema.table_constraints tc\n  ON t.table_name = tc.table_name\n  AND tc.constraint_type = 'PRIMARY KEY'\nWHERE t.table_schema = 'public'\n  AND t.table_type = 'BASE TABLE'\n  AND tc.constraint_name IS NULL;`,
      tags: ['Audit', 'Schema Safety'],
      createdAt: '2026-01-01T00:00:00Z',
      updatedAt: '2026-01-01T00:00:00Z',
      isTemplate: true,
    },
    {
      id: 'template-null-audit',
      title: 'Column Null Values Audit',
      description: 'Computes total count and percentage of NULL entries in a column.',
      sql: `SELECT\n  COUNT(*) AS total_rows,\n  COUNT(target_col) AS non_null_count,\n  COUNT(*) - COUNT(target_col) AS null_count,\n  ROUND((COUNT(*) - COUNT(target_col)) * 100.0 / NULLIF(COUNT(*), 0), 2) AS null_pct\nFROM your_table;`,
      tags: ['Data Quality', 'Analytics'],
      createdAt: '2026-01-01T00:00:00Z',
      updatedAt: '2026-01-01T00:00:00Z',
      isTemplate: true,
    },
  ];
}

/**
 * @brief Loads user-saved snippets from localStorage combined with built-in templates.
 * @param dbType Optional target database engine dialect.
 * @return Array of all active snippets.
 */
export function loadSavedSnippets(dbType: DatabaseType = 'Postgres'): SqlSnippet[] {
  const defaults = getDefaultSnippets(dbType);
  if (typeof window === 'undefined' || !window.localStorage) {
    return defaults;
  }

  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return defaults;
    const userSnippets: SqlSnippet[] = JSON.parse(raw);
    if (!Array.isArray(userSnippets)) return defaults;
    return [...userSnippets, ...defaults];
  } catch {
    return defaults;
  }
}

/**
 * @brief Saves or updates a user snippet in localStorage.
 * @param snippet Snippet entity to save.
 */
export function saveSnippet(snippet: SqlSnippet): void {
  if (typeof window === 'undefined' || !window.localStorage) return;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    const existing: SqlSnippet[] = raw ? JSON.parse(raw) : [];
    const index = existing.findIndex((s) => s.id === snippet.id);

    const updatedSnippet = {
      ...snippet,
      updatedAt: new Date().toISOString(),
    };

    if (index >= 0) {
      existing[index] = updatedSnippet;
    } else {
      existing.unshift(updatedSnippet);
    }

    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(existing));
  } catch (err) {
    console.error('Failed to save snippet to localStorage:', err);
  }
}

/**
 * @brief Removes a user snippet from localStorage by ID.
 * @param id Snippet identifier to delete.
 */
export function deleteSnippet(id: string): void {
  if (typeof window === 'undefined' || !window.localStorage) return;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    const existing: SqlSnippet[] = JSON.parse(raw);
    const filtered = existing.filter((s) => s.id !== id);
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(filtered));
  } catch (err) {
    console.error('Failed to delete snippet from localStorage:', err);
  }
}

/**
 * @brief Filters snippets by query keyword and active tag.
 * @param snippets Collection of snippets.
 * @param query Search query string.
 * @param activeTag Optional tag filter.
 * @return Filtered array of matching snippets.
 */
export function filterSnippets(
  snippets: SqlSnippet[],
  query: string,
  activeTag?: string
): SqlSnippet[] {
  return snippets.filter((s) => {
    if (activeTag && activeTag !== 'All' && !s.tags.includes(activeTag)) {
      return false;
    }
    if (!query.trim()) return true;
    const q = query.toLowerCase();
    return (
      s.title.toLowerCase().includes(q) ||
      (s.description && s.description.toLowerCase().includes(q)) ||
      s.sql.toLowerCase().includes(q) ||
      s.tags.some((t) => t.toLowerCase().includes(q))
    );
  });
}
