# DynoDbModeler: Performance Optimization & Minimalist UI Design Specification

- **Date**: 2026-10-21
- **Status**: Approved
- **Target Version**: v0.3.1
- **Domain Citations**: 
  - `📍 .NET > Aspnetcore > Blazor > Performance > rendering > Virtualization`
  - `📍 Web > Glossary > Throttle / Debounce`
  - `📍 Avalonia > How-to > listbox-how-to > Virtualization`

---

## 1. Executive Summary & Goals

This specification defines the architectural enhancements for **DynoDbModeler** to achieve high-performance data rendering and a modern, distraction-free minimalist user interface.

### Key Objectives
1. **High-Performance Data Grid Virtualization**: Eliminate DOM overhead when browsing tables with 500 to 10,000+ rows by rendering only visible rows (`startIndex` to `endIndex` + overscan) with dynamic scroll position offsets, achieving stable 60 FPS scrolling and <15ms initial render time.
2. **Input Debouncing**: Prevent unnecessary re-filtering computations on large in-memory arrays during rapid typing in both the data grid and schema sidebar.
3. **Canvas Viewport Culling**: Enable view-frustum culling (`onlyRenderVisibleElements`) in React Flow to skip rendering table cards and SVG relationship edges located outside the camera viewport.
4. **Three-State Collapsible Sidebar**: Introduce a responsive sidebar supporting `expanded` (256px), `rail` (48px icon rail), and `zen` (0px full-screen mode) states with `Ctrl+B` / `Cmd+B` keyboard navigation.
5. **Ultra-Clean Minimalist Header**: Streamline the application header with single-pixel flat borders, subtle micro-status indicators, and unified theme-aware styling.
6. **Minimalist Floating Canvas Toolbar**: Consolidate dispersed ERD actions into a floating pill toolbar with `backdrop-blur-md` and micro-iconography.

---

## 2. Component Architecture & Detailed Design

```
+------------------------------------------------------------------------------------+
|                                    HeaderBar                                       |
|  [Logo] [ERD | SQL | Settings]         [Status Dot • DB]  [Theme]  [Zen/Sidebar]  |
+------------------------------------------------------------------------------------+
| Sidebar (48px / 256px / 0px) | Main Workspace Area                                 |
| - Mode: Expanded/Rail/Zen    |                                                     |
| - Fast Debounced Search      | [ERD Canvas]            OR   [EditableDataGrid]     |
| - Quick Actions              | - onlyRenderVisible          - Virtual Windowing    |
|                              | - Floating Pill Toolbar      - Fixed row height     |
|                              |                              - 60 FPS scrolling     |
+------------------------------------------------------------------------------------+
```

### 2.1. Virtual Windowing Data Grid Engine (`EditableDataGrid.tsx`)

#### Algorithm & Mechanics
- **Row Height ($h$)**: Fixed at $28\text{px}$ per row for predictable geometry.
- **Viewport Measurement**: Container ref attaches a passive `scroll` listener tracking `scrollTop` and container client height (`clientHeight`).
- **Index Calculation**:
  $$\text{startIndex} = \max\left(0, \lfloor \text{scrollTop} / h \rfloor - \text{overscan}\right)$$
  $$\text{endIndex} = \min\left(N, \lceil (\text{scrollTop} + \text{clientHeight}) / h \rceil + \text{overscan}\right)$$
  Where $N$ is the total row count, and $\text{overscan} = 6$.
- **Spacer Offsets**:
  - `paddingTop` = $\text{startIndex} \times h$
  - `paddingBottom` = $(N - \text{endIndex}) \times h$
- **DOM Footprint**: Even for 100,000 rows, only approximately 25-35 `<tr>` elements exist in the DOM at any given moment.

#### Cell Editing & Dirty State Preservation
- Editing state and dirty tracking map rows by their absolute original dataset index (`originalIndex`), ensuring editing focus and dirty highlights remain perfectly aligned across virtualized window boundaries.

### 2.2. Input Debouncing Subsystem (`useDebouncedValue`)

- Lightweight utility hook returning the debounced value after a delay:
  ```typescript
  export function useDebouncedValue<T>(value: T, delayMs: number = 150): T;
  ```
- Applied to:
  - `EditableDataGrid`: Filter text input.
  - `Sidebar`: Table name search filter.

### 2.3. ERD Canvas Viewport Culling (`ErdCanvas.tsx`)

- Pass `onlyRenderVisibleElements={true}` to `<ReactFlow>`.
- In large database schemas (30 to 100+ tables), tables situated outside the viewport boundary will not render DOM nodes or recalculate Crow's Foot SVG paths.
- Floating controls transformed from a stacked corner panel into an ergonomic floating pill toolbar:
  - Translucent background with `var(--color-bg-card)` and `backdrop-blur-md`.
  - Icon-only micro buttons (Layout, Crows-foot notation toggle, Export, Add Sticky Note, Add Table) with accessible tooltips.

### 2.4. Tri-State Sidebar System (`Sidebar.tsx`)

#### States
1. `'expanded'` ($256\text{px}$ / `w-64`): Full table list with column counts, search bar, schema groups, and management buttons.
2. `'rail'` ($48\text{px}$ / `w-12`): Compact vertical strip with database connection indicator, quick search trigger, refresh trigger, and bottom expand button. Tooltips on hover.
3. `'zen'` ($0\text{px}`): Completely hidden, maximizing canvas or query editor real estate.

#### Global Keyboard Shortcut
- `Ctrl+B` (Windows/Linux) / `Cmd+B` (macOS): Cycles or toggles between `expanded` and `rail`/`zen`.
- Also toggleable via a dedicated minimalist button in `HeaderBar` and at the base of the `Sidebar`.

### 2.5. Minimalist HeaderBar & Flat Styling

- Height: $40\text{px}$ (`h-10`).
- Status Badge: Replaced bulky pill cards with a sleek micro-dot indicator:
  - Online: Subtle glowing emerald dot (`w-2 h-2 rounded-full bg-emerald-500`).
  - Disconnected: Muted gray dot (`bg-[#8c919a]`).
  - Label: `Engine • Host/DB` with truncation.
- Seamless theme variable adherence without hardcoded color clashes.

---

## 3. Data Flow & State Management

```
User Action / Scroll / Keypress
       │
       ├─── Scroll in Grid ──► Virtualizer (recompute startIndex, endIndex) ──► Render ~30 rows
       │
       ├─── Type in Filter ──► useDebouncedValue (150ms) ──► Filter Array ──► Update Row Window
       │
       ├─── Press Ctrl+B ────► Toggle Sidebar State ('expanded' ◄► 'rail' / 'zen')
       │
       └─── Pan/Zoom Canvas ─► React Flow Frustum Culling (onlyRenderVisibleElements)
```

---

## 4. Error Handling & Edge Cases

1. **Empty / Filtered-Out Results**: When `filteredRows.length === 0`, virtual offsets reset cleanly to 0, rendering the empty state row without height distortion.
2. **Dynamic Window Resizing**: `ResizeObserver` on the grid container updates `clientHeight` dynamically when splitting views or opening drawers.
3. **Scroll Reset on Dataset Change**: When switching tables or re-executing SQL queries, `scrollTop` resets to 0 to prevent index out-of-bounds.
4. **Keyboard Navigation in Rail Mode**: All actions in Rail mode have `aria-label` attributes and keyboard focus outlines.

---

## 5. Verification & Testing Strategy

1. **Unit Tests (Vitest)**:
   - `useVirtualRows.test.ts`: Verify slice calculation, overscan bounds, top/bottom spacer heights.
   - `useDebouncedValue.test.ts`: Verify delay timer and cancellation on rapid changes.
   - `EditableDataGrid.test.tsx`: Verify rendering with 1,000 mock rows, cell selection, filter debouncing, and dirty state preservation.
   - `Sidebar.test.tsx`: Verify rendering in `expanded`, `rail`, and `zen` modes, toggle button callbacks.
   - `HeaderBar.test.tsx`: Verify micro-status indicator and sidebar toggle trigger.
2. **Regression Testing**:
   - Run entire Vitest test suite (`bun run test`) ensuring 100% pass rate.
   - Run Rust backend tests (`cargo test`) ensuring zero regressions.
   - Verify production build compilation (`tsc && vite build`).
