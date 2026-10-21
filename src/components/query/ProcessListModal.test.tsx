/**
 * @file ProcessListModal.test.tsx
 * @brief Unit tests for the ProcessListModal component.
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { ProcessListModal } from './ProcessListModal';
import type { QueryResult } from '../../types/database';

describe('ProcessListModal component', () => {
  const mockProcessResult: QueryResult = {
    columns: ['pid', 'user', 'database', 'client', 'state', 'duration', 'query'],
    rows: [
      [101, 'postgres', 'production_db', '192.168.1.5', 'active', '00:00:15', 'SELECT * FROM big_orders;'],
      [102, 'read_user', 'production_db', '192.168.1.10', 'idle', '00:01:30', 'SELECT 1;'],
    ],
    execution_time_ms: 4,
    rows_affected: 2,
  };

  it('renders null when isOpen is false', () => {
    const { container } = render(
      <ProcessListModal isOpen={false} onClose={vi.fn()} />
    );
    expect(container.firstChild).toBeNull();
  });

  it('fetches and renders active processes when open', async () => {
    const mockExec = vi.fn().mockResolvedValue(mockProcessResult);

    render(
      <ProcessListModal
        isOpen={true}
        onClose={vi.fn()}
        dbType="Postgres"
        customExecuteSql={mockExec}
      />
    );

    expect(screen.getByText('Active Database Processes & Queries')).toBeDefined();

    await waitFor(() => {
      expect(screen.getByText('101')).toBeDefined();
      expect(screen.getByText('SELECT * FROM big_orders;')).toBeDefined();
      expect(screen.getByText('102')).toBeDefined();
    });
  });

  it('filters processes dynamically via search input', async () => {
    const mockExec = vi.fn().mockResolvedValue(mockProcessResult);

    render(
      <ProcessListModal
        isOpen={true}
        onClose={vi.fn()}
        dbType="Postgres"
        customExecuteSql={mockExec}
      />
    );

    await waitFor(() => {
      expect(screen.getByText('101')).toBeDefined();
    });

    const searchInput = screen.getByPlaceholderText(/search processes/i);
    fireEvent.change(searchInput, { target: { value: 'big_orders' } });

    expect(screen.getByText('101')).toBeDefined();
    expect(screen.queryByText('102')).toBeNull();
  });

  it('shows confirmation dialog when Kill button is clicked and executes termination', async () => {
    const mockExec = vi
      .fn()
      .mockResolvedValueOnce(mockProcessResult)
      .mockResolvedValueOnce({ columns: [], rows: [], execution_time_ms: 1, rows_affected: 1 })
      .mockResolvedValueOnce({ columns: ['pid'], rows: [], execution_time_ms: 1, rows_affected: 0 });

    render(
      <ProcessListModal
        isOpen={true}
        onClose={vi.fn()}
        dbType="Postgres"
        customExecuteSql={mockExec}
      />
    );

    await waitFor(() => {
      expect(screen.getByText('101')).toBeDefined();
    });

    const killButtons = screen.getAllByRole('button', { name: /kill/i });
    fireEvent.click(killButtons[0]);

    // Confirmation dialog appears
    expect(screen.getByText(/terminate process #101/i)).toBeDefined();

    const confirmBtn = screen.getByRole('button', { name: /terminate query/i });
    fireEvent.click(confirmBtn);

    await waitFor(() => {
      expect(mockExec).toHaveBeenCalledWith('SELECT pg_terminate_backend(101);');
    });
  });

  it('handles and displays error when process fetching fails', async () => {
    const mockExec = vi.fn().mockRejectedValue(new Error('Permission denied'));

    render(
      <ProcessListModal
        isOpen={true}
        onClose={vi.fn()}
        dbType="Postgres"
        customExecuteSql={mockExec}
      />
    );

    await waitFor(() => {
      expect(screen.getByText(/permission denied/i)).toBeDefined();
    });
  });
});
