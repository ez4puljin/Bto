import { focusManager } from '@tanstack/react-query';
import { act, cleanup, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { components } from '@tugeel/api-client';
import mn from '@tugeel/shared/i18n/mn.json';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { type ColumnSpec, columnLayout } from '@/lib/column-layout';
import { bodyOf, calls, COLA_BOX, list, UUID } from '@/test/inventory-fixtures';
import { ADMIN_ME, json, problem, renderApp, signedIn, WORKER_ME } from '@/test/render-app';
import { wedgeScan } from '@/test/scan';
import {
  CHEVRON_COLUMN,
  DEFAULT_HIDDEN_EXPIRY_COLUMNS,
  EXPIRY_COLUMN_KEYS,
  EXPIRY_COLUMN_SPECS,
  type ExpiryColumnKey,
  FULL_DEFAULT_HIDDEN_EXPIRY_COLUMNS,
  FULL_SCREEN,
  WIDE_DEFAULT_HIDDEN_EXPIRY_COLUMNS,
} from './expiry-columns';

type Item = components['schemas']['ExpiryItemDto'];

const PAGE = '/inventory/expiry';
const today = '2026-11-07';
/** The two counts' labels once a product's base unit is known. */
const FLOOR = 'Заал (ш)';
const WAREHOUSE = 'Агуулах (ш)';

/** A second product on the shelf, its barcode the piece's. */
const OTHER: components['schemas']['BarcodeResolution'] = {
  product: { ...COLA_BOX.product, id: 20, sku: '20', name: 'Туршилтын ус' },
  unit: { id: 78, uomId: 1, uomName: 'ш', factorToBase: '1', isBase: true },
  barcode: {
    ...COLA_BOX.barcode,
    id: 6,
    code: '5901234123457',
    gtin14: '05901234123457',
  },
};

/** What a wedge scan must wait for after real typing: its first key has to read as a new burst. */
const afterTyping = () => new Promise((resolve) => setTimeout(resolve, 60));

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
  await user.type(dialog.getByLabelText(FLOOR), '6');
}

const SCANS = {
  [`GET /api/v1/barcodes/${COLA_BOX.barcode.code}`]: () => json(COLA_BOX),
  [`GET /api/v1/barcodes/${OTHER.barcode.code}`]: () => json(OTHER),
};

describe('ExpiryPage', () => {
  beforeEach(() => sessionStorage.clear());
  afterEach(() => {
    vi.restoreAllMocks();
    // Not `unstubAllGlobals`: the test setup's ResizeObserver is a stub too.
    vi.stubGlobal('matchMedia', undefined);
  });

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
    // The cards say what the page is about: the header keeps only the count.

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

    const box = screen.getByRole('searchbox', { name: mn.common.search });
    await user.type(box, 'сүү');
    await waitFor(() =>
      expect(queryOf(calls(fetchMock, 'GET', '/api/v1/expiry/items').at(-1)!).get('q')).toBe('сүү'),
    );
    expect(box).toHaveValue('сүү');
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

  it('empties the search box when the menu’s own link clears the address', async () => {
    const { router } = renderApp(`${PAGE}?q=сүү`, signedIn(ADMIN_ME, ROUTES));
    const box = await screen.findByRole('searchbox', { name: mn.common.search });
    expect(box).toHaveValue('сүү');
    await act(() => router.navigate(PAGE));
    await waitFor(() => expect(box).toHaveValue(''));
  });

  it('keeps a filter ticked in a view whose records lack it, so it can be lifted there', async () => {
    const fetchMock = signedIn(ADMIN_ME, {
      ...ROUTES,
      'GET /api/v1/expiry/filters': (request) =>
        json(
          queryOf(request).get('view') === 'ARCHIVED'
            ? { suppliers: [], warehouses: [], creators: [] }
            : FILTERS,
        ),
    });
    const { router } = renderApp(`${PAGE}?supplier=5`, fetchMock);
    const user = userEvent.setup();
    const panel = within(
      await screen.findByRole('complementary', { name: mn.expiry.filters.label }),
    );
    await panel.findByRole('button', { name: 'Альфа ХХК', pressed: true });
    await user.click(
      await screen.findByRole('button', { name: `${mn.expiry.tiles.archived}: 88` }),
    );

    // The view's own choices are in, and the supplier that is on is still named among them.
    expect((await panel.findAllByText(mn.expiry.filters.noOptions)).length).toBeGreaterThan(0);
    const chosen = panel.getByRole('button', { name: 'Альфа ХХК', pressed: true });
    expect(screen.getByRole('combobox', { name: mn.expiry.filters.supplier })).toHaveValue('5');
    await user.click(chosen);
    await waitFor(() => expect(router.state.location.search).toBe('?view=ARCHIVED'));
    await waitFor(() => expect(panel.queryByRole('button', { name: 'Альфа ХХК' })).toBeNull());
  });

  it('names a filter it never saw a name for by its number', async () => {
    const fetchMock = signedIn(ADMIN_ME, {
      ...ROUTES,
      'GET /api/v1/expiry/filters': () => json({ suppliers: [], warehouses: [], creators: [] }),
    });
    renderApp(`${PAGE}?view=ARCHIVED&supplier=9`, fetchMock);
    const panel = within(
      await screen.findByRole('complementary', { name: mn.expiry.filters.label }),
    );
    expect(
      await panel.findByRole('button', { name: 'Сонгосон (#9)', pressed: true }),
    ).toBeInTheDocument();
  });

  it('says a failed read failed, not that nothing is there', async () => {
    const fetchMock = signedIn(ADMIN_ME, {
      ...ROUTES,
      'GET /api/v1/expiry/items': () => problem('INTERNAL_ERROR', 500),
    });
    renderApp(PAGE, fetchMock);
    expect(await screen.findByRole('button', { name: mn.common.retry })).toBeInTheDocument();
    expect(screen.queryByText(mn.expiry.empty)).toBeNull();
  });

  describe('the columns', () => {
    /**
     * The rem the table has beside the filter panel: the page's gutters (2rem each side), the panel
     * (16rem) and the gap (1rem) go out, and the scrollbars of the page and of the card (about 26px).
     */
    const room = (windowPx: number, rootPx: number) => (windowPx - 26) / rootPx - 4 - 16 - 1;
    const specs = (hidden: readonly ExpiryColumnKey[]): ColumnSpec[] => [
      ...EXPIRY_COLUMN_KEYS.filter((key) => !hidden.includes(key)).map(
        (key) => EXPIRY_COLUMN_SPECS[key],
      ),
      CHEVRON_COLUMN,
    ];
    const needs = (hidden: readonly ExpiryColumnKey[]) => columnLayout(specs(hidden)).minWidth;

    it('fit each screen’s default set beside the filter panel', () => {
      expect(needs(DEFAULT_HIDDEN_EXPIRY_COLUMNS)).toBeLessThanOrEqual(room(1366, 17));
      expect(needs(WIDE_DEFAULT_HIDDEN_EXPIRY_COLUMNS)).toBeLessThanOrEqual(room(1600, 18));
      expect(needs(FULL_DEFAULT_HIDDEN_EXPIRY_COLUMNS)).toBeLessThanOrEqual(room(1900, 19));
      // The reason the fullest set waits for 1900px.
      expect(needs(FULL_DEFAULT_HIDDEN_EXPIRY_COLUMNS)).toBeGreaterThan(room(1600, 18));
    });

    it('shows the supplier, the note and the author on a full screen', async () => {
      vi.stubGlobal('matchMedia', (query: string) => ({
        matches: query === FULL_SCREEN || query === '(min-width: 1600px)',
        addEventListener: () => undefined,
        removeEventListener: () => undefined,
      }));
      renderApp(PAGE, signedIn(ADMIN_ME, ROUTES));
      const names = [
        mn.expiry.columns.supplier,
        mn.expiry.columns.note,
        mn.expiry.columns.createdBy,
      ];
      for (const name of names) {
        expect(await screen.findByRole('columnheader', { name })).toBeInTheDocument();
      }
      expect(screen.queryByRole('columnheader', { name: mn.expiry.columns.liability })).toBeNull();
      expect(screen.queryByRole('columnheader', { name: mn.expiry.columns.createdAt })).toBeNull();
    });
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
      // What is typed goes with the dialog, so it asks like the dialog's other exits.
      expect(await screen.findByText(mn.common.discard.title)).toBeInTheDocument();
      expect(router.state.location.search).toBe('?new=1');
      await user.click(screen.getByRole('button', { name: mn.common.discard.confirm }));

      await waitFor(() => expect(router.state.location.search).toBe('?item=1'));
      const panel = within(await screen.findByRole('dialog'));
      expect(await panel.findByRole('heading', { name: 'Туршилтын сүү' })).toBeInTheDocument();
      expect(calls(fetchMock, 'POST', '/api/v1/expiry/items')).toHaveLength(1);
    });

    it('asks before a listed record’s link leaves what is typed, and not before', async () => {
      const fetchMock = signedIn(ADMIN_ME, { ...ROUTES, ...SCANS });
      const { dialog, router } = await scannedDialog(fetchMock);
      const user = userEvent.setup();
      await fillRecord(dialog, user);
      await user.click(await dialog.findByRole('link', { name: /2026-11-04/ }));
      expect(await screen.findByText(mn.common.discard.title)).toBeInTheDocument();
      expect(router.state.location.search).toBe('?new=1');
      await user.click(screen.getByRole('button', { name: mn.common.discard.keep }));
      expect(dialog.getByLabelText(FLOOR)).toHaveValue('6');
      expect(router.state.location.search).toBe('?new=1');
      await user.click(dialog.getByRole('link', { name: /2026-11-04/ }));
      await user.click(await screen.findByRole('button', { name: mn.common.discard.confirm }));
      await waitFor(() => expect(router.state.location.search).toBe('?item=1'));

      cleanup();
      const quiet = await scannedDialog(signedIn(ADMIN_ME, { ...ROUTES, ...SCANS }));
      await user.click(await quiet.dialog.findByRole('link', { name: /2026-11-04/ }));
      await waitFor(() => expect(quiet.router.state.location.search).toBe('?item=1'));
      expect(screen.queryByText(mn.common.discard.title)).toBeNull();
    });

    describe('a scan with something typed', () => {
      /** Product A with its date and count typed, the cursor in the count, then product B's scan. */
      async function heldScan(fetchMock: ReturnType<typeof signedIn>) {
        const { dialog, router } = await scannedDialog(fetchMock);
        const user = userEvent.setup();
        await fillRecord(dialog, user);
        await afterTyping();
        await wedgeScan(OTHER.barcode.code);
        const question = within(
          await screen.findByRole('dialog', {
            name: mn.expiry.new.heldTitle.replace('{{name}}', COLA_BOX.product.name),
          }),
        );
        expect(
          question.getByText(mn.expiry.new.heldDescription.replace('{{name}}', OTHER.product.name)),
        ).toBeInTheDocument();
        // The scan is held: nothing is saved, and the count did not take the barcode.
        expect(calls(fetchMock, 'POST', '/api/v1/expiry/items')).toHaveLength(0);
        expect(dialog.getByLabelText(FLOOR)).toHaveValue('6');
        return { dialog, question, router, user };
      }

      it('saves this product first when told to, then goes on to the scanned one', async () => {
        const created: Item = { ...ITEM, id: 9, product: { ...ITEM.product, name: 'Кока кола' } };
        const fetchMock = signedIn(ADMIN_ME, {
          ...ROUTES,
          ...SCANS,
          'POST /api/v1/expiry/items': () => json(created, 201),
        });
        const { dialog, question, user } = await heldScan(fetchMock);
        await user.click(question.getByRole('button', { name: mn.expiry.new.heldSave }));

        await waitFor(() =>
          expect(calls(fetchMock, 'POST', '/api/v1/expiry/items')).toHaveLength(1),
        );
        const [first] = calls(fetchMock, 'POST', '/api/v1/expiry/items');
        expect(await bodyOf(first)).toEqual({
          productId: COLA_BOX.product.id,
          expiryDate: '2026-12-01',
          qtyFloor: '6',
          qtyWarehouse: '0',
        });
        expect(await dialog.findByText('Кока кола бүртгэгдлээ')).toBeInTheDocument();
        expect(await dialog.findByText(OTHER.product.name)).toBeInTheDocument();
        // Nothing of the first product comes along, and the date is what comes next.
        const date = dialog.getByLabelText(mn.expiry.columns.expiryDate);
        expect(date).toHaveValue('');
        expect(dialog.getByLabelText(FLOOR)).toHaveValue('');
        await waitFor(() => expect(date).toHaveFocus());

        await fillRecord(dialog, user);
        await user.click(dialog.getByRole('button', { name: mn.common.save }));
        await waitFor(() =>
          expect(calls(fetchMock, 'POST', '/api/v1/expiry/items')).toHaveLength(2),
        );
        const second = calls(fetchMock, 'POST', '/api/v1/expiry/items')[1];
        expect(await bodyOf(second)).toMatchObject({ productId: OTHER.product.id });
        expect(second!.headers.get('Idempotency-Key')).not.toBe(
          first!.headers.get('Idempotency-Key'),
        );
      });

      it('stays on this product when its save is refused, its scan given up', async () => {
        const fetchMock = signedIn(ADMIN_ME, {
          ...ROUTES,
          ...SCANS,
          'POST /api/v1/expiry/items': () => problem('INTERNAL_ERROR', 500),
        });
        const { dialog, question, user } = await heldScan(fetchMock);
        await user.click(question.getByRole('button', { name: mn.expiry.new.heldSave }));
        expect(await dialog.findByText(mn.errors.INTERNAL_ERROR)).toBeInTheDocument();
        expect(dialog.getByLabelText(FLOOR)).toHaveValue('6');
        expect(dialog.queryByText(OTHER.product.name)).toBeNull();
      });

      it('still goes on to the scanned one after a repeat is added anyway', async () => {
        let posted = 0;
        const fetchMock = signedIn(ADMIN_ME, {
          ...ROUTES,
          ...SCANS,
          'POST /api/v1/expiry/items': () => {
            posted += 1;
            return posted === 1
              ? problem('EXPIRY_ITEM_EXISTS', 409, { itemId: 1 })
              : json({ ...ITEM, id: 9 }, 201);
          },
        });
        const { dialog, question, user } = await heldScan(fetchMock);
        await user.click(question.getByRole('button', { name: mn.expiry.new.heldSave }));
        await user.click(await dialog.findByRole('button', { name: mn.expiry.new.addAnyway }));
        expect(await dialog.findByText(OTHER.product.name)).toBeInTheDocument();
        expect(dialog.getByLabelText(FLOOR)).toHaveValue('');
        expect(posted).toBe(2);
      });

      it('keeps this product and shows why when what is typed cannot be saved', async () => {
        const fetchMock = signedIn(ADMIN_ME, { ...ROUTES, ...SCANS });
        const { dialog } = await scannedDialog(fetchMock);
        const user = userEvent.setup();
        await user.type(dialog.getByLabelText(FLOOR), '6');
        await afterTyping();
        await wedgeScan(OTHER.barcode.code);
        await user.click(await screen.findByRole('button', { name: mn.expiry.new.heldSave }));

        expect(await dialog.findByText(mn.validation.date)).toBeInTheDocument();
        expect(dialog.getByText(COLA_BOX.product.name)).toBeInTheDocument();
        expect(dialog.queryByText(OTHER.product.name)).toBeNull();
        expect(dialog.getByLabelText(FLOOR)).toHaveValue('6');
        expect(calls(fetchMock, 'POST', '/api/v1/expiry/items')).toHaveLength(0);
      });

      it('drops what is typed when told to, saving nothing', async () => {
        const fetchMock = signedIn(ADMIN_ME, { ...ROUTES, ...SCANS });
        const { dialog, question, user } = await heldScan(fetchMock);
        await user.click(question.getByRole('button', { name: mn.expiry.new.heldDrop }));

        expect(await dialog.findByText(OTHER.product.name)).toBeInTheDocument();
        const date = dialog.getByLabelText(mn.expiry.columns.expiryDate);
        expect(date).toHaveValue('');
        expect(dialog.getByLabelText(FLOOR)).toHaveValue('');
        await waitFor(() => expect(date).toHaveFocus());
        expect(calls(fetchMock, 'POST', '/api/v1/expiry/items')).toHaveLength(0);
      });

      it('stays on this product with what is typed when the question is cancelled', async () => {
        const fetchMock = signedIn(ADMIN_ME, { ...ROUTES, ...SCANS });
        const { dialog, question, user } = await heldScan(fetchMock);
        await user.click(question.getByRole('button', { name: mn.common.cancel }));

        await waitFor(() => expect(screen.queryByText(/хадгалагдаагүй/)).toBeNull());
        expect(dialog.getByText(COLA_BOX.product.name)).toBeInTheDocument();
        expect(dialog.queryByText(OTHER.product.name)).toBeNull();
        expect(dialog.getByLabelText(mn.expiry.columns.expiryDate)).toHaveValue('2026-12-01');
        const floor = dialog.getByLabelText(FLOOR);
        expect(floor).toHaveValue('6');
        await waitFor(() => expect(floor).toHaveFocus());
        expect(calls(fetchMock, 'POST', '/api/v1/expiry/items')).toHaveLength(0);
      });
    });

    it('moves on at once with nothing typed, and a re-scan of a product changes no value', async () => {
      const fetchMock = signedIn(ADMIN_ME, { ...ROUTES, ...SCANS });
      const { dialog } = await scannedDialog(fetchMock);
      const user = userEvent.setup();
      // The cursor is in the date box now, where the next scan lands.
      const date = dialog.getByLabelText(mn.expiry.columns.expiryDate);
      await waitFor(() => expect(date).toHaveFocus());
      await wedgeScan(OTHER.barcode.code);
      expect(await dialog.findByText(OTHER.product.name)).toBeInTheDocument();
      expect(dialog.queryByText(COLA_BOX.product.name)).toBeNull();
      expect(date).toHaveValue('');
      expect(dialog.queryByText(mn.validation.date)).toBeNull();
      expect(calls(fetchMock, 'POST', '/api/v1/expiry/items')).toHaveLength(0);

      await user.type(dialog.getByLabelText(FLOOR), '4');
      await afterTyping();
      await wedgeScan(OTHER.barcode.code);
      await waitFor(() =>
        expect(calls(fetchMock, 'GET', `/api/v1/barcodes/${OTHER.barcode.code}`)).toHaveLength(2),
      );
      expect(dialog.getByLabelText(FLOOR)).toHaveValue('4');
      expect(screen.queryByText(/хадгалагдаагүй/)).toBeNull();
    });

    it('takes a scan in the date box or the note for the next product, never for text', async () => {
      const fetchMock = signedIn(ADMIN_ME, { ...ROUTES, ...SCANS });
      const { dialog } = await scannedDialog(fetchMock);
      const user = userEvent.setup();
      await fillRecord(dialog, user);
      const question = () =>
        screen.findByRole('dialog', {
          name: mn.expiry.new.heldTitle.replace('{{name}}', COLA_BOX.product.name),
        });

      // The date and the count are typed, the cursor back in the date box: the Enter saves nothing.
      const date = dialog.getByLabelText(mn.expiry.columns.expiryDate);
      await user.click(date);
      await afterTyping();
      await wedgeScan(OTHER.barcode.code);
      await user.click(within(await question()).getByRole('button', { name: mn.common.cancel }));
      await waitFor(() => expect(date).toHaveValue('2026-12-01'));
      expect(calls(fetchMock, 'POST', '/api/v1/expiry/items')).toHaveLength(0);

      const note = dialog.getByLabelText(mn.expiry.new.note);
      await user.type(note, 'Партиас');
      await afterTyping();
      await wedgeScan(OTHER.barcode.code);
      await question();
      expect(note).toHaveValue('Партиас');
      expect(calls(fetchMock, 'POST', '/api/v1/expiry/items')).toHaveLength(0);
    });

    it('says when a box was scanned, and which unit the counts are in', async () => {
      const fetchMock = signedIn(ADMIN_ME, { ...ROUTES, ...SCANS });
      const { dialog } = await scannedDialog(fetchMock);
      // Before a product is chosen no unit is known; COLA_BOX is one box of 24 pieces.
      expect(dialog.getByText('1 хайрцаг = 24 ш')).toBeInTheDocument();
      expect(dialog.getByLabelText(FLOOR)).toBeInTheDocument();
      expect(dialog.getByLabelText(WAREHOUSE)).toBeInTheDocument();

      await wedgeScan(OTHER.barcode.code);
      expect(await dialog.findByText(OTHER.product.name)).toBeInTheDocument();
      expect(dialog.queryByText(/хайрцаг/)).toBeNull();
    });

    it('draws a new key once when the server saw this one with another body', async () => {
      let posted = 0;
      const fetchMock = signedIn(ADMIN_ME, {
        ...ROUTES,
        ...SCANS,
        'POST /api/v1/expiry/items': () => {
          posted += 1;
          if (posted === 1) return problem('IDEMPOTENCY_KEY_REUSED', 409);
          if (posted === 2) return problem('EXPIRY_ITEM_EXISTS', 409, { itemId: 1 });
          return json({ ...ITEM, id: 9 }, 201);
        },
      });
      const { dialog } = await scannedDialog(fetchMock);
      const user = userEvent.setup();
      await fillRecord(dialog, user);
      await user.click(dialog.getByRole('button', { name: mn.common.save }));

      // The ordinary choice comes up, as the record the unheard save left is told of.
      const addAnyway = await dialog.findByRole('button', { name: mn.expiry.new.addAnyway });
      expect(dialog.queryByText(mn.errors.IDEMPOTENCY_KEY_REUSED)).toBeNull();
      const [first, second] = calls(fetchMock, 'POST', '/api/v1/expiry/items');
      const key = second!.headers.get('Idempotency-Key');
      expect(key).toMatch(UUID);
      expect(key).not.toBe(first!.headers.get('Idempotency-Key'));
      expect(await bodyOf(second)).toEqual(await bodyOf(first));

      await user.click(addAnyway);
      await waitFor(() => expect(posted).toBe(3));
      expect(
        calls(fetchMock, 'POST', '/api/v1/expiry/items')[2]!.headers.get('Idempotency-Key'),
      ).toBe(key);
    });

    it('closes the calendar’s days outside the shared range', async () => {
      const fetchMock = signedIn(ADMIN_ME, { ...ROUTES, ...SCANS });
      const { dialog } = await scannedDialog(fetchMock);
      const user = userEvent.setup();
      await screen.findByText('321 бараа');
      await user.type(dialog.getByLabelText(mn.expiry.columns.expiryDate), '2041-11-20');
      await user.click(dialog.getByRole('button', { name: mn.common.calendar.open }));
      expect(await screen.findByRole('gridcell', { name: '2041 оны 11-р сарын 7' })).toBeEnabled();
      expect(screen.getByRole('gridcell', { name: '2041 оны 11-р сарын 8' })).toBeDisabled();
    });

    it('finds an inactive product by search and marks it', async () => {
      const inactive = { ...OTHER.product, status: 'INACTIVE' as const };
      const fetchMock = signedIn(ADMIN_ME, {
        ...ROUTES,
        'GET /api/v1/products': () => list([inactive]),
      });
      renderApp(`${PAGE}?new=1`, fetchMock);
      const user = userEvent.setup();
      const dialog = within(await screen.findByRole('dialog'));
      await user.type(dialog.getByLabelText(mn.expiry.new.product), 'ус');
      const hit = await screen.findByRole('button', {
        name: `${mn.expiry.new.pick}: ${inactive.name}`,
      });
      expect(within(hit).getByText(mn.catalog.products.status.INACTIVE)).toBeInTheDocument();
      expect(queryOf(calls(fetchMock, 'GET', '/api/v1/products').at(-1)!).has('status')).toBe(
        false,
      );
      await user.click(hit);
      expect(await dialog.findByText(inactive.name)).toBeInTheDocument();
    });

    it('says a failed read of the product’s open records failed, not that it has none', async () => {
      const fetchMock = signedIn(ADMIN_ME, {
        ...ROUTES,
        ...SCANS,
        'GET /api/v1/expiry/items': (request) =>
          queryOf(request).has('productId') ? problem('INTERNAL_ERROR', 500) : page([]),
      });
      const { dialog } = await scannedDialog(fetchMock);
      expect(await dialog.findByRole('button', { name: mn.common.retry })).toBeInTheDocument();
      expect(dialog.queryByText(mn.expiry.new.noOpen)).toBeNull();
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
      const floor = await panel.findByLabelText(FLOOR);
      const warehouse = panel.getByLabelText(WAREHOUSE);
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
      const warehouse = panel.getByLabelText(WAREHOUSE);
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
      expect(panel.queryByLabelText(FLOOR)).toBeNull();
      expect(panel.queryByRole('button', { name: mn.common.save })).toBeNull();
      expect(panel.queryByRole('combobox', { name: mn.expiry.panel.statusLabel })).toBeNull();

      await user.click(panel.getByRole('button', { name: mn.expiry.panel.restore }));
      await waitFor(async () =>
        expect(await bodyOf(calls(fetchMock, 'PUT', '/api/v1/expiry/items/1/status')[0])).toEqual({
          status: 'REVIEW',
        }),
      );
      expect(await panel.findByLabelText(FLOOR)).toBeInTheDocument();
    });

    it('keeps the refusal and what was typed when the save meets an archived record', async () => {
      let current = ITEM;
      const fetchMock = signedIn(ADMIN_ME, {
        ...ROUTES,
        'GET /api/v1/expiry/items/1': () => json(current),
        // Someone archived it while this person typed.
        'PATCH /api/v1/expiry/items/1': () => {
          current = { ...ITEM, status: 'ARCHIVED', archivedAt: '2026-11-03T02:00:00.000Z' };
          return problem('EXPIRY_ITEM_ARCHIVED', 409);
        },
        'PUT /api/v1/expiry/items/1/status': () => {
          current = ITEM;
          return json(current);
        },
      });
      renderApp(`${PAGE}?item=1`, fetchMock);
      const user = userEvent.setup();
      const panel = within(await screen.findByRole('dialog'));
      const floor = await panel.findByLabelText(FLOOR);
      await user.clear(floor);
      await user.type(floor, '5');
      await user.click(panel.getByRole('button', { name: mn.common.save }));

      expect(await panel.findByText(mn.expiry.panel.archivedNote)).toBeInTheDocument();
      expect(panel.getByText(mn.errors.EXPIRY_ITEM_ARCHIVED)).toBeInTheDocument();
      expect(panel.getByText('Таны оруулсан: Заал 5')).toBeInTheDocument();

      // A restore gives the form back with the count in it, and the refusal is over.
      await user.click(panel.getByRole('button', { name: mn.expiry.panel.restore }));
      expect(await panel.findByLabelText(FLOOR)).toHaveValue('5');
      expect(panel.queryByText(mn.errors.EXPIRY_ITEM_ARCHIVED)).toBeNull();
    });

    it('closes the calendar’s days outside the range, and saves other fields of a carried date', async () => {
      const carried: Item = { ...ITEM, expiryDate: '2041-11-20', daysLeft: 5491, urgency: 'OK' };
      const fetchMock = signedIn(ADMIN_ME, {
        ...ROUTES,
        'GET /api/v1/expiry/items/1': () => json(carried),
        'PATCH /api/v1/expiry/items/1': () => json({ ...carried, qtyFloor: '20', editVersion: 2 }),
      });
      renderApp(`${PAGE}?item=1`, fetchMock);
      const user = userEvent.setup();
      const panel = within(await screen.findByRole('dialog'));
      const floor = await panel.findByLabelText(FLOOR);
      await screen.findByText('321 бараа');
      await user.click(panel.getByRole('button', { name: mn.common.calendar.open }));
      expect(await screen.findByRole('gridcell', { name: '2041 оны 11-р сарын 7' })).toBeEnabled();
      expect(screen.getByRole('gridcell', { name: '2041 оны 11-р сарын 8' })).toBeDisabled();
      await user.keyboard('{Escape}');
      await waitFor(() => expect(screen.queryByRole('gridcell')).toBeNull());

      await user.clear(floor);
      await user.type(floor, '20');
      await user.click(panel.getByRole('button', { name: mn.common.save }));
      await waitFor(() =>
        expect(calls(fetchMock, 'PATCH', '/api/v1/expiry/items/1')).toHaveLength(1),
      );
      expect(await bodyOf(calls(fetchMock, 'PATCH', '/api/v1/expiry/items/1')[0])).toEqual({
        expectedVersion: 1,
        qtyFloor: '20',
      });
    });
  });

  describe('rights', () => {
    it('gives a person without rights the form, but no status control or liability button', async () => {
      const fetchMock = signedIn({ ...WORKER_ME, permissions: [] }, ROUTES);
      renderApp(`${PAGE}?item=1`, fetchMock);
      const panel = within(await screen.findByRole('dialog'));
      expect(await panel.findByLabelText(FLOOR)).toBeInTheDocument();
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

    it('asks before archiving over something typed, and drops it only when told to', async () => {
      let current = ITEM;
      const fetchMock = signedIn(
        { ...WORKER_ME, permissions: ['expiry.items.manage'] },
        {
          ...ROUTES,
          'GET /api/v1/expiry/items/1': () => json(current),
          'PUT /api/v1/expiry/items/1/status': async (request) => {
            const body = (await request.clone().json()) as { status: Item['status'] };
            current = { ...ITEM, status: body.status };
            return json(current);
          },
        },
      );
      renderApp(`${PAGE}?item=1`, fetchMock);
      const user = userEvent.setup();
      const panel = within(await screen.findByRole('dialog', { name: 'Туршилтын сүү' }));
      const floor = await panel.findByLabelText(FLOOR);
      await user.clear(floor);
      await user.type(floor, '5');
      const archive = panel.getByRole('button', { name: mn.expiry.panel.archive });
      const ask = () => screen.findByRole('dialog', { name: mn.expiry.panel.archiveDirtyTitle });

      await user.click(archive);
      await user.click(within(await ask()).getByRole('button', { name: mn.common.cancel }));
      await waitFor(() => expect(floor).toHaveValue('5'));
      expect(calls(fetchMock, 'PUT', '/api/v1/expiry/items/1/status')).toHaveLength(0);

      await user.click(archive);
      await user.click(
        within(await ask()).getByRole('button', { name: mn.expiry.panel.archiveDirtyConfirm }),
      );
      await waitFor(() =>
        expect(calls(fetchMock, 'PUT', '/api/v1/expiry/items/1/status')).toHaveLength(1),
      );
      await user.click(await panel.findByRole('button', { name: mn.expiry.panel.restore }));
      expect(await panel.findByLabelText(FLOOR)).toHaveValue('12');
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
      // A search's Enter out of habit saves nothing while a person is still to be ticked.
      await user.type(
        dialog.getByRole('searchbox', { name: mn.expiry.liability.peopleFilter }),
        'дор{Enter}',
      );
      expect(calls(fetchMock, 'PUT', '/api/v1/expiry/items/1/liability')).toHaveLength(0);
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

    it('calls a record naming its people in the note by its type, «not set» only without', async () => {
      vi.spyOn(window, 'print').mockImplementation(() => undefined);
      const carried: Item = {
        ...ITEM,
        liability: { type: 'SPECIFIC', roles: [], users: [], note: 'Хуучин: ахлах нярав' },
      };
      const unnamed: Item = {
        ...SECOND,
        liability: { type: 'SPECIFIC', roles: [], users: [], note: null },
      };
      const fetchMock = signedIn(ADMIN_ME, {
        ...ROUTES,
        'GET /api/v1/expiry/items': () => page([carried, unnamed]),
      });
      renderApp(`${PAGE}/print?format=a4`, fetchMock);
      const rowOf = async (name: string) =>
        within((await screen.findByText(name)).closest('tr') as HTMLElement);

      const first = await rowOf(carried.product.name);
      expect(first.getByText(mn.expiry.liabilityType.SPECIFIC)).toBeInTheDocument();
      expect(first.getByText('Хуучин: ахлах нярав')).toBeInTheDocument();
      expect(first.queryByText(mn.expiry.liability.unset)).toBeNull();
      const second = await rowOf(unnamed.product.name);
      expect(second.getByText(mn.expiry.liability.unset)).toBeInTheDocument();
      cleanup();
    });
  });
});
