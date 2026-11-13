import type { BookOption } from './book-api';

/** «Нарийвчлал»: amounts to the tögrög's hundredths or whole. */
export type Precision = '2' | '0';
export const PRECISIONS: readonly Precision[] = ['2', '0'];

/** The typographic minus (U+2212) of the papers: as wide as a digit and never taken for a dash. */
export const MINUS = '−';

/**
 * An amount with thousands grouped at the chosen precision and a real minus («—» for none, blank
 * for zero unless `zero` says what to write).
 */
export function amount(value: string | null | undefined, precision: Precision, zero = ''): string {
  if (value === null || value === undefined) return '—';
  const digits = precision === '0' ? 0 : 2;
  const [whole = '0', cents] = !/^-?\d+(\.\d+)?$/.test(value.trim())
    ? ['0']
    : roundText(value, digits).split('.');
  if (/^-?0$/.test(whole) && (!cents || /^0+$/.test(cents))) return zero;
  const negative = whole.startsWith('-');
  const grouped = whole.slice(negative ? 1 : 0).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `${negative ? MINUS : ''}${grouped}${cents ? `.${cents}` : ''}`;
}

/** A decimal text with its sign turned («-4727.27» for «4727.27»). */
export function negate(value: string): string {
  const text = value.trim();
  return text.startsWith('-') ? text.slice(1) : `-${text}`;
}

/** A margin «12.5%» with a real minus, blank for none. */
export function percentText(value: string | null): string {
  if (value === null) return '';
  return `${value.startsWith('-') ? `${MINUS}${value.slice(1)}` : value}%`;
}

/** Whether a decimal text is zero (or empty). */
export function isZero(value: string | null | undefined): boolean {
  return !value || /^[-+]?0*(\.0*)?$/.test(value.trim());
}

/** A period as the papers, the rows and the inputs write it: «2026-10-01 – 2026-11-01». */
export function periodText(from: string, to: string): string {
  return `${from} – ${to}`;
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

/** A quantity with thousands grouped and a real minus (blank for zero unless `zero` is given). */
export function quantity(value: string | null | undefined, zero = ''): string {
  if (value === null || value === undefined) return '—';
  if (/^-?0*(\.0*)?$/.test(value)) return zero;
  const [whole = '0', fraction = ''] = value.split('.');
  const negative = whole.startsWith('-');
  const grouped = whole.slice(negative ? 1 : 0).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  const trimmed = fraction.replace(/0+$/, '');
  return `${negative ? MINUS : ''}${grouped}${trimmed ? `.${trimmed}` : ''}`;
}

/**
 * A detail row's parts after its number: the empty ones, the number itself and those in `omit`
 * (the group's or the row's own name, already on screen) left out.
 */
export function detailParts(
  number: string | null,
  parts: readonly (string | null | undefined)[],
  omit: readonly (string | null | undefined)[] = [],
): string[] {
  return parts.filter(
    (part): part is string => Boolean(part) && part !== number && !omit.includes(part),
  );
}

/** The text a detail row is named by: its number and parts joined with « · ». */
export function detailText(number: string | null, parts: readonly string[]): string {
  return [number, ...parts].filter(Boolean).join(' · ');
}

/** Debit and credit of a balance (debit − credit) as two columns. */
export function sidesOf(balance: string): { debit: string; credit: string } {
  return balance.startsWith('-')
    ? { debit: '0', credit: balance.slice(1) }
    : { debit: balance, credit: '0' };
}

/**
 * The bordered table of the paper (2026-11-02): fixed columns from a `<colgroup>` in rem, hairlines
 * drawn by the cells (separate borders, so the sticky head keeps its own), rows of about 1.75rem.
 * Inner lines are light — `GROUP_END` draws the full line between column groups — and the head's
 * foot carries a darker rule. Below 1600px (a 17px root) the text, the padding and the columns
 * shrink (`compact` widths). The first column stays in view while the table scrolls sideways
 * (a cell spanning several columns never sticks); a row's cells take its opaque background.
 * The descendant selectors outweigh the shadcn cells' own height, padding and colours.
 */
export const BOOK_TABLE = [
  'w-full table-fixed border-separate border-spacing-0 border-l border-border text-[0.8125rem] leading-tight max-[1600px]:text-xs',
  '[&_thead]:sticky [&_thead]:top-0 [&_thead]:z-20',
  '[&_th]:h-auto [&_th]:border-r [&_th]:border-b [&_th]:border-r-border/60 [&_th]:border-b-border/70 [&_th]:bg-muted [&_th]:px-2 [&_th]:py-1.5 [&_th]:align-bottom [&_th]:text-xs [&_th]:leading-snug [&_th]:font-semibold [&_th]:text-balance [&_th]:hyphens-none [&_th]:whitespace-normal [&_th]:text-foreground/80 [&_th]:first:pl-2 [&_th]:last:pr-2',
  '[&_thead_tr:first-child_th]:border-t [&_thead_tr:first-child_th]:border-t-border',
  '[&_thead_tr:last-child>th]:border-b-foreground/30 [&_thead_th[rowspan]]:border-b-foreground/30',
  '[&_td]:h-auto [&_td]:border-r [&_td]:border-b [&_td]:border-r-border/60 [&_td]:border-b-border/70 [&_td]:px-2 [&_td]:py-1 [&_td]:align-middle [&_td]:first:pl-2 [&_td]:last:pr-2',
  '[&_tr>*:last-child]:border-r-border',
  'max-[1600px]:[&_td]:px-1.5 max-[1600px]:[&_th]:px-1.5',
  '[&_tbody_tr>td:first-child:not([colspan])]:sticky [&_tbody_tr>td:first-child:not([colspan])]:left-0 [&_tbody_tr>td:first-child:not([colspan])]:z-10 [&_tbody_tr>td:first-child:not([colspan])]:bg-inherit',
  '[&_thead_tr:first-child>th:first-child]:sticky [&_thead_tr:first-child>th:first-child]:left-0 [&_thead_tr:first-child>th:first-child]:z-10',
  'print:table-auto print:text-[0.6875rem] print:[&_col]:w-auto! print:[&_thead]:static print:[&_tr]:break-inside-avoid',
  'print:[&_th]:bg-transparent print:[&_th]:text-foreground print:[&_thead_tr:last-child>th]:border-b-2 print:[&_thead_th[rowspan]]:border-b-2 print:[&_thead_tr:last-child>th]:border-b-foreground print:[&_thead_th[rowspan]]:border-b-foreground',
].join(' ');

/** Right-aligned figures. */
export const NUM = 'text-right tabular-nums whitespace-nowrap';

/** The last cell of a column group (Эхний | Гүйлгээ | Эцсийн): a full-strength line on its right. */
export const GROUP_END = 'border-r-border!';

/** A column of a fixed width in rem, and its width below 1600px. */
export interface FixedColumn {
  rem: number;
  compact: number;
}

function fixed(rem: number, compact = rem): FixedColumn {
  return { rem, compact };
}

/** The fixed columns of the papers in rem (ADR-0119's idea); text columns take the rest. */
export const COL = {
  code: fixed(6, 5.75),
  docNumber: fixed(10.5, 9.75),
  date: fixed(6.5, 5.5),
  unit: fixed(4.5, 3.5),
  qty: fixed(5, 4.5),
  money: fixed(7.5, 6.5),
  percent: fixed(5, 4.25),
  docType: fixed(8.5, 6.5),
  person: fixed(9, 7),
} as const;

/** A text column: the width it is given on the paper and the least it keeps before the table scrolls. */
export interface TextColumn {
  prefer: number;
  min: number;
}

/** A column of a paper's table: a fixed width, or a text column. */
export type BookColumn = FixedColumn | TextColumn;

export function textColumn(prefer: number, min = 12): TextColumn {
  return { prefer, min };
}

/** The paper's padding on both sides together, in rem (`px-8`; `px-4` below 1600px). */
const PAPER_PADDING = { wide: 4, compact: 2 } as const;

/** A column's width in rem: a fixed one at its size, a text one at `text`'s choice. */
function widthOf(column: BookColumn, compact: boolean, text: 'prefer' | 'min'): number {
  if ('rem' in column) return compact ? column.compact : column.rem;
  return column[text];
}

/** The least width of a table in rem: its fixed columns and each text column at its least. */
export function tableMinRem(columns: readonly BookColumn[], compact = false): number {
  return columns.reduce<number>((sum, c) => sum + widthOf(c, compact, 'min'), 0);
}

/** How wide a report's column runs in rem: its table at the text columns' given widths, and the padding. */
export function paperRem(columns: readonly BookColumn[], compact = false): number {
  return columns.reduce<number>(
    (sum, c) => sum + widthOf(c, compact, 'prefer'),
    compact ? PAPER_PADDING.compact : PAPER_PADDING.wide,
  );
}

/** «Энэ сар», «Өмнөх сар», «Энэ улирал», «Энэ жил» of the prompt, from a business date. */
// The period presets and their dates are shared with the saved views (ADR-0194).
export { PERIOD_PRESETS, type PeriodPreset, presetRange } from '@tugeel/shared/reports';

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
