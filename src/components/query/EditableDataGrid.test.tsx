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

      const lastBtn = screen.getByRole('button', { name: /last page/i }) as HTMLButtonElement;
      expect(lastBtn.disabled).toBe(true);
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

    /**
     * @brief Verifies that attempting page transition with dirty cells prompts user confirmation and aborts if declined.
     */
    it('prompts window.confirm before page navigation when dirty edits exist and aborts on cancellation', () => {
      const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false);
      const onPageChange = vi.fn();

      render(
        <EditableDataGrid
          tableName="users"
          primaryKeyColumns={['id']}
          columns={['id', 'name']}
          rows={[[1, 'Alice'], [2, 'Bob']]}
          pagination={{
            currentPage: 0,
            pageSize: 50,
            totalRows: 100,
            onPageChange,
            onPageSizeChange: vi.fn(),
          }}
        />
      );

      // Make a cell dirty
      const aliceCell = screen.getByText('Alice').closest('td')!;
      fireEvent.doubleClick(aliceCell);
      const input = screen.getByDisplayValue('Alice');
      fireEvent.change(input, { target: { value: 'Alicia' } });
      fireEvent.keyDown(input, { key: 'Enter' });

      // Click Next page button
      const nextBtn = screen.getByRole('button', { name: /next page/i });
      fireEvent.click(nextBtn);

      expect(confirmSpy).toHaveBeenCalledWith(
        'You have unsaved cell modifications. Changing pages will discard these changes. Continue?'
      );
      expect(onPageChange).not.toHaveBeenCalled();

      confirmSpy.mockRestore();
    });

    /**
     * @brief Verifies that page transition proceeds when user confirms discarding dirty edits.
     */
    it('prompts window.confirm before page navigation and proceeds when user confirms', () => {
      const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);
      const onPageChange = vi.fn();

      render(
        <EditableDataGrid
          tableName="users"
          primaryKeyColumns={['id']}
          columns={['id', 'name']}
          rows={[[1, 'Alice'], [2, 'Bob']]}
          pagination={{
            currentPage: 0,
            pageSize: 50,
            totalRows: 100,
            onPageChange,
            onPageSizeChange: vi.fn(),
          }}
        />
      );

      // Make a cell dirty
      const aliceCell = screen.getByText('Alice').closest('td')!;
      fireEvent.doubleClick(aliceCell);
      const input = screen.getByDisplayValue('Alice');
      fireEvent.change(input, { target: { value: 'Alicia' } });
      fireEvent.keyDown(input, { key: 'Enter' });

      // Click Next page button
      const nextBtn = screen.getByRole('button', { name: /next page/i });
      fireEvent.click(nextBtn);

      expect(confirmSpy).toHaveBeenCalledWith(
        'You have unsaved cell modifications. Changing pages will discard these changes. Continue?'
      );
      expect(onPageChange).toHaveBeenCalledWith(1);

      confirmSpy.mockRestore();
    });

    /**
     * @brief Verifies that page size change and refresh trigger window.confirm when dirty cells exist.
     */
    it('prompts window.confirm for page size change and refresh actions when dirty cells exist', () => {
      const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false);
      const onPageSizeChange = vi.fn();
      const onRefresh = vi.fn();

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
            onPageSizeChange,
            onRefresh,
          }}
        />
      );

      // Make cell dirty
      const aliceCell = screen.getByText('Alice').closest('td')!;
      fireEvent.doubleClick(aliceCell);
      const input = screen.getByDisplayValue('Alice');
      fireEvent.change(input, { target: { value: 'Alicia' } });
      fireEvent.keyDown(input, { key: 'Enter' });

      // Trigger page size change
      const pageSizeSelect = screen.getByRole('combobox', { name: /rows per page/i });
      fireEvent.change(pageSizeSelect, { target: { value: '100' } });
      expect(confirmSpy).toHaveBeenCalledTimes(1);
      expect(onPageSizeChange).not.toHaveBeenCalled();

      // Trigger refresh
      const refreshBtn = screen.getByRole('button', { name: /refresh data/i });
      fireEvent.click(refreshBtn);
      expect(confirmSpy).toHaveBeenCalledTimes(2);
      expect(onRefresh).not.toHaveBeenCalled();

      // Now allow confirm and re-test
      confirmSpy.mockReturnValue(true);
      fireEvent.change(pageSizeSelect, { target: { value: '100' } });
      expect(onPageSizeChange).toHaveBeenCalledWith(100);

      fireEvent.click(refreshBtn);
      expect(onRefresh).toHaveBeenCalledTimes(1);

      confirmSpy.mockRestore();
    });
  });
  describe('Quick client-side filter bar', () => {
    /**
     * @brief Verifies that typing into the filter input restricts visible rows.
     */
    it('filters rows matching text and shows row count indicator', async () => {
      render(<EditableDataGrid columns={columns} rows={rows} />);

      const filterInput = screen.getByTestId('grid-filter-input');
      expect(filterInput).toBeDefined();

      // Filter by 'Bob'
      fireEvent.change(filterInput, { target: { value: 'Bob' } });

      await waitFor(() => {
        expect(screen.getByTestId('grid-filter-count').textContent).toContain('Showing 1 of 3 rows');
      });

      expect(screen.getByText('Bob')).toBeDefined();
      expect(screen.queryByText('Alice')).toBeNull();
      expect(screen.queryByText('Charlie')).toBeNull();

      // Clear filter via clear button
      const clearBtn = screen.getByTestId('grid-filter-clear-btn');
      fireEvent.click(clearBtn);

      expect(screen.getByText('Alice')).toBeDefined();
      expect(screen.getByText('Bob')).toBeDefined();
      expect(screen.getByText('Charlie')).toBeDefined();
      expect(screen.queryByTestId('grid-filter-count')).toBeNull();
    });

    /**
     * @brief Verifies message when no rows match the active filter.
     */
    it('shows placeholder message when no rows match the filter', async () => {
      render(<EditableDataGrid columns={columns} rows={rows} />);

      const filterInput = screen.getByTestId('grid-filter-input');
      fireEvent.change(filterInput, { target: { value: 'nonexistent_query' } });

      await waitFor(() => {
        expect(screen.getByText(/No rows match filter/i)).toBeDefined();
      });
    });

    /**
     * @brief Verifies editing a row while filtered preserves the original row index in save payloads.
     */
    it('preserves correct row index when editing while filtered', async () => {
      const onSave = vi.fn().mockResolvedValue(undefined);
      render(
        <EditableDataGrid
          tableName="users"
          columns={columns}
          rows={rows}
          primaryKeyColumns={['id']}
          onSave={onSave}
        />
      );

      const filterInput = screen.getByTestId('grid-filter-input');
      // Filter for Charlie (original row index 2)
      fireEvent.change(filterInput, { target: { value: 'Charlie' } });

      await waitFor(() => {
        expect(screen.queryByText('Alice')).toBeNull();
      });

      const charlieCell = screen.getByText('Charlie').closest('td')!;
      fireEvent.doubleClick(charlieCell);

      const input = charlieCell.querySelector('input')!;
      fireEvent.change(input, { target: { value: 'Charles' } });
      fireEvent.keyDown(input, { key: 'Enter' });

      const saveButton = screen.getByRole('button', { name: /save changes/i });
      fireEvent.click(saveButton);

      await waitFor(() => {
        expect(onSave).toHaveBeenCalledWith([
          {
            table: 'users',
            primary_keys: { id: 3 },
            updated_values: { name: 'Charles' },
            expect_single_row: true,
          },
        ]);
      });
    });
  });

  describe('Virtual windowing and debounced filter', () => {
    /**
     * @brief Verifies that a large dataset renders only visible rows plus overscan instead of all DOM nodes.
     */
    it('renders large dataset efficiently with virtual windowing', () => {
      const largeCols = ['id', 'name', 'value'];
      const largeRows = Array.from({ length: 500 }, (_, i) => [i + 1, `Item ${i + 1}`, i * 10]);

      const { container } = render(
        <EditableDataGrid
          columns={largeCols}
          rows={largeRows}
        />
      );

      // Instead of 500 rows in DOM, only visible window + overscan rows are present
      const domRows = container.querySelectorAll('tbody tr');
      expect(domRows.length).toBeLessThan(100);
      expect(domRows.length).toBeGreaterThan(0);
    });

    /**
     * @brief Verifies filtering a dataset with debounced search input.
     */
    it('filters large dataset with debounced search input', async () => {
      const filterCols = ['id', 'name'];
      const filterRows = [
        [1, 'Alice'],
        [2, 'Bob'],
        [3, 'Charlie'],
      ];

      render(<EditableDataGrid columns={filterCols} rows={filterRows} />);

      const filterInput = screen.getByTestId('grid-filter-input');
      fireEvent.change(filterInput, { target: { value: 'Bob' } });

      // With debounce, wait for debounced update
      await waitFor(() => {
        expect(screen.getByText('Showing 1 of 3 rows')).toBeDefined();
      });
      expect(screen.getByText('Bob')).toBeDefined();
      expect(screen.queryByText('Alice')).toBeNull();
    });

    /**
     * @brief Verifies that scrolling container updates rendered slice and renders top spacer.
     */
    it('updates rendered window and spacer heights on scroll event', () => {
      const largeCols = ['id', 'name'];
      const largeRows = Array.from({ length: 500 }, (_, i) => [i + 1, `Item ${i + 1}`]);

      const { container } = render(
        <EditableDataGrid
          columns={largeCols}
          rows={largeRows}
        />
      );

      const scrollContainer = screen.getByTestId('grid-scroll-container');
      expect(scrollContainer).toBeDefined();

      // Scroll down by 2800px (100 rows * 28px)
      fireEvent.scroll(scrollContainer, { target: { scrollTop: 2800 } });

      // After scrolling down, top spacer row exists with positive height
      const spacerTrs = container.querySelectorAll('tbody tr[aria-hidden="true"]');
      expect(spacerTrs.length).toBeGreaterThan(0);
      const topSpacer = spacerTrs[0] as HTMLElement;
      expect(topSpacer.style.height).not.toBe('0px');
    });

    /**
     * @brief Verifies editing and saving a cell works seamlessly on virtualized datasets.
     */
    it('allows editing and saving cells in a virtualized large dataset', async () => {
      const onSave = vi.fn().mockResolvedValue(undefined);
      const largeCols = ['id', 'name'];
      const largeRows = Array.from({ length: 200 }, (_, i) => [i + 1, `User ${i + 1}`]);

      render(
        <EditableDataGrid
          tableName="users"
          columns={largeCols}
          rows={largeRows}
          primaryKeyColumns={['id']}
          onSave={onSave}
        />
      );

      const user1Cell = screen.getByText('User 1').closest('td')!;
      fireEvent.doubleClick(user1Cell);

      const input = user1Cell.querySelector('input')!;
      fireEvent.change(input, { target: { value: 'User One Updated' } });
      fireEvent.keyDown(input, { key: 'Enter' });

      expect(screen.getByText('User One Updated')).toBeDefined();
      expect(screen.getByText(/1 unsaved change/i)).toBeDefined();

      const saveBtn = screen.getByRole('button', { name: /save changes/i });
      fireEvent.click(saveBtn);

      await waitFor(() => {
        expect(onSave).toHaveBeenCalledWith([
          {
            table: 'users',
            primary_keys: { id: 1 },
            updated_values: { name: 'User One Updated' },
            expect_single_row: true,
          },
        ]);
      });
    });
  });
});
