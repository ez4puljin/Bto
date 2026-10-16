import { ChevronRight } from 'lucide-react';
import { type ReactNode, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useLocation } from 'react-router';
import { navTrail } from '@/app/nav-items';

export interface Crumb {
  label: string;
  to?: string;
}

/**
 * The top of every page (ADR-0042): where the page sits (menu group › list, from the menu itself;
 * deeper pages add `crumbs`), the large title, a meta row (code, status, dates), an optional
 * one-line `description` and the actions. A trail of the menu group alone (a list page) shows on
 * phones only: on a desktop the sidebar says it (ADR-0066).
 * The current page is never a crumb and a crumb that repeats the next one or the title is dropped,
 * so the title text appears once. Also names the browser tab «Title · Bto».
 */
export function PageHeader({
  title,
  meta,
  actions,
  media,
  description,
  crumbs = [],
}: {
  title: string;
  meta?: ReactNode;
  /** One muted line under the title: what the page is for (never a status or a code). */
  description?: ReactNode;
  actions?: ReactNode;
  /** A picture beside the title (a product's photo). */
  media?: ReactNode;
  crumbs?: readonly Crumb[];
}) {
  const { t } = useTranslation();
  const { pathname } = useLocation();
  useEffect(() => {
    document.title = `${title} · ${t('app.name')}`;
  }, [title, t]);

  const trail = navTrail(pathname);
  const all: Crumb[] = trail
    ? [
        { label: t(trail.group.label) },
        ...(trail.exact ? [] : [{ label: t(trail.item.label), to: trail.item.to }]),
        ...crumbs,
      ]
    : [...crumbs];
  const shown = all.filter(
    (crumb, index) => crumb.label !== (all[index + 1]?.label ?? title) && crumb.label !== title,
  );
  const linked = shown.some((crumb) => crumb.to);

  const items = shown.map((crumb, index) => (
    <li key={`${crumb.label}-${index}`} className="flex min-w-0 items-center gap-1">
      {index > 0 ? <ChevronRight aria-hidden className="size-3.5 shrink-0 opacity-60" /> : null}
      {crumb.to ? (
        <Link to={crumb.to} className="truncate text-link hover:underline">
          {crumb.label}
        </Link>
      ) : (
        <span className="truncate">{crumb.label}</span>
      )}
    </li>
  ));

  // The actions sit on the title's line (ADR-0066), whatever lines follow the title.
  return (
    <div className="mb-4">
      {shown.length > 0 ? (
        linked ? (
          <nav aria-label={t('shell.breadcrumb')} className="mb-1">
            <ol className="flex flex-wrap items-center gap-1 text-[13px] text-muted-foreground">
              {items}
            </ol>
          </nav>
        ) : (
          <ol className="mb-1 flex flex-wrap items-center gap-1 text-[13px] text-muted-foreground md:hidden">
            {items}
          </ol>
        )
      ) : null}
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-3">
        <div className="flex min-w-0 items-center gap-4">
          {media ? <div className="shrink-0">{media}</div> : null}
          <div className="min-w-0">
            <h1 className="text-[26px] leading-tight font-semibold tracking-tight text-balance">
              {title}
            </h1>
            {meta ? (
              <div className="mt-2 flex flex-wrap items-center gap-2 text-[13px] text-muted-foreground">
                {meta}
              </div>
            ) : null}
            {description ? (
              <p className="mt-1 max-w-3xl text-[13px] text-muted-foreground">{description}</p>
            ) : null}
          </div>
        </div>
        {actions ? (
          <div className="flex flex-wrap items-center gap-2 print:hidden">{actions}</div>
        ) : null}
      </div>
    </div>
  );
}
