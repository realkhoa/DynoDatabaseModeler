/**
 * @file export.ts
 * @brief Diagram and schema export utilities for DynoDbModeler.
 * @details Provides utility functions to export the visual entity relationship diagram and database
 * schema into JSON, SVG vector graphics, and PNG raster images. Because the canvas is styled with
 * CSS classes, the exported markup resolves every element's computed style into an inline attribute
 * first; without that step the SVG/PNG renders unstyled outside the application.
 */

import type { DatabaseSchema } from '../types/database';

/**
 * @brief Computed CSS properties that never change rendering and only bloat the export.
 */
const SKIPPED_STYLE_PROPERTIES = new Set([
  'animation',
  'animation-delay',
  'animation-direction',
  'animation-duration',
  'animation-fill-mode',
  'animation-iteration-count',
  'animation-name',
  'animation-play-state',
  'animation-timing-function',
  'transition',
  'transition-delay',
  'transition-duration',
  'transition-property',
  'transition-timing-function',
  'will-change',
  'cursor',
  'pointer-events',
  'user-select',
  'content',
  'quotes',
]);

/**
 * @brief Values that never affect rendering and can be dropped to keep the export compact.
 */
const SKIPPED_STYLE_VALUES = new Set([
  'none',
  'normal',
  'auto',
  '0px',
  'rgba(0, 0, 0, 0)',
  'visible',
  'static',
]);

/**
 * @brief Copies computed styles of a live element tree onto a cloned tree.
 * @details Recursively walks the two trees in parallel, writing each element's resolved style as an
 * inline `style` attribute so the exported document no longer depends on the application stylesheet.
 * @param source Live element whose styles are resolved by the browser.
 * @param clone Matching cloned element that receives the inline styles.
 */
export function inlineComputedStyles(source: Element, clone: Element): void {
  const computed = window.getComputedStyle(source);
  const declarations: string[] = [];

  for (let index = 0; index < computed.length; index += 1) {
    const property = computed.item(index);
    if (SKIPPED_STYLE_PROPERTIES.has(property)) {
      continue;
    }
    const value = computed.getPropertyValue(property);
    if (!value || SKIPPED_STYLE_VALUES.has(value)) {
      continue;
    }
    declarations.push(`${property}:${value};`);
  }

  if (declarations.length > 0) {
    clone.setAttribute('style', declarations.join(''));
  }

  const sourceChildren = Array.from(source.children);
  const cloneChildren = Array.from(clone.children);
  sourceChildren.forEach((child, childIndex) => {
    const cloneChild = cloneChildren[childIndex];
    if (cloneChild) {
      inlineComputedStyles(child, cloneChild);
    }
  });
}

/**
 * @brief Resolves the diagram viewport element inside a container.
 * @param element Canvas container or viewport element.
 * @return Viewport element, or null when the diagram has not rendered yet.
 */
function findViewport(element: HTMLElement | SVGElement): HTMLElement | null {
  if (element.classList?.contains('react-flow__viewport')) {
    return element as HTMLElement;
  }
  return (element.querySelector?.('.react-flow__viewport') as HTMLElement | null) ?? null;
}

/**
 * @brief Serializes a diagram element into a self-contained SVG document string.
 * @details When a React Flow viewport is present it is wrapped in a `foreignObject` with inline
 * styles, which preserves both the HTML table cards and the SVG relationship edges. A bare SVG
 * element is serialized directly.
 * @param element Canvas container, viewport, or SVG element.
 * @return Tuple of the SVG document string and the pixel dimensions used.
 */
export function buildDiagramSvg(element: HTMLElement | SVGElement): {
  svg: string;
  width: number;
  height: number;
} {
  const bbox =
    typeof element.getBoundingClientRect === 'function'
      ? element.getBoundingClientRect()
      : { width: 800, height: 600 };
  const width = Math.max(Math.round(bbox.width) || 800, 100);
  const height = Math.max(Math.round(bbox.height) || 600, 100);

  const viewport = findViewport(element);

  if (viewport) {
    const clone = viewport.cloneNode(true) as HTMLElement;
    inlineComputedStyles(viewport, clone);

    return {
      svg:
        `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">` +
        `<foreignObject width="100%" height="100%">` +
        `<div xmlns="http://www.w3.org/1999/xhtml" style="width:100%;height:100%">${clone.outerHTML}</div>` +
        `</foreignObject></svg>`,
      width,
      height,
    };
  }

  if (element instanceof SVGElement) {
    const serialized = new XMLSerializer().serializeToString(element);
    const svg = serialized.match(/^<svg[^>]+xmlns="http:\/\/www\.w3\.org\/2000\/svg"/)
      ? serialized
      : serialized.replace(/^<svg/, '<svg xmlns="http://www.w3.org/2000/svg"');
    return { svg, width, height };
  }

  const clone = element.cloneNode(true) as HTMLElement;
  inlineComputedStyles(element, clone);

  return {
    svg:
      `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">` +
      `<foreignObject width="100%" height="100%">` +
      `<div xmlns="http://www.w3.org/1999/xhtml" style="width:100%;height:100%">${clone.outerHTML}</div>` +
      `</foreignObject></svg>`,
    width,
    height,
  };
}

/**
 * @brief Exports and downloads a database schema definition formatted as pretty-printed JSON.
 * @param schema The database schema structure containing tables, columns, indexes, and constraints.
 * @param filename Optional target filename override (defaults to `${database_name || 'schema'}-erd.json`).
 */
export function exportSchemaAsJson(schema: DatabaseSchema, filename?: string): void {
  const dataStr =
    'data:text/json;charset=utf-8,' +
    encodeURIComponent(JSON.stringify(schema, null, 2));
  const downloadAnchor = document.createElement('a');
  const targetFilename =
    filename || `${schema.database_name || 'schema'}-erd.json`;
  downloadAnchor.setAttribute('href', dataStr);
  downloadAnchor.setAttribute(
    'download',
    targetFilename.endsWith('.json') ? targetFilename : `${targetFilename}.json`
  );
  document.body.appendChild(downloadAnchor);
  downloadAnchor.click();
  downloadAnchor.remove();
}

/**
 * @brief Exports and downloads an HTML or SVG diagram element as an SVG vector image file.
 * @param element HTMLElement or SVGElement hosting the diagram or viewport.
 * @param filename Target filename for the exported SVG file (defaults to 'erd-diagram.svg').
 */
export function exportErdAsSvg(
  element: HTMLElement | SVGElement,
  filename = 'erd-diagram.svg'
): void {
  const { svg } = buildDiagramSvg(element);

  const svgBlob = new Blob([svg], { type: 'image/svg+xml;charset=utf-8' });
  const url = URL.createObjectURL(svgBlob);
  const downloadAnchor = document.createElement('a');
  const targetFilename = filename.endsWith('.svg') ? filename : `${filename}.svg`;

  downloadAnchor.setAttribute('href', url);
  downloadAnchor.setAttribute('download', targetFilename);
  document.body.appendChild(downloadAnchor);
  downloadAnchor.click();
  downloadAnchor.remove();
  URL.revokeObjectURL(url);
}

/**
 * @brief Exports and downloads an HTML or SVG diagram container element as a PNG raster image.
 * @details Serializes the diagram with inline styles into an offscreen canvas with a dark
 * background, then triggers a file download.
 * @param element HTMLElement or SVGElement hosting the diagram.
 * @param filename Target filename for the exported PNG image (defaults to 'erd-diagram.png').
 * @return Promise resolving when PNG conversion and download trigger completes.
 * @throws Error if image rendering or canvas context creation fails.
 */
export function exportErdAsPng(
  element: HTMLElement | SVGElement,
  filename = 'erd-diagram.png'
): Promise<void> {
  const { svg, width, height } = buildDiagramSvg(element);

  const svgBlob = new Blob([svg], { type: 'image/svg+xml;charset=utf-8' });
  const url = URL.createObjectURL(svgBlob);

  return new Promise<void>((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';

    img.onload = () => {
      try {
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          throw new Error('Canvas 2D context is unavailable');
        }
        ctx.fillStyle = '#1e1f22';
        ctx.fillRect(0, 0, width, height);
        ctx.drawImage(img, 0, 0);

        const pngUrl = canvas.toDataURL('image/png');
        const downloadAnchor = document.createElement('a');
        const targetFilename = filename.endsWith('.png') ? filename : `${filename}.png`;
        downloadAnchor.setAttribute('href', pngUrl);
        downloadAnchor.setAttribute('download', targetFilename);
        document.body.appendChild(downloadAnchor);
        downloadAnchor.click();
        downloadAnchor.remove();

        URL.revokeObjectURL(url);
        resolve();
      } catch (err) {
        URL.revokeObjectURL(url);
        reject(err);
      }
    };

    img.onerror = (e) => {
      URL.revokeObjectURL(url);
      reject(new Error(`Failed to render diagram image to PNG: ${e}`));
    };

    img.src = url;
  });
}
