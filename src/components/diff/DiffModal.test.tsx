/**
 * @file DiffModal.test.tsx
 * @brief Unit tests for DiffModal visual schema difference and migration execution dialog.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { DiffModal } from './DiffModal';
import type { SchemaDiff } from '../../types/database';

// Mock Monaco Editor for headless test environment
vi.mock('@monaco-editor/react', () => ({
  default: ({
    value,
    onChange,
  }: {
    value?: string;
    onChange?: (val: string) => void;
  }) => (
    <textarea
      data-testid="monaco-editor"
      value={value}
      onChange={(e) => onChange?.(e.target.value)}
    />
  ),
}));

describe('DiffModal component', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const mockNonDestructiveDiff: SchemaDiff = {
    tables_to_create: [
      {
        name: 'categories',
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
            data_type: { Varchar: 100 },
            is_primary_key: false,
            is_nullable: false,
            is_auto_increment: false,
          },
        ],
        foreign_keys: [],
        indexes: [],
      },
    ],
    tables_to_drop: [],
    tables_to_rename: [],
    tables_to_rebuild: [],
    indexes_to_create: [],
    indexes_to_drop: [],
    columns_to_add: [
      [
        'users',
        {
          name: 'avatar_url',
          data_type: { Varchar: 255 },
          is_primary_key: false,
          is_nullable: true,
          is_auto_increment: false,
        },
      ],
    ],
    columns_to_drop: [],
    columns_to_alter: [
      {
        table_name: 'users',
        source_column: {
          name: 'bio',
          data_type: { Varchar: 100 },
          is_primary_key: false,
          is_nullable: true,
          is_auto_increment: false,
        },
        target_column: {
          name: 'bio',
          data_type: { Varchar: 500 },
          is_primary_key: false,
          is_nullable: true,
          is_auto_increment: false,
        },
        is_destructive: false,
      },
    ],
    foreign_keys_to_add: [
      [
        'posts',
        {
          constraint_name: 'fk_posts_category',
          source_column: 'category_id',
          target_table: 'categories',
          target_column: 'id',
          on_delete: 'Cascade',
          on_update: 'NoAction',
        },
      ],
    ],
    foreign_keys_to_drop: [],
  };

  const mockDestructiveDiff: SchemaDiff = {
    tables_to_create: [],
    tables_to_drop: ['legacy_logs'],
    tables_to_rename: [],
    tables_to_rebuild: [],
    indexes_to_create: [],
    indexes_to_drop: [],
    columns_to_add: [],
    columns_to_drop: [['users', 'deprecated_token']],
    columns_to_alter: [
      {
        table_name: 'profiles',
        source_column: {
          name: 'phone',
          data_type: { Varchar: 20 },
          is_primary_key: false,
          is_nullable: true,
          is_auto_increment: false,
        },
        target_column: {
          name: 'phone',
          data_type: { Varchar: 20 },
          is_primary_key: false,
          is_nullable: false, // Changed nullable to false: destructive
          is_auto_increment: false,
        },
        is_destructive: true,
      },
    ],
    foreign_keys_to_add: [],
    foreign_keys_to_drop: [['posts', 'fk_posts_old']],
  };

  /**
   * @brief Verifies that nothing is rendered when isOpen is false or diff is null.
   */
  it('renders null when isOpen is false or diff is null', () => {
    const { container: c1 } = render(
      <DiffModal
        isOpen={false}
        diff={mockNonDestructiveDiff}
        generatedDdl={['CREATE TABLE categories;']}
        onClose={vi.fn()}
        onExecute={vi.fn()}
      />
    );
    expect(c1.firstChild).toBeNull();

    const { container: c2 } = render(
      <DiffModal
        isOpen={true}
        diff={null}
        generatedDdl={[]}
        onClose={vi.fn()}
        onExecute={vi.fn()}
      />
    );
    expect(c2.firstChild).toBeNull();
  });

  /**
   * @brief Verifies rendering of detected change items in the left tree.
   */
  it('renders change tree items for created tables, added columns, alters, and foreign keys', () => {
    render(
      <DiffModal
        isOpen={true}
        diff={mockNonDestructiveDiff}
        generatedDdl={['CREATE TABLE categories (id INTEGER PRIMARY KEY);']}
        onClose={vi.fn()}
        onExecute={vi.fn()}
      />
    );

    expect(screen.getByText('Review Schema Migration')).toBeDefined();
    expect(screen.getByText('Detected Changes')).toBeDefined();
    expect(screen.getByText(/Create Table:/)).toBeDefined();
    expect(screen.getByText('categories')).toBeDefined();
    expect(screen.getAllByText(/users\./).length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('avatar_url')).toBeDefined();
    expect(screen.getByText('bio')).toBeDefined();
    expect(screen.getByText(/FK: posts/)).toBeDefined();
  });

  /**
   * @brief Verifies destructive change banner and badge when hasDestructive is true.
   */
  it('renders destructive warning badge and banner for dropped tables and columns', () => {
    render(
      <DiffModal
        isOpen={true}
        diff={mockDestructiveDiff}
        generatedDdl={['DROP TABLE legacy_logs;']}
        onClose={vi.fn()}
        onExecute={vi.fn()}
      />
    );

    expect(screen.getByText('Destructive Changes Detected')).toBeDefined();
    expect(
      screen.getByText(/Dropping tables\/columns or narrowing types permanently destroys data/)
    ).toBeDefined();
    expect(screen.getByText(/Drop Table:/)).toBeDefined();
    expect(screen.getByText('legacy_logs')).toBeDefined();
    expect(screen.getByText('deprecated_token')).toBeDefined();
    expect(screen.getByText(/\(Destructive\)/)).toBeDefined();
    expect(screen.getByText(/Drop FK:/)).toBeDefined();

    // Execution must be gated behind an explicit acknowledgement for destructive migrations.
    const executeBtn = screen.getByRole('button', {
      name: /Execute Migration/i,
    }) as HTMLButtonElement;
    expect(executeBtn.disabled).toBe(true);
    fireEvent.click(screen.getByRole('checkbox'));
    expect(executeBtn.disabled).toBe(false);
  });

  /**
   * @brief Verifies that non-destructive diffs do not display destructive warnings.
   */
  it('does not display destructive warnings when all changes are safe additions', () => {
    render(
      <DiffModal
        isOpen={true}
        diff={mockNonDestructiveDiff}
        generatedDdl={['CREATE TABLE categories;']}
        onClose={vi.fn()}
        onExecute={vi.fn()}
      />
    );

    expect(screen.queryByText('Destructive Changes Detected')).toBeNull();
    expect(
      screen.queryByText(
        /Dropping tables\/columns or narrowing types permanently destroys data/
      )
    ).toBeNull();
  });

  /**
   * @brief Verifies copying SQL script to clipboard.
   */
  it('copies SQL script to clipboard and displays Copied feedback', async () => {
    const writeTextMock = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText: writeTextMock },
      writable: true,
      configurable: true,
    });

    render(
      <DiffModal
        isOpen={true}
        diff={mockNonDestructiveDiff}
        generatedDdl={['CREATE TABLE categories (id INT);']}
        onClose={vi.fn()}
        onExecute={vi.fn()}
      />
    );

    const copyBtn = screen.getByRole('button', { name: /Copy/i });
    fireEvent.click(copyBtn);

    await waitFor(() => {
      expect(writeTextMock).toHaveBeenCalledWith('CREATE TABLE categories (id INT);');
      expect(screen.getByText('Copied')).toBeDefined();
    });
  });

  /**
   * @brief Verifies executing migration splits statements and triggers onExecute callback.
   */
  it('splits statements and executes migration when clicking Execute Migration', async () => {
    const handleExecute = vi.fn().mockResolvedValue(undefined);
    const handleClose = vi.fn();

    render(
      <DiffModal
        isOpen={true}
        diff={mockNonDestructiveDiff}
        generatedDdl={[
          'CREATE TABLE categories (id INT);',
          'ALTER TABLE users ADD COLUMN avatar_url VARCHAR(255);',
        ]}
        onClose={handleClose}
        onExecute={handleExecute}
      />
    );

    const executeBtn = screen.getByRole('button', { name: /Execute Migration/i });
    fireEvent.click(executeBtn);

    await waitFor(() => {
      expect(handleExecute).toHaveBeenCalledWith([
        'CREATE TABLE categories (id INT);',
        'ALTER TABLE users ADD COLUMN avatar_url VARCHAR(255);',
      ]);
      expect(handleClose).toHaveBeenCalledTimes(1);
    });
  });

  /**
   * @brief Verifies modifying SQL statements in editor passes the edited SQL to onExecute.
   */
  it('allows editing SQL script and passes edited statements to onExecute', async () => {
    const handleExecute = vi.fn().mockResolvedValue(undefined);
    const handleClose = vi.fn();

    render(
      <DiffModal
        isOpen={true}
        diff={mockNonDestructiveDiff}
        generatedDdl={['CREATE TABLE t1 (id INT);']}
        onClose={handleClose}
        onExecute={handleExecute}
      />
    );

    const editor = screen.getByTestId('monaco-editor');
    fireEvent.change(editor, {
      target: { value: 'CREATE TABLE t1 (id INT);\nCREATE TABLE t2 (id INT);' },
    });

    const executeBtn = screen.getByRole('button', { name: /Execute Migration/i });
    fireEvent.click(executeBtn);

    await waitFor(() => {
      expect(handleExecute).toHaveBeenCalledWith([
        'CREATE TABLE t1 (id INT);',
        'CREATE TABLE t2 (id INT);',
      ]);
      expect(handleClose).toHaveBeenCalled();
    });
  });

  /**
   * @brief Verifies cancel and close actions trigger onClose callback.
   */
  it('invokes onClose when clicking Cancel or Close X button', () => {
    const handleClose = vi.fn();

    render(
      <DiffModal
        isOpen={true}
        diff={mockNonDestructiveDiff}
        generatedDdl={['SELECT 1;']}
        onClose={handleClose}
        onExecute={vi.fn()}
      />
    );

    const cancelBtn = screen.getByRole('button', { name: 'Cancel' });
    fireEvent.click(cancelBtn);
    expect(handleClose).toHaveBeenCalledTimes(1);

    const closeBtn = screen.getByLabelText('Close migration modal');
    fireEvent.click(closeBtn);
    expect(handleClose).toHaveBeenCalledTimes(2);
  });
});
