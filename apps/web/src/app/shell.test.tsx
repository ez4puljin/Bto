import { act, cleanup, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import mn from '@tugeel/shared/i18n/mn.json';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { navTrail } from '@/app/nav-items';
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
    for (const path of ['/a', '/b', '/c', '/b', '/d', '/e', '/f']) rememberRecentPage(path);
    expect(readRecentPages()).toEqual(['/f', '/e', '/d', '/b', '/c']);
    expect(readRecentPages()).toHaveLength(MAX_RECENT);
  });

  it('survives a blocked or broken storage', () => {
    localStorage.setItem('tugeel.recent.v1', '{not json');
    expect(readRecentPages()).toEqual([]);
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('quota');
    });
    expect(() => rememberRecentPage('/catalog/products')).not.toThrow();
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

describe('home page', () => {
  it('greets by the given name and offers only the actions the user may take', async () => {
    renderApp('/', signedIn(WORKER_ME));
    expect(
      await screen.findByRole('heading', { name: mn.home.greeting.replace('{{name}}', 'Дорж') }),
    ).toBeInTheDocument();
    const actions = within(screen.getByRole('region', { name: mn.home.quickActions }));
    expect(actions.getByRole('link', { name: mn.home.actions.scan })).toHaveAttribute(
      'href',
      '/catalog/scan',
    );
    expect(actions.getByRole('link', { name: mn.home.actions.quote })).toBeInTheDocument();
    expect(actions.queryByRole('link', { name: mn.home.actions.newReceipt })).toBeNull();
    expect(actions.queryByRole('link', { name: mn.home.actions.newProduct })).toBeNull();
  });

  it('gives an admin every shortcut, the transfer one opening its dialog', async () => {
    renderApp('/', signedIn(ADMIN_ME));
    const actions = within(await screen.findByRole('region', { name: mn.home.quickActions }));
    expect(actions.getAllByRole('link')).toHaveLength(7);
    expect(actions.getByRole('link', { name: mn.home.actions.askAi })).toHaveAttribute(
      'href',
      '/ai',
    );
    expect(actions.getByRole('link', { name: mn.home.actions.newTransfer })).toHaveAttribute(
      'href',
      '/inventory/transfers?new=1',
    );
  });
});

describe('menu', () => {
  it('folds a group, remembers it in this browser and unfolds it for a page inside', async () => {
    const user = userEvent.setup();
    renderApp('/', signedIn(ADMIN_ME));
    let nav = within(await findSidebar());
    await user.click(nav.getByRole('button', { name: mn.nav.groups.pricing }));
    expect(nav.queryByRole('link', { name: mn.nav.discounts })).toBeNull();
    expect(JSON.parse(localStorage.getItem('tugeel.nav.collapsed.v1') ?? '[]')).toEqual([
      'nav.groups.pricing',
    ]);
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
