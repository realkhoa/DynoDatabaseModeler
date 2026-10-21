# DynoDbModeler UI Component Library

## Overview & Purpose
The `src/components` directory houses the core user interface component hierarchy for **DynoDbModeler**, a modern, dark-themed cross-platform database schema modeling, introspection, ERD diagramming, and SQL management client.

The component architecture follows a high-performance, minimalist design philosophy:
- **Tri-State Navigation Sidebar**: Dynamically switches between `expanded` (260px wide with full tree view), `rail` (52px icon-only rail for rapid switching), and `zen` (0px hidden for maximum canvas/query editor working space).
- **Minimalist HeaderBar**: Features a compact micro-status dot (`bg-emerald-500` with subtle ping animation for active connections, amber for reconnecting/idle), uncluttered workspace navigation, and a direct sidebar collapse/expand toggle button.
- **Floating Pill ERD Canvas Toolbar**: Ergonomically placed floating pill toolbar with backdrop blur (`backdrop-blur-md`), dark border, and rounded pill styling (`rounded-full`), leaving the canvas unobstructed while supporting Dagre auto layout, table creation, sticky notes, and domain group containers.
- **Viewport-Culled Canvas**: Off-screen diagram elements are excluded from DOM rendering via `@xyflow/react`'s `onlyRenderVisibleElements={true}` for 60fps panning across massive schemas.
- **Virtualized Tabular Data Grid**: `EditableDataGrid` utilizes custom windowing math (`useVirtualRows`) and input debouncing (`useDebouncedValue`) to handle tens of thousands of rows smoothly with zero browser lag.

---

## Prerequisites & Dependencies
- **Runtime**: Bun 1.2+ or Node.js 20+
- **Framework**: React 18+ (Hooks, Context, Functional Components)
- **Styling**: Tailwind CSS 3.4+ with custom semantic color variables (`hsl(var(--background))`, `hsl(var(--card))`, etc.)
- **Iconography**: `lucide-react`
- **Diagramming**: `@xyflow/react` (React Flow 12+)
- **Code Editor**: `@monaco-editor/react` (Monaco Editor)

---

## Component Architecture & API Reference

### Top-Level Layout Components

| Component | File | Responsibility & Props |
|---|---|---|
| `HeaderBar` | `HeaderBar.tsx` | Top application navigation bar. Renders connection indicator dot, database name/engine badge, view switch tabs, schema diff trigger with badge, and sidebar toggle. |
| `Sidebar` | `Sidebar.tsx` | Left-hand navigation panel supporting `expanded`, `rail`, and `zen` modes, debounced table search (150ms), and schema tree navigation. |
| `ErdView` | `ErdView.tsx` | Main container for the visual entity-relationship diagram workspace and table drawer. |
| `SqlQueryView` | `SqlQueryView.tsx` | Multi-worksheet SQL query console container with Monaco editor and query results. |
| `SettingsView` | `SettingsView.tsx` | Application preferences, theme selection, and system settings panel. |
| `ConnectionModal` | `ConnectionModal.tsx` | Dialog for configuring and testing database connections (PostgreSQL, MySQL, SQLite, MSSQL, Redis, MongoDB, etc.). |

### HeaderBar Props

```typescript
export interface HeaderBarProps {
  activeConnection: ConnectionConfig | null;
  activeView: 'erd' | 'query' | 'settings';
  onNavigate: (view: 'erd' | 'query' | 'settings') => void;
  onDisconnect: () => void;
  onOpenConnectionModal: () => void;
  onToggleSidebar?: () => void;
  sidebarMode?: 'expanded' | 'rail' | 'zen';
  diffCount?: number;
  onOpenDiffModal?: () => void;
  onOpenProcessList?: () => void;
}
```

- `activeConnection`: Current active database connection configuration or `null`.
- `sidebarMode`: Current sidebar state (`'expanded' | 'rail' | 'zen'`).
- `onToggleSidebar`: Callback invoked when clicking the sidebar toggle icon in the header.
- `diffCount`: Number of pending unapplied schema differences shown as a warning pill.

### Sidebar Modes & Props

```typescript
export type SidebarMode = 'expanded' | 'rail' | 'zen';

export interface SidebarProps {
  connection: ConnectionConfig | null;
  schema: DatabaseSchema | null;
  activeView: 'erd' | 'query' | 'settings';
  sidebarMode?: SidebarMode;
  onToggleMode?: (nextMode: SidebarMode) => void;
  onSelectView: (view: 'erd' | 'query' | 'settings') => void;
  onSelectTable: (tableName: string) => void;
  onOpenConnect: () => void;
  onInspectTable?: (tableName: string) => void;
  onQuickViewData?: (tableName: string) => void;
  isConnecting?: boolean;
  onOpenProcessList?: () => void;
}
```

- `expanded` (260px): Full sidebar with connection status card, search input, and table list with column badges.
- `rail` (52px): Compact icon-only rail for fast workspace switching and connection management without taking horizontal space.
- `zen` (0px): Completely collapsed sidebar hidden from DOM layout for distraction-free canvas modeling or SQL analysis. Press `Ctrl+B` (or `Cmd+B`) to toggle.

---

## Sub-Modules

### 1. Canvas Sub-Module (`src/components/canvas/`)
- See [`src/components/canvas/README.md`](file:///e:/sourcecode/DynoDbModeler/src/components/canvas/README.md) for full details.
- `ErdCanvas.tsx`: React Flow canvas with viewport culling (`onlyRenderVisibleElements={true}`) and floating pill toolbar.
- `TableNode.tsx`: Interactive table node with primary key, foreign key indicators, column types, and quick "View Data" button.
- `CrowsFootEdge.tsx`: Custom SVG relation connector with Crow's Foot cardinality markers.
- `StickyNoteNode.tsx`: Architectural sticky notes with 4 color themes.
- `GroupNode.tsx`: Domain cluster containers.
- `TableDrawer.tsx`: Slide-out panel for table structure editing.

### 2. Query Sub-Module (`src/components/query/`)
- See [`src/components/query/README.md`](file:///e:/sourcecode/DynoDbModeler/src/components/query/README.md) for full details.
- `EditableDataGrid.tsx`: Virtualized high-performance tabular grid for viewing and editing database query results. Employs `useVirtualRows` to calculate DOM slice and `useDebouncedValue` for instant filtering across thousands of rows.
- `QueryEditorTab.tsx`: Multi-tab SQL worksheet hosting Monaco Editor with syntax autocompletion and safety checks.
- `QueryWorksheetBar.tsx`: Worksheet tab management bar with dirty state warnings.
- `ExplainPlanModal.tsx`: Visual query execution plan analyzer.
- `ProcessListModal.tsx`: Active database threads and query killer dialog.
- `MockDataGeneratorModal.tsx`: Realistic mock data generation utility using Faker-like generators.
- `ScratchpadModal.tsx`: Reusable SQL snippet scratchpad.
- `TableStructureModal.tsx`: DDL preview and column schema inspector.
- `ValueInspectorDrawer.tsx`: JSON/XML/text deep value inspector drawer.

### 3. Diff Sub-Module (`src/components/diff/`)
- See [`src/components/diff/README.md`](file:///e:/sourcecode/DynoDbModeler/src/components/diff/README.md) for full details.
- `DiffModal.tsx`: Side-by-side schema diff comparison, migration script generator, and execution wizard.

---

## Usage Examples

### Example 1: Integrating Minimalist HeaderBar and Tri-State Sidebar

```tsx
import React, { useState, useEffect } from 'react';
import { HeaderBar } from './components/HeaderBar';
import { Sidebar, SidebarMode } from './components/Sidebar';

export const AppLayout: React.FC = () => {
  const [sidebarMode, setSidebarMode] = useState<SidebarMode>('expanded');
  const [activeView, setActiveView] = useState<'erd' | 'query' | 'settings'>('erd');

  // Global Ctrl+B / Cmd+B keyboard shortcut to toggle sidebar mode
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'b') {
        e.preventDefault();
        setSidebarMode((prev) => (prev === 'zen' ? 'expanded' : 'zen'));
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  return (
    <div className="flex h-screen w-screen flex-col bg-background text-foreground overflow-hidden">
      <HeaderBar
        activeConnection={activeConnection}
        activeView={activeView}
        onNavigate={setActiveView}
        onDisconnect={handleDisconnect}
        onOpenConnectionModal={() => setIsConnectModalOpen(true)}
        sidebarMode={sidebarMode}
        onToggleSidebar={() => setSidebarMode((m) => (m === 'zen' ? 'expanded' : 'zen'))}
      />
      <div className="flex flex-1 overflow-hidden relative">
        <Sidebar
          connection={activeConnection}
          schema={schema}
          activeView={activeView}
          sidebarMode={sidebarMode}
          onToggleMode={setSidebarMode}
          onSelectView={setActiveView}
          onSelectTable={handleTableSelect}
          onOpenConnect={() => setIsConnectModalOpen(true)}
        />
        <main className="flex-1 relative overflow-hidden">
          {activeView === 'erd' && <ErdView />}
          {activeView === 'query' && <SqlQueryView />}
        </main>
      </div>
    </div>
  );
};
```

### Example 2: Using Virtualized EditableDataGrid

```tsx
import React from 'react';
import { EditableDataGrid } from './components/query/EditableDataGrid';
import { QueryResult } from '../types/database';

export const TableDataViewer: React.FC<{ result: QueryResult }> = ({ result }) => {
  const handleSave = async (payload: RowUpdatePayload) => {
    await window.__TAURI_INTERNALS__.invoke('update_rows', { payload });
  };

  return (
    <div className="h-full w-full">
      <EditableDataGrid
        result={result}
        onSave={handleSave}
        pagination={{
          page: 1,
          pageSize: 50,
          totalRows: result.rows.length,
          onPageChange: (newPage) => console.log('Page:', newPage),
          onPageSizeChange: (newSize) => console.log('Page size:', newSize),
        }}
      />
    </div>
  );
};
```

---

## Directory Structure

```
src/components/
├── ConnectionFormFields.tsx      # Reusable form fields for host, port, user, TLS, SSH
├── ConnectionModal.tsx           # Database connection manager dialog
├── ConnectionModal.test.tsx      # Connection dialog unit tests
├── ErdView.tsx                   # ERD canvas view container
├── HeaderBar.tsx                 # Minimalist header navigation with micro-status dot
├── HeaderBar.test.tsx            # HeaderBar unit tests
├── SettingsView.tsx              # Settings and preferences view
├── Sidebar.tsx                   # Tri-state (expanded/rail/zen) sidebar with debounced search
├── Sidebar.test.tsx              # Sidebar unit tests
├── SqlQueryView.tsx              # SQL query worksheets and execution container
├── README.md                     # Component library documentation (this file)
├── canvas/                       # ERD canvas, custom nodes, edges, and drawers
│   ├── CrowsFootEdge.tsx         # Crow's Foot cardinality SVG edge
│   ├── ErdCanvas.tsx             # React Flow canvas with viewport culling & pill toolbar
│   ├── GroupNode.tsx             # Domain container node
│   ├── StickyNoteNode.tsx        # Annotation sticky note node
│   ├── TableDrawer.tsx           # Table inspector slide-out drawer
│   ├── TableNode.tsx             # Interactive schema table node
│   └── README.md                 # Canvas architecture documentation
├── diff/                         # Schema comparison & migration tools
│   ├── DiffModal.tsx             # Side-by-side diff inspection and migration execution
│   └── README.md                 # Diff engine documentation
└── query/                        # SQL editor, worksheets, grids, and modal tools
    ├── EditableDataGrid.tsx      # Virtualized tabular data grid with debounced search
    ├── ExplainPlanModal.tsx      # Visual EXPLAIN query plan modal
    ├── ExportModal.tsx           # Data export wizard (CSV, JSON, SQL)
    ├── MockDataGeneratorModal.tsx# Fake mock data generator modal
    ├── ProcessListModal.tsx      # Active DB threads and query killer dialog
    ├── QueryEditorTab.tsx        # Monaco editor SQL worksheet
    ├── QueryHistoryModal.tsx     # Query execution log and favorites
    ├── QueryWorksheetBar.tsx     # Worksheet tab switcher
    ├── ScratchpadModal.tsx       # Reusable SQL snippets modal
    ├── TableStructureModal.tsx   # DDL and table column inspector modal
    ├── ValueInspectorDrawer.tsx  # Drawer for inspecting large cells (JSON/text)
    └── README.md                 # Query components documentation
```

---

## Troubleshooting & Edge Cases

1. **Sidebar Collapsed Accidentally**:
   - If the sidebar is set to `zen` mode, the header displays an uncollapse toggle button (`PanelLeftOpen`), and pressing `Ctrl+B` (or `Cmd+B` on macOS) immediately expands it back to normal mode.
2. **Smooth Virtual Scrolling**:
   - In `EditableDataGrid`, row virtualization computes spacer padding dynamically. If rows appear to jump, ensure each row element adheres to the standard `36px` default row height or customize the `rowHeight` option accordingly.
3. **Canvas Performance on Massive Schemas**:
   - Ensure `onlyRenderVisibleElements={true}` remains enabled on `ErdCanvas`. When zooming out past 0.3x, React Flow renders smaller nodes with hardware-accelerated CSS transforms.
