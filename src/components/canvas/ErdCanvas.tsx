/**
 * @file ErdCanvas.tsx
 * @brief Interactive entity-relationship diagram canvas engine powered by @xyflow/react.
 * @details Visualizes table nodes, column handles, foreign key relationship curves,
 * mini-map navigation, canvas zoom/pan controls, and Dagre hierarchical auto-layout.
 */

import React, { useMemo, useEffect, useCallback } from 'react';
import {
  ReactFlow,
  Controls,
  MiniMap,
  Background,
  BackgroundVariant,
  useNodesState,
  useEdgesState,
  Node,
  Edge,
  NodeMouseHandler,
  OnNodeDrag,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';

import { TableNode, TableNodeData } from './TableNode';
import { DatabaseSchema, Point } from '../../types/database';
import { layoutElements } from '../../utils/layout';
import { LayoutGrid, Plus, GitCompare } from 'lucide-react';

/**
 * @brief Properties accepted by the ErdCanvas diagram component.
 */
export interface ErdCanvasProps {
  /** @brief Database schema containing tables, columns, indexes, and foreign keys. */
  schema: DatabaseSchema;
  /** @brief Callback triggered when the user requests editing or inspecting a table. */
  onEditTable: (tableName: string) => void;
  /** @brief Optional callback triggered when a table node is selected. */
  onSelectTable?: (tableName: string) => void;
  /** @brief Optional callback triggered to open the create new table drawer. */
  onAddNewTable?: () => void;
  /** @brief Optional callback triggered when a node position changes after dragging. */
  onTablePositionChange?: (tableName: string, position: Point) => void;
  /** @brief Optional callback triggered to review schema diff and execute migrations. */
  onOpenDiff?: () => void;
  /** @brief Number of detected pending structural schema changes between live and desired schemas. */
  pendingChangesCount?: number;
}

/**
 * @brief Interactive ERD diagram workspace supporting custom table cards, foreign key edges, and layout.
 * @param props Diagram schema, mutation triggers, and selection callbacks.
 * @return Rendered interactive React Flow canvas.
 */
export const ErdCanvas: React.FC<ErdCanvasProps> = ({
  schema,
  onEditTable,
  onSelectTable,
  onAddNewTable,
  onTablePositionChange,
  onOpenDiff,
  pendingChangesCount = 0,
}) => {
  // Register custom node types mapping
  const nodeTypes = useMemo(() => ({ tableNode: TableNode }), []);

  /**
   * @brief Constructs React Flow node models from current schema tables while preserving user drag positions.
   * @param existingNodes Optional array of previous node instances to retain coordinates from.
   * @return Array of React Flow TableNode objects.
   */
  const buildNodesFromSchema = useCallback(
    (existingNodes?: Node<TableNodeData>[]): Node<TableNodeData>[] => {
      const positionMap = new Map<string, Point>();
      if (existingNodes) {
        existingNodes.forEach((n) => {
          positionMap.set(n.id, n.position);
        });
      }

      return schema.tables.map((table, idx) => {
        const defaultX = (idx % 3) * 300 + 40;
        const defaultY = Math.floor(idx / 3) * 280 + 40;
        const savedPos = positionMap.get(table.name) || table.ui_position;

        return {
          id: table.name,
          type: 'tableNode',
          position: savedPos || { x: defaultX, y: defaultY },
          data: {
            label: table.name,
            schema: table.schema,
            columns: table.columns,
            foreignKeys: table.foreign_keys,
            onEdit: onEditTable,
          },
        };
      });
    },
    [schema, onEditTable]
  );

  /**
   * @brief Generates animated foreign key relationship edges linking source and target column handles.
   * @return Array of React Flow Edge objects.
   */
  const buildEdgesFromSchema = useCallback((): Edge[] => {
    const edges: Edge[] = [];
    schema.tables.forEach((table) => {
      table.foreign_keys.forEach((fk, fkIdx) => {
        const edgeId =
          fk.constraint_name || `fk_${table.name}_${fk.source_column}_${fkIdx}`;
        edges.push({
          id: edgeId,
          source: table.name,
          sourceHandle: `${fk.source_column}-source`,
          target: fk.target_table,
          targetHandle: `${fk.target_column}-target`,
          animated: true,
          type: 'smoothstep',
          style: { stroke: '#3a82f7', strokeWidth: 2 },
        });
      });
    });
    return edges;
  }, [schema]);

  const [nodes, setNodes, onNodesChange] = useNodesState<Node<TableNodeData>>(
    buildNodesFromSchema()
  );
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>(
    buildEdgesFromSchema()
  );

  // Re-synchronize nodes and edges when schema or edit callback updates
  useEffect(() => {
    setNodes((prev) => buildNodesFromSchema(prev));
    setEdges(buildEdgesFromSchema());
  }, [schema, buildNodesFromSchema, buildEdgesFromSchema, setNodes, setEdges]);

  /**
   * @brief Applies Dagre hierarchical auto-layout across all canvas table nodes.
   */
  const handleAutoLayout = useCallback(() => {
    const layouted = layoutElements(nodes, edges);
    setNodes([...layouted]);
  }, [nodes, edges, setNodes]);

  /**
   * @brief Handles single click on node to update active table selection.
   */
  const handleNodeClick: NodeMouseHandler = useCallback(
    (_event, node) => {
      if (onSelectTable) {
        onSelectTable(node.id);
      }
    },
    [onSelectTable]
  );

  /**
   * @brief Handles double click on node to open the table editor drawer.
   */
  const handleNodeDoubleClick: NodeMouseHandler = useCallback(
    (_event, node) => {
      onEditTable(node.id);
    },
    [onEditTable]
  );

  /**
   * @brief Captures node drag stop event to notify parent of coordinate updates.
   */
  const handleNodeDragStop: OnNodeDrag<Node<TableNodeData>> = useCallback(
    (_event, node) => {
      if (onTablePositionChange) {
        onTablePositionChange(node.id, {
          x: node.position.x,
          y: node.position.y,
        });
      }
    },
    [onTablePositionChange]
  );

  return (
    <div className="w-full h-full relative bg-[#1e1f22] select-none">
      {/* Top Floating Control Bar */}
      <div className="absolute top-3 right-4 z-10 flex items-center space-x-2">
        {onAddNewTable && (
          <button
            type="button"
            onClick={onAddNewTable}
            className="inline-flex items-center gap-1.5 bg-[#24262b] hover:bg-[#2e3138] text-[#e6e8ea] px-3 py-1.5 rounded text-xs border border-[#35373c] shadow-lg transition-colors font-medium"
          >
            <Plus className="w-3.5 h-3.5 text-[#20c997]" />
            <span>Add Table</span>
          </button>
        )}

        {onOpenDiff && (
          <button
            type="button"
            onClick={onOpenDiff}
            className="inline-flex items-center gap-1.5 bg-[#24262b] hover:bg-[#2e3138] text-[#e6e8ea] px-3 py-1.5 rounded text-xs border border-[#35373c] shadow-lg transition-colors font-medium"
            title="Review schema differences and synchronize migrations"
          >
            <GitCompare className="w-3.5 h-3.5 text-[#3a82f7]" />
            <span>Review &amp; Sync</span>
            {pendingChangesCount > 0 && (
              <span
                data-testid="canvas-pending-changes-badge"
                className="ml-0.5 px-1.5 py-0.2 rounded-full bg-[#3a82f7] text-white text-[10px] font-bold"
              >
                {pendingChangesCount}
              </span>
            )}
          </button>
        )}

        <button
          type="button"
          onClick={handleAutoLayout}
          className="inline-flex items-center gap-1.5 bg-[#24262b] hover:bg-[#2e3138] text-[#e6e8ea] px-3 py-1.5 rounded text-xs border border-[#35373c] shadow-lg transition-colors font-medium"
          title="Auto arrange diagram nodes"
        >
          <LayoutGrid className="w-3.5 h-3.5 text-[#3a82f7]" />
          <span>Auto Layout</span>
        </button>
      </div>

      {/* Main React Flow Graph Canvas */}
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onNodeClick={handleNodeClick}
        onNodeDoubleClick={handleNodeDoubleClick}
        onNodeDragStop={handleNodeDragStop}
        fitView
      >
        <Background
          variant={BackgroundVariant.Dots}
          gap={18}
          size={1}
          color="#35373c"
        />
        <Controls
          className="bg-[#24262b]! border-[#35373c]! text-[#e6e8ea]! rounded-md! shadow-xl!"
          showInteractive={false}
        />
        <MiniMap
          nodeColor="#3a82f7"
          maskColor="rgba(30, 31, 34, 0.75)"
          className="bg-[#18191c]! border-[#35373c]! rounded-md! shadow-xl!"
          zoomable
          pannable
        />
      </ReactFlow>
    </div>
  );
};
