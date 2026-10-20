/**
 * @file EditableDataGrid.test.tsx
 * @brief Unit tests for EditableDataGrid component.
 * @details Validates cell selection, inline editing, dirty cell tracking, mutation bar interactions,
 * strict primary-key payload generation, local refusal of incomplete keys, discard behaviour, and
 * read-only enforcement when no primary key is known.
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

    expect(screen.getByText('id')).toBeDefined();
    expect(screen.getByText('name')).toBeDefined();
    expect(screen.getByText('status')).toBeDefined();
    expect(screen.getByText('score')).toBeDefined();

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
      <EditableDataGrid columns={columns} rows={rows} onCellSelect={onCellSelect} />
    );

    const aliceCell = screen.getByText('Alice').closest('td');
    expect(aliceCell).not.toBeNull();
    fireEvent.click(aliceCell!);

    expect(onCellSelect).toHaveBeenCalledWith('name', 'Alice');
  });

  /**
   * @brief Verifies that the grid is read-only when no primary key is available.
   */
  it('refuses to edit when no primary key is known', () => {
    render(
      <EditableDataGrid
        columns={columns}
        rows={rows}
        editDisabledReason="Read-only: table has no primary key."
      />
    );

    expect(screen.getByTestId('grid-readonly-notice')).toBeDefined();

    // Double click must not open an editor.
    const aliceCell = screen.getByText('Alice').closest('td')!;
    fireEvent.doubleClick(aliceCell);
    expect(screen.queryByDisplayValue('Alice')).toBeNull();
  });

  /**
   * @brief Verifies double clicking a cell activates inline input.
   */
  it('activates inline input on double click and cancels on Escape', () => {
    render(
      <EditableDataGrid columns={columns} rows={rows} primaryKeyColumns={['id']} />
    );

    const aliceCell = screen.getByText('Alice').closest('td')!;
    fireEvent.doubleClick(aliceCell);

    const input = screen.getByDisplayValue('Alice') as HTMLInputElement;
    expect(input).toBeDefined();

    fireEvent.change(input, { target: { value: 'Alicia' } });
    fireEvent.keyDown(input, { key: 'Escape' });

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
        primaryKeyColumns={['id']}
        columns={columns}
        rows={rows}
      />
    );

    const aliceCell = screen.getByText('Alice').closest('td')!;
    fireEvent.doubleClick(aliceCell);

    const input = screen.getByDisplayValue('Alice');
    fireEvent.change(input, { target: { value: 'Alicia' } });
    fireEvent.blur(input);

    expect(screen.getByText('Alicia')).toBeDefined();
    expect(screen.getByText(/1 unsaved change/i)).toBeDefined();

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
        primaryKeyColumns={['id']}
        columns={columns}
        rows={rows}
      />
    );

    const aliceCell = screen.getByText('Alice').closest('td')!;
    fireEvent.doubleClick(aliceCell);
    const input = screen.getByDisplayValue('Alice');
    fireEvent.change(input, { target: { value: 'Alicia' } });
    fireEvent.blur(input);

    expect(screen.getByText('Alicia')).toBeDefined();
    const discardBtn = screen.getByRole('button', { name: /Discard/i });
    fireEvent.click(discardBtn);

    expect(screen.getByText('Alice')).toBeDefined();
    expect(screen.queryByText('Alicia')).toBeNull();
    expect(screen.queryByText(/unsaved change/i)).toBeNull();
  });

  /**
   * @brief Verifies Save Changes computes strict single-row payloads keyed by the primary key.
   */
  it('computes strict single-row RowUpdatePayload grouped by row and calls onSave', async () => {
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

    const aliceCell = screen.getByText('Alice').closest('td')!;
    fireEvent.doubleClick(aliceCell);
    let input = screen.getByDisplayValue('Alice');
    fireEvent.change(input, { target: { value: 'Alicia' } });
    fireEvent.keyDown(input, { key: 'Enter' });

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
        expect_single_row: true,
      },
      {
        table: 'users',
        primary_keys: { id: 2 },
        updated_values: { score: 88 },
        expect_single_row: true,
      },
    ];

    expect(onSave).toHaveBeenCalledWith(expectedPayloads);
  });

  /**
   * @brief Verifies a composite primary key is sent in full.
   */
  it('builds composite primary key locators from every key column', async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    const compositeColumns = ['tenant_id', 'id', 'label'];
    const compositeRows = [
      [7, 42, 'first'],
      [8, 43, 'second'],
    ];

    render(
      <EditableDataGrid
        tableName="items"
        primaryKeyColumns={['tenant_id', 'id']}
        columns={compositeColumns}
        rows={compositeRows}
        onSave={onSave}
      />
    );

    const labelCell = screen.getByText('second').closest('td')!;
    fireEvent.doubleClick(labelCell);
    const input = screen.getByDisplayValue('second');
    fireEvent.change(input, { target: { value: 'updated' } });
    fireEvent.blur(input);

    fireEvent.click(screen.getByRole('button', { name: /Save Changes/i }));

    await waitFor(() => {
      expect(onSave).toHaveBeenCalledWith([
        {
          table: 'items',
          primary_keys: { tenant_id: 8, id: 43 },
          updated_values: { label: 'updated' },
          expect_single_row: true,
        },
      ]);
    });
  });

  /**
   * @brief Verifies a NULL primary key value blocks the save instead of sending a weak locator.
   */
  it('refuses to save a row whose primary key is NULL', async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    const rowsWithNullKey = [
      [null, 'NoKey', 'active', 10],
      [2, 'Bob', 'pending', 20],
    ];

    render(
      <EditableDataGrid
        tableName="users"
        primaryKeyColumns={['id']}
        columns={columns}
        rows={rowsWithNullKey}
        onSave={onSave}
      />
    );

    const nameCell = screen.getByText('NoKey').closest('td')!;
    fireEvent.doubleClick(nameCell);
    const input = screen.getByDisplayValue('NoKey');
    fireEvent.change(input, { target: { value: 'Renamed' } });
    fireEvent.blur(input);

    fireEvent.click(screen.getByRole('button', { name: /Save Changes/i }));

    await waitFor(() => {
      expect(screen.getByTestId('grid-save-error')).toBeDefined();
    });
    expect(onSave).not.toHaveBeenCalled();
  });

  /**
   * @brief Verifies Save and Discard buttons are disabled during isSaving.
   */
  it('disables mutation bar buttons when isSaving is true', () => {
    render(
      <EditableDataGrid
        tableName="users"
        primaryKeyColumns={['id']}
        columns={columns}
        rows={rows}
        isSaving={true}
      />
    );

    const aliceCell = screen.getByText('Alice').closest('td')!;
    fireEvent.doubleClick(aliceCell);
    const input = screen.getByDisplayValue('Alice');
    fireEvent.change(input, { target: { value: 'Alicia' } });
    fireEvent.blur(input);

    const saveBtn = screen.getByRole('button', {
      name: /Saving|Save Changes/i,
    }) as HTMLButtonElement;
    const discardBtn = screen.getByRole('button', { name: /Discard/i }) as HTMLButtonElement;

    expect(saveBtn.disabled).toBe(true);
    expect(discardBtn.disabled).toBe(true);
  });

  describe('pagination toolbar', () => {
    /**
     * @brief Verifies that pagination bar is not rendered when pagination prop is omitted.
     */
    it('does not render pagination bar when pagination prop is not provided', () => {
      render(<EditableDataGrid columns={columns} rows={rows} />);
      expect(screen.queryByTestId('pagination-bar')).toBeNull();
    });

    /**
     * @brief Verifies pagination bar renders row range, page status, and page size dropdown.
     */
    it('renders pagination bar with page information and page size options', () => {
      const onPageChange = vi.fn();
      const onPageSizeChange = vi.fn();

      render(
        <EditableDataGrid
          columns={['id', 'name']}
          rows={[
            [1, 'Alice'],
            [2, 'Bob'],
          ]}
          pagination={{
            currentPage: 0,
            pageSize: 50,
            totalRows: 120,
            onPageChange,
            onPageSizeChange,
          }}
        />
      );

      expect(screen.getByTestId('pagination-bar')).toBeDefined();
      expect(screen.getByText(/showing 1 - 2 of 120 rows/i)).toBeDefined();
      expect(screen.getByText(/page 1 of 3/i)).toBeDefined();

      const nextBtn = screen.getByRole('button', { name: /next page/i });
      fireEvent.click(nextBtn);
      expect(onPageChange).toHaveBeenCalledWith(1);

      const pageSizeSelect = screen.getByRole('combobox', { name: /rows per page/i }) as HTMLSelectElement;
      expect(pageSizeSelect.value).toBe('50');
      fireEvent.change(pageSizeSelect, { target: { value: '100' } });
      expect(onPageSizeChange).toHaveBeenCalledWith(100);
    });

    /**
     * @brief Verifies pagination summary when totalRows is unknown or null.
     */
    it('renders pagination bar when totalRows is null or undefined', () => {
      render(
        <EditableDataGrid
          columns={['id', 'name']}
          rows={[
            [1, 'Alice'],
            [2, 'Bob'],
          ]}
          pagination={{
            currentPage: 0,
            pageSize: 50,
            totalRows: null,
            onPageChange: vi.fn(),
            onPageSizeChange: vi.fn(),
          }}
        />
      );

      expect(screen.getByText(/showing 2 rows/i)).toBeDefined();
      expect(screen.getByText(/page 1/i)).toBeDefined();
      expect(screen.queryByText(/page 1 of/i)).toBeNull();
    });

    /**
     * @brief Verifies button disabling logic on first and last pages.
     */
    it('disables previous button on first page and next button on last page', () => {
      const onPageChange = vi.fn();
      render(
        <EditableDataGrid
          columns={['id']}
          rows={[[1]]}
          pagination={{
            currentPage: 0,
            pageSize: 50,
            totalRows: 40,
            onPageChange,
            onPageSizeChange: vi.fn(),
          }}
        />
      );

      const firstBtn = screen.getByRole('button', { name: /first page/i }) as HTMLButtonElement;
      const prevBtn = screen.getByRole('button', { name: /previous page/i }) as HTMLButtonElement;
      const nextBtn = screen.getByRole('button', { name: /next page/i }) as HTMLButtonElement;
      const lastBtn = screen.getByRole('button', { name: /last page/i }) as HTMLButtonElement;

      expect(firstBtn.disabled).toBe(true);
      expect(prevBtn.disabled).toBe(true);
      expect(nextBtn.disabled).toBe(true);
      expect(lastBtn.disabled).toBe(true);
    });

    /**
     * @brief Verifies navigation interactions across middle pages (First, Prev, Next, Last).
     */
    it('handles First, Prev, Next, and Last navigation clicks on middle pages', () => {
      const onPageChange = vi.fn();
      render(
        <EditableDataGrid
          columns={['id']}
          rows={[[51], [52]]}
          pagination={{
            currentPage: 1,
            pageSize: 50,
            totalRows: 150,
            onPageChange,
            onPageSizeChange: vi.fn(),
          }}
        />
      );

      const firstBtn = screen.getByRole('button', { name: /first page/i }) as HTMLButtonElement;
      const prevBtn = screen.getByRole('button', { name: /previous page/i }) as HTMLButtonElement;
      const nextBtn = screen.getByRole('button', { name: /next page/i }) as HTMLButtonElement;
      const lastBtn = screen.getByRole('button', { name: /last page/i }) as HTMLButtonElement;

      expect(firstBtn.disabled).toBe(false);
      expect(prevBtn.disabled).toBe(false);
      expect(nextBtn.disabled).toBe(false);
      expect(lastBtn.disabled).toBe(false);

      fireEvent.click(firstBtn);
      expect(onPageChange).toHaveBeenCalledWith(0);

      fireEvent.click(prevBtn);
      expect(onPageChange).toHaveBeenCalledWith(0);

      fireEvent.click(nextBtn);
      expect(onPageChange).toHaveBeenCalledWith(2);

      fireEvent.click(lastBtn);
      expect(onPageChange).toHaveBeenCalledWith(2);
    });

    /**
     * @brief Verifies refresh button triggers onRefresh callback when clicked.
     */
    it('triggers onRefresh callback when refresh button is clicked', () => {
      const onRefresh = vi.fn();
      render(
        <EditableDataGrid
          columns={['id']}
          rows={[[1]]}
          pagination={{
            currentPage: 0,
            pageSize: 50,
            totalRows: 100,
            onPageChange: vi.fn(),
            onPageSizeChange: vi.fn(),
            onRefresh,
          }}
        />
      );

      const refreshBtn = screen.getByRole('button', { name: /refresh data/i });
      fireEvent.click(refreshBtn);
      expect(onRefresh).toHaveBeenCalledTimes(1);
    });

    /**
     * @brief Verifies mutation bar and pagination bar coexist without conflict.
     */
    it('renders both mutation bar and pagination bar when dirty cells exist', () => {
      render(
        <EditableDataGrid
          tableName="users"
          primaryKeyColumns={['id']}
          columns={['id', 'name']}
          rows={[[1, 'Alice']]}
          pagination={{
            currentPage: 0,
            pageSize: 50,
            totalRows: 100,
            onPageChange: vi.fn(),
            onPageSizeChange: vi.fn(),
          }}
        />
      );

      const aliceCell = screen.getByText('Alice').closest('td')!;
      fireEvent.doubleClick(aliceCell);
      const input = screen.getByDisplayValue('Alice');
      fireEvent.change(input, { target: { value: 'Alicia' } });
      fireEvent.blur(input);

      expect(screen.getByTestId('mutation-bar')).toBeDefined();
      expect(screen.getByTestId('pagination-bar')).toBeDefined();
    });
  });
});
