/**
 * @file Sidebar.test.tsx
 * @brief Unit tests for Sidebar component navigation, filtering, and connection switching.
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
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
  it('filters tables based on search input', async () => {
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

    await waitFor(() => {
      expect(screen.queryByText('orders')).toBeNull();
    });
    expect(screen.getByText('users')).toBeDefined();
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

  /**
   * @brief Verifies active database dropdown switcher invokes onSwitchDatabase.
   */
  it('allows switching active database when serverDatabases are provided', () => {
    const handleSwitchDb = vi.fn();
    const handleRefreshDbs = vi.fn();

    render(
      <Sidebar
        connections={mockConnections}
        activeConnection={mockConnections[0]}
        tables={mockTables}
        serverDatabases={['app_prod', 'app_dev', 'postgres']}
        onSwitchDatabase={handleSwitchDb}
        onRefreshDatabases={handleRefreshDbs}
        onOpenNewConnection={vi.fn()}
        onSelectConnection={vi.fn()}
        onSelectTable={vi.fn()}
        onRefresh={vi.fn()}
      />
    );

    const dbSelect = screen.getByLabelText('Switch active database') as HTMLSelectElement;
    expect(dbSelect).toBeDefined();
    expect(dbSelect.value).toBe('app_prod');

    fireEvent.change(dbSelect, { target: { value: 'app_dev' } });
    expect(handleSwitchDb).toHaveBeenCalledWith('app_dev');

    const refreshDbsBtn = screen.getByLabelText('Refresh server databases');
    fireEvent.click(refreshDbsBtn);
    expect(handleRefreshDbs).toHaveBeenCalledTimes(1);
  });

  /**
   * @brief Verifies view table rows button invokes onViewTableData callback.
   */
  it('invokes onViewTableData when clicking view data action button on a table item', () => {
    const handleSelectTable = vi.fn();
    const handleViewTableData = vi.fn();
    render(
      <Sidebar
        connections={mockConnections}
        activeConnection={mockConnections[0]}
        tables={mockTables}
        onOpenNewConnection={vi.fn()}
        onSelectConnection={vi.fn()}
        onSelectTable={handleSelectTable}
        onRefresh={vi.fn()}
        onViewTableData={handleViewTableData}
      />
    );

    const viewBtn = screen.getByRole('button', { name: /view rows for users/i });
    expect(viewBtn).toBeDefined();
    fireEvent.click(viewBtn);

    expect(handleViewTableData).toHaveBeenCalledWith('users');
    expect(handleSelectTable).not.toHaveBeenCalled();
  });

  /**
   * @brief Verifies double-clicking a table item invokes onViewTableData callback.
   */
  it('invokes onViewTableData when double clicking a table item', () => {
    const handleViewTableData = vi.fn();
    render(
      <Sidebar
        connections={mockConnections}
        activeConnection={mockConnections[0]}
        tables={mockTables}
        onOpenNewConnection={vi.fn()}
        onSelectConnection={vi.fn()}
        onSelectTable={vi.fn()}
        onRefresh={vi.fn()}
        onViewTableData={handleViewTableData}
      />
    );

    const userItem = screen.getByText('users');
    fireEvent.doubleClick(userItem);
    expect(handleViewTableData).toHaveBeenCalledWith('users');
  });

  /**
   * @brief Verifies view rows button is not rendered when onViewTableData is undefined.
   */
  it('does not render view table rows button when onViewTableData is omitted', () => {
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

    expect(screen.queryByRole('button', { name: /view rows for users/i })).toBeNull();
  });
/**
   * @brief Verifies inspect table structure & DDL button triggers callback with table schema.
   */
  it('triggers onInspectTableStructure with table schema when inspect button is clicked', () => {
    const handleInspect = vi.fn();
    render(
      <Sidebar
        connections={mockConnections}
        activeConnection={mockConnections[0]}
        tables={mockTables}
        onOpenNewConnection={vi.fn()}
        onSelectConnection={vi.fn()}
        onSelectTable={vi.fn()}
        onRefresh={vi.fn()}
        onInspectTableStructure={handleInspect}
      />
    );

    const inspectBtn = screen.getByTestId('inspect-table-users');
    expect(inspectBtn).toBeDefined();

    fireEvent.click(inspectBtn);
    expect(handleInspect).toHaveBeenCalledWith(mockTables[0]);
  });

  /**
   * @brief Verifies clicking export ORM button in table row invokes onExportOrm with table name.
   */
  it('invokes onExportOrm when table row export ORM action button is clicked', () => {
    const handleExportOrm = vi.fn();
    render(
      <Sidebar
        connections={mockConnections}
        activeConnection={mockConnections[0]}
        tables={mockTables}
        onOpenNewConnection={vi.fn()}
        onSelectConnection={vi.fn()}
        onSelectTable={vi.fn()}
        onRefresh={vi.fn()}
        onExportOrm={handleExportOrm}
      />
    );

    const ormBtn = screen.getByTestId('export-orm-users');
    expect(ormBtn).toBeDefined();

    fireEvent.click(ormBtn);
    expect(handleExportOrm).toHaveBeenCalledWith('users');
  });

  /**
   * @brief Verifies clicking import data button in table row invokes onImportData with table name.
   */
  it('invokes onImportData when table row import data action button is clicked', () => {
    const handleImportData = vi.fn();
    render(
      <Sidebar
        connections={mockConnections}
        activeConnection={mockConnections[0]}
        tables={mockTables}
        onOpenNewConnection={vi.fn()}
        onSelectConnection={vi.fn()}
        onSelectTable={vi.fn()}
        onRefresh={vi.fn()}
        onImportData={handleImportData}
      />
    );

    const importBtn = screen.getByTestId('import-data-users');
    expect(importBtn).toBeDefined();

    fireEvent.click(importBtn);
    expect(handleImportData).toHaveBeenCalledWith('users');
  });

  /**
   * @brief Verifies default expanded mode layout with 256px width and search bar.
   */
  it('renders 256px width, search bar, and full table tree in expanded mode by default', () => {
    render(
      <Sidebar
        connections={mockConnections}
        activeConnection={mockConnections[0]}
        tables={mockTables}
        onOpenNewConnection={vi.fn()}
        onSelectConnection={vi.fn()}
        onSelectTable={vi.fn()}
        onRefresh={vi.fn()}
        mode="expanded"
      />
    );

    const aside = screen.getByRole('complementary', { name: 'Database Sidebar' });
    expect(aside.className).toContain('w-64');
    expect(screen.getByPlaceholderText('Filter tables...')).toBeDefined();
    expect(screen.getByText('users')).toBeDefined();
    expect(screen.getByText('orders')).toBeDefined();
  });

  /**
   * @brief Verifies collapse button triggers onToggleMode with rail mode.
   */
  it('renders collapse button in expanded mode and invokes onToggleMode with rail', () => {
    const handleToggleMode = vi.fn();
    render(
      <Sidebar
        connections={mockConnections}
        activeConnection={mockConnections[0]}
        tables={mockTables}
        onOpenNewConnection={vi.fn()}
        onSelectConnection={vi.fn()}
        onSelectTable={vi.fn()}
        onRefresh={vi.fn()}
        mode="expanded"
        onToggleMode={handleToggleMode}
      />
    );

    const collapseBtn = screen.getByRole('button', { name: /collapse sidebar/i });
    expect(collapseBtn).toBeDefined();
    fireEvent.click(collapseBtn);
    expect(handleToggleMode).toHaveBeenCalledWith('rail');
  });

  /**
   * @brief Verifies compact 48px rail mode layout with micro action icons.
   */
  it('renders compact 48px rail with micro icons in rail mode', () => {
    render(
      <Sidebar
        connections={mockConnections}
        activeConnection={mockConnections[0]}
        tables={mockTables}
        onOpenNewConnection={vi.fn()}
        onSelectConnection={vi.fn()}
        onSelectTable={vi.fn()}
        onRefresh={vi.fn()}
        mode="rail"
      />
    );

    const aside = screen.getByRole('complementary', { name: 'Database Sidebar' });
    expect(aside.className).toContain('w-12');
    expect(screen.queryByPlaceholderText('Filter tables...')).toBeNull();
    expect(screen.queryByText('users')).toBeNull();
    expect(screen.getByRole('button', { name: /search tables/i })).toBeDefined();
    expect(screen.getByRole('button', { name: /refresh schema/i })).toBeDefined();
    expect(screen.getByRole('button', { name: /expand sidebar/i })).toBeDefined();
  });

  /**
   * @brief Verifies clicking expand or search buttons in rail mode calls onToggleMode with expanded.
   */
  it('invokes onToggleMode with expanded when expand or search button is clicked in rail mode', () => {
    const handleToggleMode = vi.fn();
    render(
      <Sidebar
        connections={mockConnections}
        activeConnection={mockConnections[0]}
        tables={mockTables}
        onOpenNewConnection={vi.fn()}
        onSelectConnection={vi.fn()}
        onSelectTable={vi.fn()}
        onRefresh={vi.fn()}
        mode="rail"
        onToggleMode={handleToggleMode}
      />
    );

    const expandBtn = screen.getByRole('button', { name: /expand sidebar/i });
    fireEvent.click(expandBtn);
    expect(handleToggleMode).toHaveBeenCalledWith('expanded');

    const searchBtn = screen.getByRole('button', { name: /search tables/i });
    fireEvent.click(searchBtn);
    expect(handleToggleMode).toHaveBeenCalledWith('expanded');
  });

  /**
   * @brief Verifies refresh button in rail mode invokes onRefresh.
   */
  it('invokes onRefresh when refresh button is clicked in rail mode', () => {
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
        mode="rail"
      />
    );

    const refreshBtn = screen.getByRole('button', { name: /refresh schema/i });
    fireEvent.click(refreshBtn);
    expect(handleRefresh).toHaveBeenCalledTimes(1);
  });

  /**
   * @brief Verifies zen mode renders 0px width or display none container.
   */
  it('renders 0px or hidden element in zen mode', () => {
    const { container } = render(
      <Sidebar
        connections={mockConnections}
        activeConnection={mockConnections[0]}
        tables={mockTables}
        onOpenNewConnection={vi.fn()}
        onSelectConnection={vi.fn()}
        onSelectTable={vi.fn()}
        onRefresh={vi.fn()}
        mode="zen"
      />
    );

    const aside = container.querySelector('aside');
    expect(aside).not.toBeNull();
    expect(aside?.className).toContain('w-0');
    expect(aside?.className).toContain('hidden');
    expect(aside?.style.display).toBe('none');
    expect(screen.queryByPlaceholderText('Filter tables...')).toBeNull();
  });

  /**
   * @brief Verifies debouncing of table search filter input.
   */
  it('debounces table search input by 150ms before updating filtered list', async () => {
    render(
      <Sidebar
        connections={mockConnections}
        activeConnection={mockConnections[0]}
        tables={mockTables}
        onOpenNewConnection={vi.fn()}
        onSelectConnection={vi.fn()}
        onSelectTable={vi.fn()}
        onRefresh={vi.fn()}
        debounceMs={150}
      />
    );

    const searchInput = screen.getByPlaceholderText('Filter tables...');
    fireEvent.change(searchInput, { target: { value: 'user' } });

    // Immediately after typing, debounced value has not yet updated
    expect(screen.getByText('users')).toBeDefined();
    expect(screen.getByText('orders')).toBeDefined();

    // After debounce interval, orders is filtered out
    await waitFor(() => {
      expect(screen.queryByText('orders')).toBeNull();
    });
    expect(screen.getByText('users')).toBeDefined();
  });
});
