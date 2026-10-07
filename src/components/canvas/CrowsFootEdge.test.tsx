/**
 * @file CrowsFootEdge.test.tsx
 * @brief Unit tests for CrowsFootEdge React Flow custom cardinality edge component.
 */

import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ReactFlowProvider, Position } from '@xyflow/react';
import { CrowsFootEdge, CrowsFootEdgeProps } from './CrowsFootEdge';
import type { CrowsFootEdgeData } from './CrowsFootEdge';

describe('CrowsFootEdge component', () => {
  /**
   * @brief Helper to render CrowsFootEdge inside an SVG container within ReactFlowProvider.
   * @param props Partial edge props to customize.
   * @return Render result from testing-library.
   */
  const renderEdge = (props?: Partial<CrowsFootEdgeProps>) => {
    const defaultData: CrowsFootEdgeData = {
      cardinality: 'one-to-many',
      label: 'fk_orders_user',
    };

    const edgeProps: CrowsFootEdgeProps = {
      id: 'edge-1',
      source: 'users',
      target: 'orders',
      sourceX: 100,
      sourceY: 100,
      targetX: 300,
      targetY: 200,
      sourcePosition: Position.Right,
      targetPosition: Position.Left,
      data: defaultData,
      selected: false,
      ...props,
    };

    return render(
      <ReactFlowProvider>
        <svg data-testid="svg-container" width={500} height={500}>
          <CrowsFootEdge {...edgeProps} />
        </svg>
      </ReactFlowProvider>
    );
  };

  /**
   * @brief Verifies that the SVG edge path is rendered with valid routing data.
   */
  it('renders SVG edge path cleanly', () => {
    renderEdge();

    const edgePath = screen.getByTestId('crowsfoot-edge-path');
    expect(edgePath).toBeDefined();
    expect(edgePath.getAttribute('d')).toContain('M100 100');
  });

  /**
   * @brief Verifies that the crow\'s foot fork marker is rendered at target position for many cardinality.
   */
  it('renders crow\'s foot fork marker at target position', () => {
    renderEdge({
      data: {
        cardinality: 'one-to-many',
      },
    });

    const targetMarker = screen.getByTestId('crowsfoot-target-marker');
    expect(targetMarker).toBeDefined();

    // Verify presence of crow's foot fork element within target marker
    const fork = screen.getByTestId('crowsfoot-fork-target');
    expect(fork).toBeDefined();
  });

  /**
   * @brief Verifies that the double vertical bar marker is rendered at source position for one cardinality.
   */
  it('renders double bar marker at source position', () => {
    renderEdge({
      data: {
        cardinality: 'one-to-many',
      },
    });

    const sourceMarker = screen.getByTestId('crowsfoot-source-marker');
    expect(sourceMarker).toBeDefined();

    // Verify presence of double vertical bars within source marker
    const doubleBar = screen.getByTestId('crowsfoot-double-bar-source');
    expect(doubleBar).toBeDefined();
  });

  /**
   * @brief Verifies that zero-or-one cardinality renders circle and vertical bar at source.
   */
  it('renders circle and vertical bar marker at source for zero-or-one cardinality', () => {
    renderEdge({
      data: {
        cardinality: 'zero-to-many',
        sourceCardinality: 'zero-or-one',
      },
    });

    const zeroOrOneMarker = screen.getByTestId('crowsfoot-zero-or-one-source');
    expect(zeroOrOneMarker).toBeDefined();
    expect(screen.getByTestId('crowsfoot-circle-source')).toBeDefined();
  });

  /**
   * @brief Verifies that zero-or-many cardinality renders circle and crow\'s foot fork at target.
   */
  it('renders circle and crow\'s foot fork at target for zero-or-many cardinality', () => {
    renderEdge({
      data: {
        cardinality: 'zero-to-many',
        targetCardinality: 'zero-or-many',
      },
    });

    const zeroOrManyMarker = screen.getByTestId('crowsfoot-zero-or-many-target');
    expect(zeroOrManyMarker).toBeDefined();
    expect(screen.getByTestId('crowsfoot-circle-target')).toBeDefined();
    expect(screen.getByTestId('crowsfoot-fork-target')).toBeDefined();
  });

  /**
   * @brief Verifies that one-to-one cardinality renders vertical bar marker at target.
   */
  it('renders vertical bar marker at target for one-to-one cardinality', () => {
    renderEdge({
      data: {
        cardinality: 'one-to-one',
        targetCardinality: 'one',
      },
    });

    const barTarget = screen.getByTestId('crowsfoot-bar-target');
    expect(barTarget).toBeDefined();
  });

  /**
   * @brief Verifies relationship label pill rendering when label string is provided.
   */
  it('renders middle label pill displaying relationship name', () => {
    renderEdge({
      data: {
        cardinality: 'one-to-many',
        label: 'fk_orders_user',
      },
    });

    expect(screen.getByText('fk_orders_user')).toBeDefined();
  });

  /**
   * @brief Verifies stroke color highlights with accent cyan when edge is selected.
   */
  it('applies accent cyan stroke color when edge is selected', () => {
    renderEdge({
      selected: true,
    });

    const edgePath = screen.getByTestId('crowsfoot-edge-path');
    expect(edgePath.getAttribute('stroke')).toBe('#20c997');
  });
});
