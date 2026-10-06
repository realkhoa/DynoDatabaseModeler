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
  },
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
});
