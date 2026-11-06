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
  status: 'ACTIVE',
  current: version(40, '2026-10-01', null),
  scheduled: [],
  history: [],
  productsToday: 12,
  createdByName: 'Болд Бат',
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
  status: 'SCHEDULED',
  current: null,
  scheduled: [version(60, '2099-01-01', null)],
  productsToday: 0,
});
const OLD = profile({ ...FOOD, id: 7, name: 'Хуучин', status: 'ARCHIVED', archivedAt: STAMP });

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
  it("shows each profile's values today, its products and who made it, and filters", async () => {
    const fetchMock = signedIn(WORKER_ME, {
      'GET /api/v1/price-profiles': (request) =>
        new URL(request.url).searchParams.get('status') === 'ARCHIVED'
          ? list([OLD])
          : list([DRINKS, FOOD, LATER]),
    });
    const { router } = renderApp('/pricing/profiles', fetchMock);
    const user = userEvent.setup();
    const drinks = await rowOf('Жишээ: Ундаа');
    expect(drinks.getByRole('link', { name: '12' })).toHaveAttribute(
      'href',
      '/catalog/products?profile=4',
    );
    expect(drinks.getByRole('link', { name: '12' })).toHaveAttribute('target', '_blank');
    for (const text of [
      'Задгай +15%',
      'Супермаркет +30%',
      'Супермаркет бөөний (24+) +20%',
      mn.pricing.roundings.UP_50,
      '12',
      'Болд Бат',
      mn.pricing.profiles.statuses.ACTIVE,
    ]) {
      expect(drinks.getByText(text)).toBeInTheDocument();
    }
    const food = await rowOf('Хүнс');
    expect(food.getByText(mn.pricing.roundings.WHOLE)).toBeInTheDocument();
    expect(food.queryByText(/бөөний/)).toBeNull();
    // A profile whose first values start later shows them with their day.
    const later = await rowOf('Шинэ улирал');
    expect(later.getByText('2099-01-01-с')).toBeInTheDocument();
    expect(later.getByText(mn.pricing.profiles.statuses.SCHEDULED)).toBeInTheDocument();
    // A reader gets no way to change them.
    expect(screen.queryByRole('link', { name: mn.pricing.profiles.new })).toBeNull();
    expect(drinks.queryByRole('button', { name: mn.pricing.profiles.delete })).toBeNull();

    const panel = within(
      await screen.findByRole('complementary', { name: mn.pricing.profiles.panel.label }),
    );
    await user.click(panel.getByRole('button', { name: mn.pricing.profiles.statuses.ARCHIVED }));
    expect(await screen.findByRole('link', { name: 'Хуучин' })).toBeInTheDocument();
    expect(router.state.location.search).toBe('?status=ARCHIVED');
    await user.click(panel.getByRole('button', { name: mn.pricing.roundings.WHOLE }));
    await waitFor(() => {
      const last = calls(fetchMock, 'GET', '/api/v1/price-profiles').at(-1);
      const query = new URL(last?.url ?? '').searchParams;
      expect(query.get('status')).toBe('ARCHIVED');
      expect(query.get('rounding')).toBe('WHOLE');
    });
  });

  it('archives, restores and deletes from the row, saying why one in use stays', async () => {
    const fetchMock = signedIn(ADMIN_ME, {
      'GET /api/v1/price-profiles': () => list([DRINKS, OLD]),
      'POST /api/v1/price-profiles/4/archive': () =>
        problem('PRICE_PROFILE_IN_USE', 409, { count: 12 }),
      'POST /api/v1/price-profiles/7/restore': () => json({ ...OLD, status: 'ACTIVE' }),
      'DELETE /api/v1/price-profiles/7': () => new Response(null, { status: 204 }),
    });
    const { router } = renderApp('/pricing/profiles', fetchMock);
    const user = userEvent.setup();
    const drinks = await rowOf('Жишээ: Ундаа');
    await user.click(drinks.getByRole('button', { name: mn.pricing.profiles.archive }));
    const refused = within(await screen.findByRole('dialog'));
    await user.click(refused.getByRole('button', { name: mn.pricing.profiles.archive }));
    expect(
      await refused.findByText(mn.errors.PRICE_PROFILE_IN_USE.replace('{{count}}', '12')),
    ).toBeInTheDocument();
    await user.click(refused.getByRole('button', { name: mn.common.cancel }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());

    const old = await rowOf('Хуучин');
    // An archived profile is brought back before it is changed.
    expect(old.queryByRole('button', { name: mn.common.edit })).toBeNull();
    await user.click(old.getByRole('button', { name: mn.pricing.profiles.restore }));
    const restoring = within(await screen.findByRole('dialog'));
    await user.click(restoring.getByRole('button', { name: mn.pricing.profiles.restore }));
    await waitFor(() =>
      expect(calls(fetchMock, 'POST', '/api/v1/price-profiles/7/restore')).toHaveLength(1),
    );
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    await user.click(
      (await rowOf('Хуучин')).getByRole('button', { name: mn.pricing.profiles.delete }),
    );
    const deleting = within(await screen.findByRole('dialog'));
    await user.click(deleting.getByRole('button', { name: mn.pricing.profiles.delete }));
    await waitFor(() =>
      expect(calls(fetchMock, 'DELETE', '/api/v1/price-profiles/7')).toHaveLength(1),
    );

    await user.click((await rowOf('Жишээ: Ундаа')).getByRole('button', { name: mn.common.edit }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/pricing/profiles/4/edit'));
  });

  it('creates a profile on its page: checks the values, works out the example and opens it', async () => {
    const fetchMock = signedIn(ADMIN_ME, {
      'GET /api/v1/price-profiles': () => list([]),
      'POST /api/v1/price-profiles': () => json(DRINKS, 201),
      'GET /api/v1/price-profiles/4': () => json(DRINKS),
    });
    const { router } = renderApp('/pricing/profiles', fetchMock);
    const user = userEvent.setup();
    expect(await screen.findByText(mn.pricing.profiles.empty)).toBeInTheDocument();
    await user.click(screen.getByRole('link', { name: mn.pricing.profiles.new }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/pricing/profiles/new'));
    await user.click(await screen.findByRole('button', { name: mn.common.save }));
    expect(await screen.findByText(mn.validation.required)).toBeInTheDocument();
    // Loose pieces start at no markup; only the supermarket's is still to be written.
    expect(screen.getAllByText(mn.validation.markup)).toHaveLength(1);
    expect(screen.getByLabelText(mn.pricing.profiles.fields.loose)).toHaveValue('0');
    expect(
      screen.getByRole('heading', { name: mn.pricing.profiles.sectionSales }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('heading', { name: mn.pricing.profiles.sectionRetail }),
    ).toBeInTheDocument();

    // Pasted, not typed key by key: the flow stays well inside its time under a full parallel run.
    await user.click(screen.getByLabelText(mn.pricing.profiles.fields.name));
    await user.paste('Жишээ: Ундаа');
    const loose = screen.getByLabelText(mn.pricing.profiles.fields.loose);
    await user.clear(loose);
    await user.type(loose, '15');
    await user.type(screen.getByLabelText(mn.pricing.profiles.fields.retail), '30');
    await user.click(screen.getByRole('switch', { name: mn.pricing.profiles.fields.bulk }));
    // The example keeps its rows while the bulk price is still being typed.
    const typing = within(screen.getByRole('region', { name: 'Жишээ: агуулахын үнэ 1,000₮' }));
    expect(typing.getByText('1,150₮')).toBeInTheDocument();
    expect(typing.queryByText('Супермаркет бөөний (24+)')).toBeNull();
    await user.type(screen.getByLabelText(mn.pricing.profiles.fields.bulkQty), '24');
    const bulkPct = screen.getByLabelText(mn.pricing.profiles.fields.bulkPct);
    await user.type(bulkPct, '35');
    await user.selectOptions(screen.getByLabelText(mn.pricing.profiles.fields.rounding), 'UP_50');
    await user.click(screen.getByRole('button', { name: mn.common.save }));
    expect(await screen.findByText(mn.validation.bulkBelowRetail)).toBeInTheDocument();
    expect(calls(fetchMock, 'POST', '/api/v1/price-profiles')).toHaveLength(0);

    // 1,000₮: loose 1,150₮, supermarket 1,300₮, from 24 pieces 1,200₮.
    await user.clear(bulkPct);
    await user.type(bulkPct, '20');
    const example = within(screen.getByRole('region', { name: 'Жишээ: агуулахын үнэ 1,000₮' }));
    for (const text of ['1,000₮', '1,150₮', '1,300₮', '1,200₮']) {
      expect(example.getByText(text)).toBeInTheDocument();
    }
    await user.click(screen.getByRole('button', { name: mn.common.save }));

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
    // The profile's page is loaded on first use; under a full `pnpm check` that can take seconds.
    expect(
      await screen.findByRole('heading', { name: 'Жишээ: Ундаа' }, { timeout: 10_000 }),
    ).toBeInTheDocument();
  }, 25_000);
});

describe('price profile page', () => {
  it("works out today's values on an example and edits its name and values from a day", async () => {
    const planned = profile({
      scheduled: [version(41, '2099-01-01', null, { looseMarkupPct: '17.00' })],
      history: [version(39, '2026-09-01', '2026-10-01', { looseMarkupPct: '12.00' })],
    });
    const fetchMock = signedIn(ADMIN_ME, {
      'GET /api/v1/price-profiles/4': () => json(planned),
      'PUT /api/v1/price-profiles/4': () => json(planned),
    });
    const { router } = renderApp('/pricing/profiles/4', fetchMock);
    const user = userEvent.setup();
    expect(await screen.findByRole('heading', { name: 'Жишээ: Ундаа' })).toBeInTheDocument();
    expect(screen.getByText('Өнөөдөр 12 бараа')).toBeInTheDocument();
    const current = within(screen.getByRole('region', { name: mn.pricing.profiles.current }));
    // Its products in the list, in a new tab, with the filter on.
    const products = current.getByRole('link', {
      name: mn.pricing.profiles.viewProducts.replace('{{count}}', '12'),
    });
    expect(products).toHaveAttribute('href', '/catalog/products?profile=4');
    expect(products).toHaveAttribute('target', '_blank');
    expect(current.getByText(mn.pricing.profiles.sectionSales)).toBeInTheDocument();
    expect(current.getByText(mn.pricing.profiles.sectionRetail)).toBeInTheDocument();
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

    await user.click(screen.getByRole('link', { name: mn.common.edit }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/pricing/profiles/4/edit'));
    // The new values start from the latest planned ones, today.
    const name = await screen.findByLabelText(mn.pricing.profiles.fields.name);
    expect(name).toHaveValue('Жишээ: Ундаа');
    expect(screen.getByLabelText(mn.pricing.profiles.fields.loose)).toHaveValue('17');
    expect(screen.getByRole('switch', { name: mn.pricing.profiles.fields.bulk })).toBeChecked();
    expect(screen.getByLabelText(mn.pricing.profiles.fields.validFrom)).toHaveValue(TODAY);
    await user.clear(name);
    await user.type(name, 'Ундаа, ус');
    const retail = screen.getByLabelText(mn.pricing.profiles.fields.retail);
    await user.clear(retail);
    await user.type(retail, '32.5');
    await user.click(screen.getByRole('button', { name: mn.common.save }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/pricing/profiles/4'));
    const [put] = calls(fetchMock, 'PUT', '/api/v1/price-profiles/4');
    expect(await put?.clone().json()).toEqual({
      name: 'Ундаа, ус',
      looseMarkupPct: '17',
      retailMarkupPct: '32.5',
      retailBulkMinQty: '24',
      retailBulkMarkupPct: '20',
      rounding: 'UP_50',
      validFrom: TODAY,
    });
    expect(await screen.findByRole('status')).toHaveTextContent(mn.pricing.profiles.saved);
  });

  it('explains why a profile in use cannot be archived', async () => {
    const fetchMock = signedIn(ADMIN_ME, {
      'GET /api/v1/price-profiles/4': () => json(DRINKS),
      'POST /api/v1/price-profiles/4/archive': () =>
        problem('PRICE_PROFILE_IN_USE', 409, { count: 12 }),
    });
    renderApp('/pricing/profiles/4', fetchMock);
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: mn.pricing.profiles.archive }));
    const dialog = within(await screen.findByRole('dialog'));
    await user.click(dialog.getByRole('button', { name: mn.pricing.profiles.archive }));
    expect(
      await dialog.findByText(mn.errors.PRICE_PROFILE_IN_USE.replace('{{count}}', '12')),
    ).toBeInTheDocument();
    expect(calls(fetchMock, 'POST', '/api/v1/price-profiles/4/archive')).toHaveLength(1);
  });

  it('leaves a profile unchanged for other users', async () => {
    renderApp(
      '/pricing/profiles/4',
      signedIn(WORKER_ME, { 'GET /api/v1/price-profiles/4': () => json(DRINKS) }),
    );
    expect(await screen.findByRole('heading', { name: 'Жишээ: Ундаа' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: mn.common.edit })).toBeNull();
    for (const name of [mn.pricing.profiles.archive, mn.pricing.profiles.delete]) {
      expect(screen.queryByRole('button', { name })).toBeNull();
    }
  });

  it('shows an archived profile as archived: restore or delete, no edit', async () => {
    const fetchMock = signedIn(ADMIN_ME, {
      'GET /api/v1/price-profiles/4': () =>
        json({ ...DRINKS, status: 'ARCHIVED', archivedAt: STAMP }),
      'POST /api/v1/price-profiles/4/restore': () => json(DRINKS),
    });
    renderApp('/pricing/profiles/4', fetchMock);
    const user = userEvent.setup();
    expect(await screen.findByText(mn.pricing.profiles.statuses.ARCHIVED)).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: mn.common.edit })).toBeNull();
    await user.click(screen.getByRole('button', { name: mn.pricing.profiles.restore }));
    const dialog = within(await screen.findByRole('dialog'));
    await user.click(dialog.getByRole('button', { name: mn.pricing.profiles.restore }));
    await waitFor(() =>
      expect(calls(fetchMock, 'POST', '/api/v1/price-profiles/4/restore')).toHaveLength(1),
    );
  });
});
