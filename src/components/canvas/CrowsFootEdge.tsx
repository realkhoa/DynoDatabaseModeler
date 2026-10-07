import React from 'react';
import { BaseEdge, EdgeProps, getSmoothStepPath, Position } from '@xyflow/react';
import { CardinalityType } from '../../types/database';

/**
 * @brief Custom edge payload data defining Crow's Foot cardinality properties.
 */
export interface CrowsFootEdgeData {
  /** @brief High-level cardinality association (e.g., 'one-to-many'). */
  cardinality?: CardinalityType;
  /** @brief Specific symbol to render at source handle endpoint ('one' | 'zero-or-one' | 'many'). */
  sourceCardinality?: 'one' | 'zero-or-one' | 'many';
  /** @brief Specific symbol to render at target handle endpoint ('one' | 'many' | 'zero-or-many'). */
  targetCardinality?: 'one' | 'many' | 'zero-or-many';
  /** @brief Optional relationship name or constraint identifier for the edge label. */
  label?: string;
}

/**
 * @brief Computes rotation angle in degrees for endpoint markers based on handle position.
 * @param position React Flow handle docking position ('left', 'right', 'top', 'bottom').
 * @param isSource True if calculating for source origin, false for target endpoint.
 * @return Rotation angle in degrees.
 */
export function getMarkerRotation(position?: Position, isSource: boolean = false): number {
  if (isSource) {
    switch (position) {
      case Position.Right:
        return 0;
      case Position.Left:
        return 180;
      case Position.Bottom:
        return 90;
      case Position.Top:
        return 270;
      default:
        return 0;
    }
  } else {
    switch (position) {
      case Position.Left:
        return 0;
      case Position.Right:
        return 180;
      case Position.Top:
        return 90;
      case Position.Bottom:
        return 270;
      default:
        return 180;
    }
  }
}

/**
 * @brief SVG Marker component rendering Crow's Foot cardinality symbols.
 * @param type Cardinality marker variant ('one', 'zero-or-one', 'many', 'zero-or-many').
 * @param x Anchor coordinate X.
 * @param y Anchor coordinate Y.
 * @param angle Rotation angle in degrees.
 * @param color Stroke and fill color.
 * @return SVG group element containing cardinality vector paths.
 */
export const CardinalityMarker: React.FC<{
  type: 'one' | 'zero-or-one' | 'many' | 'zero-or-many';
  x: number;
  y: number;
  angle: number;
  color?: string;
}> = ({ type, x, y, angle, color = '#20c997' }) => {
  return (
    <g
      data-testid={`marker-${type}`}
      transform={`translate(${x}, ${y}) rotate(${angle})`}
      stroke={color}
      strokeWidth={1.5}
      fill="none"
    >
      {type === 'one' && (
        <>
          {/* Double crossbar (|| mandatory one) */}
          <line x1={-6} y1={-8} x2={-6} y2={8} />
          <line x1={-12} y1={-8} x2={-12} y2={8} />
        </>
      )}

      {type === 'zero-or-one' && (
        <>
          {/* Crossbar (|) and Circle (o) */}
          <line x1={-6} y1={-8} x2={-6} y2={8} />
          <circle cx={-15} cy={0} r={4} stroke={color} fill="#18191c" />
        </>
      )}

      {type === 'many' && (
        <>
          {/* Crow's Foot three-pronged trident (<) + crossbar (|) */}
          <path d="M 0 0 L -12 -8 M 0 0 L -12 8 M 0 0 L -14 0" />
          <line x1={-14} y1={-8} x2={-14} y2={8} />
        </>
      )}

      {type === 'zero-or-many' && (
        <>
          {/* Crow's Foot fork (<) + circle (o) */}
          <path d="M 0 0 L -12 -8 M 0 0 L -12 8 M 0 0 L -14 0" />
          <circle cx={-19} cy={0} r={4} stroke={color} fill="#18191c" />
        </>
      )}
    </g>
  );
};

/**
 * @brief Custom React Flow edge rendering formal Crow's Foot cardinality notations.
 * @details Computes an orthogonal smoothstep trajectory between table column handles
 *          and decorates both endpoints with relational cardinality symbols.
 * @param props React Flow EdgeProps containing coordinate data and edge metadata.
 * @return Renderable SVG path with Crow's Foot marker overlays.
 */
export const CrowsFootEdge: React.FC<EdgeProps> = ({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  style = {},
  markerEnd,
  data,
  selected,
}) => {
  const edgeData = (data ?? {}) as CrowsFootEdgeData;
  const strokeColor = selected ? '#3a82f7' : (style.stroke ?? '#20c997');

  const [edgePath, labelX, labelY] = getSmoothStepPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
    borderRadius: 8,
  });

  const sourceMarkerType = edgeData.sourceCardinality ?? 'one';
  const targetMarkerType = edgeData.targetCardinality ?? 'many';

  const sourceAngle = getMarkerRotation(sourcePosition, true);
  const targetAngle = getMarkerRotation(targetPosition, false);

  return (
    <>
      <BaseEdge
        id={id}
        path={edgePath}
        style={{
          ...style,
          stroke: strokeColor,
          strokeWidth: selected ? 2 : 1.5,
        }}
        markerEnd={markerEnd}
      />

      {/* Source End Cardinality Marker */}
      <CardinalityMarker
        type={sourceMarkerType}
        x={sourceX}
        y={sourceY}
        angle={sourceAngle}
        color={strokeColor as string}
      />

      {/* Target End Cardinality Marker */}
      <CardinalityMarker
        type={targetMarkerType}
        x={targetX}
        y={targetY}
        angle={targetAngle}
        color={strokeColor as string}
      />

      {/* Optional Edge Label */}
      {edgeData.label && (
        <g transform={`translate(${labelX}, ${labelY})`}>
          <rect
            x={-30}
            y={-10}
            width={60}
            height={20}
            rx={4}
            fill="#1e1f22"
            stroke="#35373c"
            strokeWidth={1}
          />
          <text
            x={0}
            y={3}
            textAnchor="middle"
            fill="#8c919a"
            fontSize={10}
            fontFamily="monospace"
          >
            {edgeData.label}
          </text>
        </g>
      )}
    </>
  );
};
