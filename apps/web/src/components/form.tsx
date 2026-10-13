import type { ReactNode } from 'react';
import { FieldError } from '@/components/field-error';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';

/*
 * The form kit (ADR-0042, docs/ui.md §4): settings-style forms like Apple's — sections of rows,
 * the label on the left and the field on the right on wide screens (stacked on phones), and the
 * actions at the foot, «Болих» then the main button on the right. The read view (`FieldList`)
 * uses the same rows, so reading and editing line up.
 */

/** A titled group of rows inside a hairline box. */
export function FormSection(props: {
  title?: string;
  description?: string;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={cn('flex flex-col gap-2', props.className)}>
      {props.title || props.description || props.action ? (
        <div className="flex items-end justify-between gap-3 px-1">
          <div className="min-w-0">
            {props.title ? (
              <h3 className="text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">
                {props.title}
              </h3>
            ) : null}
            {props.description ? (
              <p className="mt-0.5 text-xs text-muted-foreground">{props.description}</p>
            ) : null}
          </div>
          {props.action}
        </div>
      ) : null}
      <div className="divide-y divide-border/80 overflow-hidden rounded-xl border border-border/90 bg-background">
        {props.children}
      </div>
    </section>
  );
}

/**
 * One labelled field. `htmlFor` ties the label to the control (screen readers and tests find the
 * field by its label); `align="center"` suits a switch or a short control, which a phone keeps on
 * the label's line, at its end.
 */
export function FormRow(props: {
  label: string;
  htmlFor?: string;
  hint?: ReactNode;
  error?: string | undefined;
  align?: 'start' | 'center';
  children: ReactNode;
}) {
  return (
    <div
      className={cn(
        'grid gap-1.5 px-3.5 py-3 sm:grid-cols-[11rem_minmax(0,1fr)] sm:gap-4',
        props.align === 'center'
          ? 'grid-cols-[minmax(0,1fr)_auto] items-center gap-3'
          : 'sm:items-start',
      )}
    >
      <Label
        htmlFor={props.htmlFor}
        className={cn(
          'leading-snug text-foreground/80',
          props.align === 'center' ? null : 'sm:pt-2.5',
        )}
      >
        {props.label}
      </Label>
      <div className="flex min-w-0 flex-col gap-1.5">
        {props.children}
        {props.hint ? <p className="text-xs text-muted-foreground">{props.hint}</p> : null}
        <FieldError message={props.error} />
      </div>
    </div>
  );
}

/** A field stacked label over control, for dialogs and other narrow places. */
export function FormField(props: {
  label: string;
  htmlFor?: string;
  hint?: ReactNode;
  error?: string | undefined;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={props.htmlFor}>{props.label}</Label>
      {props.children}
      {props.hint ? <p className="text-xs text-muted-foreground">{props.hint}</p> : null}
      <FieldError message={props.error} />
    </div>
  );
}

/** The actions at the foot of a form: secondary ones first, the main button last, on the right. */
export function FormFooter({ children }: { children: ReactNode }) {
  return (
    <div className="flex flex-wrap items-center justify-end gap-2 border-t border-border/80 pt-4">
      {children}
    </div>
  );
}
