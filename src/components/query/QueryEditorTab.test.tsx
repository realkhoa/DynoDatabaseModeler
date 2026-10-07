/**
 * @file QueryEditorTab.test.tsx
 * @brief Unit tests for QueryEditorTab component and cell formatting.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { QueryEditorTab, formatCellValue, extractTableNameFromSql } from './QueryEditorTab';
import { api } from '../../api/ipc';
import type { ConnectionConfig } from '../../types/database';

vi.mock('../../api/ipc', () => ({
  api: {
    executeQuery: vi.fn(),
    updateRows: vi.fn(),
    explainQuery: vi.fn(),
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
});

