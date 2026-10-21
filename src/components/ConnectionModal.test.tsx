/**
 * @file ConnectionModal.test.tsx
 * @brief Unit tests for ConnectionModal component configuration, validation, and connectivity tests.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { ConnectionModal, formatErrorMessage } from './ConnectionModal';
import { api } from '../api/ipc';

// Mock ipc api methods
vi.mock('../api/ipc', () => ({
  api: {
    testConnection: vi.fn(),
    listDatabases: vi.fn(),
    listActiveDatabases: vi.fn(),
    switchDatabase: vi.fn(),
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
    const dbInput = screen.getByLabelText(/defaults to maintenance db/i);
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

    const dbInput = screen.getByLabelText(/defaults to maintenance db/i);
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

  /**
   * @brief Verifies SSH Bastion Tunnel toggle reveals fields and includes config in submission.
   */
  it('configures SSH bastion tunnel and includes in submitted config', async () => {
    const handleConnect = vi.fn().mockResolvedValue(undefined);

    render(
      <ConnectionModal
        isOpen={true}
        onClose={vi.fn()}
        onConnect={handleConnect}
      />
    );

    const dbInput = screen.getByLabelText(/defaults to maintenance db/i);
    fireEvent.change(dbInput, { target: { value: 'remote_db' } });

    const sshToggle = screen.getByTestId('ssh-tunnel-enable');
    fireEvent.click(sshToggle);

    expect(screen.getByTestId('ssh-tunnel-host')).toBeDefined();
    const sshHostInput = screen.getByTestId('ssh-tunnel-host');
    fireEvent.change(sshHostInput, { target: { value: 'jump.company.com' } });

    const sshUserInput = screen.getByTestId('ssh-tunnel-user');
    fireEvent.change(sshUserInput, { target: { value: 'tunnel_user' } });

    const connectBtn = screen.getByRole('button', { name: 'Connect' });
    fireEvent.click(connectBtn);

    await waitFor(() => {
      expect(handleConnect).toHaveBeenCalledWith(
        expect.objectContaining({
          database: 'remote_db',
          ssh_tunnel: expect.objectContaining({
            enabled: true,
            host: 'jump.company.com',
            port: 22,
            username: 'tunnel_user',
            auth_type: 'Password',
          }),
        })
      );
    });
  });

  /**
   * @brief Verifies selecting DuckDB engine displays file path picker and submits embedded config.
   */
  it('configures DuckDB embedded connection with database file path', async () => {
    const handleConnect = vi.fn().mockResolvedValue(undefined);
    const handleClose = vi.fn();

    render(
      <ConnectionModal
        isOpen={true}
        onClose={handleClose}
        onConnect={handleConnect}
      />
    );

    const duckDbBtn = screen.getByRole('button', { name: /DuckDB/i });
    fireEvent.click(duckDbBtn);

    const nameInput = screen.getByLabelText(/Connection Name/i);
    expect((nameInput as HTMLInputElement).value).toBe('Local DuckDB');

    const filePathInput = screen.getByPlaceholderText(/\/path\/to\/analytics\.duckdb or :memory:/i);
    fireEvent.change(filePathInput, { target: { value: 'analytics.duckdb' } });

    const connectBtn = screen.getByRole('button', { name: 'Connect' });
    fireEvent.click(connectBtn);

    await waitFor(() => {
      expect(handleConnect).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'Local DuckDB',
          db_type: 'DuckDb',
          database: 'analytics.duckdb',
          file_path: 'analytics.duckdb',
          port: undefined,
          host: undefined,
        })
      );
      expect(handleClose).toHaveBeenCalled();
    });
  });

  /**
   * @brief Verifies error message formatting unpacks serde enum objects cleanly.
   */
  it('formats serde error objects into readable strings instead of [object Object]', () => {
    expect(formatErrorMessage({ Connection: 'Failed to connect to 127.0.0.1:5432' })).toBe(
      'Connection: Failed to connect to 127.0.0.1:5432'
    );
    expect(formatErrorMessage(new Error('Network error'))).toBe('Network error');
    expect(formatErrorMessage('Simple text error')).toBe('Simple text error');
    expect(formatErrorMessage({ message: 'Explicit error message' })).toBe('Explicit error message');
    expect(formatErrorMessage(null)).toBe('Unknown error occurred.');
  });

  /**
   * @brief Verifies test connection failure displays formatted error message from rejected promise.
   */
  it('displays formatted error banner when test connection fails with serde object', async () => {
    vi.mocked(api.testConnection).mockRejectedValueOnce({
      Connection: 'password authentication failed for user "dyno_user"',
    });

    render(
      <ConnectionModal
        isOpen={true}
        onClose={vi.fn()}
        onConnect={vi.fn()}
      />
    );

    const dbInput = screen.getByLabelText(/defaults to maintenance db/i);
    fireEvent.change(dbInput, { target: { value: 'dyno_test' } });

    const testBtn = screen.getByText('Test Connection');
    fireEvent.click(testBtn);

    await waitFor(() => {
      expect(
        screen.getByText(/Connection: password authentication failed for user "dyno_user"/i)
      ).toBeDefined();
    });
  });

  /**
   * @brief Verifies submitting without database name defaults to 'postgres' for Postgres engine.
   */
  it('defaults to maintenance database postgres if left blank', async () => {
    const handleConnect = vi.fn().mockResolvedValue(undefined);
    const handleClose = vi.fn();

    render(
      <ConnectionModal
        isOpen={true}
        onClose={handleClose}
        onConnect={handleConnect}
      />
    );

    // Leave Database input empty
    const connectBtn = screen.getByRole('button', { name: 'Connect' });
    fireEvent.click(connectBtn);

    await waitFor(() => {
      expect(handleConnect).toHaveBeenCalledWith(
        expect.objectContaining({
          db_type: 'Postgres',
          database: 'postgres',
        })
      );
    });
  });

  /**
   * @brief Verifies Fetch Databases button queries api.listDatabases and allows selecting discovered DB.
   */
  it('discovers databases on server and allows selecting from results', async () => {
    vi.mocked(api.listDatabases).mockResolvedValueOnce(['postgres', 'dyno_test', 'custom_db']);

    render(
      <ConnectionModal
        isOpen={true}
        onClose={vi.fn()}
        onConnect={vi.fn()}
      />
    );

    const fetchBtn = screen.getByRole('button', { name: /Fetch Databases/i });
    fireEvent.click(fetchBtn);

    await waitFor(() => {
      expect(api.listDatabases).toHaveBeenCalledTimes(1);
      expect(screen.getByText('dyno_test')).toBeDefined();
      expect(screen.getByText('custom_db')).toBeDefined();
    });

    // Clicking custom_db button sets the database input
    fireEvent.click(screen.getByRole('button', { name: 'custom_db' }));
    const dbInput = screen.getByLabelText(/defaults to maintenance db/i) as HTMLInputElement;
    expect(dbInput.value).toBe('custom_db');
  });
  /**
   * @brief Verifies switching to Universal engine reveals URL input and dialect selector.
   */
  it('switches to Universal engine and configures connection URL', async () => {
    const handleConnect = vi.fn().mockResolvedValue(undefined);
    render(
      <ConnectionModal
        isOpen={true}
        onClose={vi.fn()}
        onConnect={handleConnect}
      />
    );

    // Switch to Universal
    fireEvent.click(screen.getByRole('button', { name: /Universal/i }));
    expect(screen.getByTestId('universal-connection-url')).toBeDefined();
    expect(screen.getByTestId('universal-dialect-family')).toBeDefined();

    // Type custom connection URL
    const urlInput = screen.getByTestId('universal-connection-url');
    fireEvent.change(urlInput, {
      target: { value: 'postgresql://postgres:pass@remote.db:5432/analytics' },
    });

    const connectBtn = screen.getByRole('button', { name: 'Connect' });
    fireEvent.click(connectBtn);

    await waitFor(() => {
      expect(handleConnect).toHaveBeenCalledWith(
        expect.objectContaining({
          db_type: 'Universal',
          connection_url: 'postgresql://postgres:pass@remote.db:5432/analytics',
          dialect_family: 'postgres',
        })
      );
    });
  });

  /**
   * @brief Verifies switching to Redis engine sets default port 6379, db 0, and profile name.
   */
  it('switches to Redis engine and sets port 6379 and database index 0', async () => {
    const handleConnect = vi.fn().mockResolvedValue(undefined);
    render(
      <ConnectionModal
        isOpen={true}
        onClose={vi.fn()}
        onConnect={handleConnect}
      />
    );

    // Switch to Redis
    fireEvent.click(screen.getByRole('button', { name: /Redis/i }));
    expect(screen.getByDisplayValue('6379')).toBeDefined();
    expect(screen.getByDisplayValue('0')).toBeDefined();
    expect(screen.getByDisplayValue('Local Redis')).toBeDefined();

    const connectBtn = screen.getByRole('button', { name: 'Connect' });
    fireEvent.click(connectBtn);

    await waitFor(() => {
      expect(handleConnect).toHaveBeenCalledWith(
        expect.objectContaining({
          db_type: 'Redis',
          port: 6379,
          database: '0',
        })
      );
    });
  });
});