/**
 * @file useDebouncedValue.test.ts
 * @brief Unit tests for useDebouncedValue hook.
 */

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
      ({ val, delay }: { val: string; delay: number }) => useDebouncedValue(val, delay),
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
      ({ val, delay }: { val: string; delay: number }) => useDebouncedValue(val, delay),
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

  it('should use default delay of 150ms when delayMs is omitted', () => {
    const { result, rerender } = renderHook(
      ({ val }: { val: string }) => useDebouncedValue(val),
      { initialProps: { val: 'initial' } }
    );

    rerender({ val: 'updated' });
    expect(result.current).toBe('initial');

    act(() => {
      vi.advanceTimersByTime(149);
    });
    expect(result.current).toBe('initial');

    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(result.current).toBe('updated');
  });
});
