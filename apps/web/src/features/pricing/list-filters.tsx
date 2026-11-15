import { SlidersHorizontal } from 'lucide-react';
import { type ReactNode, useState } from 'react';
import { ListCard } from '@/components/list';
import { Button } from '@/components/ui/button';
import { Sheet, SheetContent, SheetTitle } from '@/components/ui/sheet';
import { cn } from '@/lib/utils';

/*
 * The filters of a pricing list (ADR-0159, ADR-0160) and their two places (ADR-0201): beside the
 * list from `xl`, where a laptop has the room for both; on a till PC and a tablet the list takes
 * the whole width, and «Шүүлтүүр» in its filter bar opens the same filters in a sheet from the left.
 */

/** The filters' name and, while any of them narrows the list, «Цэвэрлэх». */
export function FilterHead(props: {
  title: string;
  clearLabel: string;
  filtered: boolean;
  onClear: () => void;
  className?: string;
}) {
  return (
    <div
      className={cn('flex items-center gap-2 px-3 py-2.5 text-sm font-semibold', props.className)}
    >
      <SlidersHorizontal aria-hidden className="size-4 text-muted-foreground" />
      <span className="flex-1">{props.title}</span>
      {props.filtered ? (
        <Button type="button" size="xs" variant="ghost" onClick={props.onClear}>
          {props.clearLabel}
        </Button>
      ) : null}
    </div>
  );
}

/** The filters beside the list, from the laptops up. */
export function FilterRail(props: { label: string; children: ReactNode }) {
  return (
    <aside aria-label={props.label} className="hidden w-52 shrink-0 xl:block">
      <ListCard scroll beside>
        {props.children}
      </ListCard>
    </aside>
  );
}

/**
 * The filters below the laptops: a pill in the filter bar, tinted and counting while filters
 * narrow the list, that opens them in a sheet. The sheet stays open while several are picked.
 */
export function FilterSheet(props: {
  /** The sheet's name for a screen reader. */
  label: string;
  title: string;
  /** How many filters narrow the list now. */
  count: number;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button
        type="button"
        size="sm"
        variant={props.count > 0 ? 'secondary' : 'outline'}
        className="xl:hidden"
        onClick={() => setOpen(true)}
      >
        <SlidersHorizontal />
        {props.title}
        {props.count > 0 ? <span className="tabular-nums">{props.count}</span> : null}
      </Button>
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent
          side="left"
          aria-describedby={undefined}
          className="w-72 gap-0 p-0 sm:max-w-72"
        >
          <SheetTitle className="sr-only">{props.label}</SheetTitle>
          {props.children}
        </SheetContent>
      </Sheet>
    </>
  );
}
