import { Check, ChevronDown } from 'lucide-react';
import { type ReactNode, useState } from 'react';
import { cn } from '@/lib/utils';

/** One choice of a filter in a list's side panel: a row that is ticked while it filters. */
export function FilterOption(props: {
  label: ReactNode;
  active: boolean;
  onClick: () => void;
  hint?: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-pressed={props.active}
      className={cn(
        'flex w-full items-center gap-2 rounded-md px-2 py-1 text-left text-[0.8125rem] hover:bg-accent',
        props.active && 'bg-secondary font-medium text-secondary-foreground hover:bg-secondary',
      )}
      onClick={props.onClick}
    >
      <span className="min-w-0 flex-1 truncate">{props.label}</span>
      {props.hint}
      {props.active ? <Check aria-hidden className="size-3.5 shrink-0" /> : null}
    </button>
  );
}

/** A filter's choices, each lifting itself when picked again. */
export function FilterChoices<T extends string>(props: {
  options: readonly T[];
  label: (value: T) => string;
  value: string | null;
  onChange: (value: T | null) => void;
}) {
  return (
    <>
      {props.options.map((option) => (
        <FilterOption
          key={option}
          label={props.label(option)}
          active={props.value === option}
          onClick={() => props.onChange(props.value === option ? null : option)}
        />
      ))}
    </>
  );
}

/** A filter's name over its choices; it opens and closes, and says when it is in use. */
export function FilterSection(props: {
  title: string;
  active?: boolean;
  defaultOpen?: boolean;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(props.defaultOpen === true || props.active === true);
  return (
    <section aria-label={props.title} className="border-t border-border first:border-t-0">
      <button
        type="button"
        aria-expanded={open}
        className="flex w-full items-center gap-2 px-3 py-2.5 text-left text-xs font-semibold text-muted-foreground hover:text-foreground"
        onClick={() => setOpen((value) => !value)}
      >
        <span className="min-w-0 flex-1 truncate">{props.title}</span>
        {props.active ? <span aria-hidden className="size-1.5 rounded-full bg-primary" /> : null}
        <ChevronDown
          aria-hidden
          className={cn('size-3.5 shrink-0 transition-transform', !open && '-rotate-90')}
        />
      </button>
      {open ? <div className="flex flex-col gap-0.5 px-2 pb-2.5">{props.children}</div> : null}
    </section>
  );
}
