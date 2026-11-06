/**
 * How wide a page runs (ADR-0066, ADR-0119, ADR-0158), from its route's `handle: { width }`: `wide`
 * (lists, books, documents with lines, records with a side column) and `full` (boards and two-pane
 * work pages) take the whole width the shell leaves them, their title at the left. `reading`
 * (settings, forms, small tools, single-card records) is one centred column of 60rem: short content
 * stretched across a window left its cards half empty, and a column at the left left the window's
 * right empty, so the margins are equal instead (owner 2026-11-06). The rem grows with the window,
 * so the column does too. A page inside it sets no width of its own.
 */
export const PAGE_WIDTHS = {
  wide: 'max-w-none',
  full: 'max-w-none',
  reading: 'mx-auto max-w-[60rem]',
} as const;

export type PageWidth = keyof typeof PAGE_WIDTHS;

export function widthOf(handle: unknown): PageWidth | null {
  if (typeof handle !== 'object' || handle === null || !('width' in handle)) return null;
  const width = handle.width;
  return width === 'wide' || width === 'full' || width === 'reading' ? width : null;
}
