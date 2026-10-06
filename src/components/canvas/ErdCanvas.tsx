/**
 * @file ErdCanvas.tsx
 * @brief Interactive entity-relationship diagram canvas engine powered by @xyflow/react.
 * @details Visualizes table nodes, column handles, foreign key relationship curves,
 * mini-map navigation, canvas zoom/pan controls, and Dagre hierarchical auto-layout.
 */

import React, { useMemo, useEffect, useCallback, useState, useRef } from 'react';
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
import {
  LayoutGrid,
  Plus,
  GitCompare,
  Download,
  ChevronDown,
  FileJson,
  Image as ImageIcon,
  FileCode,
} from 'lucide-react';
import {
  exportSchemaAsJson,
  exportErdAsSvg,
  exportErdAsPng,
} from '../../utils/export';

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

  const containerRef = useRef<HTMLDivElement>(null);
  const [isExportOpen, setIsExportOpen] = useState(false);
  const exportMenuRef = useRef<HTMLDivElement>(null);

  // Close export dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (
        exportMenuRef.current &&
        !exportMenuRef.current.contains(event.target as unknown as globalThis.Node)
      ) {
        setIsExportOpen(false);
      }
    };
    if (isExportOpen) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => {
        document.removeEventListener('mousedown', handleClickOutside);
      };
    }
  }, [isExportOpen]);

  /**
   * @brief Exports the current database schema as a formatted JSON document file.
   */
  const handleExportJson = useCallback(() => {
    setIsExportOpen(false);
    exportSchemaAsJson(schema);
  }, [schema]);

  /**
   * @brief Exports the ERD canvas as an SVG vector graphic.
   * @details Targets the .react-flow__viewport element to serialize both nodes and relationship edges.
   */
  const handleExportSvg = useCallback(() => {
    setIsExportOpen(false);
    const viewportEl = containerRef.current?.querySelector(
      '.react-flow__viewport'
    ) as HTMLElement | null;
    const targetEl = viewportEl || containerRef.current;
    if (targetEl) {
      exportErdAsSvg(
        targetEl,
        `${schema.database_name || 'schema'}-erd.svg`
      );
    } else {
      const fallbackSvg = document.createElementNS(
        'http://www.w3.org/2000/svg',
        'svg'
      );
      fallbackSvg.setAttribute('width', '800');
      fallbackSvg.setAttribute('height', '600');
      exportErdAsSvg(
        fallbackSvg,
        `${schema.database_name || 'schema'}-erd.svg`
      );
    }
  }, [schema]);

  /**
   * @brief Exports the ERD canvas as a PNG raster image.
   * @details Targets the .react-flow__viewport element or diagram container to render both nodes and edges.
   */
  const handleExportPng = useCallback(async () => {
    setIsExportOpen(false);
    if (containerRef.current) {
      const viewportEl = containerRef.current.querySelector(
        '.react-flow__viewport'
      ) as HTMLElement | null;
      const targetEl = viewportEl || containerRef.current;
      try {
        await exportErdAsPng(
          targetEl,
          `${schema.database_name || 'schema'}-erd.png`
        );
      } catch (err: unknown) {
        console.error('Failed to export PNG:', err);
      }
    }
  }, [schema]);

  return (
    <div
      ref={containerRef}
      className="w-full h-full relative bg-[#1e1f22] select-none"
    >
      {/* Top Floating Control Bar */}
      <div className="absolute top-3 right-4 z-10 flex items-center space-x-2">
        {onAddNewTable && (
          <button
            type="button"
            onClick={onAddNewTable}
            className="inline-flex items-center gap-1.5 bg-[#24262b] hover:bg-[#2e3138] text-[#e6e8ea] px-3 py-1.5 rounded text-xs border border-[#35373c] shadow-lg transition-colors font-medium cursor-pointer"
          >
            <Plus className="w-3.5 h-3.5 text-[#20c997]" />
            <span>Add Table</span>
          </button>
        )}

        {onOpenDiff && (
          <button
            type="button"
            onClick={onOpenDiff}
            className="inline-flex items-center gap-1.5 bg-[#24262b] hover:bg-[#2e3138] text-[#e6e8ea] px-3 py-1.5 rounded text-xs border border-[#35373c] shadow-lg transition-colors font-medium cursor-pointer"
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
          className="inline-flex items-center gap-1.5 bg-[#24262b] hover:bg-[#2e3138] text-[#e6e8ea] px-3 py-1.5 rounded text-xs border border-[#35373c] shadow-lg transition-colors font-medium cursor-pointer"
          title="Auto arrange diagram nodes"
        >
          <LayoutGrid className="w-3.5 h-3.5 text-[#3a82f7]" />
          <span>Auto Layout</span>
        </button>

        {/* Export Dropdown */}
        <div className="relative" ref={exportMenuRef}>
          <button
            type="button"
            data-testid="export-dropdown-button"
            onClick={() => setIsExportOpen((prev) => !prev)}
            className="inline-flex items-center gap-1.5 bg-[#24262b] hover:bg-[#2e3138] text-[#e6e8ea] px-3 py-1.5 rounded text-xs border border-[#35373c] shadow-lg transition-colors font-medium cursor-pointer"
            title="Export ERD diagram"
          >
            <Download className="w-3.5 h-3.5 text-[#3a82f7]" />
            <span>Export</span>
            <ChevronDown className="w-3 h-3 text-[#8c919a]" />
          </button>

          {isExportOpen && (
            <div
              data-testid="export-menu"
              className="absolute right-0 mt-1 w-44 bg-[#24262b] border border-[#35373c] rounded-md shadow-xl py-1 z-30"
            >
              <button
                type="button"
                data-testid="export-json-btn"
                onClick={handleExportJson}
                className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-[#e6e8ea] hover:bg-[#35373c] transition-colors text-left cursor-pointer"
              >
                <FileJson className="w-3.5 h-3.5 text-[#20c997]" />
                <span>Export JSON (.json)</span>
              </button>
              <button
                type="button"
                data-testid="export-svg-btn"
                onClick={handleExportSvg}
                className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-[#e6e8ea] hover:bg-[#35373c] transition-colors text-left cursor-pointer"
              >
                <FileCode className="w-3.5 h-3.5 text-[#3a82f7]" />
                <span>Export SVG (.svg)</span>
              </button>
              <button
                type="button"
                data-testid="export-png-btn"
                onClick={handleExportPng}
                className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-[#e6e8ea] hover:bg-[#35373c] transition-colors text-left cursor-pointer"
              >
                <ImageIcon className="w-3.5 h-3.5 text-[#e0a82e]" />
                <span>Export PNG (.png)</span>
              </button>
            </div>
          )}
        </div>
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
