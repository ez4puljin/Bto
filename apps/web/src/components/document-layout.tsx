import type { ReactNode } from 'react';

/**
 * The denser fields of a document window (owner 2026-11-05, «Нягт болго»), so the lines start high:
 * controls at the filter pills' height and small labels. Set on the box that holds the fields.
 */
export const DENSE_FIELDS =
  '[&_[data-slot=input]]:h-8.5 [&_[data-slot=input]]:text-ellipsis [&_.native-select]:h-8.5 [&_[data-slot=label]]:-mb-0.5 [&_[data-slot=label]]:text-xs [&_[data-slot=label]]:leading-snug';

/** Only the lines scroll: the table's own box stops scrolling and its head stays in view. */
export const LINES_SCROLLER =
  'min-h-0 flex-1 overflow-auto [scrollbar-color:var(--border)_transparent] [scrollbar-width:thin] [&_[data-slot=table-container]]:overflow-visible';

/**
 * The entry row under the lines' column heads (ADR-0156): each field stands under its column, its
 * text on the vertical of the column's head and rows (the cell's 0.25rem and the field's 0.5rem make
 * the rows' 0.75rem).
 */
export const ENTRY_ROW =
  'data-[editing=true]:bg-secondary/50 [&_.native-select]:h-8.5 [&_.native-select]:pr-7 [&_.native-select]:pl-2 [&_.native-select]:focus-visible:ring-2 [&_[data-slot=input]]:h-8.5 [&_[data-slot=input]]:px-2 [&_[data-slot=input]]:text-ellipsis [&_[data-slot=input]]:focus-visible:ring-2';
export const ENTRY_CELL = 'h-auto px-1 py-1.5 first:pl-3 last:pr-3';
/** The row under the entry: never empty and of one height, so the lines below do not move. */
export const ENTRY_SLOT_CELL = 'h-auto bg-muted/50 px-4 py-0.5 whitespace-normal first:pl-4';
export const ENTRY_SLOT =
  'flex min-h-6 items-center gap-x-4 gap-y-1 text-[0.8125rem] has-data-[slot=alert]:flex-wrap';

/** The foot of a document window's card: the count and totals, then the steps at its end. */
export const WINDOW_FOOT =
  'flex shrink-0 flex-wrap items-center gap-x-4 gap-y-1.5 border-t border-border bg-card px-3 py-1.5 text-[0.8125rem]';

/**
 * A document's work window (ADR-0156, ADR-0157, owner 2026-11-06): the title, the document's strip and
 * one card of lines fill the window, so nothing moves under the hand and only the lines scroll. Below
 * `lg` it flows and the page scrolls. The shell narrows its padding for it (`app-shell.tsx`, by
 * `data-slot`).
 */
export function DocumentWindow(props: { children: ReactNode }) {
  return (
    <div
      data-slot="document-window"
      className="flex flex-col [--radius:0.625rem] lg:h-[calc(100svh-3.25rem-1px-1.25rem)] lg:min-h-[30rem]"
    >
      {props.children}
    </div>
  );
}
