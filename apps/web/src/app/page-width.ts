/**
 * How wide a page runs (ADR-0066, ADR-0119), from its route's `handle: { width }`: `wide` (lists,
 * books, documents with lines, records with a side column) and `full` (boards and two-pane work
 * pages) take the whole width the shell leaves them; `reading` (settings, forms, small tools,
 * single-card records) stops at 1400px. Every page sits at the left, so the title never jumps
 * between a list and its record; only the sign-in pages, outside the shell, are centred.
 */
export const PAGE_WIDTHS = {
  wide: 'max-w-none',
  full: 'max-w-none',
  reading: 'max-w-[87.5rem]',
} as const;

export type PageWidth = keyof typeof PAGE_WIDTHS;

export function widthOf(handle: unknown): PageWidth | null {
  if (typeof handle !== 'object' || handle === null || !('width' in handle)) return null;
  const width = handle.width;
  return width === 'wide' || width === 'full' || width === 'reading' ? width : null;
}
