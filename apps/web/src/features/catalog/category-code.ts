import type { Category } from './api';

type Coded = Pick<Category, 'name' | 'skuFrom' | 'skuTo'>;

/** The digits a block's two ends share: 101000–101999 is «101», 100000–199999 is «1». */
function sharedDigits(from: string, to: string): string {
  let length = 0;
  while (length < from.length && from[length] === to[length]) length += 1;
  return from.slice(0, length);
}

/**
 * A category's code and the rest of its name. The chart writes the code into the name («101 Дарс
 * виски», «305 - Масло»); a category without one takes it from its block of product codes.
 */
export function categoryCode(category: Coded): { code: string | null; title: string } {
  const written = /^(\d+)\s*[-–.]?\s*(.+)$/.exec(category.name);
  if (written?.[1] && written[2]) return { code: written[1], title: written[2] };
  const shared =
    category.skuFrom && category.skuTo ? sharedDigits(category.skuFrom, category.skuTo) : '';
  return { code: shared || null, title: category.name };
}

/** By the block of product codes, as the list sorts; a category without one last, by name. */
export function compareCategories(a: Coded, b: Coded): number {
  const key = (category: Coded) => (category.skuFrom ?? '').padStart(20, '0');
  if (a.skuFrom && b.skuFrom) return key(a).localeCompare(key(b));
  if (a.skuFrom) return -1;
  if (b.skuFrom) return 1;
  return a.name.localeCompare(b.name, 'mn');
}
