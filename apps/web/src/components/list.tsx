import { ChevronRight, Inbox, type LucideIcon, Search, X } from 'lucide-react';
import {
  type ComponentProps,
  createContext,
  type ReactNode,
  type Ref,
  type RefObject,
  useContext,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Table, TableCell, TableHead, TableRow } from '@/components/ui/table';
import { columnLayout, type ColumnSpec } from '@/lib/column-layout';
import { cn } from '@/lib/utils';

/*
 * The list kit (ADR-0042, docs/ui.md): a filter bar (search box, filter pills, the column chooser
 * at the end) above a white card that holds the table, its empty state and «Цааш үзэх». Rows of
 * lists whose records have their own page open it on a click anywhere (LinkRow).
 */

export function FilterBar(props: { children: ReactNode; end?: ReactNode; className?: string }) {
  return (
    <div className={cn('mb-3 flex flex-wrap items-center gap-2', props.className)}>
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
      <Input type="search" {...props} className="h-8.5 rounded-full pl-9 md:text-[0.8125rem]" />
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
        'inline-flex h-8.5 cursor-pointer items-center gap-2 rounded-full border px-3 text-[0.8125rem] font-medium shadow-control transition-colors duration-200 select-none',
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
      className="group inline-flex h-8.5 items-center gap-2 rounded-full border border-border bg-background pl-3 text-[0.8125rem] font-medium shadow-control focus-within:border-ring focus-within:ring-1 focus-within:ring-ring hover:bg-accent data-[active=true]:border-transparent data-[active=true]:bg-secondary data-[active=true]:text-secondary-foreground"
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
    <span className="inline-flex h-8.5 max-w-full items-center gap-1 rounded-full bg-secondary pr-1 pl-3 text-[0.8125rem] font-medium text-secondary-foreground">
      <span className="min-w-0 truncate">{props.children}</span>
      <Button
        size="icon-xs"
        variant="ghost"
        className="rounded-full text-secondary-foreground hover:bg-secondary-hover"
        aria-label={props.clearLabel}
        title={props.clearLabel}
        onClick={props.onClear}
      >
        <X />
      </Button>
    </span>
  );
}

/**
 * An Apple segmented control: a few mutually exclusive views of a list (in force / planned / all).
 * The segments are tabs, so tests and screen readers find them by name; `name` names the group
 * when its segments alone do not say what they choose (a paper size).
 */
export function SegmentedControl<T extends string>(props: {
  options: readonly T[];
  value: T;
  label: (value: T) => string;
  onChange: (value: T) => void;
  name?: string;
}) {
  return (
    <div
      role="tablist"
      aria-label={props.name}
      className="inline-flex rounded-full bg-black/[0.05] p-0.5"
    >
      {props.options.map((value) => {
        const selected = value === props.value;
        return (
          <button
            key={value}
            type="button"
            role="tab"
            aria-selected={selected}
            className={cn(
              'h-7.5 rounded-full px-3.5 text-[0.8125rem] font-medium transition-[color,background-color,box-shadow] duration-200 ease-apple outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset',
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

/**
 * The white card a list's table sits in; the table runs to its edges. `scroll` (the main list of
 * a menu page, ADR-0066) makes the card its own scroller, as tall as the window leaves it: the
 * header row stays in view and so does the sideways scrollbar of a wide table. Printing shows
 * every row.
 */
export function ListCard(props: { children: ReactNode; className?: string; scroll?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  const maxHeight = useFittedHeight(ref, props.scroll === true);
  return (
    <div
      ref={ref}
      data-slot="list-card"
      style={maxHeight === null ? undefined : { maxHeight }}
      className={cn(
        'overflow-hidden rounded-xl bg-card shadow-card ring-1 ring-black/[0.06] print:shadow-none',
        props.scroll && SCROLLING_CARD,
        props.className,
      )}
    >
      {props.children}
    </div>
  );
}

/** True inside a `ListTable` whose columns are sized by the layout rather than by their content. */
const ColumnLayoutContext = createContext(false);

/**
 * A list's table with sized columns (ADR-0119): when its box is at least as wide as the spec's
 * minimum, `table-layout: fixed` with a `<colgroup>` from `lib/column-layout.ts` — codes, dates,
 * money, counts and status pills keep a fixed width, the text columns get their minimum and share
 * the rest by weight, a cell wider than its column is cut with «…». In a narrower box (a laptop
 * showing a wide register) the table keeps the browser's own layout and scrolls sideways in its
 * card, as before. The spec must have one entry per cell of a row — the checkbox, the spacer and
 * the chevron or the actions included. Widths are in rem; the box is measured in px.
 */
export function ListTable(props: {
  columns: readonly ColumnSpec[];
  children: ReactNode;
  className?: string;
  ref?: Ref<HTMLTableElement>;
}) {
  const box = useRef<HTMLDivElement>(null);
  const available = useBoxWidth(box);
  const layout = useMemo(
    () => (available === null ? null : columnLayout(props.columns, available)),
    [props.columns, available],
  );
  const sized = layout !== null && available !== null && available >= layout.minWidth;
  return (
    <div ref={box} data-slot="list-table" className="min-w-0">
      <ColumnLayoutContext value={sized}>
        <Table
          ref={props.ref}
          data-layout={sized ? 'columns' : undefined}
          className={cn(
            sized &&
              'table-fixed [&_td]:overflow-hidden [&_td]:text-ellipsis [&_th]:overflow-hidden [&_th]:text-ellipsis',
            props.className,
          )}
        >
          {sized ? (
            <colgroup>
              {props.columns.map((column, index) => (
                <col key={column.key} style={{ width: `${layout.widths[index]}rem` }} />
              ))}
            </colgroup>
          ) : null}
          {props.children}
        </Table>
      </ColumnLayoutContext>
    </div>
  );
}

/**
 * The width of a box in rem, kept current as the window or the page resizes; null until measured
 * (and in jsdom, whose boxes have no size).
 */
function useBoxWidth(ref: RefObject<HTMLElement | null>): number | null {
  const [width, setWidth] = useState<number | null>(null);
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    const measure = () => {
      const px = element.clientWidth;
      const next = px > 0 ? px / remPx() : null;
      setWidth((previous) => (previous === next ? previous : next));
    };
    measure();
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure);
    observer?.observe(element);
    window.addEventListener('resize', measure);
    return () => {
      observer?.disconnect();
      window.removeEventListener('resize', measure);
    };
  }, [ref]);
  return width;
}

/** The root font size in px (1rem), read once. */
let rem: number | null = null;
function remPx(): number {
  if (rem === null) {
    const size = Number.parseFloat(getComputedStyle(document.documentElement).fontSize);
    rem = Number.isFinite(size) && size > 0 ? size : 16;
  }
  return rem;
}

/** A scrolling card: its own table box stops scrolling and the header cells stick to its top. */
const SCROLLING_CARD =
  'overflow-auto [scrollbar-color:var(--border)_transparent] [scrollbar-width:thin] print:max-h-none! print:overflow-visible [&_[data-slot=table-container]]:overflow-visible [&_[data-slot=table-head]]:sticky [&_[data-slot=table-head]]:top-0 [&_[data-slot=table-head]]:z-10 [&_[data-slot=table-head]]:bg-card [&_[data-slot=table-head]]:shadow-[inset_0_-1px_0_var(--color-border)]';

/** Space kept under a scrolling card: the page's bottom padding (`pb-10`). */
const BELOW_CARD = 40;

/**
 * Below this much room (a card low on the page, under a form or tiles) the card does not scroll
 * by itself: the page scrolls as usual, so there is never a scroll inside a scroll.
 */
const MIN_FITTED = 288;

/**
 * The height a scrolling card may take: what the window leaves between its top and what follows it
 * on the page (later cards, the page's bottom padding), when that is enough.
 */
function useFittedHeight(ref: RefObject<HTMLElement | null>, enabled: boolean): number | null {
  const [height, setHeight] = useState<number | null>(null);
  useLayoutEffect(() => {
    const element = ref.current;
    if (!enabled || !element) return;
    const measure = () => {
      const box = element.getBoundingClientRect();
      const frame = element.closest('main')?.firstElementChild;
      const after = frame ? Math.max(0, frame.getBoundingClientRect().bottom - box.bottom) : 0;
      const room = Math.floor(window.innerHeight - (box.top + window.scrollY) - after - BELOW_CARD);
      const next = room >= MIN_FITTED ? room : null;
      setHeight((previous) => (previous === next ? previous : next));
    };
    measure();
    window.addEventListener('resize', measure);
    // Content above the card (an alert, a second row of filters) moves it: the page's main resizes.
    const main = element.closest('main');
    const observer =
      typeof ResizeObserver === 'undefined' || !main ? null : new ResizeObserver(measure);
    if (observer && main) observer.observe(main);
    return () => {
      window.removeEventListener('resize', measure);
      observer?.disconnect();
    };
  }, [enabled, ref]);
  return enabled ? height : null;
}

const INTERACTIVE =
  'a, button, input, select, textarea, label, [role="checkbox"], [role="menuitem"]';

/**
 * A row that opens its record (ADR-0042, replacing ADR-0037 #4's «Засах» button): a click anywhere
 * on it, except on its own links and controls, with a modifier key or while text is selected (people
 * copy codes). The record's name or number stays a link: the keyboard and screen-reader path. The
 * chevron at the end shows the row leads somewhere.
 */
export function LinkRow(props: {
  to: string;
  children: ReactNode;
  className?: string;
  /** A ticked row of a list with a checkbox column: tinted. */
  selected?: boolean;
}) {
  const navigate = useNavigate();
  return (
    <TableRow
      data-state={props.selected ? 'selected' : undefined}
      className={cn('cursor-pointer has-[a:focus-visible]:bg-accent', props.className)}
      onClick={(event) => {
        if (opensRecord(event)) void navigate(props.to);
      }}
    >
      {props.children}
      <TableCell aria-hidden className="w-9 pl-0 text-muted-foreground/60">
        <ChevronRight className="size-4" />
      </TableCell>
    </TableRow>
  );
}

/**
 * A row that opens its record in a panel of this page (the sales list view, ADR-0066): a click
 * anywhere on it, with LinkRow's exceptions. The row keeps a real button or link (its number) for
 * the keyboard; `ChevronHead` heads its chevron column too.
 */
export function ButtonRow(props: {
  onOpen: () => void;
  children: ReactNode;
  className?: string;
  selected?: boolean;
}) {
  return (
    <TableRow
      data-state={props.selected ? 'selected' : undefined}
      className={cn(
        'cursor-pointer has-[a:focus-visible,button:focus-visible]:bg-accent',
        props.className,
      )}
      onClick={(event) => {
        if (opensRecord(event)) props.onOpen();
      }}
    >
      {props.children}
      <TableCell aria-hidden className="w-9 pl-0 text-muted-foreground/60">
        <ChevronRight className="size-4" />
      </TableCell>
    </TableRow>
  );
}

/** A plain left click on the row itself, not on its controls, and no text being selected. */
function opensRecord(event: {
  button: number;
  metaKey: boolean;
  ctrlKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
  target: EventTarget | null;
}): boolean {
  if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
    return false;
  }
  if (event.target instanceof Element && event.target.closest(INTERACTIVE)) return false;
  return !window.getSelection()?.toString();
}

/**
 * Long text in a row (a product or customer name): one line cut with «…», the whole text on hover.
 * Inside a `ListTable` the column's width comes from the layout; elsewhere the text is capped at
 * 24rem and `fill` gives the column the table's spare width (the main column of a short list).
 */
export function TruncateCell(props: {
  text: string;
  children?: ReactNode;
  className?: string;
  fill?: boolean;
}) {
  const sized = useContext(ColumnLayoutContext);
  return (
    <TableCell className={cn(!sized && props.fill && 'w-full max-w-0', props.className)}>
      <span
        className={cn('block truncate', !sized && !props.fill && 'max-w-[24rem]')}
        title={props.text}
      >
        {props.children ?? props.text}
      </span>
    </TableCell>
  );
}

/**
 * An empty cell that takes a short table's spare width (ADR-0066), placed before the row's actions
 * or chevron: the data stays next to the names on a wide screen and the actions keep the right
 * edge. Pair `SpacerHead` in the header row with `SpacerCell` in every row.
 */
export function SpacerHead() {
  return <TableHead aria-hidden className="w-full p-0" />;
}

export function SpacerCell() {
  return <TableCell aria-hidden className="w-full p-0" />;
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
    <TableCell className="w-px py-0.5 whitespace-nowrap">
      <div className="flex justify-end gap-0.5">{children}</div>
    </TableCell>
  );
}

export function RowAction(props: {
  label: string;
  icon: LucideIcon;
  onClick: () => void;
  destructive?: boolean;
  disabled?: boolean;
}) {
  const Icon = props.icon;
  return (
    <Button
      type="button"
      size="icon-sm"
      variant="ghost"
      className={cn(
        'size-7 text-muted-foreground hover:text-foreground',
        props.destructive && 'hover:bg-danger-soft hover:text-destructive',
      )}
      aria-label={props.label}
      title={props.label}
      disabled={props.disabled}
      onClick={props.onClick}
    >
      <Icon />
    </Button>
  );
}

/** Keeps a missing action's place, so each action stays in its own column down the list. */
export function RowActionSpacer() {
  return <span aria-hidden className="inline-block size-7" />;
}

/**
 * What an empty list says, with the action that fills it when there is one; `onClearFilters`
 * (a list narrowed by filters) offers «Шүүлтүүр арилгах».
 */
export function EmptyState(props: {
  title: string;
  icon?: LucideIcon;
  action?: ReactNode;
  onClearFilters?: () => void;
}) {
  const { t } = useTranslation();
  const Icon = props.icon ?? Inbox;
  return (
    <div className="flex flex-col items-center gap-2.5 px-6 py-10 text-center">
      <span className="grid size-11 place-items-center rounded-full bg-fill text-muted-foreground">
        <Icon aria-hidden className="size-5" />
      </span>
      <p className="max-w-sm text-sm text-muted-foreground">{props.title}</p>
      {props.action}
      {props.onClearFilters ? (
        <Button variant="ghost" size="sm" className="text-link" onClick={props.onClearFilters}>
          {t('common.clearFilters')}
        </Button>
      ) : null}
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
        pending={props.query.isFetchingNextPage}
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
        <td key={column} className="h-9 px-3 first:pl-4 last:pr-4">
          <div className="h-3 w-full max-w-28 animate-pulse rounded bg-fill" />
        </td>
      ))}
    </tr>
  ));
}
