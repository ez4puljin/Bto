import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { components } from '@tugeel/api-client';
import mn from '@tugeel/shared/i18n/mn.json';
import { businessDate } from '@tugeel/shared/time';
import { describe, expect, it } from 'vitest';
import {
  ADMIN_ME,
  findSidebar,
  json,
  problem,
  renderApp,
  signedIn,
  WORKER_ME,
} from '@/test/render-app';

type Schemas = components['schemas'];
const STAMP = '2026-10-13T02:00:00.000Z';
const TODAY = businessDate();
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const list = <T,>(data: T[], nextCursor: string | null = null) => json({ data, nextCursor });

const version = (
  id: number,
  validFrom: string,
  validTo: string | null,
  fields: Partial<Schemas['PriceProfileVersion']> = {},
): Schemas['PriceProfileVersion'] => ({
  id,
  validFrom,
  validTo,
  looseMarkupPct: '15.00',
  retailMarkupPct: '30.00',
  retailBulkMinQty: '24',
  retailBulkMarkupPct: '20.00',
  rounding: 'UP_50',
  ...fields,
});
const profile = (fields: Partial<Schemas['PriceProfile']> = {}): Schemas['PriceProfile'] => ({
  id: 4,
  name: 'Жишээ: Ундаа',
  archivedAt: null,
  current: version(40, '2026-10-01', null),
  scheduled: [],
  history: [],
  productsToday: 12,
  createdAt: STAMP,
  updatedAt: STAMP,
  ...fields,
});
const DRINKS = profile();
const FOOD = profile({
  id: 5,
  name: 'Хүнс',
  current: version(50, '2026-10-01', null, {
    looseMarkupPct: '10.00',
    retailMarkupPct: '20.00',
    retailBulkMinQty: null,
    retailBulkMarkupPct: null,
    rounding: 'WHOLE',
  }),
  productsToday: 0,
});
const LATER = profile({
  id: 6,
  name: 'Шинэ улирал',
  current: null,
  scheduled: [version(60, '2099-01-01', null)],
  productsToday: 0,
});

const calls = (fetchMock: ReturnType<typeof signedIn>, method: string, path: string) =>
  fetchMock.mock.calls
    .map(([request]) => request)
    .filter((request) => request.method === method && new URL(request.url).pathname === path);
const rowOf = async (name: string) => {
  const row = (await screen.findByRole('link', { name })).closest('tr');
  if (!row) throw new Error(`no row: ${name}`);
  return within(row);
};

describe('price profiles menu', () => {
  it('opens the pricing group with the profiles, then the discounts and the calculator', async () => {
    renderApp('/system/status', signedIn(WORKER_ME));
    const links = within(await findSidebar())
      .getAllByRole('link')
      .map((link) => link.textContent);
    const at = links.indexOf(mn.nav.priceProfiles);
    expect(links.slice(at, at + 3)).toEqual([
      mn.nav.priceProfiles,
      mn.nav.discounts,
      mn.nav.priceQuote,
    ]);
  });
});

describe('price profiles list', () => {
  it("shows each profile's values today and its products, and the archived ones apart", async () => {
    const fetchMock = signedIn(WORKER_ME, {
      'GET /api/v1/price-profiles': (request) =>
        new URL(request.url).searchParams.get('archived') === 'true'
          ? list([{ ...FOOD, id: 7, name: 'Хуучин', archivedAt: STAMP }])
          : list([DRINKS, FOOD, LATER]),
    });
    const { router } = renderApp('/pricing/profiles', fetchMock);
    const user = userEvent.setup();
    const drinks = await rowOf('Жишээ: Ундаа');
    for (const text of ['+15%', '+30%', '+20% (24+)', mn.pricing.roundings.UP_50, '12']) {
      expect(drinks.getByText(text)).toBeInTheDocument();
    }
    const food = await rowOf('Хүнс');
    expect(food.getByText(mn.pricing.roundings.WHOLE)).toBeInTheDocument();
    expect(food.getByText(mn.common.none)).toBeInTheDocument();
    // A profile whose first values start later shows them with their day.
    expect((await rowOf('Шинэ улирал')).getByText('2099-01-01-с')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: mn.pricing.profiles.new })).toBeNull();

    await user.click(screen.getByRole('tab', { name: mn.pricing.profiles.filters.ARCHIVED }));
    expect(await screen.findByRole('link', { name: 'Хуучин' })).toBeInTheDocument();
    expect(router.state.location.search).toBe('?archived=1');
    expect(
      calls(fetchMock, 'GET', '/api/v1/price-profiles').map((request) =>
        new URL(request.url).searchParams.get('archived'),
      ),
    ).toEqual(['false', 'true']);
  });

  it('creates a profile: checks the values, works out the example and opens it', async () => {
    const fetchMock = signedIn(ADMIN_ME, {
      'GET /api/v1/price-profiles': () => list([]),
      'POST /api/v1/price-profiles': () => json(DRINKS, 201),
      'GET /api/v1/price-profiles/4': () => json(DRINKS),
    });
    const { router } = renderApp('/pricing/profiles', fetchMock);
    const user = userEvent.setup();
    expect(await screen.findByText(mn.pricing.profiles.empty)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: mn.pricing.profiles.new }));
    expect(router.state.location.search).toBe('?new=1');
    const dialog = within(await screen.findByRole('dialog'));
    await user.click(dialog.getByRole('button', { name: mn.common.save }));
    expect(await dialog.findByText(mn.validation.required)).toBeInTheDocument();
    expect(dialog.getAllByText(mn.validation.markup)).toHaveLength(2);

    await user.type(dialog.getByLabelText(mn.pricing.profiles.fields.name), 'Жишээ: Ундаа');
    await user.type(dialog.getByLabelText(mn.pricing.profiles.fields.loose), '15');
    await user.type(dialog.getByLabelText(mn.pricing.profiles.fields.retail), '30');
    await user.click(dialog.getByRole('switch', { name: mn.pricing.profiles.fields.bulk }));
    // The example keeps its rows while the bulk price is still being typed.
    const typing = within(dialog.getByRole('region', { name: 'Жишээ: агуулахын үнэ 1,000₮' }));
    expect(typing.getByText('1,150₮')).toBeInTheDocument();
    expect(typing.queryByText('Супермаркет бөөний (24+)')).toBeNull();
    await user.type(dialog.getByLabelText(mn.pricing.profiles.fields.bulkQty), '24');
    const bulkPct = dialog.getByLabelText(mn.pricing.profiles.fields.bulkPct);
    await user.type(bulkPct, '35');
    await user.selectOptions(dialog.getByLabelText(mn.pricing.profiles.fields.rounding), 'UP_50');
    await user.click(dialog.getByRole('button', { name: mn.common.save }));
    expect(await dialog.findByText(mn.validation.bulkBelowRetail)).toBeInTheDocument();
    expect(calls(fetchMock, 'POST', '/api/v1/price-profiles')).toHaveLength(0);

    // 1,000₮: loose 1,150₮, supermarket 1,300₮, from 24 pieces 1,200₮.
    await user.clear(bulkPct);
    await user.type(bulkPct, '20');
    const example = within(dialog.getByRole('region', { name: 'Жишээ: агуулахын үнэ 1,000₮' }));
    for (const text of ['1,000₮', '1,150₮', '1,300₮', '1,200₮']) {
      expect(example.getByText(text)).toBeInTheDocument();
    }
    await user.click(dialog.getByRole('button', { name: mn.common.save }));

    await waitFor(() => expect(router.state.location.pathname).toBe('/pricing/profiles/4'));
    const [posted] = calls(fetchMock, 'POST', '/api/v1/price-profiles');
    expect(await posted?.clone().json()).toEqual({
      name: 'Жишээ: Ундаа',
      looseMarkupPct: '15',
      retailMarkupPct: '30',
      retailBulkMinQty: '24',
      retailBulkMarkupPct: '20',
      rounding: 'UP_50',
      validFrom: TODAY,
    });
    expect(posted?.headers.get('Idempotency-Key')).toMatch(UUID);
    expect(await screen.findByRole('heading', { name: 'Жишээ: Ундаа' })).toBeInTheDocument();
  });
});

describe('price profile page', () => {
  it("works out today's values on an example and plans new values from a day", async () => {
    const planned = profile({
      scheduled: [version(41, '2099-01-01', null, { looseMarkupPct: '17.00' })],
      history: [version(39, '2026-09-01', '2026-10-01', { looseMarkupPct: '12.00' })],
    });
    const fetchMock = signedIn(ADMIN_ME, {
      'GET /api/v1/price-profiles/4': () => json(planned),
      'POST /api/v1/price-profiles/4/versions': () => json(planned),
    });
    renderApp('/pricing/profiles/4', fetchMock);
    const user = userEvent.setup();
    expect(await screen.findByRole('heading', { name: 'Жишээ: Ундаа' })).toBeInTheDocument();
    expect(screen.getByText('Өнөөдөр 12 бараа')).toBeInTheDocument();
    const current = within(screen.getByRole('region', { name: mn.pricing.profiles.current }));
    for (const text of ['+15%', '1,150₮', '+30%', '1,300₮', '+20%', '1,200₮']) {
      expect(current.getByText(text)).toBeInTheDocument();
    }
    const versions = within(screen.getByRole('region', { name: mn.pricing.profiles.versions }));
    expect(
      versions
        .getAllByRole('row')
        .slice(1)
        .map((row) => within(row).getAllByRole('cell')[2]?.textContent),
    ).toEqual([
      mn.pricing.profiles.status.SCHEDULED,
      mn.pricing.profiles.status.CURRENT,
      mn.pricing.profiles.status.PAST,
    ]);
    expect(versions.getByText('2099-01-01-с')).toBeInTheDocument();
    // Each price on its own line, no «·» left at a line's end.
    const [scheduledRow] = versions.getAllByRole('row').slice(1);
    expect(
      within(scheduledRow!).getByText(mn.pricing.profiles.summary.loose.replace('{{pct}}', '17')),
    ).toBeInTheDocument();
    expect(versions.getByText('2026-09-01 – 2026-09-30')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: mn.pricing.profiles.setValues }));
    const dialog = within(await screen.findByRole('dialog'));
    // The new values start from the latest planned ones, today.
    expect(dialog.getByLabelText(mn.pricing.profiles.fields.loose)).toHaveValue('17');
    expect(dialog.getByRole('switch', { name: mn.pricing.profiles.fields.bulk })).toBeChecked();
    expect(dialog.getByLabelText(mn.pricing.profiles.fields.validFrom)).toHaveValue(TODAY);
    const retail = dialog.getByLabelText(mn.pricing.profiles.fields.retail);
    await user.clear(retail);
    await user.type(retail, '32.5');
    await user.click(dialog.getByRole('button', { name: mn.common.save }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    const [posted] = calls(fetchMock, 'POST', '/api/v1/price-profiles/4/versions');
    expect(await posted?.clone().json()).toEqual({
      looseMarkupPct: '17',
      retailMarkupPct: '32.5',
      retailBulkMinQty: '24',
      retailBulkMarkupPct: '20',
      rounding: 'UP_50',
      validFrom: TODAY,
    });
    expect(posted?.headers.get('Idempotency-Key')).toMatch(UUID);
    expect(await screen.findByRole('status')).toHaveTextContent(mn.pricing.profiles.saved);
  });

  it('renames the profile and explains why it cannot be archived while in use', async () => {
    const fetchMock = signedIn(ADMIN_ME, {
      'GET /api/v1/price-profiles/4': () => json(DRINKS),
      'PATCH /api/v1/price-profiles/4': () => json({ ...DRINKS, name: 'Ундаа, ус' }),
      'POST /api/v1/price-profiles/4/archive': () =>
        problem('PRICE_PROFILE_IN_USE', 409, { count: 12 }),
    });
    renderApp('/pricing/profiles/4', fetchMock);
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: mn.pricing.profiles.rename }));
    let dialog = within(await screen.findByRole('dialog'));
    const name = dialog.getByLabelText(mn.pricing.profiles.fields.name);
    await user.clear(name);
    await user.type(name, 'Ундаа, ус');
    await user.click(dialog.getByRole('button', { name: mn.common.save }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    const [renamed] = calls(fetchMock, 'PATCH', '/api/v1/price-profiles/4');
    expect(await renamed?.clone().json()).toEqual({ name: 'Ундаа, ус' });

    await user.click(screen.getByRole('button', { name: mn.pricing.profiles.archive }));
    dialog = within(await screen.findByRole('dialog'));
    await user.click(dialog.getByRole('button', { name: mn.pricing.profiles.archive }));
    expect(
      await dialog.findByText(mn.errors.PRICE_PROFILE_IN_USE.replace('{{count}}', '12')),
    ).toBeInTheDocument();
    expect(calls(fetchMock, 'POST', '/api/v1/price-profiles/4/archive')).toHaveLength(1);
  });

  it('leaves a profile unchanged for other users and once it is archived', async () => {
    renderApp(
      '/pricing/profiles/4',
      signedIn(WORKER_ME, { 'GET /api/v1/price-profiles/4': () => json(DRINKS) }),
    );
    expect(await screen.findByRole('heading', { name: 'Жишээ: Ундаа' })).toBeInTheDocument();
    for (const name of [
      mn.pricing.profiles.setValues,
      mn.pricing.profiles.rename,
      mn.pricing.profiles.archive,
    ]) {
      expect(screen.queryByRole('button', { name })).toBeNull();
    }
  });

  it('shows an archived profile as archived, without actions', async () => {
    renderApp(
      '/pricing/profiles/4',
      signedIn(ADMIN_ME, {
        'GET /api/v1/price-profiles/4': () => json({ ...DRINKS, archivedAt: STAMP }),
      }),
    );
    expect(await screen.findByText(mn.pricing.profiles.archived)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: mn.pricing.profiles.setValues })).toBeNull();
  });
});
