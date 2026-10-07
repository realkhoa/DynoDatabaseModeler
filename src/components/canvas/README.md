# Interactive ERD Canvas Engine

## Overview & Purpose
The `canvas` module provides an interactive, dark-themed Entity-Relationship Diagram (ERD) canvas for **DynoDbModeler**, built on top of `@xyflow/react` and Dagre graph layout. It allows database engineers and architects to visualize relational structures, inspect foreign keys, annotate schemas with sticky notes, organize tables into domain groups, and model logical virtual relationships without modifying the physical database.

---

## Components Architecture

| Component | Responsibility |
|---|---|
| `ErdCanvas.tsx` | Main diagram container orchestrating React Flow, toolbar actions, edge routing, auto layout, and diagram export. |
| `TableNode.tsx` | Custom node rendering database tables, column names, data types, primary keys (🔑), and foreign keys (🔗). |
| `CrowsFootEdge.tsx` | Custom SVG edge component rendering standard Crow's Foot cardinality notations (`||`, `|<`, `o<`). |
| `StickyNoteNode.tsx` | Sticky note annotations supporting 4 color palettes (yellow, blue, green, purple), inline editing, and deletion. |
| `GroupNode.tsx` | Bounding container frame for grouping related tables into domain modules (e.g., Auth, Billing). |
| `TableDrawer.tsx` | Slide-out panel to inspect, edit, or create table definitions, columns, and data types. |

---

## Key Capabilities

### 1. Crow's Foot Cardinality Notation
- Foreign keys can be rendered in two distinct styles via the canvas toolbar toggle:
  - **Crow's Foot**: End markers accurately illustrate zero-or-one, one-and-only-one, one-or-more, and zero-or-more cardinalities.
  - **Simple**: Clean smoothstep curves with foreign key constraint labels.

### 2. Virtual Relationships (Logical Foreign Keys)
- Users can drag an edge from any source column handle to a target column handle to create diagram-only relationships.
- Virtual relations are displayed with purple dashed lines (`#a855f7`) and persisted locally per database name in browser storage (`localStorage`).
- Deleting the edge on the canvas automatically cleans up the virtual relation.

### 3. Sticky Notes & Domain Group Frames
- Click **"Add Note"** to place an architectural annotation note adjacent to tables.
- Click **"Add Group"** to define a domain cluster (e.g., "Identity & Access").
- Double-click texts to edit inline; click palette icon to switch note colors.

### 4. Interactive Schema Filtering
- Use the **"Filter tables..."** input in the canvas toolbar to dynamically isolate specific tables in large enterprise schemas.
- Only matching tables and their interconnected relationship edges are rendered.

### 5. Multi-Format Diagram Export
- **JSON**: Exports complete normalized `DatabaseSchema` object.
- **SVG**: Serializes the `.react-flow__viewport` into a vector graphic.
- **PNG**: Converts canvas elements into high-resolution PNG raster image.

---

## Testing & Quality Verification

Run unit and component tests with Vitest:
```bash
bun run test src/components/canvas
```
