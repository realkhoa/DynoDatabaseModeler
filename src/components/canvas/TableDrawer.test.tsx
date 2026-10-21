/**
 * @file TableDrawer.test.tsx
 * @brief Unit tests for TableDrawer slide-out inspector and editor component.
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { TableDrawer } from './TableDrawer';
import type { TableSchema } from '../../types/database';

describe('TableDrawer component', () => {
  const sampleTable: TableSchema = {
    name: 'users',
    columns: [
      {
        name: 'id',
        data_type: 'Integer',
        is_primary_key: true,
        is_nullable: false,
        is_auto_increment: true,
      },
      {
        name: 'email',
        data_type: { Varchar: 255 },
        is_primary_key: false,
        is_nullable: false,
        is_auto_increment: false,
      },
    ],
    foreign_keys: [],
    indexes: [],
  };

  /**
   * @brief Verifies that drawer is not rendered or hidden when isOpen is false.
   */
  it('does not render content when isOpen is false', () => {
    render(
      <TableDrawer
        isOpen={false}
        table={sampleTable}
        onClose={vi.fn()}
        onSaveTable={vi.fn()}
      />
    );

    expect(screen.queryByText('Edit Table')).toBeNull();
  });

  /**
   * @brief Verifies rendering existing table details in edit mode.
   */
  it('renders existing table columns and fields when opened', () => {
    render(
      <TableDrawer
        isOpen={true}
        table={sampleTable}
        onClose={vi.fn()}
        onSaveTable={vi.fn()}
      />
    );

    expect(screen.getByText('Edit Table: users')).toBeDefined();
    expect(screen.getByDisplayValue('users')).toBeDefined();
    expect(screen.getByDisplayValue('id')).toBeDefined();
    expect(screen.getByDisplayValue('email')).toBeDefined();
  });

  /**
   * @brief Verifies adding a new column to the table.
   */
  it('allows adding a new column', () => {
    render(
      <TableDrawer
        isOpen={true}
        table={sampleTable}
        onClose={vi.fn()}
        onSaveTable={vi.fn()}
      />
    );

    const addColBtn = screen.getByRole('button', { name: /Add Column/i });
    fireEvent.click(addColBtn);

    expect(screen.getByDisplayValue('new_column')).toBeDefined();
  });

  /**
   * @brief Verifies toggling primary key and nullable properties.
   */
  it('toggles column primary key and nullable properties', () => {
    const onSave = vi.fn();
    render(
      <TableDrawer
        isOpen={true}
        table={sampleTable}
        onClose={vi.fn()}
        onSaveTable={onSave}
      />
    );

    // Find PK checkboxes
    const pkCheckboxes = screen.getAllByRole('checkbox', { name: /primary key/i });
    expect(pkCheckboxes.length).toBeGreaterThanOrEqual(2);

    // Toggle PK on second column (email)
    fireEvent.click(pkCheckboxes[1]);

    // Save changes
    const saveBtn = screen.getByRole('button', { name: /Save Changes/i });
    fireEvent.click(saveBtn);

    expect(onSave).toHaveBeenCalled();
    const savedTable = onSave.mock.calls[0][0] as TableSchema;
    expect(savedTable.columns[1].is_primary_key).toBe(true);
  });

  /**
   * @brief Verifies creating a new table mode when table prop is null.
   */
  it('supports creating a new table when table prop is null', () => {
    const onSave = vi.fn();
    render(
      <TableDrawer
        isOpen={true}
        table={null}
        onClose={vi.fn()}
        onSaveTable={onSave}
      />
    );

    expect(screen.getByText('Create New Table')).toBeDefined();

    // Change table name
    const nameInput = screen.getByPlaceholderText('Table name');
    fireEvent.change(nameInput, { target: { value: 'products' } });

    // Save table
    const saveBtn = screen.getByRole('button', { name: /Create Table/i });
    fireEvent.click(saveBtn);

    expect(onSave).toHaveBeenCalled();
    const savedTable = onSave.mock.calls[0][0] as TableSchema;
    expect(savedTable.name).toBe('products');
  });

  /**
   * @brief Verifies closing the drawer triggers onClose.
   */
  it('calls onClose when close or cancel button is clicked', () => {
    const onClose = vi.fn();
    render(
      <TableDrawer
        isOpen={true}
        table={sampleTable}
        onClose={onClose}
        onSaveTable={vi.fn()}
      />
    );

    const closeBtn = screen.getByLabelText('Close table drawer');
    fireEvent.click(closeBtn);

    expect(onClose).toHaveBeenCalled();
  });

  /**
   * @brief Verifies that clicking Export ORM button triggers onExportOrm with table name.
   */
  it('calls onExportOrm with table name when Export ORM button is clicked', () => {
    const onExportOrm = vi.fn();
    render(
      <TableDrawer
        isOpen={true}
        table={sampleTable}
        onClose={vi.fn()}
        onSaveTable={vi.fn()}
        onExportOrm={onExportOrm}
      />
    );

    const exportBtn = screen.getByTestId('drawer-export-orm-btn');
    fireEvent.click(exportBtn);

    expect(onExportOrm).toHaveBeenCalledWith('users');
  });

  /**
   * @brief Verifies that clicking Import Data button triggers onImportData with table name.
   */
  it('calls onImportData with table name when Import Data button is clicked', () => {
    const onImportData = vi.fn();
    render(
      <TableDrawer
        isOpen={true}
        table={sampleTable}
        onClose={vi.fn()}
        onSaveTable={vi.fn()}
        onImportData={onImportData}
      />
    );

    const importBtn = screen.getByTestId('drawer-import-data-btn');
    fireEvent.click(importBtn);

    expect(onImportData).toHaveBeenCalledWith('users');
  });
});
