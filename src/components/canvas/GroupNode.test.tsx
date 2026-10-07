/**
 * @file GroupNode.test.tsx
 * @brief Unit tests for GroupNode component.
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { GroupNode, GroupNodeProps } from './GroupNode';

describe('GroupNode component', () => {
  const defaultProps: GroupNodeProps = {
    id: 'group-1',
    data: {
      id: 'group-1',
      label: 'Auth Domain',
      color: '#8b5cf6',
    },
    selected: false,
  };

  it('renders group label and border color', () => {
    render(<GroupNode {...defaultProps} />);

    expect(screen.getByText('Auth Domain')).toBeDefined();
    const node = screen.getByTestId('group-node');
    expect(['#8b5cf6', 'rgb(139, 92, 246)']).toContain(node.style.borderColor);
  });

  it('allows inline editing of group label on double click', () => {
    const onChangeLabel = vi.fn();
    render(
      <GroupNode
        {...defaultProps}
        data={{
          ...defaultProps.data,
          onChangeLabel,
        }}
      />
    );

    const labelSpan = screen.getByTestId('group-label');
    fireEvent.doubleClick(labelSpan);

    const input = screen.getByTestId('group-label-input') as HTMLInputElement;
    expect(input).toBeDefined();

    fireEvent.change(input, { target: { value: 'Identity & Access' } });
    fireEvent.blur(input);

    expect(onChangeLabel).toHaveBeenCalledWith('group-1', 'Identity & Access');
  });

  it('triggers onDelete callback when delete button is clicked', () => {
    const onDelete = vi.fn();
    render(
      <GroupNode
        {...defaultProps}
        data={{
          ...defaultProps.data,
          onDelete,
        }}
      />
    );

    const deleteBtn = screen.getByTestId('group-delete-btn');
    fireEvent.click(deleteBtn);

    expect(onDelete).toHaveBeenCalledWith('group-1');
  });
});
