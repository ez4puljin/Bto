import { Menu, Search } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Outlet, useLocation, useMatches } from 'react-router';
import { CommandPalette } from '@/app/command-palette';
import { navTrail } from '@/app/nav-items';
import { Sidebar } from '@/app/sidebar';
import { Button } from '@/components/ui/button';
import { rememberRecentPage } from '@/lib/recent-pages';
import { cn } from '@/lib/utils';

/** A route's `handle` asks for the full width with `{ wide: true }`. */
const isWide = (handle: unknown): boolean =>
  typeof handle === 'object' && handle !== null && 'wide' in handle && handle.wide === true;

/**
 * The frame of every signed-in page (ADR-0042): the sidebar menu on the grey canvas, the page in
 * the reading width (or the whole width for wide lists), the Ctrl/⌘+K search and, on phones, a
 * slim top bar whose menu button slides the sidebar in. The shell itself makes no API calls.
 */
export function AppShell() {
  const { t } = useTranslation();
  const location = useLocation();
  const [menuOpen, setMenuOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const menuButton = useRef<HTMLButtonElement>(null);
  const firstLink = useRef<HTMLAnchorElement>(null);
  const wide = useMatches().some((match) => isWide(match.handle));

  useEffect(() => {
    setMenuOpen(false);
    const trail = navTrail(location.pathname);
    if (trail) rememberRecentPage(trail.item.to);
  }, [location.pathname]);

  // Ctrl/⌘+K anywhere opens the search. Matched on the physical key too: with the Mongolian
  // keyboard layout active, `key` is a Cyrillic letter.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey) || event.altKey || event.shiftKey) return;
      if (event.code !== 'KeyK' && event.key.toLowerCase() !== 'k') return;
      event.preventDefault();
      setMenuOpen(false);
      setPaletteOpen(true);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  // The phone drawer: Escape closes it; focus moves into it and back to the menu button.
  useEffect(() => {
    if (!menuOpen) return;
    firstLink.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setMenuOpen(false);
    };
    window.addEventListener('keydown', onKeyDown);
    const button = menuButton.current;
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      button?.focus();
    };
  }, [menuOpen]);

  const openSearch = () => {
    setMenuOpen(false);
    setPaletteOpen(true);
  };

  return (
    <div className="min-h-svh bg-canvas md:flex">
      <header className="sticky top-0 z-40 flex h-13 items-center gap-1 border-b border-sidebar-border bg-sidebar/90 px-2 backdrop-blur-md md:hidden print:hidden">
        <Button
          ref={menuButton}
          variant="ghost"
          size="icon"
          aria-label={t('nav.menu')}
          aria-controls="app-sidebar"
          aria-expanded={menuOpen}
          onClick={() => setMenuOpen((open) => !open)}
        >
          <Menu />
        </Button>
        <span className="flex-1 truncate text-[15px] font-semibold tracking-tight">
          {t('app.name')}
        </span>
        <Button variant="ghost" size="icon" aria-label={t('palette.title')} onClick={openSearch}>
          <Search />
        </Button>
      </header>
      {menuOpen ? (
        <div
          aria-hidden
          className="fixed inset-0 z-40 bg-black/30 md:hidden"
          onClick={() => setMenuOpen(false)}
        />
      ) : null}
      <Sidebar
        open={menuOpen}
        onClose={() => setMenuOpen(false)}
        onSearch={openSearch}
        firstLinkRef={firstLink}
      />
      <main
        inert={menuOpen ? true : undefined}
        className="min-w-0 flex-1 px-4 pt-5 pb-10 md:px-8 md:pt-7 print:p-0"
      >
        <div className={cn('mx-auto', wide ? 'max-w-none' : 'max-w-6xl')}>
          <Outlet />
        </div>
      </main>
      <CommandPalette open={paletteOpen} onOpenChange={setPaletteOpen} />
    </div>
  );
}
