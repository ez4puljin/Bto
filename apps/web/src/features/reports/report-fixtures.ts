import { addMonths } from '@tugeel/shared/time';
import type {
  Aging,
  AgingItems,
  Dashboard,
  ProfitReport,
  SalesDocuments,
  StockReport,
  StockReportRow,
  SupplierEntries,
  SupplierReport,
  SupplierReportRow,
} from './api';

/* Fictitious figures for the management report tests (ADR-0108); no real company data. */

export const REFRESH_STATE = { refreshedAt: '2026-10-24T06:05:00.000Z', durationMs: 120 };

export const DASHBOARD: Dashboard = {
  month: '2026-10',
  running: true,
  current: { from: '2026-10-01', to: '2026-10-24' },
  previous: { from: '2026-09-01', to: '2026-09-24' },
  lastYear: { from: '2025-10-01', to: '2025-10-24' },
  today: '2026-10-24',
  refreshedAt: '2026-10-24T06:05:00.000Z',
  margins: true,
  threshold: '8.0',
  sales: { current: '1200000.00', previous: '1000000.00', lastYear: '0.00' },
  wholesale: '900000.00',
  pos: '300000.00',
  returns: '15000.00',
  grossProfit: { current: '180000.00', previous: '200000.00', lastYear: null },
  margin: { current: '15.0', previous: '20.0', lastYear: null },
  receivables: { current: '550000.00', previous: '500000.00', lastYear: '600000.00' },
  overdue: '120000.00',
  overdueCustomers: 7,
  stockValue: { current: '3000000.00', previous: '2900000.00', lastYear: null },
  turnoverDays: 42,
  trend: Array.from({ length: 12 }, (_, index) => ({
    month: addMonths('2026-10-01', index - 11).slice(0, 7),
    sales: `${(index + 1) * 100000}.00`,
    lastYearSales: `${(index + 1) * 80000}.00`,
    grossProfit: `${(index + 1) * 15000}.00`,
  })),
  categories: [
    {
      categoryId: 4,
      name: 'Туршилтын ундаа',
      sales: '700000.00',
      grossProfit: '35000.00',
      margin: '5.0',
      previousMargin: '9.0',
    },
    {
      categoryId: 5,
      name: 'Туршилтын гурил',
      sales: '500000.00',
      grossProfit: '145000.00',
      margin: '29.0',
      previousMargin: '28.0',
    },
  ],
  alerts: {
    overdue: [
      {
        partyId: 31,
        customerId: 21,
        name: 'Туршилтын дэлгүүр А',
        overdue: '80000.00',
        oldestDueDate: '2026-09-20',
      },
    ],
    lowStock: [
      {
        productId: 101,
        sku: 'T-0001',
        name: 'Туршилтын бараа 1',
        warehouseId: 1,
        warehouseName: 'Төв агуулах',
        onHand: '3.000',
        minQty: '10.000',
      },
    ],
    lowStockCount: 12,
    fallingCategories: [
      {
        categoryId: 4,
        name: 'Туршилтын ундаа',
        sales: '700000.00',
        grossProfit: '35000.00',
        margin: '5.0',
        previousMargin: '9.0',
      },
    ],
    topRep: { userId: 9, name: 'Төлөөлөгч Бат', sales: '450000.00', share: '50.0' },
  },
};

/** The same month as a user without costs sees it. */
export const DASHBOARD_NO_MARGINS: Dashboard = {
  ...DASHBOARD,
  margins: false,
  grossProfit: null,
  margin: null,
  stockValue: null,
  categories: DASHBOARD.categories.map((row) => ({
    ...row,
    grossProfit: null,
    margin: null,
    previousMargin: null,
  })),
  trend: DASHBOARD.trend.map((point) => ({ ...point, grossProfit: null })),
  alerts: { ...DASHBOARD.alerts, fallingCategories: [] },
};

const buckets = (notDue: string, d1: string, d31: string, d61: string, d90: string) => ({
  NOT_DUE: notDue,
  D1_30: d1,
  D31_60: d31,
  D61_90: d61,
  D90_PLUS: d90,
});

export const AGING: Aging = {
  date: '2026-10-24',
  rows: [
    {
      partyId: 31,
      customerId: 21,
      code: 'C-0021',
      name: 'Туршилтын дэлгүүр А',
      settlementGroup: 'DAY_20',
      buckets: buckets('100000.00', '50000.00', '30000.00', '0.00', '0.00'),
      credit: '0.00',
      total: '180000.00',
      overdue: '80000.00',
      oldestDueDate: '2026-09-20',
    },
    {
      partyId: 32,
      customerId: 22,
      code: 'C-0022',
      name: 'Туршилтын дэлгүүр Б',
      settlementGroup: 'MONTH_END',
      buckets: buckets('20000.00', '0.00', '0.00', '0.00', '5000.00'),
      credit: '-1000.00',
      total: '24000.00',
      overdue: '5000.00',
      oldestDueDate: '2026-06-30',
    },
  ],
  totals: buckets('120000.00', '50000.00', '30000.00', '0.00', '5000.00'),
  credit: '-1000.00',
  total: '204000.00',
  overdue: '85000.00',
};

export const AGING_ITEMS: AgingItems = {
  data: [
    {
      itemId: 501,
      side: 'DEBIT',
      documentNumber: 'Н-20260915-0007',
      documentClass: 'SALES_INVOICE',
      invoiceId: 77,
      itemDate: '2026-09-15',
      dueDate: '2026-09-20',
      daysOverdue: 34,
      bucket: 'D31_60',
      amount: '30000.00',
      openAmount: '30000.00',
    },
  ],
};

export const PROFIT: ProfitReport = {
  from: '2026-10-01',
  to: '2026-10-24',
  by: 'customer',
  threshold: '8.0',
  rows: [
    {
      kind: 'CUSTOMER',
      id: 21,
      code: 'C-0021',
      name: 'Туршилтын дэлгүүр А',
      qty: null,
      sales: '500000.00',
      returns: '0.00',
      cost: '480000.00',
      profit: '20000.00',
      margin: '4.0',
      flagged: true,
    },
    {
      kind: 'POS',
      id: null,
      code: null,
      name: null,
      qty: null,
      sales: '300000.00',
      returns: '2000.00',
      cost: '240000.00',
      profit: '60000.00',
      margin: '20.0',
      flagged: false,
    },
  ],
  totals: {
    sales: '800000.00',
    returns: '2000.00',
    cost: '720000.00',
    profit: '80000.00',
    margin: '10.0',
  },
  others: null,
};

export const SALES_DOCUMENTS: SalesDocuments = {
  from: '2026-10-01',
  to: '2026-10-24',
  more: false,
  rows: [
    {
      kind: 'INVOICE',
      id: 88,
      number: 'Н-20261010-0003',
      date: '2026-10-10',
      orderId: 41,
      customerId: 21,
      customerName: 'Туршилтын дэлгүүр А',
      sales: '500000.00',
      cost: '480000.00',
      profit: '20000.00',
      margin: '4.0',
    },
  ],
};

const stockRow = (index: number): StockReportRow => ({
  productId: 100 + index,
  sku: `T-${String(index).padStart(4, '0')}`,
  name: `Туршилтын бараа ${index}`,
  categoryName: 'Туршилтын ангилал',
  onHand: '25.000',
  value: '50000.00',
  soldQty: '3.000',
  coverDays: 750,
  lastSaleDate: '2026-07-01',
  daysSinceSale: 115,
  slow: index % 2 === 0,
  low: false,
  minQty: null,
});

const STOCK_TOTALS = {
  products: 3,
  value: '150000.00',
  slowProducts: 1,
  slowValue: '50000.00',
  lowProducts: 0,
};

export const STOCK_PAGE_1: StockReport = {
  date: '2026-10-24',
  slowDays: 90,
  rows: [stockRow(1), stockRow(2)],
  nextOffset: 2,
  totals: STOCK_TOTALS,
};

export const STOCK_PAGE_2: StockReport = {
  ...STOCK_PAGE_1,
  rows: [stockRow(3)],
  nextOffset: null,
};

const supplierRow = (index: number): SupplierReportRow => ({
  partyId: 200 + index,
  supplierId: 300 + index,
  code: `S-${String(index).padStart(3, '0')}`,
  name: `Туршилтын нийлүүлэгч ${index}`,
  purchases: `${(13 - index) * 100000}.00`,
  purchasesExVat: `${(13 - index) * 90909}.09`,
  otherBills: '0.00',
  payments: '50000.00',
  balance: '10000.00',
});

/** Twelve suppliers, largest purchases first: the chart keeps the first ten. */
export const SUPPLIERS: SupplierReport = {
  from: '2026-10-01',
  to: '2026-10-24',
  rows: Array.from({ length: 12 }, (_, index) => supplierRow(index + 1)),
  totals: {
    purchases: '7800000.00',
    purchasesExVat: '7090908.08',
    otherBills: '0.00',
    payments: '600000.00',
    balance: '120000.00',
  },
};

export const SUPPLIER_ENTRIES: SupplierEntries = {
  data: [
    {
      entryId: 901,
      date: '2026-10-05',
      kind: 'PURCHASE',
      number: 'О-20261005-0001',
      receiptId: 61,
      amount: '1200000.00',
      vatAmount: '109090.91',
      reversal: false,
    },
    {
      entryId: 902,
      date: '2026-10-12',
      kind: 'PAYMENT',
      number: 'Ж-20261012-0004',
      receiptId: null,
      amount: '-50000.00',
      vatAmount: '0.00',
      reversal: false,
    },
  ],
};
