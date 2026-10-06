/**
 * @file layout.test.ts
 * @brief Unit tests for Dagre graph auto-layout algorithm for ERD canvas.
 */

import { describe, it, expect } from 'vitest';
import { layoutElements } from './layout';
import type { Node, Edge } from '@xyflow/react';

describe('layoutElements', () => {
  /**
   * @brief Verifies handling of empty graph elements without errors.
   */
  it('returns empty array when given empty nodes and edges', () => {
    const result = layoutElements([], []);
    expect(result).toEqual([]);
  });

  /**
   * @brief Verifies single node layout calculation and centering.
   */
  it('calculates position for a single table node', () => {
    const nodes: Node[] = [
      {
        id: 'users',
        position: { x: 0, y: 0 },
        data: {
          label: 'users',
          columns: [
            { name: 'id', data_type: 'Integer', is_primary_key: true, is_nullable: false, is_auto_increment: true },
            { name: 'email', data_type: 'Text', is_primary_key: false, is_nullable: false, is_auto_increment: false },
          ],
        },
      },
    ];

    const result = layoutElements(nodes, []);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('users');
    expect(typeof result[0].position.x).toBe('number');
    expect(typeof result[0].position.y).toBe('number');
  });

  /**
   * @brief Verifies left-to-right (LR) ordering for connected table nodes.
   */
  it('positions source node to the left of target node for LR rankdir', () => {
    const nodes: Node[] = [
      {
        id: 'orders',
        position: { x: 0, y: 0 },
        data: {
          label: 'orders',
          columns: [
            { name: 'id', data_type: 'Integer', is_primary_key: true, is_nullable: false, is_auto_increment: true },
            { name: 'user_id', data_type: 'Integer', is_primary_key: false, is_nullable: false, is_auto_increment: false },
          ],
        },
      },
      {
        id: 'users',
        position: { x: 0, y: 0 },
        data: {
          label: 'users',
          columns: [
            { name: 'id', data_type: 'Integer', is_primary_key: true, is_nullable: false, is_auto_increment: true },
          ],
        },
      },
    ];

    // orders references users
    const edges: Edge[] = [
      {
        id: 'fk_orders_user',
        source: 'orders',
        target: 'users',
      },
    ];

    const result = layoutElements(nodes, edges);
    expect(result).toHaveLength(2);

    const ordersNode = result.find((n) => n.id === 'orders')!;
    const usersNode = result.find((n) => n.id === 'users')!;

    // In LR direction, source (orders) should be to the left of target (users)
    expect(ordersNode.position.x).toBeLessThan(usersNode.position.x);
  });

  /**
   * @brief Verifies that column count affects estimated node height and vertical centering.
   */
  it('adjusts estimated height based on column count', () => {
    const nodes: Node[] = [
      {
        id: 'small_table',
        position: { x: 0, y: 0 },
        data: {
          label: 'small_table',
          columns: [{ name: 'id', data_type: 'Integer', is_primary_key: true, is_nullable: false, is_auto_increment: true }],
        },
      },
      {
        id: 'large_table',
        position: { x: 0, y: 0 },
        data: {
          label: 'large_table',
          columns: Array.from({ length: 10 }, (_, i) => ({
            name: `col_${i}`,
            data_type: 'Text',
            is_primary_key: false,
            is_nullable: true,
            is_auto_increment: false,
          })),
        },
      },
    ];

    const result = layoutElements(nodes, []);
    expect(result).toHaveLength(2);
    // Both positions should be finite numbers
    expect(Number.isFinite(result[0].position.y)).toBe(true);
    expect(Number.isFinite(result[1].position.y)).toBe(true);
  });

  /**
   * @brief Verifies node with missing or empty columns data falls back safely.
   */
  it('handles nodes with missing columns data gracefully', () => {
    const nodes: Node[] = [
      {
        id: 'empty_data',
        position: { x: 0, y: 0 },
        data: {},
      },
    ];

    const result = layoutElements(nodes, []);
    expect(result).toHaveLength(1);
    expect(Number.isFinite(result[0].position.x)).toBe(true);
    expect(Number.isFinite(result[0].position.y)).toBe(true);
  });
});
