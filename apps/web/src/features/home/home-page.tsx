import { ChevronRight } from 'lucide-react';
import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { useAuthState } from '@/app/auth-context';
import { visibleNav, visibleQuickActions } from '@/app/nav-items';
import { PageHeader } from '@/components/page-header';
import { formatUbToday } from '@/lib/dayjs';
import { readRecentPages } from '@/lib/recent-pages';
import { cn } from '@/lib/utils';
import { AttentionTiles } from './attention-tiles';
import { tileColumns } from './tile-columns';

/**
 * «Нүүр» (ADR-0042, ADR-0066): a greeting with today's date; then the work waiting for this person
 * («Анхаарах», ADR-0047 #7) and the shortcuts to the day's work (each behind the right to do it) as
 * compact tiles, with the pages this user opened last in this browser (ADR-0053) in a side column
 * from `xl`, so all three fit a laptop's first screen. «Системийн төлөв» lives in «Систем».
 */
export function HomePage() {
  const { t } = useTranslation();
  const state = useAuthState();
  const permissions = useMemo(
    () => (state.status === 'authenticated' ? state.me.permissions : []),
    [state],
  );
  const fullName = state.status === 'authenticated' ? state.me.fullName : '';
  const userId = state.status === 'authenticated' ? state.me.id : 0;
  // Mongolian names put the given name last: «Агуулахын Дорж» is greeted as Дорж.
  const name = fullName.trim().split(/\s+/u).at(-1) ?? fullName;
  const actions = visibleQuickActions(permissions);
  const [actionGrid, actionColumns] = useTileColumns(actions.length);
  const recent = useMemo(() => {
    const items = new Map(
      visibleNav(permissions).flatMap((group) =>
        group.items.map((item) => [item.to, { item, group }] as const),
      ),
    );
    return readRecentPages(userId).flatMap((path) => {
      const found = items.get(path);
      return found ? [found] : [];
    });
  }, [permissions, userId]);

  return (
    <div>
      <PageHeader title={t('home.greeting', { name })} meta={formatUbToday()} />
      <div
        className={cn(
          'grid items-start gap-6',
          recent.length > 0 && 'xl:grid-cols-[minmax(0,1fr)_22rem]',
        )}
      >
        <div className="flex min-w-0 flex-col gap-6">
          <AttentionTiles permissions={permissions} />
          {actions.length > 0 ? (
            <section aria-labelledby="home-actions">
              <h2 id="home-actions" className="mb-2.5 text-[15px] font-semibold tracking-tight">
                {t('home.quickActions')}
              </h2>
              {/* Columns from the grid's measured width (tileColumns); until then, CSS fills rows. */}
              <div
                ref={actionGrid}
                className={cn(
                  'grid gap-3',
                  actionColumns === null &&
                    'grid-cols-2 sm:grid-cols-[repeat(auto-fill,minmax(13rem,1fr))]',
                )}
                style={
                  actionColumns === null
                    ? undefined
                    : { gridTemplateColumns: `repeat(${actionColumns}, minmax(0, 1fr))` }
                }
              >
                {actions.map((action) => (
                  <Link
                    key={action.to}
                    to={action.to}
                    className="flex min-h-14 items-center gap-3 rounded-xl bg-card px-3.5 py-2 shadow-card ring-1 ring-black/[0.06] transition-[box-shadow,transform] hover:shadow-popover active:scale-[0.98]"
                  >
                    <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-secondary text-link">
                      <action.icon aria-hidden className="size-[18px]" />
                    </span>
                    <span className="line-clamp-2 min-w-0 text-sm leading-snug font-medium">
                      {t(action.label)}
                    </span>
                  </Link>
                ))}
              </div>
            </section>
          ) : null}
        </div>
        {recent.length > 0 ? (
          <section aria-labelledby="home-recent" className="min-w-0 max-w-xl xl:max-w-none">
            <h2 id="home-recent" className="mb-2.5 text-[15px] font-semibold tracking-tight">
              {t('home.recent')}
            </h2>
            <ul className="overflow-hidden rounded-xl bg-card shadow-card ring-1 ring-black/[0.06]">
              {recent.map(({ item, group }) => (
                <li key={item.to} className="border-b border-border/80 last:border-0">
                  <Link
                    to={item.to}
                    className="flex items-center gap-3 px-4 py-2.5 transition-colors hover:bg-accent/70"
                  >
                    <item.icon aria-hidden className="size-4 shrink-0 text-primary" />
                    <span className="min-w-0 flex-1 truncate text-sm font-medium">
                      {t(item.label)}
                      <span className="sr-only">{`, ${t(group.label)}`}</span>
                    </span>
                    <span aria-hidden className="shrink-0 text-[13px] text-muted-foreground">
                      {t(group.label)}
                    </span>
                    <ChevronRight
                      aria-hidden
                      className="size-4 shrink-0 text-muted-foreground/70"
                    />
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        ) : null}
      </div>
    </div>
  );
}

/**
 * The shortcut grid's columns for its width (`tileColumns`: labels on one line, no lone tile on the
 * last row), measured again when the window or the column changes; null until measured.
 */
function useTileColumns(count: number) {
  const ref = useRef<HTMLDivElement>(null);
  const [columns, setColumns] = useState<number | null>(null);
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    const measure = () => {
      const width = element.clientWidth;
      const next = width > 0 ? tileColumns(count, width) : null;
      setColumns((previous) => (previous === next ? previous : next));
    };
    measure();
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure);
    observer?.observe(element);
    return () => observer?.disconnect();
  }, [count]);
  return [ref, columns] as const;
}
