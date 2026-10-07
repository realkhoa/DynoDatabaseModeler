/**
 * @file CrowsFootEdge.tsx
 * @brief Custom React Flow edge component rendering Crow's Foot cardinality notations.
 * @details Implements formal database ERD relationship markers including mandatory-one (||),
 * optional-one (o|), one-or-more (|<), and zero-or-more (o<) cardinality notations matching
 * industry ERD diagram conventions.
 */

import React from 'react';
import {
  BaseEdge,
  Edge,
  EdgeProps,
  getSmoothStepPath,
  Position,
} from '@xyflow/react';
import type { CardinalityType } from '../../types/database';

/**
 * @brief Custom edge payload data defining Crow's Foot cardinality properties.
 */
export interface CrowsFootEdgeData extends Record<string, unknown> {
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
 * @brief Type definition for CrowsFootEdge component props conforming to React Flow edge specification.
 */
export type CrowsFootEdgeProps = EdgeProps<Edge<CrowsFootEdgeData, 'crowsFoot'>>;

/**
 * @brief Resolves default source and target cardinality symbols based on high-level relationship type.
 * @param data Optional CrowsFootEdgeData containing high-level cardinality or explicit endpoint overrides.
 * @return Resolved source and target cardinality symbol names.
 */
export function resolveCardinalities(data?: CrowsFootEdgeData): {
  source: 'one' | 'zero-or-one' | 'many';
  target: 'one' | 'many' | 'zero-or-many';
} {
  const card = data?.cardinality ?? 'one-to-many';
  let defaultSource: 'one' | 'zero-or-one' | 'many' = 'one';
  let defaultTarget: 'one' | 'many' | 'zero-or-many' = 'many';

  switch (card) {
    case 'one-to-one':
      defaultSource = 'one';
      defaultTarget = 'one';
      break;
    case 'one-to-many':
      defaultSource = 'one';
      defaultTarget = 'many';
      break;
    case 'many-to-many':
      defaultSource = 'many';
      defaultTarget = 'many';
      break;
    case 'zero-to-one':
      defaultSource = 'zero-or-one';
      defaultTarget = 'one';
      break;
    case 'zero-to-many':
      defaultSource = 'zero-or-one';
      defaultTarget = 'zero-or-many';
      break;
  }

  return {
    source: data?.sourceCardinality ?? defaultSource,
    target: data?.targetCardinality ?? defaultTarget,
  };
}

/**
 * @brief Computes rotation angle in degrees for endpoint markers based on handle docking position.
 * @param position React Flow handle docking position ('left', 'right', 'top', 'bottom').
 * @param _isSource Unused flag retained for backward compatibility.
 * @return Rotation angle in degrees orienting marker along the edge trajectory.
 */
export function getMarkerRotation(position?: Position, _isSource: boolean = false): number {
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
      return 0;
  }
}

/**
 * @brief Properties accepted by the CardinalityMarker SVG sub-component.
 */
export interface CardinalityMarkerProps {
  /** @brief Cardinality symbol variant to render. */
  type: 'one' | 'zero-or-one' | 'many' | 'zero-or-many';
  /** @brief Anchor coordinate X matching handle center. */
  x: number;
  /** @brief Anchor coordinate Y matching handle center. */
  y: number;
  /** @brief Rotation angle in degrees. */
  angle: number;
  /** @brief Stroke color for vector paths. */
  color?: string;
  /** @brief Identifies whether this marker is positioned at the 'source' or 'target' handle. */
  positionLabel: 'source' | 'target';
}

/**
 * @brief SVG Marker component rendering formal Crow's Foot cardinality glyphs.
 * @param props Marker variant, anchor coordinates, rotation angle, color, and endpoint position.
 * @return Renderable SVG group element containing cardinality symbols.
 */
export const CardinalityMarker: React.FC<CardinalityMarkerProps> = ({
  type,
  x,
  y,
  angle,
  color = '#20c997',
  positionLabel,
}) => {
  return (
    <g
      data-testid={`crowsfoot-${positionLabel}-marker`}
      transform={`translate(${x}, ${y}) rotate(${angle})`}
      stroke={color}
      strokeWidth={1.5}
      fill="none"
    >
      {type === 'one' && positionLabel === 'source' && (
        <g data-testid={`crowsfoot-double-bar-${positionLabel}`}>
          {/* Double crossbar (|| mandatory one) */}
          <line x1={-6} y1={-8} x2={-6} y2={8} stroke={color} strokeWidth={1.5} />
          <line x1={-12} y1={-8} x2={-12} y2={8} stroke={color} strokeWidth={1.5} />
        </g>
      )}

      {type === 'one' && positionLabel === 'target' && (
        <g data-testid={`crowsfoot-bar-${positionLabel}`}>
          {/* Single vertical bar (| one) */}
          <line x1={-8} y1={-8} x2={-8} y2={8} stroke={color} strokeWidth={1.5} />
        </g>
      )}

      {type === 'zero-or-one' && (
        <g data-testid={`crowsfoot-zero-or-one-${positionLabel}`}>
          {/* Crossbar (|) and Circle (o) */}
          <line x1={-6} y1={-8} x2={-6} y2={8} stroke={color} strokeWidth={1.5} />
          <circle
            data-testid={`crowsfoot-circle-${positionLabel}`}
            cx={-15}
            cy={0}
            r={4}
            stroke={color}
            strokeWidth={1.5}
            fill="#1e1f22"
          />
        </g>
      )}

      {type === 'many' && (
        <g data-testid={`crowsfoot-many-${positionLabel}`}>
          {/* Crow's Foot three-pronged trident (<) + crossbar (|) */}
          <path
            data-testid={`crowsfoot-fork-${positionLabel}`}
            d="M 0 0 L -12 -8 M 0 0 L -12 8 M 0 0 L -14 0"
            stroke={color}
            strokeWidth={1.5}
            fill="none"
          />
          <line x1={-14} y1={-8} x2={-14} y2={8} stroke={color} strokeWidth={1.5} />
        </g>
      )}

      {type === 'zero-or-many' && (
        <g data-testid={`crowsfoot-zero-or-many-${positionLabel}`}>
          {/* Crow's Foot fork (<) + circle (o) */}
          <path
            data-testid={`crowsfoot-fork-${positionLabel}`}
            d="M 0 0 L -12 -8 M 0 0 L -12 8 M 0 0 L -14 0"
            stroke={color}
            strokeWidth={1.5}
            fill="none"
          />
          <circle
            data-testid={`crowsfoot-circle-${positionLabel}`}
            cx={-19}
            cy={0}
            r={4}
            stroke={color}
            strokeWidth={1.5}
            fill="#1e1f22"
          />
        </g>
      )}
    </g>
  );
};

/**
 * @brief Custom React Flow edge component rendering formal Crow's Foot cardinality notations.
 * @details Computes an orthogonal smoothstep trajectory between table column handles
 *          and decorates both endpoints with relational cardinality symbols.
 * @param props React Flow EdgeProps containing coordinate data and edge metadata.
 * @return Renderable SVG path with Crow's Foot marker overlays.
 */
export const CrowsFootEdge: React.FC<CrowsFootEdgeProps> = ({
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
  const defaultStroke = (style?.stroke as string) || '#3a82f7';
  const strokeColor = selected ? '#20c997' : defaultStroke;

  const [edgePath, labelX, labelY] = getSmoothStepPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
    borderRadius: 8,
  });

  const { source: sourceMarkerType, target: targetMarkerType } = resolveCardinalities(edgeData);

  const sourceAngle = getMarkerRotation(sourcePosition, true);
  const targetAngle = getMarkerRotation(targetPosition, false);

  return (
    <>
      <BaseEdge
        id={id}
        path={edgePath}
        data-testid="crowsfoot-edge-path"
        stroke={strokeColor}
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
        color={strokeColor}
        positionLabel="source"
      />

      {/* Target End Cardinality Marker */}
      <CardinalityMarker
        type={targetMarkerType}
        x={targetX}
        y={targetY}
        angle={targetAngle}
        color={strokeColor}
        positionLabel="target"
      />

      {/* Optional Edge Label */}
      {edgeData.label && (
        <g
          data-testid="crowsfoot-label"
          transform={`translate(${labelX}, ${labelY})`}
        >
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
