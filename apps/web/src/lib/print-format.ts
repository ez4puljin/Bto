import { useCallback, useSyncExternalStore } from 'react';

/**
 * The paper a sales document goes on (ADR-0058): an A4 sheet, or the 80 mm roll of a receipt
 * printer. The choice belongs to the computer and its printer, so this browser keeps it for every
 * user; the URL carries it to the printable page.
 */
export const PRINT_FORMATS = ['A4', 'MM80'] as const;
export type PrintFormat = (typeof PRINT_FORMATS)[number];

const PARAMS: Record<PrintFormat, string> = { A4: 'a4', MM80: '80mm' };
const STORAGE_KEY = 'tugeel.printFormat.v1';

/**
 * Each format's `@page`: A4 with margins; the roll without margins and without a size, so its
 * width and length come from the receipt printer's own driver (80 × 297 mm sheets or a roll).
 */
export const PAGE_RULES: Record<PrintFormat, string> = {
  A4: '@page { size: A4; margin: 12mm; }',
  MM80: '@page { margin: 0; }',
};

/** The format a `?format=` value names (`a4`, `80mm`); null for anything else. */
export function parsePrintFormat(value: string | null | undefined): PrintFormat | null {
  return PRINT_FORMATS.find((format) => PARAMS[format] === value) ?? null;
}

export function printFormatParam(format: PrintFormat): string {
  return PARAMS[format];
}

/** The choice of a browser whose storage is blocked, until the page is closed. */
let unsaved: PrintFormat | null = null;
const listeners = new Set<() => void>();

function read(): PrintFormat {
  if (unsaved) return unsaved;
  try {
    return parsePrintFormat(window.localStorage.getItem(STORAGE_KEY)) ?? 'A4';
  } catch {
    // Storage blocked and nothing chosen yet: A4.
    return 'A4';
  }
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  // Another tab of this browser chose a paper.
  window.addEventListener('storage', listener);
  return () => {
    listeners.delete(listener);
    window.removeEventListener('storage', listener);
  };
}

/** This computer's paper, the same in every dialog and tab; choosing one keeps it for next time. */
export function usePrintFormat() {
  const format = useSyncExternalStore(subscribe, read, () => 'A4' as const);
  const choose = useCallback((next: PrintFormat) => {
    try {
      window.localStorage.setItem(STORAGE_KEY, PARAMS[next]);
      unsaved = null;
    } catch {
      unsaved = next;
    }
    for (const listener of listeners) listener();
  }, []);
  return [format, choose] as const;
}
