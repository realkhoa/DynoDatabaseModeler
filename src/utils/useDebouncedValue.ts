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
