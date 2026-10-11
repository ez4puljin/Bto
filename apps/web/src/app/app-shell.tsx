import { useQueryClient } from '@tanstack/react-query';
import { LogOut, Menu, UserRound } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router';
import { useAuthSession, useAuthState } from '@/app/auth-context';
import { visibleNav } from '@/app/nav-items';
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

/** Top bar with the account menu, a grouped sidebar (a toggled panel on phones) and the page. */
export function AppShell() {
  const { t } = useTranslation();
  const session = useAuthSession();
  const state = useAuthState();
  const navigate = useNavigate();
  const location = useLocation();
  const queryClient = useQueryClient();
  const [menuOpen, setMenuOpen] = useState(false);
  useEffect(() => {
    document.title = t('app.name');
  }, [t]);
  useEffect(() => {
    setMenuOpen(false);
  }, [location.pathname]);
  const groups = visibleNav(state.status === 'authenticated' ? state.me.permissions : []);
  const logout = async () => {
    await session.logout();
    queryClient.clear();
    await navigate('/login?reason=logout', { replace: true });
  };

  return (
    <div className="min-h-svh bg-background text-foreground">
      <header className="sticky top-0 z-40 flex h-14 items-center gap-2 border-b bg-background px-4 print:hidden">
        <Button
          variant="ghost"
          size="icon"
          className="md:hidden"
          aria-label={t('nav.menu')}
          aria-controls="app-nav"
          aria-expanded={menuOpen}
          onClick={() => setMenuOpen((open) => !open)}
        >
          <Menu />
        </Button>
        <Link to="/" className="text-lg font-semibold">
          {t('app.name')}
        </Link>
        <div className="flex-1" />
        {state.status === 'authenticated' ? (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="sm">
                <UserRound />
                <span className="max-w-40 truncate">{state.me.fullName}</span>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuLabel>{state.me.username}</DropdownMenuLabel>
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
        ) : null}
      </header>
      <div className="md:flex">
        <nav
          id="app-nav"
          aria-label={t('nav.menu')}
          className={cn(
            'border-b px-2 py-3 md:sticky md:top-14 md:block md:h-[calc(100svh-3.5rem)] md:w-56 md:shrink-0 md:overflow-y-auto md:border-r md:border-b-0',
            menuOpen ? 'block' : 'hidden',
            'print:hidden!',
          )}
        >
          {groups.map((group) => (
            <div key={group.label} className="mb-4">
              <p className="px-2 pb-1 text-xs font-medium text-muted-foreground">
                {t(group.label)}
              </p>
              <ul className="flex flex-col gap-0.5">
                {group.items.map((item) => (
                  <li key={item.to}>
                    <NavLink
                      to={item.to}
                      className={({ isActive }) =>
                        cn(
                          'block rounded-md px-2 py-1.5 text-sm hover:bg-muted hover:text-foreground',
                          isActive
                            ? 'bg-muted font-medium text-foreground'
                            : 'text-muted-foreground',
                        )
                      }
                    >
                      {t(item.label)}
                    </NavLink>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </nav>
        <main className="min-w-0 flex-1 p-4">
          <div className="mx-auto max-w-6xl">
            <Outlet />
          </div>
        </main>
      </div>
    </div>
  );
}
