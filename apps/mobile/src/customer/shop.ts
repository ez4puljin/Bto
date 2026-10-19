import { Decimal } from '@tugeel/shared/money';
import { addDays } from '@tugeel/shared/time';
import type { StoreProduct, StoreQuote, StoreUnit } from '../api/customer';
import type { Cart, CartAction, CartLine } from '../cart/cart';
import { daysBetween } from '../dates/calendar';
import { formatQty } from '../format/format';

// «Бараа», a product, «Сагс» and the checkout of «Bto300» (ADR-0079 #4, #5; the Shop, Product,
// Cart and Checkout boards): what they decide without the server. Prices and the stock's words
// always come from the server; the app never prices.

/** «Ангилал»: the top categories in the list's order (a ticked one brings its subcategories). */
export function topStoreCategories(
  categories: readonly { id: number; parentId: number | null; name: string }[],
): { id: number; name: string }[] {
  return categories
    .filter((category) => category.parentId === null)
    .map((category) => ({ id: category.id, name: category.name }));
}

/** The empty shop's words: no ★ yet, or nothing matches the search and the categories. */
export function emptyKindOf(query: {
  q: string;
  categoryIds: readonly number[];
  favourites: boolean;
}): 'noFavourites' | 'noMatch' {
  return query.favourites && query.q === '' && query.categoryIds.length === 0
    ? 'noFavourites'
    : 'noMatch';
}

/** A product's line for the cart in a unit (the quantity is the caller's). */
export function storeLineOf(
  product: Pick<StoreProduct, 'id' | 'sku' | 'name' | 'thumbUrl'>,
  unit: Pick<StoreUnit, 'id' | 'uomName' | 'uomCode' | 'factorToBase' | 'isBase' | 'wholesale'>,
): Omit<CartLine, 'qty'> {
  return {
    productId: product.id,
    productUnitId: unit.id,
    sku: product.sku,
    name: product.name,
    uomName: unit.uomName,
    uomCode: unit.uomCode,
    factorToBase: unit.factorToBase,
    isBase: unit.isBase,
    wholesale: unit.wholesale,
    thumbUrl: product.thumbUrl,
  };
}

/** The line under a unit's price: «24 × 700₮» for a whole pack, «задгай үнэ» for a loose piece. */
export type PriceNote = { kind: 'pack'; n: string; amount: string } | { kind: 'loose' } | null;

export function priceNoteOf(
  product: Pick<StoreProduct, 'basePrice'>,
  unit: Pick<StoreUnit, 'isBase' | 'factorToBase' | 'wholesale' | 'basis'>,
): PriceNote {
  if (unit.wholesale === null) return null;
  if (unit.isBase) return unit.basis === 'LOOSE' ? { kind: 'loose' } : null;
  return unit.basis === 'WAREHOUSE' && product.basePrice !== null
    ? { kind: 'pack', n: formatQty(unit.factorToBase), amount: product.basePrice }
    : null;
}

export type QuotedLine = StoreQuote['quote']['lines'][number];
export type QuotedStock = StoreQuote['stock'][number];

/**
 * The quote's answer for one line as it is now (this unit, this many): its priced line and its
 * stock word; null while the quote on screen was asked for other lines (the next one is loading).
 */
export function quotedLine(
  quote: StoreQuote | undefined,
  productUnitId: number,
  qty: string,
): { line: QuotedLine; stock: QuotedStock | undefined } | null {
  if (!quote) return null;
  const at = quote.quote.lines.findIndex(
    (line) => line.productUnitId === productUnitId && formatQty(line.qty) === formatQty(qty),
  );
  const line = quote.quote.lines[at];
  if (!line) return null;
  const byIndex = quote.stock[at];
  const stock =
    byIndex?.productUnitId === productUnitId
      ? byIndex
      : quote.stock.find((entry) => entry.productUnitId === productUnitId);
  return { line, stock };
}

/** The quote when it answers exactly these lines (its total is the cart's); null otherwise. */
export function quoteFor(
  quote: StoreQuote | undefined,
  lines: readonly { productUnitId: number; qty: string }[],
): StoreQuote | null {
  return quote !== undefined &&
    lines.length > 0 &&
    quote.quote.lines.length === lines.length &&
    lines.every((line) => quotedLine(quote, line.productUnitId, line.qty) !== null)
    ? quote
    : null;
}

/**
 * A cart row's detail (the Cart board): several parts as «1 хайрцаг + 4 ширхэг», else the pieces
 * and one piece's price — the warehouse price for whole packs, a loose piece's own price.
 */
export type LineDetail =
  | { kind: 'parts'; parts: { qty: string; productUnitId: number; uomName: string }[] }
  | { kind: 'pieces'; pieces: string; perPiece: string | null };

export function lineDetailOf(
  line: Pick<CartLine, 'qty' | 'factorToBase'>,
  product:
    { basePrice: string | null; units: readonly { id: number; isBase: boolean }[] } | undefined,
  quoted: QuotedLine | undefined,
): LineDetail {
  const parts = quoted?.priced ? quoted.parts : [];
  if (parts.length > 1) {
    return {
      kind: 'parts',
      parts: parts.map((part) => ({
        qty: formatQty(part.qty),
        productUnitId: part.productUnitId,
        uomName: part.uomName,
      })),
    };
  }
  const base = product?.units.find((unit) => unit.isBase);
  const part = parts[0];
  const perPiece =
    part === undefined
      ? null
      : part.basis === 'WAREHOUSE'
        ? (product?.basePrice ?? null)
        : part.productUnitId === base?.id
          ? part.unitPrice
          : null;
  return {
    kind: 'pieces',
    pieces: new Decimal(line.factorToBase).times(line.qty).toFixed(),
    perPiece,
  };
}

/**
 * What the checkout sets on its own once its choices are known (ADR-0079 #5): the store's
 * default address when the cart has none that is still live (keeping «Өөрөө авна» if chosen),
 * pickup when the store has no address, and today when the day is unset or out of range.
 */
export function checkoutFixes(
  cart: Pick<Cart, 'addressId' | 'fulfilment' | 'deliveryDate'>,
  options: {
    today: string;
    lastDay: string;
    addresses: readonly { id: number; isDefault: boolean }[];
  },
): CartAction[] {
  const fixes: CartAction[] = [];
  if (options.addresses.length === 0) {
    if (cart.fulfilment === 'DELIVERY') fixes.push({ type: 'pickup' });
  } else if (!options.addresses.some((address) => address.id === cart.addressId)) {
    const chosen = options.addresses.find((address) => address.isDefault) ?? options.addresses[0];
    if (chosen) {
      fixes.push({ type: 'address', addressId: chosen.id });
      // Choosing an address chooses delivery: a store that picks up keeps picking up.
      if (cart.fulfilment === 'PICKUP') fixes.push({ type: 'pickup' });
    }
  }
  if (
    !cart.deliveryDate ||
    cart.deliveryDate < options.today ||
    cart.deliveryDate > options.lastDay
  ) {
    fixes.push({ type: 'deliveryDate', date: options.today });
  }
  return fixes;
}

/** The day tiles: today, tomorrow and the day after, as far as the last day allows. */
export function quickDays(today: string, lastDay: string): string[] {
  return [0, 1, 2].map((days) => addDays(today, days)).filter((date) => date <= lastDay);
}

/** «Өөр өдөр · 60 хоног»: how many days past today an order may ask for. */
export function daysAhead(today: string, lastDay: string): number {
  return Math.max(0, daysBetween(today, lastDay) - 1);
}

/** «Өөрөө авна»'s line: the one warehouse, the first and how many more, or the branch. */
export type PickupPlace =
  | { kind: 'one'; name: string }
  | { kind: 'more'; name: string; n: number }
  | { kind: 'branch'; name: string }
  | { kind: 'none' };

export function pickupPlaceOf(
  pickup: { branchName: string; warehouses: readonly string[] } | null | undefined,
): PickupPlace {
  if (!pickup) return { kind: 'none' };
  const [first] = pickup.warehouses;
  if (first === undefined) return { kind: 'branch', name: pickup.branchName };
  return pickup.warehouses.length === 1
    ? { kind: 'one', name: first }
    : { kind: 'more', name: first, n: pickup.warehouses.length - 1 };
}

/** A word with its first letter capitalised («хайрцгаар» → «Хайрцгаар»). */
export function capitalised(word: string): string {
  return word.charAt(0).toUpperCase() + word.slice(1);
}
