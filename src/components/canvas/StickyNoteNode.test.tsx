/**
 * @file StickyNoteNode.test.tsx
 * @brief Unit tests for StickyNoteNode component.
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { StickyNoteNode, StickyNoteNodeProps } from './StickyNoteNode';

describe('StickyNoteNode component', () => {
  const defaultProps: StickyNoteNodeProps = {
    id: 'note-1',
    data: {
      id: 'note-1',
      title: 'Architecture Decision',
      text: 'Partition orders table by created_at',
      color: 'yellow',
    },
    selected: false,
  };

  it('renders title and note content', () => {
    render(<StickyNoteNode {...defaultProps} />);

    expect(screen.getByText('Architecture Decision')).toBeDefined();
    expect(screen.getByText('Partition orders table by created_at')).toBeDefined();
  });

  it('switches to edit mode on double click and calls onChangeText on blur', () => {
    const onChangeText = vi.fn();
    render(
      <StickyNoteNode
        {...defaultProps}
        data={{
          ...defaultProps.data,
          onChangeText,
        }}
      />
    );

    const content = screen.getByTestId('sticky-note-content');
    fireEvent.doubleClick(content);

    const textarea = screen.getByTestId('sticky-note-textarea') as HTMLTextAreaElement;
    expect(textarea).toBeDefined();

    fireEvent.change(textarea, { target: { value: 'Updated note message' } });
    fireEvent.blur(textarea);

    expect(onChangeText).toHaveBeenCalledWith('note-1', 'Updated note message');
  });

  it('allows picking a new color from color picker palette', () => {
    const onChangeColor = vi.fn();
    render(
      <StickyNoteNode
        {...defaultProps}
        data={{
          ...defaultProps.data,
          onChangeColor,
        }}
      />
    );

    const colorPickerBtn = screen.getByTestId('sticky-note-color-picker-btn');
    fireEvent.click(colorPickerBtn);

    const blueSwatch = screen.getByTestId('color-swatch-blue');
    fireEvent.click(blueSwatch);

    expect(onChangeColor).toHaveBeenCalledWith('note-1', 'blue');
  });

  it('invokes onDelete when delete button is clicked', () => {
    const onDelete = vi.fn();
    render(
      <StickyNoteNode
        {...defaultProps}
        data={{
          ...defaultProps.data,
          onDelete,
        }}
      />
    );

    const deleteBtn = screen.getByTestId('sticky-note-delete-btn');
    fireEvent.click(deleteBtn);

    expect(onDelete).toHaveBeenCalledWith('note-1');
  });
});
