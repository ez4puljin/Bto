import { useQueryClient } from '@tanstack/react-query';
import { ArrowRight, ChevronDown, LayoutGrid, LogOut, Search, Star, UserRound } from 'lucide-react';
import type { Permission } from '@tugeel/shared/auth';
import { type Ref, useLayoutEffect, useMemo, useRef, useState } from 'react';
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
import { localPhone } from '@/features/partners/phone';

const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);

/**
 * The bar above every signed-in page (ADR-0114, after the owner's erxes example): the brand, «Бүх
 * цэс» (the drawer with every page), the permitted modules as menus of their pages, and at the
 * right the search (Ctrl/⌘+K), the starred pages, the bell, the assistant, «Систем» and the
 * account. The module of the open page is lit. The modules the window has no room for fold into
 * «Бусад» (ADR-0201): nine of them need about 1220px, a till PC and a tablet have 1024 or 768.
 */
export function TopBar(props: {
  menuOpen: boolean;
  onMenu: () => void;
  onSearch: () => void;
  menuButtonRef: Ref<HTMLButtonElement>;
  /** Explicitly labelled isolated test data; absent on the normal application. */
  qaLabel?: string;
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
  const fitting = useFitting(business.length);
  const { fits } = fitting;
  const folded = business.slice(fits);

  return (
    <header className="sticky top-0 z-40 border-b border-border bg-background/95 backdrop-blur-md print:hidden">
      {props.qaLabel ? (
        <div
          role="status"
          className="flex h-8 items-center justify-center bg-warning-soft px-4 text-xs font-medium text-warning"
        >
          <span className="truncate">{props.qaLabel}</span>
        </div>
      ) : null}
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
          className="mr-2 flex shrink-0 items-center gap-2 rounded-md text-[1.0625rem] font-semibold tracking-tight"
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
          ref={fitting.nav}
          aria-label={t('shell.modules')}
          className="hidden min-w-0 flex-1 items-center gap-0.5 md:flex"
        >
          {/* Cut to the modules that fit; the rest lie beyond its edge, out of sight. */}
          <div
            ref={fitting.row}
            style={fitting.width === null ? undefined : { width: fitting.width }}
            className="flex shrink-0 gap-0.5 overflow-hidden"
          >
            {business.map((module, index) => (
              <ModuleMenu
                key={module.key}
                module={module}
                active={module.key === current}
                folded={index >= fits}
              />
            ))}
          </div>
          {folded.length > 0 ? (
            <MoreModules
              buttonRef={fitting.more}
              modules={folded}
              active={folded.some((module) => module.key === current)}
            />
          ) : null}
        </nav>
        <div className="ml-auto flex shrink-0 items-center gap-0.5">
          {/* A pill with its shortcut from 2200 px (nine modules need the room at 1366 and 1536 since ADR-0144; the modules show their icons and arrows from there too), an icon button below. */}
          <button
            type="button"
            className="grid size-9 place-items-center rounded-full text-foreground touch:size-11 transition-colors duration-200 hover:bg-black/[0.05] focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background focus-visible:outline-none min-[2200px]:mr-1 min-[2200px]:flex min-[2200px]:h-8.5 min-[2200px]:w-44 min-[2200px]:items-center min-[2200px]:gap-2 min-[2200px]:bg-black/[0.05] min-[2200px]:px-3 min-[2200px]:text-[0.8125rem] min-[2200px]:text-muted-foreground min-[2200px]:hover:bg-black/[0.08]"
            aria-keyshortcuts="Control+K Meta+K"
            title={t('shell.search')}
            onClick={props.onSearch}
          >
            <Search aria-hidden className="size-4" />
            <span className="sr-only flex-1 text-left min-[2200px]:not-sr-only">
              {t('shell.search')}
            </span>
            <kbd
              aria-hidden
              className="hidden rounded border border-black/10 bg-background px-1 font-sans text-xs text-muted-foreground min-[2200px]:inline"
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
 * Which of the bar's modules fit it (ADR-0201). Every module is laid out in one row that never
 * wraps; their widths are added up against the room the bar leaves, less «Бусад» when something
 * must fold; the row is then cut to the ones that fit, so «Бусад» stands right after them and
 * the rest lie out of sight. Measured again whenever the room changes. Without layout (a test)
 * every width is 0 and everything fits.
 */
function useFitting(count: number) {
  const nav = useRef<HTMLElement>(null);
  const row = useRef<HTMLDivElement>(null);
  const more = useRef<HTMLButtonElement>(null);
  const [fit, setFit] = useState<{ count: number; width: number | null }>({ count, width: null });
  useLayoutEffect(() => {
    const outer = nav.current;
    const box = row.current;
    if (!outer || !box) return;
    const measure = () => {
      const widths = (Array.from(box.children) as HTMLElement[]).map((item) => item.offsetWidth);
      const gap = Number.parseFloat(getComputedStyle(box).columnGap) || 0;
      const room = outer.clientWidth;
      const all = widths.reduce((sum, width) => sum + width, 0) + gap * (widths.length - 1);
      let next = { count: widths.length, width: null as number | null };
      if (all > room) {
        // «Бусад» itself: its own width once it is drawn, about 6rem before that.
        const rem = Number.parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
        const reserved = (more.current?.offsetWidth ?? 6 * rem) + gap;
        let used = 0;
        let fitting = 0;
        for (const width of widths) {
          const wanted = used + (fitting > 0 ? gap : 0) + width;
          if (wanted > room - reserved) break;
          used = wanted;
          fitting += 1;
        }
        next = { count: fitting, width: used };
      }
      setFit((last) => (last.count === next.count && last.width === next.width ? last : next));
    };
    measure();
    // A test may have taken the observer away (list.tsx guards the same way).
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure);
    observer?.observe(outer);
    window.addEventListener('resize', measure);
    return () => {
      observer?.disconnect();
      window.removeEventListener('resize', measure);
    };
    // Measured again once «Бусад» is drawn: its real width replaces the guess.
  }, [count, fit.count]);
  return { nav, row, more, fits: Math.min(fit.count, count), width: fit.width };
}

const MODULE_TRIGGER =
  'flex h-8.5 shrink-0 items-center gap-1 rounded-full px-2.5 text-sm font-medium touch:h-11 whitespace-nowrap text-foreground/80 transition-colors duration-200 hover:bg-black/[0.04] hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none focus-visible:ring-inset aria-expanded:bg-black/[0.05] aria-expanded:text-foreground min-[2200px]:gap-1.5 min-[2200px]:px-3';
const MODULE_TRIGGER_ACTIVE = 'bg-secondary text-secondary-foreground hover:bg-secondary';

/** «Бусад»: the modules the bar has no room for, each opening its own page of tiles. */
function MoreModules({
  modules,
  active,
  buttonRef,
}: {
  modules: VisibleModule[];
  active: boolean;
  buttonRef: Ref<HTMLButtonElement>;
}) {
  const { t } = useTranslation();
  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger asChild>
        <button
          ref={buttonRef}
          type="button"
          className={cn(MODULE_TRIGGER, active && MODULE_TRIGGER_ACTIVE)}
        >
          {t('shell.moreModules')}
          <ChevronDown aria-hidden className="size-3.5 shrink-0 opacity-60" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="min-w-52 p-1.5">
        {modules.map((module) => (
          <DropdownMenuItem key={module.key} asChild>
            <Link to={modulePath(module.key)}>
              <module.icon className="text-primary" />
              <span className="truncate">{t(module.label)}</span>
            </Link>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/**
 * A module's menu: one column per group (a group of one module has no heading), its pages with
 * their icons, and the module's own page at the foot. `folded`: the bar has no room for it, so it
 * lies out of sight and out of the keyboard's way until the window widens.
 */
function ModuleMenu({
  module,
  active,
  iconOnly = false,
  folded = false,
}: {
  module: VisibleModule;
  active: boolean;
  iconOnly?: boolean;
  folded?: boolean;
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
            inert={folded ? true : undefined}
            className={cn(MODULE_TRIGGER, active && MODULE_TRIGGER_ACTIVE)}
          >
            <module.icon aria-hidden className="hidden size-4 shrink-0 min-[2200px]:block" />
            {label}
            <ChevronDown
              aria-hidden
              className="hidden size-3.5 shrink-0 opacity-60 min-[2200px]:block"
            />
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
          <p className="px-2 py-4 text-[0.8125rem] leading-snug text-muted-foreground">
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
          className="ml-1 grid size-8 shrink-0 place-items-center rounded-full bg-secondary touch:relative touch:after:absolute touch:after:-inset-1.5 text-xs font-semibold text-secondary-foreground transition-shadow hover:ring-2 hover:ring-secondary focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background focus-visible:outline-none"
        >
          <span aria-hidden>{initials}</span>
          <span className="sr-only">{me.fullName}</span>
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-56">
        <DropdownMenuLabel className="flex flex-col gap-0.5">
          <span className="text-sm font-medium text-foreground">{me.fullName}</span>
          {me.phone ? <span className="font-normal">{localPhone(me.phone)}</span> : null}
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
