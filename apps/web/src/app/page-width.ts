/**
 * How wide a page runs (ADR-0066), from its route's `handle: { width }`: `wide` (lists, books,
 * documents with lines, records with a side column; up to 1600px), `full` (boards and two-pane
 * work pages) or `reading` (settings, forms, small tools; 1152px). Pages sit at the left, so
 * the title never jumps between a list and its record.
 */
export const PAGE_WIDTHS = {
  wide: 'max-w-[100rem]',
  full: 'max-w-none',
  reading: 'max-w-6xl',
} as const;

export type PageWidth = keyof typeof PAGE_WIDTHS;

export function widthOf(handle: unknown): PageWidth | null {
  if (typeof handle !== 'object' || handle === null || !('width' in handle)) return null;
  const width = handle.width;
  return width === 'wide' || width === 'full' || width === 'reading' ? width : null;
}
