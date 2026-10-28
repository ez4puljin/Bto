import { useQueryClient } from '@tanstack/react-query';
import { ArrowRight, ChevronDown, LayoutGrid, LogOut, Search, Star, UserRound } from 'lucide-react';
import type { Permission } from '@tugeel/shared/auth';
import { type Ref, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useLocation, useNavigate } from 'react-router';
import { useAuthSession, useAuthState } from '@/app/auth-context';
import { modulePath, navTrail, visibleModules, type VisibleModule } from '@/app/nav-items';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { InboxBell } from '@/features/notifications/inbox';
import { useFavoritePages } from '@/lib/favorite-pages';
import { cn } from '@/lib/utils';

const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);

/**
 * The bar above every signed-in page (ADR-0114, after the owner's erxes example): the brand, «Бүх
 * цэс» (the drawer with every page), the permitted modules as menus of their pages (from `lg`), and
 * at the right the search (Ctrl/⌘+K), the starred pages, the bell, the assistant, «Систем» and
 * the account. The module of the open page is lit.
 */
export function TopBar(props: {
  menuOpen: boolean;
  onMenu: () => void;
  onSearch: () => void;
  menuButtonRef: Ref<HTMLButtonElement>;
}) {
  const { t } = useTranslation();
  const state = useAuthState();
  const { pathname } = useLocation();
  const permissions = useMemo(
    () => (state.status === 'authenticated' ? state.me.permissions : []),
    [state],
  );
  const modules = useMemo(() => visibleModules(permissions), [permissions]);
  const current = navTrail(pathname)?.module.key ?? pathname.match(/^\/m\/([a-z]+)/)?.[1];
  const business = modules.filter((module) => !module.tool);
  const system = modules.find((module) => module.key === 'system');
  const ai = modules.find((module) => module.key === 'ai');

  return (
    <header className="sticky top-0 z-40 border-b border-border bg-background/95 backdrop-blur-md print:hidden">
      <div className="flex h-13 items-center gap-1 px-2 lg:px-4">
        <Button
          ref={props.menuButtonRef}
          variant="ghost"
          size="icon"
          aria-label={t('nav.menu')}
          title={t('shell.allPages')}
          aria-controls="app-sidebar"
          aria-expanded={props.menuOpen}
          onClick={props.onMenu}
        >
          <LayoutGrid />
        </Button>
        <Link
          to="/"
          className="mr-2 flex shrink-0 items-center gap-2 rounded-md text-[17px] font-semibold tracking-tight"
        >
          <span
            aria-hidden
            className="grid size-7 shrink-0 place-items-center rounded-lg bg-primary text-sm font-bold text-primary-foreground"
          >
            {t('app.name').charAt(0)}
          </span>
          {t('app.name')}
        </Link>
        <nav
          aria-label={t('shell.modules')}
          className="hidden min-w-0 items-center gap-0.5 lg:flex"
        >
          {business.map((module) => (
            <ModuleMenu key={module.key} module={module} active={module.key === current} />
          ))}
        </nav>
        <div className="ml-auto flex shrink-0 items-center gap-0.5">
          {/* A pill with its shortcut from `xl`, an icon button below. */}
          <button
            type="button"
            className="grid size-9 place-items-center rounded-lg text-foreground transition-colors hover:bg-black/[0.05] focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background focus-visible:outline-none xl:mr-1 xl:flex xl:h-8 xl:w-44 xl:items-center xl:gap-2 xl:bg-black/[0.05] xl:px-2.5 xl:text-[13px] xl:text-muted-foreground xl:hover:bg-black/[0.08]"
            aria-keyshortcuts="Control+K Meta+K"
            title={t('shell.search')}
            onClick={props.onSearch}
          >
            <Search aria-hidden className="size-4" />
            <span className="sr-only flex-1 text-left xl:not-sr-only">{t('shell.search')}</span>
            <kbd
              aria-hidden
              className="hidden rounded border border-black/10 bg-background px-1 font-sans text-xs text-muted-foreground xl:inline"
            >
              {t(isMac ? 'shell.shortcutMac' : 'shell.shortcut')}
            </kbd>
          </button>
          <FavoritesMenu permissions={permissions} />
          <InboxBell />
          {ai ? (
            <Button
              asChild
              variant="ghost"
              size="icon"
              className={cn('hidden sm:inline-flex', current === 'ai' && 'bg-secondary text-link')}
            >
              <Link to={ai.sections[0]!.items[0]!.to} aria-label={t(ai.label)} title={t(ai.label)}>
                <ai.icon />
              </Link>
            </Button>
          ) : null}
          {system ? <ModuleMenu module={system} active={current === 'system'} iconOnly /> : null}
          <AccountMenu />
        </div>
      </div>
    </header>
  );
}

/**
 * A module's menu: one column per group (a group of one module has no heading), its pages with
 * their icons, and the module's own page at the foot.
 */
function ModuleMenu({
  module,
  active,
  iconOnly = false,
}: {
  module: VisibleModule;
  active: boolean;
  iconOnly?: boolean;
}) {
  const { t } = useTranslation();
  const label = t(module.label);
  const columns = module.sections.length;
  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger asChild>
        {iconOnly ? (
          <Button
            variant="ghost"
            size="icon"
            aria-label={label}
            title={label}
            className={cn(active && 'bg-secondary text-link')}
          >
            <module.icon />
          </Button>
        ) : (
          <button
            type="button"
            className={cn(
              'flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-sm font-medium whitespace-nowrap text-foreground/80 transition-colors hover:bg-black/[0.04] hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none aria-expanded:bg-black/[0.05] aria-expanded:text-foreground',
              active && 'bg-secondary text-secondary-foreground hover:bg-secondary',
            )}
          >
            <module.icon aria-hidden className="size-4 shrink-0" />
            {label}
            <ChevronDown aria-hidden className="size-3.5 shrink-0 opacity-60" />
          </button>
        )}
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align={iconOnly ? 'end' : 'start'}
        className={cn(
          'p-1.5',
          columns > 1
            ? 'max-w-[min(46rem,calc(100vw-2rem))]'
            : 'max-w-[min(20rem,calc(100vw-2rem))]',
        )}
      >
        <div
          className={cn(
            'grid gap-x-2',
            columns > 1 && 'grid-flow-col auto-cols-[minmax(13rem,1fr)]',
          )}
        >
          {module.sections.map((section) => (
            <div key={section.label} className="min-w-0">
              {columns > 1 ? <DropdownMenuLabel>{t(section.label)}</DropdownMenuLabel> : null}
              {section.items.map((item) => (
                <DropdownMenuItem key={item.to} asChild>
                  <Link to={item.to}>
                    <item.icon className="text-primary" />
                    <span className="truncate">{t(item.label)}</span>
                  </Link>
                </DropdownMenuItem>
              ))}
            </div>
          ))}
        </div>
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <Link to={modulePath(module.key)} className="text-link">
            <span className="flex-1">{t('shell.seeModule')}</span>
            <ArrowRight />
          </Link>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** ☆: the pages this user starred in this browser, each with its module (ADR-0114). */
function FavoritesMenu({ permissions }: { permissions: readonly Permission[] }) {
  const { t } = useTranslation();
  const state = useAuthState();
  const { paths } = useFavoritePages(state.status === 'authenticated' ? state.me.id : null);
  // A starred page the user may no longer open (a right taken away) is not listed.
  const visible = useMemo(() => {
    const allowed = new Set(
      visibleModules(permissions).flatMap((module) =>
        module.sections.flatMap((section) => section.items.map((item) => item.to)),
      ),
    );
    return paths.flatMap((path) => {
      const trail = navTrail(path);
      return trail && trail.exact && allowed.has(path) ? [trail] : [];
    });
  }, [paths, permissions]);

  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          aria-label={t('shell.favorites')}
          title={t('shell.favorites')}
        >
          <Star />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-72">
        <DropdownMenuLabel>{t('shell.favorites')}</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {visible.length === 0 ? (
          <p className="px-2 py-4 text-[13px] leading-snug text-muted-foreground">
            {t('shell.noFavorites')}
          </p>
        ) : (
          visible.map((trail) => (
            <DropdownMenuItem key={trail.item.to} asChild>
              <Link to={trail.item.to}>
                <trail.item.icon className="text-primary" />
                <span className="min-w-0 flex-1 truncate">{t(trail.item.label)}</span>
                <span className="shrink-0 text-xs text-muted-foreground">
                  {t(trail.module.label)}
                </span>
              </Link>
            </DropdownMenuItem>
          ))
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** The signed-in user at the bar's end; the trigger's name is exactly the full name. */
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
    .map((word) => word.replace(/[^\p{L}\p{N}]/gu, ''))
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
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          title={me.fullName}
          className="ml-1 grid size-8 shrink-0 place-items-center rounded-full bg-secondary text-xs font-semibold text-secondary-foreground transition-shadow hover:ring-2 hover:ring-secondary focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background focus-visible:outline-none"
        >
          <span aria-hidden>{initials}</span>
          <span className="sr-only">{me.fullName}</span>
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-56">
        <DropdownMenuLabel className="flex flex-col gap-0.5">
          <span className="text-sm font-medium text-foreground">{me.fullName}</span>
          <span className="font-normal">{me.username}</span>
        </DropdownMenuLabel>
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
  );
}
