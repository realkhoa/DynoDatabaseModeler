/**
 * @file QueryWorksheetBar.test.tsx
 * @brief Unit test suite for QueryWorksheetBar component.
 * @details Validates tab rendering, active styling, tab switching, new tab addition,
 * tab closure, and inline double-click renaming interactions.
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import {
  QueryWorksheetBar,
  type QueryWorksheet,
  type QueryWorksheetBarProps,
} from './QueryWorksheetBar';

/**
 * @brief Helper factory to construct mock QueryWorksheet test entities.
 * @param overrides Partial properties to customize worksheet defaults.
 * @return Fully initialized QueryWorksheet test object.
 */
function createMockWorksheet(overrides: Partial<QueryWorksheet> = {}): QueryWorksheet {
  return {
    id: 'ws-1',
    title: 'Query 1',
    query: 'SELECT 1;',
    result: null,
    safeLimit: 500,
    safeLimitNotice: null,
    pageIndex: 0,
    pageSize: 50,
    totalRows: null,
    error: null,
    explainPlan: null,
    ...overrides,
  };
}

/**
 * @brief Helper to render QueryWorksheetBar with default stubbed handlers.
 * @param props Optional overrides for QueryWorksheetBarProps.
 * @return Testing library render result with handlers bag.
 */
function renderBar(props: Partial<QueryWorksheetBarProps> = {}) {
  const mockWorksheets = [
    createMockWorksheet({ id: 'ws-1', title: 'Query 1' }),
    createMockWorksheet({ id: 'ws-2', title: 'users', query: 'SELECT * FROM users;' }),
  ];

  const defaultProps: QueryWorksheetBarProps = {
    worksheets: mockWorksheets,
    activeId: 'ws-1',
    onSelect: vi.fn(),
    onAdd: vi.fn(),
    onClose: vi.fn(),
    onRename: vi.fn(),
  };

  const finalProps = { ...defaultProps, ...props };
  const view = render(<QueryWorksheetBar {...finalProps} />);
  return { ...view, props: finalProps };
}

describe('QueryWorksheetBar component', () => {
  it('renders worksheet tabs and highlights active tab', () => {
    renderBar();

    expect(screen.getByText('Query 1')).toBeDefined();
    expect(screen.getByText('users')).toBeDefined();

    const activeTab = screen.getByRole('tab', { name: /Query 1/i });
    expect(activeTab.getAttribute('aria-selected')).toBe('true');

    const inactiveTab = screen.getByRole('tab', { name: /users/i });
    expect(inactiveTab.getAttribute('aria-selected')).toBe('false');
  });

  it('triggers onSelect when tab is clicked', () => {
    const onSelect = vi.fn();
    renderBar({ onSelect });

    fireEvent.click(screen.getByText('users'));
    expect(onSelect).toHaveBeenCalledWith('ws-2');
  });

  it('triggers onAdd when + button is clicked', () => {
    const onAdd = vi.fn();
    renderBar({ onAdd });

    fireEvent.click(screen.getByTestId('add-worksheet-btn'));
    expect(onAdd).toHaveBeenCalledTimes(1);
  });

  it('triggers onClose when close button is clicked without selecting tab', () => {
    const onClose = vi.fn();
    const onSelect = vi.fn();
    renderBar({ onClose, onSelect });

    const closeButtons = screen.getAllByTestId('close-worksheet-btn');
    expect(closeButtons.length).toBe(2);

    fireEvent.click(closeButtons[1]);
    expect(onClose).toHaveBeenCalledWith('ws-2');
    expect(onSelect).not.toHaveBeenCalled();
  });

  it('does not render close buttons when only one worksheet exists', () => {
    renderBar({
      worksheets: [createMockWorksheet({ id: 'ws-1', title: 'Single Tab' })],
    });

    expect(screen.queryByTestId('close-worksheet-btn')).toBeNull();
  });

  it('allows inline renaming on double click committing on Enter', () => {
    const onRename = vi.fn();
    renderBar({ onRename });

    fireEvent.doubleClick(screen.getByText('Query 1'));
    const input = screen.getByDisplayValue('Query 1') as HTMLInputElement;
    expect(input).toBeDefined();

    fireEvent.change(input, { target: { value: 'My Report' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    expect(onRename).toHaveBeenCalledWith('ws-1', 'My Report');
  });

  it('allows inline renaming on double click committing on blur', () => {
    const onRename = vi.fn();
    renderBar({ onRename });

    fireEvent.doubleClick(screen.getByText('users'));
    const input = screen.getByDisplayValue('users') as HTMLInputElement;

    fireEvent.change(input, { target: { value: 'All Users' } });
    fireEvent.blur(input);

    expect(onRename).toHaveBeenCalledWith('ws-2', 'All Users');
  });

  it('cancels inline renaming when pressing Escape', () => {
    const onRename = vi.fn();
    renderBar({ onRename });

    fireEvent.doubleClick(screen.getByText('Query 1'));
    const input = screen.getByDisplayValue('Query 1') as HTMLInputElement;

    fireEvent.change(input, { target: { value: 'Discarded Name' } });
    fireEvent.keyDown(input, { key: 'Escape' });

    expect(onRename).not.toHaveBeenCalled();
    expect(screen.queryByDisplayValue('Discarded Name')).toBeNull();
    expect(screen.getByText('Query 1')).toBeDefined();
  });

  it('ignores rename if submitted with whitespace or identical name', () => {
    const onRename = vi.fn();
    renderBar({ onRename });

    fireEvent.doubleClick(screen.getByText('Query 1'));
    let input = screen.getByDisplayValue('Query 1') as HTMLInputElement;

    fireEvent.change(input, { target: { value: '   ' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onRename).not.toHaveBeenCalled();

    fireEvent.doubleClick(screen.getByText('Query 1'));
    input = screen.getByDisplayValue('Query 1') as HTMLInputElement;
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onRename).not.toHaveBeenCalled();
  });

  it('supports selecting tabs using keyboard Enter and Space keys', () => {
    const onSelect = vi.fn();
    renderBar({ onSelect });

    const inactiveTab = screen.getByRole('tab', { name: /users/i });
    fireEvent.keyDown(inactiveTab, { key: 'Enter' });
    expect(onSelect).toHaveBeenCalledWith('ws-2');

    onSelect.mockClear();
    fireEvent.keyDown(inactiveTab, { key: ' ' });
    expect(onSelect).toHaveBeenCalledWith('ws-2');
  });
});
