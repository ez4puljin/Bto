import type { BookOption } from './book-api';

/** «Нарийвчлал»: amounts to the tögrög's hundredths or whole. */
export type Precision = '2' | '0';
export const PRECISIONS: readonly Precision[] = ['2', '0'];

/** An amount with thousands grouped at the chosen precision («—» for none, blank for zero). */
export function amount(value: string | null | undefined, precision: Precision, zero = ''): string {
  if (value === null || value === undefined) return '—';
  const digits = precision === '0' ? 0 : 2;
  const [whole = '0', cents] = !/^-?\d+(\.\d+)?$/.test(value.trim())
    ? ['0']
    : roundText(value, digits).split('.');
  if (/^-?0$/.test(whole) && (!cents || /^0+$/.test(cents))) return zero;
  const sign = whole.startsWith('-') ? '-' : '';
  const grouped = whole.slice(sign.length).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `${sign}${grouped}${cents ? `.${cents}` : ''}`;
}

/** A decimal text rounded half up to `digits` places, without floats. */
function roundText(value: string, digits: number): string {
  const negative = value.trim().startsWith('-');
  const [intPart = '0', frac = ''] = value.trim().replace(/^[-+]/, '').split('.');
  const padded = `${frac}${'0'.repeat(digits + 1)}`;
  const kept = `${intPart}${padded.slice(0, digits)}`;
  let rounded = BigInt(kept || '0');
  if (Number.parseInt(padded[digits] ?? '0', 10) >= 5) rounded += 1n;
  let text = rounded.toString().padStart(digits + 1, '0');
  if (digits > 0) text = `${text.slice(0, -digits)}.${text.slice(-digits)}`;
  return negative && /[1-9]/.test(text) ? `-${text}` : text;
}

/** A quantity with thousands grouped (blank for zero). */
export function quantity(value: string | null | undefined): string {
  if (value === null || value === undefined) return '—';
  if (/^-?0*(\.0*)?$/.test(value)) return '';
  const [whole = '0', fraction = ''] = value.split('.');
  const sign = whole.startsWith('-') ? '-' : '';
  const grouped = whole.slice(sign.length).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  const trimmed = fraction.replace(/0+$/, '');
  return `${sign}${grouped}${trimmed ? `.${trimmed}` : ''}`;
}

/** Debit and credit of a balance (debit − credit) as two columns. */
export function sidesOf(balance: string): { debit: string; credit: string } {
  return balance.startsWith('-')
    ? { debit: '0', credit: balance.slice(1) }
    : { debit: balance, credit: '0' };
}

/**
 * The bordered table of the paper (2026-11-01): fixed columns from a `<colgroup>` in rem, hairlines
 * drawn by the cells (separate borders, so the sticky head keeps its own), rows of about 1.75rem.
 * The descendant selectors outweigh the shadcn cells' own height, padding and colours.
 */
export const BOOK_TABLE = [
  'w-full table-fixed border-separate border-spacing-0 border-l border-border text-[0.8125rem] leading-tight',
  '[&_thead]:sticky [&_thead]:top-0 [&_thead]:z-10',
  '[&_th]:h-auto [&_th]:border-r [&_th]:border-b [&_th]:border-border [&_th]:bg-muted [&_th]:px-2 [&_th]:py-1.5 [&_th]:align-bottom [&_th]:text-xs [&_th]:font-semibold [&_th]:whitespace-normal [&_th]:text-foreground [&_th]:first:pl-2 [&_th]:last:pr-2',
  '[&_thead_tr:first-child_th]:border-t',
  '[&_td]:h-auto [&_td]:border-r [&_td]:border-b [&_td]:border-border [&_td]:px-2 [&_td]:py-1 [&_td]:align-middle [&_td]:first:pl-2 [&_td]:last:pr-2',
  'print:table-auto print:text-[0.6875rem] print:[&_col]:w-auto! print:[&_thead]:static print:[&_tr]:break-inside-avoid',
].join(' ');

/** Right-aligned figures. */
export const NUM = 'text-right tabular-nums whitespace-nowrap';

/** The fixed columns of the papers in rem (ADR-0119's idea); text columns take the rest. */
export const COL = {
  code: 6,
  docNumber: 10.5,
  date: 6.5,
  unit: 4.5,
  qty: 5,
  money: 7.5,
  percent: 5,
} as const;

/** A text column: the width it is given on the paper and the least it keeps before the table scrolls. */
export interface TextColumn {
  prefer: number;
  min: number;
}

/** A column of a paper's table: a fixed width in rem, or a text column. */
export type BookColumn = number | TextColumn;

export function textColumn(prefer: number, min = 12): TextColumn {
  return { prefer, min };
}

/** The paper's padding on both sides together, in rem (`2xl:px-10`; `md:px-8` below 1536px). */
const PAPER_PADDING = 5;

/** The least width of a table in rem: its fixed columns and each text column at its least. */
export function tableMinRem(columns: readonly BookColumn[]): number {
  return columns.reduce<number>((sum, c) => sum + (typeof c === 'number' ? c : c.min), 0);
}

/** How wide a report's column runs in rem: its table at the text columns' given widths, and the padding. */
export function paperRem(columns: readonly BookColumn[]): number {
  return columns.reduce<number>(
    (sum, c) => sum + (typeof c === 'number' ? c : c.prefer),
    PAPER_PADDING,
  );
}

/** The sum of two amounts (two decimals) without floats; null when either is unknown. */
export function addMoney(a: string | null, b: string | null): string | null {
  if (a === null || b === null) return null;
  const cents = (value: string) => {
    const [whole = '0', frac = ''] = value.replace('-', '').split('.');
    const n = BigInt(`${whole}${`${frac}00`.slice(0, 2)}`);
    return value.startsWith('-') ? -n : n;
  };
  const total = cents(a) + cents(b);
  const sign = total < 0n ? '-' : '';
  const text = (total < 0n ? -total : total).toString().padStart(3, '0');
  return `${sign}${text.slice(0, -2)}.${text.slice(-2)}`;
}

/** Categories with their path («Хүнс / Амттан»), by name. */
export function categoryOptions(categories: readonly BookOption[]) {
  const byId = new Map(categories.map((category) => [category.id, category]));
  const path = (category: BookOption): string => {
    const names = [category.name];
    let parent = category.parentId === null ? undefined : byId.get(category.parentId);
    for (let depth = 0; parent && depth < 10; depth += 1) {
      names.unshift(parent.name);
      parent = parent.parentId === null ? undefined : byId.get(parent.parentId);
    }
    return names.join(' / ');
  };
  return categories
    .map((category) => ({ value: String(category.id), label: path(category) }))
    .sort((a, b) => a.label.localeCompare(b.label, 'mn'));
}
