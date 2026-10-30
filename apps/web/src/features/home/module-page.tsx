import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useParams } from 'react-router';
import { useAuthState } from '@/app/auth-context';
import { navTrail, visibleModules, visibleQuickActions } from '@/app/nav-items';
import { NotFoundPage } from '@/app/not-found-page';
import { PageHeader } from '@/components/page-header';
import { AttentionTiles } from './attention-tiles';

const TILE =
  'flex min-h-14 items-center gap-3 rounded-xl bg-card px-3.5 py-2 shadow-card ring-1 ring-black/[0.06] transition-[box-shadow,transform] duration-200 ease-apple hover:-translate-y-0.5 hover:shadow-popover active:scale-[0.98]';

/**
 * A module's own page (`/m/:module`, ADR-0114), opened from its home tile or the foot of its top-bar
 * menu: the work waiting in it («Анхаарах», ADR-0047 #7), its shortcuts (each behind the right to
 * do it) and every permitted page, grouped as in the menu. A module the user cannot open is not
 * found.
 */
export function ModulePage() {
  const { t } = useTranslation();
  const { module: key } = useParams();
  const state = useAuthState();
  const permissions = useMemo(
    () => (state.status === 'authenticated' ? state.me.permissions : []),
    [state],
  );
  const module = visibleModules(permissions).find((candidate) => candidate.key === key);
  if (!module) return <NotFoundPage />;
  const actions = visibleQuickActions(permissions).filter(
    (action) => navTrail(action.to.split('?')[0]!)?.module.key === module.key,
  );

  return (
    <div>
      <PageHeader title={t(module.label)} />
      <div className="flex flex-col gap-6">
        <AttentionTiles permissions={permissions} only={module.key} />
        {actions.length > 0 ? (
          <section aria-labelledby="module-actions">
            <h2
              id="module-actions"
              className="mb-2.5 text-[0.9375rem] font-semibold tracking-tight"
            >
              {t('home.quickActions')}
            </h2>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-[repeat(auto-fill,minmax(14rem,1fr))]">
              {actions.map((action) => (
                <Link key={action.to} to={action.to} className={TILE}>
                  <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-secondary text-link">
                    <action.icon aria-hidden className="size-[1.125rem]" />
                  </span>
                  <span className="line-clamp-2 min-w-0 text-sm leading-snug font-medium">
                    {t(action.label)}
                  </span>
                </Link>
              ))}
            </div>
          </section>
        ) : null}
        {module.sections.map((section) => (
          <section key={section.label} aria-labelledby={`module-${section.label}`}>
            <h2
              id={`module-${section.label}`}
              className="mb-2.5 text-[0.9375rem] font-semibold tracking-tight"
            >
              {t(section.label)}
            </h2>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-[repeat(auto-fill,minmax(14rem,1fr))]">
              {section.items.map((item) => (
                <Link key={item.to} to={item.to} className={TILE}>
                  <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-secondary text-link">
                    <item.icon aria-hidden className="size-[1.125rem]" />
                  </span>
                  <span className="line-clamp-2 min-w-0 text-sm leading-snug font-medium">
                    {t(item.label)}
                  </span>
                </Link>
              ))}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}
