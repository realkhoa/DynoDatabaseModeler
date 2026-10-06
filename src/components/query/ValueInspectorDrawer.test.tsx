/**
 * @file ValueInspectorDrawer.test.tsx
 * @brief Unit tests for ValueInspectorDrawer component and format detection helpers.
 * @details Validates format detection (JSON, XML, Image, Plain Text, Null),
 * telemetry calculations (chars, lines, bytes), Monaco Editor binding,
 * clipboard copy utilities, Apply to Cell callback, and drawer visibility/Escape interactions.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import {
  ValueInspectorDrawer,
  detectContentType,
  calculateByteSize,
  calculateLineCount,
  calculateWordCount,
  formatByteSize,
} from './ValueInspectorDrawer';

// Mock Monaco Editor for test environment
vi.mock('@monaco-editor/react', () => ({
  default: ({
    value,
    onChange,
    language,
    options,
  }: {
    value?: string;
    onChange?: (val: string) => void;
    language?: string;
    options?: { readOnly?: boolean };
  }) => (
    <textarea
      data-testid="monaco-inspector-editor"
      data-language={language}
      data-readonly={options?.readOnly ? 'true' : 'false'}
      value={value}
      onChange={(e) => onChange?.(e.target.value)}
    />
  ),
}));

describe('ValueInspectorDrawer component', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Setup clipboard mock safely with Object.defineProperty
    Object.defineProperty(navigator, 'clipboard', {
      value: {
        writeText: vi.fn().mockResolvedValue(undefined),
      },
      configurable: true,
      writable: true,
    });
  });

  describe('detectContentType and helpers', () => {
    it('detects and formats JSON objects and parseable strings', () => {
      const objResult = detectContentType({ foo: 'bar', count: 42 });
      expect(objResult.format).toBe('JSON');
      expect(objResult.monacoLanguage).toBe('json');
      expect(objResult.formattedText).toBe(
        JSON.stringify({ foo: 'bar', count: 42 }, null, 2)
      );

      const jsonStrResult = detectContentType('{"status":"ok","items":[1,2,3]}');
      expect(jsonStrResult.format).toBe('JSON');
      expect(jsonStrResult.monacoLanguage).toBe('json');
      expect(jsonStrResult.formattedText).toContain('  "status": "ok"');
    });

    it('detects XML strings', () => {
      const xmlString = '<catalog><book id="bk101"><title>XML Developer Guide</title></book></catalog>';
      const xmlResult = detectContentType(xmlString);
      expect(xmlResult.format).toBe('XML');
      expect(xmlResult.monacoLanguage).toBe('xml');

      const xmlDecl = '<?xml version="1.0"?><note><to>User</to></note>';
      const xmlDeclResult = detectContentType(xmlDecl);
      expect(xmlDeclResult.format).toBe('XML');
      expect(xmlDeclResult.monacoLanguage).toBe('xml');
    });

    it('detects Data URI and Base64 images', () => {
      const dataUri = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
      const result = detectContentType(dataUri);
      expect(result.format).toBe('IMAGE');
      expect(result.isImage).toBe(true);
      expect(result.imageUrl).toBe(dataUri);

      // Raw base64 PNG without prefix
      const rawPng = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
      const rawResult = detectContentType(rawPng);
      expect(rawResult.format).toBe('IMAGE');
      expect(rawResult.isImage).toBe(true);
      expect(rawResult.imageUrl).toBe(`data:image/png;base64,${rawPng}`);
    });

    it('detects null, numbers, booleans, and plain text', () => {
      const nullRes = detectContentType(null);
      expect(nullRes.format).toBe('NULL');
      expect(nullRes.formattedText).toBe('NULL');

      const undefRes = detectContentType(undefined);
      expect(undefRes.format).toBe('NULL');

      const numRes = detectContentType(3.14159);
      expect(numRes.format).toBe('TEXT');
      expect(numRes.formattedText).toBe('3.14159');

      const textRes = detectContentType('Hello World\nSecond line');
      expect(textRes.format).toBe('TEXT');
      expect(textRes.monacoLanguage).toBe('plaintext');
    });

    it('calculates telemetry: bytes, lines, words, formatted size', () => {
      const text = 'Hello World!\nSecond Line';
      expect(calculateByteSize(text)).toBe(24);
      expect(calculateLineCount(text)).toBe(2);
      expect(calculateWordCount(text)).toBe(4);
      expect(formatByteSize(500)).toBe('500 B');
      expect(formatByteSize(2048)).toBe('2.0 KB');
      expect(formatByteSize(1048576)).toBe('1.0 MB');
    });
  });

  describe('ValueInspectorDrawer rendering & interactions', () => {
    it('does not render when isOpen is false', () => {
      render(
        <ValueInspectorDrawer
          isOpen={false}
          columnName="payload"
          value={{ key: 'value' }}
          onClose={vi.fn()}
        />
      );

      expect(screen.queryByTestId('value-inspector-drawer')).toBeNull();
    });

    it('renders JSON value with format badge, column name, and telemetry', () => {
      const jsonVal = { user_id: 101, username: 'tester', roles: ['admin'] };
      render(
        <ValueInspectorDrawer
          isOpen={true}
          columnName="metadata"
          value={jsonVal}
          onClose={vi.fn()}
        />
      );

      expect(screen.getByTestId('value-inspector-drawer')).toBeDefined();
      expect(screen.getByText('metadata')).toBeDefined();
      expect(screen.getByText('JSON')).toBeDefined();

      const editor = screen.getByTestId('monaco-inspector-editor') as HTMLTextAreaElement;
      expect(editor.getAttribute('data-language')).toBe('json');
      expect(editor.value).toContain('"username": "tester"');

      // Check telemetry badges
      expect(screen.getByTestId('telemetry-chars')).toBeDefined();
      expect(screen.getByTestId('telemetry-lines')).toBeDefined();
      expect(screen.getByTestId('telemetry-bytes')).toBeDefined();
    });

    it('renders image preview container when passed base64 image data', () => {
      const dataUri = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
      render(
        <ValueInspectorDrawer
          isOpen={true}
          columnName="avatar_blob"
          value={dataUri}
          onClose={vi.fn()}
        />
      );

      expect(screen.getByText('IMAGE')).toBeDefined();
      const img = screen.getByRole('img', { name: /avatar_blob preview/i });
      expect(img).toBeDefined();
      expect(img.getAttribute('src')).toBe(dataUri);
      expect(screen.getByRole('button', { name: /Download Image/i })).toBeDefined();
    });

    it('renders XML format with language xml', () => {
      const xmlStr = '<user><id>1</id><name>Alice</name></user>';
      render(
        <ValueInspectorDrawer
          isOpen={true}
          columnName="profile_xml"
          value={xmlStr}
          onClose={vi.fn()}
        />
      );

      expect(screen.getByText('XML')).toBeDefined();
      const editor = screen.getByTestId('monaco-inspector-editor');
      expect(editor.getAttribute('data-language')).toBe('xml');
    });

    it('calls onClose when close button is clicked', () => {
      const onClose = vi.fn();
      render(
        <ValueInspectorDrawer
          isOpen={true}
          columnName="notes"
          value="Test note"
          onClose={onClose}
        />
      );

      const closeBtn = screen.getByRole('button', { name: /close drawer/i });
      fireEvent.click(closeBtn);

      expect(onClose).toHaveBeenCalledTimes(1);
    });

    it('calls onClose when Escape key is pressed', () => {
      const onClose = vi.fn();
      render(
        <ValueInspectorDrawer
          isOpen={true}
          columnName="notes"
          value="Test note"
          onClose={onClose}
        />
      );

      fireEvent.keyDown(window, { key: 'Escape' });
      expect(onClose).toHaveBeenCalledTimes(1);
    });

    it('copies formatted text to clipboard and displays feedback', async () => {
      const jsonVal = { foo: 'bar' };
      render(
        <ValueInspectorDrawer
          isOpen={true}
          columnName="data"
          value={jsonVal}
          onClose={vi.fn()}
        />
      );

      const copyFormattedBtn = screen.getByRole('button', { name: /copy formatted/i });
      fireEvent.click(copyFormattedBtn);

      expect(navigator.clipboard.writeText).toHaveBeenCalledWith(
        JSON.stringify(jsonVal, null, 2)
      );

      expect(await screen.findByText(/copied/i)).toBeDefined();
    });

    it('copies raw text to clipboard', async () => {
      const jsonStr = '{"a":1}';
      render(
        <ValueInspectorDrawer
          isOpen={true}
          columnName="raw_data"
          value={jsonStr}
          onClose={vi.fn()}
        />
      );

      const copyRawBtn = screen.getByRole('button', { name: /copy raw/i });
      fireEvent.click(copyRawBtn);

      expect(navigator.clipboard.writeText).toHaveBeenCalledWith(jsonStr);
      expect(await screen.findByText(/copied/i)).toBeDefined();
    });

    it('supports onApplyEdit callback when editing content', () => {
      const onApplyEdit = vi.fn();
      const initialJson = { name: 'Original' };

      render(
        <ValueInspectorDrawer
          isOpen={true}
          columnName="config"
          value={initialJson}
          onClose={vi.fn()}
          onApplyEdit={onApplyEdit}
        />
      );

      const applyBtn = screen.getByRole('button', { name: /apply to cell/i });
      expect(applyBtn).toBeDefined();

      const editor = screen.getByTestId('monaco-inspector-editor');
      expect(editor.getAttribute('data-readonly')).toBe('false');

      // Edit content in textarea
      const updatedJsonString = JSON.stringify({ name: 'Modified' }, null, 2);
      fireEvent.change(editor, { target: { value: updatedJsonString } });

      fireEvent.click(applyBtn);

      expect(onApplyEdit).toHaveBeenCalledWith({ name: 'Modified' });
    });
  });
});
