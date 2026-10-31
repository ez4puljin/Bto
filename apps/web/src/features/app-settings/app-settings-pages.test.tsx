import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { components } from '@tugeel/api-client';
import mn from '@tugeel/shared/i18n/mn.json';
import { describe, expect, it } from 'vitest';
import { bodyOf, calls } from '@/test/inventory-fixtures';
import { ADMIN_ME, findSidebar, json, type Me, renderApp, signedIn } from '@/test/render-app';

type Schemas = components['schemas'];
const STAMP = '2026-10-31T02:00:00.000Z';

const settings = (fields: Partial<Schemas['AppSettings']> = {}): Schemas['AppSettings'] => ({
  assortmentSegmentId: null,
  assortment: { segmentId: null, segmentName: null, broken: false },
  shopProductCount: 1751,
  homeSections: { PROMOTIONS: true, DISCOUNTS: true, NEW: true },
  minOrderAmount: null,
  appName: null,
  appColor: null,
  updatedAt: null,
  ...fields,
});
const segment = (fields: Partial<Schemas['Segment']>): Schemas['Segment'] => ({
  id: 1,
  entity: 'PRODUCT',
  kind: 'RULES',
  name: 'Сегмент',
  description: null,
  definition: null,
  appRank: null,
  appShownCount: null,
  createdAt: STAMP,
  updatedAt: STAMP,
  ...fields,
});
const DRINKS = segment({ id: 4, name: 'Ундаа', appRank: 2, appShownCount: 2 });
const CARS = segment({
  id: 5,
  name: 'Автомашины бүтээгдэхүүн',
  kind: 'LIST',
  appRank: 1,
  appShownCount: 2,
});
const SWEETS = segment({ id: 6, name: 'Чихэр' });
const KEEPER: Me = {
  ...ADMIN_ME,
  id: 8,
  username: 'keeper',
  fullName: 'Нүүр Сараа',
  permissions: ['customer.home.manage'],
  roles: [],
};
const READER: Me = { ...KEEPER, id: 9, username: 'reader', permissions: ['sales.boards.manage'] };

/** The PUT answers the row it was given, with the derived fields recomputed roughly. */
const saving = async (put: Request) => {
  const body = (await put.clone().json()) as Schemas['AppSettingsRequest'];
  return json(
    settings({
      ...body,
      assortment: { segmentId: body.assortmentSegmentId, segmentName: null, broken: false },
    }),
  );
};
const routes = (
  row = settings(),
  extra: Record<string, (request: Request) => Response | Promise<Response>> = {},
) => ({
  'GET /api/v1/app-settings': () => json(row),
  'PUT /api/v1/app-settings': saving,
  'GET /api/v1/segments': () => json({ data: [CARS, DRINKS, SWEETS], nextCursor: null }),
  'GET /api/v1/customer/banners': () => json({ data: [], nextCursor: null }),
  'GET /api/v1/customer/attention': () => json({ activeAccounts: 3, ordersOpen: true }),
  ...extra,
});
const region = async (name: string) => within(await screen.findByRole('region', { name }));
const put = (fetchMock: ReturnType<typeof signedIn>) =>
  calls(fetchMock, 'PUT', '/api/v1/app-settings');

describe('the «Апп» module (ADR-0127)', () => {
  it('lists its pages in the menu for the home’s keeper', async () => {
    renderApp('/app/home', signedIn(KEEPER, routes()));
    const sidebar = within(await findSidebar());
    expect(sidebar.getByRole('link', { name: mn.nav.appHome })).toHaveAttribute(
      'href',
      '/app/home',
    );
    expect(sidebar.getByRole('link', { name: mn.nav.appProducts })).toHaveAttribute(
      'href',
      '/app/products',
    );
    expect(sidebar.getByRole('link', { name: mn.nav.appOrders })).toHaveAttribute(
      'href',
      '/app/orders',
    );
    expect(sidebar.getByRole('link', { name: mn.nav.appGeneral })).toHaveAttribute(
      'href',
      '/app/general',
    );
    // The contacts, the notices and the stores need their own rights.
    expect(sidebar.queryByRole('link', { name: mn.nav.appContacts })).toBeNull();
    expect(sidebar.queryByRole('link', { name: mn.nav.appNotices })).toBeNull();
    expect(sidebar.queryByRole('link', { name: mn.nav.appStores })).toBeNull();
  });
});

describe('«Аппын нүүр»', () => {
  it('switches a built-in section off, sending the whole row', async () => {
    const fetchMock = signedIn(KEEPER, routes());
    renderApp('/app/home', fetchMock);
    const user = userEvent.setup();
    const card = await region(mn.appSettings.home.sections.title);
    const toggle = await card.findByRole('switch', { name: mn.appSettings.home.sections.NEW });
    expect(toggle).toBeChecked();
    await user.click(toggle);
    await waitFor(() => expect(put(fetchMock)).toHaveLength(1));
    expect(await bodyOf(put(fetchMock)[0])).toEqual({
      assortmentSegmentId: null,
      homeSections: { PROMOTIONS: true, DISCOUNTS: true, NEW: false },
      minOrderAmount: null,
      appName: null,
      appColor: null,
    });
    expect(await screen.findByRole('status')).toHaveTextContent(mn.appSettings.home.sections.saved);
    await waitFor(() =>
      expect(
        card.getByRole('switch', { name: mn.appSettings.home.sections.NEW }),
      ).not.toBeChecked(),
    );
  });

  it('lists the shown segments in rank order, takes one off and adds one', async () => {
    const fetchMock = signedIn(
      KEEPER,
      routes(settings(), {
        'PUT /api/v1/segments/4/app': () => json(segment({ ...DRINKS, appRank: null })),
        'PUT /api/v1/segments/6/app': () => json(segment({ ...SWEETS, appRank: 3 })),
      }),
    );
    renderApp('/app/home', fetchMock);
    const user = userEvent.setup();
    const card = await region(mn.appSettings.home.segments.title);
    const rows = await card.findAllByRole('row');
    expect(rows.map((row) => row.textContent)).toEqual([
      expect.stringContaining('Автомашины бүтээгдэхүүн'),
      expect.stringContaining('Ундаа'),
    ]);
    expect(
      within(rows[0] as HTMLElement).getByRole('link', { name: 'Автомашины бүтээгдэхүүн' }),
    ).toHaveAttribute('href', '/segments/5');
    expect(within(rows[0] as HTMLElement).getByText(mn.segments.kinds.LIST)).toBeInTheDocument();
    // The first cannot go up, the last cannot go down.
    expect(
      card.getByRole('button', {
        name: `${mn.appSettings.home.segments.up}: Автомашины бүтээгдэхүүн`,
      }),
    ).toBeDisabled();
    expect(
      card.getByRole('button', { name: `${mn.appSettings.home.segments.down}: Ундаа` }),
    ).toBeDisabled();

    await user.click(
      card.getByRole('button', { name: `${mn.appSettings.home.segments.remove}: Ундаа` }),
    );
    await waitFor(() => expect(calls(fetchMock, 'PUT', '/api/v1/segments/4/app')).toHaveLength(1));
    expect(await bodyOf(calls(fetchMock, 'PUT', '/api/v1/segments/4/app')[0])).toEqual({
      shown: false,
    });
    expect(await screen.findByRole('status')).toHaveTextContent(
      mn.appSettings.home.segments.removed,
    );

    // Only the segments not shown yet are offered.
    const pick = card.getByRole('combobox', { name: mn.appSettings.home.segments.pick });
    expect(
      within(pick)
        .getAllByRole('option')
        .map((o) => o.textContent),
    ).toEqual([mn.appSettings.home.segments.choose, 'Чихэр']);
    const add = card.getByRole('button', { name: mn.appSettings.home.segments.add });
    expect(add).toBeDisabled();
    await user.selectOptions(pick, '6');
    await user.click(add);
    await waitFor(() => expect(calls(fetchMock, 'PUT', '/api/v1/segments/6/app')).toHaveLength(1));
    expect(await bodyOf(calls(fetchMock, 'PUT', '/api/v1/segments/6/app')[0])).toEqual({
      shown: true,
    });
  });
});

describe('«Аппын бараа»', () => {
  it('chooses the assortment segment, shows the count and the segment’s link', async () => {
    const fetchMock = signedIn(KEEPER, routes());
    renderApp('/app/products', fetchMock);
    const user = userEvent.setup();
    const card = await region(mn.appSettings.products.assortment);
    expect(
      await card.findByText(mn.appSettings.products.count.replace('{{n}}', '1,751')),
    ).toBeInTheDocument();
    const choice = card.getByRole('combobox', { name: mn.appSettings.products.assortment });
    expect(choice).toHaveValue('');
    expect(card.queryByRole('link', { name: mn.appSettings.products.openSegment })).toBeNull();
    expect(card.getByRole('link', { name: mn.appSettings.products.newSegment })).toHaveAttribute(
      'href',
      '/segments/new?entity=PRODUCT',
    );
    await user.selectOptions(choice, '4');
    await waitFor(() => expect(put(fetchMock)).toHaveLength(1));
    expect(await bodyOf(put(fetchMock)[0])).toMatchObject({ assortmentSegmentId: 4 });
    expect(await screen.findByRole('status')).toHaveTextContent(mn.appSettings.products.saved);
    expect(
      await card.findByRole('link', { name: mn.appSettings.products.openSegment }),
    ).toHaveAttribute('href', '/segments/4');
  });

  it('warns when the chosen segment was archived', async () => {
    renderApp(
      '/app/products',
      signedIn(
        KEEPER,
        routes(
          settings({
            assortmentSegmentId: 9,
            assortment: { segmentId: 9, segmentName: 'Хуучин', broken: true },
            shopProductCount: 20000,
          }),
        ),
      ),
    );
    const card = await region(mn.appSettings.products.assortment);
    expect(await card.findByText(mn.appSettings.products.broken)).toBeInTheDocument();
    expect(card.getByRole('combobox', { name: mn.appSettings.products.assortment })).toHaveValue(
      '9',
    );
    expect(card.queryByRole('link', { name: mn.appSettings.products.openSegment })).toBeNull();
  });
});

describe('«Аппын захиалга»', () => {
  it('shows the orders card and saves the minimum as whole MNT', async () => {
    const fetchMock = signedIn(KEEPER, routes());
    renderApp('/app/orders', fetchMock);
    const user = userEvent.setup();
    const orders = await region(mn.customerApp.orders.title);
    expect(await orders.findByText(mn.customerApp.orders.open)).toBeInTheDocument();
    expect(
      orders.getByText(mn.customerApp.orders.accounts.replace('{{n}}', '3')),
    ).toBeInTheDocument();
    expect(orders.getByRole('link', { name: mn.customerApp.orders.settings })).toHaveAttribute(
      'href',
      '/sales/boards/settings',
    );

    const minimum = await region(mn.appSettings.orders.minimum.title);
    const field = await minimum.findByLabelText(mn.appSettings.orders.minimum.amount);
    await user.type(field, '100 000');
    await user.click(minimum.getByRole('button', { name: mn.common.save }));
    expect(await minimum.findByText(mn.validation.wholeMnt)).toBeInTheDocument();
    expect(put(fetchMock)).toHaveLength(0);
    await user.clear(field);
    await user.type(field, '100000');
    await user.click(minimum.getByRole('button', { name: mn.common.save }));
    await waitFor(() => expect(put(fetchMock)).toHaveLength(1));
    expect(await bodyOf(put(fetchMock)[0])).toMatchObject({ minOrderAmount: '100000' });
    expect(await screen.findByRole('status')).toHaveTextContent(
      mn.appSettings.orders.minimum.saved,
    );
  });

  it('reads the minimum to the boards’ keeper without the right to change it', async () => {
    renderApp('/app/orders', signedIn(READER, routes(settings({ minOrderAmount: '50000' }))));
    const minimum = await region(mn.appSettings.orders.minimum.title);
    expect(
      await minimum.findByText(
        mn.appSettings.orders.minimum.current.replace('{{amount}}', '50,000'),
      ),
    ).toBeInTheDocument();
    expect(minimum.queryByRole('button', { name: mn.common.save })).toBeNull();
  });
});

describe('«Ерөнхий»', () => {
  it('saves the name and the colour, the hex field and the picker in step', async () => {
    const fetchMock = signedIn(KEEPER, routes());
    renderApp('/app/general', fetchMock);
    const user = userEvent.setup();
    const card = await region(mn.appSettings.general.section);
    const name = await card.findByLabelText(mn.appSettings.general.name);
    const hex = card.getByLabelText(mn.appSettings.general.color);
    const save = card.getByRole('button', { name: mn.common.save });
    expect(save).toBeDisabled();
    await user.type(name, ' Оргил бөөний төв ');
    await user.type(hex, '#12ab');
    await user.click(save);
    expect(await card.findByText(mn.validation.color)).toBeInTheDocument();
    expect(put(fetchMock)).toHaveLength(0);
    await user.clear(hex);
    await user.type(hex, '#12abef');
    expect(screen.getByTestId('app-preview')).toHaveStyle({ backgroundColor: '#12abef' });
    expect(screen.getByTestId('app-preview')).toHaveTextContent('Оргил бөөний төв');
    await user.click(save);
    await waitFor(() => expect(put(fetchMock)).toHaveLength(1));
    expect(await bodyOf(put(fetchMock)[0])).toMatchObject({
      appName: 'Оргил бөөний төв',
      appColor: '#12ABEF',
    });
    expect(await screen.findByRole('status')).toHaveTextContent(mn.appSettings.general.saved);
  });
});

describe('«Дэлгүүрүүд»', () => {
  it('counts the stores with the app and links the filtered customer list', async () => {
    renderApp('/app/stores', signedIn(ADMIN_ME, routes()));
    const card = await region(mn.appSettings.stores.title);
    expect(
      await card.findByText(mn.appSettings.stores.active.replace('{{n}}', '3')),
    ).toBeInTheDocument();
    expect(card.getByRole('link', { name: mn.appSettings.stores.links.ACTIVE })).toHaveAttribute(
      'href',
      '/partners/customers?app=ACTIVE',
    );
    expect(card.getByRole('link', { name: mn.appSettings.stores.links.NONE })).toHaveAttribute(
      'href',
      '/partners/customers?app=NONE',
    );
  });
});
