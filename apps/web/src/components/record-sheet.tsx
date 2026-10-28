import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';

/**
 * A record in a wide panel from the right (docs/ui.md «Record panel»): the number, a description
 * line, badges and the record's actions in the header; the sections below scroll. Finance and the
 * supermarket pages open theirs from a URL parameter (`?invoice=`, `?shift=`, `?sale=`).
 * `size` (ADR-0066): `record` (64rem, part of the list stays in view at 1366) or `panel` (80rem,
 * a record people work in, like the sales order).
 */
export function RecordSheet(props: {
  open: boolean;
  onClose: () => void;
  size?: 'record' | 'panel';
  title: string;
  description?: string;
  badges?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
}) {
  const { t } = useTranslation();
  return (
    <Sheet open={props.open} onOpenChange={(next) => (next ? undefined : props.onClose())}>
      <SheetContent
        side="right"
        closeLabel={t('common.close')}
        className={
          props.size === 'panel'
            ? 'flex w-full flex-col gap-0 p-0 sm:max-w-[min(80rem,94vw)]'
            : 'flex w-full flex-col gap-0 p-0 sm:max-w-[min(64rem,94vw)]'
        }
      >
        <div className="flex h-full min-h-0 flex-col">
          <SheetHeader className="gap-2 border-b border-border px-5 py-3 pr-14">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <SheetTitle className="text-lg">{props.title}</SheetTitle>
                <SheetDescription>{props.description ?? ''}</SheetDescription>
                {props.badges ? (
                  <div className="mt-1.5 flex flex-wrap items-center gap-2">{props.badges}</div>
                ) : null}
              </div>
              {props.actions ? (
                <div className="flex flex-wrap items-center gap-2">{props.actions}</div>
              ) : null}
            </div>
          </SheetHeader>
          <div className="min-h-0 flex-1 overflow-y-auto p-5 [scrollbar-color:var(--border)_transparent] [scrollbar-width:thin]">
            {props.children}
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}

/** Facts as label / value chips (the order panel's style). */
export function FactChips({ facts }: { facts: { label: string; value: ReactNode }[] }) {
  return (
    <dl className="flex flex-wrap gap-2">
      {facts.map((fact) => (
        <div
          key={fact.label}
          className="flex items-stretch overflow-hidden rounded-lg border border-border text-[13px]"
        >
          <dt className="flex items-center bg-fill px-2.5 py-1.5 text-muted-foreground">
            {fact.label}
          </dt>
          <dd className="flex items-center px-2.5 py-1.5">{fact.value}</dd>
        </div>
      ))}
    </dl>
  );
}

/** A section of a panel: a small title over its content. */
export function PanelSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-2">
      <h3 className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
        {title}
      </h3>
      {children}
    </section>
  );
}

/** Small money or count tiles under a panel's facts. */
export function TotalsGrid({
  items,
  columns = 4,
}: {
  items: readonly (readonly [string, ReactNode])[];
  columns?: 3 | 4;
}) {
  return (
    <div className={columns === 3 ? 'grid gap-2 sm:grid-cols-3' : 'grid gap-2 sm:grid-cols-4'}>
      {items.map(([label, value]) => (
        <div key={label} className="rounded-lg border border-border px-3 py-2">
          <div className="text-[12px] text-muted-foreground">{label}</div>
          <div className="font-mono text-sm font-semibold">{value}</div>
        </div>
      ))}
    </div>
  );
}
