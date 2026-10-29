import { act, cleanup, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import mn from '@tugeel/shared/i18n/mn.json';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { NAV_GROUPS, NAV_MODULES, navTrail, QUICK_ACTIONS } from '@/app/nav-items';
import { readFavoritePages, setFavoritePage } from '@/lib/favorite-pages';
import { MAX_RECENT, readRecentPages, rememberRecentPage } from '@/lib/recent-pages';
import { clearToasts, dismissToast, getToasts, toast } from '@/lib/toast';
import { ADMIN_ME, findSidebar, json, renderApp, signedIn, WORKER_ME } from '@/test/render-app';

const page = (data: unknown[]) => json({ data, nextCursor: null });

describe('navTrail', () => {
  it('finds the menu entry of a list page and of the pages below it', () => {
    expect(navTrail('/inventory/transfers')).toMatchObject({
      group: { label: 'nav.groups.inventory' },
      item: { to: '/inventory/transfers' },
      exact: true,
    });
    expect(navTrail('/inventory/transfers/7')).toMatchObject({
      item: { to: '/inventory/transfers' },
      exact: false,
    });
    expect(navTrail('/catalog/products/new')?.item.to).toBe('/catalog/products');
    expect(navTrail('/inventory/receipts/3/costing')?.item.to).toBe('/inventory/receipts');
  });

  it('knows nothing of pages outside the menu and of look-alike paths', () => {
    expect(navTrail('/')).toBeNull();
    expect(navTrail('/account')).toBeNull();
    expect(navTrail('/inventory/stocktakes-old')).toBeNull();
  });
});

describe('recent pages', () => {
  afterEach(() => vi.restoreAllMocks());

  it('keeps the newest menu paths first, each once, at most five', () => {
    for (const path of ['/a', '/b', '/c', '/b', '/d', '/e', '/f']) rememberRecentPage(1, path);
    expect(readRecentPages(1)).toEqual(['/f', '/e', '/d', '/b', '/c']);
    expect(readRecentPages(1)).toHaveLength(MAX_RECENT);
  });

  it('keeps each user apart on one browser and never reads the old shared list (ADR-0053)', () => {
    localStorage.setItem('tugeel.recent.v1', JSON.stringify(['/segments']));
    rememberRecentPage(1, '/catalog/products');
    rememberRecentPage(2, '/catalog/pending');
    expect(readRecentPages(1)).toEqual(['/catalog/products']);
    expect(readRecentPages(2)).toEqual(['/catalog/pending']);
    expect(readRecentPages(3)).toEqual([]);
  });

  it('survives a blocked or broken storage', () => {
    localStorage.setItem('tugeel.recent.v1:1', '{not json');
    expect(readRecentPages(1)).toEqual([]);
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('quota');
    });
    expect(() => rememberRecentPage(1, '/catalog/products')).not.toThrow();
  });
});

describe('toasts', () => {
  afterEach(() => clearToasts());

  it('shows a message once, keeps the last three and leaves when dismissed', () => {
    const first = toast.success('Нэг');
    expect(toast.success('Нэг')).toBe(first);
    toast.info('Хоёр');
    toast.success('Гурав');
    toast.success('Дөрөв');
    expect(getToasts().map((item) => item.message)).toEqual(['Хоёр', 'Гурав', 'Дөрөв']);
    dismissToast(getToasts()[0]!.id);
    expect(getToasts().map((item) => item.message)).toEqual(['Гурав', 'Дөрөв']);
  });

  it('renders as a status message', async () => {
    renderApp('/', signedIn());
    await screen.findByRole('heading', { level: 1 });
    act(() => {
      toast.success(mn.common.saved);
    });
    expect(screen.getByRole('status')).toHaveTextContent(mn.common.saved);
    await userEvent.setup().click(screen.getByRole('button', { name: mn.toast.dismiss }));
    expect(screen.queryByRole('status')).toBeNull();
  });
});

describe('home page (ADR-0114)', () => {
  it('greets by the given name and shows only the modules the user may open', async () => {
    renderApp('/', signedIn(WORKER_ME));
    expect(
      await screen.findByRole('heading', { name: mn.home.greeting.replace('{{name}}', 'Дорж') }),
    ).toBeInTheDocument();
    const modules = within(screen.getByRole('region', { name: mn.home.modules }));
    expect(modules.getByRole('link', { name: mn.nav.modules.inventory })).toHaveAttribute(
      'href',
      '/m/inventory',
    );
    expect(modules.getByRole('link', { name: mn.nav.modules.catalog })).toBeInTheDocument();
    // Without the rights, no sales board, no finance and no supermarket.
    expect(modules.queryByRole('link', { name: mn.nav.modules.sales })).toBeNull();
    expect(modules.queryByRole('link', { name: mn.nav.modules.finance })).toBeNull();
    expect(modules.queryByRole('link', { name: mn.nav.modules.pos })).toBeNull();
    expect(screen.queryByRole('link', { name: mn.nav.modules.ai })).toBeNull();
    expect(
      await within(screen.getByRole('region', { name: mn.shell.notifications })).findByText(
        mn.shell.noNotifications,
      ),
    ).toBeInTheDocument();
  });

  it('gives an admin every module and the tools', async () => {
    renderApp('/', signedIn(ADMIN_ME));
    const modules = within(await screen.findByRole('region', { name: mn.home.modules }));
    expect(modules.getAllByRole('link')).toHaveLength(6);
    const tools = within(screen.getByRole('region', { name: mn.home.tools }));
    expect(tools.getByRole('link', { name: mn.nav.modules.system })).toHaveAttribute(
      'href',
      '/m/system',
    );
    expect(tools.getByRole('link', { name: mn.nav.modules.ai })).toHaveAttribute('href', '/m/ai');
  });

  it('never names a shortcut like a menu entry (docs/ui.md §5)', () => {
    const text = (key: string) =>
      key.split('.').reduce<unknown>((node, part) => (node as Record<string, unknown>)[part], mn);
    const menu = NAV_GROUPS.flatMap((group) => group.items.map((item) => text(item.label)));
    for (const action of QUICK_ACTIONS) expect(menu).not.toContain(text(action.label));
  });
});

describe('modules (ADR-0114)', () => {
  it('puts every menu group in exactly one module', () => {
    for (const group of NAV_GROUPS) {
      expect(NAV_MODULES.filter((module) => module.groups.includes(group.label))).toHaveLength(1);
    }
    expect(navTrail('/pricing/quote')?.module.key).toBe('catalog');
    expect(navTrail('/reports/aging')?.module.key).toBe('finance');
  });

  it('registers staff from «Харилцагч»: the tile, the menu entry, the trail (owner 2026-10-29)', async () => {
    expect(navTrail('/users/7')).toMatchObject({
      module: { key: 'partners' },
      group: { label: 'nav.groups.partners' },
      item: { to: '/users', label: 'nav.staff' },
      exact: false,
    });
    const systemGroup = NAV_GROUPS.find((group) => group.label === 'nav.groups.system');
    expect(systemGroup?.items.map((item) => item.to)).not.toContain('/users');

    const user = userEvent.setup();
    renderApp('/m/partners', signedIn(ADMIN_ME));
    const partners = within(await screen.findByRole('region', { name: mn.nav.groups.partners }));
    expect(partners.getByRole('link', { name: mn.nav.staff })).toHaveAttribute('href', '/users');
    expect(partners.getByRole('link', { name: mn.nav.customers })).toBeInTheDocument();
    const bar = within(screen.getByRole('navigation', { name: mn.shell.modules }));
    await user.click(bar.getByRole('button', { name: mn.nav.modules.partners }));
    const menu = within(await screen.findByRole('menu'));
    expect(menu.getByRole('menuitem', { name: mn.nav.staff })).toHaveAttribute('href', '/users');
  });

  it('opens a module from the top bar and lists its pages on its own page', async () => {
    const user = userEvent.setup();
    const { router } = renderApp('/', signedIn(ADMIN_ME));
    const bar = within(await screen.findByRole('navigation', { name: mn.shell.modules }));
    await user.click(bar.getByRole('button', { name: mn.nav.modules.catalog }));
    const menu = within(await screen.findByRole('menu'));
    expect(menu.getByText(mn.nav.groups.pricing)).toBeInTheDocument();
    expect(menu.getByRole('menuitem', { name: mn.nav.discounts })).toHaveAttribute(
      'href',
      '/pricing/discounts',
    );
    await user.click(menu.getByRole('menuitem', { name: mn.shell.seeModule }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/m/catalog'));
    expect(
      await screen.findByRole('heading', { level: 1, name: mn.nav.modules.catalog }),
    ).toBeInTheDocument();
    const pricing = within(screen.getByRole('region', { name: mn.nav.groups.pricing }));
    expect(pricing.getByRole('link', { name: mn.nav.discounts })).toHaveAttribute(
      'href',
      '/pricing/discounts',
    );
    // The module's shortcuts come with it.
    expect(screen.getByRole('link', { name: mn.home.actions.newProduct })).toBeInTheDocument();
  });

  it('knows no module the user may not open', async () => {
    renderApp('/m/finance', signedIn(WORKER_ME));
    expect(await screen.findByRole('heading', { level: 1 })).not.toHaveTextContent(
      mn.nav.modules.finance,
    );
    cleanup();
    renderApp('/m/nothing', signedIn(ADMIN_ME));
    expect(await screen.findByRole('heading', { level: 1 })).not.toHaveTextContent(
      mn.nav.modules.finance,
    );
  });

  it('keeps the closed drawer out of the keyboard order', async () => {
    const user = userEvent.setup();
    renderApp('/', signedIn(ADMIN_ME));
    const drawer = (await findSidebar()).closest('aside');
    expect(drawer).toHaveAttribute('inert');
    await user.click(screen.getByRole('button', { name: mn.nav.menu }));
    expect(drawer).not.toHaveAttribute('inert');
  });
});

describe('favourites (ADR-0114)', () => {
  it('stars a menu page from its title and lists it under the star', async () => {
    const user = userEvent.setup();
    renderApp('/inventory/stock', signedIn(ADMIN_ME));
    await user.click(await screen.findByRole('button', { name: mn.shell.addFavorite }));
    expect(screen.getByRole('button', { name: mn.shell.removeFavorite })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(readFavoritePages(ADMIN_ME.id)).toEqual(['/inventory/stock']);
    await user.click(screen.getByRole('button', { name: mn.shell.favorites }));
    const menu = within(await screen.findByRole('menu'));
    expect(menu.getByRole('menuitem', { name: new RegExp(mn.nav.stock) })).toHaveAttribute(
      'href',
      '/inventory/stock',
    );
  });

  it('keeps menu paths only, per user, and survives a broken storage', () => {
    setFavoritePage(1, '/catalog/products', true);
    setFavoritePage(1, '/pricing/quote', true);
    setFavoritePage(2, '/inventory/stock', true);
    setFavoritePage(1, '/catalog/products', false);
    expect(readFavoritePages(1)).toEqual(['/pricing/quote']);
    expect(readFavoritePages(2)).toEqual(['/inventory/stock']);
    localStorage.setItem('tugeel.favorites.v1:3', '{not json');
    expect(readFavoritePages(3)).toEqual([]);
  });
});

describe('notifications bell (ADR-0114)', () => {
  it('shows the unread count and marks the lines read when opened', async () => {
    const user = userEvent.setup();
    const fetchMock = signedIn(ADMIN_ME, {
      'GET /api/v1/me/notifications/summary': () =>
        json({
          unread: 2,
          notices: [
            {
              id: 5,
              kind: 'NEWS',
              title: 'Шинэ үнэ',
              body: '',
              imageUrl: null,
              popup: false,
              validFrom: '2026-10-28',
              validTo: null,
              productIds: [],
              read: false,
              createdAt: '2026-10-28T02:00:00.000Z',
            },
          ],
        }),
      'GET /api/v1/me/notifications': () =>
        page([
          {
            id: 9,
            kind: 'ORDER_SOLD',
            orderId: 31,
            orderNumber: '20261028_0004',
            customerName: 'Дэлгүүр',
            orderTotal: '120000',
            invoiceNumber: null,
            read: false,
            createdAt: '2026-10-28T03:00:00.000Z',
          },
        ]),
      'POST /api/v1/me/notifications/read': () => json({ notices: 1, notifications: 1 }),
    });
    renderApp('/', fetchMock);
    const bell = await screen.findByRole('button', {
      name: mn.shell.notificationsUnread.replace('{{count}}', '2'),
    });
    await user.click(bell);
    const menu = within(await screen.findByRole('menu'));
    expect(menu.getByText('Шинэ үнэ')).toBeInTheDocument();
    expect(
      menu.getByText(mn.shell.orderSold.replace('{{number}}', '20261028_0004')),
    ).toBeInTheDocument();
    const readCall = () =>
      fetchMock.mock.calls.find(
        ([request]) => new URL(request.url).pathname === '/api/v1/me/notifications/read',
      );
    await waitFor(() => expect(readCall()).toBeDefined());
    expect(await readCall()![0].clone().json()).toEqual({ noticeIds: [5], notificationIds: [9] });
  });
});

describe('menu', () => {
  it('folds a group, remembers it in this browser for this user and unfolds it for a page inside', async () => {
    const user = userEvent.setup();
    renderApp('/', signedIn(ADMIN_ME));
    let nav = within(await findSidebar());
    await user.click(nav.getByRole('button', { name: mn.nav.groups.pricing }));
    expect(nav.queryByRole('link', { name: mn.nav.discounts })).toBeNull();
    expect(
      JSON.parse(localStorage.getItem(`tugeel.nav.collapsed.v2:${ADMIN_ME.id}`) ?? '[]'),
    ).toEqual(['nav.groups.pricing']);
    cleanup();

    renderApp('/system/status', signedIn(ADMIN_ME));
    nav = within(await findSidebar());
    expect(nav.queryByRole('link', { name: mn.nav.discounts })).toBeNull();
    await user.click(nav.getByRole('button', { name: mn.nav.groups.pricing }));
    expect(nav.getByRole('link', { name: mn.nav.discounts })).toBeInTheDocument();
  });

  it('shows where a page sits with a link back to its list', async () => {
    renderApp('/catalog/products/new', signedIn(ADMIN_ME));
    const trail = within(await screen.findByRole('navigation', { name: mn.shell.breadcrumb }));
    expect(trail.getByRole('link', { name: mn.nav.products })).toHaveAttribute(
      'href',
      '/catalog/products',
    );
    expect(document.title).toBe(`${mn.catalog.product.newTitle} · ${mn.app.name}`);
  });
});

describe('search (Ctrl+K)', () => {
  it('opens on Ctrl+K and goes to a page found by its name', async () => {
    const { router } = renderApp('/', signedIn(ADMIN_ME));
    const user = userEvent.setup();
    await findSidebar();
    await user.keyboard('{Control>}k{/Control}');
    const box = await screen.findByRole('combobox', { name: mn.palette.label });
    await user.type(box, 'шилж');
    // The page comes first, the quick action after it; Enter opens the first.
    expect(
      await screen.findByRole('option', { name: mn.home.actions.newTransfer }),
    ).toBeInTheDocument();
    const options = screen.getAllByRole('option');
    expect(options[0]).toHaveTextContent(mn.nav.transfers);
    expect(options[0]).toHaveAttribute('aria-selected', 'true');
    await user.keyboard('{Enter}');
    await waitFor(() => expect(router.state.location.pathname).toBe('/inventory/transfers'));
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('finds a product by name and never asks a warehouse worker for customers', async () => {
    const fetchMock = signedIn(WORKER_ME, {
      'GET /api/v1/products': () => page([{ id: 7, sku: '10023', name: 'Кока кола 0.5 л' }]),
      'GET /api/v1/suppliers': () => page([]),
    });
    const { router } = renderApp('/', fetchMock);
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: new RegExp(mn.shell.search) }));
    await user.type(await screen.findByRole('combobox', { name: mn.palette.label }), 'кока');
    const product = await screen.findByRole('option', { name: /Кока кола 0\.5 л/ });
    await user.click(product);
    await waitFor(() => expect(router.state.location.pathname).toBe('/catalog/products/7'));
    const asked = fetchMock.mock.calls.map(([request]) => new URL(request.url).pathname);
    expect(asked).toContain('/api/v1/products');
    expect(asked).not.toContain('/api/v1/customers');
  });
});
