# Interactive ERD Canvas Engine

## Overview & Purpose
The `canvas` module provides an interactive, dark-themed Entity-Relationship Diagram (ERD) canvas for **DynoDbModeler**, built on top of `@xyflow/react` and Dagre graph layout. It allows database engineers and architects to visualize relational structures, inspect foreign keys, annotate schemas with sticky notes, organize tables into domain groups, and model logical virtual relationships without modifying the physical database.

---

## Components Architecture

| Component | Responsibility |
|---|---|
| `ErdCanvas.tsx` | Main diagram container orchestrating React Flow, toolbar actions, edge routing, auto layout, and diagram export. |
| `TableNode.tsx` | Custom node rendering database tables, column names, data types, primary keys (🔑), foreign keys (🔗), and direct "View Data" (👁️) trigger button. |
| `CrowsFootEdge.tsx` | Custom SVG edge component rendering standard Crow's Foot cardinality notations (`||`, `|<`, `o<`). |
| `StickyNoteNode.tsx` | Sticky note annotations supporting 4 color palettes (yellow, blue, green, purple), inline editing, and deletion. |
| `GroupNode.tsx` | Bounding container frame for grouping related tables into domain modules (e.g., Auth, Billing). |
| `TableDrawer.tsx` | Slide-out panel to inspect, edit, or create table definitions, columns, and data types. |

---

## Key Capabilities

### 1. Direct Table Rows Inspection
- Every table node header features a direct **"View Data"** (`Eye`) icon button.
- Clicking the button automatically switches the workspace to the **SQL Query Editor**, generates a dialect-aware paginated query (`LIMIT 50 OFFSET 0` or `OFFSET 0 ROWS FETCH NEXT 50 ROWS ONLY`), and executes it immediately without manually writing SQL.

### 2. Crow's Foot Cardinality Notation
- Foreign keys can be rendered in two distinct styles via the canvas toolbar toggle:
  - **Crow's Foot**: End markers accurately illustrate zero-or-one, one-and-only-one, one-or-more, and zero-or-more cardinalities.
  - **Simple**: Clean smoothstep curves with foreign key constraint labels.

### 3. Virtual Relationships (Logical Foreign Keys)
- Users can drag an edge from any source column handle to a target column handle to create diagram-only relationships.
- Virtual relations are displayed with purple dashed lines (`#a855f7`) and persisted locally per database name in browser storage (`localStorage`).
- Deleting the edge on the canvas automatically cleans up the virtual relation.

### 4. Sticky Notes & Domain Group Frames
- Click **"Add Note"** to place an architectural annotation note adjacent to tables.
- Click **"Add Group"** to define a domain cluster (e.g., "Identity & Access").
- Double-click texts to edit inline; click palette icon to switch note colors.

### 5. Interactive Schema Filtering
- Use the **"Filter tables..."** input in the canvas toolbar to dynamically isolate specific tables in large enterprise schemas.
- Only matching tables and their interconnected relationship edges are rendered.

### 6. Multi-Format Diagram Export
- **JSON**: Exports complete normalized `DatabaseSchema` object.
- **SVG**: Serializes the `.react-flow__viewport` into a vector graphic.
- **PNG**: Converts canvas elements into high-resolution PNG raster image.

---

### 7. High-Performance Canvas Rendering
- **TableNode Custom Comparator**: `TableNode` is memoized with a custom comparison function checking table label, schema namespace, column count/definitions, foreign keys, and selection state. Dragging or selecting one table prevents all other unaffected tables from re-rendering.
- **O(1) Foreign Key Column Resolution**: Precomputes a `Set<string>` of foreign key column names using `useMemo`, eliminating the $O(Columns \times FKs)$ nested iteration bottleneck during column rendering.
- **Memoized Edge Notations**: Both `CardinalityMarker` and `CrowsFootEdge` are wrapped in `React.memo` to avoid re-evaluating SVG geometry and smoothstep bezier paths during unrelated canvas updates.

---

### 8. Full-Fidelity Visual Theme Synchronization
- **Zero Mismatch Across 4 Themes**: The ERD canvas and all node elements seamlessly adapt across:
  - **GitIngest Theme**: Warm cream paper background (`#faf8f5`), amber edge accents (`#ea580c`), light card surfaces, and subtle warm borders.
  - **Dark (Default Dyno)**: Minimalist dark charcoal (`#1e1f22`), deep card backgrounds (`#24262b`), and electric blue accents (`#3a82f7`).
  - **GitHub Light**: Clean white background (`#ffffff`), light gray cards, and crisp blue accents (`#0969da`).
  - **Midnight OLED**: Pitch black background (`#000000`), deep dark frames, and neon cyan accents (`#00f0ff`).
- **Dynamic Element Adaptations**:
  - `TableNode`: Headers, borders, column hover rows, and handle rings dynamically synchronize with active theme CSS variables (`--color-bg-card-header`, `--color-border-card`, `--color-bg-hover`).
  - `CrowsFootEdge`: Cardinality circle cutouts use `fill="var(--color-bg-base)"` eliminating dark circles on cream/white backgrounds; edge labels use theme surface colors and subtle borders.
  - `GroupNode` & `StickyNoteNode`: Domain containers and sticky notes feature light-paper variants in light mode (soft yellow, blue, green, purple post-it notes with dark text) and rich translucent variants in dark mode.
  - `Controls` & `MiniMap`: Zoom buttons, fit-view icons, and minimap masks automatically adjust backgrounds, icons, and contrast.

---

## Testing & Quality Verification

Run unit and component tests with Vitest:
```bash
bun run test src/components/canvas
```
