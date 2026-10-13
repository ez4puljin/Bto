import { useQueryClient } from '@tanstack/react-query';
import { ChevronDown, ChevronsUpDown, House, LogOut, Search, UserRound, X } from 'lucide-react';
import { Collapsible } from 'radix-ui';
import { type Ref, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, NavLink, useLocation, useNavigate } from 'react-router';
import { useAuthSession, useAuthState } from '@/app/auth-context';
import { navTrail, visibleNav } from '@/app/nav-items';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';
import { useCollapsedGroups } from '@/lib/use-collapsed-groups';

const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);

const itemClass = ({ isActive }: { isActive: boolean }) =>
  cn(
    'group/item flex items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-sm transition-colors',
    isActive
      ? 'bg-sidebar-accent font-medium text-sidebar-accent-foreground'
      : 'text-foreground/85 hover:bg-black/[0.04] hover:text-foreground',
  );

/**
 * The menu (ADR-0042): the brand, the search button (Ctrl/⌘+K), «Нүүр», the permitted groups with
 * an icon per page (each group folds, remembered in this browser) and the account menu. On a
 * phone the same element slides in as a drawer; there is only ever one menu landmark.
 */
export function Sidebar(props: {
  open: boolean;
  onClose: () => void;
  onSearch: () => void;
  firstLinkRef: Ref<HTMLAnchorElement>;
}) {
  const { t } = useTranslation();
  const state = useAuthState();
  const { pathname } = useLocation();
  const { collapsed, setOpen } = useCollapsedGroups();
  const groups = visibleNav(state.status === 'authenticated' ? state.me.permissions : []);
  const current = navTrail(pathname)?.group.label;

  // Opening a page of a folded group (by a link or the search) unfolds it.
  useEffect(() => {
    if (current) setOpen(current, true);
  }, [current, setOpen]);

  return (
    <aside
      id="app-sidebar"
      className={cn(
        'fixed inset-y-0 left-0 z-50 flex w-72 max-w-[85vw] flex-col border-r border-sidebar-border bg-sidebar transition-transform duration-200 md:sticky md:top-0 md:z-auto md:h-svh md:w-62 md:max-w-none md:translate-x-0 print:hidden',
        props.open ? 'translate-x-0 shadow-dialog md:shadow-none' : '-translate-x-full',
      )}
    >
      <div className="flex h-14 shrink-0 items-center gap-2 px-4">
        <Link
          to="/"
          className="flex min-w-0 items-center gap-2 rounded-md text-[17px] font-semibold tracking-tight"
        >
          <span
            aria-hidden
            className="grid size-7 shrink-0 place-items-center rounded-lg bg-primary text-sm font-bold text-primary-foreground"
          >
            {t('app.name').charAt(0)}
          </span>
          {t('app.name')}
        </Link>
        <Button
          variant="ghost"
          size="icon-sm"
          className="ml-auto md:hidden"
          aria-label={t('shell.closeMenu')}
          onClick={props.onClose}
        >
          <X />
        </Button>
      </div>
      <div className="shrink-0 px-3 pb-2">
        <button
          type="button"
          className="flex h-8 w-full items-center gap-2 rounded-lg bg-black/[0.05] px-2.5 text-[13px] text-muted-foreground transition-colors hover:bg-black/[0.08] focus-visible:ring-3 focus-visible:ring-ring/30 focus-visible:outline-none"
          aria-keyshortcuts="Control+K Meta+K"
          onClick={props.onSearch}
        >
          <Search aria-hidden className="size-4" />
          <span className="flex-1 text-left">{t('shell.search')}</span>
          <kbd
            aria-hidden
            className="rounded border border-black/10 bg-background px-1 font-sans text-[11px] text-muted-foreground"
          >
            {t(isMac ? 'shell.shortcutMac' : 'shell.shortcut')}
          </kbd>
        </button>
      </div>
      <nav
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
            className="mt-4"
          >
            <Collapsible.Trigger className="group/trigger flex w-full items-center justify-between rounded-md px-2.5 py-1 text-xs font-semibold text-muted-foreground transition-colors hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/30 focus-visible:outline-none">
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
                    <NavLink to={item.to} className={itemClass}>
                      <item.icon aria-hidden className="size-4 shrink-0 text-primary" />
                      {t(item.label)}
                    </NavLink>
                  </li>
                ))}
              </ul>
            </Collapsible.Content>
          </Collapsible.Root>
        ))}
      </nav>
      <AccountMenu />
    </aside>
  );
}

/** The signed-in user at the foot of the menu; the trigger's name is exactly the full name. */
function AccountMenu() {
  const { t } = useTranslation();
  const session = useAuthSession();
  const state = useAuthState();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  if (state.status !== 'authenticated') return null;
  const { me } = state;
  const initials = me.fullName
    .split(/\s+/u)
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => word.charAt(0).toUpperCase())
    .join('');
  const logout = async () => {
    await session.logout();
    queryClient.clear();
    await navigate('/login?reason=logout', { replace: true });
  };

  return (
    <div className="shrink-0 border-t border-sidebar-border p-2">
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            className="flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-left transition-colors hover:bg-black/[0.04] focus-visible:ring-3 focus-visible:ring-ring/30 focus-visible:outline-none aria-expanded:bg-black/[0.04]"
          >
            <span
              aria-hidden
              className="grid size-8 shrink-0 place-items-center rounded-full bg-secondary text-xs font-semibold text-secondary-foreground"
            >
              {initials}
            </span>
            <span className="min-w-0 flex-1 truncate text-[13px] font-medium">{me.fullName}</span>
            <ChevronsUpDown aria-hidden className="size-4 shrink-0 text-muted-foreground" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          side="top"
          align="start"
          className="w-(--radix-dropdown-menu-trigger-width) min-w-56"
        >
          <DropdownMenuLabel>{me.username}</DropdownMenuLabel>
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={() => void navigate('/account')}>
            <UserRound />
            {t('nav.account')}
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => void logout()}>
            <LogOut />
            {t('auth.logout')}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
