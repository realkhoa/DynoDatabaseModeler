/**
 * @file export.ts
 * @brief Diagram and schema export utilities for DynoDbModeler.
 * @details Provides utility functions to export the visual entity relationship diagram
 * and database schema into JSON, SVG vector graphics, and PNG raster images.
 */

import type { DatabaseSchema } from '../types/database';

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
 * @brief Exports and downloads an SVG element as an SVG vector image file.
 * @param svgElement SVG element to serialize and download.
 * @param filename Target filename for the exported SVG file (defaults to 'erd-diagram.svg').
 */
export function exportErdAsSvg(
  svgElement: SVGElement,
  filename = 'erd-diagram.svg'
): void {
  const serializer = new XMLSerializer();
  let source = serializer.serializeToString(svgElement);

  // Ensure standard SVG XML namespace is present
  if (!source.match(/^<svg[^>]+xmlns="http:\/\/www\.w3\.org\/2000\/svg"/)) {
    source = source.replace(/^<svg/, '<svg xmlns="http://www.w3.org/2000/svg"');
  }

  const svgBlob = new Blob([source], { type: 'image/svg+xml;charset=utf-8' });
  const url = URL.createObjectURL(svgBlob);
  const downloadAnchor = document.createElement('a');
  const targetFilename = filename.endsWith('.svg')
    ? filename
    : `${filename}.svg`;

  downloadAnchor.setAttribute('href', url);
  downloadAnchor.setAttribute('download', targetFilename);
  document.body.appendChild(downloadAnchor);
  downloadAnchor.click();
  downloadAnchor.remove();
  URL.revokeObjectURL(url);
}

/**
 * @brief Exports and downloads an HTML or SVG diagram container element as a PNG raster image.
 * @details Extracts SVG or serializes the DOM subtree using an SVG foreignObject, renders the
 * contents into an offscreen HTML5 canvas with a dark background, and triggers a file download.
 * @param element HTMLElement or SVGElement hosting the diagram.
 * @param filename Target filename for the exported PNG image (defaults to 'erd-diagram.png').
 * @return Promise resolving when PNG conversion and download trigger completes.
 * @throws Error if image rendering or canvas context creation fails.
 */
export function exportErdAsPng(
  element: HTMLElement,
  filename = 'erd-diagram.png'
): Promise<void> {
  const bbox =
    typeof element.getBoundingClientRect === 'function'
      ? element.getBoundingClientRect()
      : { width: 800, height: 600 };
  const width = Math.max(bbox.width || 800, 100);
  const height = Math.max(bbox.height || 600, 100);

  const serializer = new XMLSerializer();
  const svgInside =
    element instanceof SVGElement
      ? element
      : element.querySelector?.('svg') ?? null;

  let svgString = '';
  if (svgInside) {
    svgString = serializer.serializeToString(svgInside);
    if (!svgString.match(/^<svg[^>]+xmlns="http:\/\/www\.w3\.org\/2000\/svg"/)) {
      svgString = svgString.replace(
        /^<svg/,
        '<svg xmlns="http://www.w3.org/2000/svg"'
      );
    }
  } else {
    const content = element.outerHTML || element.innerHTML || '';
    svgString =
      `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">` +
      `<foreignObject width="100%" height="100%">` +
      `<div xmlns="http://www.w3.org/1999/xhtml">${content}</div>` +
      `</foreignObject></svg>`;
  }

  const svgBlob = new Blob([svgString], {
    type: 'image/svg+xml;charset=utf-8',
  });
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
        if (ctx) {
          ctx.fillStyle = '#1e1f22';
          ctx.fillRect(0, 0, width, height);
          ctx.drawImage(img, 0, 0);
          const pngUrl = canvas.toDataURL('image/png');
          const downloadAnchor = document.createElement('a');
          const targetFilename = filename.endsWith('.png')
            ? filename
            : `${filename}.png`;
          downloadAnchor.setAttribute('href', pngUrl);
          downloadAnchor.setAttribute('download', targetFilename);
          document.body.appendChild(downloadAnchor);
          downloadAnchor.click();
          downloadAnchor.remove();
        }
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
