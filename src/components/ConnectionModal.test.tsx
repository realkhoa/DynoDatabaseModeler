/**
 * @file ConnectionModal.test.tsx
 * @brief Unit tests for ConnectionModal component configuration, validation, and connectivity tests.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { ConnectionModal } from './ConnectionModal';
import { api } from '../api/ipc';

// Mock ipc api methods
vi.mock('../api/ipc', () => ({
  api: {
    testConnection: vi.fn(),
  },
}));

describe('ConnectionModal component', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  /**
   * @brief Verifies modal does not render into DOM when isOpen is false.
   */
  it('does not render when isOpen is false', () => {
    const { container } = render(
      <ConnectionModal
        isOpen={false}
        onClose={vi.fn()}
        onConnect={vi.fn()}
      />
    );
    expect(container.firstChild).toBeNull();
  });

  /**
   * @brief Verifies modal renders header, form inputs, and buttons when isOpen is true.
   */
  it('renders modal dialog and default fields when open', () => {
    render(
      <ConnectionModal
        isOpen={true}
        onClose={vi.fn()}
        onConnect={vi.fn()}
      />
    );

    expect(screen.getByText('New Database Connection')).toBeDefined();
    expect(screen.getByDisplayValue('Local Postgres')).toBeDefined();
    expect(screen.getByText('Test Connection')).toBeDefined();
    expect(screen.getByRole('button', { name: 'Connect' })).toBeDefined();
  });

  /**
   * @brief Verifies engine switching updates default ports and input view.
   */
  it('switches database engine and adapts inputs', async () => {
    render(
      <ConnectionModal
        isOpen={true}
        onClose={vi.fn()}
        onConnect={vi.fn()}
      />
    );

    // Switch to SQLite
    fireEvent.click(screen.getByRole('button', { name: 'SQLite' }));
    expect(screen.getByText(/Database File Path or :memory:/i)).toBeDefined();

    // Switch to MySQL
    fireEvent.click(screen.getByRole('button', { name: 'MySQL' }));
    expect(screen.getByDisplayValue('3306')).toBeDefined();

    // Switch to SQL Server
    fireEvent.click(screen.getByRole('button', { name: 'SQL Server' }));
    expect(screen.getByDisplayValue('1433')).toBeDefined();
  });

  /**
   * @brief Verifies test connection triggers api.testConnection and shows success banner.
   */
  it('tests connection and displays success feedback', async () => {
    vi.mocked(api.testConnection).mockResolvedValueOnce(true);

    render(
      <ConnectionModal
        isOpen={true}
        onClose={vi.fn()}
        onConnect={vi.fn()}
      />
    );

    // Provide database name
    const dbInput = screen.getByPlaceholderText('Database name');
    fireEvent.change(dbInput, { target: { value: 'postgres' } });

    const testBtn = screen.getByText('Test Connection');
    fireEvent.click(testBtn);

    await waitFor(() => {
      expect(api.testConnection).toHaveBeenCalledTimes(1);
      expect(screen.getByText('Connection established successfully!')).toBeDefined();
    });
  });

  /**
   * @brief Verifies form submission triggers onConnect with valid payload.
   */
  it('submits valid connection configuration', async () => {
    const handleConnect = vi.fn().mockResolvedValue(undefined);
    const handleClose = vi.fn();

    render(
      <ConnectionModal
        isOpen={true}
        onClose={handleClose}
        onConnect={handleConnect}
      />
    );

    const nameInput = screen.getByLabelText(/Connection Name/i);
    fireEvent.change(nameInput, { target: { value: 'My Production PG' } });

    const dbInput = screen.getByPlaceholderText('Database name');
    fireEvent.change(dbInput, { target: { value: 'prod_db' } });

    const connectBtn = screen.getByRole('button', { name: 'Connect' });
    fireEvent.click(connectBtn);

    await waitFor(() => {
      expect(handleConnect).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'My Production PG',
          db_type: 'Postgres',
          database: 'prod_db',
          host: '127.0.0.1',
          port: 5432,
        })
      );
      expect(handleClose).toHaveBeenCalled();
    });
  });
});
