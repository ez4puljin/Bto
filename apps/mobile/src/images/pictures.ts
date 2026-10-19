// Which picture URLs a product's card and page show (the owner, 2026-10-17: pictures to swipe on
// the cards and on the product page). URLs are relative to the server and never change.

interface Pictured {
  thumbUrl: string | null;
  images: readonly { url: string; thumbUrl: string | null }[];
}

/** A card's pictures, small: each picture's thumbnail (its full file when it has none). */
export function cardPictures(product: Pictured): string[] {
  if (product.images.length > 0) return product.images.map((image) => image.thumbUrl ?? image.url);
  return product.thumbUrl ? [product.thumbUrl] : [];
}

/** The product page's pictures: the full file, with its thumbnail to show until it arrives. */
export function heroPictures(product: Pictured): { url: string; placeholder: string | null }[] {
  if (product.images.length > 0) {
    return product.images.map((image) => ({ url: image.url, placeholder: image.thumbUrl }));
  }
  return product.thumbUrl ? [{ url: product.thumbUrl, placeholder: null }] : [];
}

/** The page a horizontal pager rests on, from its offset (never outside the pictures). */
export function pageAt(offset: number, width: number, count: number): number {
  if (width <= 0 || count <= 0) return 0;
  return Math.min(count - 1, Math.max(0, Math.round(offset / width)));
}
