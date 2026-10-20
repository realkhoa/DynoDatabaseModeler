/**
 * @file TableNode.test.tsx
 * @brief Unit tests for TableNode React Flow custom component.
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ReactFlowProvider } from '@xyflow/react';
import { TableNode, TableNodeData } from './TableNode';
import type { ColumnSchema, ForeignKeySchema } from '../../types/database';

describe('TableNode component', () => {
  const sampleColumns: ColumnSchema[] = [
    {
      name: 'id',
      data_type: 'Integer',
      is_primary_key: true,
      is_nullable: false,
      is_auto_increment: true,
    },
    {
      name: 'user_id',
      data_type: 'BigInt',
      is_primary_key: false,
      is_nullable: false,
      is_auto_increment: false,
    },
    {
      name: 'bio',
      data_type: 'Text',
      is_primary_key: false,
      is_nullable: true,
      is_auto_increment: false,
    },
  ];

  const sampleForeignKeys: ForeignKeySchema[] = [
    {
      constraint_name: 'fk_profiles_user',
      source_column: 'user_id',
      target_table: 'users',
      target_column: 'id',
      on_delete: 'Cascade',
      on_update: 'Cascade',
    },
  ];

  /**
   * @brief Helper to render TableNode inside a ReactFlowProvider with optional data overrides.
   * @param dataOverrides Partial TableNodeData properties to merge over default test props.
   * @return Render result and assembled TableNodeData.
   */
  const renderTableNode = (dataOverrides?: Partial<TableNodeData>) => {
    const data: TableNodeData = {
      label: 'profiles',
      columns: sampleColumns,
      foreignKeys: sampleForeignKeys,
      onEdit: vi.fn(),
      ...dataOverrides,
    };

    return {
      ...render(
        <ReactFlowProvider>
          <TableNode id="profiles-node" type="tableNode" data={data} />
        </ReactFlowProvider>
      ),
      data,
    };
  };

  /**
   * @brief Verifies rendering of table title and column counter badge.
   */
  it('renders table title and column count badge', () => {
    renderTableNode();

    expect(screen.getByText('profiles')).toBeDefined();
    expect(screen.getByText('3')).toBeDefined();
  });

  /**
   * @brief Verifies rendering of all column rows and types.
   */
  it('renders column names and formatted data types', () => {
    renderTableNode();

    expect(screen.getByText('id')).toBeDefined();
    expect(screen.getByText('user_id')).toBeDefined();
    expect(screen.getByText('bio')).toBeDefined();

    expect(screen.getByText('INTEGER')).toBeDefined();
    expect(screen.getByText('BIGINT')).toBeDefined();
    expect(screen.getByText('TEXT')).toBeDefined();
  });

  /**
   * @brief Verifies primary key and foreign key icons are rendered.
   */
  it('renders PK key icon and FK link icon', () => {
    renderTableNode();

    expect(screen.getByTestId('pk-icon-id')).toBeDefined();
    expect(screen.getByTestId('fk-icon-user_id')).toBeDefined();
  });

  /**
   * @brief Verifies NOT NULL (NN) indicator badge for non-nullable columns.
   */
  it('renders NN badge for non-nullable columns only', () => {
    renderTableNode();

    // 2 non-nullable columns: id, user_id
    const nnBadges = screen.getAllByText('NN');
    expect(nnBadges).toHaveLength(2);
  });

  /**
   * @brief Verifies double-click on table header triggers onEdit callback.
   */
  it('triggers onEdit callback on header double-click', () => {
    const onEdit = vi.fn();
    renderTableNode({ onEdit });

    const header = screen.getByText('profiles');
    fireEvent.doubleClick(header);

    expect(onEdit).toHaveBeenCalledWith('profiles');
  });

  /**
   * @brief Verifies that clicking the view data eye icon button triggers onViewData with tableKey.
   */
  it('triggers onViewData callback when clicking the view data eye icon button', () => {
    const onViewData = vi.fn();
    renderTableNode({
      schema: 'public',
      onViewData,
    });

    const viewDataBtn = screen.getByRole('button', { name: /view table rows/i });
    expect(viewDataBtn).toBeDefined();
    fireEvent.click(viewDataBtn);
    expect(onViewData).toHaveBeenCalledWith('public.profiles');
  });

  /**
   * @brief Verifies onViewData falls back to table label when schema is absent.
   */
  it('triggers onViewData with table label only when schema is absent', () => {
    const onViewData = vi.fn();
    renderTableNode({
      schema: undefined,
      onViewData,
    });

    const viewDataBtn = screen.getByRole('button', { name: /view table rows/i });
    fireEvent.click(viewDataBtn);
    expect(onViewData).toHaveBeenCalledWith('profiles');
  });

  /**
   * @brief Verifies view data button is not rendered if onViewData callback is not provided.
   */
  it('does not render view data button when onViewData is undefined', () => {
    renderTableNode({ onViewData: undefined });
    expect(screen.queryByRole('button', { name: /view table rows/i })).toBeNull();
  });
});
