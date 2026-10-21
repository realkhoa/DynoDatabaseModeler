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
 * @brief Configuration options for the useVirtualRows hook.
 */
export interface UseVirtualRowsOptions {
  /** @brief Total count of rows in the current dataset. */
  totalCount: number;
  /** @brief Fixed row height in pixels. */
  rowHeight: number;
  /** @brief React ref pointing to the scrollable container element. */
  containerRef: React.RefObject<HTMLElement | null>;
  /** @brief Number of buffer rows rendered above and below the visible viewport. Defaults to 5. */
  overscan?: number;
}

/**
 * @brief Computes visible row boundaries and spacer dimensions mathematically.
 * @details Takes total count, row height, container height, scroll position and overscan buffer
 * to calculate the range of visible row indices, top spacer height, and bottom spacer height.
 * Handles boundary conditions such as empty datasets, negative or zero row heights, and scroll overflow.
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
 * @details Observes container resize using ResizeObserver, tracks scroll offset,
 * and recalculates visible row slices and spacer paddings whenever inputs or scroll change.
 * @param options Hook options including total count, row height, container ref, and overscan.
 * @return Computed virtual rows result and scroll event handler.
 */
export function useVirtualRows(
  options: UseVirtualRowsOptions
): VirtualRowsResult & { onScroll: React.UIEventHandler<HTMLElement> } {
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
