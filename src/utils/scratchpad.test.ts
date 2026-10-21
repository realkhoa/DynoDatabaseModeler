/**
 * @file scratchpad.test.ts
 * @brief Unit tests for SQL snippets manager and scratchpad storage utilities.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  getDefaultSnippets,
  loadSavedSnippets,
  saveSnippet,
  deleteSnippet,
  filterSnippets,
  type SqlSnippet,
} from './scratchpad';

describe('scratchpad', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  describe('getDefaultSnippets', () => {
    it('returns standard pre-loaded diagnostic templates', () => {
      const snippets = getDefaultSnippets();
      expect(snippets.length).toBeGreaterThanOrEqual(3);
      expect(snippets.some((s) => s.id === 'template-duplicate-rows')).toBe(true);
      expect(snippets.every((s) => s.isTemplate)).toBe(true);
    });
  });

  describe('saveSnippet, loadSavedSnippets, deleteSnippet', () => {
    it('saves a user snippet to localStorage and loads it back', () => {
      const userSnippet: SqlSnippet = {
        id: 'test-snippet-1',
        title: 'Monthly Active Users',
        sql: 'SELECT COUNT(*) FROM users WHERE last_login > NOW() - INTERVAL 30 DAY;',
        tags: ['Reporting'],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      saveSnippet(userSnippet);
      const loaded = loadSavedSnippets();

      expect(loaded.some((s) => s.id === 'test-snippet-1')).toBe(true);
      const found = loaded.find((s) => s.id === 'test-snippet-1');
      expect(found?.title).toBe('Monthly Active Users');
    });

    it('updates an existing snippet in place', () => {
      const userSnippet: SqlSnippet = {
        id: 'test-snippet-1',
        title: 'Initial Title',
        sql: 'SELECT 1;',
        tags: ['General'],
        createdAt: '2026-01-01T00:00:00Z',
        updatedAt: '2026-01-01T00:00:00Z',
      };

      saveSnippet(userSnippet);
      saveSnippet({ ...userSnippet, title: 'Updated Title' });

      const loaded = loadSavedSnippets();
      const match = loaded.find((s) => s.id === 'test-snippet-1');
      expect(match?.title).toBe('Updated Title');
    });

    it('deletes a user snippet from localStorage', () => {
      const userSnippet: SqlSnippet = {
        id: 'delete-me',
        title: 'Temporary',
        sql: 'SELECT 1;',
        tags: ['Temp'],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      saveSnippet(userSnippet);
      expect(loadSavedSnippets().some((s) => s.id === 'delete-me')).toBe(true);

      deleteSnippet('delete-me');
      expect(loadSavedSnippets().some((s) => s.id === 'delete-me')).toBe(false);
    });
  });

  describe('filterSnippets', () => {
    const list: SqlSnippet[] = [
      { id: '1', title: 'Top Customers', sql: 'SELECT * FROM customers', tags: ['Sales'], createdAt: '', updatedAt: '' },
      { id: '2', title: 'Daily Revenue', sql: 'SELECT sum(amount) FROM orders', tags: ['Finance'], createdAt: '', updatedAt: '' },
      { id: '3', title: 'Deadlock Check', sql: 'SELECT * FROM deadlocks', tags: ['Diagnostics'], createdAt: '', updatedAt: '' },
    ];

    it('filters by keyword search', () => {
      const res = filterSnippets(list, 'revenue');
      expect(res).toHaveLength(1);
      expect(res[0].id).toBe('2');
    });

    it('filters by tag', () => {
      const res = filterSnippets(list, '', 'Diagnostics');
      expect(res).toHaveLength(1);
      expect(res[0].id).toBe('3');
    });

    it('returns all when query is empty and tag is All', () => {
      expect(filterSnippets(list, '', 'All')).toHaveLength(3);
    });
  });
});
