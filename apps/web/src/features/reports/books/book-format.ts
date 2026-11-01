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

/** The bordered table of the paper. */
export const BOOK_TABLE =
  'w-full border-collapse text-[0.8125rem] [&_td]:border [&_td]:whitespace-normal [&_td]:border-border [&_td]:px-1.5 [&_td]:py-1 [&_th]:border [&_th]:border-border [&_th]:bg-muted/60 [&_th]:px-1.5 [&_th]:py-1 [&_th]:font-semibold';

/** Right-aligned figures. */
export const NUM = 'text-right font-mono whitespace-nowrap! tabular-nums';

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
