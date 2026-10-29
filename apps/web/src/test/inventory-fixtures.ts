import type { components } from '@tugeel/api-client';
import { SYSTEM_ROLE_PERMISSIONS } from '@tugeel/shared/auth';
import { ADMIN_ME, json, type Me, type signedIn } from '@/test/render-app';

/** Shared data of the inventory page tests: people, a warehouse, a shelf, Coca-Cola, a receipt. */
type Schemas = components['schemas'];

export const STAMP = '2026-10-11T02:00:00.000Z';
export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
export const list = <T>(data: T[], nextCursor: string | null = null) => json({ data, nextCursor });

export const WAREHOUSE_ME: Me = {
  ...ADMIN_ME,
  id: 2,
  username: 'nyarav',
  fullName: 'Нярав Дорж',
  permissions: [...SYSTEM_ROLE_PERMISSIONS.WAREHOUSE],
  roles: [{ id: 4, code: 'WAREHOUSE', name: null, isSystem: true }],
};
export const ACCOUNTANT_ME: Me = {
  ...ADMIN_ME,
  id: 3,
  username: 'nyagtlan',
  fullName: 'Нягтлан Сараа',
  permissions: [...SYSTEM_ROLE_PERMISSIONS.ACCOUNTANT],
  roles: [{ id: 5, code: 'ACCOUNTANT', name: null, isSystem: true }],
};

export const WH1: Schemas['Warehouse'] = {
  id: 1,
  code: 'WH1',
  name: 'Төв агуулах',
  kind: 'WHOLESALE',
  branchId: 1,
  status: 'ACTIVE',
  createdAt: STAMP,
  updatedAt: STAMP,
};
export const warehouses = () => list([WH1]);

export const SHELF: Schemas['Bin'] = {
  id: 31,
  warehouseId: 1,
  code: 'A-01-03',
  name: null,
  type: 'STORAGE',
  sellable: true,
  status: 'ACTIVE',
  isSystem: false,
  pickSequence: null,
  archivedAt: null,
};

export const COLA: Schemas['ProductSummary'] = {
  id: 10,
  sku: '10',
  name: 'Кока кола',
  categoryId: 1,
  status: 'ACTIVE',
  saleReadyAt: '2026-10-01T00:00:00.000Z',
  vatType: 'VAT_ABLE',
  cityTax: null,
  baseUnit: { id: 70, uomId: 1, uomName: 'ш' },
  thumbUrl: null,
};
export const COLA_BOX: Schemas['BarcodeResolution'] = {
  product: COLA,
  unit: { id: 77, uomId: 2, uomName: 'хайрцаг', factorToBase: '24', isBase: false },
  barcode: {
    id: 5,
    code: '4006381333931',
    gtin14: '04006381333931',
    barcodeType: 'GS1',
    isPrimary: true,
    isInternal: false,
  },
};

export const DRAFT: Schemas['ReceiptDetail'] = {
  id: 5,
  number: null,
  warehouses: [{ id: WH1.id, name: WH1.name }],
  supplierId: 3,
  supplierCode: '010',
  supplierName: 'МСМ ХХК',
  supplierDocNo: 'П-123',
  supplierDocDate: null,
  status: 'DRAFT',
  costingStatus: null,
  costingVersion: 0,
  recostUntil: null,
  note: null,
  paymentMethod: 'CREDIT',
  moneyAccountId: null,
  moneyAccountName: null,
  supplierVatPayer: false,
  vatRatePct: '0',
  effectiveDate: null,
  postedAt: null,
  createdAt: STAMP,
  updatedAt: STAMP,
  lines: [],
  weightKg: '0',
  weightMissing: 0,
  qtyBase: '0',
  uncheckedLines: 0,
  noteTotalQty: null,
  noteTotalAmount: null,
  hasNotePhoto: false,
  origin: 'MANUAL',
  originRef: null,
  confirmations: [],
};
export const BOX_LINE: Schemas['ReceiptLine'] = {
  id: 1,
  productId: COLA.id,
  productSku: COLA.sku,
  productName: COLA.name,
  productUnitId: 77,
  unitName: 'хайрцаг',
  enteredQty: '1',
  factorSnapshot: '24',
  qtyBase: '24',
  warehouseId: WH1.id,
  warehouseName: WH1.name,
  binId: SHELF.id,
  binCode: SHELF.code,
  lotId: null,
  weightKg: null,
  salePrice: null,
  expectedQty: null,
  checkedAt: STAMP,
  note: null,
};

export const calls = (fetchMock: ReturnType<typeof signedIn>, method: string, path: string) =>
  fetchMock.mock.calls
    .map(([request]) => request)
    .filter((request) => request.method === method && new URL(request.url).pathname === path);
export const bodyOf = async (request: Request | undefined) =>
  request ? ((await request.clone().json()) as unknown) : undefined;
