import { matchesQuery, queryTerms, searchKeys } from '@tugeel/shared/text';
import { Popover } from 'radix-ui';
import { Check, ChevronDown, X } from 'lucide-react';
import { type KeyboardEvent, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';

export interface SearchSelectOption {
  value: string;
  label: string;
  /** What else it is found by, e.g. the code. */
  keys?: readonly string[];
}

/**
 * A form's choice among many, by typing straight into the field (owner 2026-11-05, ADR-0152): letters
 * or a click open the list, letters narrow it, arrows move and Enter takes the row. Leaving keeps the
 * choice. A dialog's first focus opens nothing, so the list never covers a form just opened.
 */
export function SearchSelect(props: {
  id?: string;
  'aria-label'?: string;
  value: string;
  options: readonly SearchSelectOption[];
  onChange: (value: string) => void;
  placeholder?: string;
  invalid?: boolean;
  className?: string;
  /**
   * The rows come from the server as the text changes (customers, suppliers): nothing lists before
   * a letter, nothing is filtered here, and `chosenLabel` names a choice no longer among the rows.
   */
  onSearch?: (text: string) => void;
  searching?: boolean;
  chosenLabel?: string;
  /** Offers ✕ once something is chosen. */
  onClear?: () => void;
}) {
  const { t } = useTranslation();
  const ids = useId();
  const input = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [active, setActive] = useState(0);
  const terms = useMemo(() => queryTerms(search), [search]);
  const matches = useMemo(
    () =>
      terms.length === 0 || props.onSearch
        ? props.options
        : props.options.filter((option) =>
            matchesQuery(searchKeys(option.label, [...(option.keys ?? [])]), terms),
          ),
    [props.options, props.onSearch, terms],
  );
  const rows = matches;
  const current = active < rows.length ? active : 0;
  const chosenLabel =
    props.chosenLabel ?? props.options.find((option) => option.value === props.value)?.label ?? '';
  const showList = open && (!props.onSearch || search.trim() !== '');
  const listId = `${ids}-list`;

  // With the choice selected, the next letter replaces it and starts a search.
  useLayoutEffect(() => {
    if (!open && document.activeElement === input.current) input.current?.select();
  }, [open, props.value]);

  // The arrows keep the active row in sight, moving only the list (never the page).
  const list = useRef<HTMLUListElement>(null);
  useLayoutEffect(() => {
    const box = list.current;
    const row = box?.children[current];
    if (!box || !(row instanceof HTMLElement)) return;
    if (row.offsetTop < box.scrollTop) box.scrollTop = row.offsetTop;
    else if (row.offsetTop + row.offsetHeight > box.scrollTop + box.clientHeight) {
      box.scrollTop = row.offsetTop + row.offsetHeight - box.clientHeight;
    }
  }, [current]);

  const close = () => {
    setOpen(false);
    setSearch('');
    props.onSearch?.('');
    setActive(0);
  };
  const pick = (value: string) => {
    props.onChange(value);
    close();
  };
  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      if (!showList) {
        setOpen(true);
        return;
      }
      if (rows.length === 0) return;
      const step = event.key === 'ArrowDown' ? 1 : -1;
      setActive((current + step + rows.length) % rows.length);
    } else if (event.key === 'Enter' && showList) {
      // Enter takes the row; it never saves the form under a half-made choice.
      event.preventDefault();
      const row = rows[current];
      if (row) pick(row.value);
    } else if (event.key === 'Escape' && open) {
      event.preventDefault();
      event.stopPropagation();
      close();
    }
  };

  return (
    <Popover.Root
      open={showList}
      onOpenChange={(next) => {
        if (next) setOpen(true);
        else close();
      }}
    >
      <Popover.Anchor asChild>
        <div className={cn('relative', props.className)}>
          <Input
            ref={input}
            id={props.id}
            role="combobox"
            aria-label={props['aria-label']}
            aria-expanded={showList}
            aria-autocomplete="list"
            aria-controls={showList ? listId : undefined}
            aria-activedescendant={
              rows.length > 0 && showList ? `${ids}-option-${current}` : undefined
            }
            aria-invalid={props.invalid ? true : undefined}
            autoComplete="off"
            className="pr-9"
            // A choice cut by a narrow field reads whole on hover.
            title={!open && chosenLabel ? chosenLabel : undefined}
            placeholder={open ? chosenLabel || props.placeholder : props.placeholder}
            value={open ? search : chosenLabel}
            onFocus={(event) => event.target.select()}
            onClick={() => setOpen(true)}
            onChange={(event) => {
              const text = event.target.value;
              const shown = open ? '' : chosenLabel;
              const typed = text.startsWith(shown) ? text.slice(shown.length) : text;
              setSearch(typed);
              props.onSearch?.(typed);
              setActive(0);
              setOpen(true);
            }}
            onKeyDown={onKeyDown}
          />
          {props.onClear && props.value !== '' && !open ? (
            <button
              type="button"
              aria-label={t('common.clear')}
              className="absolute top-1/2 right-2 flex size-6 -translate-y-1/2 items-center justify-center rounded-md opacity-60 hover:bg-muted hover:opacity-100"
              onClick={() => {
                props.onClear?.();
                input.current?.focus();
              }}
            >
              <X aria-hidden className="size-4" />
            </button>
          ) : (
            <ChevronDown
              aria-hidden
              className="pointer-events-none absolute top-1/2 right-3 size-4 -translate-y-1/2 opacity-60"
            />
          )}
        </div>
      </Popover.Anchor>
      <Popover.Portal>
        <Popover.Content
          align="start"
          sideOffset={4}
          // The caret stays in the field; a click on the field itself is not outside.
          onOpenAutoFocus={(event) => event.preventDefault()}
          onCloseAutoFocus={(event) => event.preventDefault()}
          onInteractOutside={(event) => {
            if (event.target === input.current) event.preventDefault();
          }}
          className="z-50 w-(--radix-popover-trigger-width) min-w-[min(24rem,90vw)] rounded-lg border bg-popover p-1 shadow-popover"
        >
          {rows.length === 0 ? (
            <p className="px-3 py-2 text-sm text-muted-foreground">
              {t(props.searching ? 'common.loading' : 'common.noMatches')}
            </p>
          ) : (
            <ul
              ref={list}
              id={listId}
              role="listbox"
              className="relative flex max-h-72 flex-col overflow-y-auto"
            >
              {rows.map((option, position) => (
                <li
                  key={option.value}
                  id={`${ids}-option-${position}`}
                  role="option"
                  aria-selected={option.value === props.value}
                  data-active={position === current ? 'true' : undefined}
                  className="flex cursor-pointer items-center gap-2 rounded-md px-2.5 py-1.5 text-sm data-[active=true]:bg-accent"
                  onMouseEnter={() => setActive(position)}
                  // Before the field's blur, so the row is taken.
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => pick(option.value)}
                >
                  <Check
                    aria-hidden
                    className={cn(
                      'size-4 shrink-0',
                      option.value === props.value ? 'opacity-100' : 'opacity-0',
                    )}
                  />
                  <span className="min-w-0 flex-1">{option.label}</span>
                </li>
              ))}
            </ul>
          )}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
