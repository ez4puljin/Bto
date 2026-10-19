import { monthDay } from '../dates/calendar';
import { dayName } from '../notifications/feed';

// «Нүүр» of «Bto300» (ADR-0079 #13, #14; the Main board) as pure functions: the contacts' avatars,
// the phones as the app shows them, the favourites' tiles, the day of a recent order, the unsent
// cart's amount.

/**
 * A contact's avatar: the first letters of the role's first two words («Захиалга, оффис» → «ЗО»,
 * «Нягтлан бодогч, тооцоо» → «НБ»); punctuation is not a word.
 */
export function contactInitialsOf(role: string): string {
  return role
    .split(/[\s,.;:()/\\«»"'–—-]+/)
    .filter((word) => word.length > 0)
    .slice(0, 2)
    .map((word) => [...word][0]?.toUpperCase() ?? '')
    .join('');
}

/** The contact people the app lists, in the admin's order. */
export function shownContacts<T extends { shown: boolean }>(contacts: readonly T[]): T[] {
  return contacts.filter((contact) => contact.shown);
}

/** «+976 9911 2233»: a stored Mongolian number as the app shows it; anything else as it is. */
export function phoneShown(phone: string): string {
  const match = /^\+976(\d{4})(\d{4})$/.exec(phone.replace(/\s/g, ''));
  return match ? `+976 ${match[1]} ${match[2]}` : phone;
}

/** How many ★ products «Нүүр» shows. */
export const HOME_FAVOURITES = 3;

/** The newest stars first (the server's order), at most `max`. */
export function homeFavourites(ids: readonly number[], max = HOME_FAVOURITES): number[] {
  return [...new Set(ids)].slice(0, max);
}

/** Products in the given order of ids; an id the server did not return is left out. */
export function inOrderOf<T extends { id: number }>(
  ids: readonly number[],
  products: readonly T[],
): T[] {
  const found = new Map(products.map((product) => [product.id, product]));
  return ids.flatMap((id) => {
    const product = found.get(id);
    return product ? [product] : [];
  });
}

/** The day of a recent order's line: «Өнөөдөр», «Өчигдөр», or `MM/DD` (without today, the date). */
export type OrderDay = { kind: 'today' } | { kind: 'yesterday' } | { kind: 'date'; date: string };

export function orderDayOf(date: string, today: string | null): OrderDay {
  const name = today ? dayName(date, today) : 'date';
  return name === 'date' ? { kind: 'date', date: monthDay(date) } : { kind: name };
}

/** The unsent cart's amount on «Нүүр»: the quote's total once every line has a price. */
export function cartTotalOf(
  quote: { total: string; lines: readonly { priced: boolean }[] } | undefined,
): string | null {
  if (!quote || quote.lines.length === 0) return null;
  return quote.lines.every((line) => line.priced) ? quote.total : null;
}
