/**
 * @file export.test.ts
 * @brief Unit tests for ERD and schema export utilities.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { exportSchemaAsJson, exportErdAsSvg, exportErdAsPng } from './export';
import type { DatabaseSchema } from '../types/database';

describe('export utilities', () => {
  const sampleSchema: DatabaseSchema = {
    database_name: 'ecommerce_db',
    tables: [
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
        ],
        foreign_keys: [],
        indexes: [],
      },
    ],
  };

  let createdElements: HTMLElement[] = [];
  const originalCreateElement = document.createElement.bind(document);

  beforeEach(() => {
    createdElements = [];
    vi.spyOn(document, 'createElement').mockImplementation((tagName: string) => {
      const el = originalCreateElement(tagName);
      if (tagName.toLowerCase() === 'a') {
        createdElements.push(el);
      }
      return el;
    });

    if (!window.URL.createObjectURL) {
      window.URL.createObjectURL = vi.fn().mockReturnValue('blob:mock-url');
    } else {
      vi.spyOn(window.URL, 'createObjectURL').mockReturnValue('blob:mock-url');
    }

    if (!window.URL.revokeObjectURL) {
      window.URL.revokeObjectURL = vi.fn();
    } else {
      vi.spyOn(window.URL, 'revokeObjectURL').mockImplementation(() => {});
    }
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('exportSchemaAsJson', () => {
    it('creates an anchor, triggers download with default filename and removes anchor', () => {
      let clicked = false;
      vi.spyOn(document.body, 'appendChild').mockImplementation((node) => {
        if (node instanceof HTMLAnchorElement) {
          node.click = () => {
            clicked = true;
          };
        }
        return node;
      });

      exportSchemaAsJson(sampleSchema);

      expect(createdElements.length).toBe(1);
      const anchor = createdElements[0] as HTMLAnchorElement;
      expect(anchor.getAttribute('download')).toBe('ecommerce_db-erd.json');
      expect(anchor.getAttribute('href')).toContain('data:text/json;charset=utf-8,');
      expect(clicked).toBe(true);
    });

    it('uses custom filename when supplied', () => {
      exportSchemaAsJson(sampleSchema, 'custom-backup.json');

      const anchor = createdElements[0] as HTMLAnchorElement;
      expect(anchor.getAttribute('download')).toBe('custom-backup.json');
    });

    it('falls back to "schema-erd.json" when database_name is empty', () => {
      const emptyDbSchema: DatabaseSchema = {
        database_name: '',
        tables: [],
      };
      exportSchemaAsJson(emptyDbSchema);

      const anchor = createdElements[0] as HTMLAnchorElement;
      expect(anchor.getAttribute('download')).toBe('schema-erd.json');
    });
  });

  describe('exportErdAsSvg', () => {
    it('serializes SVG element and triggers download with correct MIME type', () => {
      const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      svg.setAttribute('width', '500');
      svg.setAttribute('height', '400');
      const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
      svg.appendChild(rect);

      let clicked = false;
      vi.spyOn(document.body, 'appendChild').mockImplementation((node) => {
        if (node instanceof HTMLAnchorElement) {
          node.click = () => {
            clicked = true;
          };
        }
        return node;
      });

      exportErdAsSvg(svg, 'my-diagram.svg');

      expect(window.URL.createObjectURL).toHaveBeenCalled();
      expect(createdElements.length).toBe(1);
      const anchor = createdElements[0] as HTMLAnchorElement;
      expect(anchor.getAttribute('download')).toBe('my-diagram.svg');
      expect(anchor.getAttribute('href')).toBe('blob:mock-url');
      expect(clicked).toBe(true);
      expect(window.URL.revokeObjectURL).toHaveBeenCalledWith('blob:mock-url');
    });

    it('adds missing SVG namespace if omitted from root element', () => {
      const div = document.createElement('div');
      div.innerHTML = '<svg width="100" height="100"><circle r="10"/></svg>';
      const svg = div.querySelector('svg') as unknown as SVGElement;

      exportErdAsSvg(svg, 'test-namespace.svg');

      const anchor = createdElements[0] as HTMLAnchorElement;
      expect(anchor.getAttribute('download')).toBe('test-namespace.svg');
      expect(window.URL.createObjectURL).toHaveBeenCalled();
    });
  });

  describe('exportErdAsPng', () => {
    it('renders SVG to canvas and exports PNG data', async () => {
      const container = document.createElement('div');
      container.innerHTML = '<svg width="200" height="200"><rect width="100" height="100"/></svg>';

      // Mock canvas getContext and toDataURL
      const mockDrawImage = vi.fn();
      const mockFillRect = vi.fn();
      const mockToDataURL = vi.fn().mockReturnValue('data:image/png;base64,mockpng');

      vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
        fillStyle: '',
        fillRect: mockFillRect,
        drawImage: mockDrawImage,
      } as unknown as CanvasRenderingContext2D);
      vi.spyOn(HTMLCanvasElement.prototype, 'toDataURL').mockImplementation(mockToDataURL);

      // Mock Image constructor to trigger onload
      const originalImage = window.Image;
      class MockImage {
        crossOrigin = '';
        width = 200;
        height = 200;
        private _src = '';
        onload: (() => void) | null = null;
        onerror: ((err: any) => void) | null = null;
        set src(value: string) {
          this._src = value;
          setTimeout(() => {
            this.onload?.();
          }, 0);
        }
        get src() {
          return this._src;
        }
      }
      (window as any).Image = MockImage;

      try {
        await exportErdAsPng(container, 'diagram.png');

        expect(createdElements.length).toBe(1);
        const anchor = createdElements[0] as HTMLAnchorElement;
        expect(anchor.getAttribute('download')).toBe('diagram.png');
        expect(anchor.getAttribute('href')).toBe('data:image/png;base64,mockpng');
      } finally {
        (window as any).Image = originalImage;
      }
    });

    it('rejects when image loading fails', async () => {
      const container = document.createElement('div');
      container.innerHTML = '<div>Plain HTML diagram</div>';

      const originalImage = window.Image;
      class MockFailingImage {
        crossOrigin = '';
        onload: (() => void) | null = null;
        onerror: ((err: any) => void) | null = null;
        set src(_value: string) {
          setTimeout(() => {
            this.onerror?.(new Error('Image decode error'));
          }, 0);
        }
      }
      (window as any).Image = MockFailingImage;

      try {
        await expect(exportErdAsPng(container, 'fail.png')).rejects.toThrow(
          /Failed to render diagram image to PNG/
        );
      } finally {
        (window as any).Image = originalImage;
      }
    });
  });
});
