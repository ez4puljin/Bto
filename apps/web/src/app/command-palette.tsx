import { matchesQuery, queryTerms, searchKeys } from '@tugeel/shared/text';
import {
  CornerDownLeft,
  Factory,
  House,
  type LucideIcon,
  Package,
  Search,
  Store,
  UserRound,
} from 'lucide-react';
import { type KeyboardEvent, useEffect, useId, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router';
import { useAuthState } from '@/app/auth-context';
import { visibleNav, visibleQuickActions } from '@/app/nav-items';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { useProducts } from '@/features/catalog/api';
import { useCustomers, useSuppliers } from '@/features/partners/api';
import { readRecentPages } from '@/lib/recent-pages';
import { cn } from '@/lib/utils';

type GroupKey = 'recent' | 'pages' | 'actions' | 'products' | 'customers' | 'suppliers';

interface PaletteOption {
  id: string;
  label: string;
  detail?: string;
  icon: LucideIcon;
  to: string;
  /** A row found on the server: not picked while a newer search is pending (a fast scan + Enter). */
  record?: boolean;
}

/** Records are looked up after a short pause in typing, from 2 characters on. */
const SEARCH_DELAY_MS = 200;
const MIN_RECORD_QUERY = 2;

/**
 * Ctrl/⌘+K (ADR-0042): one box that finds pages and quick actions (by their Mongolian names, typed
 * in either script, through the shared search keys), products by name, SKU or barcode, suppliers
 * and — for people who may read them — customers. Arrow keys move, Enter opens, Escape closes; with
 * an empty box it offers the recently opened pages and the quick actions.
 */
export function CommandPalette(props: { open: boolean; onOpenChange: (open: boolean) => void }) {
  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      {props.open ? <Palette close={() => props.onOpenChange(false)} /> : null}
    </Dialog>
  );
}

function Palette({ close }: { close: () => void }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const state = useAuthState();
  const listId = useId();
  const [query, setQuery] = useState('');
  const [debounced, setDebounced] = useState('');
  const [active, setActive] = useState(0);
  const permissions = useMemo(
    () => (state.status === 'authenticated' ? state.me.permissions : []),
    [state],
  );
  const userId = state.status === 'authenticated' ? state.me.id : 0;
  const canReadCustomers = permissions.includes('partners.customers.read');

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(query.trim()), SEARCH_DELAY_MS);
    return () => clearTimeout(timer);
  }, [query]);
  const recordQuery = debounced.length >= MIN_RECORD_QUERY ? debounced : '';
  const searching = recordQuery !== '';
  const products = useProducts({ q: recordQuery }, { limit: 6, enabled: searching });
  const suppliers = useSuppliers({ q: recordQuery }, { limit: 4, enabled: searching });
  const customers = useCustomers(
    { q: recordQuery },
    { limit: 4, enabled: searching && canReadCustomers },
  );

  const groups = useMemo(() => {
    const pages: (PaletteOption & { keys: ReturnType<typeof searchKeys> })[] = [
      { id: 'page:/', label: t('nav.home'), icon: House, to: '/' },
      ...visibleNav(permissions).flatMap((group) =>
        group.items.map((item) => ({
          id: `page:${item.to}`,
          label: t(item.label),
          detail: t(group.label),
          icon: item.icon,
          to: item.to,
        })),
      ),
      { id: 'page:/account', label: t('nav.account'), icon: UserRound, to: '/account' },
    ].map((page) => ({ ...page, keys: searchKeys(page.label) }));
    const actions = visibleQuickActions(permissions).map((action) => ({
      id: `action:${action.to}`,
      label: t(action.label),
      icon: action.icon,
      to: action.to,
      keys: searchKeys(t(action.label)),
    }));
    const result: { key: GroupKey; options: PaletteOption[] }[] = [];
    const typed = query.trim();
    if (typed === '') {
      const visible = new Map(pages.map((page) => [page.to, page]));
      const recent = readRecentPages(userId).flatMap((path) => {
        const page = visible.get(path);
        return page ? [{ ...page, id: `recent:${path}` }] : [];
      });
      result.push({ key: 'recent', options: recent });
      result.push({ key: 'actions', options: actions });
    } else {
      const terms = queryTerms(typed);
      result.push({
        key: 'pages',
        options: pages.filter((page) => matchesQuery(page.keys, terms)),
      });
      result.push({
        key: 'actions',
        options: actions.filter((action) => matchesQuery(action.keys, terms)),
      });
      if (searching) {
        result.push({
          key: 'products',
          options: (products.data?.pages[0]?.data ?? []).map((row) => ({
            id: `product:${row.id}`,
            label: row.name,
            detail: row.sku,
            icon: Package,
            to: `/catalog/products/${row.id}`,
            record: true,
          })),
        });
        if (canReadCustomers) {
          result.push({
            key: 'customers',
            options: (customers.data?.pages[0]?.data ?? []).map((row) => ({
              id: `customer:${row.id}`,
              label: row.name,
              detail: row.code,
              icon: Store,
              to: `/partners/customers/${row.id}`,
              record: true,
            })),
          });
        }
        result.push({
          key: 'suppliers',
          options: (suppliers.data?.pages[0]?.data ?? []).map((row) => ({
            id: `supplier:${row.id}`,
            label: row.name,
            detail: row.code,
            icon: Factory,
            to: `/partners/suppliers/${row.id}`,
            record: true,
          })),
        });
      }
    }
    return result.filter((group) => group.options.length > 0);
  }, [
    t,
    permissions,
    userId,
    query,
    searching,
    canReadCustomers,
    products.data,
    customers.data,
    suppliers.data,
  ]);

  const options = groups.flatMap((group) => group.options);
  const current = options.length ? Math.min(active, options.length - 1) : -1;
  const pending =
    query.trim() !== debounced ||
    products.isFetching ||
    suppliers.isFetching ||
    customers.isFetching;
  const optionId = (index: number) => `${listId}-option-${index}`;

  useEffect(() => {
    if (current < 0) return;
    document.getElementById(optionId(current))?.scrollIntoView?.({ block: 'nearest' });
  });

  const choose = (option: PaletteOption | undefined) => {
    if (!option || (option.record && pending)) return;
    close();
    void navigate(option.to);
  };
  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      if (!options.length) return;
      const step = event.key === 'ArrowDown' ? 1 : -1;
      setActive((Math.max(current, 0) + step + options.length) % options.length);
    } else if (event.key === 'Enter') {
      event.preventDefault();
      choose(options[current]);
    }
  };

  let index = -1;
  return (
    <DialogContent
      showCloseButton={false}
      aria-describedby={undefined}
      className="top-[12vh] max-h-[76vh] translate-y-0 gap-0 overflow-hidden p-0 sm:max-w-xl data-open:slide-in-from-top-2"
    >
      <DialogTitle className="sr-only">{t('palette.title')}</DialogTitle>
      <div className="flex items-center gap-2.5 border-b px-4">
        <Search aria-hidden className="size-4 shrink-0 text-muted-foreground" />
        <input
          role="combobox"
          aria-label={t('palette.label')}
          aria-expanded={options.length > 0}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={current >= 0 ? optionId(current) : undefined}
          autoComplete="off"
          spellCheck={false}
          placeholder={t('palette.placeholder')}
          className="h-13 min-w-0 flex-1 bg-transparent text-base outline-none placeholder:text-muted-foreground"
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            setActive(0);
          }}
          onKeyDown={onKeyDown}
        />
      </div>
      <div
        id={listId}
        role="listbox"
        aria-label={t('palette.title')}
        className="max-h-[min(56vh,26rem)] overflow-y-auto p-2"
      >
        {groups.map((group) => (
          <div
            key={group.key}
            role="group"
            aria-labelledby={`${listId}-${group.key}`}
            className="mb-1 last:mb-0"
          >
            <div
              id={`${listId}-${group.key}`}
              className="px-2.5 pt-2 pb-1 text-xs font-semibold text-muted-foreground"
            >
              {t(`palette.groups.${group.key}`)}
            </div>
            {group.options.map((option) => {
              index += 1;
              const at = index;
              const selected = at === current;
              return (
                <div
                  key={option.id}
                  id={optionId(at)}
                  role="option"
                  aria-selected={selected}
                  className={cn(
                    'flex cursor-default items-center gap-3 rounded-lg px-2.5 py-2 text-sm',
                    selected ? 'bg-primary text-primary-foreground' : 'text-foreground',
                  )}
                  // Keep the focus in the box (a wedge scan must not reach the page behind).
                  onMouseDown={(event) => event.preventDefault()}
                  onMouseMove={() => setActive(at)}
                  onClick={() => choose(option)}
                >
                  <option.icon
                    aria-hidden
                    className={cn(
                      'size-4 shrink-0',
                      selected ? 'text-primary-foreground' : 'text-primary',
                    )}
                  />
                  <span className="min-w-0 flex-1 truncate">{option.label}</span>
                  {option.detail ? (
                    <span
                      className={cn(
                        'shrink-0 font-mono text-xs',
                        selected ? 'text-primary-foreground/80' : 'text-muted-foreground',
                      )}
                    >
                      {option.detail}
                    </span>
                  ) : null}
                  {selected ? <CornerDownLeft aria-hidden className="size-3.5 shrink-0" /> : null}
                </div>
              );
            })}
          </div>
        ))}
        {options.length === 0 ? (
          <p className="px-3 py-8 text-center text-sm text-muted-foreground">
            {query.trim() && pending ? t('palette.searching') : t('palette.empty')}
          </p>
        ) : null}
      </div>
      <div className="border-t bg-muted/50 px-4 py-2 text-[11px] text-muted-foreground">
        {t('palette.hint')}
      </div>
    </DialogContent>
  );
}
