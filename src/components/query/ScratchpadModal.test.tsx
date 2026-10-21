/**
 * @file ScratchpadModal.test.tsx
 * @brief Unit tests for the ScratchpadModal component.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ScratchpadModal } from './ScratchpadModal';

describe('ScratchpadModal component', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it('renders null when isOpen is false', () => {
    const { container } = render(
      <ScratchpadModal isOpen={false} onClose={vi.fn()} />
    );
    expect(container.firstChild).toBeNull();
  });

  it('renders default templates and searches by query', () => {
    render(<ScratchpadModal isOpen={true} onClose={vi.fn()} />);

    expect(screen.getByText('SQL Snippets & Scratchpad')).toBeDefined();
    expect(screen.getByText('Find Duplicate Records in Table')).toBeDefined();

    const searchInput = screen.getByPlaceholderText('Search queries, tags...');
    fireEvent.change(searchInput, { target: { value: 'Duplicate' } });

    expect(screen.getByText('Find Duplicate Records in Table')).toBeDefined();
    expect(screen.queryByText('Table Row Counts Overview')).toBeNull();
  });

  it('creates and saves a new custom snippet', () => {
    render(<ScratchpadModal isOpen={true} onClose={vi.fn()} />);

    const newBtn = screen.getByRole('button', { name: /New/ });
    fireEvent.click(newBtn);

    const titleInput = screen.getByPlaceholderText('Snippet Title...');
    fireEvent.change(titleInput, { target: { value: 'Custom High Value Customers' } });

    const sqlInput = screen.getByPlaceholderText('Write your SQL query statement here...');
    fireEvent.change(sqlInput, { target: { value: 'SELECT * FROM orders WHERE total > 500;' } });

    const saveBtn = screen.getByRole('button', { name: /Save/ });
    fireEvent.click(saveBtn);

    expect(screen.getByText('Custom High Value Customers')).toBeDefined();
  });

  it('triggers onOpenInWorksheet when clicking Open in Worksheet', () => {
    const onOpen = vi.fn();
    const onClose = vi.fn();

    render(
      <ScratchpadModal
        isOpen={true}
        onClose={onClose}
        onOpenInWorksheet={onOpen}
      />
    );

    const openBtn = screen.getByText('Open in Worksheet');
    fireEvent.click(openBtn);

    expect(onOpen).toHaveBeenCalledWith(
      expect.stringContaining('SELECT'),
      expect.any(String)
    );
    expect(onClose).toHaveBeenCalled();
  });

  it('triggers onInsertAtCursor when clicking Insert at Cursor', () => {
    const onInsert = vi.fn();
    const onClose = vi.fn();

    render(
      <ScratchpadModal
        isOpen={true}
        onClose={onClose}
        onInsertAtCursor={onInsert}
      />
    );

    const insertBtn = screen.getByText('Insert at Cursor');
    fireEvent.click(insertBtn);

    expect(onInsert).toHaveBeenCalledWith(expect.stringContaining('SELECT'));
    expect(onClose).toHaveBeenCalled();
  });
});
