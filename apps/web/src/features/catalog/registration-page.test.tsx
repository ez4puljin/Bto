import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent, { type UserEvent } from '@testing-library/user-event';
import type { components } from '@tugeel/api-client';
import { gtinCheckDigit } from '@tugeel/shared/gtin';
import mn from '@tugeel/shared/i18n/mn.json';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as ImageResize from '@/lib/image-resize';
import type * as ProductPicture from '@/lib/product-picture';
import { ADMIN_ME, json, problem, renderApp, signedIn, WORKER_ME } from '@/test/render-app';

type Schemas = components['schemas'];

// The browser's image decoding and the presigned PUT are outside jsdom: photos "upload" here.
const mocks = vi.hoisted(() => ({
  uploads: 0,
  kinds: [] as string[],
  composed: [] as { box: unknown; stamped: boolean }[],
}));
vi.mock('@/lib/image-resize', async (importOriginal) => ({
  ...(await importOriginal<typeof ImageResize>()),
  resizeToJpeg: vi.fn(() => Promise.resolve(new Blob(['jpeg'], { type: 'image/jpeg' }))),
}));
vi.mock('@/lib/upload', () => ({
  uploadFile: vi.fn((_api: unknown, kind: string) => {
    mocks.uploads += 1;
    mocks.kinds.push(kind);
    return Promise.resolve(500 + mocks.uploads);
  }),
}));
// The cut-out is drawn on a canvas, which jsdom does not have: the picture is "made" here.
vi.mock('@/lib/product-picture', async (importOriginal) => ({
  ...(await importOriginal<typeof ProductPicture>()),
  composeProductPicture: vi.fn((_cut: Blob, box: unknown, stamp: Blob | null) => {
    mocks.composed.push({ box, stamped: stamp !== null });
    return Promise.resolve(new Blob(['made'], { type: 'image/jpeg' }));
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
  iconKey: null,
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
  categoryId: null,
  categoryPath: null,
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
    mocks.kinds.length = 0;
    mocks.composed.length = 0;
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

  describe('«AI ашиглах» (ADR-0198)', () => {
    const A = mn.catalog.registration.ai;
    const pieceCode = ean('865000100001');
    const takenCode = ean('865000100009');
    const PROPOSAL: Schemas['ProductAiProposal'] = {
      name: 'Цэвэр ус 0.5л',
      categoryId: 13,
      categoryPath: 'Ундаа / Ус',
      baseUomId: 1,
      boxFactor: '12',
      weightKg: '0.5',
      baseBarcodes: [pieceCode, takenCode],
      boxBarcodes: [],
      units: [{ uomId: 2, factorToBase: '6', barcodes: [] }],
      supplier: { id: 9, code: 'S0009', name: 'МСМ ХХК' },
      frontPhoto: 1,
      frontPhotoFileId: 502,
      productBox: { left: 0.1, top: 0.1, width: 0.6, height: 0.8 },
      droppedBarcodes: 1,
      existing: [{ code: takenCode, productId: 77, sku: '900', name: 'Хуучин ус 1л' }],
      note: 'Хайрцагны баркод харагдсангүй.',
    };
    const photos = () => [
      new File(['back'], 'back.jpg', { type: 'image/jpeg' }),
      new File(['front'], 'front.jpg', { type: 'image/jpeg' }),
    ];
    const aiRoutes = (status: Schemas['ProductAiStatus']) => ({
      ...MASTERS,
      'GET /api/v1/products/next-sku': () => json({ sku: '10024' }),
      'GET /api/v1/product-registrations/ai': () => json(status),
    });

    it('fills the form from the photos and puts the cut-out picture first', async () => {
      const sent: { read: unknown; picture: unknown; registration: unknown } = {
        read: null,
        picture: null,
        registration: null,
      };
      const fetchMock = signedIn(ADMIN_ME, {
        ...aiRoutes({ read: true, picture: true }),
        'POST /api/v1/product-registrations/ai/read': async (request) => {
          sent.read = await request.json();
          return json(PROPOSAL);
        },
        'POST /api/v1/product-registrations/ai/picture': async (request) => {
          sent.picture = await request.json();
          return json({
            image: 'iVBORw0KGgo=',
            stamp: { data: 'iVBORw0KGgo=', mediaType: 'image/png' },
          });
        },
        'POST /api/v1/product-registrations': async (request) => {
          sent.registration = await request.json();
          return json({ productId: 8, sku: '10024', name: PROPOSAL.name }, 201);
        },
      });
      renderApp('/catalog/products/new', fetchMock);
      const user = userEvent.setup();

      const button = await screen.findByRole('button', { name: A.button });
      await waitFor(() => expect(button).toBeEnabled());
      await user.upload(screen.getByLabelText(A.choose), photos());

      // The proposal is on the form, for the registrar to check.
      await waitFor(() =>
        expect(screen.getByLabelText(mn.catalog.product.name)).toHaveValue('Цэвэр ус 0.5л'),
      );
      expect(screen.getByLabelText(mn.catalog.product.category)).toHaveValue('13');
      await waitFor(() =>
        expect(screen.getByLabelText(mn.catalog.product.sku)).toHaveValue('10024'),
      );
      expect(screen.getByLabelText(mn.catalog.registration.boxFactor)).toHaveValue('12');
      expect(screen.getByLabelText(mn.catalog.product.weight)).toHaveValue('0.5');
      expect(screen.getByLabelText(mn.catalog.registration.supplier)).toHaveValue(
        'МСМ ХХК · S0009',
      );
      expect(screen.getByLabelText(mn.catalog.product.factor)).toHaveValue('6');
      expect(await screen.findByText(/AI бөглөсөн: ангилал, нэр, суурь нэгж/)).toBeInTheDocument();
      expect(screen.getByText(/Хайрцагны баркод харагдсангүй/)).toBeInTheDocument();
      // A barcode a product already carries is named, with a way to that product, and left out.
      expect(
        screen.getByText(new RegExp(`${takenCode} баркод «900 · Хуучин ус 1л»`)),
      ).toBeInTheDocument();
      expect(await screen.findByText(A.picture.made)).toBeInTheDocument();
      expect(await screen.findByAltText('1-р зураг')).toBeInTheDocument();

      // Both photos were read; the model's front photo was cut out, with its place and the logo.
      expect(sent.read).toEqual({ photoFileIds: [501, 502] });
      expect(sent.picture).toEqual({ photoFileId: 502 });
      expect(mocks.composed).toEqual([{ box: PROPOSAL.productBox, stamped: true }]);
      expect(mocks.kinds).toEqual([
        'catalog.ai_photo',
        'catalog.ai_photo',
        'catalog.product_image',
        'catalog.product_thumb',
      ]);
      // Nothing was saved by the AI: only the registrar's «Хадгалах» registers.
      expect(calls(fetchMock, 'POST', '/api/v1/product-registrations')).toHaveLength(0);
      await waitFor(() =>
        expect(screen.getByLabelText(mn.catalog.registration.homeWarehouse)).toHaveValue('4'),
      );
      await user.click(screen.getByRole('button', { name: mn.common.save }));
      await waitFor(() => expect(sent.registration).not.toBeNull());
      expect(sent.registration).toEqual({
        sku: '10024',
        name: 'Цэвэр ус 0.5л',
        categoryId: 13,
        baseUomId: 1,
        weightKg: '0.5',
        baseBarcodes: [pieceCode],
        boxFactor: '12',
        boxBarcodes: [],
        units: [{ uomId: 2, factorToBase: '6', barcodes: [] }],
        supplierId: 9,
        homeWarehouseId: 4,
        fixedBinCode: null,
        images: [{ imageFileId: 503, thumbFileId: 504 }],
      });
    }, 20_000);

    it('says what is not set and leaves the form to the hands', async () => {
      const fetchMock = signedIn(ADMIN_ME, aiRoutes({ read: false, picture: false }));
      renderApp('/catalog/products/new', fetchMock);
      expect(await screen.findByText(A.off)).toBeInTheDocument();
      expect(screen.getByRole('button', { name: A.button })).toBeDisabled();
      // The form itself is as before.
      expect(screen.getByLabelText(mn.catalog.product.name)).toBeEnabled();
      expect(screen.getByRole('button', { name: mn.common.save })).toBeEnabled();
    });

    it('keeps the photo as taken when the model fails and no background service is set', async () => {
      const fetchMock = signedIn(ADMIN_ME, {
        ...aiRoutes({ read: true, picture: false }),
        'POST /api/v1/product-registrations/ai/read': () =>
          problem('AI_PROVIDER_FAILED', 502, { reason: 'TIMEOUT' }),
      });
      renderApp('/catalog/products/new', fetchMock);
      const user = userEvent.setup();
      expect(await screen.findByText(A.pictureOff)).toBeInTheDocument();
      await user.upload(screen.getByLabelText(A.choose), photos());

      expect(await screen.findByText(mn.errors.AI_PROVIDER_FAILED)).toBeInTheDocument();
      expect(screen.getByText(A.byHand)).toBeInTheDocument();
      expect(await screen.findByText(A.picture.original)).toBeInTheDocument();
      expect(await screen.findByAltText('1-р зураг')).toBeInTheDocument();
      expect(screen.getByLabelText(mn.catalog.product.name)).toHaveValue('');
      expect(calls(fetchMock, 'POST', '/api/v1/product-registrations/ai/picture')).toHaveLength(0);
      expect(mocks.composed).toHaveLength(0);
    }, 15_000);

    it('explains a background service out of credit and still selects the photo', async () => {
      const fetchMock = signedIn(ADMIN_ME, {
        ...aiRoutes({ read: false, picture: true }),
        'POST /api/v1/product-registrations/ai/picture': () =>
          problem('PICTURE_PROVIDER_FAILED', 502, {
            reason: 'HTTP',
            status: 402,
            providerCode: 'insufficient_credits',
          }),
      });
      renderApp('/catalog/products/new', fetchMock);
      const user = userEvent.setup();
      expect(await screen.findByText(A.readOff)).toBeInTheDocument();
      await user.upload(screen.getByLabelText(A.choose), photos());
      expect(await screen.findByText(A.pictureFailure.credit)).toBeInTheDocument();
      expect(await screen.findByText(A.picture.original)).toBeInTheDocument();
      expect(calls(fetchMock, 'POST', '/api/v1/product-registrations/ai/read')).toHaveLength(0);
    }, 15_000);
  });
});
