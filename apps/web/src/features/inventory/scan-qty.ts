import { useCallback, useRef, useState } from 'react';

/**
 * «Тоо», the quantity the next scan adds (ADR-0047 #2). The value is also kept in a ref: a scan that
 * lands in the field restores the typed value and goes on to the scanner in the same event, before
 * React re-renders, so reading state there would take the barcode's digits as the quantity.
 * `initial` is what the field returns to after each product («1»; empty for a receipt's «Нэгж үнэ»).
 */
export function useScanQty(initial = '1') {
  const [value, setValue] = useState(initial);
  const current = useRef(initial);
  const set = useCallback((next: string) => {
    current.current = next;
    setValue(next);
  }, []);
  const read = useCallback(() => current.current, []);
  const reset = useCallback(() => set(initial), [set, initial]);
  return { value, set, read, reset };
}

export type ScanQty = ReturnType<typeof useScanQty>;
