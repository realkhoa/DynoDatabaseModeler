/**
 * @file ExplainPlanModal.test.tsx
 * @brief Unit tests for ExplainPlanModal component.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ExplainPlanModal, ExplainPlanModalProps } from './ExplainPlanModal';
import type { ExecutionPlanNode } from '../../types/database';

describe('ExplainPlanModal component', () => {
  const mockPlan: ExecutionPlanNode = {
    node_type: 'Nested Loop',
    cost: 150.0,
    rows: 50,
    actual_time_ms: 2.45,
    children: [
      {
        node_type: 'Seq Scan',
        relation_name: 'users',
        cost: 120.0,
        rows: 100,
        detail: 'Filter: (age > 25)',
        children: [],
      },
      {
        node_type: 'Index Scan',
        relation_name: 'orders',
        cost: 15.0,
        rows: 1,
        detail: 'Index Cond: (user_id = users.id)',
        children: [],
      },
    ],
  };

  const defaultProps: ExplainPlanModalProps = {
    isOpen: true,
    onClose: vi.fn(),
    query: 'SELECT * FROM users JOIN orders ON users.id = orders.user_id WHERE users.age > 25;',
    plan: mockPlan,
    isLoading: false,
    error: null,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    Object.defineProperty(navigator, 'clipboard', {
      value: {
        writeText: vi.fn().mockResolvedValue(undefined),
      },
      configurable: true,
      writable: true,
    });
  });

  it('does not render when isOpen is false', () => {
    render(<ExplainPlanModal {...defaultProps} isOpen={false} />);
    expect(screen.queryByTestId('explain-plan-modal')).toBeNull();
  });

  it('renders modal header, query snippet, and execution plan tree', () => {
    render(<ExplainPlanModal {...defaultProps} />);

    expect(screen.getByTestId('explain-plan-modal')).toBeDefined();
    expect(screen.getByText(/Execution Plan Analyzer/i)).toBeDefined();
    expect(screen.getByText('Nested Loop')).toBeDefined();
    expect(screen.getByText('Seq Scan')).toBeDefined();
    expect(screen.getByText('users')).toBeDefined();
    expect(screen.getByText('orders')).toBeDefined();
  });

  it('highlights costly table scan bottleneck with badge', () => {
    render(<ExplainPlanModal {...defaultProps} />);

    const badges = screen.getAllByTestId('explain-bottleneck-badge');
    expect(badges.length).toBeGreaterThan(0);
  });

  it('renders loading state when isLoading is true', () => {
    render(<ExplainPlanModal {...defaultProps} isLoading={true} plan={null} />);

    expect(screen.getByText(/Analyzing query plan.../i)).toBeDefined();
  });

  it('renders error message when error is provided', () => {
    render(
      <ExplainPlanModal
        {...defaultProps}
        error="Syntax error in SQL near JOIN"
        plan={null}
      />
    );

    expect(screen.getByText(/Execution Plan Analysis Failed/i)).toBeDefined();
    expect(screen.getByText(/Syntax error in SQL near JOIN/i)).toBeDefined();
  });

  it('copies plan JSON to clipboard on button click', () => {
    render(<ExplainPlanModal {...defaultProps} />);

    const copyBtn = screen.getByTestId('explain-copy-btn');
    fireEvent.click(copyBtn);

    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(
      JSON.stringify(mockPlan, null, 2)
    );
    expect(screen.getByText('Copied')).toBeDefined();
  });

  it('triggers onClose when close button is clicked', () => {
    const onClose = vi.fn();
    render(<ExplainPlanModal {...defaultProps} onClose={onClose} />);

    const closeBtn = screen.getByTestId('explain-close-btn');
    fireEvent.click(closeBtn);

    expect(onClose).toHaveBeenCalled();
  });
});
