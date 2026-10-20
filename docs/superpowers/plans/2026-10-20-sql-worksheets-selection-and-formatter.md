# Multi-Tab Worksheets, Run Selection & SQL Formatter Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement professional SQL client workflows in DynoDbModeler: Multi-tab query worksheets, selective query execution (Run Selection), and an intelligent SQL beautifier/formatter.

**Architecture:** Pure SQL formatter in `src/utils/sqlFormatter.ts`, modular worksheet tab bar in `src/components/query/QueryWorksheetBar.tsx`, and state/Monaco integration in `src/components/query/QueryEditorTab.tsx` supporting tab switching, inline rename, Run Selection, and dedicated table view tabs.

**Tech Stack:** React 19, TypeScript, Monaco Editor (`@monaco-editor/react`), Lucide React, Vitest, Testing Library.

## Global Constraints

- Mandatory English for all code, identifiers, comments, tests, and documentation.
- Mandatory 100% Doxygen / TSDoc coverage (`@brief`, `@param`, `@return`) for all exported and helper functions.
- Every task must strictly follow TDD (Red -> Green -> Refactor) and end with verified passing tests.
- Zero unresolved lint/type errors (`bun x tsc --noEmit`) and zero broken existing tests across the Vitest suite (266+ tests).
- All files must be <= 350 lines (Guru clean code smell standard) and <= 120 characters per line.

---

### Task 1: Pure SQL Formatter Engine (`src/utils/sqlFormatter.ts`)

**Files:**
- Create: `src/utils/sqlFormatter.ts`
- Create: `src/utils/sqlFormatter.test.ts`

**Interfaces:**
- Produces:
  - `formatSql(sql: string): string`
  - `MAJOR_CLAUSES: readonly string[]`

- [ ] **Step 1: Write the failing tests in `src/utils/sqlFormatter.test.ts`**

```typescript
import { describe, it, expect } from 'vitest';
import { formatSql } from './sqlFormatter';

describe('sqlFormatter', () => {
  it('formats simple SELECT statement with uppercase keywords and clause indentation', () => {
    const raw = 'select id, name, email from users where id > 10;';
    const expected = [
      'SELECT',
      '  id,',
      '  name,',
      '  email',
      'FROM',
      '  users',
      'WHERE',
      '  id > 10;',
    ].join('\n');
    expect(formatSql(raw)).toBe(expected);
  });

  it('formats JOIN and ORDER BY clauses properly', () => {
    const raw = 'select u.id, o.total from users u left join orders o on u.id = o.user_id order by o.total desc limit 10;';
    const formatted = formatSql(raw);
    expect(formatted).toContain('LEFT JOIN');
    expect(formatted).toContain('ORDER BY');
    expect(formatted).toContain('LIMIT');
    expect(formatted.startsWith('SELECT')).toBe(true);
  });

  it('preserves string literals with lowercase text and special characters', () => {
    const raw = "select id from users where status = 'active and pending' and name = 'john select from';";
    const formatted = formatSql(raw);
    expect(formatted).toContain("'active and pending'");
    expect(formatted).toContain("'john select from'");
  });

  it('preserves single-line and multi-line comments', () => {
    const raw = '-- fetch active users\nselect id from users; /* end of query */';
    const formatted = formatSql(raw);
    expect(formatted).toContain('-- fetch active users');
    expect(formatted).toContain('/* end of query */');
  });

  it('handles empty or blank input gracefully', () => {
    expect(formatSql('')).toBe('');
    expect(formatSql('   ')).toBe('');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun run test src/utils/sqlFormatter.test.ts`
Expected: FAIL ("Cannot find module './sqlFormatter'")

- [ ] **Step 3: Implement `src/utils/sqlFormatter.ts`**

Implement `formatSql(sql: string): string` with token scanning:
- Split input into tokens: comments, string literals, and words/symbols.
- Uppercase standard keywords when outside string literals and comments.
- Break lines and indent clause bodies.
- Ensure 100% Doxygen docstrings.

- [ ] **Step 4: Run test to verify it passes**

Run: `bun run test src/utils/sqlFormatter.test.ts`
Expected: PASS (all tests pass)

- [ ] **Step 5: Commit Task 1**

```bash
git add src/utils/sqlFormatter.ts src/utils/sqlFormatter.test.ts
git commit -m "feat(sql): implement SQL beautifier and formatting engine"
```

---

### Task 2: Query Worksheet Tab Bar Component (`src/components/query/QueryWorksheetBar.tsx`)

**Files:**
- Create: `src/components/query/QueryWorksheetBar.tsx`
- Create: `src/components/query/QueryWorksheetBar.test.tsx`

**Interfaces:**
- Produces:
  - `QueryWorksheet` interface
  - `QueryWorksheetBarProps` interface
  - `QueryWorksheetBar` React component

- [ ] **Step 1: Write the failing tests in `src/components/query/QueryWorksheetBar.test.tsx`**

```typescript
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import React from 'react';
import { QueryWorksheetBar, type QueryWorksheet } from './QueryWorksheetBar';

describe('QueryWorksheetBar component', () => {
  const mockWorksheets: QueryWorksheet[] = [
    {
      id: 'ws-1',
      title: 'Query 1',
      query: 'SELECT 1;',
      result: null,
      safeLimit: 500,
      safeLimitNotice: null,
      pageIndex: 0,
      pageSize: 50,
      totalRows: null,
      error: null,
      explainPlan: null,
    },
    {
      id: 'ws-2',
      title: 'users',
      query: 'SELECT * FROM users;',
      result: null,
      safeLimit: 500,
      safeLimitNotice: null,
      pageIndex: 0,
      pageSize: 50,
      totalRows: null,
      error: null,
      explainPlan: null,
    },
  ];

  it('renders worksheet tabs and highlights active tab', () => {
    render(
      <QueryWorksheetBar
        worksheets={mockWorksheets}
        activeId="ws-1"
        onSelect={vi.fn()}
        onAdd={vi.fn()}
        onClose={vi.fn()}
        onRename={vi.fn()}
      />
    );

    expect(screen.getByText('Query 1')).toBeDefined();
    expect(screen.getByText('users')).toBeDefined();
  });

  it('triggers onSelect when tab is clicked', () => {
    const handleSelect = vi.fn();
    render(
      <QueryWorksheetBar
        worksheets={mockWorksheets}
        activeId="ws-1"
        onSelect={handleSelect}
        onAdd={vi.fn()}
        onClose={vi.fn()}
        onRename={vi.fn()}
      />
    );

    fireEvent.click(screen.getByText('users'));
    expect(handleSelect).toHaveBeenCalledWith('ws-2');
  });

  it('triggers onAdd when + button is clicked', () => {
    const handleAdd = vi.fn();
    render(
      <QueryWorksheetBar
        worksheets={mockWorksheets}
        activeId="ws-1"
        onSelect={vi.fn()}
        onAdd={handleAdd}
        onClose={vi.fn()}
        onRename={vi.fn()}
      />
    );

    fireEvent.click(screen.getByTestId('add-worksheet-btn'));
    expect(handleAdd).toHaveBeenCalled();
  });

  it('triggers onClose when close button is clicked', () => {
    const handleClose = vi.fn();
    render(
      <QueryWorksheetBar
        worksheets={mockWorksheets}
        activeId="ws-1"
        onSelect={vi.fn()}
        onAdd={vi.fn()}
        onClose={handleClose}
        onRename={vi.fn()}
      />
    );

    const closeButtons = screen.getAllByTestId('close-worksheet-btn');
    fireEvent.click(closeButtons[0]);
    expect(handleClose).toHaveBeenCalledWith('ws-1');
  });

  it('allows inline renaming on double click', () => {
    const handleRename = vi.fn();
    render(
      <QueryWorksheetBar
        worksheets={mockWorksheets}
        activeId="ws-1"
        onSelect={vi.fn()}
        onAdd={vi.fn()}
        onClose={vi.fn()}
        onRename={handleRename}
      />
    );

    fireEvent.doubleClick(screen.getByText('Query 1'));
    const input = screen.getByDisplayValue('Query 1') as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'My Report' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    expect(handleRename).toHaveBeenCalledWith('ws-1', 'My Report');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun run test src/components/query/QueryWorksheetBar.test.tsx`
Expected: FAIL ("Cannot find module './QueryWorksheetBar'")

- [ ] **Step 3: Implement `src/components/query/QueryWorksheetBar.tsx`**

Implement component:
- Tab pills with active indicator.
- Close button `✕` on hover (hidden if only 1 tab).
- New tab `+` button.
- Inline rename input upon double click.
- Full Doxygen / TSDoc coverage.

- [ ] **Step 4: Run test to verify it passes**

Run: `bun run test src/components/query/QueryWorksheetBar.test.tsx`
Expected: PASS

- [ ] **Step 5: Commit Task 2**

```bash
git add src/components/query/QueryWorksheetBar.tsx src/components/query/QueryWorksheetBar.test.tsx
git commit -m "feat(query): implement QueryWorksheetBar component for multi-tab management"
```

---

### Task 3: Integration in `QueryEditorTab.tsx` (Worksheets, Run Selection & SQL Formatter)

**Files:**
- Modify: `src/components/query/QueryEditorTab.tsx`
- Modify: `src/components/query/QueryEditorTab.test.tsx`

**Interfaces:**
- Consumes:
  - `QueryWorksheet`, `QueryWorksheetBar` from `./QueryWorksheetBar`
  - `formatSql` from `../../utils/sqlFormatter`
- Produces:
  - Multi-tab worksheet state (`worksheets`, `activeWorksheetId`)
  - Run Selection execution when text is highlighted in Monaco
  - Format SQL toolbar button and Monaco DocumentFormattingEditProvider
  - Dedicated table worksheet creation when `initialQuery` / `viewTable` is received

- [ ] **Step 1: Write the failing tests in `src/components/query/QueryEditorTab.test.tsx`**

Add tests to verify:
1. `Run Selection`: when text is highlighted in Monaco editor, executes only the selected text.
2. `Format SQL`: clicking format button invokes `formatSql` and updates the active editor query.
3. `Multi-tab management`: switching tabs updates active query, results, and pagination.

- [ ] **Step 2: Update `src/components/query/QueryEditorTab.tsx`**

1. Integrate `QueryWorksheetBar`:
   - Initialize `worksheets` array with initial worksheet (id: `'ws-1'`, title: `'Query 1'`, query: `initialQuery`).
   - Store active worksheet ID in `activeWorksheetId`.
2. Integrate Selection Tracking:
   - `editor.onDidChangeCursorSelection(() => { ... })` updates `hasSelection`.
   - Update Run Query button text: `hasSelection ? 'Run Selection (Ctrl+Enter)' : 'Run Query (Ctrl+Enter)'`.
   - In `handleRun`: check `editor.getSelection()`; if non-empty, execute selected text.
3. Integrate Formatter:
   - Register `monaco.languages.registerDocumentFormattingEditProvider('sql', { provideDocumentFormattingEdits: ... })`.
   - Add Format SQL button (`Sparkles` icon) to toolbar calling `handleFormat()`.
4. Dedicated Tab on View Table:
   - When parent updates `initialQuery` (e.g. from Canvas/Sidebar view table rows), find or create a tab for that table.

- [ ] **Step 3: Run tests and regression suite**

Run: `bun run test`
Expected: All 26 test suites (270+ tests) PASS.

- [ ] **Step 4: Verify typecheck & production build**

Run: `bun run build`
Expected: Exit code 0.

- [ ] **Step 5: Commit Task 3**

```bash
git add src/components/query/QueryEditorTab.tsx src/components/query/QueryEditorTab.test.tsx
git commit -m "feat(query): integrate multi-tab worksheets, run selection and sql formatter"
```
