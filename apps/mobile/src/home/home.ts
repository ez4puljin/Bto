import { weekdayOf } from '../dates/dates';

/**
 * The name the home greets with: a Mongolian full name is the family (or father's) name first and
 * the given name last, so the last word («Бат Болд» → «Болд»); a one-word name as it is.
 */
export function givenNameOf(fullName: string): string {
  const words = fullName
    .trim()
    .split(/\s+/)
    .filter((word) => word.length > 0);
  return words[words.length - 1] ?? '';
}

/** The parts of the home's date line «Баасан, 10-р сарын 17» from the server's `YYYY-MM-DD`. */
export function dateLineOf(today: string): {
  weekday: 0 | 1 | 2 | 3 | 4 | 5 | 6;
  month: number;
  day: number;
} {
  return {
    weekday: weekdayOf(today) as 0 | 1 | 2 | 3 | 4 | 5 | 6,
    month: Number.parseInt(today.slice(5, 7), 10),
    day: Number.parseInt(today.slice(8, 10), 10),
  };
}

/** The home's «Шинэ бараа» strip: the new products of the shop's first page, at most `max`. */
export function newProductsOf<T extends { isNew: boolean }>(products: readonly T[], max = 10): T[] {
  return products.filter((product) => product.isNew).slice(0, max);
}
