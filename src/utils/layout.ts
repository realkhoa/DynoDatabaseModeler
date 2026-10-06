/**
 * @file layout.ts
 * @brief Automatic graph layout engine for relational ERD diagrams using Dagre.
 * @details Computes non-overlapping 2D coordinates for table nodes and foreign key edges
 * using a left-to-right (LR) hierarchical tree layout with dynamic node heights based on column count.
 */

import dagre from 'dagre';
import type { Node, Edge } from '@xyflow/react';

/**
 * @brief Default fixed width in pixels allocated for table nodes on the ERD canvas.
 */
export const TABLE_NODE_WIDTH = 240;

/**
 * @brief Base height in pixels for table node header and chrome padding.
 */
export const TABLE_HEADER_BASE_HEIGHT = 45;

/**
 * @brief Estimated vertical height in pixels per column row.
 */
export const TABLE_ROW_HEIGHT = 28;

/**
 * @brief Calculates estimated bounding height for a table node given its column count.
 * @param columnCount Number of columns in the table schema.
 * @return Total computed height in pixels.
 */
export function estimateNodeHeight(columnCount: number): number {
  const safeCount = Math.max(1, columnCount);
  return TABLE_HEADER_BASE_HEIGHT + safeCount * TABLE_ROW_HEIGHT;
}

/**
 * @brief Applies Dagre hierarchical layout algorithm to position ERD table nodes and foreign key edges.
 * @details Constructs a directed graph in Dagre, assigns width (240px) and dynamic heights based on
 * the number of columns in each table node data payload, executes rankdir 'LR' layout, and repositions
 * nodes offset from their center coordinates so top-left handles and ports align properly.
 * @param nodes Array of React Flow table nodes to position.
 * @param edges Array of foreign key relationship edges connecting table nodes.
 * @return Cloned array of nodes with computed `position: { x, y }` coordinates.
 */
export function layoutElements<TData extends Record<string, unknown> = Record<string, unknown>>(
  nodes: Node<TData>[],
  edges: Edge[]
): Node<TData>[] {
  if (nodes.length === 0) {
    return [];
  }

  const g = new dagre.graphlib.Graph();
  g.setGraph({ rankdir: 'LR', nodesep: 70, ranksep: 100 });
  g.setDefaultEdgeLabel(() => ({}));

  nodes.forEach((node) => {
    const columns = (node.data as { columns?: unknown[] } | undefined)?.columns;
    const colCount = Array.isArray(columns) ? columns.length : 1;
    const height = estimateNodeHeight(colCount);
    g.setNode(node.id, { width: TABLE_NODE_WIDTH, height });
  });

  edges.forEach((edge) => {
    g.setEdge(edge.source, edge.target);
  });

  dagre.layout(g);

  return nodes.map((node) => {
    const pos = g.node(node.id);
    const columns = (node.data as { columns?: unknown[] } | undefined)?.columns;
    const colCount = Array.isArray(columns) ? columns.length : 1;
    const height = estimateNodeHeight(colCount);

    // Dagre returns center coordinates (x, y); React Flow nodes are positioned from top-left.
    return {
      ...node,
      position: {
        x: (pos?.x ?? 0) - TABLE_NODE_WIDTH / 2,
        y: (pos?.y ?? 0) - height / 2,
      },
    };
  });
}
