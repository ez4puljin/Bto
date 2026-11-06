import { Decimal } from '@tugeel/shared/money';
import { Check, RotateCcw } from 'lucide-react';
import { type ReactNode, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { amountText, diffStateOf } from './helpers';

/** Short of e-Barimt: red, the amount. Over it: blue, «+amount». Even: a green tick. */
export function DiffValue(props: { value: string; className?: string }) {
  const state = diffStateOf(props.value);
  const amount = new Decimal(props.value);
  if (state === 'ok') {
    return <Check aria-hidden className={cn('ml-auto size-4 text-success', props.className)} />;
  }
  return (
    <span
      className={cn(
        'font-mono tabular-nums',
        state === 'missing' ? 'font-semibold text-destructive' : 'text-link',
        props.className,
      )}
    >
      {state === 'missing'
        ? amountText(amount.toFixed(2))
        : `+${amountText(amount.negated().toFixed(2))}`}
    </span>
  );
}

/**
 * A cell that reads as text until clicked: Enter or leaving saves, Esc gives up. A value typed here
 * instead of the record's shows the record's underneath, with a way back.
 */
export function InlineText(props: {
  value: string;
  /** The record's value, while this one differs from it. */
  recordValue?: string | null;
  placeholder: string;
  label: string;
  editable: boolean;
  mono?: boolean;
  multiline?: boolean;
  badge?: ReactNode;
  maxLength?: number;
  /** Opens typing at once (a remark just asked for). */
  startEditing?: boolean;
  /** Typing ended, saved or not. */
  onClosed?: () => void;
  onSave: (value: string) => void;
  onRevert?: () => void;
}) {
  const { t } = useTranslation();
  const [editing, setEditing] = useState(props.startEditing === true);
  // Only a value the record really holds is one to go back to.
  const record = props.recordValue ? props.recordValue : null;
  const [draft, setDraft] = useState(props.value);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => setDraft(props.value), [props.value]);
  useEffect(() => {
    if (editing) input.current?.select();
  }, [editing]);
  const commit = () => {
    setEditing(false);
    props.onClosed?.();
    if (draft.trim() !== props.value.trim()) props.onSave(draft.trim());
  };
  const text = (
    <span
      className={cn(
        'block rounded-md px-1 py-0.5',
        props.mono && 'font-mono',
        props.multiline ? 'whitespace-normal break-words' : 'truncate',
        record !== null && 'font-medium text-link',
        props.value === '' && 'text-muted-foreground/70 italic',
      )}
    >
      {props.badge}
      {props.value === '' ? props.placeholder : props.value}
    </span>
  );
  return (
    <div className="min-w-0 text-xs">
      {editing ? (
        <Input
          ref={input}
          aria-label={props.label}
          value={draft}
          maxLength={props.maxLength}
          placeholder={props.placeholder}
          className={cn('h-7 px-1.5 text-xs md:text-xs', props.mono && 'font-mono')}
          onChange={(event) => setDraft(event.target.value)}
          onBlur={commit}
          onKeyDown={(event) => {
            if (event.key === 'Enter') commit();
            if (event.key === 'Escape') {
              setDraft(props.value);
              setEditing(false);
              props.onClosed?.();
            }
          }}
        />
      ) : props.editable ? (
        <button
          type="button"
          aria-label={props.label}
          title={props.value || props.label}
          className="block w-full cursor-text rounded-md text-left hover:bg-accent"
          onClick={() => setEditing(true)}
        >
          {text}
        </button>
      ) : (
        text
      )}
      {props.editable && props.onRevert && record !== null ? (
        <button
          type="button"
          title={t('ebarimtCheck.cells.revert')}
          aria-label={t('ebarimtCheck.cells.revert')}
          className="flex w-full items-center gap-1 truncate px-1 text-left text-xs text-muted-foreground hover:text-destructive"
          onClick={props.onRevert}
        >
          <RotateCcw aria-hidden className="size-3 shrink-0" />
          <span className="truncate">{record}</span>
        </button>
      ) : null}
    </div>
  );
}

/** A money cell typed in place: a plain number, Enter or leaving saves, Esc gives up. */
export function InlineAmount(props: {
  value: string;
  label: string;
  editable: boolean;
  onSave: (value: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const input = useRef<HTMLInputElement>(null);
  const amount = new Decimal(props.value);
  useEffect(() => {
    if (editing) input.current?.select();
  }, [editing]);
  if (!props.editable) {
    return (
      <span className={cn('font-mono', amount.isZero() ? 'text-muted-foreground' : 'text-warning')}>
        {amountText(props.value)}
      </span>
    );
  }
  const commit = () => {
    setEditing(false);
    const typed = draft.replaceAll(/[\s,]/g, '');
    const next = typed === '' ? '0' : typed;
    if (!/^\d{1,12}(\.\d{1,2})?$/.test(next)) return;
    if (!new Decimal(next).equals(amount)) props.onSave(next);
  };
  if (editing) {
    return (
      <Input
        ref={input}
        aria-label={props.label}
        inputMode="decimal"
        value={draft}
        className="h-7 px-1.5 text-right font-mono text-xs md:text-xs"
        onChange={(event) => setDraft(event.target.value)}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === 'Enter') commit();
          if (event.key === 'Escape') setEditing(false);
        }}
      />
    );
  }
  return (
    <button
      type="button"
      aria-label={props.label}
      className={cn(
        'block w-full cursor-text rounded-md px-1 py-0.5 text-right font-mono hover:bg-accent',
        amount.isZero() ? 'text-muted-foreground' : 'font-semibold text-warning',
      )}
      onClick={() => {
        setDraft(amount.isZero() ? '' : amount.toString());
        setEditing(true);
      }}
    >
      {amountText(props.value)}
    </button>
  );
}

/** A figure at a dialog's head. */
export function Stat(props: { label: string; children: ReactNode; className?: string }) {
  return (
    <div className="rounded-lg bg-canvas px-3 py-1.5">
      <div className="text-xs font-medium text-muted-foreground">{props.label}</div>
      <div className={cn('font-mono text-[15px] font-semibold tabular-nums', props.className)}>
        {props.children}
      </div>
    </div>
  );
}
