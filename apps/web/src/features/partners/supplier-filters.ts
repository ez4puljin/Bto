/** The supplier list's product category in the URL (ADR-0161 #7). */
export const PRODUCT_CATEGORY_PARAM = 'productCategory';

export function productCategoryOf(params: URLSearchParams): number | undefined {
  const id = Number.parseInt(params.get(PRODUCT_CATEGORY_PARAM) ?? '', 10);
  return id > 0 ? id : undefined;
}
