import { ChevronRight, Inbox, type LucideIcon, Search, X } from 'lucide-react';
import type { ComponentProps, ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { TableCell, TableHead, TableRow } from '@/components/ui/table';
import { cn } from '@/lib/utils';

/*
 * The list kit (ADR-0042, docs/ui.md): a filter bar (search box, filter pills, the column chooser
 * at the end) above a white card that holds the table, its empty state and «Цааш үзэх». Rows of
 * lists whose records have their own page open it on a click anywhere (LinkRow).
 */

export function FilterBar(props: { children: ReactNode; end?: ReactNode; className?: string }) {
  return (
    <div className={cn('mb-4 flex flex-wrap items-center gap-2', props.className)}>
      {props.children}
      {props.end ? (
        <div className="ml-auto flex flex-wrap items-center gap-2">{props.end}</div>
      ) : null}
    </div>
  );
}

/** A list's search box: still an `<input type="search">` (role searchbox), with a magnifier. */
export function SearchField({ className, ...props }: ComponentProps<'input'>) {
  return (
    <div className={cn('relative w-full sm:w-72', className)}>
      <Search
        aria-hidden
        className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
      />
      <Input type="search" {...props} className="h-8 rounded-full pl-9 md:text-[13px]" />
    </div>
  );
}

/** A yes/no filter drawn as a pill; still a labelled checkbox for keyboards and tests. */
export function FilterToggle(props: {
  label: string;
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
}) {
  return (
    <label
      className={cn(
        'inline-flex h-8 cursor-pointer items-center gap-2 rounded-full border px-3 text-[13px] font-medium shadow-control transition-colors select-none',
        props.checked
          ? 'border-transparent bg-secondary text-secondary-foreground'
          : 'border-border bg-background hover:bg-accent',
      )}
    >
      <Checkbox
        checked={props.checked}
        onCheckedChange={(checked) => props.onCheckedChange(checked === true)}
      />
      {props.label}
    </label>
  );
}

/** A date bound in the filter bar: a pill that names itself, tinted while it narrows the list. */
export function DateFilter(props: {
  label: string;
  value: string | undefined;
  onChange: (value: string | undefined) => void;
}) {
  return (
    <label
      data-active={props.value ? 'true' : undefined}
      className="group inline-flex h-8 items-center gap-2 rounded-full border border-border bg-background pl-3 text-[13px] font-medium shadow-control focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/25 hover:bg-accent data-[active=true]:border-transparent data-[active=true]:bg-secondary data-[active=true]:text-secondary-foreground"
    >
      <span className="text-muted-foreground group-data-[active=true]:text-secondary-foreground">
        {props.label}
      </span>
      <input
        type="date"
        className="h-full rounded-r-full bg-transparent pr-3 font-mono outline-none"
        value={props.value ?? ''}
        onChange={(event) => props.onChange(event.target.value || undefined)}
      />
    </label>
  );
}

/** A chosen record used as a filter (a product, a shelf): a tinted pill whose button clears it. */
export function FilterChip(props: {
  children: ReactNode;
  clearLabel: string;
  onClear: () => void;
}) {
  return (
    <span className="inline-flex h-8 max-w-full items-center gap-1 rounded-full bg-secondary pr-1 pl-3 text-[13px] font-medium text-secondary-foreground">
      <span className="min-w-0 truncate">{props.children}</span>
      <Button
        size="icon-xs"
        variant="ghost"
        className="rounded-full text-secondary-foreground hover:bg-secondary-hover"
        aria-label={props.clearLabel}
        onClick={props.onClear}
      >
        <X />
      </Button>
    </span>
  );
}

/**
 * An Apple segmented control: a few mutually exclusive views of a list (in force / planned / all).
 * The segments are tabs, so tests and screen readers find them by name.
 */
export function SegmentedControl<T extends string>(props: {
  options: readonly T[];
  value: T;
  label: (value: T) => string;
  onChange: (value: T) => void;
}) {
  return (
    <div role="tablist" className="inline-flex rounded-lg bg-black/[0.05] p-0.5">
      {props.options.map((value) => {
        const selected = value === props.value;
        return (
          <button
            key={value}
            type="button"
            role="tab"
            aria-selected={selected}
            className={cn(
              'h-7 rounded-[8px] px-3 text-[13px] font-medium transition-[color,background-color,box-shadow] outline-none focus-visible:ring-3 focus-visible:ring-ring/30',
              selected
                ? 'bg-background text-foreground shadow-control'
                : 'text-muted-foreground hover:text-foreground',
            )}
            onClick={() => props.onChange(value)}
          >
            {props.label(value)}
          </button>
        );
      })}
    </div>
  );
}

/** The white card a list's table sits in; the table runs to its edges. */
export function ListCard(props: { children: ReactNode; className?: string }) {
  return (
    <div
      data-slot="list-card"
      className={cn(
        'overflow-hidden rounded-xl bg-card shadow-card ring-1 ring-black/[0.06] print:shadow-none',
        props.className,
      )}
    >
      {props.children}
    </div>
  );
}

const INTERACTIVE =
  'a, button, input, select, textarea, label, [role="checkbox"], [role="menuitem"]';

/**
 * A row that opens its record (ADR-0042, replacing ADR-0037 #4's «Засах» button): a click anywhere
 * on it, except on its own links and controls, with a modifier key or while text is selected (people
 * copy codes). The record's name or number stays a link: the keyboard and screen-reader path. The
 * chevron at the end shows the row leads somewhere.
 */
export function LinkRow(props: { to: string; children: ReactNode; className?: string }) {
  const navigate = useNavigate();
  return (
    <TableRow
      className={cn('cursor-pointer has-[a:focus-visible]:bg-accent', props.className)}
      onClick={(event) => {
        if (
          event.button !== 0 ||
          event.metaKey ||
          event.ctrlKey ||
          event.shiftKey ||
          event.altKey
        ) {
          return;
        }
        if (event.target instanceof Element && event.target.closest(INTERACTIVE)) return;
        if (window.getSelection()?.toString()) return;
        void navigate(props.to);
      }}
    >
      {props.children}
      <TableCell aria-hidden className="w-9 pl-0 text-muted-foreground/60">
        <ChevronRight className="size-4" />
      </TableCell>
    </TableRow>
  );
}

/** The (empty) header cell above LinkRow's chevrons. */
export function ChevronHead() {
  return <TableHead aria-hidden className="w-9 pl-0" />;
}

/**
 * The actions cell at the end of a row of a list without its own record pages (categories, units
 * of measure): quiet icon buttons, each named for screen readers and shown as a tooltip.
 */
export function RowActions({ children }: { children: ReactNode }) {
  return (
    <TableCell className="w-px py-1 whitespace-nowrap">
      <div className="flex justify-end gap-0.5">{children}</div>
    </TableCell>
  );
}

export function RowAction(props: {
  label: string;
  icon: LucideIcon;
  onClick: () => void;
  destructive?: boolean;
}) {
  const Icon = props.icon;
  return (
    <Button
      size="icon-sm"
      variant="ghost"
      className={cn(
        'text-muted-foreground hover:text-foreground',
        props.destructive && 'hover:bg-danger-soft hover:text-destructive',
      )}
      aria-label={props.label}
      title={props.label}
      onClick={props.onClick}
    >
      <Icon />
    </Button>
  );
}

/** Keeps a missing action's place, so each action stays in its own column down the list. */
export function RowActionSpacer() {
  return <span aria-hidden className="inline-block size-8" />;
}

/** What an empty list says, with the action that fills it when there is one. */
export function EmptyState(props: { title: string; icon?: LucideIcon; action?: ReactNode }) {
  const Icon = props.icon ?? Inbox;
  return (
    <div className="flex flex-col items-center gap-2.5 px-6 py-12 text-center">
      <span className="grid size-11 place-items-center rounded-full bg-fill text-muted-foreground">
        <Icon aria-hidden className="size-5" />
      </span>
      <p className="max-w-sm text-sm text-muted-foreground">{props.title}</p>
      {props.action}
    </div>
  );
}

/** «Цааш үзэх» at the foot of a keyset list (ADR-0004), shown while there is a next page. */
export function LoadMore(props: {
  query: { hasNextPage: boolean; isFetchingNextPage: boolean; fetchNextPage: () => unknown };
}) {
  const { t } = useTranslation();
  if (!props.query.hasNextPage) return null;
  return (
    <div className="flex justify-center border-t border-border/80 p-1.5 print:hidden">
      <Button
        variant="ghost"
        size="sm"
        className="text-link"
        disabled={props.query.isFetchingNextPage}
        onClick={() => void props.query.fetchNextPage()}
      >
        {t('common.loadMore')}
      </Button>
    </div>
  );
}

/** Grey placeholder rows while a list loads; hidden from screen readers (no extra `status`). */
export function SkeletonRows(props: { columns: number; rows?: number }) {
  return Array.from({ length: props.rows ?? 4 }, (_, row) => (
    <tr key={row} aria-hidden className="border-b border-border/80">
      {Array.from({ length: props.columns }, (_, column) => (
        <td key={column} className="h-11 px-3 first:pl-4 last:pr-4">
          <div className="h-3 w-full max-w-28 animate-pulse rounded bg-fill" />
        </td>
      ))}
    </tr>
  ));
}
