import { cleanup, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { components } from '@tugeel/api-client';
import mn from '@tugeel/shared/i18n/mn.json';
import { describe, expect, it } from 'vitest';
import {
  ADMIN_ME,
  json,
  type Me,
  problem,
  renderApp,
  signedIn,
  WORKER_ME,
} from '@/test/render-app';

type Schemas = components['schemas'];
const STAMP = '2026-10-01T02:00:00.000Z';
const LATER = '2026-10-02T02:00:00.000Z';
const list = <T,>(data: T[], nextCursor: string | null = null) => json({ data, nextCursor });
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const MAPS_LINK =
  'https://www.google.com/maps/place/Shop/@47.9,106.9,17z/data=!3m1!4b1!4m6!3m5!1s0x0:0x0!8m2!3d47.918412!4d106.917712!16s';

const OFFICE_ME: Me = {
  ...ADMIN_ME,
  id: 3,
  username: 'office',
  fullName: 'Оффисын Сараа',
  permissions: ['partners.customers.read', 'partners.customers.manage'],
  roles: [{ id: 2, code: 'OFFICE', name: null, isSystem: true }],
};

const POINT = { lat: '47.918400', lng: '106.917700' };
const summary = (
  overrides: Partial<Schemas['CustomerListItem']> &
    Pick<Schemas['CustomerListItem'], 'id' | 'code' | 'name'>,
): Schemas['CustomerListItem'] => ({
  kind: 'COMPANY',
  regNo: null,
  tin: null,
  phone: null,
  status: 'ACTIVE',
  creditHold: false,
  tinPending: false,
  address: null,
  hasGps: overrides.hasGps ?? true,
  consumerNo: null,
  vatPayer: false,
  cityPayer: false,
  taxStatusSource: null,
  creditLimit: null,
  paymentTerm: { days: null, source: 'UNSET' },
  creditHoldReason: null,
  note: null,
  gps: overrides.hasGps === false ? null : POINT,
  contact: null,
  ...overrides,
});
const supplierRow = (
  overrides: Partial<Schemas['SupplierListItem']> &
    Pick<Schemas['SupplierListItem'], 'id' | 'code' | 'name'>,
): Schemas['SupplierListItem'] => ({
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
  productCount: 0,
  ...overrides,
});

const SHOP: Schemas['CustomerAddress'] = {
  id: 50,
  label: 'Дэлгүүр',
  address: 'БЗД, 13-р хороо',
  lat: '47.918400',
  lng: '106.917700',
  gpsSource: 'OFFICE',
  zoneId: null,
  note: 'Ногоон хаалга',
  isDefault: true,
  archivedAt: null,
};
const STORE: Schemas['CustomerAddress'] = {
  ...SHOP,
  id: 51,
  label: null,
  address: 'Агуулахын хаяг',
  lat: null,
  lng: null,
  gpsSource: null,
  note: null,
  isDefault: false,
};
const CUSTOMER: Schemas['CustomerDetail'] = {
  id: 9,
  code: '1001',
  kind: 'COMPANY',
  name: 'Номин дэлгүүр',
  regNo: '1234567',
  tin: '12345678901',
  phone: '+97699112233',
  status: 'ACTIVE',
  creditHold: false,
  tinPending: false,
  address: SHOP.address,
  hasGps: true,
  tinSource: 'MANUAL',
  consumerNo: null,
  vatPayer: true,
  cityPayer: false,
  taxStatusSource: 'MANUAL',
  taxStatusCheckedAt: STAMP,
  creditLimit: null,
  paymentTermDays: null,
  paymentTerm: { days: 30, source: 'DEFAULT' },
  creditHoldReason: null,
  note: null,
  createdAt: STAMP,
  updatedAt: STAMP,
  addresses: [SHOP, STORE],
  contacts: [{ id: 60, name: 'Бат', position: 'Эрхлэгч', phone: '+97688112233', note: null }],
};

const MSM: Schemas['SupplierDetail'] = {
  id: 3,
  code: '010',
  name: 'МСМ ХХК',
  tin: '12345678901',
  phone: '+97670112233',
  status: 'ACTIVE',
  regNo: '7654321',
  email: 'sales@msm.mn',
  address: 'ХУД, 3-р хороо',
  bankName: 'Хаан банк',
  bankAccount: 'MN120005005012345678',
  paymentTermDays: 30,
  note: null,
  createdAt: STAMP,
  updatedAt: STAMP,
  contacts: [],
};

const calls = (fetchMock: ReturnType<typeof signedIn>, method: string, path: string) =>
  fetchMock.mock.calls
    .map(([request]) => request)
    .filter((request) => request.method === method && new URL(request.url).pathname === path);

describe('partners menu and access', () => {
  it('shows suppliers to every user and keeps customers from a warehouse worker', async () => {
    const fetchMock = signedIn(WORKER_ME);
    renderApp('/partners/customers', fetchMock);
    expect(await screen.findByText(mn.errors.FORBIDDEN)).toBeInTheDocument();
    const nav = screen.getByRole('navigation');
    expect(within(nav).getByRole('link', { name: mn.nav.suppliers })).toBeInTheDocument();
    expect(within(nav).queryByRole('link', { name: mn.nav.customers })).toBeNull();
    expect(calls(fetchMock, 'GET', '/api/v1/customers')).toHaveLength(0);
  });

  it('shows customers to the office', async () => {
    renderApp('/system/status', signedIn(OFFICE_ME));
    const nav = await screen.findByRole('navigation');
    expect(within(nav).getByRole('link', { name: mn.nav.customers })).toHaveAttribute(
      'href',
      '/partners/customers',
    );
    expect(within(nav).getByText(mn.nav.groups.partners)).toBeInTheDocument();
  });
});

describe('customers list', () => {
  it('filters by kind and a missing TIN through the URL', async () => {
    const fetchMock = signedIn(OFFICE_ME, {
      'GET /api/v1/customers': (request) => {
        const query = new URL(request.url).searchParams;
        if (query.get('tinPending') === 'true') {
          return list([summary({ id: 2, code: '1002', name: 'ТТД-гүй ХХК', tinPending: true })]);
        }
        return list([
          summary({
            id: 1,
            code: '1001',
            name: 'Номин дэлгүүр',
            tin: '12345678901',
            phone: '+97699112233',
            address: 'БЗД, 13-р хороо',
          }),
          summary({ id: 3, code: '1003', name: 'Бат', kind: 'INDIVIDUAL', hasGps: false }),
        ]);
      },
    });
    const { router } = renderApp('/partners/customers', fetchMock);
    const user = userEvent.setup();
    expect(await screen.findByRole('link', { name: 'Номин дэлгүүр' })).toHaveAttribute(
      'href',
      '/partners/customers/1',
    );
    const table = within(screen.getByRole('table'));
    expect(table.getByText('9911 2233')).toBeInTheDocument();
    // The filters' labels read the same as the badges: look in the table only.
    expect(table.getByText(mn.partners.addresses.noGps)).toBeInTheDocument();

    await user.click(
      screen.getByRole('checkbox', { name: mn.partners.customers.filters.tinPending }),
    );
    await waitFor(() => expect(router.state.location.search).toBe('?tinPending=1'));
    expect(await screen.findByRole('link', { name: 'ТТД-гүй ХХК' })).toBeInTheDocument();
    expect(
      within(screen.getByRole('table')).getByText(mn.partners.customer.tinPending),
    ).toBeInTheDocument();

    await user.selectOptions(screen.getByLabelText(mn.partners.customer.kind), 'INDIVIDUAL');
    await waitFor(() => expect(router.state.location.search).toBe('?tinPending=1&kind=INDIVIDUAL'));
    await waitFor(() =>
      expect(
        calls(fetchMock, 'GET', '/api/v1/customers').some((request) => {
          const query = new URL(request.url).searchParams;
          return query.get('kind') === 'INDIVIDUAL' && query.get('tinPending') === 'true';
        }),
      ).toBe(true),
    );
  });

  it('shows every customer field in its own column and opens the customer from its row', async () => {
    const routes = {
      'GET /api/v1/customers': () =>
        list([
          summary({
            id: 1,
            code: '1001',
            name: 'Номин дэлгүүр',
            regNo: '1234567',
            tin: '12345678901',
            phone: '+97699112233',
            address: 'БЗД, 13-р хороо',
            vatPayer: true,
            taxStatusSource: 'MANUAL',
            creditLimit: '5000000.00',
            paymentTerm: { days: 30, source: 'CUSTOMER' },
            creditHold: true,
            creditHoldReason: 'Өр төлөөгүй',
            note: 'Өглөө хүргэнэ',
            contact: { name: 'Бат', phone: '+97688112233' },
          }),
          summary({
            id: 3,
            code: '1003',
            name: 'Бат иргэн',
            kind: 'INDIVIDUAL',
            consumerNo: '11234567',
          }),
        ]),
    };
    const first = renderApp('/partners/customers', signedIn(OFFICE_ME, routes));
    const table = within(await screen.findByRole('table'));
    expect(await table.findByText('Өр төлөөгүй')).toBeInTheDocument();
    for (const text of [
      '1234567',
      '11234567',
      '9911 2233',
      mn.common.yes,
      'БЗД, 13-р хороо',
      'Бат',
      '8811 2233',
      '5,000,000',
      '30 хоног',
      mn.partners.credit.held,
      mn.partners.credit.limitUndecided,
      'Өглөө хүргэнэ',
    ]) {
      expect(table.getAllByText(text).length).toBeGreaterThan(0);
    }
    expect(table.getAllByRole('link', { name: mn.partners.addresses.openMap })).toHaveLength(2);
    for (const label of Object.values(mn.partners.customers.columns)) {
      expect(screen.getByRole('columnheader', { name: label })).toBeInTheDocument();
    }
    const user = userEvent.setup();
    await user.click(screen.getByRole('link', { name: `${mn.common.edit}: Номин дэлгүүр` }));
    await waitFor(() => expect(first.router.state.location.pathname).toBe('/partners/customers/1'));

    cleanup();
    const second = renderApp('/partners/customers', signedIn(OFFICE_ME, routes));
    await user.click(await within(await screen.findByRole('table')).findByText('11234567'));
    await waitFor(() =>
      expect(second.router.state.location.pathname).toBe('/partners/customers/3'),
    );
  });

  it('hides a customer column and remembers it in this browser', async () => {
    const routes = {
      'GET /api/v1/customers': () =>
        list([summary({ id: 1, code: '1001', name: 'Номин дэлгүүр', note: 'Өглөө' })]),
    };
    renderApp('/partners/customers', signedIn(OFFICE_ME, routes));
    const user = userEvent.setup();
    await screen.findByRole('link', { name: 'Номин дэлгүүр' });
    await user.click(screen.getByRole('button', { name: mn.common.columns }));
    await user.click(
      await screen.findByRole('menuitemcheckbox', { name: mn.partners.customers.columns.note }),
    );
    await user.keyboard('{Escape}');
    expect(
      screen.queryByRole('columnheader', { name: mn.partners.customers.columns.note }),
    ).toBeNull();
    expect(localStorage.getItem('tugeel.partners.customers.hiddenColumns.v1')).toBe('["note"]');

    cleanup();
    renderApp('/partners/customers', signedIn(OFFICE_ME, routes));
    await screen.findByRole('link', { name: 'Номин дэлгүүр' });
    expect(
      screen.queryByRole('columnheader', { name: mn.partners.customers.columns.note }),
    ).toBeNull();
  });
});

describe('customer create', () => {
  const created = { ...CUSTOMER, id: 10, code: '1002', name: 'Тэмүүжин ХХК' };
  const createRoutes = (onPost: (request: Request) => Promise<Response>) => ({
    'GET /api/v1/customers/next-code': () => json({ code: '1002' }),
    'POST /api/v1/customers': onPost,
    'GET /api/v1/customers/10': () => json(created),
  });

  it('suggests the code, reads a Google Maps link and checks the TIN by kind', async () => {
    const posted: { key: string | null; body: unknown }[] = [];
    const fetchMock = signedIn(
      OFFICE_ME,
      createRoutes(async (request) => {
        posted.push({ key: request.headers.get('Idempotency-Key'), body: await request.json() });
        return json(created, 201);
      }),
    );
    const { router } = renderApp('/partners/customers/new', fetchMock);
    const user = userEvent.setup();
    expect(await screen.findByLabelText(mn.partners.customer.code)).toHaveValue('1002');
    expect(screen.queryByLabelText(mn.partners.customer.consumerNo)).toBeNull();

    await user.type(screen.getByLabelText(mn.partners.customer.name), 'Тэмүүжин ХХК');
    const tin = screen.getByLabelText(mn.partners.customer.tin);
    await user.type(tin, '123456789012');
    await user.type(screen.getByLabelText(mn.partners.customer.phone), '9911 2233');
    await user.type(screen.getByLabelText(mn.partners.addresses.address), 'СБД, 1-р хороо');
    await user.click(screen.getByLabelText(mn.partners.addresses.gps));
    await user.paste(MAPS_LINK);
    expect(screen.getByText('47.918412, 106.917712')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: mn.partners.addresses.openMap })).toHaveAttribute(
      'href',
      'https://www.google.com/maps/search/?api=1&query=47.918412,106.917712',
    );

    await user.click(screen.getByRole('button', { name: mn.common.save }));
    expect(await screen.findByText(mn.validation.tinCompany)).toBeInTheDocument();
    expect(posted).toEqual([]);
    await user.clear(tin);
    await user.type(tin, '123 456 789 01');
    await user.click(screen.getByRole('button', { name: mn.common.save }));

    await waitFor(() => expect(router.state.location.pathname).toBe('/partners/customers/10'));
    expect(posted).toHaveLength(1);
    expect(posted[0]?.key).toMatch(UUID);
    expect(posted[0]?.body).toEqual({
      kind: 'COMPANY',
      name: 'Тэмүүжин ХХК',
      regNo: null,
      tin: '12345678901',
      consumerNo: null,
      phone: '9911 2233',
      note: null,
      address: {
        address: 'СБД, 1-р хороо',
        lat: '47.918412',
        lng: '106.917712',
        note: null,
      },
    });
  });

  it('shows a taken code on its field and resends the same key', async () => {
    const posted: { key: string | null; body: unknown }[] = [];
    const fetchMock = signedIn(
      ADMIN_ME,
      createRoutes(async (request) => {
        posted.push({ key: request.headers.get('Idempotency-Key'), body: await request.json() });
        return posted.length === 1
          ? problem('DUPLICATE_VALUE', 409, { constraint: 'customers_code_key' })
          : json(created, 201);
      }),
    );
    const { router } = renderApp('/partners/customers/new', fetchMock);
    const user = userEvent.setup();
    const code = await screen.findByLabelText(mn.partners.customer.code);
    await user.clear(code);
    await user.type(code, '1001');
    await user.type(screen.getByLabelText(mn.partners.customer.name), 'Тэмүүжин ХХК');
    await user.click(screen.getByRole('button', { name: mn.common.save }));
    expect(await screen.findByText(mn.validation.codeTaken)).toBeInTheDocument();
    expect(screen.queryByText(mn.errors.DUPLICATE_VALUE)).toBeNull();

    await user.clear(code);
    await user.type(code, '2001');
    await user.click(screen.getByRole('button', { name: mn.common.save }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/partners/customers/10'));
    expect(posted.map((call) => (call.body as { code?: string }).code)).toEqual(['1001', '2001']);
    expect(posted[1]?.key).toBe(posted[0]?.key);
  });

  it('asks citizens for the consumer number and refuses a short map link', async () => {
    const fetchMock = signedIn(
      OFFICE_ME,
      createRoutes(() => Promise.resolve(json(created, 201))),
    );
    renderApp('/partners/customers/new', fetchMock);
    const user = userEvent.setup();
    await user.selectOptions(await screen.findByLabelText(mn.partners.customer.kind), 'INDIVIDUAL');
    await user.type(screen.getByLabelText(mn.partners.customer.name), 'Бат');
    await user.type(screen.getByLabelText(mn.partners.customer.regNo), '1234567');
    expect(screen.getByText(mn.partners.customer.regNoHintIndividual)).toBeInTheDocument();
    await user.type(screen.getByLabelText(mn.partners.customer.tin), '12345678901');
    await user.type(screen.getByLabelText(mn.partners.customer.consumerNo), '1234');
    await user.click(screen.getByLabelText(mn.partners.addresses.gps));
    await user.paste('https://maps.app.goo.gl/AbCdEf123');
    await user.click(screen.getByRole('button', { name: mn.common.save }));
    expect(await screen.findByText(mn.validation.tinIndividual)).toBeInTheDocument();
    expect(screen.getByText(mn.validation.consumerNo)).toBeInTheDocument();
    expect(screen.getByText(mn.validation.gpsShortLink)).toBeInTheDocument();
    expect(calls(fetchMock, 'POST', '/api/v1/customers')).toHaveLength(0);
  });
});

describe('customer page', () => {
  it('lets the office edit the customer but only read the credit terms', async () => {
    renderApp(
      '/partners/customers/9',
      signedIn(OFFICE_ME, { 'GET /api/v1/customers/9': () => json(CUSTOMER) }),
    );
    expect(await screen.findByLabelText(mn.partners.customer.name)).toBeEnabled();
    expect(screen.getByLabelText(mn.partners.customer.phone)).toHaveValue('99112233');
    expect(screen.getByText(mn.partners.customer.tinSource.MANUAL)).toBeInTheDocument();
    expect(screen.queryByLabelText(mn.partners.credit.limit)).toBeNull();
    expect(screen.getByText(mn.partners.credit.limitUndecided)).toBeInTheDocument();
    expect(
      screen.getByText(mn.partners.credit.termDefault.replace('{{days}}', '30')),
    ).toBeInTheDocument();
    expect(screen.getByText(mn.partners.credit.readOnly)).toBeInTheDocument();

    const shop = within(screen.getByRole('region', { name: 'Дэлгүүр' }));
    expect(shop.getByText(mn.partners.addresses.default)).toBeInTheDocument();
    expect(shop.getByText('47.9184, 106.9177')).toBeInTheDocument();
    expect(shop.getByRole('link', { name: mn.partners.addresses.openMap })).toHaveAttribute(
      'href',
      'https://www.google.com/maps/search/?api=1&query=47.918400,106.917700',
    );
    const store = within(screen.getByRole('region', { name: 'Агуулахын хаяг' }));
    expect(store.getByText(mn.partners.addresses.noGps)).toBeInTheDocument();
    expect(screen.getByText('8811 2233')).toBeInTheDocument();
  });

  it('lets an accountant set the limit, the term and a hold', async () => {
    let current = CUSTOMER;
    let put: unknown;
    renderApp(
      '/partners/customers/9',
      signedIn(ADMIN_ME, {
        'GET /api/v1/customers/9': () => json(current),
        'PUT /api/v1/customers/9/credit': async (request) => {
          put = await request.json();
          current = {
            ...CUSTOMER,
            creditLimit: '5000000.00',
            paymentTermDays: 45,
            paymentTerm: { days: 45, source: 'CUSTOMER' },
            creditHold: true,
            creditHoldReason: 'Хугацаа хэтэрсэн',
            updatedAt: LATER,
          };
          return json(current);
        },
      }),
    );
    const user = userEvent.setup();
    const limit = await screen.findByLabelText(mn.partners.credit.limit);
    expect(limit).toHaveValue('');
    expect(screen.queryByLabelText(mn.partners.credit.holdReason)).toBeNull();
    await user.type(limit, '5,000,000');
    await user.type(screen.getByLabelText(mn.partners.credit.term), '45');
    await user.click(screen.getByRole('checkbox', { name: mn.partners.credit.hold }));
    await user.type(screen.getByLabelText(mn.partners.credit.holdReason), 'Хугацаа хэтэрсэн');
    const card = within(limit.closest<HTMLElement>('form') ?? document.body);
    await user.click(card.getByRole('button', { name: mn.common.save }));

    expect(await screen.findByText(mn.common.saved)).toBeInTheDocument();
    expect(put).toEqual({
      creditLimit: '5000000',
      paymentTermDays: 45,
      creditHold: true,
      creditHoldReason: 'Хугацаа хэтэрсэн',
    });
    expect(screen.getByLabelText(mn.partners.credit.limit)).toHaveValue('5000000');
    expect(screen.getAllByText(mn.partners.credit.held).length).toBeGreaterThan(0);
  });

  it('adds an address with a pasted point and archives another after confirming', async () => {
    let added: unknown;
    const fetchMock = signedIn(OFFICE_ME, {
      'GET /api/v1/customers/9': () => json(CUSTOMER),
      'POST /api/v1/customers/9/addresses': async (request) => {
        added = await request.json();
        return json({ ...STORE, id: 52 }, 201);
      },
      'DELETE /api/v1/customer-addresses/51': () => new Response(null, { status: 204 }),
    });
    renderApp('/partners/customers/9', fetchMock);
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: mn.partners.addresses.add }));
    const dialog = within(await screen.findByRole('dialog'));
    await user.click(dialog.getByRole('button', { name: mn.common.save }));
    expect(await dialog.findByText(mn.validation.addressOrGps)).toBeInTheDocument();
    await user.type(dialog.getByLabelText(mn.partners.addresses.label), 'Салбар');
    await user.click(dialog.getByLabelText(mn.partners.addresses.gps));
    await user.paste('47.9, 106.95');
    await user.click(dialog.getByRole('checkbox', { name: mn.partners.addresses.makeDefault }));
    await user.click(dialog.getByRole('button', { name: mn.common.save }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(added).toEqual({
      label: 'Салбар',
      address: null,
      lat: '47.9',
      lng: '106.95',
      note: null,
      isDefault: true,
    });

    const store = within(screen.getByRole('region', { name: 'Агуулахын хаяг' }));
    await user.click(store.getByRole('button', { name: mn.partners.addresses.archive }));
    const confirm = within(await screen.findByRole('dialog'));
    expect(confirm.getByText(mn.partners.addresses.archiveConfirm)).toBeInTheDocument();
    await user.click(confirm.getByRole('button', { name: mn.partners.addresses.archive }));
    await waitFor(() =>
      expect(calls(fetchMock, 'DELETE', '/api/v1/customer-addresses/51')).toHaveLength(1),
    );
  });
});

describe('suppliers', () => {
  it('shows every supplier field in its own column, read-only to a warehouse worker', async () => {
    const { router } = renderApp(
      '/partners/suppliers',
      signedIn(WORKER_ME, {
        'GET /api/v1/suppliers': () =>
          list([
            supplierRow({
              id: 3,
              code: '010',
              name: 'МСМ ХХК',
              regNo: '7654321',
              tin: '12345678901',
              phone: '+97670112233',
              email: 'sales@msm.mn',
              address: 'ХУД, 3-р хороо',
              bankName: 'Хаан банк',
              bankAccount: 'MN120005005012345678',
              paymentTermDays: 15,
              note: 'Сар бүр',
              contact: { name: 'Сараа', phone: '+97699001122' },
              productCount: 12,
            }),
          ]),
      }),
    );
    const table = within(await screen.findByRole('table'));
    for (const text of [
      '7654321',
      '12345678901',
      '7011 2233',
      'sales@msm.mn',
      'ХУД, 3-р хороо',
      'Хаан банк',
      'MN120005005012345678',
      '15 хоног',
      'Сараа',
      '9900 1122',
      '12',
      'Сар бүр',
    ]) {
      expect(await table.findByText(text)).toBeInTheDocument();
    }
    for (const label of Object.values(mn.partners.suppliers.columns)) {
      expect(screen.getByRole('columnheader', { name: label })).toBeInTheDocument();
    }
    await userEvent.setup().click(screen.getByRole('link', { name: `${mn.common.view}: МСМ ХХК` }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/partners/suppliers/3'));
  });

  it('keeps suppliers read-only for a warehouse worker and lists their products', async () => {
    renderApp(
      '/partners/suppliers/3',
      signedIn(WORKER_ME, {
        'GET /api/v1/suppliers/3': () => json(MSM),
        'GET /api/v1/suppliers/3/products': () =>
          list([
            {
              linkId: 41,
              isMain: true,
              product: {
                id: 7,
                sku: '10023',
                name: 'Кока кола 0.5 л',
                status: 'ACTIVE',
                thumbUrl: null,
                baseUnitName: 'ш',
              },
            },
          ]),
      }),
    );
    expect(await screen.findByLabelText(mn.partners.supplier.name)).toBeDisabled();
    expect(screen.getByLabelText(mn.partners.supplier.bankAccount)).toHaveValue(
      'MN120005005012345678',
    );
    expect(screen.queryByRole('button', { name: mn.common.save })).toBeNull();
    expect(screen.queryByRole('button', { name: mn.partners.contacts.add })).toBeNull();
    expect(await screen.findByRole('link', { name: 'Кока кола 0.5 л' })).toHaveAttribute(
      'href',
      '/catalog/products/7',
    );
    expect(screen.getByText(mn.partners.supplier.main)).toBeInTheDocument();
  });

  it('shows a taken supplier name on its field', async () => {
    let posted: unknown;
    renderApp(
      '/partners/suppliers/new',
      signedIn(ADMIN_ME, {
        'GET /api/v1/suppliers/next-code': () => json({ code: '011' }),
        'POST /api/v1/suppliers': async (request) => {
          posted = await request.json();
          return problem('DUPLICATE_VALUE', 409, { constraint: 'suppliers_name_key_key' });
        },
      }),
    );
    const user = userEvent.setup();
    expect(await screen.findByLabelText(mn.partners.supplier.code)).toHaveValue('011');
    await user.type(screen.getByLabelText(mn.partners.supplier.name), 'мсм ххк');
    await user.type(screen.getByLabelText(mn.partners.supplier.bankAccount), 'mn12 0005');
    await user.type(screen.getByLabelText(mn.partners.supplier.paymentTerm), '400');
    await user.click(screen.getByRole('button', { name: mn.common.save }));
    expect(await screen.findByText(mn.validation.days)).toBeInTheDocument();
    expect(posted).toBeUndefined();

    await user.clear(screen.getByLabelText(mn.partners.supplier.paymentTerm));
    await user.type(screen.getByLabelText(mn.partners.supplier.paymentTerm), '30');
    await user.click(screen.getByRole('button', { name: mn.common.save }));
    expect(await screen.findByText(mn.validation.supplierNameTaken)).toBeInTheDocument();
    expect(posted).toEqual({
      name: 'мсм ххк',
      regNo: null,
      tin: null,
      phone: null,
      email: null,
      address: null,
      bankName: null,
      bankAccount: 'mn12 0005',
      paymentTermDays: 30,
      note: null,
    });
  });
});

describe('product suppliers card', () => {
  const UOMS: Schemas['Uom'][] = [
    { id: 1, code: 'PCS', name: 'ш', fractional: false, measureUnit: null },
  ];
  const PRODUCT: Schemas['ProductDetail'] = {
    id: 7,
    sku: '10023',
    name: 'Кока кола 0.5 л',
    categoryId: 12,
    brandId: null,
    vatType: 'VAT_ABLE',
    cityTax: null,
    classificationCode: null,
    taxProductCode: null,
    status: 'ACTIVE',
    tracksLots: false,
    weightKg: null,
    createdAt: STAMP,
    updatedAt: STAMP,
    units: [
      {
        id: 70,
        uomId: 1,
        uomName: 'ш',
        uomCode: 'PCS',
        fractional: false,
        factorToBase: '1',
        isBase: true,
        isDefaultSales: false,
        isDefaultPurchase: false,
        measureUnit: null,
        effectiveMeasureUnit: null,
        supersededBy: null,
        supersededAt: null,
        barcodes: [],
      },
    ],
    images: [],
  };
  const link = (
    id: number,
    supplier: Schemas['LinkedSupplier'],
    isMain: boolean,
  ): Schemas['ProductSupplierLink'] => ({ id, productId: 7, isMain, supplier });
  const productRoutes = {
    'GET /api/v1/uoms': () => list(UOMS),
    'GET /api/v1/categories': () =>
      list([
        {
          id: 12,
          parentId: null,
          name: 'Ундаа',
          defaultClassificationCode: null,
          productCount: 1,
          childCount: 0,
        },
      ]),
    'GET /api/v1/brands': () => list([]),
    'GET /api/v1/products/7': () => json(PRODUCT),
    'GET /api/v1/product-suppliers': () =>
      list([
        link(41, { id: 3, code: '010', name: 'МСМ ХХК', status: 'ACTIVE' }, true),
        link(42, { id: 4, code: '011', name: 'Номин Трейд', status: 'ACTIVE' }, false),
      ]),
  };

  it('links a supplier found by search and moves the main one', async () => {
    let linked: unknown;
    const fetchMock = signedIn(ADMIN_ME, {
      ...productRoutes,
      'GET /api/v1/suppliers': (request) => {
        const q = new URL(request.url).searchParams.get('q');
        const rows = [
          supplierRow({ id: 3, code: '010', name: 'МСМ ХХК' }),
          supplierRow({ id: 5, code: '012', name: 'Гурилын үйлдвэр' }),
        ];
        return list(q ? rows.filter((row) => row.name.startsWith('Гурил')) : rows);
      },
      'POST /api/v1/product-suppliers': async (request) => {
        linked = await request.json();
        return json(
          link(43, { id: 5, code: '012', name: 'Гурилын үйлдвэр', status: 'ACTIVE' }, false),
          201,
        );
      },
      'POST /api/v1/product-suppliers/42/main': () =>
        json(link(42, { id: 4, code: '011', name: 'Номин Трейд', status: 'ACTIVE' }, true)),
    });
    renderApp('/catalog/products/7', fetchMock);
    const user = userEvent.setup();
    expect(await screen.findByRole('link', { name: 'МСМ ХХК' })).toHaveAttribute(
      'href',
      '/partners/suppliers/3',
    );
    expect(screen.getByText(mn.partners.productSuppliers.main)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: mn.partners.productSuppliers.makeMain }));
    await waitFor(() =>
      expect(calls(fetchMock, 'POST', '/api/v1/product-suppliers/42/main')).toHaveLength(1),
    );

    await user.click(screen.getByRole('button', { name: mn.partners.productSuppliers.add }));
    const dialog = within(await screen.findByRole('dialog'));
    // An already linked supplier is not offered again.
    expect(await dialog.findByText('Гурилын үйлдвэр')).toBeInTheDocument();
    expect(dialog.queryByText('МСМ ХХК')).toBeNull();
    await user.type(
      dialog.getByRole('searchbox', { name: mn.partners.productSuppliers.search }),
      'гурил',
    );
    await user.click(
      dialog.getByRole('button', { name: `${mn.partners.productSuppliers.link}: Гурилын үйлдвэр` }),
    );
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(linked).toEqual({ productId: 7, supplierId: 5 });
  });

  it('shows the suppliers read-only to a warehouse worker', async () => {
    renderApp('/catalog/products/7', signedIn(WORKER_ME, productRoutes));
    expect(await screen.findByRole('link', { name: 'Номин Трейд' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: mn.partners.productSuppliers.add })).toBeNull();
    expect(
      screen.queryByRole('button', { name: mn.partners.productSuppliers.makeMain }),
    ).toBeNull();
  });
});
