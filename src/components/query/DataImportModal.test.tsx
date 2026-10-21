/**
 * @file DataImportModal.test.tsx
 * @brief Unit tests for DataImportModal component.
 * @details Verifies multi-step wizard navigation, CSV/JSON source input, target table selection,
 * column mapping, preview table, clipboard copying, and worksheet export actions.
 */

import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { TableSchema } from '../../types/database';
import { DataImportModal } from './DataImportModal';

// Mock Monaco Editor component
vi.mock('@monaco-editor/react', () => ({
  default: ({ value, language }: { value: string; language: string }) => (
    <div data-testid="monaco-editor-mock" data-language={language}>
      {value}
    </div>
  ),
}));

describe('DataImportModal component', () => {
  const sampleTables: TableSchema[] = [
    {
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
          name: 'name',
          data_type: { Varchar: 100 },
          is_primary_key: false,
          is_nullable: false,
          is_auto_increment: false,
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
    },
    {
      name: 'products',
      columns: [
        {
          name: 'id',
          data_type: 'Integer',
          is_primary_key: true,
          is_nullable: false,
          is_auto_increment: true,
        },
        {
          name: 'title',
          data_type: { Varchar: 200 },
          is_primary_key: false,
          is_nullable: false,
          is_auto_increment: false,
        },
      ],
      foreign_keys: [],
      indexes: [],
    },
  ];

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('does not render when isOpen is false', () => {
    const { container } = render(
      <DataImportModal
        isOpen={false}
        onClose={vi.fn()}
        tables={sampleTables}
      />
    );
    expect(container.firstChild).toBeNull();
  });

  it('renders Step 1 with input area and sample data trigger when open', () => {
    render(
      <DataImportModal
        isOpen={true}
        onClose={vi.fn()}
        tables={sampleTables}
      />
    );

    expect(screen.getByRole('dialog')).toBeDefined();
    expect(screen.getByText(/Smart Data Import Wizard/i)).toBeDefined();
    expect(screen.getByTestId('import-raw-input')).toBeDefined();
    expect(screen.getByText(/Load Sample Data/i)).toBeDefined();
  });

  it('populates sample data and navigates to Step 2 (Column Mapping)', () => {
    render(
      <DataImportModal
        isOpen={true}
        onClose={vi.fn()}
        tables={sampleTables}
      />
    );

    // Click Load Sample Data
    const sampleBtn = screen.getByText(/Load Sample Data/i);
    fireEvent.click(sampleBtn);

    const input = screen.getByTestId('import-raw-input') as HTMLTextAreaElement;
    expect(input.value.length).toBeGreaterThan(0);

    // Click Next button to advance to Step 2
    const nextBtn = screen.getByTestId('import-next-btn');
    fireEvent.click(nextBtn);

    // Verify Step 2 is active
    expect(screen.getByTestId('import-target-table-select')).toBeDefined();
    expect(screen.getByText(/Source Header/i)).toBeDefined();
  });

  it('navigates through all 4 steps to generated SQL preview', () => {
    render(
      <DataImportModal
        isOpen={true}
        onClose={vi.fn()}
        tables={sampleTables}
      />
    );

    // Step 1: Input data
    const input = screen.getByTestId('import-raw-input');
    fireEvent.change(input, {
      target: { value: 'id,name,email\n1,Alice,alice@example.com\n2,Bob,bob@example.com' },
    });

    // Step 1 -> Step 2
    fireEvent.click(screen.getByTestId('import-next-btn'));
    expect(screen.getByText(/Target Table:/i)).toBeDefined();

    // Step 2 -> Step 3
    fireEvent.click(screen.getByTestId('import-next-btn'));
    expect(screen.getByTestId('import-conflict-select')).toBeDefined();
    expect(screen.getByText(/Previewing first/i)).toBeDefined();

    // Step 3 -> Step 4
    fireEvent.click(screen.getByTestId('import-next-btn'));
    expect(screen.getByTestId('import-monaco-wrapper')).toBeDefined();
    expect(screen.getByTestId('monaco-editor-mock')).toBeDefined();
    expect(screen.getByTestId('monaco-editor-mock').textContent).toContain('INSERT INTO "users"');
  });

  it('copies generated SQL to clipboard in Step 4', async () => {
    const writeTextMock = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText: writeTextMock },
      configurable: true,
      writable: true,
    });

    render(
      <DataImportModal
        isOpen={true}
        onClose={vi.fn()}
        tables={sampleTables}
      />
    );

    const input = screen.getByTestId('import-raw-input');
    fireEvent.change(input, {
      target: { value: 'id,name,email\n1,Alice,alice@example.com' },
    });

    // Advance to Step 4
    fireEvent.click(screen.getByTestId('import-next-btn')); // Step 2
    fireEvent.click(screen.getByTestId('import-next-btn')); // Step 3
    fireEvent.click(screen.getByTestId('import-next-btn')); // Step 4

    const copyBtn = screen.getByTestId('import-copy-sql-btn');
    fireEvent.click(copyBtn);

    expect(writeTextMock).toHaveBeenCalled();
    expect(await screen.findByText(/copied!/i)).toBeDefined();
  });

  it('triggers onOpenInWorksheet when worksheet button is clicked', () => {
    const onOpenInWorksheet = vi.fn();
    render(
      <DataImportModal
        isOpen={true}
        onClose={vi.fn()}
        tables={sampleTables}
        onOpenInWorksheet={onOpenInWorksheet}
      />
    );

    const input = screen.getByTestId('import-raw-input');
    fireEvent.change(input, {
      target: { value: 'id,name\n1,Test' },
    });

    // Advance to Step 4
    fireEvent.click(screen.getByTestId('import-next-btn'));
    fireEvent.click(screen.getByTestId('import-next-btn'));
    fireEvent.click(screen.getByTestId('import-next-btn'));

    const worksheetBtn = screen.getByTestId('import-worksheet-btn');
    fireEvent.click(worksheetBtn);

    expect(onOpenInWorksheet).toHaveBeenCalled();
  });
});
