import { cleanup, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { components } from '@tugeel/api-client';
import mn from '@tugeel/shared/i18n/mn.json';
import { describe, expect, it } from 'vitest';
import { calls } from '@/test/inventory-fixtures';
import { ADMIN_ME, findSidebar, json, renderApp, signedIn, WORKER_ME } from '@/test/render-app';

type Schemas = components['schemas'];
const STAMP = '2026-10-14T02:00:00.000Z';
const list = <T,>(data: T[], nextCursor: string | null = null) => json({ data, nextCursor });
const sent = async (request: Request) => (await request.clone().json()) as Record<string, unknown>;

const segment = (
  id: number,
  name: string,
  definition: Schemas['SegmentDefinition'],
  entity: Schemas['Segment']['entity'] = 'PRODUCT',
): Schemas['Segment'] => ({
  id,
  entity,
  kind: 'RULES',
  name,
  description: null,
  definition,
  createdAt: STAMP,
  updatedAt: STAMP,
});
const DRINKS = segment(5, 'Ундаа, дууссан', {
  match: 'ALL',
  groups: [
    {
      match: 'ALL',
      conditions: [
        { field: 'category', op: 'IN', ids: [3] },
        { field: 'stock', op: 'OUT_OF_STOCK' },
      ],
    },
  ],
});
const MSM: Schemas['SupplierListItem'] = {
  id: 7,
  code: '7',
  name: 'МСМ ХХК',
  tin: null,
  phone: null,
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
};
const LOOKUPS = {
  'GET /api/v1/categories': () =>
    list([
      {
        id: 3,
        parentId: null,
        name: 'Ундаа',
        defaultClassificationCode: null,
        skuFrom: null,
        skuTo: null,
        productCount: 0,
        childCount: 0,
        createdAt: STAMP,
        updatedAt: STAMP,
      },
    ]),
  'GET /api/v1/warehouses': () => list([]),
  'GET /api/v1/price-profiles': () => list([]),
  'GET /api/v1/suppliers': () => list([MSM]),
};

describe('segments (ADR-0049)', () => {
  it('lists the segments of each entity with their counts, for everyone to read', async () => {
    const fetchMock = signedIn(WORKER_ME, {
      'GET /api/v1/segments': (request) =>
        new URL(request.url).searchParams.get('entity') === 'SUPPLIER'
          ? list([segment(9, 'Бараагүй нийлүүлэгч', { match: 'ALL', groups: [] }, 'SUPPLIER')])
          : list([DRINKS]),
      'GET /api/v1/segments/counts': (request) =>
        json(
          new URL(request.url).searchParams
            .getAll('segmentIds')
            .map((id) => ({ segmentId: Number(id), count: id === '5' ? 1751 : null })),
        ),
    });
    const { router } = renderApp('/segments', fetchMock);
    const user = userEvent.setup();
    expect(
      within(await findSidebar()).getByRole('link', { name: mn.nav.segments }),
    ).toBeInTheDocument();
    const row = (await screen.findByRole('link', { name: DRINKS.name })).closest('tr');
    expect(row).not.toBeNull();
    await waitFor(() =>
      expect(row).toHaveTextContent(mn.segments.countOf.PRODUCT.replace('{{count}}', '1,751')),
    );
    // A warehouse worker reads no customers: no customer tab and nothing to create.
    expect(screen.queryByRole('tab', { name: mn.segments.entities.CUSTOMER })).toBeNull();
    expect(screen.queryByRole('link', { name: mn.segments.create })).toBeNull();
    await user.click(screen.getByRole('tab', { name: mn.segments.entities.SUPPLIER }));
    await waitFor(() => expect(router.state.location.search).toBe('?entity=SUPPLIER'));
    const other = (await screen.findByRole('link', { name: 'Бараагүй нийлүүлэгч' })).closest('tr');
    await waitFor(() => expect(other).toHaveTextContent(mn.segments.countUnavailable));
  });

  it('shows a segment in words, opens its list and archives it', async () => {
    const fetchMock = signedIn(ADMIN_ME, {
      ...LOOKUPS,
      'GET /api/v1/segments/5': () => json(DRINKS),
      'GET /api/v1/segments/counts': () => json([{ segmentId: 5, count: 12 }]),
      'DELETE /api/v1/segments/5': () => new Response(null, { status: 204 }),
      'GET /api/v1/segments': () => list([]),
    });
    const { router } = renderApp('/segments/5', fetchMock);
    const user = userEvent.setup();
    expect(await screen.findByRole('heading', { level: 1, name: DRINKS.name })).toBeInTheDocument();
    expect(
      await screen.findByText(
        `${mn.segments.fields.PRODUCT.category} ${mn.segments.operators.IN}: Ундаа`,
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        `${mn.segments.fields.PRODUCT.stock}: ${mn.segments.operators.OUT_OF_STOCK}`,
      ),
    ).toBeInTheDocument();
    expect(screen.getByRole('link', { name: mn.segments.viewList })).toHaveAttribute(
      'href',
      '/catalog/products?segment=5',
    );
    await user.click(screen.getByRole('button', { name: mn.segments.archive }));
    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: mn.segments.archive }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/segments'));
    expect(router.state.location.search).toBe('?entity=PRODUCT');
    expect(calls(fetchMock, 'DELETE', '/api/v1/segments/5')).toHaveLength(1);
  });

  it('shows a hand-picked segment by its products and edits only its name (ADR-0052)', async () => {
    const picked: Schemas['Segment'] = {
      ...segment(6, 'Түмний бараа', { match: 'ALL', groups: [] }),
      kind: 'LIST',
      definition: null,
    };
    const routes = {
      ...LOOKUPS,
      'GET /api/v1/segments': () => list([DRINKS, picked]),
      'GET /api/v1/segments/6': () => json(picked),
      'GET /api/v1/segments/counts': (request: Request) =>
        json(
          new URL(request.url).searchParams
            .getAll('segmentIds')
            .map((id) => ({ segmentId: Number(id), count: 137 })),
        ),
      'PUT /api/v1/segments/6': async (request: Request) =>
        json({ ...picked, ...(await sent(request)) }),
    };
    const fetchMock = signedIn(ADMIN_ME, routes);
    renderApp('/segments', fetchMock);
    const user = userEvent.setup();
    const row = (await screen.findByRole('link', { name: picked.name })).closest('tr');
    expect(row).toHaveTextContent(mn.segments.kinds.LIST);
    expect(
      (await screen.findByRole('link', { name: DRINKS.name })).closest('tr'),
    ).not.toHaveTextContent(mn.segments.kinds.LIST);

    // Its page names the kind and how its products change, no conditions.
    cleanup();
    renderApp('/segments/6', fetchMock);
    expect(await screen.findByRole('heading', { level: 1, name: picked.name })).toBeInTheDocument();
    expect(screen.getByText(mn.segments.list.hint)).toBeInTheDocument();
    // An admin is told how to change its products.
    expect(screen.getByText(mn.segments.list.howTo)).toBeInTheDocument();
    expect(screen.queryByText(mn.segments.conditions)).toBeNull();
    await waitFor(() =>
      expect(
        screen.getByText(mn.segments.countOf.PRODUCT.replace('{{count}}', '137')),
      ).toBeVisible(),
    );

    // The form keeps the name and description only and sends no conditions.
    cleanup();
    const edit = renderApp('/segments/6/edit', fetchMock);
    const name = await screen.findByLabelText(mn.segments.name);
    expect(
      screen.queryByRole('region', { name: mn.segments.group.replace('{{n}}', '1') }),
    ).toBeNull();
    await user.clear(name);
    await user.type(name, 'Түмний эх');
    await user.click(screen.getByRole('button', { name: mn.common.save }));
    await waitFor(() => expect(edit.router.state.location.pathname).toBe('/segments/6'));
    const [request] = calls(fetchMock, 'PUT', '/api/v1/segments/6');
    expect(request ? await sent(request) : {}).toEqual({ name: 'Түмний эх', description: null });

    // A reader is not told how to change products they may not change.
    cleanup();
    renderApp('/segments/6', signedIn(WORKER_ME, routes));
    expect(await screen.findByText(mn.segments.list.hint)).toBeInTheDocument();
    expect(screen.queryByText(mn.segments.list.howTo)).toBeNull();
  });

  it('creates a segment with groups of conditions and a live count', async () => {
    const fetchMock = signedIn(ADMIN_ME, {
      ...LOOKUPS,
      'POST /api/v1/segments/preview': () => json({ count: 12 }),
      'POST /api/v1/segments': async (request) =>
        json(
          { ...segment(8, 'Кола', { match: 'ALL', groups: [] }), ...(await sent(request)) },
          201,
        ),
      'GET /api/v1/segments/8': () => json({ ...DRINKS, id: 8, name: 'Кола' }),
      'GET /api/v1/segments/counts': () => json([{ segmentId: 8, count: 12 }]),
    });
    const { router } = renderApp('/segments/new?entity=PRODUCT', fetchMock);
    const user = userEvent.setup();
    // The first condition is a search with no word yet: the shared rules name what is missing.
    expect(await screen.findByText(mn.segments.issues.VALUE_MISSING)).toBeInTheDocument();
    await user.type(
      screen.getByRole('textbox', {
        name: `${mn.segments.text}: ${mn.segments.group.replace('{{n}}', '1')}, 1`,
      }),
      'кола',
    );
    expect(
      await screen.findByText(mn.segments.liveCount.replace('{{count}}', '12')),
    ).toBeInTheDocument();
    // A second group joined by «Аль нэг нь», on stock.
    await user.click(screen.getByRole('button', { name: mn.segments.addGroup }));
    const second = screen.getByRole('region', { name: mn.segments.group.replace('{{n}}', '2') });
    await user.selectOptions(
      within(second).getByRole('combobox', {
        name: `${mn.segments.field}: ${mn.segments.group.replace('{{n}}', '2')}, 1`,
      }),
      'stock',
    );
    await user.selectOptions(
      screen.getByRole('combobox', { name: mn.segments.groupsMatch }),
      'ANY',
    );
    await user.type(screen.getByLabelText(mn.segments.name), 'Кола');
    await user.click(screen.getByRole('button', { name: mn.common.save }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/segments/8'));
    const [request] = calls(fetchMock, 'POST', '/api/v1/segments');
    expect(request?.headers.get('Idempotency-Key')).toMatch(/^[0-9a-f-]{36}$/);
    expect(request ? await sent(request) : {}).toEqual({
      entity: 'PRODUCT',
      name: 'Кола',
      description: null,
      definition: {
        match: 'ANY',
        groups: [
          { match: 'ALL', conditions: [{ field: 'search', op: 'CONTAINS', text: 'кола' }] },
          { match: 'ALL', conditions: [{ field: 'stock', op: 'IN_STOCK' }] },
        ],
      },
    });
  });

  it('asks for a name before saving', async () => {
    renderApp('/segments/new?entity=PRODUCT', signedIn(ADMIN_ME, LOOKUPS));
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: mn.common.save }));
    expect(await screen.findByText(mn.validation.required)).toBeInTheDocument();
  });

  it('turns the product list filters into a new segment', async () => {
    const fetchMock = signedIn(ADMIN_ME, {
      ...LOOKUPS,
      'GET /api/v1/uoms': () => list([]),
      'POST /api/v1/products/query': () => json({ data: [], nextCursor: null, total: 0 }),
      'POST /api/v1/segments/preview': () => json({ count: 3 }),
    });
    const { router } = renderApp('/catalog/products?supplier=7&q=кола', fetchMock);
    const user = userEvent.setup();
    await user.click(await screen.findByRole('link', { name: mn.segments.fromFilters }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/segments/new'));
    const group = mn.segments.group.replace('{{n}}', '1');
    expect(screen.getByRole('textbox', { name: `${mn.segments.text}: ${group}, 1` })).toHaveValue(
      'кола',
    );
    expect(
      await screen.findByRole('button', {
        name: `${mn.segments.fields.PRODUCT.supplier} (${group}, 2): МСМ ХХК`,
      }),
    ).toBeInTheDocument();
  });

  it('narrows the customer list to a segment', async () => {
    const fetchMock = signedIn(ADMIN_ME, {
      'GET /api/v1/segments': () =>
        list([segment(3, 'Зээл хаасан', { match: 'ALL', groups: [] }, 'CUSTOMER')]),
      'GET /api/v1/customers': () => list([]),
    });
    const { router } = renderApp('/partners/customers', fetchMock);
    const user = userEvent.setup();
    const select = await screen.findByRole('combobox', {
      name: mn.catalog.products.filters.fields.segment,
    });
    await user.selectOptions(select, '3');
    await waitFor(() => expect(router.state.location.search).toBe('?segment=3'));
    await waitFor(() =>
      expect(
        calls(fetchMock, 'GET', '/api/v1/customers').some(
          (request) => new URL(request.url).searchParams.get('segmentId') === '3',
        ),
      ).toBe(true),
    );
  });
});
