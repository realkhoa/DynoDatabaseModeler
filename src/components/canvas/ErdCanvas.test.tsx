/**
 * @file ErdCanvas.test.tsx
 * @brief Unit tests for ErdCanvas React Flow diagram component.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ErdCanvas } from './ErdCanvas';
import type { DatabaseSchema } from '../../types/database';
import {
  exportSchemaAsJson,
  exportErdAsSvg,
  exportErdAsPng,
} from '../../utils/export';

vi.mock('../../utils/export', () => ({
  exportSchemaAsJson: vi.fn(),
  exportErdAsSvg: vi.fn(),
  exportErdAsPng: vi.fn().mockResolvedValue(undefined),
}));

// Mock ResizeObserver for happy-dom testing environment
if (typeof window !== 'undefined' && !window.ResizeObserver) {
  window.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
}

describe('ErdCanvas component', () => {
  const mockSchema: DatabaseSchema = {
    database_name: 'shop_db',
    tables: [
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
            name: 'user_id',
            data_type: 'Integer',
            is_primary_key: false,
            is_nullable: false,
            is_auto_increment: false,
          },
        ],
        foreign_keys: [
          {
            constraint_name: 'fk_orders_user',
            source_column: 'user_id',
            target_table: 'users',
            target_column: 'id',
            on_delete: 'Cascade',
            on_update: 'Cascade',
          },
        ],
        indexes: [],
      },
    ],
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  /**
   * @brief Verifies canvas renders toolbar controls and table names.
   */
  it('renders canvas toolbar with auto layout and add table buttons', () => {
    render(<ErdCanvas schema={mockSchema} onEditTable={vi.fn()} />);

    expect(screen.getByRole('button', { name: /Auto Layout/i })).toBeDefined();
    expect(screen.getByText('users')).toBeDefined();
    expect(screen.getByText('orders')).toBeDefined();
  });

  /**
   * @brief Verifies clicking auto-layout triggers Dagre layout algorithm.
   */
  it('executes auto layout when clicking the Auto Layout button', () => {
    render(<ErdCanvas schema={mockSchema} onEditTable={vi.fn()} />);

    const autoLayoutBtn = screen.getByRole('button', { name: /Auto Layout/i });
    fireEvent.click(autoLayoutBtn);

    // Nodes still exist and are rendered cleanly
    expect(screen.getByText('users')).toBeDefined();
    expect(screen.getByText('orders')).toBeDefined();
  });

  /**
   * @brief Verifies add table trigger callback from canvas toolbar.
   */
  it('triggers onAddNewTable when Add Table button is clicked', () => {
    const onAddNewTable = vi.fn();
    render(
      <ErdCanvas
        schema={mockSchema}
        onEditTable={vi.fn()}
        onAddNewTable={onAddNewTable}
      />
    );

    const addTableBtn = screen.getByRole('button', { name: /Add Table/i });
    fireEvent.click(addTableBtn);

    expect(onAddNewTable).toHaveBeenCalled();
  });

  /**
   * @brief Verifies double clicking table header invokes onEditTable callback.
   */
  it('invokes onEditTable when double-clicking table node header', () => {
    const onEditTable = vi.fn();
    render(<ErdCanvas schema={mockSchema} onEditTable={onEditTable} />);

    const usersHeader = screen.getByText('users');
    fireEvent.doubleClick(usersHeader);

    expect(onEditTable).toHaveBeenCalledWith('users');
  });

  /**
   * @brief Verifies Review & Sync trigger button and change badge on canvas toolbar.
   */
  it('triggers onOpenDiff when Review & Sync button is clicked on canvas toolbar', () => {
    const onOpenDiff = vi.fn();
    render(
      <ErdCanvas
        schema={mockSchema}
        onEditTable={vi.fn()}
        onOpenDiff={onOpenDiff}
        pendingChangesCount={4}
      />
    );

    const syncBtn = screen.getByRole('button', { name: /Review & Sync/i });
    expect(syncBtn).toBeDefined();
    expect(screen.getByTestId('canvas-pending-changes-badge').textContent).toBe('4');

    fireEvent.click(syncBtn);
    expect(onOpenDiff).toHaveBeenCalledTimes(1);
  });

  /**
   * @brief Verifies export dropdown toggling and export action triggers.
   */
  it('opens export menu and triggers export utilities for JSON, SVG, and PNG', async () => {
    render(<ErdCanvas schema={mockSchema} onEditTable={vi.fn()} />);

    // Click Export dropdown button
    const exportBtn = screen.getByTestId('export-dropdown-button');
    fireEvent.click(exportBtn);

    expect(screen.getByTestId('export-menu')).toBeDefined();

    // Click Export JSON
    const exportJsonBtn = screen.getByTestId('export-json-btn');
    fireEvent.click(exportJsonBtn);
    expect(exportSchemaAsJson).toHaveBeenCalledWith(mockSchema);

    // Re-open menu and click Export SVG
    fireEvent.click(exportBtn);
    const exportSvgBtn = screen.getByTestId('export-svg-btn');
    fireEvent.click(exportSvgBtn);
    expect(exportErdAsSvg).toHaveBeenCalled();

    // Re-open menu and click Export PNG
    fireEvent.click(exportBtn);
    const exportPngBtn = screen.getByTestId('export-png-btn');
    fireEvent.click(exportPngBtn);
    expect(exportErdAsPng).toHaveBeenCalled();
  });
});


