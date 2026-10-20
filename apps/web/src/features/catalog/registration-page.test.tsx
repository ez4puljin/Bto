import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent, { type UserEvent } from '@testing-library/user-event';
import type { components } from '@tugeel/api-client';
import { gtinCheckDigit } from '@tugeel/shared/gtin';
import mn from '@tugeel/shared/i18n/mn.json';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as ImageResize from '@/lib/image-resize';
import { ADMIN_ME, json, problem, renderApp, signedIn, WORKER_ME } from '@/test/render-app';

type Schemas = components['schemas'];

// The browser's image decoding and the presigned PUT are outside jsdom: photos "upload" here.
const mocks = vi.hoisted(() => ({ uploads: 0 }));
vi.mock('@/lib/image-resize', async (importOriginal) => ({
  ...(await importOriginal<typeof ImageResize>()),
  resizeToJpeg: vi.fn(() => Promise.resolve(new Blob(['jpeg'], { type: 'image/jpeg' }))),
}));
vi.mock('@/lib/upload', () => ({
  uploadFile: vi.fn(() => {
    mocks.uploads += 1;
    return Promise.resolve(500 + mocks.uploads);
  }),
}));

const STAMP = '2026-10-01T02:00:00.000Z';
const list = <T,>(data: T[]) => json({ data, nextCursor: null });
const ean = (body: string) => `${body}${gtinCheckDigit(body)}`;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

const UOMS: Schemas['Uom'][] = [
  { id: 1, code: 'PCS', name: 'ш', fractional: false, measureUnit: null },
  { id: 2, code: 'BLOCK', name: 'блок', fractional: false, measureUnit: null },
  { id: 3, code: 'BOX', name: 'хайрцаг', fractional: false, measureUnit: null },
  { id: 4, code: 'KG', name: 'кг', fractional: true, measureUnit: null },
];
const category = (
  id: number,
  name: string,
  parentId: number | null,
  range: [string, string] | null,
): Schemas['Category'] => ({
  id,
  parentId,
  name,
  defaultClassificationCode: null,
  skuFrom: range?.[0] ?? null,
  skuTo: range?.[1] ?? null,
  productCount: 0,
  childCount: 0,
  imageUrl: null,
});
const CATEGORIES = [
  category(12, 'Ундаа', null, ['10000', '19999']),
  category(13, 'Ус', 12, null),
  category(20, 'Бусад', null, null),
];
const WAREHOUSE: Schemas['Warehouse'] = {
  id: 4,
  code: 'WH1',
  name: 'Мөрөн бөөний агуулах',
  kind: 'WHOLESALE',
  branchId: 1,
  status: 'ACTIVE',
  createdAt: STAMP,
  updatedAt: STAMP,
};
const SUPPLIER: Schemas['SupplierListItem'] = {
  id: 9,
  code: 'S0009',
  name: 'МСМ ХХК',
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
  productCount: 0,
};

const MASTERS = {
  'GET /api/v1/uoms': () => list(UOMS),
  'GET /api/v1/categories': () => list(CATEGORIES),
  'GET /api/v1/warehouses': () => list([WAREHOUSE]),
  'GET /api/v1/suppliers': () => list([SUPPLIER]),
};

/** Types a long value in one go (a scanner or a paste), much faster than key by key. */
async function fillIn(user: UserEvent, label: string, text: string) {
  await user.click(screen.getByLabelText(label));
  await user.paste(text);
}

const calls = (fetchMock: ReturnType<typeof signedIn>, method: string, path: string) =>
  fetchMock.mock.calls
    .map(([request]) => request)
    .filter((request) => request.method === method && new URL(request.url).pathname === path);

describe('product registration', () => {
  beforeEach(() => {
    mocks.uploads = 0;
    URL.createObjectURL = vi.fn(() => 'blob:preview');
    URL.revokeObjectURL = vi.fn();
  });
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('keeps the page from a user without the register permission', async () => {
    const fetchMock = signedIn(WORKER_ME, {});
    renderApp('/catalog/products/new', fetchMock);
    expect(await screen.findByText(mn.errors.FORBIDDEN)).toBeInTheDocument();
    expect(fetchMock.mock.calls.map(([request]) => new URL(request.url).pathname)).not.toContain(
      '/api/v1/categories',
    );
  });

  it('reads barcode digits typed through the Mongolian keyboard layout', async () => {
    renderApp('/catalog/products/new', signedIn(ADMIN_ME, MASTERS));
    const input = await screen.findByLabelText(mn.catalog.registration.baseBarcodes);
    fireEvent.keyDown(input, { key: '№', code: 'Digit1' });
    fireEvent.keyDown(input, { key: '₮', code: 'Digit4' });
    expect(input).toHaveValue('14');
  });

  it('suggests the code from the category range and checks the form before saving', async () => {
    const fetchMock = signedIn(ADMIN_ME, {
      ...MASTERS,
      'GET /api/v1/products/next-sku': (request) =>
        json({
          sku: new URL(request.url).searchParams.get('categoryId') === '20' ? '30000' : '10024',
        }),
    });
    renderApp('/catalog/products/new', fetchMock);
    const user = userEvent.setup();

    const sku = await screen.findByLabelText(mn.catalog.product.sku);
    expect(sku).toHaveValue('');
    expect(screen.getByText(mn.catalog.registration.skuHintPick)).toBeInTheDocument();
    await user.selectOptions(screen.getByLabelText(mn.catalog.product.category), '20');
    await waitFor(() => expect(sku).toHaveValue('30000'));
    expect(screen.getByText(mn.catalog.registration.skuHintFree)).toBeInTheDocument();
    // Ус has no range of its own: its parent's range gives the code.
    await user.selectOptions(screen.getByLabelText(mn.catalog.product.category), '13');
    await waitFor(() => expect(sku).toHaveValue('10024'));
    expect(screen.getByText(/«Ундаа».*10000–19999/)).toBeInTheDocument();

    // The box is its own field: never a base unit, never an extra unit.
    const base = screen.getByLabelText(mn.catalog.product.baseUnit);
    expect(within(base).queryByRole('option', { name: 'хайрцаг' })).toBeNull();
    await user.click(screen.getByRole('button', { name: mn.catalog.product.addUnit }));
    const extra = screen.getByLabelText(mn.catalog.product.unit);
    expect(within(extra).queryByRole('option', { name: 'хайрцаг' })).toBeNull();
    expect(within(extra).queryByRole('option', { name: 'ш' })).toBeNull();
    await user.click(screen.getByRole('button', { name: mn.catalog.product.removeUnit }));

    const pieceCode = ean('865000100001');
    await fillIn(user, mn.catalog.registration.baseBarcodes, pieceCode);
    await user.keyboard('{Enter}');
    await fillIn(user, mn.catalog.registration.boxBarcodes, pieceCode);
    await user.keyboard('{Enter}');
    expect(await screen.findByText(mn.validation.barcodeRepeated)).toBeInTheDocument();

    await fillIn(user, mn.catalog.registration.boxFactor, '2.5');
    await user.click(screen.getByRole('button', { name: mn.common.save }));
    expect(await screen.findByText(mn.validation.factor)).toBeInTheDocument();
    expect(screen.getByText(mn.validation.photoRequired)).toBeInTheDocument();
    expect(screen.getAllByText(mn.validation.required).length).toBeGreaterThanOrEqual(2);
    expect(calls(fetchMock, 'POST', '/api/v1/product-registrations')).toHaveLength(0);
  }, 15_000);

  it('registers with a photo, refreshes a taken code and starts the next product', async () => {
    const posted: { key: string | null; body: unknown }[] = [];
    let next = 10024;
    const fetchMock = signedIn(ADMIN_ME, {
      ...MASTERS,
      'GET /api/v1/products/next-sku': () => json({ sku: `${next}` }),
      'POST /api/v1/product-registrations': async (request) => {
        posted.push({ key: request.headers.get('Idempotency-Key'), body: await request.json() });
        if (posted.length === 1) {
          next = 10025;
          return problem('DUPLICATE_VALUE', 409, { constraint: 'products_sku_key' });
        }
        next = 10026;
        return json({ productId: 8, sku: '10025', name: 'Цэвэр ус 0.5 л' }, 201);
      },
    });
    renderApp('/catalog/products/new', fetchMock);
    const user = userEvent.setup();

    const sku = await screen.findByLabelText(mn.catalog.product.sku);
    await user.selectOptions(screen.getByLabelText(mn.catalog.product.category), '13');
    await waitFor(() => expect(sku).toHaveValue('10024'));
    await fillIn(user, mn.catalog.product.name, 'Цэвэр ус 0.5 л');
    await fillIn(user, mn.catalog.registration.boxFactor, '12');
    const pieceCode = ean('865000100001');
    await fillIn(user, mn.catalog.registration.baseBarcodes, pieceCode);
    await user.keyboard('{Enter}');
    await user.type(screen.getByLabelText(mn.catalog.registration.supplier), 'МСМ');
    await user.click(await screen.findByRole('button', { name: /МСМ ХХК/ }));
    expect(screen.getByLabelText(mn.catalog.registration.supplier)).toHaveValue('МСМ ХХК · S0009');
    // The only wholesale warehouse the registrar may write for is chosen already.
    expect(screen.getByLabelText(mn.catalog.registration.homeWarehouse)).toHaveValue('4');
    await fillIn(user, mn.catalog.registration.fixedBin, 'a-01');
    await user.upload(
      screen.getByLabelText(mn.catalog.registration.photos),
      new File(['photo'], 'water.jpg', { type: 'image/jpeg' }),
    );
    expect(await screen.findByAltText('1-р зураг')).toBeInTheDocument();

    // Another registrar took 10024 meanwhile: the next free code replaces it.
    await user.click(screen.getByRole('button', { name: mn.common.save }));
    expect(await screen.findByText(mn.validation.skuTakenNext)).toBeInTheDocument();
    await waitFor(() => expect(sku).toHaveValue('10025'));
    await user.click(screen.getByRole('button', { name: mn.common.save }));

    expect(await screen.findByText(/10025 · Цэвэр ус 0.5 л/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: mn.catalog.registration.view })).toHaveAttribute(
      'href',
      '/catalog/products/8',
    );
    expect(posted).toHaveLength(2);
    expect(posted[0]?.key).toMatch(UUID);
    expect(posted[1]?.key).toBe(posted[0]?.key);
    expect(posted[1]?.body).toEqual({
      sku: '10025',
      name: 'Цэвэр ус 0.5 л',
      categoryId: 13,
      baseUomId: 1,
      weightKg: null,
      baseBarcodes: [pieceCode],
      boxFactor: '12',
      boxBarcodes: [],
      units: [],
      supplierId: 9,
      homeWarehouseId: 4,
      fixedBinCode: 'a-01',
      images: [{ imageFileId: 501, thumbFileId: 502 }],
    });

    // The next product: category, supplier and home stay, the rest is empty, a new code follows.
    await waitFor(() => expect(sku).toHaveValue('10026'));
    expect(screen.getByLabelText(mn.catalog.product.name)).toHaveValue('');
    expect(screen.getByLabelText(mn.catalog.product.category)).toHaveValue('13');
    expect(screen.getByLabelText(mn.catalog.registration.supplier)).toHaveValue('МСМ ХХК · S0009');
    expect(screen.getByLabelText(mn.catalog.registration.homeWarehouse)).toHaveValue('4');
    expect(screen.getByLabelText(mn.catalog.registration.fixedBin)).toHaveValue('');
    expect(screen.queryByAltText('1-р зураг')).toBeNull();
  }, 15_000);

  it('shows an unknown shelf on its field', async () => {
    const fetchMock = signedIn(ADMIN_ME, {
      ...MASTERS,
      'GET /api/v1/products/next-sku': () => json({ sku: '30000' }),
      'POST /api/v1/product-registrations': () =>
        json(
          {
            type: 'https://tugeel.local/errors/VALIDATION_FAILED',
            title: 'VALIDATION_FAILED',
            status: 422,
            code: 'VALIDATION_FAILED',
            errors: [{ path: 'fixedBinCode', constraint: 'shelf', message: 'a shelf' }],
          },
          422,
        ),
    });
    renderApp('/catalog/products/new', fetchMock);
    const user = userEvent.setup();
    await user.selectOptions(await screen.findByLabelText(mn.catalog.product.category), '20');
    await waitFor(() => expect(screen.getByLabelText(mn.catalog.product.sku)).toHaveValue('30000'));
    await fillIn(user, mn.catalog.product.name, 'Саван');
    await fillIn(user, mn.catalog.registration.boxFactor, '24');
    await user.type(screen.getByLabelText(mn.catalog.registration.supplier), 'МСМ');
    await user.click(await screen.findByRole('button', { name: /МСМ ХХК/ }));
    await fillIn(user, mn.catalog.registration.fixedBin, 'Z-99');
    await user.upload(
      screen.getByLabelText(mn.catalog.registration.photos),
      new File(['photo'], 'soap.png', { type: 'image/png' }),
    );
    await screen.findByAltText('1-р зураг');
    await user.click(screen.getByRole('button', { name: mn.common.save }));
    expect(await screen.findByText(mn.validation.shelfNotFound)).toBeInTheDocument();
    expect(screen.queryByText(mn.errors.VALIDATION_FAILED)).toBeNull();
  });
});
