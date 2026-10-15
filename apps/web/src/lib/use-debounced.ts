import { useEffect, useState } from 'react';

/**
 * `value` once it has stayed the same for `ms`; pass a string or a number (an object made on every
 * render would restart the wait each time).
 */
export function useDebounced<T extends string | number>(value: T, ms: number): T {
  const [current, setCurrent] = useState(value);
  useEffect(() => {
    const timer = window.setTimeout(() => setCurrent(value), ms);
    return () => window.clearTimeout(timer);
  }, [value, ms]);
  return current;
}
