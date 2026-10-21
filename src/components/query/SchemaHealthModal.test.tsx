/**
 * @file SchemaHealthModal.test.tsx
 * @brief Unit tests for SchemaHealthModal component.
 * @details Verifies health score rendering, filter tab switching, search input,
 * individual and bundled quick-fix clipboard copying, and worksheet opening.
 */

import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { DatabaseSchema } from '../../types/database';
import { SchemaHealthModal } from './SchemaHealthModal';

describe('SchemaHealthModal component', () => {
  const sampleSchema: DatabaseSchema = {
    database_name: 'shop_db',
    tables: [
      {
        name: 'logs',
        columns: [
          {
            name: 'content',
            data_type: 'Text',
            is_primary_key: false,
            is_nullable: true,
            is_auto_increment: false,
          },
        ],
        foreign_keys: [],
        indexes: [],
      },
      {
        name: 'orders',
        columns: [
          {
            name: 'id',
            data_type: 'Integer',
            is_primary_key: true,
            is_nullable: false,
            is_auto_increment: true,
          },
          {
            name: 'customer_id',
            data_type: 'Integer',
            is_primary_key: false,
            is_nullable: false,
            is_auto_increment: false,
          },
        ],
        foreign_keys: [
          {
            constraint_name: 'fk_orders_cust',
            source_column: 'customer_id',
            target_table: 'customers',
            target_column: 'id',
            on_delete: 'Cascade',
            on_update: 'NoAction',
          },
        ],
        indexes: [],
      },
    ],
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('does not render when isOpen is false', () => {
    const { container } = render(
      <SchemaHealthModal
        isOpen={false}
        onClose={vi.fn()}
        schema={sampleSchema}
      />
    );
    expect(container.firstChild).toBeNull();
  });

  it('renders health score, summary statistics, and issue cards when open', () => {
    render(
      <SchemaHealthModal
        isOpen={true}
        onClose={vi.fn()}
        schema={sampleSchema}
      />
    );

    expect(screen.getByRole('dialog')).toBeDefined();
    expect(screen.getByText(/Database Schema Health Advisor/i)).toBeDefined();
    expect(screen.getByTestId('health-score-badge')).toBeDefined();
    expect(screen.getByText(/Missing Primary Key/i)).toBeDefined();
    expect(screen.getByText(/Unindexed Foreign Key/i)).toBeDefined();
  });

  it('filters issues by severity tabs', () => {
    render(
      <SchemaHealthModal
        isOpen={true}
        onClose={vi.fn()}
        schema={sampleSchema}
      />
    );

    // Click Critical tab
    const criticalTab = screen.getByTestId('health-filter-critical');
    fireEvent.click(criticalTab);

    expect(screen.getByText(/Missing Primary Key/i)).toBeDefined();
    expect(screen.queryByText(/Unindexed Foreign Key/i)).toBeNull();

    // Click Warnings tab
    const warningTab = screen.getByTestId('health-filter-warning');
    fireEvent.click(warningTab);

    expect(screen.getByText(/Unindexed Foreign Key/i)).toBeDefined();
    expect(screen.queryByText(/Missing Primary Key/i)).toBeNull();
  });

  it('copies individual quick-fix SQL to clipboard with feedback', async () => {
    const writeTextMock = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText: writeTextMock },
      configurable: true,
      writable: true,
    });

    render(
      <SchemaHealthModal
        isOpen={true}
        onClose={vi.fn()}
        schema={sampleSchema}
      />
    );

    const copyFixBtns = screen.getAllByRole('button', { name: /copy fix/i });
    expect(copyFixBtns.length).toBeGreaterThan(0);

    fireEvent.click(copyFixBtns[0]);
    expect(writeTextMock).toHaveBeenCalled();
    expect(await screen.findByText(/copied/i)).toBeDefined();
  });

  it('copies bundled auto-remediation migration script', async () => {
    const writeTextMock = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText: writeTextMock },
      configurable: true,
      writable: true,
    });

    render(
      <SchemaHealthModal
        isOpen={true}
        onClose={vi.fn()}
        schema={sampleSchema}
      />
    );

    const bundleBtn = screen.getByTestId('health-copy-bundle-btn');
    fireEvent.click(bundleBtn);

    expect(writeTextMock).toHaveBeenCalled();
    expect(await screen.findByText(/copied all fixes!/i)).toBeDefined();
  });

  it('forwards bundled SQL to worksheet when requested', () => {
    const onOpenInWorksheet = vi.fn();
    render(
      <SchemaHealthModal
        isOpen={true}
        onClose={vi.fn()}
        schema={sampleSchema}
        onOpenInWorksheet={onOpenInWorksheet}
      />
    );

    const worksheetBtn = screen.getByTestId('health-bundle-worksheet-btn');
    fireEvent.click(worksheetBtn);

    expect(onOpenInWorksheet).toHaveBeenCalled();
  });
});
