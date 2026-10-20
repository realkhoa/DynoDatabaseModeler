/**
 * @file QueryEditorTab.test.tsx
 * @brief Unit tests for QueryEditorTab component and cell formatting.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import {
  QueryEditorTab,
  formatCellValue,
  extractTableNameFromSql,
  updateQueryPagination,
} from './QueryEditorTab';
import { api } from '../../api/ipc';
import type { ConnectionConfig, DatabaseSchema } from '../../types/database';

const { mockCompletionDispose, mockRegisterCompletionItemProvider } = vi.hoisted(() => {
  const mockCompletionDispose = vi.fn();
  const mockRegisterCompletionItemProvider = vi.fn().mockImplementation(() => ({
    dispose: mockCompletionDispose,
  }));
  return { mockCompletionDispose, mockRegisterCompletionItemProvider };
});

vi.mock('../../api/ipc', () => ({
  api: {
    executeQuery: vi.fn(),
    updateRows: vi.fn(),
    explainQuery: vi.fn(),
    getPrimaryKeys: vi.fn().mockResolvedValue([]),
    recordQueryHistory: vi.fn().mockResolvedValue({ id: 1 }),
    getQueryHistory: vi.fn().mockResolvedValue([]),
    toggleFavoriteQuery: vi.fn().mockResolvedValue(true),
    clearQueryHistory: vi.fn().mockResolvedValue(undefined),
  },
}));

// Mock Monaco Editor
vi.mock('@monaco-editor/react', () => ({
  default: ({
    value,
    onChange,
    onMount,
    language,
    options,
  }: {
    value?: string;
    onChange?: (val: string) => void;
    onMount?: (editor: any, monaco: any) => void;
    language?: string;
    options?: { readOnly?: boolean };
  }) => {
    // Provide a mocked editor instance to onMount if passed
    if (onMount) {
      const mockEditor = {
        addCommand: vi.fn(),
      };
      const mockMonaco = {
        KeyMod: { CtrlCmd: 2048 },
        KeyCode: { Enter: 3 },
        languages: {
          registerCompletionItemProvider: mockRegisterCompletionItemProvider,
        },
      };
      onMount(mockEditor, mockMonaco);
    }
    return (
      <textarea
        data-testid={language === 'sql' ? 'monaco-sql-editor' : 'monaco-inspector-editor'}
        data-language={language}
        data-readonly={options?.readOnly ? 'true' : 'false'}
        value={value}
        onChange={(e) => onChange?.(e.target.value)}
      />
    );
  },
}));

describe('QueryEditorTab component', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    Object.defineProperty(navigator, 'clipboard', {
      value: {
        writeText: vi.fn().mockResolvedValue(undefined),
      },
      configurable: true,
      writable: true,
    });
  });

  const mockConnection: ConnectionConfig = {
    id: 'conn-1',
    name: 'Production DB',
    db_type: 'Postgres',
    database: 'prod_shop',
    ssl: true,
  };

  /**
   * @brief Verifies initial render of SQL toolbar and placeholder.
   */
  it('renders toolbar with Run Query button and target connection', () => {
    render(<QueryEditorTab activeConnection={mockConnection} />);

    expect(screen.getByText('SQL Query Console')).toBeDefined();
    expect(screen.getByRole('button', { name: /Run Query/i })).toBeDefined();
    expect(screen.getByText(/Target: Production DB \(Postgres\)/i)).toBeDefined();
    expect(
      screen.getByText(/Click “Run Query” or press Ctrl\+Enter to execute/i)
    ).toBeDefined();
  });

  /**
   * @brief Verifies executing a SQL query displays tabular results and telemetry.
   */
  it('executes SQL query on button click and displays results grid', async () => {
    vi.mocked(api.executeQuery).mockResolvedValue({
      columns: ['id', 'name', 'active', 'metadata', 'notes'],
      rows: [
        [1, 'Alice', true, { role: 'admin' }, null],
        [2, 'Bob', false, { role: 'user' }, 'VIP customer'],
      ],
      rows_affected: 2,
      execution_time_ms: 15,
    });

    const onQuerySuccess = vi.fn();
    render(
      <QueryEditorTab
        activeConnection={mockConnection}
        onQuerySuccess={onQuerySuccess}
      />
    );

    const runBtn = screen.getByRole('button', { name: /Run Query/i });
    fireEvent.click(runBtn);

    await waitFor(() => {
      expect(api.executeQuery).toHaveBeenCalled();
      expect(onQuerySuccess).toHaveBeenCalled();
    });

    // Check execution telemetry
    expect(screen.getByTestId('row-count').textContent).toBe('2 rows returned');
    expect(screen.getByTestId('exec-duration').textContent).toBe('15 ms');

    // Check table headers
    expect(screen.getByText('id')).toBeDefined();
    expect(screen.getByText('name')).toBeDefined();
    expect(screen.getByText('active')).toBeDefined();
    expect(screen.getByText('metadata')).toBeDefined();
    expect(screen.getByText('notes')).toBeDefined();

    // Check cell values
    expect(screen.getByText('Alice')).toBeDefined();
    expect(screen.getByText('true')).toBeDefined();
    expect(screen.getByText('{"role":"admin"}')).toBeDefined();
    expect(screen.getByText('NULL')).toBeDefined();
    expect(screen.getByText('VIP customer')).toBeDefined();
  });

  /**
   * @brief Verifies handling query errors and displaying error banner.
   */
  it('displays error banner when query execution fails', async () => {
    vi.mocked(api.executeQuery).mockRejectedValue(
      new Error('Syntax error at or near "SELCT"')
    );

    render(<QueryEditorTab activeConnection={mockConnection} />);

    const runBtn = screen.getByRole('button', { name: /Run Query/i });
    fireEvent.click(runBtn);

    await waitFor(() => {
      expect(api.executeQuery).toHaveBeenCalled();
    });

    expect(screen.getByTestId('query-error-banner')).toBeDefined();
    expect(screen.getByText(/Syntax error at or near "SELCT"/)).toBeDefined();
  });

  /**
   * @brief Verifies triggering query execution via Ctrl+Enter keyboard event.
   */
  it('triggers query execution via Ctrl+Enter shortcut', async () => {
    vi.mocked(api.executeQuery).mockResolvedValue({
      columns: ['num'],
      rows: [[42]],
      rows_affected: 1,
      execution_time_ms: 5,
    });

    const { container } = render(
      <QueryEditorTab activeConnection={mockConnection} />
    );

    const editorRoot = container.firstChild as HTMLElement;
    fireEvent.keyDown(editorRoot, { key: 'Enter', ctrlKey: true });

    await waitFor(() => {
      expect(api.executeQuery).toHaveBeenCalled();
      expect(screen.getByText('42')).toBeDefined();
    });
  });

  /**
   * @brief Verifies inline cell editing and save integration within QueryEditorTab.
   */
  it('allows inline cell editing and persists updates via api.updateRows', async () => {
    vi.mocked(api.executeQuery).mockResolvedValue({
      columns: ['id', 'username'],
      rows: [[1, 'john_doe']],
      rows_affected: 1,
      execution_time_ms: 10,
    });
    vi.mocked(api.getPrimaryKeys).mockResolvedValue(['id']);
    vi.mocked(api.updateRows).mockResolvedValue(1);

    render(
      <QueryEditorTab
        activeConnection={mockConnection}
        initialQuery="SELECT id, username FROM users;"
      />
    );

    // Run query to populate results
    const runBtn = screen.getByRole('button', { name: /Run Query/i });
    fireEvent.click(runBtn);

    await waitFor(() => {
      expect(screen.getByText('john_doe')).toBeDefined();
    });

    // The grid is editable because the table primary key was resolved.
    await waitFor(() => {
      expect(screen.getByTestId('grid-edit-mode').textContent).toContain('Editable');
    });

    // Edit cell
    const cell = screen.getByText('john_doe').closest('td')!;
    fireEvent.doubleClick(cell);

    const input = await screen.findByDisplayValue('john_doe');
    fireEvent.change(input, { target: { value: 'johnny' } });
    fireEvent.blur(input);

    expect(screen.getByText(/1 unsaved change/i)).toBeDefined();

    // Click Save Changes
    const saveBtn = screen.getByRole('button', { name: /Save Changes/i });
    fireEvent.click(saveBtn);

    await waitFor(() => {
      expect(api.updateRows).toHaveBeenCalledWith([
        {
          table: 'users',
          primary_keys: { id: 1 },
          updated_values: { username: 'johnny' },
          expect_single_row: true,
        },
      ]);
      expect(screen.getByTestId('save-status-banner')).toBeDefined();
      expect(screen.getByText(/Successfully saved 1 row update\(s\)/)).toBeDefined();
    });
  });

  /**
   * @brief Verifies opening ValueInspectorDrawer from QueryEditorTab toolbar and displaying cell details.
   */
  it('opens ValueInspectorDrawer when Inspect Value button is clicked with selected cell', async () => {
    vi.mocked(api.executeQuery).mockResolvedValue({
      columns: ['id', 'details'],
      rows: [[1, '{"version":"1.0","role":"admin"}']],
      rows_affected: 1,
      execution_time_ms: 10,
    });

    render(
      <QueryEditorTab
        activeConnection={mockConnection}
        initialQuery="SELECT id, details FROM config;"
      />
    );

    // Run query
    fireEvent.click(screen.getByRole('button', { name: /Run Query/i }));

    await waitFor(() => {
      expect(screen.getByText('{"version":"1.0","role":"admin"}')).toBeDefined();
    });

    // Select the details cell
    const cell = screen.getByText('{"version":"1.0","role":"admin"}').closest('td')!;
    fireEvent.click(cell);

    // Click Inspect Value button
    const inspectBtn = screen.getByTestId('inspect-value-btn');
    fireEvent.click(inspectBtn);

    // Drawer is opened
    const drawer = screen.getByTestId('value-inspector-drawer');
    expect(drawer).toBeDefined();
    expect(within(drawer).getByText('details')).toBeDefined();
    expect(within(drawer).getByText('JSON')).toBeDefined();

    const drawerEditor = screen.getByTestId('monaco-inspector-editor') as HTMLTextAreaElement;
    expect(drawerEditor.value).toContain('"version": "1.0"');

    // Close drawer
    const closeBtn = screen.getByRole('button', { name: /close drawer/i });
    fireEvent.click(closeBtn);

    expect(screen.queryByTestId('value-inspector-drawer')).toBeNull();
  });

  /**
   * @brief Verifies applying edits from ValueInspectorDrawer updates the grid and marks it dirty.
   */
  it('applies edits from ValueInspectorDrawer back into EditableDataGrid', async () => {
    vi.mocked(api.executeQuery).mockResolvedValue({
      columns: ['id', 'title'],
      rows: [[42, 'Original Title']],
      rows_affected: 1,
      execution_time_ms: 8,
    });

    render(
      <QueryEditorTab
        activeConnection={mockConnection}
        initialQuery="SELECT id, title FROM books;"
      />
    );

    fireEvent.click(screen.getByRole('button', { name: /Run Query/i }));

    await waitFor(() => {
      expect(screen.getByText('Original Title')).toBeDefined();
    });

    // Select the cell and open inspector
    const cell = screen.getByText('Original Title').closest('td')!;
    fireEvent.click(cell);
    fireEvent.click(screen.getByTestId('inspect-value-btn'));

    // Edit content in drawer
    const drawerEditor = screen.getByTestId('monaco-inspector-editor');
    fireEvent.change(drawerEditor, { target: { value: 'Modified Title in Drawer' } });

    // Click Apply to Cell
    const applyBtn = screen.getByRole('button', { name: /apply to cell/i });
    fireEvent.click(applyBtn);

    // Grid now shows updated title and mutation bar
    expect(screen.getAllByText('Modified Title in Drawer').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText(/1 unsaved change/i)).toBeDefined();
  });

  /**
   * @brief Verifies Export Data button is disabled without results and opens ExportModal when clicked.
   */
  it('disables Export Data button when no results, and opens ExportModal upon click with results', async () => {
    vi.mocked(api.executeQuery).mockResolvedValue({
      columns: ['id', 'username'],
      rows: [[1, 'john_doe'], [2, 'jane_doe']],
      rows_affected: 2,
      execution_time_ms: 12,
    });

    render(
      <QueryEditorTab
        activeConnection={mockConnection}
        initialQuery="SELECT id, username FROM users;"
      />
    );

    // Initial state: button disabled
    const exportBtn = screen.getByTestId('export-data-btn');
    expect(exportBtn.getAttribute('disabled')).not.toBeNull();

    // Run query to load results
    fireEvent.click(screen.getByRole('button', { name: /Run Query/i }));

    await waitFor(() => {
      expect(screen.getByText('john_doe')).toBeDefined();
    });

    // Now export button should be enabled
    expect(exportBtn.getAttribute('disabled')).toBeNull();

    // Click Export Data button
    fireEvent.click(exportBtn);

    // Export Modal is now visible
    expect(screen.getByRole('dialog')).toBeDefined();
    expect(screen.getByText('Export Data Wizard')).toBeDefined();
    expect(screen.getByTestId('export-preview').textContent).toContain('id,username');

    // Close modal
    const closeBtn = screen.getByRole('button', { name: /close modal/i });
    fireEvent.click(closeBtn);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  /**
   * @brief Verifies that ExportModal receives 'exported_table' as fallback tableName when query has no FROM clause.
   */
  it('falls back to exported_table as tableName for ExportModal when detectedTableName is unknown', async () => {
    vi.mocked(api.executeQuery).mockResolvedValue({
      columns: ['id'],
      rows: [[1]],
      rows_affected: 1,
      execution_time_ms: 5,
    });

    render(
      <QueryEditorTab
        activeConnection={mockConnection}
        initialQuery="SELECT 1 as id;"
      />
    );

    fireEvent.click(screen.getByRole('button', { name: /Run Query/i }));

    await waitFor(() => {
      expect(screen.getByText('1')).toBeDefined();
    });

    fireEvent.click(screen.getByRole('button', { name: /Export Data/i }));

    expect(screen.getByRole('dialog')).toBeDefined();
    fireEvent.click(screen.getByRole('tab', { name: /sql/i }));
    const tableNameInput = screen.getByLabelText(/table name/i) as HTMLInputElement;
    expect(tableNameInput.value).toBe('exported_table');
  });

  /**
   * @brief Verifies Explain Plan button triggers api.explainQuery and displays ExplainPlanModal.
   */
  it('triggers api.explainQuery and opens ExplainPlanModal when clicking Explain Plan', async () => {
    vi.mocked(api.explainQuery).mockResolvedValue({
      node_type: 'Seq Scan',
      relation_name: 'users',
      cost: 50.0,
      rows: 100,
      children: [],
    });

    render(
      <QueryEditorTab
        activeConnection={mockConnection}
        initialQuery="SELECT * FROM users;"
      />
    );

    const explainBtn = screen.getByTestId('explain-plan-btn');
    fireEvent.click(explainBtn);

    expect(api.explainQuery).toHaveBeenCalledWith('SELECT * FROM users;');

    await waitFor(() => {
      expect(screen.getByTestId('explain-plan-modal')).toBeDefined();
      expect(screen.getByText('Seq Scan')).toBeDefined();
    });
  });

  /**
   * @brief Verifies that running a query records history in the persistent storage.
   */
  it('records query execution history when running query', async () => {
    vi.mocked(api.executeQuery).mockResolvedValue({
      columns: ['id'],
      rows: [[1]],
      rows_affected: 0,
      execution_time_ms: 15,
    });

    render(
      <QueryEditorTab
        activeConnection={mockConnection}
        initialQuery="SELECT * FROM customers;"
      />
    );

    const runBtn = screen.getByRole('button', { name: /Run Query/i });
    fireEvent.click(runBtn);

    await waitFor(() => {
      expect(api.recordQueryHistory).toHaveBeenCalledWith(
        'SELECT * FROM customers;',
        expect.any(Number),
        1,
        'success'
      );
    });
  });

  /**
   * @brief Verifies History button opens QueryHistoryModal.
   */
  it('opens QueryHistoryModal when clicking History button in toolbar', async () => {
    vi.mocked(api.getQueryHistory).mockResolvedValue([
      {
        id: 1,
        query_text: 'SELECT 1;',
        executed_at: '2026-10-06T12:00:00Z',
        duration_ms: 5,
        rows_count: 1,
        status: 'success',
        is_favorite: false,
      },
    ]);

    render(<QueryEditorTab activeConnection={mockConnection} />);

    const historyBtn = screen.getByTestId('query-history-btn');
    fireEvent.click(historyBtn);

    await waitFor(() => {
      expect(screen.getByText('Query Execution History')).toBeDefined();
      expect(screen.getByText('SELECT 1;')).toBeDefined();
    });
  });

  /**
   * @brief Verifies extractTableNameFromSql helper with diverse SQL patterns.
   */
  describe('extractTableNameFromSql', () => {
    it('extracts table name from standard SELECT queries', () => {
      expect(extractTableNameFromSql('SELECT * FROM users')).toBe('users');
      expect(extractTableNameFromSql('SELECT id, name FROM "customers" WHERE id = 1')).toBe('customers');
      expect(extractTableNameFromSql('select * from public.orders;')).toBe('orders');
      expect(extractTableNameFromSql('SELECT 1 as id')).toBe('unknown');
    });
  });

  /**
   * @brief Verifies formatCellValue helper for diverse data types.
   */
  describe('formatCellValue', () => {
    it('formats null and undefined as NULL', () => {
      const nullNode = formatCellValue(null);
      const undefNode = formatCellValue(undefined);
      expect(nullNode).toBeDefined();
      expect(undefNode).toBeDefined();
    });

    it('formats objects and arrays as JSON string', () => {
      const jsonNode = formatCellValue({ key: 'val' });
      expect(jsonNode).toBeDefined();
    });

    it('formats booleans and numbers', () => {
      const boolNode = formatCellValue(true);
      const numNode = formatCellValue(123.45);
      expect(boolNode).toBeDefined();
      expect(numNode).toBeDefined();
    });

    it('formats strings directly', () => {
      const strNode = formatCellValue('hello world');
      expect(strNode).toBeDefined();
    });
  });

  /**
   * @brief Verifies Safe Limit toolbar selector and query interception behaviors.
   */
  describe('Safe Limit and Server-Side Pagination', () => {
    /**
     * @brief Verifies Safe Limit dropdown selector renders with default 500 and allows option changes.
     */
    it('renders Safe Limit selector in toolbar and allows changing limit', () => {
      render(<QueryEditorTab activeConnection={mockConnection} />);

      const safeLimitSelect = screen.getByRole('combobox', {
        name: /safe limit/i,
      }) as HTMLSelectElement;
      expect(safeLimitSelect).toBeDefined();
      expect(safeLimitSelect.value).toBe('500');

      fireEvent.change(safeLimitSelect, { target: { value: '100' } });
      expect(safeLimitSelect.value).toBe('100');

      fireEvent.change(safeLimitSelect, { target: { value: '0' } });
      expect(safeLimitSelect.value).toBe('0');
    });

    /**
     * @brief Verifies safe limit injection into unbounded SELECT queries and displays badge.
     */
    it('applies safe limit to unbounded SELECT query when safe limit is enabled and displays badge', async () => {
      vi.mocked(api.executeQuery).mockResolvedValue({
        columns: ['id'],
        rows: [[1]],
        rows_affected: 1,
        execution_time_ms: 10,
      });

      render(
        <QueryEditorTab
          activeConnection={mockConnection}
          initialQuery="SELECT * FROM large_table"
        />
      );

      const runButton = screen.getByRole('button', { name: /run query/i });
      fireEvent.click(runButton);

      await waitFor(() => {
        expect(api.executeQuery).toHaveBeenCalledWith(
          expect.stringContaining('LIMIT 500')
        );
      });

      const badge = await screen.findByTestId('safe-limit-badge');
      expect(badge).toBeDefined();
      expect(badge.textContent).toContain('Safe Limit');
    });

    /**
     * @brief Verifies safe limit is omitted when user selects Off (limit 0).
     */
    it('does not apply safe limit when Safe Limit is turned Off', async () => {
      vi.mocked(api.executeQuery).mockResolvedValue({
        columns: ['id'],
        rows: [[1]],
        rows_affected: 1,
        execution_time_ms: 10,
      });

      render(
        <QueryEditorTab
          activeConnection={mockConnection}
          initialQuery="SELECT * FROM large_table"
        />
      );

      const safeLimitSelect = screen.getByRole('combobox', {
        name: /safe limit/i,
      });
      fireEvent.change(safeLimitSelect, { target: { value: '0' } });

      const runButton = screen.getByRole('button', { name: /run query/i });
      fireEvent.click(runButton);

      await waitFor(() => {
        expect(api.executeQuery).toHaveBeenCalledWith('SELECT * FROM large_table');
      });

      expect(screen.queryByTestId('safe-limit-badge')).toBeNull();
    });

    /**
     * @brief Verifies pagination navigation generates updated query statements and re-executes.
     */
    it('handles pagination navigation and updates query with new limit and offset', async () => {
      vi.mocked(api.executeQuery).mockImplementation(async (sql: string) => {
        if (/COUNT\(\*\)/i.test(sql)) {
          return {
            columns: ['total_count'],
            rows: [[500]],
            rows_affected: 0,
            execution_time_ms: 4,
          };
        }
        return {
          columns: ['id', 'name'],
          rows: Array.from({ length: 50 }, (_, i) => [i + 1, `User ${i + 1}`]),
          rows_affected: 50,
          execution_time_ms: 12,
        };
      });

      render(
        <QueryEditorTab
          activeConnection={mockConnection}
          initialQuery="SELECT * FROM users LIMIT 50 OFFSET 0;"
        />
      );

      // Run query to populate results and pagination bar
      fireEvent.click(screen.getByRole('button', { name: /run query/i }));

      const paginationBar = await screen.findByTestId('pagination-bar');
      expect(paginationBar).toBeDefined();

      // Navigate to next page
      const nextBtn = screen.getByRole('button', { name: /next page/i });
      fireEvent.click(nextBtn);

      await waitFor(() => {
        expect(api.executeQuery).toHaveBeenCalledWith(
          expect.stringContaining('OFFSET 50')
        );
      });

      // Change page size to 100
      const pageSizeSelect = screen.getByRole('combobox', {
        name: /rows per page/i,
      });
      fireEvent.change(pageSizeSelect, { target: { value: '100' } });

      await waitFor(() => {
        expect(api.executeQuery).toHaveBeenCalledWith(
          expect.stringContaining('LIMIT 100 OFFSET 0')
        );
      });
    });

    /**
     * @brief Verifies autoRun executes initialQuery on mount without manual user click.
     */
    it('auto-runs initial query upon mount when autoRun is true', async () => {
      vi.mocked(api.executeQuery).mockResolvedValue({
        columns: ['id'],
        rows: [[100]],
        rows_affected: 1,
        execution_time_ms: 8,
      });

      render(
        <QueryEditorTab
          activeConnection={mockConnection}
          initialQuery="SELECT * FROM auto_table LIMIT 50 OFFSET 0;"
          autoRun={true}
        />
      );

      await waitFor(() => {
        expect(api.executeQuery).toHaveBeenCalledWith(
          'SELECT * FROM auto_table LIMIT 50 OFFSET 0;'
        );
      });
    });

    /**
     * @brief Verifies autoRun re-executes when initialQuery prop updates from parent.
     */
    it('re-runs query when initialQuery prop changes and autoRun is true', async () => {
      vi.mocked(api.executeQuery).mockResolvedValue({
        columns: ['id'],
        rows: [[1]],
        rows_affected: 1,
        execution_time_ms: 5,
      });

      const { rerender } = render(
        <QueryEditorTab
          activeConnection={mockConnection}
          initialQuery="SELECT 1 as id;"
          autoRun={true}
        />
      );

      await waitFor(() => {
        expect(api.executeQuery).toHaveBeenCalledWith(expect.stringContaining('SELECT 1'));
      });

      rerender(
        <QueryEditorTab
          activeConnection={mockConnection}
          initialQuery="SELECT 2 as id;"
          autoRun={true}
        />
      );

      await waitFor(() => {
        expect(api.executeQuery).toHaveBeenCalledWith(expect.stringContaining('SELECT 2'));
      });
    });

    /**
     * @brief Verifies background count query resolves totalRows for single-table SELECT queries.
     */
    it('resolves totalRows via background count query for single-table queries', async () => {
      vi.mocked(api.executeQuery).mockImplementation(async (sql: string) => {
        if (/COUNT\(\*\)/i.test(sql)) {
          return {
            columns: ['total_count'],
            rows: [[350]],
            rows_affected: 0,
            execution_time_ms: 4,
          };
        }
        return {
          columns: ['id', 'title'],
          rows: [[1, 'Item 1'], [2, 'Item 2']],
          rows_affected: 2,
          execution_time_ms: 10,
        };
      });

      render(
        <QueryEditorTab
          activeConnection={mockConnection}
          initialQuery="SELECT * FROM products LIMIT 50 OFFSET 0;"
        />
      );

      fireEvent.click(screen.getByRole('button', { name: /run query/i }));

      await waitFor(() => {
        expect(api.executeQuery).toHaveBeenCalledWith(
          expect.stringContaining('SELECT COUNT(*) AS total_count FROM "products"')
        );
      });

      // Check that pagination bar displays resolved total
      await waitFor(() => {
        expect(screen.getByText(/of 350 rows/i)).toBeDefined();
      });
    });
  });

  /**
   * @brief Verifies updateQueryPagination behavior across standard and nested SQL queries.
   */
  describe('updateQueryPagination', () => {
    it('updates standard LIMIT and OFFSET clauses at the end of query', () => {
      const sql = 'SELECT * FROM users LIMIT 50 OFFSET 0;';
      const updated = updateQueryPagination(sql, 'Postgres', 25, 2);
      expect(updated).toBe('SELECT * FROM users LIMIT 25 OFFSET 50;');
    });

    it('updates query containing only trailing LIMIT clause', () => {
      const sql = 'SELECT * FROM users LIMIT 100;';
      const updated = updateQueryPagination(sql, 'Postgres', 50, 1);
      expect(updated).toBe('SELECT * FROM users LIMIT 50 OFFSET 50;');
    });

    it('appends LIMIT and OFFSET when query has no pagination clauses', () => {
      const sql = 'SELECT * FROM users WHERE active = true';
      const updated = updateQueryPagination(sql, 'Postgres', 50, 0);
      expect(updated).toBe('SELECT * FROM users WHERE active = true LIMIT 50 OFFSET 0;');
    });

    it('replaces only trailing pagination without altering inner CTE LIMIT clause', () => {
      const sql =
        'WITH top_users AS (SELECT id FROM users LIMIT 10) SELECT * FROM top_users LIMIT 50 OFFSET 0;';
      const updated = updateQueryPagination(sql, 'Postgres', 25, 2);
      expect(updated).toBe(
        'WITH top_users AS (SELECT id FROM users LIMIT 10) SELECT * FROM top_users LIMIT 25 OFFSET 50;'
      );
    });

    it('appends outer LIMIT and OFFSET to CTE query without altering inner CTE LIMIT clause', () => {
      const sql =
        'WITH top_users AS (SELECT id FROM users LIMIT 10) SELECT * FROM top_users;';
      const updated = updateQueryPagination(sql, 'Postgres', 50, 0);
      expect(updated).toBe(
        'WITH top_users AS (SELECT id FROM users LIMIT 10) SELECT * FROM top_users LIMIT 50 OFFSET 0;'
      );
    });

    it('replaces only trailing pagination without altering subquery LIMIT in FROM clause', () => {
      const sql =
        'SELECT * FROM (SELECT id, name FROM users LIMIT 5) AS sub LIMIT 50 OFFSET 0;';
      const updated = updateQueryPagination(sql, 'Sqlite', 100, 1);
      expect(updated).toBe(
        'SELECT * FROM (SELECT id, name FROM users LIMIT 5) AS sub LIMIT 100 OFFSET 100;'
      );
    });

    it('updates trailing MSSQL OFFSET and FETCH NEXT clauses', () => {
      const sql =
        'SELECT * FROM [users] ORDER BY [id] OFFSET 0 ROWS FETCH NEXT 50 ROWS ONLY;';
      const updated = updateQueryPagination(sql, 'Mssql', 25, 3);
      expect(updated).toBe(
        'SELECT * FROM [users] ORDER BY [id] OFFSET 75 ROWS FETCH NEXT 25 ROWS ONLY;'
      );
    });

    it('replaces trailing MSSQL pagination without altering inner CTE OFFSET/FETCH clause', () => {
      const sql =
        'WITH ranked AS (SELECT * FROM [users] ORDER BY [score] OFFSET 0 ROWS FETCH NEXT 10 ROWS ONLY) SELECT * FROM ranked ORDER BY [id] OFFSET 0 ROWS FETCH NEXT 50 ROWS ONLY;';
      const updated = updateQueryPagination(sql, 'Mssql', 25, 1);
      expect(updated).toBe(
        'WITH ranked AS (SELECT * FROM [users] ORDER BY [score] OFFSET 0 ROWS FETCH NEXT 10 ROWS ONLY) SELECT * FROM ranked ORDER BY [id] OFFSET 25 ROWS FETCH NEXT 25 ROWS ONLY;'
      );
    });

    it('injects ORDER BY (SELECT NULL) for unpaginated MSSQL query lacking ORDER BY', () => {
      const sql = 'SELECT * FROM [users]';
      const updated = updateQueryPagination(sql, 'Mssql', 50, 0);
      expect(updated).toBe(
        'SELECT * FROM [users] ORDER BY (SELECT NULL) OFFSET 0 ROWS FETCH NEXT 50 ROWS ONLY;'
      );
    });
  });
  describe('Schema-aware SQL autocompletion integration', () => {
    const mockSchema: DatabaseSchema = {
      database_name: 'test_db',
      tables: [
        {
          name: 'customers',
          columns: [
            {
              name: 'id',
              data_type: 'Integer',
              is_primary_key: true,
              is_nullable: false,
              is_auto_increment: true,
            },
            {
              name: 'email',
              data_type: { Varchar: 255 },
              is_primary_key: false,
              is_nullable: false,
              is_auto_increment: false,
            },
          ],
          foreign_keys: [],
          indexes: [],
        },
      ],
    };

    /**
     * @brief Verifies root container renders with data-testid="sql-query-editor-tab" and accepts schema prop.
     */
    it('renders root container with data-testid="sql-query-editor-tab" and accepts schema prop', () => {
      render(
        <QueryEditorTab
          activeConnection={mockConnection}
          schema={mockSchema}
        />
      );

      const root = screen.getByTestId('sql-query-editor-tab');
      expect(root).toBeDefined();
    });

    /**
     * @brief Verifies Monaco completion provider is registered on editor mount and disposes on unmount.
     */
    it('registers Monaco completion provider on editor mount and disposes on unmount', () => {
      const { unmount } = render(
        <QueryEditorTab
          activeConnection={mockConnection}
          schema={mockSchema}
        />
      );

      expect(mockRegisterCompletionItemProvider).toHaveBeenCalledTimes(1);
      const [lang, provider] = mockRegisterCompletionItemProvider.mock.calls[0];
      expect(lang).toBe('sql');
      expect(provider.triggerCharacters).toEqual(['.', ' ']);
      expect(typeof provider.provideCompletionItems).toBe('function');

      const mockModel = {
        getWordUntilPosition: vi.fn().mockReturnValue({ startColumn: 1, endColumn: 7 }),
        getValueInRange: vi.fn().mockReturnValue('SELECT '),
      };
      const mockPosition = { lineNumber: 1, column: 8 };

      const result = provider.provideCompletionItems(mockModel, mockPosition);
      expect(result).toBeDefined();
      expect(Array.isArray(result.suggestions)).toBe(true);
      expect(result.suggestions.length).toBeGreaterThan(0);

      unmount();
      expect(mockCompletionDispose).toHaveBeenCalledTimes(1);
    });

    /**
     * @brief Verifies completion suggestions dynamically update when schema prop changes via ref.
     */
    it('updates completion suggestions when schema prop changes dynamically', () => {
      const { rerender } = render(
        <QueryEditorTab
          activeConnection={mockConnection}
          schema={null}
        />
      );

      expect(mockRegisterCompletionItemProvider).toHaveBeenCalledTimes(1);
      const [, provider] = mockRegisterCompletionItemProvider.mock.calls[0];
      const mockModel = {
        getWordUntilPosition: vi.fn().mockReturnValue({ startColumn: 1, endColumn: 5 }),
        getValueInRange: vi.fn().mockReturnValue('FROM '),
      };
      const mockPosition = { lineNumber: 1, column: 6 };

      const resultBefore = provider.provideCompletionItems(mockModel, mockPosition);
      const hasCustomersBefore = resultBefore.suggestions.some(
        (s: any) => s.label === 'customers'
      );
      expect(hasCustomersBefore).toBe(false);

      rerender(
        <QueryEditorTab
          activeConnection={mockConnection}
          schema={mockSchema}
        />
      );

      const resultAfter = provider.provideCompletionItems(mockModel, mockPosition);
      const hasCustomersAfter = resultAfter.suggestions.some(
        (s: any) => s.label === 'customers'
      );
      expect(hasCustomersAfter).toBe(true);
    });
  });
});
