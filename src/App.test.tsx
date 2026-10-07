/**
 * @file App.test.tsx
 * @brief Unit and integration tests for DynoDbModeler App root component.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import App from './App';
import { api } from './api/ipc';
import type { DatabaseSchema } from './types/database';

// Mock ipc client methods
vi.mock('./api/ipc', () => ({
  api: {
    connect: vi.fn(),
    disconnect: vi.fn(),
    introspectSchema: vi.fn(),
    testConnection: vi.fn(),
    executeQuery: vi.fn(),
    computeDiff: vi.fn(),
    generateDdl: vi.fn(),
    executeMigration: vi.fn(),
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
  }: {
    value?: string;
    onChange?: (val: string) => void;
  }) => (
    <textarea
      data-testid="monaco-editor"
      value={value}
      onChange={(e) => onChange?.(e.target.value)}
    />
  ),
}));

describe('App root component', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
  });

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
            name: 'name',
            data_type: { Varchar: 100 },
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
   * @brief Verifies that App root renders header, sidebar, and initial empty canvas state.
   */
  it('renders application shell layout with initial disconnected state', () => {
    render(<App />);

    expect(screen.getByText('DynoDbModeler')).toBeDefined();
    expect(screen.getByText('ERD Canvas')).toBeDefined();
    expect(screen.getByText('SQL Query')).toBeDefined();
    expect(screen.getByText('Settings')).toBeDefined();
    expect(screen.getByText('No Database Connected')).toBeDefined();
  });

  /**
   * @brief Verifies opening and closing the ConnectionModal.
   */
  it('opens and closes connection modal dialog', () => {
    render(<App />);

    // Click "Connect Database" button in the center
    const connectButton = screen.getByRole('button', { name: /Connect Database/i });
    fireEvent.click(connectButton);

    expect(screen.getByText('New Database Connection')).toBeDefined();

    // Click Cancel
    const cancelBtn = screen.getByRole('button', { name: 'Cancel' });
    fireEvent.click(cancelBtn);

    expect(screen.queryByText('New Database Connection')).toBeNull();
  });

  /**
   * @brief Helper to navigate to Settings and trigger connecting to sample SQLite database.
   */
  const connectToSampleSqlite = () => {
    fireEvent.click(screen.getByText('Settings'));
    fireEvent.click(
      screen.getByRole('button', { name: /Connect to Sample In-Memory SQLite/i })
    );
  };

  /**
   * @brief Verifies connection workflow and table schema inspection rendering.
   */
  it('connects to database and displays introspected tables', async () => {
    vi.mocked(api.connect).mockResolvedValue(true);
    vi.mocked(api.introspectSchema).mockResolvedValue(mockSchema);

    render(<App />);

    connectToSampleSqlite();

    await waitFor(() => {
      expect(api.connect).toHaveBeenCalled();
      expect(api.introspectSchema).toHaveBeenCalled();
    });

    // Switch back to ERD Canvas
    fireEvent.click(screen.getByText('ERD Canvas'));

    await waitFor(() => {
      expect(screen.getAllByText('customers').length).toBeGreaterThanOrEqual(1);
      expect(screen.getByText('VARCHAR(100)')).toBeDefined();
    });
  });

  /**
   * @brief Verifies navigation tab switching to SQL Query editor.
   */
  it('switches to SQL query editor and executes queries', async () => {
    vi.mocked(api.connect).mockResolvedValue(true);
    vi.mocked(api.introspectSchema).mockResolvedValue(mockSchema);
    vi.mocked(api.executeQuery).mockResolvedValue({
      columns: ['status', 'message'],
      rows: [[1, 'Ready']],
      rows_affected: 1,
      execution_time_ms: 2,
    });

    render(<App />);

    connectToSampleSqlite();

    await waitFor(() => {
      expect(api.connect).toHaveBeenCalled();
    });

    // Switch to SQL Query tab
    fireEvent.click(screen.getByText('SQL Query'));
    expect(screen.getByText('SQL Query Console')).toBeDefined();

    // Click Run Query
    const runBtn = screen.getByRole('button', { name: /Run Query/i });
    fireEvent.click(runBtn);

    await waitFor(() => {
      expect(api.executeQuery).toHaveBeenCalled();
      expect(screen.getByText('1 rows returned')).toBeDefined();
    });
  });

  /**
   * @brief Verifies disconnect workflow clears active database state.
   */
  it('disconnects active session and returns to disconnected view', async () => {
    vi.mocked(api.connect).mockResolvedValue(true);
    vi.mocked(api.introspectSchema).mockResolvedValue(mockSchema);
    vi.mocked(api.disconnect).mockResolvedValue(true);

    render(<App />);

    connectToSampleSqlite();

    await waitFor(() => {
      expect(api.connect).toHaveBeenCalled();
    });

    // Disconnect via HeaderBar
    const disconnectBtn = screen.getByLabelText('Disconnect database');
    fireEvent.click(disconnectBtn);

    await waitFor(() => {
      expect(api.disconnect).toHaveBeenCalled();
      expect(screen.getByText('Disconnected')).toBeDefined();
    });
  });

  /**
   * @brief Verifies reviewing schema diff and executing safe migration workflow.
   */
  it('opens diff modal and executes migration successfully', async () => {
    vi.mocked(api.connect).mockResolvedValue(true);
    vi.mocked(api.introspectSchema).mockResolvedValue(mockSchema);
    vi.mocked(api.computeDiff).mockResolvedValue({
      tables_to_create: [
        {
          name: 'products',
          columns: [
            {
              name: 'id',
              data_type: 'Integer',
              is_primary_key: true,
              is_nullable: false,
              is_auto_increment: true,
            },
          ],
          foreign_keys: [],
          indexes: [],
        },
      ],
      tables_to_drop: [],
      columns_to_add: [],
      columns_to_drop: [],
      columns_to_alter: [],
      foreign_keys_to_add: [],
      foreign_keys_to_drop: [],
    });
    vi.mocked(api.generateDdl).mockResolvedValue(['CREATE TABLE products (id INTEGER PRIMARY KEY);']);
    vi.mocked(api.executeMigration).mockResolvedValue({
      success: true,
      statements_executed: 1,
      execution_time_ms: 12,
      error_message: null,
    });

    render(<App />);

    connectToSampleSqlite();

    await waitFor(() => {
      expect(api.connect).toHaveBeenCalled();
      expect(api.introspectSchema).toHaveBeenCalled();
    });

    // Switch back to ERD Canvas
    fireEvent.click(screen.getByText('ERD Canvas'));

    // Click Review & Sync button
    const reviewSyncButtons = screen.getAllByRole('button', { name: /Review & Sync/i });
    expect(reviewSyncButtons.length).toBeGreaterThanOrEqual(1);
    fireEvent.click(reviewSyncButtons[0]);

    await waitFor(() => {
      expect(api.computeDiff).toHaveBeenCalled();
      expect(api.generateDdl).toHaveBeenCalled();
      expect(screen.getByText('Review Schema Migration')).toBeDefined();
      expect(screen.getByText('products')).toBeDefined();
    });

    // Click Execute Migration
    const executeBtn = screen.getByRole('button', { name: /Execute Migration/i });
    fireEvent.click(executeBtn);

    await waitFor(() => {
      expect(api.executeMigration).toHaveBeenCalledWith([
        'CREATE TABLE products (id INTEGER PRIMARY KEY);',
      ]);
      expect(screen.queryByText('Review Schema Migration')).toBeNull();
      expect(screen.getByText(/Migration applied successfully/)).toBeDefined();
    });
  });
});

