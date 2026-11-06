import type { ReactNode } from 'react';

/**
 * The denser fields of a document window (owner 2026-11-05, «Нягт болго»), so the lines start high:
 * controls at the filter pills' height and small labels. Set on the box that holds the fields.
 */
export const DENSE_FIELDS =
  '[&_[data-slot=input]]:h-8.5 [&_[data-slot=input]]:text-ellipsis [&_.native-select]:h-8.5 [&_[data-slot=label]]:-mb-0.5 [&_[data-slot=label]]:text-xs [&_[data-slot=label]]:leading-snug';

/**
 * A document's work window (ADR-0156, owner 2026-11-06): the title, the document's strip and one card
 * of lines fill the window, so nothing moves under the hand and only the lines scroll. Below `lg` it
 * flows and the page scrolls. The shell narrows its padding for it (`app-shell.tsx`, by `data-slot`).
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

/**
 * The head of a document window (the issue; ADR-0153, ADR-0155): the document on the left,
 * the line editor on the right, the same in both so a hand learns one place. The lines that follow
 * take the whole width. Stacked on a narrow screen.
 */
export function DocumentWorkspace(props: { document: ReactNode; editor: ReactNode }) {
  return (
    <div
      data-slot="document-workspace"
      className="grid items-start gap-3 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]"
    >
      <div className="flex min-w-0 flex-col gap-4">{props.document}</div>
      <div className="min-w-0">{props.editor}</div>
    </div>
  );
}
