/**
 * @file dataTransfer.test.ts
 * @brief Unit tests for multi-format data export utilities (CSV, JSON, Markdown, SQL).
 * @details Validates RFC 4180 CSV escaping, delimiter customization, quoteAll behavior,
 * JSON object serialization and pretty printing, Markdown table escaping with pipes/newlines,
 * dialect-safe SQL INSERT statement generation, and browser blob download trigger.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  exportAsCsv,
  exportAsJson,
  exportAsMarkdown,
  exportAsSqlInserts,
  downloadExportFile,
} from './dataTransfer';

describe('dataTransfer utility functions', () => {
  const sampleColumns = ['id', 'name', 'active', 'details'];
  const sampleRows = [
    [1, 'Alice', true, { role: 'admin' }],
    [2, 'Bob, Jr.', false, null],
    [3, 'Charlie "The Boss"\nNew line', true, 'Simple string'],
  ];

  describe('exportAsCsv', () => {
    it('exports rows to CSV with default comma delimiter and RFC 4180 escaping', () => {
      const csv = exportAsCsv(sampleColumns, sampleRows);
      const lines = csv.split('\n');

      expect(lines[0]).toBe('id,name,active,details');
      expect(lines[1]).toBe('1,Alice,true,"{""role"":""admin""}"');
      // Bob, Jr. has comma so must be quoted
      expect(lines[2]).toBe('2,"Bob, Jr.",false,');
      // Charlie has quote and newline so must be quoted and internal quotes doubled
      expect(csv).toContain('"Charlie ""The Boss""\nNew line"');
    });

    it('supports custom delimiter such as semicolon or tab', () => {
      const semicolonCsv = exportAsCsv(
        ['col1', 'col2'],
        [['A;B', 'Normal']],
        { delimiter: ';' }
      );
      expect(semicolonCsv).toBe('col1;col2\n"A;B";Normal');

      const tabCsv = exportAsCsv(
        ['col1', 'col2'],
        [['Hello\tWorld', 123]],
        { delimiter: '\t' }
      );
      expect(tabCsv).toBe('col1\tcol2\n"Hello\tWorld"\t123');
    });

    it('quotes all fields when quoteAll is true', () => {
      const quoted = exportAsCsv(['a', 'b'], [[1, 'test']], { quoteAll: true });
      expect(quoted).toBe('"a","b"\n"1","test"');
    });

    it('handles empty rows and null/undefined values gracefully', () => {
      const empty = exportAsCsv(['id', 'val'], []);
      expect(empty).toBe('id,val');

      const nullRows = exportAsCsv(['c1', 'c2'], [[null, undefined]]);
      expect(nullRows).toBe('c1,c2\n,');
    });
  });

  describe('exportAsJson', () => {
    it('serializes rows into an array of objects with pretty formatting', () => {
      const json = exportAsJson(['id', 'name'], [[1, 'Alice'], [2, 'Bob']], true);
      const parsed = JSON.parse(json);

      expect(parsed).toEqual([
        { id: 1, name: 'Alice' },
        { id: 2, name: 'Bob' },
      ]);
      expect(json).toContain('    "id": 1');
    });

    it('serializes rows into compact JSON when pretty is false', () => {
      const json = exportAsJson(['id', 'name'], [[1, 'Alice']], false);
      expect(json).toBe('[{"id":1,"name":"Alice"}]');
    });

    it('handles empty rows and empty columns', () => {
      expect(exportAsJson([], [])).toBe('[]');
      expect(exportAsJson(['a'], [])).toBe('[]');
    });
  });

  describe('exportAsMarkdown', () => {
    it('generates a GitHub-flavored Markdown table with headers and separators', () => {
      const md = exportAsMarkdown(['id', 'name'], [[1, 'Alice'], [2, 'Bob']]);
      const lines = md.split('\n');

      expect(lines[0]).toBe('| id | name |');
      expect(lines[1]).toBe('| --- | --- |');
      expect(lines[2]).toBe('| 1 | Alice |');
      expect(lines[3]).toBe('| 2 | Bob |');
    });

    it('escapes internal pipes and converts newlines to preserve table structure', () => {
      const md = exportAsMarkdown(
        ['formula', 'notes'],
        [['A | B', 'Line 1\nLine 2']]
      );
      const lines = md.split('\n');

      expect(lines[0]).toBe('| formula | notes |');
      expect(lines[1]).toBe('| --- | --- |');
      // Pipe escaped and newline replaced
      expect(lines[2]).toContain('A \\| B');
      expect(lines[2]).not.toContain('\nLine 2');
      expect(lines[2]).toContain('Line 1<br/>Line 2');
    });

    it('handles null and undefined cell values as empty table cells', () => {
      const md = exportAsMarkdown(['col1', 'col2'], [[null, undefined]]);
      expect(md).toBe('| col1 | col2 |\n| --- | --- |\n|  |  |');
    });
  });

  describe('exportAsSqlInserts', () => {
    it('generates valid SQL INSERT statements for rows', () => {
      const sql = exportAsSqlInserts(
        ['id', 'name', 'active'],
        [
          [1, 'Alice', true],
          [2, "O'Connor", false],
        ],
        { tableName: 'users' }
      );
      const lines = sql.trim().split('\n');

      expect(lines[0]).toBe("INSERT INTO \"users\" (\"id\", \"name\", \"active\") VALUES (1, 'Alice', TRUE);");
      // Escapes single quotes by doubling them
      expect(lines[1]).toBe("INSERT INTO \"users\" (\"id\", \"name\", \"active\") VALUES (2, 'O''Connor', FALSE);");
    });

    it('handles null, undefined, and complex JSON object values in SQL', () => {
      const sql = exportAsSqlInserts(
        ['id', 'payload', 'deleted_at'],
        [[10, { count: 5 }, null]],
        { tableName: 'events' }
      );
      expect(sql.trim()).toBe(
        "INSERT INTO \"events\" (\"id\", \"payload\", \"deleted_at\") VALUES (10, '{\"count\":5}', NULL);"
      );
    });

    it('escapes backslashes so literals survive non-standard-conforming servers', () => {
      const sql = exportAsSqlInserts(
        ['id', 'path'],
        [[1, 'C:\\temp\\file']],
        { tableName: 'files' }
      );
      expect(sql.trim()).toBe(
        "INSERT INTO \"files\" (\"id\", \"path\") VALUES (1, 'C:\\\\temp\\\\file');"
      );
    });

    it('quotes reserved-word identifiers and schema-qualified table names', () => {
      const sql = exportAsSqlInserts(
        ['order', 'select'],
        [[1, 'x']],
        { tableName: 'sales.order' }
      );
      expect(sql.trim()).toBe(
        "INSERT INTO \"sales\".\"order\" (\"order\", \"select\") VALUES (1, 'x');"
      );
    });

    it('returns empty string if rows are empty', () => {
      const sql = exportAsSqlInserts(['id', 'name'], [], { tableName: 'empty_tab' });
      expect(sql).toBe('');
    });
  });

  describe('downloadExportFile', () => {
    beforeEach(() => {
      vi.clearAllMocks();
    });

    it('creates object URL, triggers anchor click to download file, and defers URL revocation', () => {
      vi.useFakeTimers();
      try {
        const createObjectURLMock = vi.fn().mockReturnValue('blob:test-url');
        const revokeObjectURLMock = vi.fn();
        window.URL.createObjectURL = createObjectURLMock;
        window.URL.revokeObjectURL = revokeObjectURLMock;

        const clickMock = vi.fn();
        const appendChildSpy = vi.spyOn(document.body, 'appendChild');
        const removeChildSpy = vi.spyOn(document.body, 'removeChild');

        const originalCreateElement = document.createElement.bind(document);
        vi.spyOn(document, 'createElement').mockImplementation((tagName: string) => {
          if (tagName === 'a') {
            const anchor = originalCreateElement('a');
            anchor.click = clickMock;
            return anchor;
          }
          return originalCreateElement(tagName);
        });

        downloadExportFile('id,name\n1,Alice', 'test.csv', 'text/csv');

        expect(createObjectURLMock).toHaveBeenCalledTimes(1);
        expect(clickMock).toHaveBeenCalledTimes(1);
        expect(appendChildSpy).toHaveBeenCalled();
        expect(removeChildSpy).toHaveBeenCalled();
        // Revocation is deferred to ensure browser initiates download
        expect(revokeObjectURLMock).not.toHaveBeenCalled();

        vi.advanceTimersByTime(1000);
        expect(revokeObjectURLMock).toHaveBeenCalledWith('blob:test-url');
      } finally {
        vi.useRealTimers();
      }
    });
  });
});
