/**
 * @file ExportModal.test.tsx
 * @brief Unit tests for ExportModal component.
 * @details Validates format selector tabs (CSV, JSON, Markdown, SQL),
 * real-time preview updating on options change, clipboard copy with feedback,
 * file download trigger, and modal dismiss actions (close button and Escape key).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ExportModal } from './ExportModal';
import * as dataTransferModule from '../../utils/dataTransfer';

describe('ExportModal component', () => {
  const sampleColumns = ['id', 'name', 'status'];
  const sampleRows = [
    [1, 'Alice', 'active'],
    [2, 'Bob', 'pending'],
  ];

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

  it('renders nothing when isOpen is false', () => {
    const { container } = render(
      <ExportModal
        isOpen={false}
        tableName="users"
        columns={sampleColumns}
        rows={sampleRows}
        onClose={vi.fn()}
      />
    );
    expect(container.firstChild).toBeNull();
  });

  it('renders modal dialog with header, format tabs, preview, and actions when open', () => {
    render(
      <ExportModal
        isOpen={true}
        tableName="users"
        columns={sampleColumns}
        rows={sampleRows}
        onClose={vi.fn()}
      />
    );

    expect(screen.getByRole('dialog')).toBeDefined();
    expect(screen.getByText('Export Data Wizard')).toBeDefined();
    expect(screen.getByRole('tab', { name: /csv/i })).toBeDefined();
    expect(screen.getByRole('tab', { name: /json/i })).toBeDefined();
    expect(screen.getByRole('tab', { name: /markdown/i })).toBeDefined();
    expect(screen.getByRole('tab', { name: /sql/i })).toBeDefined();

    // Default tab is CSV
    const preview = screen.getByTestId('export-preview');
    expect(preview.textContent).toContain('id,name,status');
    expect(preview.textContent).toContain('1,Alice,active');
  });

  it('updates preview when CSV delimiter or quoteAll option changes', () => {
    render(
      <ExportModal
        isOpen={true}
        tableName="users"
        columns={sampleColumns}
        rows={sampleRows}
        onClose={vi.fn()}
      />
    );

    const delimiterSelect = screen.getByLabelText(/delimiter/i);
    fireEvent.change(delimiterSelect, { target: { value: ';' } });

    const preview = screen.getByTestId('export-preview');
    expect(preview.textContent).toContain('id;name;status');

    // Toggle quote all checkbox
    const quoteCheckbox = screen.getByLabelText(/quote all fields/i);
    fireEvent.click(quoteCheckbox);
    expect(preview.textContent).toContain('"id";"name";"status"');
  });

  it('switches between format tabs and updates preview', () => {
    render(
      <ExportModal
        isOpen={true}
        tableName="users"
        columns={sampleColumns}
        rows={sampleRows}
        onClose={vi.fn()}
      />
    );

    // Switch to JSON
    fireEvent.click(screen.getByRole('tab', { name: /json/i }));
    let preview = screen.getByTestId('export-preview');
    expect(preview.textContent).toContain('"name": "Alice"');

    // Switch to Markdown
    fireEvent.click(screen.getByRole('tab', { name: /markdown/i }));
    preview = screen.getByTestId('export-preview');
    expect(preview.textContent).toContain('| id | name | status |');
    expect(preview.textContent).toContain('| --- | --- | --- |');

    // Switch to SQL
    fireEvent.click(screen.getByRole('tab', { name: /sql/i }));
    preview = screen.getByTestId('export-preview');
    expect(preview.textContent).toContain("INSERT INTO users (id, name, status) VALUES (1, 'Alice', 'active');");
  });

  it('allows customizing SQL table name and reflects in SQL preview', () => {
    render(
      <ExportModal
        isOpen={true}
        tableName="users"
        columns={sampleColumns}
        rows={sampleRows}
        onClose={vi.fn()}
      />
    );

    fireEvent.click(screen.getByRole('tab', { name: /sql/i }));
    const tableNameInput = screen.getByLabelText(/table name/i);
    fireEvent.change(tableNameInput, { target: { value: 'custom_customers' } });

    const preview = screen.getByTestId('export-preview');
    expect(preview.textContent).toContain("INSERT INTO custom_customers (id, name, status)");
  });

  it('copies export content to clipboard and shows temporary feedback', async () => {
    render(
      <ExportModal
        isOpen={true}
        tableName="users"
        columns={sampleColumns}
        rows={sampleRows}
        onClose={vi.fn()}
      />
    );

    const copyBtn = screen.getByRole('button', { name: /copy to clipboard/i });
    fireEvent.click(copyBtn);

    expect(navigator.clipboard.writeText).toHaveBeenCalledTimes(1);
    expect(await screen.findByText(/copied!/i)).toBeDefined();
  });

  it('triggers file download with correct format and filename', () => {
    const downloadSpy = vi.spyOn(dataTransferModule, 'downloadExportFile').mockImplementation(() => {});

    render(
      <ExportModal
        isOpen={true}
        tableName="users"
        columns={sampleColumns}
        rows={sampleRows}
        onClose={vi.fn()}
      />
    );

    const downloadBtn = screen.getByRole('button', { name: /download file/i });
    fireEvent.click(downloadBtn);

    expect(downloadSpy).toHaveBeenCalledWith(
      expect.stringContaining('id,name,status'),
      'users.csv',
      'text/csv;charset=utf-8;'
    );
  });

  it('closes modal when close button or Escape key is pressed', () => {
    const onClose = vi.fn();
    render(
      <ExportModal
        isOpen={true}
        tableName="users"
        columns={sampleColumns}
        rows={sampleRows}
        onClose={onClose}
      />
    );

    // Escape key
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);

    // Close button
    const closeBtn = screen.getByRole('button', { name: /close modal/i });
    fireEvent.click(closeBtn);
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it('displays row count and truncates preview to first 50 rows if dataset is larger', () => {
    const largeRows = Array.from({ length: 60 }, (_, i) => [i + 1, `User ${i + 1}`, 'active']);

    render(
      <ExportModal
        isOpen={true}
        tableName="large_users"
        columns={sampleColumns}
        rows={largeRows}
        onClose={vi.fn()}
      />
    );

    expect(screen.getByText(/showing first 50 of 60 rows/i)).toBeDefined();
  });
});
