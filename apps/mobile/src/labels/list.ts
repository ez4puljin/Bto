import { userKey } from '../device/keys';

// «Хэвлэх жагсаалт» of «Үнийн шошго»: the products to print labels of, each with its copies. Pure,
// so the rules (merge, the limits, what is kept) are tested without a phone.

/** The most labels one print may hold (the server refuses more). */
export const MAX_LABELS = 100;
export const MIN_COPIES = 1;
export const MAX_COPIES = 20;

/** What a label needs of a product, as the server's search and barcode lookup give it. */
export interface LabelProduct {
  productId: number;
  name: string;
  code: string;
  barcodes: string[];
  unit: string;
  /** Whole MNT as the server wrote it. */
  price: string;
  bulkQty: string | null;
  bulkPrice: string | null;
}

export interface LabelLine extends LabelProduct {
  copies: number;
}

export const listKey = (server: string, userId: number) => userKey('labels', server, userId);

export const clampCopies = (copies: number): number =>
  Math.min(MAX_COPIES, Math.max(MIN_COPIES, Math.trunc(Number.isFinite(copies) ? copies : 1)));

/** How many labels the list prints. */
export const totalLabels = (list: readonly LabelLine[]): number =>
  list.reduce((sum, line) => sum + line.copies, 0);

/** How many more labels fit before the limit. */
export const roomLeft = (list: readonly LabelLine[]): number =>
  Math.max(0, MAX_LABELS - totalLabels(list));

export interface Changed {
  list: LabelLine[];
  /** Fewer copies than asked fitted: the 100 limit was reached. */
  capped: boolean;
}

/**
 * The product added with `copies`; one already there gets the copies added to its own (at most 20).
 * What does not fit under the 100 labels is left out and `capped` says so.
 */
export function addProduct(list: readonly LabelLine[], product: LabelProduct, copies = 1): Changed {
  const index = list.findIndex((line) => line.productId === product.productId);
  const have = index === -1 ? 0 : (list[index]?.copies ?? 0);
  const wanted = Math.min(MAX_COPIES, have + clampCopies(copies)) - have;
  const fits = Math.min(wanted, roomLeft(list));
  const capped = fits < wanted;
  if (fits <= 0) return { list: [...list], capped };
  if (index === -1) return { list: [...list, { ...product, copies: fits }], capped };
  return {
    list: list.map((line, at) => (at === index ? { ...line, copies: line.copies + fits } : line)),
    capped,
  };
}

/** A line's copies set to `copies` (1–20), held down to what fits under the 100 labels. */
export function setCopies(list: readonly LabelLine[], productId: number, copies: number): Changed {
  const line = list.find((one) => one.productId === productId);
  if (!line) return { list: [...list], capped: false };
  const wanted = clampCopies(copies);
  const allowed = Math.min(wanted, line.copies + roomLeft(list));
  return {
    list: list.map((one) => (one.productId === productId ? { ...one, copies: allowed } : one)),
    capped: allowed < wanted,
  };
}

export const removeLine = (list: readonly LabelLine[], productId: number): LabelLine[] =>
  list.filter((line) => line.productId !== productId);

/** The body's `items` for the server. */
export const itemsOf = (list: readonly LabelLine[]) =>
  list.map((line) => ({ productId: line.productId, copies: line.copies }));

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;
const text = (value: unknown): string | null => (typeof value === 'string' ? value : null);

function lineFrom(value: unknown): LabelLine | null {
  if (!isRecord(value)) return null;
  const { productId, copies } = value;
  const name = text(value.name);
  const code = text(value.code);
  const price = text(value.price);
  if (typeof productId !== 'number' || !Number.isInteger(productId)) return null;
  if (typeof copies !== 'number' || name === null || code === null || price === null) return null;
  return {
    productId,
    name,
    code,
    barcodes: Array.isArray(value.barcodes)
      ? value.barcodes.filter((one): one is string => typeof one === 'string')
      : [],
    unit: text(value.unit) ?? '',
    price,
    bulkQty: text(value.bulkQty),
    bulkPrice: text(value.bulkPrice),
    copies: clampCopies(copies),
  };
}

/** What was stored back as a list: broken lines dropped, copies kept in range, never over 100. */
export function listFrom(stored: unknown): LabelLine[] {
  if (!Array.isArray(stored)) return [];
  let list: LabelLine[] = [];
  for (const value of stored) {
    const line = lineFrom(value);
    if (!line || list.some((one) => one.productId === line.productId)) continue;
    list = addProduct(list, line, line.copies).list;
  }
  return list;
}
