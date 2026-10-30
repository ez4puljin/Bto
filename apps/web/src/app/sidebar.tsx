import { ChevronDown, House, X } from 'lucide-react';
import { Collapsible } from 'radix-ui';
import { type Ref, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, NavLink, useLocation } from 'react-router';
import { useAuthState } from '@/app/auth-context';
import { navTrail, visibleNav } from '@/app/nav-items';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { useCollapsedGroups } from '@/lib/use-collapsed-groups';

const itemClass = ({ isActive }: { isActive: boolean }) =>
  cn(
    'group/item flex items-center gap-2.5 rounded-lg px-2.5 py-1 text-sm transition-colors',
    isActive
      ? 'bg-sidebar-accent font-medium text-sidebar-accent-foreground'
      : 'text-foreground/85 hover:bg-black/[0.04] hover:text-foreground',
  );

/**
 * «Бүх цэс» (ADR-0042, a drawer since ADR-0114): the brand, «Нүүр» and the permitted groups with an
 * icon per page (each group folds, remembered in this browser per user), sliding in from the top
 * bar's ⋮⋮ at every width. Exactly one entry is lit: the page's own, or the list a deeper page
 * belongs to (`navTrail`), and it is scrolled into view (ADR-0066). While closed it is inert and
 * hidden, so its links are never in the keyboard order.
 */
export function Sidebar(props: {
  open: boolean;
  onClose: () => void;
  firstLinkRef: Ref<HTMLAnchorElement>;
}) {
  const { t } = useTranslation();
  const state = useAuthState();
  const { pathname } = useLocation();
  const { collapsed, setOpen } = useCollapsedGroups(
    state.status === 'authenticated' ? state.me.id : null,
  );
  const groups = visibleNav(state.status === 'authenticated' ? state.me.permissions : []);
  const trail = navTrail(pathname);
  const current = trail?.group.label;
  const activeTo = trail?.item.to;
  const navRef = useRef<HTMLElement>(null);

  // Opening a page of a folded group (by a link or the search) unfolds it.
  useEffect(() => {
    if (current) setOpen(current, true);
  }, [current, setOpen]);

  // The lit entry stays in view in a long menu (a short window, a group low down): centred when it
  // was out of view, also after its group unfolds (its links exist only then).
  const currentOpen = current ? !collapsed.has(current) : false;
  useEffect(() => {
    const nav = navRef.current;
    const link = nav?.querySelector<HTMLElement>('[data-active="true"]');
    if (!nav || !link || typeof nav.scrollTo !== 'function') return;
    const box = nav.getBoundingClientRect();
    const own = link.getBoundingClientRect();
    // Scrolls the menu alone: scrollIntoView would also move the page under it.
    if (own.top < box.top || own.bottom > box.bottom) {
      nav.scrollTo({ top: nav.scrollTop + own.top - box.top - (box.height - own.height) / 2 });
    }
  }, [activeTo, currentOpen]);

  return (
    <aside
      id="app-sidebar"
      inert={props.open ? undefined : true}
      className={cn(
        'fixed inset-y-0 left-0 z-50 flex w-72 max-w-[85vw] flex-col border-r border-sidebar-border bg-sidebar transition-[translate,visibility] duration-200 print:hidden',
        props.open ? 'visible translate-x-0 shadow-dialog' : 'invisible -translate-x-full',
      )}
    >
      <div className="flex h-14 shrink-0 items-center gap-2 px-4">
        <span className="flex min-w-0 items-center gap-2 text-[1.0625rem] font-semibold tracking-tight">
          <span
            aria-hidden
            className="grid size-7 shrink-0 place-items-center rounded-lg bg-primary text-sm font-bold text-primary-foreground"
          >
            {t('app.name').charAt(0)}
          </span>
          {t('app.name')}
        </span>
        <Button
          variant="ghost"
          size="icon-sm"
          className="ml-auto"
          aria-label={t('shell.closeMenu')}
          onClick={props.onClose}
        >
          <X />
        </Button>
      </div>
      <nav
        ref={navRef}
        id="app-nav"
        aria-label={t('nav.menu')}
        className="min-h-0 flex-1 overflow-y-auto px-3 pb-4 [scrollbar-color:var(--border)_transparent] [scrollbar-width:thin]"
      >
        <NavLink ref={props.firstLinkRef} to="/" end className={itemClass}>
          <House aria-hidden className="size-4 shrink-0 text-primary" />
          {t('nav.home')}
        </NavLink>
        {groups.map((group) => (
          <Collapsible.Root
            key={group.label}
            open={!collapsed.has(group.label)}
            onOpenChange={(open) => setOpen(group.label, open)}
            className="mt-3"
          >
            <Collapsible.Trigger className="group/trigger flex w-full items-center justify-between rounded-md px-2.5 py-1 text-xs font-semibold text-muted-foreground transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset focus-visible:outline-none">
              {t(group.label)}
              <ChevronDown
                aria-hidden
                className="size-3.5 transition-transform group-data-[state=closed]/trigger:-rotate-90"
              />
            </Collapsible.Trigger>
            <Collapsible.Content>
              <ul className="mt-1 flex flex-col gap-0.5">
                {group.items.map((item) => (
                  <li key={item.to}>
                    <Link
                      to={item.to}
                      data-active={item.to === activeTo ? 'true' : undefined}
                      aria-current={item.to === activeTo && trail?.exact ? 'page' : undefined}
                      className={itemClass({ isActive: item.to === activeTo })}
                    >
                      <item.icon aria-hidden className="size-4 shrink-0 text-primary" />
                      {t(item.label)}
                    </Link>
                  </li>
                ))}
              </ul>
            </Collapsible.Content>
          </Collapsible.Root>
        ))}
      </nav>
    </aside>
  );
}
