import { Decimal } from '@tugeel/shared/money';

/** Tugrik typed at the till: whole or with up to 2 decimals; spaces and thousands commas ignored. */
const MONEY = /^\d{1,12}(\.\d{1,2})?$/;
/** A quantity typed on a cart line: up to 3 decimals (a kilogram product). */
const QTY = /^\d{1,11}(\.\d{1,3})?$/;

/** The typed amount as a Decimal; null when it is not an amount. An empty field is null too. */
export function parseMoney(text: string): Decimal | null {
  const clean = text.replace(/[\s,]/g, '');
  return MONEY.test(clean) ? new Decimal(clean) : null;
}

/** Like parseMoney, but an empty field is zero (a tender left blank). */
export function moneyOrZero(text: string): Decimal | null {
  return text.trim() === '' ? new Decimal(0) : parseMoney(text);
}

/** The typed quantity as a positive NUMERIC string ("2", "0.5"), or null. A comma reads as a point. */
export function parseQty(text: string): string | null {
  const clean = text.trim().replace(',', '.');
  if (!QTY.test(clean)) return null;
  const qty = new Decimal(clean);
  return qty.gt(0) ? qty.toFixed() : null;
}

/** `amount` rounded up to a whole number of `step` (the next 1,000 / 5,000 … note). */
export function roundUpTo(amount: Decimal, step: number): Decimal {
  return amount.div(step).ceil().times(step);
}

/** The notes a customer is likely to hand over for `due`: each larger than it, without repeats. */
export function quickCash(due: Decimal, steps: readonly number[] = [1_000, 5_000, 10_000, 20_000]) {
  if (due.lte(0)) return [];
  const seen = new Set<string>([due.toFixed(2)]);
  const amounts: Decimal[] = [];
  for (const step of steps) {
    const amount = roundUpTo(due, step);
    const key = amount.toFixed(2);
    if (seen.has(key)) continue;
    seen.add(key);
    amounts.push(amount);
  }
  return amounts.sort((a, b) => a.comparedTo(b));
}

/** A Decimal as the wire string of money: always 2 decimals ("12000.00"). */
export function wireMoney(value: Decimal): string {
  return value.toFixed(2);
}

/** A Decimal as a field's text: no trailing zeros ("12000"). */
export function fieldMoney(value: Decimal | string): string {
  return new Decimal(value).toFixed();
}
