import { EBARIMT_AMOUNT_PATTERN } from '@tugeel/shared/ebarimt-check';
import { Decimal } from '@tugeel/shared/money';
import { Check, RotateCcw } from 'lucide-react';
import { type ReactNode, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { MoneyInput } from '@/components/money-input';
import { Input } from '@/components/ui/input';
import { toast } from '@/lib/toast';
import { cn } from '@/lib/utils';
import { amountText, diffStateOf, FOCUS_RING } from './helpers';

/** Short of e-Barimt: red, the amount. Over it: blue, «+amount». Even: a green tick. */
export function DiffValue(props: { value: string; className?: string }) {
  const { t } = useTranslation();
  const state = diffStateOf(props.value);
  const amount = new Decimal(props.value);
  if (state === 'ok') {
    return (
      <>
        <Check aria-hidden className={cn('ml-auto size-4 text-success', props.className)} />
        <span className="sr-only">{t('ebarimtCheck.stats.ok')}</span>
      </>
    );
  }
  const shown =
    state === 'missing'
      ? amountText(amount.toFixed(2))
      : `+${amountText(amount.negated().toFixed(2))}`;
  return (
    <span
      title={shown}
      className={cn(
        'font-mono tabular-nums',
        state === 'missing' ? 'font-semibold text-destructive' : 'text-link',
        props.className,
      )}
    >
      {shown}
    </span>
  );
}

/** Text that is plainly an amount: digits, commas grouping thousands, at most two decimals. */
const PLAIN_AMOUNT = /^\s*(\d{1,3}(,\d{3})+|\d+)(\.\d{0,2})?\s*$/;

/** A minus or dash, or the brackets of an accounting format's negative. */
const SIGNED_TEXT = /[-\u2212\u2013\u2014()]/;

/** Tells the page while a cell is open, so what was typed is never lost to a filter. */
function useHoldsRow(editing: boolean, onEditing: ((editing: boolean) => void) | undefined) {
  const report = useRef(onEditing);
  useEffect(() => {
    report.current = onEditing;
  });
  useEffect(() => {
    if (!editing) return undefined;
    report.current?.(true);
    return () => report.current?.(false);
  }, [editing]);
}

/**
 * A cell left with changes, by Back or a row gone from the report, says they were not saved: a save
 * here could commit half a number, and saying nothing would lose it unseen.
 */
function useSaysIfLeft(editing: boolean, changed: boolean, label: string) {
  const { t } = useTranslation();
  const latest = useRef({ editing, changed, label, t });
  useEffect(() => {
    latest.current = { editing, changed, label, t };
  });
  useEffect(
    () => () => {
      const now = latest.current;
      if (!now.editing || !now.changed) return;
      toast.warning(now.t('ebarimtCheck.cells.notSaved', { label: now.label }));
    },
    [],
  );
}

/**
 * A cell that reads as text until clicked: Enter or leaving saves, Esc gives up. Each edit starts from
 * the value of the moment, and nothing arriving while it is typed in touches what is typed; a save
 * says what the cell showed then, so a colleague's change since is reported, not written over. A value
 * typed here instead of the record's shows the record's underneath, with a way back.
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
  /** The cell opened or closed: its row stays on the list meanwhile. */
  onEditing?: (editing: boolean) => void;
  onSave: (value: string, shown: string) => void;
  onRevert?: () => void;
}) {
  const { t } = useTranslation();
  const [editing, setEditing] = useState(props.startEditing === true);
  const [draft, setDraft] = useState(props.value);
  const finished = useRef(false);
  const shown = useRef(props.value);
  // Only a value the record really holds is one to go back to.
  const record = props.recordValue ? props.recordValue : null;
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (editing) input.current?.select();
  }, [editing]);
  useHoldsRow(editing, props.onEditing);
  useSaysIfLeft(editing, draft.trim() !== shown.current.trim(), props.label);
  const open = () => {
    finished.current = false;
    shown.current = props.value;
    setDraft(props.value);
    setEditing(true);
  };
  /** Enter closes the field, and the browser then reports it left: only the first one counts. */
  const finish = (save: boolean) => {
    if (finished.current) return;
    finished.current = true;
    setEditing(false);
    props.onClosed?.();
    if (save && draft.trim() !== shown.current.trim()) {
      props.onSave(draft.trim(), shown.current);
    }
  };
  if (!props.editable) {
    return (
      <span
        title={props.value || undefined}
        className={cn(
          'block min-w-0 truncate px-1 py-0.5 text-xs',
          props.mono && 'font-mono',
          props.multiline && 'line-clamp-2 whitespace-normal break-words',
          props.value === '' && 'text-muted-foreground',
        )}
      >
        {props.badge}
        {props.value === '' ? '—' : props.value}
      </span>
    );
  }
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
          onBlur={() => finish(true)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') finish(true);
            if (event.key === 'Escape') finish(false);
          }}
        />
      ) : (
        <button
          type="button"
          aria-label={`${props.label}: ${props.value || props.placeholder}`}
          title={props.value || props.label}
          className={cn(
            'block w-full cursor-text rounded-md text-left hover:bg-accent',
            FOCUS_RING,
          )}
          onClick={open}
        >
          <span
            className={cn(
              'block rounded-md px-1 py-0.5',
              props.mono && 'font-mono',
              props.multiline ? 'line-clamp-2 whitespace-normal break-words' : 'truncate',
              record !== null && 'font-medium text-link',
              props.value === '' && 'text-muted-foreground/70 italic',
            )}
          >
            {props.badge}
            {props.value === '' ? props.placeholder : props.value}
          </span>
        </button>
      )}
      {props.onRevert && record !== null ? (
        <button
          type="button"
          title={t('ebarimtCheck.cells.revert')}
          aria-label={`${props.label}: ${t('ebarimtCheck.cells.revert')}`}
          className={cn(
            'flex w-full items-center gap-1 truncate px-1 text-left text-xs text-muted-foreground hover:text-destructive',
            FOCUS_RING,
          )}
          onClick={props.onRevert}
        >
          <RotateCcw aria-hidden className="size-3 shrink-0" />
          <span className="truncate">{record}</span>
        </button>
      ) : null}
    </div>
  );
}

/**
 * A money cell typed in place: Enter or leaving saves, Esc gives up. What cannot be an amount keeps
 * the cell open and says so, rather than vanishing as if it had been saved. A minus is such a thing:
 * the money field would drop it and leave the opposite amount, so the cell holds until it is emptied.
 */
export function InlineAmount(props: {
  value: string;
  label: string;
  editable: boolean;
  onEditing?: (editing: boolean) => void;
  onSave: (value: string, shown: string) => void;
}) {
  const { t } = useTranslation();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [invalid, setInvalid] = useState(false);
  const [signedShown, setSignedShown] = useState(false);
  const finished = useRef(false);
  const shown = useRef(props.value);
  const signed = useRef(false);
  const opened = useRef('');
  const input = useRef<HTMLInputElement>(null);
  const amount = new Decimal(props.value);
  useEffect(() => {
    if (editing) input.current?.select();
  }, [editing]);
  useHoldsRow(editing, props.onEditing);
  useSaysIfLeft(editing, draft !== opened.current, props.label);
  if (!props.editable) {
    return (
      <span className={cn('font-mono', amount.isZero() ? 'text-muted-foreground' : 'text-warning')}>
        {amountText(props.value)}
      </span>
    );
  }
  const close = () => {
    finished.current = true;
    signed.current = false;
    setSignedShown(false);
    setInvalid(false);
    setEditing(false);
  };
  const commit = () => {
    if (finished.current) return;
    // Only a refused minus was ever typed: there is nothing to save or to keep open.
    if (signed.current && draft === '') {
      close();
      return;
    }
    const typed = draft.endsWith('.') ? draft.slice(0, -1) : draft;
    const next = typed === '' ? '0' : typed;
    if (signed.current || !EBARIMT_AMOUNT_PATTERN.test(next)) {
      setInvalid(true);
      return;
    }
    finished.current = true;
    setEditing(false);
    if (!new Decimal(next).equals(shown.current)) props.onSave(next, shown.current);
  };
  const refuseSign = () => {
    signed.current = true;
    setSignedShown(true);
    setInvalid(true);
  };
  if (editing) {
    return (
      <>
        <MoneyInput
          ref={input}
          aria-label={props.label}
          aria-invalid={invalid || undefined}
          inputMode="decimal"
          value={draft}
          className="h-7 px-1.5 text-right font-mono text-xs md:text-xs"
          onValueChange={(raw) => {
            if (raw === '') {
              signed.current = false;
              setSignedShown(false);
            }
            setInvalid(signed.current);
            setDraft(raw);
          }}
          onBlur={commit}
          onPaste={(event) => {
            const pasted = event.clipboardData.getData('text');
            if (PLAIN_AMOUNT.test(pasted)) return;
            // Anything else would lose its sign or its notation in the money field, and read as
            // another amount.
            event.preventDefault();
            if (SIGNED_TEXT.test(pasted)) refuseSign();
            else setInvalid(true);
          }}
          onKeyDown={(event) => {
            const shortcut = event.ctrlKey || event.metaKey || event.altKey;
            if (!shortcut && (event.key === '-' || event.key === '\u2212')) {
              event.preventDefault();
              refuseSign();
            }
            if (event.key === 'Enter') commit();
            if (event.key === 'Escape') close();
          }}
        />
        {invalid ? (
          <p role="alert" className="mt-0.5 text-left text-xs whitespace-normal text-destructive">
            {signedShown
              ? t('ebarimtCheck.cells.amountSigned')
              : t('ebarimtCheck.cells.amountInvalid')}
          </p>
        ) : null}
      </>
    );
  }
  return (
    <button
      type="button"
      aria-label={`${props.label}: ${amountText(props.value)}`}
      title={`${props.label}: ${amountText(props.value)}`}
      className={cn(
        'block w-full cursor-text rounded-md px-1 py-0.5 text-right font-mono hover:bg-accent',
        FOCUS_RING,
        amount.isZero() ? 'text-muted-foreground' : 'font-semibold text-warning',
      )}
      onClick={() => {
        finished.current = false;
        signed.current = false;
        setSignedShown(false);
        shown.current = props.value;
        setInvalid(false);
        opened.current = amount.isZero() ? '' : amount.toString();
        setDraft(opened.current);
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
      <div className={cn('font-mono text-[0.9375rem] font-semibold tabular-nums', props.className)}>
        {props.children}
      </div>
    </div>
  );
}
