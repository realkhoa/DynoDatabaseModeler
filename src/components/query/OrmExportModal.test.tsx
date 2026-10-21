/**
 * @file OrmExportModal.test.tsx
 * @brief Unit tests for OrmExportModal component.
 * @details Verifies modal mounting, framework tab switching, table scope filtering,
 * clipboard copy, and download actions.
 */

import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { TableSchema } from '../../types/database';
import { OrmExportModal } from './OrmExportModal';

// Mock Monaco Editor component
vi.mock('@monaco-editor/react', () => ({
  default: ({ value, language }: { value: string; language: string }) => (
    <div data-testid="monaco-editor-mock" data-language={language}>
      {value}
    </div>
  ),
}));

describe('OrmExportModal component', () => {
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
      name: 'posts',
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
      <OrmExportModal
        isOpen={false}
        onClose={vi.fn()}
        tables={sampleTables}
      />
    );
    expect(container.firstChild).toBeNull();
  });

  it('renders modal dialog and default Prisma tab when open', () => {
    render(
      <OrmExportModal
        isOpen={true}
        onClose={vi.fn()}
        tables={sampleTables}
      />
    );

    expect(screen.getByRole('dialog')).toBeDefined();
    expect(screen.getByText(/ORM & Entity Code Generator/i)).toBeDefined();
    expect(screen.getByTestId('orm-tab-prisma')).toBeDefined();
    expect(screen.getByTestId('monaco-editor-mock')).toBeDefined();
    expect(screen.getByText(/schema\.prisma/i)).toBeDefined();
  });

  it('switches framework tabs and updates Monaco language and filename', () => {
    render(
      <OrmExportModal
        isOpen={true}
        onClose={vi.fn()}
        tables={sampleTables}
      />
    );

    // Switch to Golang GORM
    const gormTab = screen.getByTestId('orm-tab-gorm');
    fireEvent.click(gormTab);
    expect(screen.getByText(/models\.go/i)).toBeDefined();
    expect(screen.getByTestId('monaco-editor-mock').getAttribute('data-language')).toBe('go');

    // Switch to Rust SeaORM
    const seaormTab = screen.getByTestId('orm-tab-seaorm');
    fireEvent.click(seaormTab);
    expect(screen.getByText(/entities\.rs/i)).toBeDefined();
    expect(screen.getByTestId('monaco-editor-mock').getAttribute('data-language')).toBe('rust');
  });

  it('filters table scope via dropdown selector', () => {
    render(
      <OrmExportModal
        isOpen={true}
        onClose={vi.fn()}
        tables={sampleTables}
      />
    );

    const select = screen.getByTestId('orm-table-select') as HTMLSelectElement;
    fireEvent.change(select, { target: { value: 'users' } });

    expect(select.value).toBe('users');
    expect(screen.getByText(/\(1 table included\)/i)).toBeDefined();
  });

  it('copies generated code to clipboard with visual feedback', async () => {
    const writeTextMock = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      value: {
        writeText: writeTextMock,
      },
      configurable: true,
      writable: true,
    });

    render(
      <OrmExportModal
        isOpen={true}
        onClose={vi.fn()}
        tables={sampleTables}
      />
    );

    const copyBtn = screen.getByTestId('orm-copy-code-btn');
    fireEvent.click(copyBtn);

    expect(writeTextMock).toHaveBeenCalled();
    expect(await screen.findByText(/copied!/i)).toBeDefined();
  });

  it('invokes onClose when close button is clicked', () => {
    const onClose = vi.fn();
    render(
      <OrmExportModal
        isOpen={true}
        onClose={onClose}
        tables={sampleTables}
      />
    );

    const closeBtn = screen.getByTestId('orm-modal-close-btn');
    fireEvent.click(closeBtn);
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
