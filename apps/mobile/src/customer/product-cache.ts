// The shapes «Bto300» keeps products in (ADR-0092): a batch (an array), the shop's and a section's
// pages (`{ pages: [{ data }] }`), and the home and a category's page (`{ sections: [{ products }] }`).
// ♡ marks every copy at once and a product page opens from whichever list holds it.

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

/** The same answer with the product's ♡ set; an answer without it comes back unchanged. */
export function withFavourite<T>(data: T, productId: number, favourite: boolean): T {
  const mark = (rows: readonly unknown[]): unknown[] =>
    rows.map((row) => (isProduct(row) && row.id === productId ? { ...row, favourite } : row));
  if (Array.isArray(data)) return mark(data) as T;
  if (!isObject(data)) return data;
  const pages: unknown = data.pages;
  if (Array.isArray(pages)) {
    const marked: unknown[] = pages.map((page: unknown) =>
      isObject(page) && Array.isArray(page.data) ? { ...page, data: mark(page.data) } : page,
    );
    return { ...data, pages: marked };
  }
  const sections: unknown = data.sections;
  if (Array.isArray(sections)) {
    const marked: unknown[] = sections.map((section: unknown) =>
      isObject(section) && Array.isArray(section.products)
        ? { ...section, products: mark(section.products) }
        : section,
    );
    return { ...data, sections: marked };
  }
  return data;
}
