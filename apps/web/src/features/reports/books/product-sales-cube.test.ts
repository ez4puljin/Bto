import { describe, expect, it } from 'vitest';
import type { ProductSalesData } from './book-api';
import {
  buildCube,
  categoryTree,
  formatScaled,
  parseScaled,
  type SalesConditions,
  salesDocuments,
  salesReport,
} from './product-sales-cube';

const ALL: SalesConditions = { source: 'ALL', kind: 'ALL', brandIds: [], segmentIds: [] };
const NAMES = { none: 'Брэндгүй', app: 'Апп' };

/** Two products, a wholesale invoice and its credit note, a till sale paid half cash, half card. */
function data(): ProductSalesData {
  return {
    from: '2026-10-01',
    to: '2026-10-31',
    margins: true,
    lines: {
      doc: [0, 0, 1, 2, 2],
      product: [0, 1, 0, 0, 1],
      warehouse: [3, 3, 3, 6, 6],
      qty: ['10', '2', '-1', '3', '1.5'],
      sales: ['1000.00', '300.00', '-100.00', '333.33', '150.00'],
      returns: ['0', '0', '100.00', '0', '0'],
      cost: ['600.12345', '200', '-60', '210', '90'],
    },
    docs: [
      {
        kind: 'INVOICE',
        id: 11,
        number: 'INV-1',
        date: '2026-10-02',
        invoiceId: 11,
        customerId: 5,
        userId: 7,
        app: false,
        source: 'WHOLESALE',
        tenders: [{ key: 'AR', amount: '1' }],
      },
      {
        kind: 'CREDIT_NOTE',
        id: 12,
        number: 'CN-1',
        date: '2026-10-05',
        invoiceId: 11,
        customerId: 5,
        userId: 7,
        app: false,
        source: 'WHOLESALE',
        tenders: [{ key: 'AR', amount: '1' }],
      },
      {
        kind: 'POS_SALE',
        id: 21,
        number: 'POS-1',
        date: '2026-10-03',
        invoiceId: null,
        customerId: null,
        userId: 8,
        app: false,
        source: 'POS',
        tenders: [
          { key: 'T1', amount: '100' },
          { key: 'T2', amount: '100' },
        ],
      },
    ],
    products: [
      {
        id: 100,
        sku: 'A',
        name: 'Ус',
        unit: 'ш',
        categoryId: 2,
        brandId: 50,
        segmentIds: [1, 2],
      },
      { id: 101, sku: 'B', name: 'Шүүс', unit: 'ш', categoryId: 3, brandId: null, segmentIds: [] },
    ],
    customers: [{ id: 5, name: 'Дэлгүүр', categoryId: 9 }],
    names: {
      categories: [],
      brands: [{ id: 50, name: 'Брэнд А' }],
      segments: [
        { id: 1, name: 'С1' },
        { id: 2, name: 'С2' },
      ],
      users: [],
    },
    payments: [
      { key: 'AR', name: 'Авлага' },
      { key: 'T1', name: 'Бэлэн' },
      { key: 'T2', name: 'Карт' },
    ],
    truncated: false,
  };
}

describe('scaled numbers', () => {
  it('parses and rounds half up', () => {
    expect(parseScaled('12.345', 2)).toBe(1235n);
    expect(parseScaled('-12.345', 2)).toBe(-1235n);
    expect(formatScaled(-1235n, 2, 2)).toBe('-12.35');
    expect(formatScaled(5n, 3, 2)).toBe('0.01');
    expect(formatScaled(-4n, 3, 2)).toBe('0.00');
  });
});

describe('salesReport', () => {
  it('sums every line once, with cost, profit and margin', () => {
    const report = salesReport(buildCube(data()), ALL, 'none', false, NAMES);
    expect(report.totals).toMatchObject({
      sales: '1683.33',
      returns: '100.00',
      cost: '1040.12',
      profit: '643.21',
    });
    const water = report.rows.find((row) => row.productId === 100);
    expect(water).toMatchObject({
      qty: '12',
      sales: '1233.33',
      avgPrice: '102.78',
      margin: '39.2',
    });
  });

  it('splits a till sale by its tenders and the wholesale into «Авлага»', () => {
    const report = salesReport(buildCube(data()), ALL, 'none', true, NAMES);
    expect(report.payments.map((p) => p.key)).toEqual(['AR', 'T1', 'T2']);
    expect(report.totals.paid).toEqual([
      { key: 'AR', amount: '1200.00' },
      { key: 'T1', amount: '241.67' },
      { key: 'T2', amount: '241.67' },
    ]);
  });

  it('filters by source, kind, warehouse, customer group and category', () => {
    const cube = buildCube(data());
    expect(salesReport(cube, { ...ALL, source: 'POS' }, 'none', false, NAMES).totals.sales).toBe(
      '483.33',
    );
    expect(salesReport(cube, { ...ALL, kind: 'RETURNS' }, 'none', false, NAMES).totals.sales).toBe(
      '-100.00',
    );
    expect(salesReport(cube, { ...ALL, warehouseId: 3 }, 'none', false, NAMES).rows).toHaveLength(
      2,
    );
    expect(
      salesReport(cube, { ...ALL, customerCategoryId: 9 }, 'none', false, NAMES).totals.sales,
    ).toBe('1200.00');
    const tree = categoryTree(
      [
        { id: 1, parentId: null },
        { id: 2, parentId: 1 },
        { id: 3, parentId: 2 },
      ],
      2,
    );
    expect([...tree].sort()).toEqual([2, 3]);
  });

  it('puts a product in each of its segments but counts the total once', () => {
    const report = salesReport(buildCube(data()), ALL, 'segment', false, NAMES);
    expect(report.rows.map((row) => `${row.sku}:${row.group}`).sort()).toEqual([
      'A:1',
      'A:2',
      'B:NONE',
    ]);
    expect(report.totals.sales).toBe('1683.33');
  });

  it('names the groups by brand', () => {
    const report = salesReport(buildCube(data()), ALL, 'brand', false, NAMES);
    expect(report.rows.map((row) => row.groupName).sort()).toEqual(['Брэнд А', 'Брэндгүй']);
  });
});

describe('salesDocuments', () => {
  it('lists a row’s documents oldest first with their split', () => {
    const docs = salesDocuments(buildCube(data()), ALL, 'none', 100, null, true);
    expect(docs.rows.map((doc) => doc.number)).toEqual(['INV-1', 'POS-1', 'CN-1']);
    expect(docs.rows[1]?.paid).toEqual([
      { key: 'T1', amount: '166.67' },
      { key: 'T2', amount: '166.67' },
    ]);
    expect(docs.rows[0]?.customerName).toBe('Дэлгүүр');
  });
});

describe('speed', () => {
  it('works 200,000 lines out quickly', () => {
    const base = data();
    const n = 200_000;
    const products = Array.from({ length: 5_000 }, (_, i) => ({
      ...base.products[0]!,
      id: i + 1,
      sku: `S${i}`,
      brandId: i % 40,
      segmentIds: i % 3 === 0 ? [1] : [],
    }));
    const docs = Array.from({ length: 20_000 }, (_, i) => ({
      ...base.docs[i % 3]!,
      id: i + 1,
    }));
    const big: ProductSalesData = {
      ...base,
      products,
      docs,
      lines: {
        doc: Array.from({ length: n }, (_, i) => i % docs.length),
        product: Array.from({ length: n }, (_, i) => (i * 7) % products.length),
        warehouse: Array.from({ length: n }, (_, i) => (i % 2 ? 3 : 6)),
        qty: Array.from({ length: n }, () => '2.5'),
        sales: Array.from({ length: n }, (_, i) => `${1000 + (i % 97)}.25`),
        returns: Array.from({ length: n }, () => '0'),
        cost: Array.from({ length: n }, () => '700.1234'),
      },
    };
    const t0 = performance.now();
    const cube = buildCube(big);
    const t1 = performance.now();
    salesReport(cube, ALL, 'none', false, NAMES);
    const t2 = performance.now();
    salesReport(cube, { ...ALL, source: 'POS' }, 'brand', true, NAMES);
    const t3 = performance.now();
    console.log(
      `JSON ${(JSON.stringify(big).length / 1e6).toFixed(1)} MB; parse ${(t1 - t0).toFixed(0)} ms; report ${(t2 - t1).toFixed(0)} ms; brand + split ${(t3 - t2).toFixed(0)} ms`,
    );
    expect(t3 - t1).toBeLessThan(5_000);
  });
});
