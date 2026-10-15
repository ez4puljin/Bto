import { ChevronRight } from 'lucide-react';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { useAuthState } from '@/app/auth-context';
import { visibleNav, visibleQuickActions } from '@/app/nav-items';
import { PageHeader } from '@/components/page-header';
import { formatUbToday } from '@/lib/dayjs';
import { readRecentPages } from '@/lib/recent-pages';
import { AttentionTiles } from './attention-tiles';

/**
 * «Нүүр» (ADR-0042): a greeting with today's date, the work waiting for this person («Анхаарах»,
 * ADR-0047 #7), shortcuts to the day's work (each behind the right to do it) and the pages this
 * user opened last in this browser (ADR-0053). «Системийн төлөв» lives in «Систем».
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
    <div className="space-y-7">
      <PageHeader title={t('home.greeting', { name })} meta={formatUbToday()} />
      <AttentionTiles permissions={permissions} />
      {actions.length > 0 ? (
        <section aria-labelledby="home-actions">
          <h2 id="home-actions" className="mb-2.5 text-[15px] font-semibold tracking-tight">
            {t('home.quickActions')}
          </h2>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-6">
            {actions.map((action) => (
              <Link
                key={action.to}
                to={action.to}
                className="group flex flex-col items-start gap-3 rounded-xl bg-card p-4 shadow-card ring-1 ring-black/[0.06] transition-[box-shadow,transform] hover:shadow-popover active:scale-[0.98]"
              >
                <span className="grid size-9 place-items-center rounded-lg bg-secondary text-link">
                  <action.icon aria-hidden className="size-5" />
                </span>
                <span className="text-sm leading-snug font-medium">{t(action.label)}</span>
              </Link>
            ))}
          </div>
        </section>
      ) : null}
      {recent.length > 0 ? (
        <section aria-labelledby="home-recent" className="max-w-xl">
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
                  <span className="flex-1 text-sm font-medium">
                    {t(item.label)}
                    <span className="sr-only">{`, ${t(group.label)}`}</span>
                  </span>
                  <span aria-hidden className="text-[13px] text-muted-foreground">
                    {t(group.label)}
                  </span>
                  <ChevronRight aria-hidden className="size-4 shrink-0 text-muted-foreground/70" />
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
