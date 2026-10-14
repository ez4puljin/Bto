import { useCallback, useRef, useState } from 'react';

/**
 * «Тоо», the quantity the next scan adds (ADR-0047 #2). The value is also kept in a ref: a scan that
 * lands in the field restores the typed value and goes on to the scanner in the same event, before
 * React re-renders, so reading state there would take the barcode's digits as the quantity.
 */
export function useScanQty() {
  const [value, setValue] = useState('1');
  const current = useRef('1');
  const set = useCallback((next: string) => {
    current.current = next;
    setValue(next);
  }, []);
  const read = useCallback(() => current.current, []);
  const reset = useCallback(() => set('1'), [set]);
  return { value, set, read, reset };
}

export type ScanQty = ReturnType<typeof useScanQty>;
