import { randomUuid } from '@/lib/uuid';

/**
 * The sheets a supermarket price label is printed on (ADR-0182): two sticker sheets of A4 and a
 * thermal label roll, one label per page.
 */
export const LABEL_SHEETS = ['A4_24', 'A4_8', 'ROLL_58'] as const;
export type LabelSheet = (typeof LABEL_SHEETS)[number];

export interface LabelSheetSpec {
  /** The CSS `@page` rule of the sheet. */
  page: string;
  /** One label, millimetres. */
  width: number;
  height: number;
  columns: number;
  /** Labels on one page. */
  perPage: number;
}

export const LABEL_SHEET_SPECS: Record<LabelSheet, LabelSheetSpec> = {
  A4_24: {
    page: '@page { size: A4; margin: 0; }',
    width: 70,
    height: 37,
    columns: 3,
    perPage: 24,
  },
  A4_8: {
    page: '@page { size: A4; margin: 0; }',
    width: 105,
    height: 74,
    columns: 2,
    perPage: 8,
  },
  ROLL_58: {
    page: '@page { size: 58mm 40mm; margin: 0; }',
    width: 58,
    height: 40,
    columns: 1,
    perPage: 1,
  },
};

const SHEET_KEY = 'bto.priceLabels.sheet';
const SET_PREFIX = 'bto.priceLabels.set.';
/** Hand-overs older than a day are swept when a new one is written. */
const SET_AGE_MS = 24 * 60 * 60 * 1000;

export function parseLabelSheet(value: string | null): LabelSheet | null {
  return LABEL_SHEETS.find((sheet) => sheet === value) ?? null;
}

export function savedLabelSheet(): LabelSheet {
  try {
    return parseLabelSheet(window.localStorage.getItem(SHEET_KEY)) ?? 'A4_24';
  } catch {
    return 'A4_24';
  }
}

export function saveLabelSheet(sheet: LabelSheet): void {
  try {
    window.localStorage.setItem(SHEET_KEY, sheet);
  } catch {
    // A browser without storage prints with the default sheet.
  }
}

/** `?ids=1,2,3`: a short list in the address itself. */
export function parseLabelIds(value: string | null): number[] {
  if (!value) return [];
  const ids = value
    .split(',')
    .map((part) => Number.parseInt(part, 10))
    .filter((id) => Number.isSafeInteger(id) && id > 0);
  return [...new Set(ids)];
}

/** Above this many products the list goes through the browser's storage, not the address. */
const IN_ADDRESS = 150;

/**
 * The address of the label page for these products. A long list is kept in the browser's storage
 * under a one-time name, because an address cannot carry thousands of ids.
 */
export function labelsHref(ids: readonly number[], now: number = Date.now()): string {
  if (ids.length <= IN_ADDRESS) return `/pricing/labels/print?ids=${ids.join(',')}`;
  const name = randomUuid();
  try {
    for (let index = window.localStorage.length - 1; index >= 0; index -= 1) {
      const key = window.localStorage.key(index);
      if (!key?.startsWith(SET_PREFIX)) continue;
      const at = Number.parseInt(window.localStorage.getItem(key)?.split('|')[0] ?? '', 10);
      if (!Number.isFinite(at) || now - at > SET_AGE_MS) window.localStorage.removeItem(key);
    }
    window.localStorage.setItem(SET_PREFIX + name, `${now}|${ids.join(',')}`);
  } catch {
    return `/pricing/labels/print?ids=${ids.slice(0, IN_ADDRESS).join(',')}`;
  }
  return `/pricing/labels/print?set=${name}`;
}

export function storedLabelIds(name: string | null): number[] {
  if (!name) return [];
  try {
    return parseLabelIds(window.localStorage.getItem(SET_PREFIX + name)?.split('|')[1] ?? null);
  } catch {
    return [];
  }
}

/** Labels cut into pages of the sheet. */
export function labelPages<T>(labels: readonly T[], perPage: number): T[][] {
  const pages: T[][] = [];
  for (let at = 0; at < labels.length; at += perPage) pages.push(labels.slice(at, at + perPage));
  return pages;
}
