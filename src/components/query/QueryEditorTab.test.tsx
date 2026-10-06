/**
 * @file QueryEditorTab.test.tsx
 * @brief Unit tests for QueryEditorTab component and cell formatting.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryEditorTab, formatCellValue, extractTableNameFromSql } from './QueryEditorTab';
import { api } from '../../api/ipc';
import type { ConnectionConfig } from '../../types/database';

vi.mock('../../api/ipc', () => ({
  api: {
    executeQuery: vi.fn(),
    updateRows: vi.fn(),
  },
}));

// Mock Monaco Editor
vi.mock('@monaco-editor/react', () => ({
  default: ({
    value,
    onChange,
    onMount,
  }: {
    value?: string;
    onChange?: (val: string) => void;
    onMount?: (editor: any, monaco: any) => void;
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
        data-testid="monaco-sql-editor"
        value={value}
        onChange={(e) => onChange?.(e.target.value)}
      />
    );
  },
}));

describe('QueryEditorTab component', () => {
  beforeEach(() => {
    vi.clearAllMocks();
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

    const input = screen.getByDisplayValue('john_doe');
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

