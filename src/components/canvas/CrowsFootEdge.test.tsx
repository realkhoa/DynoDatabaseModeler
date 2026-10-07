import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { CrowsFootEdge, getMarkerRotation, CardinalityMarker } from './CrowsFootEdge';
import { Position } from '@xyflow/react';

describe('CrowsFootEdge component and helpers', () => {
  it('computes correct rotation angles based on handle positions', () => {
    expect(getMarkerRotation(Position.Right, true)).toBe(0);
    expect(getMarkerRotation(Position.Left, true)).toBe(180);
    expect(getMarkerRotation(Position.Bottom, true)).toBe(90);
    expect(getMarkerRotation(Position.Top, true)).toBe(270);

    expect(getMarkerRotation(Position.Left, false)).toBe(0);
    expect(getMarkerRotation(Position.Right, false)).toBe(180);
    expect(getMarkerRotation(Position.Top, false)).toBe(90);
    expect(getMarkerRotation(Position.Bottom, false)).toBe(270);
  });

  it('renders CardinalityMarker variants correctly', () => {
    const { getByTestId, rerender } = render(
      <svg>
        <CardinalityMarker type="one" x={10} y={10} angle={0} />
      </svg>
    );
    expect(getByTestId('marker-one')).toBeDefined();

    rerender(
      <svg>
        <CardinalityMarker type="zero-or-one" x={10} y={10} angle={0} />
      </svg>
    );
    expect(getByTestId('marker-zero-or-one')).toBeDefined();

    rerender(
      <svg>
        <CardinalityMarker type="many" x={10} y={10} angle={0} />
      </svg>
    );
    expect(getByTestId('marker-many')).toBeDefined();

    rerender(
      <svg>
        <CardinalityMarker type="zero-or-many" x={10} y={10} angle={0} />
      </svg>
    );
    expect(getByTestId('marker-zero-or-many')).toBeDefined();
  });

  it('renders CrowsFootEdge with path and markers', () => {
    const { container, getByTestId, getByText } = render(
      <svg>
        <CrowsFootEdge
          id="test-edge"
          source="table1"
          target="table2"
          sourceX={50}
          sourceY={50}
          targetX={200}
          targetY={50}
          sourcePosition={Position.Right}
          targetPosition={Position.Left}
          data={{
            cardinality: 'one-to-many',
            sourceCardinality: 'one',
            targetCardinality: 'many',
            label: 'fk_users_orders',
          }}
        />
      </svg>
    );

    expect(container.querySelector('path')).toBeDefined();
    expect(getByTestId('marker-one')).toBeDefined();
    expect(getByTestId('marker-many')).toBeDefined();
    expect(getByText('fk_users_orders')).toBeDefined();
  });
});
