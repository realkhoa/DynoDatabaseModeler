/**
 * @file EditableDataGrid.test.tsx
 * @brief Unit tests for EditableDataGrid component.
 * @details Validates cell selection, inline editing, dirty cell tracking,
 * mutation bar interactions, payload generation, and discard behavior.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { EditableDataGrid } from './EditableDataGrid';
import type { RowUpdatePayload } from '../../types/database';

describe('EditableDataGrid component', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const columns = ['id', 'name', 'status', 'score'];
  const rows = [
    [1, 'Alice', 'active', 95],
    [2, 'Bob', 'pending', 80],
    [3, 'Charlie', 'inactive', 65],
  ];

  /**
   * @brief Verifies that column headers and row cells render correctly.
   */
  it('renders table headers and row cell contents', () => {
    render(<EditableDataGrid columns={columns} rows={rows} />);

    // Column headers
    expect(screen.getByText('id')).toBeDefined();
    expect(screen.getByText('name')).toBeDefined();
    expect(screen.getByText('status')).toBeDefined();
    expect(screen.getByText('score')).toBeDefined();

    // Row contents
    expect(screen.getByText('Alice')).toBeDefined();
    expect(screen.getByText('Bob')).toBeDefined();
    expect(screen.getByText('Charlie')).toBeDefined();
    expect(screen.getByText('95')).toBeDefined();
  });

  /**
   * @brief Verifies clicking a cell triggers onCellSelect callback.
   */
  it('triggers onCellSelect callback when a cell is clicked', () => {
    const onCellSelect = vi.fn();
    render(
      <EditableDataGrid
        columns={columns}
        rows={rows}
        onCellSelect={onCellSelect}
      />
    );

    const aliceCell = screen.getByText('Alice').closest('td');
    expect(aliceCell).not.toBeNull();
    fireEvent.click(aliceCell!);

    expect(onCellSelect).toHaveBeenCalledWith('name', 'Alice');
  });

  /**
   * @brief Verifies double clicking a cell activates inline input.
   */
  it('activates inline input on double click and cancels on Escape', () => {
    render(<EditableDataGrid columns={columns} rows={rows} />);

    const aliceCell = screen.getByText('Alice').closest('td')!;
    fireEvent.doubleClick(aliceCell);

    // Input should appear with initial value 'Alice'
    const input = screen.getByDisplayValue('Alice') as HTMLInputElement;
    expect(input).toBeDefined();

    // Type a new value
    fireEvent.change(input, { target: { value: 'Alicia' } });

    // Press Escape to cancel
    fireEvent.keyDown(input, { key: 'Escape' });

    // Cell value remains Alice, not dirty, mutation bar not visible
    expect(screen.getByText('Alice')).toBeDefined();
    expect(screen.queryByText(/unsaved change/i)).toBeNull();
  });

  /**
   * @brief Verifies cell editing, dirty cell highlight, and mutation bar count.
   */
  it('tracks dirty cells and renders mutation bar on edit commit', () => {
    render(
      <EditableDataGrid
        tableName="users"
        columns={columns}
        rows={rows}
      />
    );

    const aliceCell = screen.getByText('Alice').closest('td')!;
    fireEvent.doubleClick(aliceCell);

    const input = screen.getByDisplayValue('Alice');
    fireEvent.change(input, { target: { value: 'Alicia' } });
    fireEvent.blur(input);

    // Edited cell renders Alicia
    expect(screen.getByText('Alicia')).toBeDefined();

    // Mutation bar appears with 1 unsaved change
    expect(screen.getByText(/1 unsaved change/i)).toBeDefined();

    // Cell has dirty styling / marker
    const updatedCell = screen.getByText('Alicia').closest('td')!;
    expect(updatedCell.getAttribute('data-dirty')).toBe('true');
  });

  /**
   * @brief Verifies discarding changes resets cells and hides mutation bar.
   */
  it('discards all edits and reverts cell values when Discard is clicked', () => {
    render(
      <EditableDataGrid
        tableName="users"
        columns={columns}
        rows={rows}
      />
    );

    // Edit Alice -> Alicia
    const aliceCell = screen.getByText('Alice').closest('td')!;
    fireEvent.doubleClick(aliceCell);
    const input = screen.getByDisplayValue('Alice');
    fireEvent.change(input, { target: { value: 'Alicia' } });
    fireEvent.blur(input);

    expect(screen.getByText('Alicia')).toBeDefined();
    const discardBtn = screen.getByRole('button', { name: /Discard/i });
    fireEvent.click(discardBtn);

    // Reverts to Alice and hides mutation bar
    expect(screen.getByText('Alice')).toBeDefined();
    expect(screen.queryByText('Alicia')).toBeNull();
    expect(screen.queryByText(/unsaved change/i)).toBeNull();
  });

  /**
   * @brief Verifies Save Changes computes RowUpdatePayload and calls onSave.
   */
  it('computes RowUpdatePayload grouped by row and calls onSave', async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    render(
      <EditableDataGrid
        tableName="users"
        primaryKeyColumns={['id']}
        columns={columns}
        rows={rows}
        onSave={onSave}
      />
    );

    // Edit Alice name -> 'Alicia'
    const aliceCell = screen.getByText('Alice').closest('td')!;
    fireEvent.doubleClick(aliceCell);
    let input = screen.getByDisplayValue('Alice');
    fireEvent.change(input, { target: { value: 'Alicia' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    // Edit Bob score -> '88'
    const bobScoreCell = screen.getByText('80').closest('td')!;
    fireEvent.doubleClick(bobScoreCell);
    input = screen.getByDisplayValue('80');
    fireEvent.change(input, { target: { value: '88' } });
    fireEvent.blur(input);

    expect(screen.getByText(/2 unsaved changes/i)).toBeDefined();

    const saveBtn = screen.getByRole('button', { name: /Save Changes/i });
    fireEvent.click(saveBtn);

    await waitFor(() => {
      expect(onSave).toHaveBeenCalledTimes(1);
    });

    const expectedPayloads: RowUpdatePayload[] = [
      {
        table: 'users',
        primary_keys: { id: 1 },
        updated_values: { name: 'Alicia' },
      },
      {
        table: 'users',
        primary_keys: { id: 2 },
        updated_values: { score: 88 },
      },
    ];

    expect(onSave).toHaveBeenCalledWith(expectedPayloads);
  });

  /**
   * @brief Verifies primary key fallback when primaryKeyColumns is not specified.
   */
  it('falls back to column named id or first column when primaryKeyColumns omitted', async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    const customCols = ['uuid', 'title'];
    const customRows = [['u-101', 'First Post']];

    render(
      <EditableDataGrid
        tableName="posts"
        columns={customCols}
        rows={customRows}
        onSave={onSave}
      />
    );

    const titleCell = screen.getByText('First Post').closest('td')!;
    fireEvent.doubleClick(titleCell);
    const input = screen.getByDisplayValue('First Post');
    fireEvent.change(input, { target: { value: 'Updated Post' } });
    fireEvent.blur(input);

    const saveBtn = screen.getByRole('button', { name: /Save Changes/i });
    fireEvent.click(saveBtn);

    await waitFor(() => {
      expect(onSave).toHaveBeenCalledWith([
        {
          table: 'posts',
          primary_keys: { uuid: 'u-101' },
          updated_values: { title: 'Updated Post' },
        },
      ]);
    });
  });

  /**
   * @brief Verifies Save and Discard buttons are disabled during isSaving.
   */
  it('disables mutation bar buttons when isSaving is true', () => {
    render(
      <EditableDataGrid
        tableName="users"
        columns={columns}
        rows={rows}
        isSaving={true}
      />
    );

    // Edit cell to make bar appear
    const aliceCell = screen.getByText('Alice').closest('td')!;
    fireEvent.doubleClick(aliceCell);
    const input = screen.getByDisplayValue('Alice');
    fireEvent.change(input, { target: { value: 'Alicia' } });
    fireEvent.blur(input);

    const saveBtn = screen.getByRole('button', { name: /Saving|Save Changes/i }) as HTMLButtonElement;
    const discardBtn = screen.getByRole('button', { name: /Discard/i }) as HTMLButtonElement;

    expect(saveBtn.disabled).toBe(true);
    expect(discardBtn.disabled).toBe(true);
  });
});
