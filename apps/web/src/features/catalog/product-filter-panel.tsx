import { Check, ChevronDown, ChevronRight, SlidersHorizontal } from 'lucide-react';
import { type ReactNode, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { ListCard } from '@/components/list';
import { useWarehouses } from '@/features/identity/api';
import { usePriceProfileChoices } from '@/features/pricing/api';
import { useSegments } from '@/features/segments/api';
import { formatCount } from '@/lib/money';
import { cn } from '@/lib/utils';
import type { Category } from './api';
import { categoryCode, compareCategories } from './category-code';
import { ProductFilterDialog } from './product-filter-dialog';
import {
  DATE_PRESETS,
  type DateFilter,
  filterParam,
  MISSING_CHOICES,
  missingLabelKey,
  type ProductFilterField,
  type ProductFilters,
  STOCK_KINDS,
  withFilter,
} from './product-filters';
import type { ProductStage } from './product-stage';

const SELLING_KINDS: readonly string[] = ['WHOLESALE', 'STORE'];

const toggled = (ids: readonly number[] | undefined, id: number) =>
  ids?.includes(id) ? ids.filter((value) => value !== id) : [...(ids ?? []), id];

/** One choice of a filter: a row that is ticked while it filters. */
function Option(props: {
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

/** A filter's name over its choices; it opens and closes, and says when it is in use. */
function Section(props: {
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
        className="flex w-full items-center gap-2 px-3 py-2.5 text-left text-xs font-semibold tracking-wide text-muted-foreground uppercase hover:text-foreground"
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

interface TreeNode {
  category: Category;
  children: TreeNode[];
  /** The products in it and everything below it. */
  count: number;
}

function buildTree(categories: readonly Category[]): TreeNode[] {
  const byParent = new Map<number | null, Category[]>();
  for (const category of categories) {
    byParent.set(category.parentId, [...(byParent.get(category.parentId) ?? []), category]);
  }
  const nodes = (parentId: number | null): TreeNode[] =>
    [...(byParent.get(parentId) ?? [])].sort(compareCategories).map((category) => {
      const children = nodes(category.id);
      return {
        category,
        children,
        count: children.reduce((sum, child) => sum + child.count, category.productCount),
      };
    });
  return nodes(null);
}

/** The ids on the way to a category, so a link to it opens its branch. */
function ancestorsOf(categories: readonly Category[], id: number | undefined): Set<number> {
  const parents = new Map(categories.map((category) => [category.id, category.parentId]));
  const out = new Set<number>();
  let parent = id === undefined ? null : (parents.get(id) ?? null);
  while (parent !== null && !out.has(parent)) {
    out.add(parent);
    parent = parents.get(parent) ?? null;
  }
  return out;
}

function CategoryRow(props: {
  node: TreeNode;
  depth: number;
  selected: number | undefined;
  opened: ReadonlySet<number>;
  onToggle: (id: number) => void;
  onPick: (id: number | undefined) => void;
}) {
  const { t } = useTranslation();
  const { node, selected } = props;
  const { category } = node;
  const { code, title } = categoryCode(category);
  const open = props.opened.has(category.id);
  const active = selected === category.id;
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
              { name: category.name },
            )}
            className="flex size-6 shrink-0 items-center justify-center rounded text-muted-foreground hover:text-foreground"
            onClick={() => props.onToggle(category.id)}
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
          title={category.name}
          className="flex min-w-0 flex-1 items-baseline gap-1.5 py-1 pr-2 text-left text-[0.8125rem]"
          onClick={() => props.onPick(active ? undefined : category.id)}
        >
          {code ? (
            <span className="shrink-0 font-mono text-xs font-semibold text-link">{code}</span>
          ) : null}
          <span className={cn('min-w-0 flex-1 truncate', active && 'font-medium')}>{title}</span>
          <span className="shrink-0 font-mono text-xs text-muted-foreground">
            {formatCount(node.count)}
          </span>
        </button>
      </div>
      {open && node.children.length > 0 ? (
        <ul>
          {node.children.map((child) => (
            <CategoryRow key={child.category.id} {...props} node={child} depth={props.depth + 1} />
          ))}
        </ul>
      ) : null}
    </li>
  );
}

function CategoryTree(props: {
  categories: readonly Category[];
  selected: number | undefined;
  onPick: (id: number | undefined) => void;
}) {
  const { t } = useTranslation();
  const { categories, selected } = props;
  const tree = useMemo(() => buildTree(categories), [categories]);
  const total = tree.reduce((sum, node) => sum + node.count, 0);
  const [opened, setOpened] = useState<ReadonlySet<number>>(new Set());
  // A category chosen from a link or the address shows its branch open.
  const shown = useMemo(
    () => new Set([...opened, ...ancestorsOf(categories, selected)]),
    [opened, categories, selected],
  );
  const toggle = (id: number) =>
    setOpened((before) => {
      const next = new Set(shown);
      if (before.has(id) || shown.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  return (
    <div className="flex flex-col gap-0.5">
      <Option
        label={t('catalog.products.panel.all')}
        active={selected === undefined}
        hint={<span className="font-mono text-xs text-muted-foreground">{formatCount(total)}</span>}
        onClick={() => props.onPick(undefined)}
      />
      <ul>
        {tree.map((node) => (
          <CategoryRow
            key={node.category.id}
            node={node}
            depth={0}
            selected={selected}
            opened={shown}
            onToggle={toggle}
            onPick={props.onPick}
          />
        ))}
      </ul>
    </div>
  );
}

const sameDays = (filter: DateFilter | undefined, days: number) =>
  filter !== undefined && 'days' in filter && filter.days === days;

/**
 * The product list's left side, after erxes (owner 2026-11-06): the categories on top with their
 * counts, then every filter with its choices in sight. A filter whose choices cannot be listed
 * (suppliers, a price range, chosen dates) opens its dialog. It writes what the list already reads
 * from the address, so a link and «back» keep working.
 */
export function ProductFilterPanel(props: {
  categories: readonly Category[];
  categoryId: number | undefined;
  onCategory: (id: number | undefined) => void;
  stages: readonly ProductStage[];
  stage: ProductStage | undefined;
  onStage: (stage: ProductStage | undefined) => void;
  filters: ProductFilters;
  onChange: (next: ProductFilters) => void;
}) {
  const { t } = useTranslation();
  const { filters } = props;
  const [dialog, setDialog] = useState<ProductFilterField | null>(null);
  const segments = useSegments('PRODUCT');
  const warehouses = useWarehouses();
  const profiles = usePriceProfileChoices();
  const selling = (warehouses.data ?? []).filter(
    (warehouse) => warehouse.status === 'ACTIVE' && SELLING_KINDS.includes(warehouse.kind),
  );
  const set = <F extends ProductFilterField>(field: F, value: ProductFilters[F] | undefined) =>
    props.onChange(withFilter(filters, field, value));
  const inUse = (field: ProductFilterField) => filterParam(field, filters) !== null;
  const more = (field: ProductFilterField, label: string) => (
    <button
      type="button"
      className="flex w-full items-center gap-1.5 rounded-md px-2 py-1 text-left text-[0.8125rem] font-medium text-link hover:bg-accent"
      onClick={() => setDialog(field)}
    >
      <SlidersHorizontal aria-hidden className="size-3.5" />
      {label}
    </button>
  );
  const dateSection = (field: 'created' | 'updated') => (
    <Section
      key={field}
      title={t(`catalog.products.filters.fields.${field}`)}
      active={inUse(field)}
    >
      {DATE_PRESETS.map((days) => (
        <Option
          key={days}
          label={
            days === 1
              ? t('catalog.products.filters.today')
              : t('catalog.products.filters.lastDays', { count: days })
          }
          active={sameDays(filters[field], days)}
          onClick={() => set(field, sameDays(filters[field], days) ? undefined : { days })}
        />
      ))}
      {more(field, t('catalog.products.panel.chooseDates'))}
    </Section>
  );

  return (
    <aside aria-label={t('catalog.products.panel.label')} className="hidden w-72 shrink-0 lg:block">
      <ListCard scroll beside>
        <Section title={t('catalog.product.category')} defaultOpen>
          <CategoryTree
            categories={props.categories}
            selected={props.categoryId}
            onPick={props.onCategory}
          />
        </Section>
        <Section title={t('catalog.products.filters.fields.segment')} active={inUse('segment')}>
          <div className="flex max-h-56 flex-col gap-0.5 overflow-y-auto">
            {(segments.data ?? []).map((segment) => (
              <Option
                key={segment.id}
                label={segment.name}
                active={filters.segment === segment.id}
                onClick={() =>
                  set('segment', filters.segment === segment.id ? undefined : segment.id)
                }
              />
            ))}
          </div>
          <Link
            to="/segments"
            className="rounded-md px-2 py-1 text-[0.8125rem] font-medium text-link hover:bg-accent"
          >
            {t('catalog.products.panel.manageSegments')}
          </Link>
        </Section>
        <Section title={t('catalog.product.status')} active={props.stage !== undefined} defaultOpen>
          {props.stages.map((value) => (
            <Option
              key={value}
              label={t(`catalog.products.status.${value}`)}
              active={props.stage === value}
              onClick={() => props.onStage(props.stage === value ? undefined : value)}
            />
          ))}
        </Section>
        <Section title={t('catalog.products.filters.fields.supplier')} active={inUse('supplier')}>
          {more('supplier', t('catalog.products.panel.chooseSuppliers'))}
        </Section>
        <Section title={t('catalog.products.filters.fields.home')} active={inUse('home')}>
          {selling.map((warehouse) => (
            <Option
              key={warehouse.id}
              label={warehouse.name}
              active={filters.home?.includes(warehouse.id) ?? false}
              onClick={() => {
                const next = toggled(filters.home, warehouse.id);
                set('home', next.length > 0 ? next : undefined);
              }}
            />
          ))}
        </Section>
        <Section title={t('catalog.products.filters.fields.profile')} active={inUse('profile')}>
          {(profiles.data ?? []).map((profile) => (
            <Option
              key={profile.id}
              label={profile.name}
              active={filters.profile?.includes(profile.id) ?? false}
              onClick={() => {
                const next = toggled(filters.profile, profile.id);
                set('profile', next.length > 0 ? next : undefined);
              }}
            />
          ))}
        </Section>
        <Section title={t('catalog.products.filters.fields.price')} active={inUse('price')}>
          {more('price', t('catalog.products.panel.choosePrice'))}
        </Section>
        <Section title={t('catalog.products.filters.fields.stock')} active={inUse('stock')}>
          {STOCK_KINDS.map((kind) => (
            <Option
              key={kind}
              label={t(`catalog.products.filters.stockKinds.${kind}`)}
              active={filters.stock?.kind === kind}
              onClick={() => set('stock', filters.stock?.kind === kind ? undefined : { kind })}
            />
          ))}
          {more('stock', t('catalog.products.panel.chooseWarehouse'))}
        </Section>
        {dateSection('created')}
        {dateSection('updated')}
        <Section title={t('catalog.products.filters.fields.missing')} active={inUse('missing')}>
          {MISSING_CHOICES.map((choice) => {
            const chosen = filters.missing ?? [];
            const active = chosen.includes(choice);
            return (
              <Option
                key={choice}
                label={t(missingLabelKey(choice))}
                active={active}
                onClick={() => {
                  const next = active
                    ? chosen.filter((value) => value !== choice)
                    : [...chosen, choice];
                  set('missing', next.length > 0 ? next : undefined);
                }}
              />
            );
          })}
        </Section>
      </ListCard>
      {dialog ? (
        <ProductFilterDialog
          field={dialog}
          filters={filters}
          apply={(next) => {
            props.onChange(next);
            setDialog(null);
          }}
          close={() => setDialog(null)}
        />
      ) : null}
    </aside>
  );
}
