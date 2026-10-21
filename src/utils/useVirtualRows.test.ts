/**
 * @file useVirtualRows.test.ts
 * @brief Unit tests for computeVirtualRows pure function and useVirtualRows hook.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import React from 'react';
import { computeVirtualRows, useVirtualRows } from './useVirtualRows';

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

  it('should return empty bounds when rowHeight is 0 or negative', () => {
    const result = computeVirtualRows({
      totalCount: 50,
      rowHeight: 0,
      containerHeight: 280,
      scrollTop: 0,
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
    expect(result.visibleIndices[0]).toBe(0);
    expect(result.visibleIndices[11]).toBe(11);
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

  it('should ensure startIndex does not exceed endIndex even when scrollTop is huge', () => {
    const result = computeVirtualRows({
      totalCount: 50,
      rowHeight: 28,
      containerHeight: 280,
      scrollTop: 100000,
      overscan: 5,
    });

    expect(result.endIndex).toBe(50);
    expect(result.startIndex).toBe(50);
    expect(result.visibleIndices).toEqual([]);
    expect(result.bottomPadding).toBe(0);
  });

  it('should handle overscan default value of 5 when omitted', () => {
    const result = computeVirtualRows({
      totalCount: 100,
      rowHeight: 20,
      containerHeight: 200, // 10 rows visible
      scrollTop: 400, // rawStart = 20, rawEnd = 30
    });

    // rawStart (20) - default overscan (5) = 15
    expect(result.startIndex).toBe(15);
    // rawEnd (30) + default overscan (5) = 35
    expect(result.endIndex).toBe(35);
    expect(result.topPadding).toBe(15 * 20);
    expect(result.bottomPadding).toBe((100 - 35) * 20);
    expect(result.visibleIndices.length).toBe(20);
  });
});

describe('useVirtualRows hook', () => {
  let mockResizeObserver: {
    observe: ReturnType<typeof vi.fn>;
    disconnect: ReturnType<typeof vi.fn>;
    triggerResize: (height: number) => void;
  };

  beforeEach(() => {
    let callback: ResizeObserverCallback;
    mockResizeObserver = {
      observe: vi.fn(),
      disconnect: vi.fn(),
      triggerResize: (height: number) => {
        if (callback) {
          callback(
            [
              {
                contentRect: { height } as DOMRectReadOnly,
                target: {} as Element,
              } as ResizeObserverEntry,
            ],
            {} as ResizeObserver
          );
        }
      },
    };

    vi.stubGlobal(
      'ResizeObserver',
      vi.fn().mockImplementation((cb: ResizeObserverCallback) => {
        callback = cb;
        return {
          observe: mockResizeObserver.observe,
          disconnect: mockResizeObserver.disconnect,
        };
      })
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('should initialize with initial calculation and attach resize observer', () => {
    const mockElement = { clientHeight: 300 } as HTMLElement;
    const ref = { current: mockElement } as React.RefObject<HTMLElement | null>;

    const { result } = renderHook(() =>
      useVirtualRows({
        totalCount: 50,
        rowHeight: 30,
        containerRef: ref,
        overscan: 2,
      })
    );

    expect(mockResizeObserver.observe).toHaveBeenCalledWith(mockElement);
    expect(result.current.startIndex).toBe(0);
    expect(result.current.endIndex).toBe(12); // 10 rows + 2 overscan
    expect(typeof result.current.onScroll).toBe('function');
  });

  it('should update slice on scroll event', () => {
    const mockElement = { clientHeight: 300 } as HTMLElement;
    const ref = { current: mockElement } as React.RefObject<HTMLElement | null>;

    const { result } = renderHook(() =>
      useVirtualRows({
        totalCount: 100,
        rowHeight: 30,
        containerRef: ref,
        overscan: 1,
      })
    );

    act(() => {
      result.current.onScroll({
        currentTarget: { scrollTop: 600 },
      } as React.UIEvent<HTMLElement>);
    });

    // scrollTop = 600 -> rawStart = 20, rawEnd = 30
    // startIndex = 20 - 1 = 19
    // endIndex = 30 + 1 = 31
    expect(result.current.startIndex).toBe(19);
    expect(result.current.endIndex).toBe(31);
    expect(result.current.topPadding).toBe(19 * 30);
  });

  it('should update containerHeight when ResizeObserver triggers with positive height', () => {
    const mockElement = { clientHeight: 300 } as HTMLElement;
    const ref = { current: mockElement } as React.RefObject<HTMLElement | null>;

    const { result } = renderHook(() =>
      useVirtualRows({
        totalCount: 100,
        rowHeight: 30,
        containerRef: ref,
        overscan: 0,
      })
    );

    expect(result.current.endIndex).toBe(10); // 300 / 30 = 10 rows

    act(() => {
      mockResizeObserver.triggerResize(600); // 600 / 30 = 20 rows
    });

    expect(result.current.endIndex).toBe(20);
  });

  it('should disconnect resize observer on unmount', () => {
    const mockElement = { clientHeight: 300 } as HTMLElement;
    const ref = { current: mockElement } as React.RefObject<HTMLElement | null>;

    const { unmount } = renderHook(() =>
      useVirtualRows({
        totalCount: 50,
        rowHeight: 30,
        containerRef: ref,
      })
    );

    unmount();
    expect(mockResizeObserver.disconnect).toHaveBeenCalled();
  });
});
