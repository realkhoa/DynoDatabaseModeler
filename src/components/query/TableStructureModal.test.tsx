/**
 * @file TableStructureModal.test.tsx
 * @brief Unit tests for the TableStructureModal component.
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { TableStructureModal } from './TableStructureModal';
import type { DatabaseSchema } from '../../types/database';

describe('TableStructureModal component', () => {
  const mockSchema: DatabaseSchema = {
    database_name: 'test_db',
    tables: [
      {
        name: 'products',
        columns: [
          { name: 'id', data_type: 'BigInt', is_nullable: false, is_primary_key: true, is_auto_increment: true },
          { name: 'title', data_type: { Varchar: 200 }, is_nullable: false, is_primary_key: false, is_auto_increment: false },
          { name: 'price', data_type: { Decimal: { precision: 10, scale: 2 } }, is_nullable: false, is_primary_key: false, is_auto_increment: false },
        ],
        indexes: [
          { name: 'idx_products_title', columns: ['title'], is_unique: false },
        ],
        foreign_keys: [
          {
            constraint_name: 'fk_products_category',
            source_column: 'category_id',
            target_table: 'categories',
            target_column: 'id',
            on_delete: 'Cascade',
            on_update: 'Cascade',
          },
        ],
      },
    ],
  };

  it('renders null when isOpen is false or table not found', () => {
    const { container } = render(
      <TableStructureModal
        isOpen={false}
        onClose={vi.fn()}
        schema={mockSchema}
        tableName="products"
      />
    );
    expect(container.firstChild).toBeNull();
  });

  it('renders table columns tab with column specifications', () => {
    render(
      <TableStructureModal
        isOpen={true}
        onClose={vi.fn()}
        schema={mockSchema}
        tableName="products"
      />
    );

    expect(screen.getByRole('heading', { name: 'products' })).toBeDefined();
    expect(screen.getByText('title')).toBeDefined();
    expect(screen.getByText('VARCHAR(200)')).toBeDefined();
    expect(screen.getByText('price')).toBeDefined();
  });

  it('filters columns via column search input', () => {
    render(
      <TableStructureModal
        isOpen={true}
        onClose={vi.fn()}
        schema={mockSchema}
        tableName="products"
      />
    );

    const filterInput = screen.getByPlaceholderText('Filter columns...');
    fireEvent.change(filterInput, { target: { value: 'price' } });

    expect(screen.getByText('price')).toBeDefined();
    expect(screen.queryByText('title')).toBeNull();
  });

  it('switches to indexes and foreign keys tabs', () => {
    render(
      <TableStructureModal
        isOpen={true}
        onClose={vi.fn()}
        schema={mockSchema}
        tableName="products"
      />
    );

    const indexesTab = screen.getByText(/Indexes/);
    fireEvent.click(indexesTab);
    expect(screen.getByText('idx_products_title')).toBeDefined();

    const fkTab = screen.getByText(/Foreign Keys/);
    fireEvent.click(fkTab);
    expect(screen.getByText('fk_products_category')).toBeDefined();
    expect(screen.getByText(/categories/)).toBeDefined();
  });

  it('switches to DDL tab and triggers onOpenInWorksheet', () => {
    const onOpen = vi.fn();
    const onClose = vi.fn();

    render(
      <TableStructureModal
        isOpen={true}
        onClose={onClose}
        schema={mockSchema}
        tableName="products"
        onOpenInWorksheet={onOpen}
      />
    );

    const ddlTab = screen.getByText('DDL Script');
    fireEvent.click(ddlTab);

    expect(screen.getByText(/CREATE TABLE "products"/)).toBeDefined();

    const openBtn = screen.getByText('Open in Worksheet');
    fireEvent.click(openBtn);

    expect(onOpen).toHaveBeenCalledWith(expect.stringContaining('CREATE TABLE "products"'), 'DDL: products');
    expect(onClose).toHaveBeenCalled();
  });

  it('triggers onOpenMockGenerator when clicking Mock Data button in header', () => {
    const onMock = vi.fn();
    const onClose = vi.fn();

    render(
      <TableStructureModal
        isOpen={true}
        onClose={onClose}
        schema={mockSchema}
        tableName="products"
        onOpenMockGenerator={onMock}
      />
    );

    const mockBtn = screen.getByText('Mock Data');
    fireEvent.click(mockBtn);

    expect(onMock).toHaveBeenCalledWith('products');
    expect(onClose).toHaveBeenCalled();
  });
});
