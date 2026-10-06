/**
 * @file HeaderBar.test.tsx
 * @brief Unit tests for HeaderBar component tab navigation and connection telemetry status.
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
});

