import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

/**
 * The head of a document window (a receipt, an issue; ADR-0119): its header card and, when the
 * document has one, a second card (the delivery note's totals, the keepers' confirmations) side
 * by side from 1600px, stacked below that. The «Бараа нэмэх» row and the lines table that follow
 * take the whole width.
 */
export function DocumentHeader(props: { main: ReactNode; side?: ReactNode; className?: string }) {
  return (
    <div
      data-slot="document-header"
      className={cn(
        'grid gap-4',
        props.side &&
          'min-[1600px]:grid-cols-[minmax(0,3fr)_minmax(0,2fr)] min-[1600px]:items-start',
        props.className,
      )}
    >
      {props.main}
      {props.side}
    </div>
  );
}
