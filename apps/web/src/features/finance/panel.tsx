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
 * A finance record in a wide panel from the right (docs/ui.md «Record panel»): the number, a
 * description line, badges and the record's actions in the header; the sections below scroll.
 */
export function RecordSheet(props: {
  open: boolean;
  onClose: () => void;
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
        className="flex w-full flex-col gap-0 p-0 sm:max-w-[min(64rem,94vw)]"
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
          <div className="min-h-0 flex-1 overflow-y-auto p-5">{props.children}</div>
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
      <h3 className="text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">
        {title}
      </h3>
      {children}
    </section>
  );
}
