import { matchesQuery, queryTerms, searchKeys } from '@tugeel/shared/text';
import { ChevronRight, Search } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { FilterOption } from '@/components/filter-panel';
import { Input } from '@/components/ui/input';
import { formatCount } from '@/lib/money';
import { cn } from '@/lib/utils';

/** One row of a tree in a list's side panel. Siblings stay in the order they are given. */
export interface FilterTreeRow {
  id: number;
  parentId: number | null;
  /** What the row says, beside its code. */
  title: string;
  /** Its whole name: on hover, and what the expand button names. */
  name: string;
  code?: string | null;
  /** What it holds, everything below it included. */
  count: number;
}

interface TreeNode {
  row: FilterTreeRow;
  children: TreeNode[];
}

function buildTree(rows: readonly FilterTreeRow[]): TreeNode[] {
  const byParent = new Map<number | null, FilterTreeRow[]>();
  for (const row of rows) {
    byParent.set(row.parentId, [...(byParent.get(row.parentId) ?? []), row]);
  }
  const nodes = (parentId: number | null): TreeNode[] =>
    (byParent.get(parentId) ?? []).map((row) => ({ row, children: nodes(row.id) }));
  return nodes(null);
}

/** The ids on the way to a row, so a link to it opens its branch. */
function ancestorsOf(rows: readonly FilterTreeRow[], id: number | undefined): Set<number> {
  const parents = new Map(rows.map((row) => [row.id, row.parentId]));
  const out = new Set<number>();
  let parent = id === undefined ? null : (parents.get(id) ?? null);
  while (parent !== null && !out.has(parent)) {
    out.add(parent);
    parent = parents.get(parent) ?? null;
  }
  return out;
}

/** Each row's way from the top: what a search finds it by and what a match shows. */
function pathsOf(rows: readonly FilterTreeRow[]): Map<number, string> {
  const byId = new Map(rows.map((row) => [row.id, row]));
  const paths = new Map<number, string>();
  const pathOf = (row: FilterTreeRow, seen: Set<number>): string => {
    const known = paths.get(row.id);
    if (known !== undefined) return known;
    const parent = row.parentId === null ? undefined : byId.get(row.parentId);
    const path =
      parent && !seen.has(parent.id)
        ? `${pathOf(parent, new Set([...seen, parent.id]))} / ${row.name}`
        : row.name;
    paths.set(row.id, path);
    return path;
  };
  for (const row of rows) pathOf(row, new Set([row.id]));
  return paths;
}

function TreeRow(props: {
  node: TreeNode;
  depth: number;
  selected: number | undefined;
  opened: ReadonlySet<number>;
  onToggle: (id: number) => void;
  onPick: (id: number | undefined) => void;
}) {
  const { t } = useTranslation();
  const { node, selected } = props;
  const { row } = node;
  const open = props.opened.has(row.id);
  const active = selected === row.id;
  return (
    <li>
      <div
        className={cn(
          'flex items-center rounded-md hover:bg-accent',
          active && 'bg-secondary text-secondary-foreground hover:bg-secondary',
        )}
        style={{ paddingLeft: `${props.depth * 0.75}rem` }}
      >
        {node.children.length > 0 ? (
          <button
            type="button"
            aria-expanded={open}
            aria-label={t(
              open ? 'catalog.products.panel.collapse' : 'catalog.products.panel.expand',
              { name: row.name },
            )}
            className="flex size-6 shrink-0 items-center justify-center rounded text-muted-foreground hover:text-foreground"
            onClick={() => props.onToggle(row.id)}
          >
            <ChevronRight
              aria-hidden
              className={cn('size-3.5 transition-transform', open && 'rotate-90')}
            />
          </button>
        ) : (
          <span aria-hidden className="size-6 shrink-0" />
        )}
        <button
          type="button"
          aria-pressed={active}
          title={row.name}
          className="flex min-w-0 flex-1 items-baseline gap-1.5 py-1 pr-2 text-left text-[0.8125rem]"
          onClick={() => props.onPick(active ? undefined : row.id)}
        >
          {row.code ? (
            <span className="shrink-0 font-mono text-xs font-semibold text-link">{row.code}</span>
          ) : null}
          <span className={cn('min-w-0 flex-1 truncate', active && 'font-medium')}>
            {row.title}
          </span>
          <span className="shrink-0 font-mono text-xs text-muted-foreground">
            {formatCount(row.count)}
          </span>
        </button>
      </div>
      {open && node.children.length > 0 ? (
        <ul>
          {node.children.map((child) => (
            <TreeRow key={child.row.id} {...props} node={child} depth={props.depth + 1} />
          ))}
        </ul>
      ) : null}
    </li>
  );
}

/**
 * A tree of choices in a list's side panel: «all» on top with its count, each branch opening, the
 * row of a link or address shown open. With `searchLabel`, a box above it narrows the tree to a flat
 * list of the rows found: each row's name, and the way to it below.
 */
export function FilterTree(props: {
  rows: readonly FilterTreeRow[];
  selected: number | undefined;
  onPick: (id: number | undefined) => void;
  allLabel: string;
  searchLabel?: string;
  noMatchLabel?: string;
}) {
  const { rows, selected } = props;
  const tree = useMemo(() => buildTree(rows), [rows]);
  const total = tree.reduce((sum, node) => sum + node.row.count, 0);
  const [opened, setOpened] = useState<ReadonlySet<number>>(new Set());
  const [search, setSearch] = useState('');
  const terms = useMemo(() => queryTerms(search), [search]);
  const paths = useMemo(() => pathsOf(rows), [rows]);
  const found = useMemo(
    () =>
      terms.length === 0
        ? []
        : rows.filter((row) => matchesQuery(searchKeys(paths.get(row.id) ?? row.name, []), terms)),
    [rows, paths, terms],
  );
  // A row chosen from a link or the address shows its branch open.
  const shown = useMemo(
    () => new Set([...opened, ...ancestorsOf(rows, selected)]),
    [opened, rows, selected],
  );
  const toggle = (id: number) =>
    setOpened((before) => {
      const next = new Set(shown);
      if (before.has(id) || shown.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const count = (value: number) => (
    <span className="font-mono text-xs text-muted-foreground">{formatCount(value)}</span>
  );
  return (
    <div className="flex flex-col gap-0.5">
      {props.searchLabel ? (
        <div className="relative mb-1">
          <Search
            aria-hidden
            className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground"
          />
          <Input
            type="search"
            aria-label={props.searchLabel}
            placeholder={props.searchLabel}
            value={search}
            className="h-8 pl-8 md:text-[0.8125rem]"
            onChange={(event) => setSearch(event.target.value)}
          />
        </div>
      ) : null}
      {terms.length > 0 ? (
        <>
          {found.map((row) => (
            <FilterOption
              key={row.id}
              label={
                <span title={paths.get(row.id)}>
                  <span className="block truncate">{row.name}</span>
                  {row.parentId !== null ? (
                    <span className="block truncate text-xs text-muted-foreground">
                      {paths.get(row.parentId)}
                    </span>
                  ) : null}
                </span>
              }
              active={selected === row.id}
              hint={count(row.count)}
              onClick={() => props.onPick(selected === row.id ? undefined : row.id)}
            />
          ))}
          {found.length === 0 ? (
            <p className="px-2 py-1 text-[0.8125rem] text-muted-foreground">{props.noMatchLabel}</p>
          ) : null}
        </>
      ) : (
        <>
          <FilterOption
            label={props.allLabel}
            active={selected === undefined}
            hint={count(total)}
            onClick={() => props.onPick(undefined)}
          />
          <ul>
            {tree.map((node) => (
              <TreeRow
                key={node.row.id}
                node={node}
                depth={0}
                selected={selected}
                opened={shown}
                onToggle={toggle}
                onPick={props.onPick}
              />
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
