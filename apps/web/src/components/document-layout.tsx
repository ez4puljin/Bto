import type { ReactNode } from 'react';

/**
 * The head of a document window (a receipt, an issue; ADR-0153, ADR-0155): the document on the left,
 * the line editor on the right, the same in both so a hand learns one place. The lines that follow
 * take the whole width. Stacked on a narrow screen.
 */
export function DocumentWorkspace(props: { document: ReactNode; editor: ReactNode }) {
  return (
    <div
      data-slot="document-workspace"
      className="grid items-start gap-4 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]"
    >
      <div className="flex min-w-0 flex-col gap-4">{props.document}</div>
      <div className="min-w-0">{props.editor}</div>
    </div>
  );
}
