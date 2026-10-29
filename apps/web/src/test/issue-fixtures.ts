import type { components } from '@tugeel/api-client';
import { COLA, SHELF, STAMP, WH1 } from '@/test/inventory-fixtures';

/** Shared data of the goods-issue page tests (ADR-0117): the types, a line, a draft, a sent and a posted issue. */
type Schemas = components['schemas'];
type Detail = Schemas['IssueDetail'];

export const TYPES: Schemas['IssueExpenseType'][] = [
  { id: 1, name: 'Дотоод хэрэглээ', code: 'INTERNAL_USE', active: true, sortOrder: 10 },
  { id: 2, name: 'Урамшуулал', code: 'BONUS', active: true, sortOrder: 20 },
  { id: 3, name: 'Хуучин төрөл', code: null, active: false, sortOrder: 30 },
  { id: 7, name: 'Хүнд тооцох', code: 'DAMAGE_CHARGE', active: true, sortOrder: 70 },
];

export const LINE: Schemas['IssueLine'] = {
  id: 1,
  productId: COLA.id,
  productSku: COLA.sku,
  productName: COLA.name,
  productUnitId: 77,
  unitName: 'хайрцаг',
  enteredQty: '1',
  factorSnapshot: '24',
  qtyBase: '24',
  warehouseId: 1,
  warehouseName: WH1.name,
  binId: null,
  binCode: null,
  checkedAt: null,
  saleUnitPrice: null,
  saleAmount: null,
};

export const DRAFT: Detail = {
  id: 7,
  number: null,
  warehouseId: 1,
  warehouseName: WH1.name,
  issuedOn: '2026-10-18',
  expenseTypeId: 1,
  expenseTypeName: 'Дотоод хэрэглээ',
  expenseTypeCode: 'INTERNAL_USE',
  recipientKind: 'OTHER',
  recipientUserId: null,
  recipientCustomerId: null,
  recipientSupplierId: null,
  recipientName: 'Бат',
  status: 'DRAFT',
  note: null,
  sentAt: null,
  returnNote: null,
  returnedAt: null,
  returnedBy: null,
  correctsIssueId: null,
  correctsIssueNumber: null,
  correctedByIssueId: null,
  correctedByIssueNumber: null,
  effectiveDate: null,
  postedAt: null,
  createdAt: STAMP,
  updatedAt: STAMP,
  lines: [LINE],
  warehouses: [
    { warehouseId: 1, warehouseName: WH1.name, lineCount: 1, checkedCount: 0, confirmed: false },
  ],
  confirmations: [],
  saleTotal: null,
};

export const SENT: Detail = { ...DRAFT, status: 'SENT', sentAt: STAMP };

export const POSTED: Detail = {
  ...DRAFT,
  status: 'POSTED',
  number: 'GI-2026-000001',
  effectiveDate: '2026-10-18',
  postedAt: STAMP,
  lines: [{ ...LINE, binId: SHELF.id, binCode: SHELF.code, checkedAt: STAMP }],
  warehouses: [
    { warehouseId: 1, warehouseName: WH1.name, lineCount: 1, checkedCount: 1, confirmed: true },
  ],
  confirmations: [
    {
      warehouseId: 1,
      warehouseName: WH1.name,
      confirmedBy: 'Нярав Дорж',
      confirmedAt: STAMP,
      unchanged: false,
    },
  ],
};

export const summary = (id: number): Schemas['IssueSummary'] => ({
  id,
  number: `GI-2026-00000${id}`,
  warehouseId: 1,
  issuedOn: '2026-10-18',
  expenseTypeId: 2,
  expenseTypeName: 'Урамшуулал',
  recipientKind: 'CUSTOMER',
  recipientName: 'Номин дэлгүүр',
  status: 'POSTED',
  lineCount: 3,
  warehouseIds: [1],
  confirmedWarehouseIds: [1],
  correctsIssueId: null,
  effectiveDate: '2026-10-18',
  createdAt: STAMP,
});
