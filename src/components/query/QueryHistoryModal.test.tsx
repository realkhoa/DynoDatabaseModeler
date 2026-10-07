/**
 * @file QueryHistoryModal.test.tsx
 * @brief Vitest component tests for the QueryHistoryModal component.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryHistoryModal } from './QueryHistoryModal';
import { api } from '../../api/ipc';
import type { QueryHistoryRecord } from '../../types/database';

vi.mock('../../api/ipc', () => ({
  api: {
    getQueryHistory: vi.fn(),
    toggleFavoriteQuery: vi.fn(),
    clearQueryHistory: vi.fn(),
  },
}));

describe('QueryHistoryModal', () => {
  const mockRecords: QueryHistoryRecord[] = [
    {
      id: 1,
      query_text: 'SELECT * FROM users WHERE active = true;',
      executed_at: '2026-10-06T12:00:00Z',
      duration_ms: 45,
      rows_count: 10,
      status: 'success',
      is_favorite: true,
    },
    {
      id: 2,
      query_text: 'SELECT * FROM orders WHERE total > 100;',
      executed_at: '2026-10-06T12:05:00Z',
      duration_ms: 120,
      rows_count: 5,
      status: 'success',
      is_favorite: false,
    },
    {
      id: 3,
      query_text: 'INSERT INTO invalid_table VALUES (1);',
      executed_at: '2026-10-06T12:10:00Z',
      duration_ms: 12,
      rows_count: 0,
      status: 'error',
      is_favorite: false,
    },
  ];

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(api.getQueryHistory).mockResolvedValue(mockRecords);
    vi.mocked(api.toggleFavoriteQuery).mockResolvedValue(true);
    vi.mocked(api.clearQueryHistory).mockResolvedValue(undefined);

    Object.defineProperty(navigator, 'clipboard', {
      value: {
        writeText: vi.fn().mockResolvedValue(undefined),
      },
      configurable: true,
      writable: true,
    });
  });

  it('does not render when isOpen is false', () => {
    const { container } = render(
      <QueryHistoryModal isOpen={false} onClose={vi.fn()} onSelectQuery={vi.fn()} />
    );
    expect(container.firstChild).toBeNull();
  });

  it('renders queries and fetches history when opened', async () => {
    render(<QueryHistoryModal isOpen={true} onClose={vi.fn()} onSelectQuery={vi.fn()} />);

    expect(await screen.findByText(/SELECT \* FROM users/i)).toBeDefined();
    expect(screen.getByText(/SELECT \* FROM orders/i)).toBeDefined();
    expect(screen.getByText(/INSERT INTO invalid_table/i)).toBeDefined();
    expect(screen.getAllByText('SUCCESS')).toHaveLength(2);
    expect(screen.getByText('ERROR')).toBeDefined();
  });

  it('filters history by search filter text', async () => {
    render(<QueryHistoryModal isOpen={true} onClose={vi.fn()} onSelectQuery={vi.fn()} />);

    await screen.findByText(/SELECT \* FROM users/i);

    const searchInput = screen.getByPlaceholderText(/Search history by query text/i);
    fireEvent.change(searchInput, { target: { value: 'orders' } });

    expect(screen.queryByText(/SELECT \* FROM users/i)).toBeNull();
    expect(screen.getByText(/SELECT \* FROM orders/i)).toBeDefined();
  });

  it('filters history by favorites toggle button', async () => {
    render(<QueryHistoryModal isOpen={true} onClose={vi.fn()} onSelectQuery={vi.fn()} />);

    await screen.findByText(/SELECT \* FROM users/i);

    const favButton = screen.getByRole('button', { name: /Favorites Only/i });
    fireEvent.click(favButton);

    expect(screen.getByText(/SELECT \* FROM users/i)).toBeDefined();
    expect(screen.queryByText(/SELECT \* FROM orders/i)).toBeNull();
  });

  it('toggles favorite status when star is clicked', async () => {
    vi.mocked(api.toggleFavoriteQuery).mockResolvedValue(true);

    render(<QueryHistoryModal isOpen={true} onClose={vi.fn()} onSelectQuery={vi.fn()} />);

    await screen.findByText(/SELECT \* FROM users/i);

    const addFavButtons = screen.getAllByRole('button', { name: /Add favorite/i });
    expect(addFavButtons.length).toBeGreaterThan(0);

    fireEvent.click(addFavButtons[0]);
    await waitFor(() => {
      expect(api.toggleFavoriteQuery).toHaveBeenCalledWith(2);
    });
  });

  it('selects query and closes modal when "Use Query" is clicked', async () => {
    const onSelect = vi.fn();
    const onClose = vi.fn();

    render(<QueryHistoryModal isOpen={true} onClose={onClose} onSelectQuery={onSelect} />);

    await screen.findByText(/SELECT \* FROM users/i);

    const useQueryButtons = screen.getAllByRole('button', { name: /Use Query/i });
    fireEvent.click(useQueryButtons[0]);

    expect(onSelect).toHaveBeenCalledWith(mockRecords[0].query_text);
    expect(onClose).toHaveBeenCalled();
  });

  it('copies SQL query to clipboard when copy button is clicked', async () => {
    render(<QueryHistoryModal isOpen={true} onClose={vi.fn()} onSelectQuery={vi.fn()} />);

    await screen.findByText(/SELECT \* FROM users/i);

    const copyButtons = screen.getAllByRole('button', { name: /Copy/i });
    fireEvent.click(copyButtons[0]);

    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(mockRecords[0].query_text);
  });

  it('clears history when confirmation is confirmed', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);

    render(<QueryHistoryModal isOpen={true} onClose={vi.fn()} onSelectQuery={vi.fn()} />);

    await screen.findByText(/SELECT \* FROM users/i);

    const clearButton = screen.getByRole('button', { name: /Clear History/i });
    fireEvent.click(clearButton);

    await waitFor(() => {
      expect(api.clearQueryHistory).toHaveBeenCalled();
    });
  });
});
