import { type ReactNode, useLayoutEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { FieldError } from '@/components/field-error';
import { Button } from '@/components/ui/button';
import { DialogFooter } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { isValidationMessage } from '@/lib/forms';
import { cn } from '@/lib/utils';

/*
 * The form kit (ADR-0043, docs/ui.md §4): settings-style forms like Apple's — sections of rows,
 * the label on the left and the field on the right where the row is wide enough (stacked in a
 * phone or a narrow side column: a container query, ADR-0066), and the
 * actions at the foot, «Болих» then the main button on the right. The read view (`FieldList`)
 * uses the same rows, so reading and editing line up.
 */

/**
 * Ties a row's hint and error to its control (ADR-0113): the element whose id is `htmlFor` gets
 * `aria-describedby` naming them (ids the control set itself are kept) and `aria-invalid` while
 * an error shows. Done on the element, so any control with that id is covered (inputs, selects,
 * pickers) without the callers passing props.
 */
function useDescribedBy(htmlFor: string | undefined, hint: boolean, error: boolean) {
  useLayoutEffect(() => {
    if (!htmlFor) return;
    const control = document.getElementById(htmlFor);
    if (!control) return;
    const ours = [`${htmlFor}-hint`, `${htmlFor}-error`];
    const own = [hint ? ours[0] : null, error ? ours[1] : null].filter(
      (id): id is string => id !== null && id !== undefined,
    );
    const kept = (control.getAttribute('aria-describedby') ?? '')
      .split(/\s+/)
      .filter((id) => id && !ours.includes(id));
    const next = [...kept, ...own];
    if (next.length > 0) control.setAttribute('aria-describedby', next.join(' '));
    else control.removeAttribute('aria-describedby');
    const hadInvalid = control.hasAttribute('aria-invalid');
    if (error) control.setAttribute('aria-invalid', 'true');
    return () => {
      if (error && !hadInvalid) control.removeAttribute('aria-invalid');
    };
  });
}

function describedId(htmlFor: string | undefined, part: 'hint' | 'error') {
  return htmlFor ? `${htmlFor}-${part}` : undefined;
}

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
              <h3 className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
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
  useDescribedBy(props.htmlFor, Boolean(props.hint), isValidationMessage(props.error));
  return (
    <div className="@container">
      <div
        className={cn(
          'grid gap-1.5 px-3.5 py-3 @md:grid-cols-[11rem_minmax(0,1fr)] @md:gap-4',
          props.align === 'center'
            ? 'grid-cols-[minmax(0,1fr)_auto] items-center gap-3'
            : '@md:items-start',
        )}
      >
        <Label
          htmlFor={props.htmlFor}
          className={cn(
            'leading-snug text-foreground/80',
            props.align === 'center' ? null : '@md:pt-2.5',
          )}
        >
          {props.label}
        </Label>
        <div className="flex min-w-0 flex-col gap-1.5">
          {props.children}
          {props.hint ? (
            <p id={describedId(props.htmlFor, 'hint')} className="text-xs text-muted-foreground">
              {props.hint}
            </p>
          ) : null}
          <FieldError message={props.error} id={describedId(props.htmlFor, 'error')} />
        </div>
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
  useDescribedBy(props.htmlFor, Boolean(props.hint), isValidationMessage(props.error));
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={props.htmlFor}>{props.label}</Label>
      {props.children}
      {props.hint ? (
        <p id={describedId(props.htmlFor, 'hint')} className="text-xs text-muted-foreground">
          {props.hint}
        </p>
      ) : null}
      <FieldError message={props.error} id={describedId(props.htmlFor, 'error')} />
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

/** «Болих», then the submit button («Хадгалах» unless named), at the foot of a dialog's form. */
export function DialogFormFooter(props: {
  pending: boolean;
  onCancel: () => void;
  submitLabel?: string;
  disabled?: boolean;
}) {
  const { t } = useTranslation();
  return (
    <DialogFooter>
      <Button type="button" variant="ghost" onClick={props.onCancel}>
        {t('common.cancel')}
      </Button>
      <Button type="submit" pending={props.pending} disabled={props.disabled}>
        {props.submitLabel ?? t('common.save')}
      </Button>
    </DialogFooter>
  );
}
