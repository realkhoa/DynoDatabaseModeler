# DynoDbModeler Performance Optimization & Minimalist UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement high-performance data grid virtualization, input debouncing, React Flow viewport culling, and a sleek minimalist UI featuring a tri-state collapsible sidebar (expanded/rail/zen) with `Ctrl+B` shortcut and flat header.

**Architecture:** A lightweight custom virtual windowing hook calculates visible row ranges and spacer offsets based on container scroll geometry for `EditableDataGrid`. An input debounce utility prevents rapid filter re-computation. `ErdCanvas` enables frustum culling via `onlyRenderVisibleElements`. The application shell coordinates a tri-state responsive sidebar with flat, theme-synchronized minimalist navigation.

**Tech Stack:** React 19, TypeScript, Vitest, `@testing-library/react`, `@xyflow/react`, Tailwind CSS, Lucide icons.

## Global Constraints

- 100% TSDoc / Doxygen comments (`@brief`, `@param`, `@return`) for all new functions, interfaces, and methods.
- TDD cycle: failing test -> run test (fails) -> implementation -> run test (passes) -> commit.
- Zero regression: All 392+ frontend tests and 90 Rust backend tests must pass cleanly.
- Strict English for all code, comments, identifiers, tests, and documentation artifacts.

---

### Task 1: Debounced Value Hook (`useDebouncedValue`)

**Files:**
- Create: `src/utils/useDebouncedValue.ts`
- Test: `src/utils/useDebouncedValue.test.ts`

**Interfaces:**
- Produces: `useDebouncedValue<T>(value: T, delayMs?: number): T`

- [ ] **Step 1: Write the failing test**

Create `src/utils/useDebouncedValue.test.ts`:
```typescript
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useDebouncedValue } from './useDebouncedValue';

describe('useDebouncedValue', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('should return initial value immediately', () => {
    const { result } = renderHook(() => useDebouncedValue('initial', 150));
    expect(result.current).toBe('initial');
  });

  it('should debounce rapid value updates until delay expires', () => {
    const { result, rerender } = renderHook(
      ({ val, delay }) => useDebouncedValue(val, delay),
      { initialProps: { val: 'first', delay: 150 } }
    );

    expect(result.current).toBe('first');

    rerender({ val: 'second', delay: 150 });
    expect(result.current).toBe('first');

    act(() => {
      vi.advanceTimersByTime(100);
    });
    expect(result.current).toBe('first');

    act(() => {
      vi.advanceTimersByTime(50);
    });
    expect(result.current).toBe('second');
  });

  it('should cancel previous pending timer when new value arrives', () => {
    const { result, rerender } = renderHook(
      ({ val, delay }) => useDebouncedValue(val, delay),
      { initialProps: { val: 'a', delay: 150 } }
    );

    rerender({ val: 'b', delay: 150 });
    act(() => {
      vi.advanceTimersByTime(100);
    });

    rerender({ val: 'c', delay: 150 });
    act(() => {
      vi.advanceTimersByTime(100);
    });
    expect(result.current).toBe('a');

    act(() => {
      vi.advanceTimersByTime(50);
    });
    expect(result.current).toBe('c');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun run test src/utils/useDebouncedValue.test.ts`
Expected: FAIL with module not found or export missing.

- [ ] **Step 3: Write minimal implementation**

Create `src/utils/useDebouncedValue.ts`:
```typescript
/**
 * @file useDebouncedValue.ts
 * @brief React hook that debounces a rapidly changing value by a specified duration.
 * @details Prevents expensive re-filtering or recalculations while user is typing in search inputs.
 */

import { useState, useEffect } from 'react';

/**
 * @brief Delays updating the returned value until specified time has elapsed since last change.
 * @template T Type of the value being debounced.
 * @param value The value to debounce.
 * @param delayMs Delay in milliseconds before updating value. Defaults to 150ms.
 * @return The debounced value.
 */
export function useDebouncedValue<T>(value: T, delayMs: number = 150): T {
  const [debouncedValue, setDebouncedValue] = useState<T>(value);

  useEffect(() => {
    const handler = setTimeout(() => {
      setDebouncedValue(value);
    }, delayMs);

    return () => {
      clearTimeout(handler);
    };
  }, [value, delayMs]);

  return debouncedValue;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun run test src/utils/useDebouncedValue.test.ts`
Expected: PASS (3 tests passing).

- [ ] **Step 5: Commit**

```bash
git add src/utils/useDebouncedValue.ts src/utils/useDebouncedValue.test.ts
git commit -m "feat(utils): add useDebouncedValue hook with unit tests"
```

---

### Task 2: Virtual Row Windowing Hook (`useVirtualRows`)

**Files:**
- Create: `src/utils/useVirtualRows.ts`
- Test: `src/utils/useVirtualRows.test.ts`

**Interfaces:**
- Produces:
  ```typescript
  export interface VirtualRowsOptions {
    totalCount: number;
    rowHeight: number;
    containerHeight: number;
    scrollTop: number;
    overscan?: number;
  }
  export interface VirtualRowsResult {
    startIndex: number;
    endIndex: number;
    topPadding: number;
    bottomPadding: number;
    visibleIndices: number[];
  }
  export function computeVirtualRows(options: VirtualRowsOptions): VirtualRowsResult;
  export function useVirtualRows(options: {
    totalCount: number;
    rowHeight: number;
    containerRef: React.RefObject<HTMLElement | null>;
    overscan?: number;
  }): VirtualRowsResult & { onScroll: React.UIEventHandler<HTMLElement> };
  ```

- [ ] **Step 1: Write the failing test**

Create `src/utils/useVirtualRows.test.ts`:
```typescript
import { describe, it, expect } from 'vitest';
import { computeVirtualRows } from './useVirtualRows';

describe('computeVirtualRows', () => {
  it('should return empty bounds when totalCount is 0', () => {
    const result = computeVirtualRows({
      totalCount: 0,
      rowHeight: 28,
      containerHeight: 280,
      scrollTop: 0,
      overscan: 5,
    });

    expect(result.startIndex).toBe(0);
    expect(result.endIndex).toBe(0);
    expect(result.topPadding).toBe(0);
    expect(result.bottomPadding).toBe(0);
    expect(result.visibleIndices).toEqual([]);
  });

  it('should calculate visible rows with overscan at top of scroll', () => {
    const result = computeVirtualRows({
      totalCount: 100,
      rowHeight: 28,
      containerHeight: 280, // fits 10 rows
      scrollTop: 0,
      overscan: 2,
    });

    expect(result.startIndex).toBe(0);
    expect(result.endIndex).toBe(12); // 10 visible + 2 overscan
    expect(result.topPadding).toBe(0);
    expect(result.bottomPadding).toBe((100 - 12) * 28);
    expect(result.visibleIndices.length).toBe(12);
  });

  it('should calculate middle window correctly with top and bottom overscan', () => {
    const result = computeVirtualRows({
      totalCount: 100,
      rowHeight: 28,
      containerHeight: 280, // fits 10 rows
      scrollTop: 560, // scrolled 20 rows down
      overscan: 2,
    });

    // 20 visible start, -2 overscan = 18
    expect(result.startIndex).toBe(18);
    // 20 + 10 visible + 2 overscan = 32
    expect(result.endIndex).toBe(32);
    expect(result.topPadding).toBe(18 * 28);
    expect(result.bottomPadding).toBe((100 - 32) * 28);
    expect(result.visibleIndices[0]).toBe(18);
    expect(result.visibleIndices[result.visibleIndices.length - 1]).toBe(31);
  });

  it('should clamp bounds properly at the bottom of the dataset', () => {
    const result = computeVirtualRows({
      totalCount: 100,
      rowHeight: 28,
      containerHeight: 280,
      scrollTop: 2800, // at or near bottom
      overscan: 4,
    });

    expect(result.endIndex).toBe(100);
    expect(result.bottomPadding).toBe(0);
    expect(result.startIndex).toBeGreaterThanOrEqual(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun run test src/utils/useVirtualRows.test.ts`
Expected: FAIL with module not found or export missing.

- [ ] **Step 3: Write minimal implementation**

Create `src/utils/useVirtualRows.ts`:
```typescript
/**
 * @file useVirtualRows.ts
 * @brief High-performance virtual windowing calculation and hook for large data tables.
 * @details Calculates visible row slice and CSS spacers to keep DOM nodes minimal and scrolling at 60 FPS.
 */

import { useState, useCallback, useEffect, useMemo } from 'react';

/**
 * @brief Parameters required to compute virtual row boundaries.
 */
export interface VirtualRowsOptions {
  /** @brief Total count of rows in the current filtered/paginated dataset. */
  totalCount: number;
  /** @brief Fixed row height in pixels. */
  rowHeight: number;
  /** @brief Visible height of the scroll container in pixels. */
  containerHeight: number;
  /** @brief Current vertical scroll offset of the container in pixels. */
  scrollTop: number;
  /** @brief Number of buffer rows rendered above and below the visible viewport. */
  overscan?: number;
}

/**
 * @brief Result containing calculated slice indices and CSS spacer heights.
 */
export interface VirtualRowsResult {
  /** @brief Zero-based starting index in the row array to render. */
  startIndex: number;
  /** @brief Zero-based ending index (exclusive) in the row array to render. */
  endIndex: number;
  /** @brief Height of top spacer in pixels. */
  topPadding: number;
  /** @brief Height of bottom spacer in pixels. */
  bottomPadding: number;
  /** @brief Array of sequential indices currently within the active render window. */
  visibleIndices: number[];
}

/**
 * @brief Computes visible row boundaries and spacer dimensions mathematically.
 * @param options Virtual calculation configuration parameters.
 * @return VirtualRowsResult with indices and padding dimensions.
 */
export function computeVirtualRows({
  totalCount,
  rowHeight,
  containerHeight,
  scrollTop,
  overscan = 5,
}: VirtualRowsOptions): VirtualRowsResult {
  if (totalCount <= 0 || rowHeight <= 0) {
    return {
      startIndex: 0,
      endIndex: 0,
      topPadding: 0,
      bottomPadding: 0,
      visibleIndices: [],
    };
  }

  const effectiveContainerHeight = Math.max(containerHeight, rowHeight);
  const rawStart = Math.floor(scrollTop / rowHeight);
  const rawEnd = Math.ceil((scrollTop + effectiveContainerHeight) / rowHeight);

  const startIndex = Math.max(0, rawStart - overscan);
  const endIndex = Math.min(totalCount, rawEnd + overscan);

  const topPadding = startIndex * rowHeight;
  const bottomPadding = Math.max(0, (totalCount - endIndex) * rowHeight);

  const visibleIndices: number[] = [];
  for (let i = startIndex; i < endIndex; i++) {
    visibleIndices.push(i);
  }

  return {
    startIndex,
    endIndex,
    topPadding,
    bottomPadding,
    visibleIndices,
  };
}

/**
 * @brief React hook managing container scroll listener, resize observation, and virtual windowing state.
 * @param options Hook options including total count, row height, and container ref.
 * @return Computed virtual rows result and scroll event handler.
 */
export function useVirtualRows(options: {
  totalCount: number;
  rowHeight: number;
  containerRef: React.RefObject<HTMLElement | null>;
  overscan?: number;
}): VirtualRowsResult & { onScroll: React.UIEventHandler<HTMLElement> } {
  const { totalCount, rowHeight, containerRef, overscan = 5 } = options;
  const [scrollTop, setScrollTop] = useState(0);
  const [containerHeight, setContainerHeight] = useState(400);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    setContainerHeight(el.clientHeight || 400);

    const resizeObserver = new ResizeObserver((entries) => {
      for (const entry of entries) {
        if (entry.contentRect.height > 0) {
          setContainerHeight(entry.contentRect.height);
        }
      }
    });

    resizeObserver.observe(el);
    return () => {
      resizeObserver.disconnect();
    };
  }, [containerRef]);

  const onScroll: React.UIEventHandler<HTMLElement> = useCallback((e) => {
    setScrollTop(e.currentTarget.scrollTop);
  }, []);

  const virtualBounds = useMemo(() => {
    return computeVirtualRows({
      totalCount,
      rowHeight,
      containerHeight,
      scrollTop,
      overscan,
    });
  }, [totalCount, rowHeight, containerHeight, scrollTop, overscan]);

  return {
    ...virtualBounds,
    onScroll,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun run test src/utils/useVirtualRows.test.ts`
Expected: PASS (4 tests passing).

- [ ] **Step 5: Commit**

```bash
git add src/utils/useVirtualRows.ts src/utils/useVirtualRows.test.ts
git commit -m "feat(utils): add useVirtualRows hook and virtualization calculations"
```

---

### Task 3: Integrate Virtual Windowing & Debounced Filter in `EditableDataGrid`

**Files:**
- Modify: `src/components/query/EditableDataGrid.tsx`
- Test: `src/components/query/EditableDataGrid.test.tsx`

**Interfaces:**
- Consumes:
  - `useVirtualRows` from `src/utils/useVirtualRows`
  - `useDebouncedValue` from `src/utils/useDebouncedValue`
- Preserves:
  - Existing `EditableDataGridProps`, `EditableDataGridHandle`, `onSave`, `dirtyCount`, `onCellSelect`

- [ ] **Step 1: Write tests for virtual rendering in `EditableDataGrid.test.tsx`**

Add test cases in `src/components/query/EditableDataGrid.test.tsx`:
```typescript
it('renders large dataset efficiently with virtual windowing', () => {
  const columns = ['id', 'name', 'value'];
  const largeRows = Array.from({ length: 500 }, (_, i) => [i + 1, `Item ${i + 1}`, i * 10]);

  const { container } = render(
    <EditableDataGrid
      columns={columns}
      rows={largeRows}
    />
  );

  // Instead of 500 rows in DOM, only visible window + overscan rows are present
  const domRows = container.querySelectorAll('tbody tr');
  expect(domRows.length).toBeLessThan(100);
  expect(domRows.length).toBeGreaterThan(0);
});

it('filters large dataset with debounced search input', async () => {
  const columns = ['id', 'name'];
  const rows = [
    [1, 'Alice'],
    [2, 'Bob'],
    [3, 'Charlie'],
  ];

  render(<EditableDataGrid columns={columns} rows={rows} />);

  const filterInput = screen.getByTestId('grid-filter-input');
  fireEvent.change(filterInput, { target: { value: 'Bob' } });

  // With debounce, wait for debounced update
  await waitFor(() => {
    expect(screen.getByText('Showing 1 of 3 rows')).toBeInTheDocument();
  });
  expect(screen.getByText('Bob')).toBeInTheDocument();
  expect(screen.queryByText('Alice')).not.toBeInTheDocument();
});
```

- [ ] **Step 2: Run test to verify it fails or runs**

Run: `bun run test src/components/query/EditableDataGrid.test.tsx`

- [ ] **Step 3: Modify `EditableDataGrid.tsx`**

Integrate `useDebouncedValue` for `filterText` and `useVirtualRows` for the scrollable container.
Add top and bottom spacers in `<tbody>`:
```tsx
{topPadding > 0 && (
  <tr style={{ height: `${topPadding}px` }} aria-hidden="true">
    <td colSpan={columns.length} style={{ padding: 0, border: 0 }} />
  </tr>
)}
{visibleRows.map(({ row, originalIndex }) => (
  <GridRow
    key={originalIndex}
    rIdx={originalIndex}
    row={row}
    columns={columns}
    // ... preserved handlers
  />
))}
{bottomPadding > 0 && (
  <tr style={{ height: `${bottomPadding}px` }} aria-hidden="true">
    <td colSpan={columns.length} style={{ padding: 0, border: 0 }} />
  </tr>
)}
```
Ensure row height is $28\text{px}$, and attach `onScroll` to the scroll container `div`.

- [ ] **Step 4: Run tests to verify all pass**

Run: `bun run test src/components/query/EditableDataGrid.test.tsx`
Expected: PASS (all tests pass).

- [ ] **Step 5: Commit**

```bash
git add src/components/query/EditableDataGrid.tsx src/components/query/EditableDataGrid.test.tsx
git commit -m "perf(grid): virtualize row rendering and debounce filtering in EditableDataGrid"
```

---

### Task 4: Tri-State Responsive Sidebar (`Sidebar.tsx`)

**Files:**
- Modify: `src/components/Sidebar.tsx`
- Test: `src/components/Sidebar.test.tsx`

**Interfaces:**
- Consumes: `useDebouncedValue` from `src/utils/useDebouncedValue`
- Produces:
  ```typescript
  export type SidebarMode = 'expanded' | 'rail' | 'zen';
  export interface SidebarProps {
    // ... existing props
    mode?: SidebarMode;
    onToggleMode?: (nextMode: SidebarMode) => void;
  }
  ```

- [ ] **Step 1: Write unit tests for `SidebarMode` in `Sidebar.test.tsx`**

Verify:
- In `expanded` mode, renders 256px width, search bar, and full table tree.
- In `rail` mode, renders compact 48px width, micro icons (database, search, refresh), and collapse/expand button.
- In `zen` mode, renders `display: none` or 0px width.
- Clicking the toggle button calls `onToggleMode`.

- [ ] **Step 2: Run tests to verify failure**

Run: `bun run test src/components/Sidebar.test.tsx`

- [ ] **Step 3: Implement tri-state Sidebar logic in `Sidebar.tsx`**

- Support `mode = 'expanded' | 'rail' | 'zen'` (defaulting to `'expanded'`).
- In `'rail'` mode, render a sleek vertical rail with:
  - Database engine icon with micro connection dot.
  - Search trigger icon (which expands sidebar or opens search).
  - Refresh schema button with tooltip.
  - Expand button (`PanelLeftOpen` / `ChevronRight`) at bottom.
- In `'expanded'` mode, add a collapse button (`PanelLeftClose` / `ChevronLeft`) to switch to `'rail'`.
- Debounce table search filter input using `useDebouncedValue(searchTerm, 150)`.

- [ ] **Step 4: Run tests to verify passing**

Run: `bun run test src/components/Sidebar.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/Sidebar.tsx src/components/Sidebar.test.tsx
git commit -m "feat(sidebar): implement tri-state expanded/rail/zen sidebar with debounced search"
```

---

### Task 5: Minimalist HeaderBar with Micro Status Dot & Sidebar Toggle

**Files:**
- Modify: `src/components/HeaderBar.tsx`
- Test: `src/components/HeaderBar.test.tsx`

**Interfaces:**
- Props addition:
  ```typescript
  export interface HeaderBarProps {
    // ... existing props
    sidebarMode?: 'expanded' | 'rail' | 'zen';
    onToggleSidebar?: () => void;
  }
  ```

- [ ] **Step 1: Write test in `HeaderBar.test.tsx`**

Add tests for:
- Minimalist micro-status dot rendering (emerald green when active connection is present, muted gray when disconnected).
- Sidebar toggle button click firing `onToggleSidebar`.
- Minimalist height $40\text{px}$ (`h-10`) styling and flat navigation.

- [ ] **Step 2: Run test to verify failure**

Run: `bun run test src/components/HeaderBar.test.tsx`

- [ ] **Step 3: Implement minimalist styling and toggle button in `HeaderBar.tsx`**

- Update header class to `h-10 bg-[#18191c] border-b border-[#35373c] ...`.
- Add a sidebar toggle icon button on the left of the brand title:
  ```tsx
  {onToggleSidebar && (
    <button
      type="button"
      data-testid="header-sidebar-toggle-btn"
      onClick={onToggleSidebar}
      title="Toggle Sidebar (Ctrl+B)"
      className="p-1 rounded text-[#8c919a] hover:text-[#e6e8ea] hover:bg-[#24262b] cursor-pointer"
    >
      <PanelLeft className="w-4 h-4" />
    </button>
  )}
  ```
- Simplify active connection badge into a clean micro-status dot:
  ```tsx
  <div className="flex items-center space-x-1.5 px-2 py-0.5 rounded bg-[#24262b] border border-[#35373c] text-[11px] font-mono">
    <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
    <span className="text-[#e6e8ea] font-medium">{activeConnection.name || activeConnection.database}</span>
  </div>
  ```

- [ ] **Step 4: Run tests to verify passing**

Run: `bun run test src/components/HeaderBar.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/HeaderBar.tsx src/components/HeaderBar.test.tsx
git commit -m "feat(header): add minimalist micro-status dot and sidebar toggle action"
```

---

### Task 6: ERD Canvas Viewport Culling & Floating Pill Toolbar (`ErdCanvas.tsx`)

**Files:**
- Modify: `src/components/canvas/ErdCanvas.tsx`
- Test: `src/components/canvas/ErdCanvas.test.tsx`

- [ ] **Step 1: Update `ErdCanvas.test.tsx`**

Verify that `ErdCanvas` mounts `<ReactFlow>` with `onlyRenderVisibleElements={true}` and renders the floating pill toolbar with accessible tooltips.

- [ ] **Step 2: Run test to verify failure or differences**

Run: `bun run test src/components/canvas/ErdCanvas.test.tsx`

- [ ] **Step 3: Modify `ErdCanvas.tsx`**

1. In `<ReactFlow ...>`:
   Set `onlyRenderVisibleElements={true}` to cull nodes and edges outside viewport camera.
2. Replace the top toolbar container with a sleek floating pill toolbar:
   ```tsx
   <div className="absolute top-4 left-4 z-10 flex items-center gap-1.5 p-1 bg-[#24262b]/85 backdrop-blur-md border border-[#35373c] rounded-lg shadow-xl">
     {/* Micro action buttons with tooltips */}
   </div>
   ```

- [ ] **Step 4: Run tests to verify passing**

Run: `bun run test src/components/canvas/ErdCanvas.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/canvas/ErdCanvas.tsx src/components/canvas/ErdCanvas.test.tsx
git commit -m "perf(canvas): enable viewport culling and add minimalist floating pill toolbar"
```

---

### Task 7: Root Workspace Integration & Global `Ctrl+B` Shortcut (`App.tsx`)

**Files:**
- Modify: `src/App.tsx`
- Test: `src/App.test.tsx`

- [ ] **Step 1: Write test for `Ctrl+B` keyboard toggle in `App.test.tsx`**

Test that pressing `Ctrl+B` (or `Cmd+B`) toggles the sidebar mode between `'expanded'` and `'rail'`.

- [ ] **Step 2: Run test to verify failure**

Run: `bun run test src/App.test.tsx`

- [ ] **Step 3: Update `App.tsx`**

- Add state: `const [sidebarMode, setSidebarMode] = useState<SidebarMode>('expanded');`
- Add `useEffect` listener for `keydown` matching `(e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'b'`:
  ```typescript
  setSidebarMode(prev => prev === 'expanded' ? 'rail' : 'expanded');
  ```
- Pass `sidebarMode` and `onToggleMode` to `<Sidebar mode={sidebarMode} onToggleMode={setSidebarMode} ... />`.
- Pass `sidebarMode` and `onToggleSidebar` to `<HeaderBar onToggleSidebar={() => setSidebarMode(prev => prev === 'expanded' ? 'rail' : 'expanded')} ... />`.

- [ ] **Step 4: Run tests to verify passing**

Run: `bun run test src/App.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/App.tsx src/App.test.tsx
git commit -m "feat(app): integrate tri-state sidebar and Ctrl+B global shortcut"
```

---

### Task 8: Full Regression & Pre-Completion Review

**Files:**
- Verify all modified files

- [ ] **Step 1: Execute complete frontend test suite**

Run: `bun run test`
Expected: 100% pass across all test suites with exit code 0.

- [ ] **Step 2: Execute backend tests**

Run: `cargo test`
Expected: 90/90 Rust unit tests pass cleanly with exit code 0.

- [ ] **Step 3: Execute production build**

Run: `bun run build` (or `tsc && vite build`)
Expected: Zero compilation errors, clean bundle output.

- [ ] **Step 4: Update README documentation**

Ensure `src/components/README.md` and `src/utils/README.md` document `useVirtualRows`, `useDebouncedValue`, and the minimalist UI features per Rule 4.

- [ ] **Step 5: Commit documentation and final adjustments**

```bash
git add src/components/README.md src/utils/README.md
git commit -m "docs: update component and utility READMEs with virtualization and minimalist UI docs"
```
