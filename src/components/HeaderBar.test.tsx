/**
 * @file HeaderBar.test.tsx
 * @brief Unit tests for HeaderBar component tab navigation, connection telemetry, and theme switching.
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { HeaderBar } from './HeaderBar';
import type { ConnectionConfig } from '../types/database';

describe('HeaderBar component', () => {
  const mockConnection: ConnectionConfig = {
    id: 'c1',
    name: 'Production Cluster',
    db_type: 'Postgres',
    database: 'analytics',
    ssl: true,
  };

  /**
   * @brief Verifies rendering of title and navigation tabs.
   */
  it('renders application branding and navigation tabs', () => {
    render(
      <HeaderBar
        activeTab="erd"
        onSelectTab={vi.fn()}
        activeConnection={null}
        onOpenNewConnection={vi.fn()}
      />
    );

    expect(screen.getByText('DynoDbModeler')).toBeDefined();
    expect(screen.getByText('ERD Canvas')).toBeDefined();
    expect(screen.getByText('SQL Query')).toBeDefined();
    expect(screen.getByText('Settings')).toBeDefined();
  });

  /**
   * @brief Verifies tab switching callback invocation.
   */
  it('invokes onSelectTab when navigation tab buttons are clicked', () => {
    const handleSelectTab = vi.fn();
    render(
      <HeaderBar
        activeTab="erd"
        onSelectTab={handleSelectTab}
        activeConnection={null}
        onOpenNewConnection={vi.fn()}
      />
    );

    fireEvent.click(screen.getByText('SQL Query'));
    expect(handleSelectTab).toHaveBeenCalledWith('sql');

    fireEvent.click(screen.getByText('Settings'));
    expect(handleSelectTab).toHaveBeenCalledWith('settings');
  });

  /**
   * @brief Verifies rendering of active connection telemetry and disconnect trigger.
   */
  it('displays connection badge and handles disconnect callback when connected', () => {
    const handleDisconnect = vi.fn();
    render(
      <HeaderBar
        activeTab="erd"
        onSelectTab={vi.fn()}
        activeConnection={mockConnection}
        onDisconnect={handleDisconnect}
        onOpenNewConnection={vi.fn()}
      />
    );

    expect(screen.getByText('Production Cluster')).toBeDefined();
    expect(screen.getByText('Postgres')).toBeDefined();

    const disconnectBtn = screen.getByLabelText('Disconnect database');
    fireEvent.click(disconnectBtn);
    expect(handleDisconnect).toHaveBeenCalledTimes(1);
  });

  /**
   * @brief Verifies disconnected indicator and Connect trigger button when disconnected.
   */
  it('shows disconnected state and triggers onOpenNewConnection', () => {
    const handleOpenModal = vi.fn();
    render(
      <HeaderBar
        activeTab="erd"
        onSelectTab={vi.fn()}
        activeConnection={null}
        onOpenNewConnection={handleOpenModal}
      />
    );

    expect(screen.getByText('Disconnected')).toBeDefined();
    const connectBtn = screen.getByRole('button', { name: /Connect/i });
    fireEvent.click(connectBtn);
    expect(handleOpenModal).toHaveBeenCalledTimes(1);
  });

  /**
   * @brief Verifies Review & Sync button and change count badge when connected.
   */
  it('renders Review & Sync button and badge when connected and triggers onOpenDiff', () => {
    const handleOpenDiff = vi.fn();
    render(
      <HeaderBar
        activeTab="erd"
        onSelectTab={vi.fn()}
        activeConnection={mockConnection}
        onOpenNewConnection={vi.fn()}
        onOpenDiff={handleOpenDiff}
        pendingChangesCount={3}
      />
    );

    const diffBtn = screen.getByRole('button', { name: /Review & Sync/i });
    expect(diffBtn).toBeDefined();
    expect(screen.getByTestId('pending-changes-badge').textContent).toBe('3');

    fireEvent.click(diffBtn);
    expect(handleOpenDiff).toHaveBeenCalledTimes(1);
  });

  /**
   * @brief Verifies Processes button renders and triggers onOpenProcesses callback.
   */
  it('renders Processes button when connected and triggers onOpenProcesses callback', () => {
    const handleOpenProcesses = vi.fn();
    render(
      <HeaderBar
        activeTab="erd"
        onSelectTab={vi.fn()}
        activeConnection={mockConnection}
        onOpenNewConnection={vi.fn()}
        onOpenProcesses={handleOpenProcesses}
      />
    );

    const processesBtn = screen.getByTestId('header-processes-btn');
    expect(processesBtn).toBeDefined();

    fireEvent.click(processesBtn);
    expect(handleOpenProcesses).toHaveBeenCalledTimes(1);
  });

  /**
   * @brief Verifies theme switcher button renders and opens theme selector popover.
   */
  it('renders theme switcher button and toggles theme dropdown popover', () => {
    const handleSelectTheme = vi.fn();
    render(
      <HeaderBar
        activeTab="erd"
        onSelectTab={vi.fn()}
        activeConnection={null}
        onOpenNewConnection={vi.fn()}
        onSelectTheme={handleSelectTheme}
      />
    );

    const themeBtn = screen.getByTestId('header-theme-switcher-btn');
    expect(themeBtn).toBeDefined();

    // Dropdown is initially closed
    expect(screen.queryByTestId('header-theme-dropdown')).toBeNull();

    // Click to open dropdown
    fireEvent.click(themeBtn);
    expect(screen.getByTestId('header-theme-dropdown')).toBeDefined();
    expect(screen.getByText('GitIngest')).toBeDefined();
    expect(screen.getByText('GitHub Light')).toBeDefined();
    expect(screen.getByText('Midnight OLED')).toBeDefined();

    // Select GitIngest
    const gitingestOption = screen.getByTestId('theme-option-gitingest');
    fireEvent.click(gitingestOption);

    expect(handleSelectTheme).toHaveBeenCalledWith('gitingest');
    // Dropdown closes after selection
    expect(screen.queryByTestId('header-theme-dropdown')).toBeNull();
  });

  /**
   * @brief Verifies minimalist h-10 header container styling.
   */
  it('renders minimalist h-10 header container styling', () => {
    const { container } = render(
      <HeaderBar
        activeTab="erd"
        onSelectTab={vi.fn()}
        activeConnection={null}
        onOpenNewConnection={vi.fn()}
      />
    );

    const header = container.querySelector('header');
    expect(header).not.toBeNull();
    expect(header?.className).toContain('h-10');
    expect(header?.className).not.toContain('h-11');
  });

  /**
   * @brief Verifies sidebar toggle button rendering and interaction.
   */
  it('renders sidebar toggle button when onToggleSidebar is provided and triggers callback', () => {
    const handleToggleSidebar = vi.fn();
    render(
      <HeaderBar
        activeTab="erd"
        onSelectTab={vi.fn()}
        activeConnection={null}
        onOpenNewConnection={vi.fn()}
        onToggleSidebar={handleToggleSidebar}
      />
    );

    const toggleBtn = screen.getByTestId('header-sidebar-toggle-btn');
    expect(toggleBtn).toBeDefined();
    expect(toggleBtn.getAttribute('title')).toContain('Toggle Sidebar');

    fireEvent.click(toggleBtn);
    expect(handleToggleSidebar).toHaveBeenCalledTimes(1);
  });

  /**
   * @brief Verifies sidebar toggle button is omitted when onToggleSidebar is not passed.
   */
  it('omits sidebar toggle button when onToggleSidebar is not provided', () => {
    render(
      <HeaderBar
        activeTab="erd"
        onSelectTab={vi.fn()}
        activeConnection={null}
        onOpenNewConnection={vi.fn()}
      />
    );

    expect(screen.queryByTestId('header-sidebar-toggle-btn')).toBeNull();
  });

  /**
   * @brief Verifies emerald green micro-status dot rendering when database connection is active.
   */
  it('renders emerald green micro-status dot when database is connected', () => {
    render(
      <HeaderBar
        activeTab="erd"
        onSelectTab={vi.fn()}
        activeConnection={mockConnection}
        onOpenNewConnection={vi.fn()}
      />
    );

    const dot = screen.getByTestId('header-connection-status-dot');
    expect(dot).toBeDefined();
    expect(dot.className).toContain('bg-emerald-500');
    expect(dot.className).toContain('animate-pulse');
  });

  /**
   * @brief Verifies muted gray micro-status dot rendering when disconnected.
   */
  it('renders muted gray micro-status dot when disconnected', () => {
    render(
      <HeaderBar
        activeTab="erd"
        onSelectTab={vi.fn()}
        activeConnection={null}
        onOpenNewConnection={vi.fn()}
      />
    );

    const dot = screen.getByTestId('header-connection-status-dot');
    expect(dot).toBeDefined();
    expect(dot.className).toContain('bg-[#8c919a]');
    expect(dot.className).not.toContain('bg-emerald-500');
  });
});
