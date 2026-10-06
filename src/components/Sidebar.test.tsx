/**
 * @file Sidebar.test.tsx
 * @brief Unit tests for Sidebar component navigation, filtering, and connection switching.
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { Sidebar } from './Sidebar';
import type { ConnectionConfig, TableSchema } from '../types/database';

describe('Sidebar component', () => {
  const mockConnections: ConnectionConfig[] = [
    {
      id: 'conn-1',
      name: 'Primary Postgres',
      db_type: 'Postgres',
      host: 'localhost',
      port: 5432,
      database: 'app_prod',
      ssl: false,
    },
    {
      id: 'conn-2',
      name: 'Dev SQLite',
      db_type: 'Sqlite',
      database: 'local.db',
      ssl: false,
    },
  ];

  const mockTables: TableSchema[] = [
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
      name: 'orders',
      columns: [
        {
          name: 'id',
          data_type: 'Integer',
          is_primary_key: true,
          is_nullable: false,
          is_auto_increment: true,
        },
      ],
      foreign_keys: [],
      indexes: [],
    },
  ];

  /**
   * @brief Verifies rendering of active connection details and tables.
   */
  it('renders active connection and lists all tables with column counts', () => {
    render(
      <Sidebar
        connections={mockConnections}
        activeConnection={mockConnections[0]}
        tables={mockTables}
        onOpenNewConnection={vi.fn()}
        onSelectConnection={vi.fn()}
        onSelectTable={vi.fn()}
        onRefresh={vi.fn()}
      />
    );

    expect(screen.getByText('Primary Postgres')).toBeDefined();
    expect(screen.getByText('users')).toBeDefined();
    expect(screen.getByText('orders')).toBeDefined();
    expect(screen.getByText('2')).toBeDefined(); // users has 2 columns
    expect(screen.getByText('1')).toBeDefined(); // orders has 1 column
  });

  /**
   * @brief Verifies table search filter functionality.
   */
  it('filters tables based on search input', () => {
    render(
      <Sidebar
        connections={mockConnections}
        activeConnection={mockConnections[0]}
        tables={mockTables}
        onOpenNewConnection={vi.fn()}
        onSelectConnection={vi.fn()}
        onSelectTable={vi.fn()}
        onRefresh={vi.fn()}
      />
    );

    const searchInput = screen.getByPlaceholderText('Filter tables...');
    fireEvent.change(searchInput, { target: { value: 'user' } });

    expect(screen.getByText('users')).toBeDefined();
    expect(screen.queryByText('orders')).toBeNull();
  });

  /**
   * @brief Verifies table selection callback.
   */
  it('invokes onSelectTable when a table item is clicked', () => {
    const handleSelectTable = vi.fn();
    render(
      <Sidebar
        connections={mockConnections}
        activeConnection={mockConnections[0]}
        tables={mockTables}
        onOpenNewConnection={vi.fn()}
        onSelectConnection={vi.fn()}
        onSelectTable={handleSelectTable}
        onRefresh={vi.fn()}
      />
    );

    fireEvent.click(screen.getByText('users'));
    expect(handleSelectTable).toHaveBeenCalledWith('users');
  });

  /**
   * @brief Verifies refresh action button triggers onRefresh callback.
   */
  it('triggers onRefresh when refresh button is clicked', () => {
    const handleRefresh = vi.fn();
    render(
      <Sidebar
        connections={mockConnections}
        activeConnection={mockConnections[0]}
        tables={mockTables}
        onOpenNewConnection={vi.fn()}
        onSelectConnection={vi.fn()}
        onSelectTable={vi.fn()}
        onRefresh={handleRefresh}
      />
    );

    const refreshButton = screen.getByLabelText('Refresh Schema');
    fireEvent.click(refreshButton);
    expect(handleRefresh).toHaveBeenCalledTimes(1);
  });

  /**
   * @brief Verifies connection switcher dropdown allows switching connections.
   */
  it('opens connection dropdown and switches connection', () => {
    const handleSelectConn = vi.fn();
    render(
      <Sidebar
        connections={mockConnections}
        activeConnection={mockConnections[0]}
        tables={mockTables}
        onOpenNewConnection={vi.fn()}
        onSelectConnection={handleSelectConn}
        onSelectTable={vi.fn()}
        onRefresh={vi.fn()}
      />
    );

    const switchBtn = screen.getByTitle('Switch database connection');
    fireEvent.click(switchBtn);

    expect(screen.getByText('Saved Connections (2)')).toBeDefined();
    const devSqliteOption = screen.getByText('Dev SQLite');
    fireEvent.click(devSqliteOption);

    expect(handleSelectConn).toHaveBeenCalledWith(mockConnections[1]);
  });
});
