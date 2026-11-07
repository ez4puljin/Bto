import { focusManager } from '@tanstack/react-query';
import { act, cleanup, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { components } from '@tugeel/api-client';
import mn from '@tugeel/shared/i18n/mn.json';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { bodyOf, calls, COLA_BOX, UUID } from '@/test/inventory-fixtures';
import { ADMIN_ME, json, problem, renderApp, signedIn, WORKER_ME } from '@/test/render-app';
import { wedgeScan } from '@/test/scan';

type Item = components['schemas']['ExpiryItemDto'];

const PAGE = '/inventory/expiry';
const today = '2026-11-07';

const ITEM: Item = {
  id: 1,
  product: { id: 10, sku: '10', name: 'Туршилтын сүү', baseUomName: 'ш', thumbUrl: null },
  supplier: { id: 5, name: 'Альфа ХХК' },
  homeWarehouse: { id: 3, name: 'Төв агуулах' },
  expiryDate: '2026-11-04',
  daysLeft: -3,
  urgency: 'EXPIRED',
  qtyFloor: '12',
  qtyWarehouse: '3',
  qtyTotal: '15',
  status: 'REVIEW',
  liability: { type: 'NONE', roles: [], users: [], note: null },
  note: 'Лангуун дээр',
  editVersion: 1,
  createdAt: '2026-11-01T02:00:00.000Z',
  createdByName: 'Болд',
  updatedAt: '2026-11-01T02:00:00.000Z',
  archivedAt: null,
  archivedByName: null,
};

const SECOND: Item = {
  ...ITEM,
  id: 2,
  product: { id: 11, sku: '11', name: 'Туршилтын тос', baseUomName: 'ш', thumbUrl: null },
  expiryDate: '2026-12-20',
  daysLeft: 43,
  urgency: 'OK',
  note: null,
};

const SUMMARY: components['schemas']['ExpirySummaryDto'] = {
  today,
  soonDays: 30,
  urgentDays: 7,
  active: 321,
  expired: 4,
  urgent: 2,
  soon: 17,
  archived: 88,
  byStatus: { REVIEW: 300, CITY_RETURN: 20, INTERNAL_SALE: 1 },
};

const FILTERS: components['schemas']['ExpiryFiltersDto'] = {
  suppliers: [{ id: 5, name: 'Альфа ХХК' }],
  warehouses: [{ id: 3, name: 'Төв агуулах' }],
  creators: ['Болд'],
};

const page = (data: Item[], nextCursor: string | null = null) => json({ data, nextCursor });

const ROUTES = {
  'GET /api/v1/expiry/summary': () => json(SUMMARY),
  'GET /api/v1/expiry/filters': () => json(FILTERS),
  'GET /api/v1/expiry/items': () => page([ITEM, SECOND]),
  'GET /api/v1/expiry/items/1': () => json(ITEM),
  'GET /api/v1/expiry/items/1/history': () =>
    json({
      data: [
        {
          id: 1,
          kind: 'CREATE',
          qtyFloorOld: '0',
          qtyFloorNew: '10',
          qtyWarehouseOld: '0',
          qtyWarehouseNew: '3',
          changedAt: '2026-11-01T02:00:00.000Z',
          changedByName: 'Болд',
        },
        {
          id: 2,
          kind: 'UPDATE',
          qtyFloorOld: '10',
          qtyFloorNew: '12',
          qtyWarehouseOld: '3',
          qtyWarehouseNew: '3',
          changedAt: '2026-11-02T02:00:00.000Z',
          changedByName: 'Дорж',
        },
      ],
    }),
};

const queryOf = (request: Request) => new URL(request.url).searchParams;

/** The new-record dialog with a product scanned into it. */
async function scannedDialog(fetchMock: ReturnType<typeof signedIn>) {
  const rendered = renderApp(`${PAGE}?new=1`, fetchMock);
  const dialog = within(await screen.findByRole('dialog'));
  await waitFor(() => expect(dialog.getByLabelText(mn.scan.label)).toHaveFocus());
  await wedgeScan(COLA_BOX.barcode.code);
  await dialog.findByText(COLA_BOX.product.name);
  return { dialog, ...rendered };
}

async function fillRecord(
  dialog: ReturnType<typeof within>,
  user: ReturnType<typeof userEvent.setup>,
) {
  await user.type(dialog.getByLabelText(mn.expiry.columns.expiryDate), '2026-12-01');
  await user.type(dialog.getByLabelText(mn.expiry.columns.qtyFloor), '6');
}

describe('ExpiryPage', () => {
  beforeEach(() => sessionStorage.clear());
  afterEach(() => vi.restoreAllMocks());

  it('lists the records with the four counts, each count setting the view', async () => {
    const fetchMock = signedIn(ADMIN_ME, ROUTES);
    renderApp(PAGE, fetchMock);
    const user = userEvent.setup();
    const row = (await screen.findByRole('link', { name: 'Туршилтын сүү' })).closest(
      'tr',
    ) as HTMLElement;
    expect(within(row).getByText('10')).toBeInTheDocument();
    expect(within(row).getByText('2026-11-04')).toBeInTheDocument();
    expect(within(row).getByText('3 хоног өнгөрсөн')).toHaveClass('text-destructive');
    expect(within(row).getByText(mn.expiry.status.REVIEW)).toBeInTheDocument();
    expect(row).toHaveClass('bg-danger-soft/50');

    // The old page's four cards and its count line.
    expect(
      await screen.findByRole('button', { name: `${mn.expiry.tiles.active}: 321` }),
    ).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: `${mn.expiry.tiles.soon}: 17` })).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: `${mn.expiry.tiles.archived}: 88` }),
    ).toBeInTheDocument();
    expect(screen.getByText('321 бараа')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: `${mn.expiry.tiles.expired}: 4` }));
    await waitFor(() =>
      expect(queryOf(calls(fetchMock, 'GET', '/api/v1/expiry/items').at(-1)!).get('view')).toBe(
        'EXPIRED',
      ),
    );
    expect(await screen.findByText('4 бараа')).toBeInTheDocument();
  });

  it('sends a filter click and the typed search to the server, and keeps them for the print', async () => {
    const fetchMock = signedIn(ADMIN_ME, ROUTES);
    const { router } = renderApp(PAGE, fetchMock);
    const user = userEvent.setup();
    const panel = within(
      await screen.findByRole('complementary', { name: mn.expiry.filters.label }),
    );
    await user.click(panel.getByRole('button', { name: mn.expiry.views.URGENT }));
    await user.click(await panel.findByRole('button', { name: 'Альфа ХХК' }));
    await waitFor(() => {
      const query = queryOf(calls(fetchMock, 'GET', '/api/v1/expiry/items').at(-1)!);
      expect(query.get('view')).toBe('URGENT');
      expect(query.get('supplierId')).toBe('5');
    });
    expect(router.state.location.search).toContain('view=URGENT');
    expect(router.state.location.search).toContain('supplier=5');

    await user.type(screen.getByRole('searchbox', { name: mn.common.search }), 'сүү');
    await waitFor(() =>
      expect(queryOf(calls(fetchMock, 'GET', '/api/v1/expiry/items').at(-1)!).get('q')).toBe('сүү'),
    );
    const print = screen.getByRole('link', { name: mn.expiry.print });
    expect(print).toHaveAttribute('target', '_blank');
    expect(print.getAttribute('href')).toContain('/inventory/expiry/print?');
    expect(print.getAttribute('href')).toContain('view=URGENT');
    expect(print.getAttribute('href')).toContain('supplier=5');
  });

  it('opens a row’s record in the panel, with its history as a timeline', async () => {
    const fetchMock = signedIn(ADMIN_ME, ROUTES);
    const { router } = renderApp(PAGE, fetchMock);
    const user = userEvent.setup();
    await user.click(await screen.findByText('2026-11-04'));
    const panel = within(await screen.findByRole('dialog'));
    expect(router.state.location.search).toBe('?item=1');
    expect(await panel.findByText(mn.expiry.history.created, { exact: false })).toBeInTheDocument();
    expect(panel.getByText('Альфа ХХК')).toBeInTheDocument();
    const before = await panel.findByText('10', { selector: 's' });
    expect(before).toBeInTheDocument();
    expect(panel.getByText('12', { selector: 'b' })).toBeInTheDocument();
  });

  describe('creating', () => {
    it('posts with an Idempotency-Key, and a new key after «Хадгалаад шинэ»', async () => {
      const created: Item = { ...ITEM, id: 9, product: { ...ITEM.product, name: 'Кока кола' } };
      const fetchMock = signedIn(ADMIN_ME, {
        ...ROUTES,
        [`GET /api/v1/barcodes/${COLA_BOX.barcode.code}`]: () => json(COLA_BOX),
        'POST /api/v1/expiry/items': () => json(created, 201),
      });
      const { dialog } = await scannedDialog(fetchMock);
      const user = userEvent.setup();
      // A product's open records come first.
      expect(await dialog.findByText(mn.expiry.new.openTitle)).toBeInTheDocument();
      const open = await dialog.findByRole('link', { name: /2026-11-04/ });
      expect(open).toHaveAttribute('href', expect.stringContaining('item=1'));
      expect(open.getAttribute('href')).not.toContain('new=');
      expect(
        queryOf(calls(fetchMock, 'GET', '/api/v1/expiry/items').at(-1)!).get('productId'),
      ).toBe('10');

      await fillRecord(dialog, user);
      // The days as they are typed, against the server's today.
      expect(dialog.getByText('24 хоног үлдсэн')).toBeInTheDocument();
      await user.click(dialog.getByRole('button', { name: mn.common.saveAndNew }));

      await waitFor(() => expect(calls(fetchMock, 'POST', '/api/v1/expiry/items')).toHaveLength(1));
      const [post] = calls(fetchMock, 'POST', '/api/v1/expiry/items');
      const key = post!.headers.get('Idempotency-Key');
      expect(key).toMatch(UUID);
      expect(await bodyOf(post)).toEqual({
        productId: COLA_BOX.product.id,
        expiryDate: '2026-12-01',
        qtyFloor: '6',
        qtyWarehouse: '0',
      });

      // The dialog stays for the next product on the shelf, emptied, and says what was added.
      expect(await dialog.findByText('Кока кола бүртгэгдлээ')).toBeInTheDocument();
      expect(dialog.getByLabelText(mn.expiry.columns.qtyFloor)).toHaveValue('');
      await waitFor(() => expect(dialog.getByLabelText(mn.scan.label)).toHaveFocus());
      await wedgeScan(COLA_BOX.barcode.code);
      await dialog.findByText(COLA_BOX.product.name);
      await fillRecord(dialog, user);
      await user.click(dialog.getByRole('button', { name: mn.common.save }));
      await waitFor(() => expect(calls(fetchMock, 'POST', '/api/v1/expiry/items')).toHaveLength(2));
      expect(
        calls(fetchMock, 'POST', '/api/v1/expiry/items')[1]!.headers.get('Idempotency-Key'),
      ).not.toBe(key);
    });

    it('offers to add anyway after a repeat, posting allowDuplicate under the same key', async () => {
      let posted = 0;
      const fetchMock = signedIn(ADMIN_ME, {
        ...ROUTES,
        [`GET /api/v1/barcodes/${COLA_BOX.barcode.code}`]: () => json(COLA_BOX),
        'POST /api/v1/expiry/items': () => {
          posted += 1;
          return posted === 1
            ? problem('EXPIRY_ITEM_EXISTS', 409, { itemId: 1 })
            : json({ ...ITEM, id: 9 }, 201);
        },
      });
      const { dialog, router } = await scannedDialog(fetchMock);
      const user = userEvent.setup();
      await fillRecord(dialog, user);
      await user.click(dialog.getByRole('button', { name: mn.common.save }));
      await user.click(await dialog.findByRole('button', { name: mn.expiry.new.addAnyway }));

      await waitFor(() => expect(calls(fetchMock, 'POST', '/api/v1/expiry/items')).toHaveLength(2));
      const [first, second] = calls(fetchMock, 'POST', '/api/v1/expiry/items');
      expect(first!.headers.get('Idempotency-Key')).toBe(second!.headers.get('Idempotency-Key'));
      expect(await bodyOf(first)).not.toHaveProperty('allowDuplicate');
      expect(await bodyOf(second)).toMatchObject({ allowDuplicate: true, qtyFloor: '6' });
      // «Хадгалах» was pressed, so the dialog closes once it is in.
      await waitFor(() => expect(router.state.location.search).toBe(''));
    });

    it('offers to open that record after a repeat, adding nothing', async () => {
      const fetchMock = signedIn(ADMIN_ME, {
        ...ROUTES,
        [`GET /api/v1/barcodes/${COLA_BOX.barcode.code}`]: () => json(COLA_BOX),
        'POST /api/v1/expiry/items': () => problem('EXPIRY_ITEM_EXISTS', 409, { itemId: 1 }),
      });
      const { dialog, router } = await scannedDialog(fetchMock);
      const user = userEvent.setup();
      await fillRecord(dialog, user);
      await user.click(dialog.getByRole('button', { name: mn.common.save }));
      await user.click(await dialog.findByRole('button', { name: mn.expiry.new.openRecord }));

      await waitFor(() => expect(router.state.location.search).toBe('?item=1'));
      const panel = within(await screen.findByRole('dialog'));
      expect(await panel.findByRole('heading', { name: 'Туршилтын сүү' })).toBeInTheDocument();
      expect(calls(fetchMock, 'POST', '/api/v1/expiry/items')).toHaveLength(1);
    });
  });

  describe('correcting', () => {
    it('sends the version and only what changed; a refused save keeps what was typed', async () => {
      // Someone else counts the warehouse (version 2) while this person types the floor.
      const newer: Item = { ...ITEM, qtyWarehouse: '5', qtyTotal: '17', editVersion: 2 };
      let current = ITEM;
      let patches = 0;
      const fetchMock = signedIn(ADMIN_ME, {
        ...ROUTES,
        'GET /api/v1/expiry/items/1': () => json(current),
        'PATCH /api/v1/expiry/items/1': () => {
          patches += 1;
          if (patches === 1) {
            current = newer;
            return problem('EXPIRY_ITEM_CHANGED', 409, { currentVersion: 2 });
          }
          return json({ ...newer, qtyFloor: '20', qtyTotal: '25', editVersion: 3 });
        },
      });
      renderApp(`${PAGE}?item=1`, fetchMock);
      const user = userEvent.setup();
      const panel = within(await screen.findByRole('dialog'));
      const floor = await panel.findByLabelText(mn.expiry.columns.qtyFloor);
      const warehouse = panel.getByLabelText(mn.expiry.columns.qtyWarehouse);
      const save = panel.getByRole('button', { name: mn.common.save });
      expect(save).toBeDisabled();

      await user.clear(floor);
      await user.type(floor, '20');
      await user.click(save);

      expect(await panel.findByText(mn.errors.EXPIRY_ITEM_CHANGED)).toBeInTheDocument();
      const first = calls(fetchMock, 'PATCH', '/api/v1/expiry/items/1')[0];
      expect(await bodyOf(first)).toEqual({ expectedVersion: 1, qtyFloor: '20' });
      // Reloaded: what was typed stays, the field left alone takes what now stands.
      await waitFor(() => expect(warehouse).toHaveValue('5'));
      expect(floor).toHaveValue('20');
      expect(panel.getByText('Одоогийн утга: 12')).toBeInTheDocument();

      await user.click(save);
      await waitFor(() => expect(patches).toBe(2));
      const second = calls(fetchMock, 'PATCH', '/api/v1/expiry/items/1')[1];
      expect(await bodyOf(second)).toEqual({ expectedVersion: 2, qtyFloor: '20' });
      await waitFor(() => expect(panel.queryByText(mn.errors.EXPIRY_ITEM_CHANGED)).toBeNull());
    });

    it('stays on the version it read while something is typed, so a save cannot overwrite', async () => {
      let current = ITEM;
      const fetchMock = signedIn(ADMIN_ME, {
        ...ROUTES,
        'GET /api/v1/expiry/items/1': () => json(current),
        'PATCH /api/v1/expiry/items/1': () =>
          problem('EXPIRY_ITEM_CHANGED', 409, { currentVersion: 2 }),
      });
      renderApp(`${PAGE}?item=1`, fetchMock);
      const user = userEvent.setup();
      const panel = within(await screen.findByRole('dialog'));
      const note = await panel.findByLabelText(mn.expiry.columns.note);
      const warehouse = panel.getByLabelText(mn.expiry.columns.qtyWarehouse);
      await user.clear(note);
      await user.type(note, 'Шинэ тайлбар');

      // A newer record arrives in the background while the person types.
      current = { ...ITEM, qtyWarehouse: '5', qtyTotal: '17', editVersion: 2 };
      const reads = calls(fetchMock, 'GET', '/api/v1/expiry/items/1').length;
      act(() => {
        focusManager.setFocused(false);
        focusManager.setFocused(true);
      });
      await waitFor(() =>
        expect(calls(fetchMock, 'GET', '/api/v1/expiry/items/1').length).toBeGreaterThan(reads),
      );
      focusManager.setFocused(undefined);
      expect(note).toHaveValue('Шинэ тайлбар');
      expect(warehouse).toHaveValue('3');

      await user.click(panel.getByRole('button', { name: mn.common.save }));
      await waitFor(() =>
        expect(calls(fetchMock, 'PATCH', '/api/v1/expiry/items/1')).toHaveLength(1),
      );
      expect(await bodyOf(calls(fetchMock, 'PATCH', '/api/v1/expiry/items/1')[0])).toEqual({
        expectedVersion: 1,
        note: 'Шинэ тайлбар',
      });
      // Refused: only now does the form move on, keeping the typed note.
      await waitFor(() => expect(warehouse).toHaveValue('5'));
      expect(note).toHaveValue('Шинэ тайлбар');
    });

    it('asks before closing with something typed, and closes at once with nothing typed', async () => {
      const fetchMock = signedIn(ADMIN_ME, ROUTES);
      const { router } = renderApp(`${PAGE}?item=1`, fetchMock);
      const user = userEvent.setup();
      const panel = within(await screen.findByRole('dialog'));
      const note = await panel.findByLabelText(mn.expiry.columns.note);
      await user.type(note, ' нэмэлт');
      await user.keyboard('{Escape}');
      expect(await screen.findByText(mn.common.discard.title)).toBeInTheDocument();
      expect(router.state.location.search).toBe('?item=1');
      await user.click(screen.getByRole('button', { name: mn.common.discard.confirm }));
      await waitFor(() => expect(router.state.location.search).toBe(''));

      cleanup();
      const quiet = renderApp(`${PAGE}?item=1`, signedIn(ADMIN_ME, ROUTES));
      await within(await screen.findByRole('dialog')).findByLabelText(mn.expiry.columns.note);
      await user.keyboard('{Escape}');
      await waitFor(() => expect(quiet.router.state.location.search).toBe(''));
    });

    it('shows an archived record read-only, with restore putting it back in review', async () => {
      const archived: Item = {
        ...ITEM,
        status: 'ARCHIVED',
        archivedAt: '2026-11-03T02:00:00.000Z',
        archivedByName: 'Дорж',
      };
      let current = archived;
      const fetchMock = signedIn(ADMIN_ME, {
        ...ROUTES,
        'GET /api/v1/expiry/items/1': () => json(current),
        'PUT /api/v1/expiry/items/1/status': () => {
          current = { ...ITEM };
          return json(current);
        },
      });
      renderApp(`${PAGE}?item=1`, fetchMock);
      const user = userEvent.setup();
      const panel = within(await screen.findByRole('dialog'));
      expect(await panel.findByText(mn.expiry.panel.archivedNote)).toBeInTheDocument();
      expect(panel.queryByLabelText(mn.expiry.columns.qtyFloor)).toBeNull();
      expect(panel.queryByRole('button', { name: mn.common.save })).toBeNull();
      expect(panel.queryByRole('combobox', { name: mn.expiry.panel.statusLabel })).toBeNull();

      await user.click(panel.getByRole('button', { name: mn.expiry.panel.restore }));
      await waitFor(async () =>
        expect(await bodyOf(calls(fetchMock, 'PUT', '/api/v1/expiry/items/1/status')[0])).toEqual({
          status: 'REVIEW',
        }),
      );
      expect(await panel.findByLabelText(mn.expiry.columns.qtyFloor)).toBeInTheDocument();
    });
  });

  describe('rights', () => {
    it('gives a person without rights the form, but no status control or liability button', async () => {
      const fetchMock = signedIn({ ...WORKER_ME, permissions: [] }, ROUTES);
      renderApp(`${PAGE}?item=1`, fetchMock);
      const panel = within(await screen.findByRole('dialog'));
      expect(await panel.findByLabelText(mn.expiry.columns.qtyFloor)).toBeInTheDocument();
      expect(panel.queryByRole('combobox', { name: mn.expiry.panel.statusLabel })).toBeNull();
      expect(panel.queryByRole('button', { name: mn.expiry.panel.archive })).toBeNull();
      expect(panel.queryByRole('button', { name: mn.expiry.liability.assign })).toBeNull();
      expect(calls(fetchMock, 'GET', '/api/v1/expiry/liability-options')).toHaveLength(0);
    });

    it('lets a manager change the status and archive', async () => {
      const fetchMock = signedIn(
        { ...WORKER_ME, permissions: ['expiry.items.manage'] },
        {
          ...ROUTES,
          'PUT /api/v1/expiry/items/1/status': async (request) => {
            const body = (await request.clone().json()) as { status: Item['status'] };
            return json({ ...ITEM, status: body.status });
          },
        },
      );
      renderApp(`${PAGE}?item=1`, fetchMock);
      const user = userEvent.setup();
      const panel = within(await screen.findByRole('dialog'));
      await user.selectOptions(
        await panel.findByRole('combobox', { name: mn.expiry.panel.statusLabel }),
        'CITY_RETURN',
      );
      await waitFor(() =>
        expect(calls(fetchMock, 'PUT', '/api/v1/expiry/items/1/status')).toHaveLength(1),
      );
      expect(await bodyOf(calls(fetchMock, 'PUT', '/api/v1/expiry/items/1/status')[0])).toEqual({
        status: 'CITY_RETURN',
      });
      expect(panel.queryByRole('button', { name: mn.expiry.liability.assign })).toBeNull();

      await user.click(panel.getByRole('button', { name: mn.expiry.panel.archive }));
      await waitFor(() =>
        expect(calls(fetchMock, 'PUT', '/api/v1/expiry/items/1/status')).toHaveLength(2),
      );
      expect(await bodyOf(calls(fetchMock, 'PUT', '/api/v1/expiry/items/1/status')[1])).toEqual({
        status: 'ARCHIVED',
      });
      expect(
        await panel.findByRole('button', { name: mn.expiry.panel.restore }),
      ).toBeInTheDocument();
      expect(panel.queryByRole('combobox', { name: mn.expiry.panel.statusLabel })).toBeNull();
    });

    it('assigns a liability from the options, naming roles and people', async () => {
      const fetchMock = signedIn(
        { ...WORKER_ME, permissions: ['expiry.liability.manage'] },
        {
          ...ROUTES,
          'GET /api/v1/expiry/liability-options': () =>
            json({
              roles: [
                { id: 4, code: 'WAREHOUSE', name: null },
                { id: 20, code: null, name: 'Лангууны ахлах' },
              ],
              users: [
                { id: 7, fullName: 'Болд' },
                { id: 8, fullName: 'Дорж' },
              ],
            }),
          'PUT /api/v1/expiry/items/1/liability': () =>
            json({
              ...ITEM,
              liability: {
                type: 'SPECIFIC',
                roles: [{ id: 4, code: 'WAREHOUSE', name: null }],
                users: [{ id: 8, fullName: 'Дорж' }],
                note: '50%',
              },
            }),
        },
      );
      renderApp(`${PAGE}?item=1`, fetchMock);
      const user = userEvent.setup();
      const panel = within(await screen.findByRole('dialog'));
      await user.click(await panel.findByRole('button', { name: mn.expiry.liability.assign }));
      const dialog = within(
        await screen.findByRole('dialog', { name: mn.expiry.liability.assign }),
      );
      await user.click(dialog.getByRole('tab', { name: mn.expiry.liabilityType.SPECIFIC }));
      // Nobody ticked yet: the save waits.
      expect(dialog.getByRole('button', { name: mn.common.save })).toBeDisabled();
      await user.click(await dialog.findByRole('checkbox', { name: mn.roles.system.WAREHOUSE }));
      await user.type(
        dialog.getByRole('searchbox', { name: mn.expiry.liability.peopleFilter }),
        'дор',
      );
      expect(dialog.queryByRole('checkbox', { name: 'Болд' })).toBeNull();
      await user.click(dialog.getByRole('checkbox', { name: 'Дорж' }));
      await user.type(dialog.getByLabelText(mn.expiry.liability.note), '50%');
      await user.click(dialog.getByRole('button', { name: mn.common.save }));

      await waitFor(() =>
        expect(calls(fetchMock, 'PUT', '/api/v1/expiry/items/1/liability')).toHaveLength(1),
      );
      expect(await bodyOf(calls(fetchMock, 'PUT', '/api/v1/expiry/items/1/liability')[0])).toEqual({
        type: 'SPECIFIC',
        roleIds: [4],
        userIds: [8],
        note: '50%',
      });
    });
  });

  describe('the print page', () => {
    it('reads every page under the list’s filters before it prints', async () => {
      const print = vi.spyOn(window, 'print').mockImplementation(() => undefined);
      const fetchMock = signedIn(ADMIN_ME, {
        ...ROUTES,
        'GET /api/v1/expiry/items': (request) =>
          queryOf(request).get('cursor') === 'next' ? page([SECOND]) : page([ITEM], 'next'),
      });
      renderApp(`${PAGE}/print?view=EXPIRED&supplier=5&format=a4`, fetchMock);

      expect(
        await screen.findByRole('heading', { name: mn.expiry.printPage.title }),
      ).toBeInTheDocument();
      expect(screen.getByText('Туршилтын сүү')).toBeInTheDocument();
      expect(screen.getByText('Туршилтын тос')).toBeInTheDocument();
      expect(screen.getByText(`Хэвлэсэн: ${today} · Нийт 2 бараа`)).toBeInTheDocument();
      const asked = calls(fetchMock, 'GET', '/api/v1/expiry/items').map(queryOf);
      expect(asked).toHaveLength(2);
      expect(asked[0]!.get('cursor')).toBeNull();
      expect(asked[1]!.get('cursor')).toBe('next');
      for (const query of asked) {
        expect(query.get('view')).toBe('EXPIRED');
        expect(query.get('supplierId')).toBe('5');
        expect(query.get('limit')).toBe('200');
      }
      expect(screen.getByText(mn.expiry.columns.createdAt)).toBeInTheDocument();
      expect(screen.queryByRole('link')).toBeNull();
      // A4 lying down, once everything is in.
      expect(
        [...document.querySelectorAll('style')].some((style) =>
          style.innerHTML.includes('A4 landscape'),
        ),
      ).toBe(true);
      await waitFor(() => expect(print).toHaveBeenCalledTimes(1));
      cleanup();
    });
  });
});
