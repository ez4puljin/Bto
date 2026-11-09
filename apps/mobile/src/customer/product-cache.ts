// The shapes «Bto300» keeps products in (ADR-0092): a batch (an array), the shop's and a section's
// pages (`{ pages: [{ data }] }`), and the home and a category's page (`{ sections: [{ products }] }`).
// ♡ marks every copy at once, a product page opens from whichever list holds it, and the live stock
// (ADR-0173 #4) patches every copy in place; the staff app keeps its products in the same shapes.

interface ProductLike {
  id: number;
  favourite: boolean;
}

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

function pagesOf(data: unknown): { data: unknown[] }[] | null {
  if (!isObject(data) || !Array.isArray(data.pages)) return null;
  return data.pages.filter(
    (page): page is { data: unknown[] } => isObject(page) && Array.isArray(page.data),
  );
}

function sectionsOf(data: unknown): { products: unknown[] }[] | null {
  if (!isObject(data) || !Array.isArray(data.sections)) return null;
  return data.sections.filter(
    (section): section is { products: unknown[] } =>
      isObject(section) && Array.isArray(section.products),
  );
}

const isProduct = (value: unknown): value is ProductLike =>
  isObject(value) && typeof value.id === 'number' && typeof value.favourite === 'boolean';

/** Every product a cached answer holds, in its order (one product may come twice). */
export function productsIn<P extends ProductLike>(data: unknown): P[] {
  const rows: unknown[] = Array.isArray(data)
    ? data
    : (pagesOf(data)?.flatMap((page) => page.data) ??
      sectionsOf(data)?.flatMap((section) => section.products) ??
      []);
  return rows.filter(isProduct) as P[];
}

/** A cached product of either app: anything in a product list with a numeric id. */
export type CachedProduct = Record<string, unknown> & { id: number };

const hasId = (value: unknown): value is CachedProduct =>
  isObject(value) && typeof value.id === 'number';

/**
 * The same answer with `change` applied to every product it holds, in any of the three shapes;
 * `change` returns the row itself to leave it alone. The very same answer (and every untouched
 * page or section) comes back when nothing changed, so the cache is not written for nothing.
 */
export function mapProducts<T>(data: T, change: (row: CachedProduct) => unknown): T {
  const mapRows = (rows: readonly unknown[]): readonly unknown[] => {
    let changed = false;
    const next = rows.map((row) => {
      if (!hasId(row)) return row;
      const out = change(row);
      if (out !== row) changed = true;
      return out;
    });
    return changed ? next : rows;
  };
  if (Array.isArray(data)) return mapRows(data) as T;
  if (!isObject(data)) return data;
  const within = (parts: readonly unknown[], field: 'data' | 'products'): unknown[] | null => {
    let changed = false;
    const next = parts.map((part: unknown) => {
      if (!isObject(part)) return part;
      const rows: unknown = part[field];
      if (!Array.isArray(rows)) return part;
      const mapped = mapRows(rows);
      if (mapped === rows) return part;
      changed = true;
      return { ...part, [field]: mapped };
    });
    return changed ? next : null;
  };
  const pages: unknown = data.pages;
  if (Array.isArray(pages)) {
    const next = within(pages, 'data');
    return next ? { ...data, pages: next } : data;
  }
  const sections: unknown = data.sections;
  if (Array.isArray(sections)) {
    const next = within(sections, 'products');
    return next ? { ...data, sections: next } : data;
  }
  return data;
}

/** The same answer with the product's ♡ set; an answer without it comes back unchanged. */
export function withFavourite<T>(data: T, productId: number, favourite: boolean): T {
  return mapProducts(data, (row) =>
    row.id === productId && typeof row.favourite === 'boolean' ? { ...row, favourite } : row,
  );
}
