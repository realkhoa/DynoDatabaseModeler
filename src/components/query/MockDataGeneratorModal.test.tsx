/**
 * @file MockDataGeneratorModal.test.tsx
 * @brief Unit tests for the MockDataGeneratorModal component.
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MockDataGeneratorModal } from './MockDataGeneratorModal';
import type { DatabaseSchema } from '../../types/database';

describe('MockDataGeneratorModal component', () => {
  const mockSchema: DatabaseSchema = {
    database_name: 'test_db',
    tables: [
      {
        name: 'users',
        columns: [
          { name: 'id', data_type: 'Integer', is_nullable: false, is_primary_key: true, is_auto_increment: true },
          { name: 'username', data_type: { Varchar: 100 }, is_nullable: false, is_primary_key: false, is_auto_increment: false },
          { name: 'email', data_type: { Varchar: 255 }, is_nullable: true, is_primary_key: false, is_auto_increment: false },
        ],
        foreign_keys: [],
        indexes: [],
      },
      {
        name: 'orders',
        columns: [
          { name: 'order_id', data_type: 'Integer', is_nullable: false, is_primary_key: true, is_auto_increment: true },
          { name: 'amount', data_type: { Decimal: { precision: 10, scale: 2 } }, is_nullable: false, is_primary_key: false, is_auto_increment: false },
        ],
        foreign_keys: [],
        indexes: [],
      },
    ],
  };

  it('renders null when isOpen is false', () => {
    const { container } = render(
      <MockDataGeneratorModal isOpen={false} onClose={vi.fn()} />
    );
    expect(container.firstChild).toBeNull();
  });

  it('renders table columns and default generators when open', () => {
    render(
      <MockDataGeneratorModal
        isOpen={true}
        onClose={vi.fn()}
        schema={mockSchema}
        initialTableName="users"
      />
    );

    expect(screen.getByText('Synthetic Mock Data Generator')).toBeDefined();
    expect(screen.getByText('username')).toBeDefined();
    expect(screen.getByText('email')).toBeDefined();
    expect(screen.getByText('PK')).toBeDefined();
  });

  it('allows changing row count and updates SQL preview', () => {
    render(
      <MockDataGeneratorModal
        isOpen={true}
        onClose={vi.fn()}
        schema={mockSchema}
        initialTableName="users"
      />
    );

    const rowsInput = screen.getByLabelText(/rows/i) as HTMLInputElement;
    fireEvent.change(rowsInput, { target: { value: '5' } });

    expect(rowsInput.value).toBe('5');
  });

  it('switches target table from dropdown', () => {
    render(
      <MockDataGeneratorModal
        isOpen={true}
        onClose={vi.fn()}
        schema={mockSchema}
        initialTableName="users"
      />
    );

    const tableSelect = screen.getByLabelText(/target table/i);
    fireEvent.change(tableSelect, { target: { value: 'orders' } });

    expect(screen.getByText('order_id')).toBeDefined();
    expect(screen.getByText('amount')).toBeDefined();
  });

  it('triggers onOpenInWorksheet when clicking Open in Worksheet', () => {
    const onOpenInWorksheet = vi.fn();
    render(
      <MockDataGeneratorModal
        isOpen={true}
        onClose={vi.fn()}
        schema={mockSchema}
        initialTableName="users"
        onOpenInWorksheet={onOpenInWorksheet}
      />
    );

    const openBtn = screen.getByRole('button', { name: /open in worksheet/i });
    fireEvent.click(openBtn);

    expect(onOpenInWorksheet).toHaveBeenCalledTimes(1);
    expect(onOpenInWorksheet.mock.calls[0][0]).toContain('INSERT INTO');
  });

  it('handles live SQL execution and success message', async () => {
    const onExecuteSql = vi.fn().mockResolvedValue(undefined);
    render(
      <MockDataGeneratorModal
        isOpen={true}
        onClose={vi.fn()}
        schema={mockSchema}
        initialTableName="users"
        onExecuteSql={onExecuteSql}
      />
    );

    const execBtn = screen.getByRole('button', { name: /insert live rows/i });
    fireEvent.click(execBtn);

    await waitFor(() => {
      expect(onExecuteSql).toHaveBeenCalledTimes(1);
      expect(screen.getByText(/successfully inserted 10 mock rows/i)).toBeDefined();
    });
  });

  it('displays error banner if direct execution fails', async () => {
    const onExecuteSql = vi.fn().mockRejectedValue(new Error('Foreign key violation'));
    render(
      <MockDataGeneratorModal
        isOpen={true}
        onClose={vi.fn()}
        schema={mockSchema}
        initialTableName="users"
        onExecuteSql={onExecuteSql}
      />
    );

    const execBtn = screen.getByRole('button', { name: /insert live rows/i });
    fireEvent.click(execBtn);

    await waitFor(() => {
      expect(screen.getByText(/foreign key violation/i)).toBeDefined();
    });
  });
});
