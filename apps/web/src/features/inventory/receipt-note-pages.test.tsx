import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { components } from '@tugeel/api-client';
import mn from '@tugeel/shared/i18n/mn.json';
import { describe, expect, it } from 'vitest';
import { bodyOf, calls } from '@/test/inventory-fixtures';
import { ADMIN_ME, json, problem, renderApp, signedIn } from '@/test/render-app';

type Schemas = components['schemas'];
const T = mn.inventory.noteReading;
const STAMP = '2026-11-17T03:00:00.000Z';

const UNITS = [
  { unitId: 7, name: 'ш', factor: '1' },
  { unitId: 8, name: 'хайрцаг', factor: '24' },
];

const line = (patch: Partial<Schemas['NoteLine']>): Schemas['NoteLine'] => ({
  index: 0,
  page: 1,
  name: 'Кола хайрцаг',
  code: null,
  unit: 'хайрцаг',
  barcode: null,
  qty: '5',
  unitPrice: '36000',
  amount: '180000',
  free: false,
  unsure: false,
  match: {
    how: 'BARCODE',
    productUnitId: 8,
    productId: 1,
    sku: '700',
    productName: 'Coca Cola 0.5л',
    units: UNITS,
  },
  ...patch,
});

const READY: Schemas['NoteReading'] = {
  id: 4,
  status: 'READY',
  stale: false,
  supplier: { id: 5, code: 'S005', name: 'МСМ ХХК' },
  pages: [
    { fileId: 31, contentType: 'image/jpeg' },
    { fileId: 32, contentType: 'application/pdf' },
  ],
  failure: null,
  receiptId: null,
  receiptNumber: null,
  createdByName: 'Нярав Дорж',
  createdAt: STAMP,
  proposal: {
    supplierRead: { name: 'МСМ ХХК', regNo: '2075385' },
    docNo: 'A-1042',
    docDate: '2026-11-17',
    totalQty: '18',
    totalAmount: '199500',
    vat: 'INCLUDED',
    cut: 0,
    remark: 'Гурав дахь мөрийн код бүдэг байна.',
    lines: [
      line({}),
      line({
        index: 1,
        name: 'Цэвэр ус',
        unit: 'ш',
        qty: '10',
        unitPrice: '1500',
        amount: '15000',
        unsure: true,
        match: {
          how: 'MODEL',
          productUnitId: 9,
          productId: 2,
          sku: '701',
          productName: 'Цэвэр ус 0.5л',
          units: [{ unitId: 9, name: 'ш', factor: '1' }],
        },
      }),
      line({
        index: 2,
        name: 'Кола задгай',
        code: 'CC-1',
        unit: 'ш',
        qty: '3',
        unitPrice: '1500',
        amount: '4500',
        match: null,
      }),
    ],
  },
  memory: { readings: 2, lines: 14, layout: true },
};

const STATUS: Schemas['NoteStatus'] = { read: true, scanners: [{ id: 1, name: 'Оффис' }] };

const SUMMARY: Schemas['NoteReadingSummary'] = {
  id: 4,
  status: 'READY',
  stale: false,
  supplierName: 'МСМ ХХК',
  pageCount: 2,
  lineCount: 3,
  createdByName: 'Нярав Дорж',
  createdAt: STAMP,
};

const KEEPER = {
  ...ADMIN_ME,
  permissions: ADMIN_ME.permissions.filter((code) => code !== 'inventory.setup.manage'),
};

describe('«Падаан унших» (ADR-0210)', () => {
  it('gathers the pages, says what can be done, and lists what waits to be checked', async () => {
    renderApp(
      '/inventory/receipts/notes',
      signedIn(KEEPER, {
        'GET /api/v1/receipt-notes/status': () => json(STATUS),
        'GET /api/v1/receipt-notes': () =>
          json([SUMMARY, { ...SUMMARY, id: 5, status: 'READING', lineCount: null }]),
      }),
    );
    expect(await screen.findByRole('heading', { name: T.title })).toBeInTheDocument();
    expect(screen.getByText(T.noPages)).toBeInTheDocument();
    // Nothing to read yet; the scanner is offered; its setup is not a keeper's.
    expect(screen.getByRole('button', { name: T.read })).toBeDisabled();
    expect(await screen.findByRole('button', { name: T.scan })).toBeEnabled();
    expect(screen.queryByRole('button', { name: T.scanners.open })).toBeNull();
    expect(await screen.findByText(T.status.READY)).toBeInTheDocument();
    expect(screen.getByText(T.status.READING)).toBeInTheDocument();
    expect(screen.getAllByRole('link', { name: 'МСМ ХХК' })[0]).toHaveAttribute(
      'href',
      '/inventory/receipts/notes/4',
    );
  });

  it('scans a sheet into the pages and reads them as one note', async () => {
    const user = userEvent.setup();
    const fetchMock = signedIn(KEEPER, {
      'GET /api/v1/receipt-notes/status': () => json(STATUS),
      'GET /api/v1/receipt-notes': () => json([]),
      'POST /api/v1/receipt-notes/scanners/1/scan': () =>
        json({ sheets: [{ fileId: 41, preview: 'AAAA' }] }),
      'POST /api/v1/receipt-notes': () =>
        json({ ...READY, status: 'READING', proposal: null }, 201),
    });
    renderApp('/inventory/receipts/notes', fetchMock);
    await user.click(await screen.findByRole('button', { name: T.scan }));
    const pages = await screen.findByRole('list', { name: T.pages });
    expect(within(pages).getAllByRole('listitem')).toHaveLength(1);
    // The button now adds a sheet; the note can be read.
    expect(screen.getByRole('button', { name: T.scanMore })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: T.read }));

    await waitFor(() => expect(calls(fetchMock, 'POST', '/api/v1/receipt-notes')).toHaveLength(1));
    const [scan] = calls(fetchMock, 'POST', '/api/v1/receipt-notes/scanners/1/scan');
    expect(await bodyOf(scan)).toEqual({ source: 'GLASS' });
    const [started] = calls(fetchMock, 'POST', '/api/v1/receipt-notes');
    expect(await bodyOf(started)).toEqual({ fileIds: [41], supplierId: null });
    expect(started?.headers.get('Idempotency-Key')).toBeTruthy();
    // The pages are gone: the next note can be gathered while this one is read.
    expect(await screen.findByText(T.noPages)).toBeInTheDocument();
  });

  it('says in the scanner’s own words why a scan failed', async () => {
    const user = userEvent.setup();
    renderApp(
      '/inventory/receipts/notes',
      signedIn(KEEPER, {
        'GET /api/v1/receipt-notes/status': () => json(STATUS),
        'GET /api/v1/receipt-notes': () => json([]),
        'POST /api/v1/receipt-notes/scanners/1/scan': () =>
          problem('SCANNER_FAILED', 502, { reason: 'NO_PAPER' }),
      }),
    );
    await user.click(await screen.findByRole('button', { name: T.scan }));
    expect(await screen.findByText(T.scanFailure.NO_PAPER)).toBeInTheDocument();
  });

  it('says so when no model is set, and reads nothing', async () => {
    renderApp(
      '/inventory/receipts/notes',
      signedIn(KEEPER, {
        'GET /api/v1/receipt-notes/status': () => json({ read: false, scanners: [] }),
        'GET /api/v1/receipt-notes': () => json([]),
      }),
    );
    expect(await screen.findByText(T.notConfigured, { exact: false })).toBeInTheDocument();
    expect(screen.getByText(T.noScanner)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: T.read })).toBeDisabled();
  });

  it('checks a read note line by line and saves it as a draft receipt', async () => {
    const user = userEvent.setup();
    const fetchMock = signedIn(ADMIN_ME, {
      'GET /api/v1/receipt-notes/4': () => json(READY),
      'POST /api/v1/receipt-notes/4/receipt': () => json({ receiptId: 77 }, 201),
    });
    renderApp('/inventory/receipts/notes/4', fetchMock);

    expect(await screen.findByDisplayValue('A-1042')).toBeInTheDocument();
    expect(screen.getByText(READY.proposal?.remark ?? '')).toBeInTheDocument();
    expect(screen.getByText(T.how.BARCODE)).toBeInTheDocument();
    expect(screen.getByText(T.how.MODEL)).toBeInTheDocument();
    expect(screen.getByText(T.unsure)).toBeInTheDocument();
    // One line has no product: nothing is saved until it is chosen or left out.
    const save = screen.getByRole('button', { name: T.save });
    expect(save).toBeDisabled();
    await user.click(screen.getByRole('checkbox', { name: /Кола задгай/ }));
    expect(save).toBeEnabled();

    // The keeper counted four boxes and the piece unit of the first line.
    const qty = screen.getByRole('textbox', { name: /«Кола хайрцаг» мөрийн тоо/ });
    await user.clear(qty);
    await user.type(qty, '4');
    await user.selectOptions(
      screen.getByRole('combobox', { name: /«Coca Cola 0.5л» барааны нэгж/ }),
      '7',
    );
    await user.click(save);

    await waitFor(() =>
      expect(calls(fetchMock, 'POST', '/api/v1/receipt-notes/4/receipt')).toHaveLength(1),
    );
    const [request] = calls(fetchMock, 'POST', '/api/v1/receipt-notes/4/receipt');
    expect(await bodyOf(request)).toEqual({
      supplierId: 5,
      supplierDocNo: 'A-1042',
      supplierDocDate: '2026-11-17',
      lines: [
        { index: 0, productUnitId: 7, enteredQty: '4' },
        { index: 1, productUnitId: 9, enteredQty: '10' },
      ],
    });
    expect(request?.headers.get('Idempotency-Key')).toBeTruthy();
  });

  it('shows a failed reading’s reason and reads it again on request', async () => {
    const user = userEvent.setup();
    const failed: Schemas['NoteReading'] = {
      ...READY,
      status: 'FAILED',
      proposal: null,
      failure: { reason: 'UNREADABLE_PAGE', status: 2, providerCode: null },
    };
    const fetchMock = signedIn(ADMIN_ME, {
      'GET /api/v1/receipt-notes/4': () => json(failed),
      'POST /api/v1/receipt-notes/4/retry': () =>
        json({ ...failed, status: 'READING', failure: null }),
    });
    renderApp('/inventory/receipts/notes/4', fetchMock);
    expect(
      await screen.findByText(T.failure.UNREADABLE_PAGE.replace('{{page}}', '2')),
    ).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: T.retry }));
    await waitFor(() =>
      expect(calls(fetchMock, 'POST', '/api/v1/receipt-notes/4/retry')).toHaveLength(1),
    );
    expect(await screen.findByText(T.readingHint)).toBeInTheDocument();
  });

  it('links a saved reading to the receipt it became', async () => {
    renderApp(
      '/inventory/receipts/notes/4',
      signedIn(ADMIN_ME, {
        'GET /api/v1/receipt-notes/4': () =>
          json({ ...READY, status: 'SAVED', receiptId: 77, receiptNumber: 'GR-2026-000077' }),
      }),
    );
    expect(await screen.findByRole('link', { name: 'GR-2026-000077' })).toHaveAttribute(
      'href',
      '/inventory/receipts/77',
    );
    expect(screen.queryByRole('button', { name: T.save })).toBeNull();
  });
});
