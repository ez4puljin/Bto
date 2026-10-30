import { matchesQuery, queryTerms, searchKeys } from '@tugeel/shared/text';
import { Check, ChevronDown, Search } from 'lucide-react';
import { Popover } from 'radix-ui';
import { type KeyboardEvent, useId, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';

export interface ComboboxOption {
  value: string;
  label: string;
  /** Shown after the label, muted (a count, a code). */
  hint?: string;
  /** Other texts the search matches (a code, a phone). */
  keys?: readonly string[];
}

/**
 * A pick-one filter you can type into (owner 2026-10-30): the pill of a list's filter bar, like
 * the filter selects, opening a list with a search box; the options are matched in the browser
 * with the shared search keys (`@tugeel/shared/text`), by label and `keys`. The empty value is
 * the "all" choice, named by `emptyLabel`. The pill is a combobox for keyboards and tests, the
 * list a listbox of options; ↑ ↓ move, Enter picks, Escape closes.
 */
export function Combobox(props: {
  'aria-label': string;
  value: string;
  options: readonly ComboboxOption[];
  emptyLabel: string;
  onChange: (value: string) => void;
  className?: string;
}) {
  const { t } = useTranslation();
  const ids = useId();
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [active, setActive] = useState(0);
  const terms = useMemo(() => queryTerms(search), [search]);
  const matches = useMemo<readonly ComboboxOption[]>(() => {
    const all: ComboboxOption[] = [{ value: '', label: props.emptyLabel }, ...props.options];
    if (terms.length === 0) return all;
    return props.options.filter((option) =>
      matchesQuery(searchKeys(option.label, [...(option.keys ?? []), option.hint ?? '']), terms),
    );
  }, [props.options, props.emptyLabel, terms]);
  const current = active < matches.length ? active : 0;
  const chosen = props.options.find((option) => option.value === props.value);

  const onOpenChange = (next: boolean) => {
    setOpen(next);
    if (!next) {
      setSearch('');
      setActive(0);
    }
  };
  const pick = (value: string) => {
    props.onChange(value);
    onOpenChange(false);
  };
  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      if (matches.length === 0) return;
      event.preventDefault();
      const step = event.key === 'ArrowDown' ? 1 : -1;
      setActive((current + step + matches.length) % matches.length);
    } else if (event.key === 'Enter') {
      event.preventDefault();
      const match = matches[current];
      if (match) pick(match.value);
    }
  };
  const listId = `${ids}-list`;

  return (
    <Popover.Root open={open} onOpenChange={onOpenChange}>
      <Popover.Trigger asChild>
        <button
          type="button"
          role="combobox"
          aria-label={props['aria-label']}
          aria-expanded={open}
          aria-haspopup="listbox"
          aria-controls={open ? listId : undefined}
          data-active={props.value !== '' ? 'true' : undefined}
          className={cn(
            'inline-flex h-8.5 max-w-64 items-center gap-1.5 rounded-full border border-border bg-background pr-2 pl-3 text-[0.8125rem] font-medium shadow-control outline-none hover:bg-accent focus-visible:border-ring focus-visible:ring-1 focus-visible:ring-ring data-[active=true]:border-transparent data-[active=true]:bg-secondary data-[active=true]:text-secondary-foreground',
            props.className,
          )}
        >
          <span className="min-w-0 truncate">{chosen?.label ?? props.emptyLabel}</span>
          <ChevronDown aria-hidden className="size-4 shrink-0 opacity-60" />
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          align="start"
          sideOffset={4}
          className="z-50 w-(--radix-popover-trigger-width) max-w-[min(28rem,var(--radix-popover-content-available-width))] min-w-72 overflow-hidden rounded-xl border border-border bg-popover p-1 text-popover-foreground shadow-popover"
        >
          <div className="relative p-1">
            <Search
              aria-hidden
              className="pointer-events-none absolute top-1/2 left-3.5 size-4 -translate-y-1/2 text-muted-foreground"
            />
            <Input
              type="search"
              autoComplete="off"
              aria-label={t('common.search')}
              aria-controls={listId}
              aria-activedescendant={matches.length > 0 ? `${ids}-option-${current}` : undefined}
              placeholder={t('common.search')}
              className="h-8 rounded-lg pl-8 md:text-[0.8125rem]"
              value={search}
              onChange={(event) => {
                setSearch(event.target.value);
                setActive(0);
              }}
              onKeyDown={onKeyDown}
            />
          </div>
          {matches.length === 0 ? (
            <p className="px-3 py-2 text-sm text-muted-foreground">{t('common.noMatches')}</p>
          ) : (
            <ul id={listId} role="listbox" className="flex max-h-80 flex-col overflow-y-auto">
              {matches.map((option, position) => (
                <li
                  key={option.value}
                  id={`${ids}-option-${position}`}
                  role="option"
                  aria-selected={option.value === props.value}
                  data-active={position === current ? 'true' : undefined}
                  className="flex cursor-pointer items-center gap-2 rounded-lg px-2.5 py-1.5 text-sm hover:bg-accent data-[active=true]:bg-accent"
                  onMouseEnter={() => setActive(position)}
                  onClick={() => pick(option.value)}
                >
                  <Check
                    aria-hidden
                    className={cn(
                      'size-4 shrink-0',
                      option.value === props.value ? 'opacity-100' : 'opacity-0',
                    )}
                  />
                  <span className="min-w-0 flex-1 truncate">{option.label}</span>
                  {option.hint ? (
                    <span className="shrink-0 text-[0.8125rem] text-muted-foreground">
                      {option.hint}
                    </span>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
