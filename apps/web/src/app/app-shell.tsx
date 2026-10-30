import { useEffect, useRef, useState } from 'react';
import { Outlet, useLocation, useMatches } from 'react-router';
import { useAuthState } from '@/app/auth-context';
import { CommandPalette } from '@/app/command-palette';
import { navTrail } from '@/app/nav-items';
import { PAGE_WIDTHS, type PageWidth, widthOf } from '@/app/page-width';
import { Sidebar } from '@/app/sidebar';
import { TopBar } from '@/app/top-bar';
import { rememberRecentPage } from '@/lib/recent-pages';
import { cn } from '@/lib/utils';

/**
 * The frame of every signed-in page (ADR-0042, ADR-0114): the top bar with the modules, the page
 * in its route's width (ADR-0066) on the grey canvas, the Ctrl/⌘+K search and the «Бүх цэс»
 * drawer the bar's ⋮⋮ slides in. The shell's only API call is the bar's bell.
 */
export function AppShell() {
  const location = useLocation();
  const [menuOpen, setMenuOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const menuButton = useRef<HTMLButtonElement>(null);
  const firstLink = useRef<HTMLAnchorElement>(null);
  const width =
    useMatches()
      .map((match) => widthOf(match.handle))
      .filter((value): value is PageWidth => value !== null)
      .at(-1) ?? 'reading';
  const auth = useAuthState();
  const userId = auth.status === 'authenticated' ? auth.me.id : null;

  useEffect(() => {
    setMenuOpen(false);
    const trail = navTrail(location.pathname);
    if (trail && userId !== null) rememberRecentPage(userId, trail.item.to);
  }, [location.pathname, userId]);

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

  // The drawer: Escape closes it; focus moves into it and back to the menu button.
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
    <div className="flex min-h-svh flex-col bg-canvas">
      <TopBar
        menuOpen={menuOpen}
        onMenu={() => setMenuOpen((open) => !open)}
        onSearch={openSearch}
        menuButtonRef={menuButton}
      />
      {menuOpen ? (
        <div
          aria-hidden
          className="fixed inset-0 z-40 bg-black/30"
          onClick={() => setMenuOpen(false)}
        />
      ) : null}
      <Sidebar open={menuOpen} onClose={() => setMenuOpen(false)} firstLinkRef={firstLink} />
      <main
        inert={menuOpen ? true : undefined}
        className="min-w-0 flex-1 px-4 pt-5 pb-10 md:px-8 print:p-0"
      >
        {/*
         * A new page rises in (`page-enter`): the key is the module and the page (the first two
         * segments), so a record's own moves — /receipts/new → /receipts/12 on the first scan, an
         * order → its detail — keep the page mounted, its typed state and its focus; a changed
         * query (a dialog, a filter) keeps it too.
         */}
        <div
          key={location.pathname.split('/').slice(0, 3).join('/')}
          data-width={width}
          className={cn(PAGE_WIDTHS[width], 'page-enter motion-reduce:animate-none')}
        >
          <Outlet />
        </div>
      </main>
      <CommandPalette open={paletteOpen} onOpenChange={setPaletteOpen} />
    </div>
  );
}
