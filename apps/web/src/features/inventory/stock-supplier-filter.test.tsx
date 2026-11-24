import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { components } from '@tugeel/api-client';
import mn from '@tugeel/shared/i18n/mn.json';
import { MAX_CONDITION_IDS } from '@tugeel/shared/segments';
import { describe, expect, it } from 'vitest';
import { ADMIN_ME, json, renderApp, signedIn } from '@/test/render-app';

type Schemas = components['schemas'];
const supplier = (id: number, name: string, categoryId: number): Schemas['SupplierListItem'] => ({
  id,
  name,
  categoryId,
  categoryPath: null,
  code: String(id),
  tin: null,
  phone: null,
  vatPayer: false,
  status: 'ACTIVE',
  regNo: null,
  email: null,
  address: null,
  bankName: null,
  bankAccount: null,
  paymentTermDays: null,
  note: null,
  contact: null,
  productCount: 1,
});
const MILK = supplier(11, 'Milk supplier', 2);
const CHEESE = supplier(12, 'Cheese supplier', 2);
const COLA = supplier(21, 'Cola supplier', 3);
const EXISTING = supplier(90, 'Existing supplier', 3);
const SUPPLIERS = [MILK, CHEESE, COLA, EXISTING];
const category = (
  id: number,
  name: string,
  parentId: number | null = null,
): Schemas['SupplierCategory'] => ({
  id,
  name,
  parentId,
  path: name,
  depth: parentId === null ? 0 : 1,
  active: true,
  sortOrder: id,
  supplierCount: 2,
});

function stockApi(suppliers = SUPPLIERS) {
  return signedIn(ADMIN_ME, {
    'GET /api/v1/warehouses': () => json({ data: [], nextCursor: null }),
    'GET /api/v1/categories': () => json({ data: [], nextCursor: null }),
    'GET /api/v1/segments': () => json({ data: [], nextCursor: null }),
    'GET /api/v1/price-profiles': () => json({ data: [], nextCursor: null }),
    'GET /api/v1/stock/reconciliation/latest': () => json({ lastRun: null }),
    'POST /api/v1/stock/query': () => json({ data: [], nextCursor: null, total: 0 }),
    'GET /api/v1/supplier-categories': () =>
      json([category(1, 'Food'), category(2, 'Dairy', 1), category(3, 'Drinks')]),
    'GET /api/v1/suppliers': (request) => {
      const params = new URL(request.url).searchParams;
      const ids = params.getAll('ids');
      if (ids.length > 0) {
        return json({
          data: suppliers.filter((row) => ids.includes(String(row.id))),
          nextCursor: null,
        });
      }
      const q = params.get('q')?.toLowerCase();
      const categoryId = params.get('categoryId');
      const matches = suppliers.filter(
        (row) =>
          (!categoryId || String(row.categoryId) === categoryId) &&
          (!q || row.name.toLowerCase().includes(q)),
      );
      if (categoryId === '2' && !q) {
        return json({
          data: params.get('cursor') ? [CHEESE] : [MILK],
          nextCursor: params.get('cursor') ? null : 'dairy-next',
        });
      }
      return json({ data: matches, nextCursor: null });
    },
  });
}

const supplierRequests = (fetchMock: ReturnType<typeof stockApi>) =>
  fetchMock.mock.calls
    .map(([request]) => new URL(request.url))
    .filter((url) => url.pathname === '/api/v1/suppliers' && !url.searchParams.has('ids'));

async function openSupplierFilter(user: ReturnType<typeof userEvent.setup>) {
  await user.click(await screen.findByRole('button', { name: mn.catalog.products.filters.menu }));
  await user.click(
    await screen.findByRole('menuitem', { name: mn.catalog.products.filters.fields.supplier }),
  );
  return within(await screen.findByRole('dialog'));
}

describe('the stock list supplier filter', () => {
  it.each([
    { query: '', mode: 'MAIN_IN', expected: 'main:11' },
    { query: '?supplier=11', mode: 'IN', expected: '11' },
  ] as const)('opens $query on $mode and applies that mode', async ({ query, mode, expected }) => {
    const { router } = renderApp(`/inventory/stock${query}`, stockApi());
    const user = userEvent.setup();
    const dialog = await openSupplierFilter(user);
    expect(
      dialog.getByRole('tab', { name: mn.catalog.products.filters.supplierModes[mode] }),
    ).toHaveAttribute('aria-selected', 'true');
    await user.type(
      dialog.getByRole('searchbox', { name: mn.catalog.products.filters.searchSupplier }),
      'Milk',
    );
    const milk = await dialog.findByRole('checkbox', { name: MILK.name });
    if (query === '') await user.click(milk);
    else expect(milk).toBeChecked();
    await user.click(dialog.getByRole('button', { name: mn.catalog.products.filters.apply }));
    await waitFor(() =>
      expect(new URLSearchParams(router.state.location.search).get('supplier')).toBe(expected),
    );
  });

  it('browses child categories and pages, searches within a category, and keeps all selected suppliers', async () => {
    const fetchMock = stockApi();
    const { router } = renderApp('/inventory/stock?warehouseId=1&supplier=main:90', fetchMock);
    const user = userEvent.setup();
    const dialog = await openSupplierFilter(user);
    const categories = within(
      await dialog.findByRole('region', { name: mn.partners.suppliers.panel.supplierCategory }),
    );
    expect(await categories.findByTitle('Food')).toBeInTheDocument();
    expect(dialog.getByText(mn.catalog.products.filters.browseSuppliersHint)).toBeInTheDocument();
    expect(supplierRequests(fetchMock)).toHaveLength(0);

    await user.click(
      categories.getByRole('button', {
        name: mn.catalog.products.panel.expand.replace('{{name}}', 'Food'),
      }),
    );
    await user.click(categories.getByRole('button', { name: /Dairy/ }));
    await user.click(await dialog.findByRole('checkbox', { name: MILK.name }));
    await user.click(dialog.getByRole('button', { name: mn.common.loadMore }));
    expect(await dialog.findByRole('checkbox', { name: CHEESE.name })).toBeInTheDocument();
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(
      supplierRequests(fetchMock).some((url) => url.searchParams.get('cursor') === 'dairy-next'),
    ).toBe(true);

    await user.click(categories.getByRole('button', { name: /Drinks/ }));
    await dialog.findByRole('checkbox', { name: COLA.name });
    expect(dialog.queryByRole('checkbox', { name: MILK.name })).toBeNull();
    expect(
      await dialog.findByRole('button', {
        name: mn.catalog.products.filters.removeSupplier.replace('{{name}}', MILK.name),
      }),
    ).toBeInTheDocument();
    const search = dialog.getByRole('searchbox', {
      name: mn.catalog.products.filters.searchSupplier,
    });
    await user.type(search, 'Cola');
    await waitFor(() => {
      const latest = supplierRequests(fetchMock).at(-1)?.searchParams;
      expect(latest?.get('q')).toBe('Cola');
      expect(latest?.get('categoryId')).toBe('3');
      expect(latest?.has('cursor')).toBe(false);
    });
    await user.click(await dialog.findByRole('checkbox', { name: COLA.name }));
    expect(
      await dialog.findByRole('button', {
        name: mn.catalog.products.filters.removeSupplier.replace('{{name}}', EXISTING.name),
      }),
    ).toBeInTheDocument();
    await user.click(dialog.getByRole('button', { name: mn.catalog.products.filters.apply }));
    await waitFor(() => {
      const params = new URLSearchParams(router.state.location.search);
      expect(params.get('supplier')).toBe('main:90,11,21');
      expect(params.get('warehouseId')).toBe('1');
    });
    await waitFor(async () => {
      const requests = fetchMock.mock.calls
        .map(([request]) => request)
        .filter(
          (request) =>
            request.method === 'POST' && new URL(request.url).pathname === '/api/v1/stock/query',
        );
      expect(await requests.at(-1)?.clone().json()).toMatchObject({
        where: {
          groups: [{ conditions: [{ field: 'supplier', op: 'MAIN_IN', ids: [90, 11, 21] }] }],
        },
      });
    });
  });

  it('allows global supplier search without a category and shows an empty search result', async () => {
    const fetchMock = stockApi();
    const { router } = renderApp('/inventory/stock', fetchMock);
    const user = userEvent.setup();
    const dialog = await openSupplierFilter(user);
    const categorySearch = await dialog.findByRole('searchbox', {
      name: mn.partners.suppliers.panel.findSupplierCategory,
    });
    await user.type(categorySearch, 'Dairy{Enter}');
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(router.state.location.search).toBe('');
    await user.clear(categorySearch);
    const search = dialog.getByRole('searchbox', {
      name: mn.catalog.products.filters.searchSupplier,
    });
    await user.type(search, 'Milk{Enter}');
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(router.state.location.search).toBe('');
    expect(await dialog.findByRole('checkbox', { name: MILK.name })).toBeInTheDocument();
    await waitFor(() => {
      const latest = supplierRequests(fetchMock).at(-1)?.searchParams;
      expect(latest?.get('q')).toBe('Milk');
      expect(latest?.has('categoryId')).toBe(false);
    });
    await user.clear(search);
    await user.type(search, 'No such supplier');
    expect(await dialog.findByText(mn.catalog.products.filters.noMatches)).toBeInTheDocument();
    expect(dialog.queryByRole('checkbox')).toBeNull();
  });

  it('caps the selection at the shared limit while allowing removal and replacement', async () => {
    const selected = Array.from({ length: MAX_CONDITION_IDS }, (_, index) =>
      supplier(1000 + index, index === 0 ? 'Cap selection' : `Existing ${index}`, 3),
    );
    const candidate = supplier(5000, 'Cap candidate', 3);
    const fetchMock = stockApi([...selected, candidate]);
    const first = selected[0]!;
    const initialIds = selected.map((row) => row.id);
    const { router } = renderApp(`/inventory/stock?supplier=${initialIds.join(',')}`, fetchMock);
    const user = userEvent.setup();
    const dialog = await openSupplierFilter(user);
    await user.type(
      dialog.getByRole('searchbox', { name: mn.catalog.products.filters.searchSupplier }),
      'Cap',
    );
    const replacement = await dialog.findByRole('checkbox', { name: candidate.name });
    const previous = dialog.getByRole('checkbox', { name: first.name });
    expect(replacement).toBeDisabled();
    expect(previous).toBeChecked();
    expect(previous).not.toBeDisabled();
    expect(
      dialog.getByText(
        mn.catalog.products.filters.supplierLimit.replace('{{count}}', String(MAX_CONDITION_IDS)),
      ),
    ).toBeInTheDocument();

    await user.click(previous);
    expect(replacement).not.toBeDisabled();
    await user.click(replacement);
    expect(replacement).toBeChecked();
    expect(previous).toBeDisabled();
    await user.click(dialog.getByRole('button', { name: mn.catalog.products.filters.apply }));
    await waitFor(() => {
      const ids = new URLSearchParams(router.state.location.search).get('supplier')?.split(',');
      expect(ids).toHaveLength(MAX_CONDITION_IDS);
      expect(ids).toContain(String(candidate.id));
      expect(ids).not.toContain(String(first.id));
    });
    for (const [request] of fetchMock.mock.calls) {
      const url = new URL(request.url);
      if (url.pathname === '/api/v1/suppliers') {
        expect(url.searchParams.getAll('ids').length).toBeLessThanOrEqual(MAX_CONDITION_IDS);
      }
    }
  });
});
