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
  OnConnect,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';

import { TableNode } from './TableNode';
import { CrowsFootEdge } from './CrowsFootEdge';
import { StickyNoteNode, StickyNoteColor } from './StickyNoteNode';
import { GroupNode } from './GroupNode';
import { DatabaseSchema, Point, ErdNotationStyle, VirtualRelationship } from '../../types/database';
import {
  loadVirtualRelationships,
  addVirtualRelationship,
  removeVirtualRelationship,
} from '../../utils/virtualRelations';
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
  Network,
  StickyNote as StickyNoteIcon,
  Layers as LayersIcon,
  Search,
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
  /** @brief ERD edge notation visualization style ('crows-foot' | 'simple'). Defaults to 'crows-foot'. */
  notationStyle?: ErdNotationStyle;
  /** @brief Optional callback triggered when edge notation style is toggled. */
  onNotationStyleChange?: (style: ErdNotationStyle) => void;
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
  notationStyle: notationStyleProp,
  onNotationStyleChange,
}) => {
  // Register custom node types mapping
  const nodeTypes = useMemo(
    () => ({
      tableNode: TableNode,
      stickyNote: StickyNoteNode,
      domainGroup: GroupNode,
    }),
    []
  );
  // Register custom edge types mapping
  const edgeTypes = useMemo(() => ({ crowsFoot: CrowsFootEdge }), []);

  // ERD notation style state: Crow's Foot vs Simple smoothstep
  const [internalNotation, setInternalNotation] = useState<ErdNotationStyle>(
    notationStyleProp ?? 'crows-foot'
  );
  const activeNotation = notationStyleProp ?? internalNotation;

  useEffect(() => {
    if (notationStyleProp !== undefined) {
      setInternalNotation(notationStyleProp);
    }
  }, [notationStyleProp]);

  /**
   * @brief Toggles ERD edge notation style between Crow's Foot and Simple.
   */
  const handleToggleNotation = useCallback(() => {
    const nextStyle: ErdNotationStyle =
      activeNotation === 'crows-foot' ? 'simple' : 'crows-foot';
    if (onNotationStyleChange) {
      onNotationStyleChange(nextStyle);
    }
    setInternalNotation(nextStyle);
  }, [activeNotation, onNotationStyleChange]);

  // Virtual relationships persisted per database schema
  const [virtualRels, setVirtualRels] = useState<VirtualRelationship[]>(() =>
    loadVirtualRelationships(schema.database_name)
  );

  // Schema table filtering string query
  const [tableFilter, setTableFilter] = useState('');

  // Auxiliary canvas nodes (sticky notes, domain group containers)
  const [extraNodes, setExtraNodes] = useState<Node[]>([]);

  /**
   * @brief Updates text content of a sticky note node.
   */
  const handleUpdateNoteText = useCallback((id: string, text: string) => {
    setExtraNodes((prev) =>
      prev.map((n) => (n.id === id ? { ...n, data: { ...n.data, text } } : n))
    );
  }, []);

  /**
   * @brief Updates color variant of a sticky note node.
   */
  const handleUpdateNoteColor = useCallback((id: string, color: StickyNoteColor) => {
    setExtraNodes((prev) =>
      prev.map((n) => (n.id === id ? { ...n, data: { ...n.data, color } } : n))
    );
  }, []);

  /**
   * @brief Updates label of a domain group node.
   */
  const handleUpdateGroupLabel = useCallback((id: string, label: string) => {
    setExtraNodes((prev) =>
      prev.map((n) => (n.id === id ? { ...n, data: { ...n.data, label } } : n))
    );
  }, []);

  /**
   * @brief Deletes an auxiliary note or group node from canvas.
   */
  const handleDeleteExtraNode = useCallback((id: string) => {
    setExtraNodes((prev) => prev.filter((n) => n.id !== id));
  }, []);

  /**
   * @brief Adds a new sticky note to the canvas.
   */
  const handleAddStickyNote = useCallback(() => {
    const newId = `note_${Date.now()}`;
    const newNote: Node = {
      id: newId,
      type: 'stickyNote',
      position: { x: 100 + Math.random() * 40, y: 100 + Math.random() * 40 },
      data: {
        id: newId,
        title: 'Note',
        text: 'New annotation note',
        color: 'yellow',
        onChangeText: handleUpdateNoteText,
        onChangeColor: handleUpdateNoteColor,
        onDelete: handleDeleteExtraNode,
      },
    };
    setExtraNodes((prev) => [...prev, newNote]);
  }, [handleUpdateNoteText, handleUpdateNoteColor, handleDeleteExtraNode]);

  /**
   * @brief Adds a new domain group container frame to the canvas.
   */
  const handleAddGroup = useCallback(() => {
    const newId = `group_${Date.now()}`;
    const newGroup: Node = {
      id: newId,
      type: 'domainGroup',
      position: { x: 60 + Math.random() * 30, y: 60 + Math.random() * 30 },
      data: {
        id: newId,
        label: 'Domain Group',
        color: '#3b82f6',
        onChangeLabel: handleUpdateGroupLabel,
        onDelete: handleDeleteExtraNode,
      },
    };
    setExtraNodes((prev) => [...prev, newGroup]);
  }, [handleUpdateGroupLabel, handleDeleteExtraNode]);

  /**
   * @brief Constructs React Flow node models from current schema tables while preserving user drag positions.
   * @param existingNodes Optional array of previous node instances to retain coordinates from.
   * @return Array of React Flow TableNode and extra auxiliary objects.
   */
  const buildNodesFromSchema = useCallback(
    (existingNodes?: Node[]): Node[] => {
      const positionMap = new Map<string, Point>();
      if (existingNodes) {
        existingNodes.forEach((n) => {
          positionMap.set(n.id, n.position);
        });
      }

      const query = tableFilter.toLowerCase().trim();
      const filteredTables = schema.tables.filter((t) =>
        query ? t.name.toLowerCase().includes(query) : true
      );

      const tableNodes: Node[] = filteredTables.map((table, idx) => {
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

      const boundExtraNodes = extraNodes.map((n) => {
        if (n.type === 'stickyNote') {
          return {
            ...n,
            position: positionMap.get(n.id) || n.position,
            data: {
              ...n.data,
              onChangeText: handleUpdateNoteText,
              onChangeColor: handleUpdateNoteColor,
              onDelete: handleDeleteExtraNode,
            },
          };
        }
        if (n.type === 'domainGroup') {
          return {
            ...n,
            position: positionMap.get(n.id) || n.position,
            data: {
              ...n.data,
              onChangeLabel: handleUpdateGroupLabel,
              onDelete: handleDeleteExtraNode,
            },
          };
        }
        return n;
      });

      return [...boundExtraNodes, ...tableNodes];
    },
    [
      schema,
      tableFilter,
      extraNodes,
      onEditTable,
      handleUpdateNoteText,
      handleUpdateNoteColor,
      handleUpdateGroupLabel,
      handleDeleteExtraNode,
    ]
  );

  /**
   * @brief Generates animated foreign key relationship edges linking source and target column handles.
   * @return Array of React Flow Edge objects.
   */
  const buildEdgesFromSchema = useCallback((): Edge[] => {
    const edges: Edge[] = [];
    const query = tableFilter.toLowerCase().trim();
    const visibleTableNames = new Set(
      schema.tables
        .filter((t) => (query ? t.name.toLowerCase().includes(query) : true))
        .map((t) => t.name)
    );

    // 1. Physical database foreign keys
    schema.tables.forEach((table) => {
      if (!visibleTableNames.has(table.name)) return;
      table.foreign_keys.forEach((fk, fkIdx) => {
        if (!visibleTableNames.has(fk.target_table)) return;
        const edgeId =
          fk.constraint_name || `fk_${table.name}_${fk.source_column}_${fkIdx}`;
        edges.push({
          id: edgeId,
          source: table.name,
          sourceHandle: `${fk.source_column}-source`,
          target: fk.target_table,
          targetHandle: `${fk.target_column}-target`,
          animated: false,
          type: activeNotation === 'crows-foot' ? 'crowsFoot' : 'smoothstep',
          data: {
            cardinality: 'one-to-many',
            label: fk.constraint_name || undefined,
          },
          style: { stroke: '#20c997', strokeWidth: 1.5 },
        });
      });
    });

    // 2. Logical virtual relationships (diagram-only, purple dashed)
    virtualRels.forEach((vr) => {
      if (!visibleTableNames.has(vr.sourceTable) || !visibleTableNames.has(vr.targetTable)) return;
      edges.push({
        id: `vr_${vr.id}`,
        source: vr.sourceTable,
        sourceHandle: `${vr.sourceColumn}-source`,
        target: vr.targetTable,
        targetHandle: `${vr.targetColumn}-target`,
        animated: true,
        type: activeNotation === 'crows-foot' ? 'crowsFoot' : 'smoothstep',
        data: {
          cardinality: 'one-to-many',
          label: vr.name || 'Virtual FK',
        },
        style: { stroke: '#a855f7', strokeWidth: 1.5, strokeDasharray: '4,4' },
      });
    });

    return edges;
  }, [schema, activeNotation, virtualRels, tableFilter]);

  const [nodes, setNodes, onNodesChange] = useNodesState<Node>(
    buildNodesFromSchema()
  );
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>(
    buildEdgesFromSchema()
  );

  // Re-synchronize nodes and edges when schema or virtual relationships change
  useEffect(() => {
    setNodes((prev) => buildNodesFromSchema(prev));
    setVirtualRels(loadVirtualRelationships(schema.database_name));
  }, [schema, buildNodesFromSchema, setNodes]);

  useEffect(() => {
    setEdges(buildEdgesFromSchema());
  }, [buildEdgesFromSchema, setEdges]);

  /**
   * @brief Handles interactive edge connections between table column handles, creating a virtual relationship.
   */
  const handleConnect: OnConnect = useCallback(
    (params) => {
      if (!params.source || !params.target || !params.sourceHandle || !params.targetHandle) return;
      const sourceCol = params.sourceHandle.replace(/-source$/, '');
      const targetCol = params.targetHandle.replace(/-target$/, '');
      const newRel: VirtualRelationship = {
        id: `vr_${params.source}_${sourceCol}_${params.target}_${targetCol}_${Date.now()}`,
        sourceTable: params.source,
        sourceColumn: sourceCol,
        targetTable: params.target,
        targetColumn: targetCol,
        name: 'Virtual FK',
      };
      const updated = addVirtualRelationship(schema.database_name, newRel);
      setVirtualRels(updated);
    },
    [schema.database_name]
  );

  /**
   * @brief Removes virtual relationships when their corresponding canvas edge is deleted.
   */
  const handleEdgesDelete = useCallback(
    (deletedEdges: Edge[]) => {
      deletedEdges.forEach((e) => {
        if (e.id.startsWith('vr_')) {
          const rawId = e.id.replace(/^vr_/, '');
          removeVirtualRelationship(schema.database_name, rawId);
        }
      });
      setVirtualRels(loadVirtualRelationships(schema.database_name));
    },
    [schema.database_name]
  );

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
      if (node.type === 'tableNode' && onSelectTable) {
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
      if (node.type === 'tableNode') {
        onEditTable(node.id);
      }
    },
    [onEditTable]
  );

  /**
   * @brief Captures node drag stop event to notify parent of coordinate updates.
   */
  const handleNodeDragStop: OnNodeDrag<Node> = useCallback(
    (_event, node) => {
      if (node.type === 'tableNode' && onTablePositionChange) {
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
        {/* Table Filter Input */}
        <div className="relative flex items-center">
          <Search className="w-3.5 h-3.5 text-[#8c919a] absolute left-2.5 pointer-events-none" />
          <input
            type="text"
            data-testid="erd-table-filter-input"
            value={tableFilter}
            onChange={(e) => setTableFilter(e.target.value)}
            placeholder="Filter tables..."
            className="bg-[#24262b] hover:bg-[#2e3138] focus:bg-[#1e1f22] text-[#e6e8ea] placeholder-[#8c919a] pl-8 pr-2.5 py-1.5 rounded text-xs border border-[#35373c] focus:border-[#3a82f7] focus:outline-none transition-colors w-32 focus:w-44 shadow-lg font-medium"
          />
        </div>

        {/* Add Sticky Note Button */}
        <button
          type="button"
          data-testid="add-note-btn"
          onClick={handleAddStickyNote}
          className="inline-flex items-center gap-1.5 bg-[#24262b] hover:bg-[#2e3138] text-[#e6e8ea] px-3 py-1.5 rounded text-xs border border-[#35373c] shadow-lg transition-colors font-medium cursor-pointer"
          title="Add sticky note annotation"
        >
          <StickyNoteIcon className="w-3.5 h-3.5 text-amber-400" />
          <span>Add Note</span>
        </button>

        {/* Add Group Container Button */}
        <button
          type="button"
          data-testid="add-group-btn"
          onClick={handleAddGroup}
          className="inline-flex items-center gap-1.5 bg-[#24262b] hover:bg-[#2e3138] text-[#e6e8ea] px-3 py-1.5 rounded text-xs border border-[#35373c] shadow-lg transition-colors font-medium cursor-pointer"
          title="Add domain group container"
        >
          <LayersIcon className="w-3.5 h-3.5 text-[#3a82f7]" />
          <span>Add Group</span>
        </button>

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

        {/* Notation Style Toggle */}
        <button
          type="button"
          data-testid="notation-toggle-btn"
          onClick={handleToggleNotation}
          className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded text-xs border border-[#35373c] shadow-lg transition-colors font-medium cursor-pointer ${
            activeNotation === 'crows-foot'
              ? 'bg-[#20c997]/15 text-[#20c997] border-[#20c997]/40'
              : 'bg-[#24262b] hover:bg-[#2e3138] text-[#e6e8ea]'
          }`}
          title="Toggle ERD notation between Crow's Foot and Simple"
        >
          <Network className="w-3.5 h-3.5" />
          <span>
            {activeNotation === 'crows-foot'
              ? "Notation: Crow's Foot"
              : 'Notation: Simple'}
          </span>
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
        edgeTypes={edgeTypes}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={handleConnect}
        onEdgesDelete={handleEdgesDelete}
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
