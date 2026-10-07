# Canvas Component Module (`src/components/canvas`)

## 1. Overview & Purpose
The `canvas` module provides the core visual modeling workspace for **DynoDbModeler**. Powered by `@xyflow/react`, this module renders interactive Entity-Relationship Diagrams (ERD) allowing database engineers and developers to visually design, inspect, and organize relational database schemas.

Key responsibilities:
- **Interactive ERD Canvas (`ErdCanvas.tsx`)**: Renders table cards, foreign key edges, domain group frames, sticky notes, mini-map, pan/zoom controls, and hierarchical auto-layout via Dagre.
- **Table Node Representation (`TableNode.tsx`)**: Displays table metadata, columns, data types, primary keys, and foreign key connector handles.
- **Crow's Foot Cardinality Notation (`CrowsFootEdge.tsx`)**: Renders formal database cardinality symbols (one-and-only-one `||`, zero-or-one `o|`, one-or-more `|<`, zero-or-more `o<`) matching industry standards (DBeaver, ERWin, MySQL Workbench).
- **Domain Framing (`GroupNode.tsx`)**: Visually groups related database entities into domains (e.g., Auth, Billing, Catalog).
- **Architectural Annotations (`StickyNoteNode.tsx`)**: Allows annotating entity designs with inline Markdown-capable sticky notes.
- **Table Structure Editor (`TableDrawer.tsx`)**: Side drawer for modifying table columns, constraints, and data types.

---

## 2. Prerequisites & Dependencies
- **Runtimes & Build Tools**:
  - [Bun](https://bun.sh/) (v1.2+) or Node.js (v20+)
  - [Vite](https://vitejs.dev/) (v6+) with React 19 and TypeScript 5.7+
  - Rust & Cargo (v1.80+) for Tauri backend
- **Primary NPM Libraries**:
  - `@xyflow/react` (`^12.4.2`): Graph layout engine, custom nodes, handles, and edge rendering
  - `dagre` (`^0.8.5`): Directed graph hierarchical auto-layout algorithm
  - `lucide-react` (`^1.16.0`): Iconography for toolbar controls, keys, and indicators
  - `clsx` & `tailwind-merge`: CSS class merging utilities

---

## 3. Component Props & Options Reference

### `ErdCanvasProps` (`ErdCanvas.tsx`)
| Property | Type | Default | Description |
| :--- | :--- | :--- | :--- |
| `schema` | `DatabaseSchema` | *Required* | Complete database schema object containing tables, columns, indexes, and foreign keys. |
| `onEditTable` | `(tableName: string) => void` | *Required* | Callback triggered when user requests editing or inspecting a table entity. |
| `onSelectTable` | `(tableName: string) => void` | `undefined` | Optional callback triggered when a table node card is selected. |
| `onAddNewTable` | `() => void` | `undefined` | Optional callback triggered to open the creation drawer for new tables. |
| `onTablePositionChange` | `(table: string, pos: Point) => void` | `undefined` | Optional callback triggered when a node position changes after dragging. |
| `onOpenDiff` | `() => void` | `undefined` | Optional callback triggered to inspect pending schema diffs and execute migrations. |
| `pendingChangesCount` | `number` | `0` | Number of unapplied changes shown in toolbar badge. |
| `notationStyle` | `ErdNotationStyle` | `'crows-foot'` | Controlled notation style: `'crows-foot'` or `'simple'`. |
| `onNotationStyleChange` | `(style: ErdNotationStyle) => void` | `undefined` | Callback fired when the user toggles notation style on the canvas toolbar. |

### `CrowsFootEdgeData` (`CrowsFootEdge.tsx`)
| Property | Type | Default | Description |
| :--- | :--- | :--- | :--- |
| `cardinality` | `CardinalityType` | `'one-to-many'` | High-level association type (`'one-to-one'`, `'one-to-many'`, `'many-to-many'`, `'zero-to-one'`, `'zero-to-many'`). |
| `sourceCardinality` | `'one' \| 'zero-or-one' \| 'many'` | Derived | Explicit symbol override rendered at source handle (`||`, `o|`, `|<`). |
| `targetCardinality` | `'one' \| 'many' \| 'zero-or-many'` | Derived | Explicit symbol override rendered at target handle (`|`, `|<`, `o<`). |
| `label` | `string` | `undefined` | Optional relationship or constraint name shown in a middle label pill. |

### Crow's Foot Glyph Mappings
| Relationship Variant | Source Marker Glyph | Target Marker Glyph | Visual Notation |
| :--- | :--- | :--- | :--- |
| `one-to-one` | `||` (Double bar) | `\|` (Vertical bar) | Mandatory one to one |
| `one-to-many` (Default) | `||` (Double bar) | `\|<` (Fork + bar) | One to many |
| `many-to-many` | `\|<` (Fork + bar) | `\|<` (Fork + bar) | Many to many |
| `zero-to-one` | `o\|` (Circle + bar) | `\|` (Vertical bar) | Optional zero/one to one |
| `zero-to-many` | `o\|` (Circle + bar) | `o<` (Circle + fork) | Optional zero/one to many |

---

## 4. Usage Examples

### Example 1: Integrating `ErdCanvas` with Crow's Foot Notation
```tsx
import React, { useState } from 'react';
import { ErdCanvas } from '@/components/canvas/ErdCanvas';
import type { DatabaseSchema, ErdNotationStyle } from '@/types/database';

export const MySchemaView: React.FC<{ schema: DatabaseSchema }> = ({ schema }) => {
  const [notation, setNotation] = useState<ErdNotationStyle>('crows-foot');

  return (
    <div className="w-screen h-screen">
      <ErdCanvas
        schema={schema}
        notationStyle={notation}
        onNotationStyleChange={setNotation}
        onEditTable={(tableName) => console.log('Edit table:', tableName)}
      />
    </div>
  );
};
```

### Example 2: Customizing Crow's Foot Edge in React Flow
```tsx
import { ReactFlow, Position } from '@xyflow/react';
import { CrowsFootEdge } from '@/components/canvas/CrowsFootEdge';

const edgeTypes = { crowsFoot: CrowsFootEdge };

const customEdges = [
  {
    id: 'fk_users_orders',
    source: 'users',
    sourceHandle: 'id-source',
    target: 'orders',
    targetHandle: 'user_id-target',
    type: 'crowsFoot',
    data: {
      cardinality: 'one-to-many',
      label: 'fk_orders_user',
    },
    style: { stroke: '#20c997', strokeWidth: 1.5 },
  },
];
```

---

## 5. Output Structure & Schema
The canvas module integrates with the following repository structures:
```
src/
├── components/
│   └── canvas/
│       ├── CrowsFootEdge.tsx         # Crow's Foot SVG custom edge component
│       ├── CrowsFootEdge.test.tsx    # Vitest suite for cardinality rendering
│       ├── ErdCanvas.tsx             # Main interactive ERD diagram canvas
│       ├── ErdCanvas.test.tsx        # Vitest suite for canvas controls & toggles
│       ├── TableNode.tsx             # Custom table node card with column list
│       ├── TableNode.test.tsx        # Vitest suite for table node card
│       ├── TableDrawer.tsx           # Drawer for column & constraint editing
│       ├── TableDrawer.test.tsx      # Vitest suite for table editor drawer
│       ├── GroupNode.tsx             # Domain boundary frames
│       ├── StickyNoteNode.tsx        # Canvas sticky note annotations
│       └── README.md                 # This documentation file
└── types/
    └── database.ts                   # CardinalityType, ErdNotationStyle, Point, Schema types
```

---

## 6. Troubleshooting & Edge Cases

### Marker Rotation & Handle Docking
- **Issue**: Markers rendering inside the table card or inverted.
- **Root Cause**: Handle docking position orientation mismatch.
- **Solution**: The `getMarkerRotation(position)` utility normalizes docking directions:
  - `Position.Left`: 0° (marker extends leftward along trajectory)
  - `Position.Right`: 180° (marker extends rightward along trajectory)
  - `Position.Top`: 90° (marker extends upward along trajectory)
  - `Position.Bottom`: 270° (marker extends downward along trajectory)

### Transparent / Overlapping Center Line in Circles
- **Issue**: The edge path line passes through the hollow center of optional cardinality circles (`o|`, `o<`).
- **Solution**: The circles in `CardinalityMarker` use `fill="#1e1f22"` (matching the canvas background color) to mask the underlying edge stroke.

### Missing Index Signature in TypeScript Build
- **Issue**: `Type 'CrowsFootEdgeData' does not satisfy the constraint 'Record<string, unknown>'`.
- **Solution**: `CrowsFootEdgeData` explicitly extends `Record<string, unknown>` to comply with `@xyflow/react` v12 generic constraints.
