import { Decimal } from '@tugeel/shared/money';
import {
  EDGE_API_PREFIX,
  type EdgeCashier,
  type EdgeDeviceInfo,
  type EdgeHealth,
  type EdgeProductHit,
  type EdgeQuoteRequest,
  type EdgeQuoteResponse,
  type EdgeReceipt,
  type EdgeSaleRequest,
  type EdgeSession,
  type EdgeShiftSummary,
} from '@tugeel/shared/pos';
import { vi } from 'vitest';

/** One request the kiosk made to the fake edge. */
export interface EdgeCall {
  method: string;
  path: string;
  url: URL;
  headers: Headers;
  body: unknown;
}

export type EdgeHandler = (call: EdgeCall) => Response | Promise<Response>;

export const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': status >= 400 ? 'application/problem+json' : 'application/json',
    },
  });

export const noContent = () => new Response(null, { status: 204 });

export const problem = (code: string, status: number, params?: Record<string, unknown>) =>
  json(
    {
      type: `https://tugeel.local/errors/${code}`,
      title: code,
      status,
      code,
      ...(params ? { params } : {}),
    },
    status,
  );

export const TILL = { code: 'К1', name: 'Касс 1' };
export const COMPANY = 'Бүтэн-Оргил ХХК';
export const CASHIER: EdgeCashier = { userId: 7, fullName: 'Сараа Бат', supervisor: false };
export const DEVICE: EdgeDeviceInfo = {
  till: TILL,
  cashiers: [
    { userId: 7, fullName: 'Сараа Бат' },
    { userId: 8, fullName: 'Болд Дорж' },
  ],
  companyName: COMPANY,
};

export const SHIFT: EdgeShiftSummary = {
  clientId: '5b0a3c1e-3f8e-4d61-9a43-1f1c9b2e7a10',
  number: 'К1-261017-Э1',
  status: 'OPEN',
  openedAt: '2026-10-17T01:00:00.000Z',
  cashierName: CASHIER.fullName,
  openingFloat: '50000.00',
  salesCount: 3,
  cashSales: '42000.00',
  cardSales: '18000.00',
  total: '60000.00',
  vatTotal: '5454.55',
  expectedCash: '92000.00',
  closedAt: null,
  countedCash: null,
  floatKept: null,
  variance: null,
};

export const SESSION: EdgeSession = {
  till: TILL,
  cashier: CASHIER,
  shift: SHIFT,
  businessDate: '2026-10-17',
  companyName: COMPANY,
};

export const HEALTH: EdgeHealth = {
  status: 'ok',
  version: 'test',
  node: { code: 'STORE1', name: 'Супермаркет' },
  snapshot: { version: 'v1', pulledAt: '2026-10-17T01:00:00.000Z', products: 2 },
  central: { reachable: true, lastPullAt: null, lastPushAt: null },
  outbox: { pending: 0, rejected: 0 },
};

export const MILK: EdgeProductHit = {
  productId: 1,
  sku: '100001',
  name: 'Сүү 1л',
  units: [
    { unitId: 11, uomName: 'ш', factor: '1.000000', isBase: true, price: '3500.00' },
    { unitId: 12, uomName: 'хайрцаг', factor: '12.000000', isBase: false, price: '40000.00' },
  ],
};
export const MILK_BARCODE = '4006381333931';

/** Sold by the piece but without price terms yet: the edge cannot price it. */
export const BREAD: EdgeProductHit = {
  productId: 2,
  sku: '100002',
  name: 'Талх',
  units: [{ unitId: 21, uomName: 'ш', factor: '1.000000', isBase: true, price: null }],
};
export const BREAD_BARCODE = '4870001000014';

const PRODUCTS = [MILK, BREAD];

function unitOf(unitId: number) {
  for (const product of PRODUCTS) {
    const unit = product.units.find((entry) => entry.unitId === unitId);
    if (unit) return { product, unit };
  }
  throw new Error(`unknown unit ${unitId}`);
}

/** The fake edge's price list: the unit's price × qty, VAT 10/110 of the total. */
export function quoteOf(request: EdgeQuoteRequest): EdgeQuoteResponse {
  let total = new Decimal(0);
  const lines = request.lines.map((line) => {
    const { product, unit } = unitOf(line.productUnitId);
    const lineTotal = unit.price === null ? null : new Decimal(unit.price).times(line.qty);
    if (lineTotal) total = total.plus(lineTotal);
    return {
      productId: product.productId,
      productUnitId: unit.unitId,
      sku: product.sku,
      name: product.name,
      uomName: unit.uomName,
      qty: line.qty,
      priced: lineTotal !== null,
      unitPrice: unit.price,
      total: lineTotal === null ? null : lineTotal.toFixed(2),
      discount: lineTotal === null ? null : '0.00',
    };
  });
  return {
    lines,
    subtotal: total.toFixed(2),
    discountTotal: '0.00',
    total: total.toFixed(2),
    vatTotal: total.times(10).div(110).toDecimalPlaces(2).toFixed(2),
  };
}

export function receiptOf(request: EdgeSaleRequest, number = 'К1-261017-0004'): EdgeReceipt {
  const quote = quoteOf({ lines: request.lines });
  const change = request.tenders.reduce(
    (sum, tender) =>
      tender.tendered ? sum.plus(new Decimal(tender.tendered).minus(tender.amount)) : sum,
    new Decimal(0),
  );
  return {
    clientId: request.clientId,
    number,
    soldAt: '2026-10-17T03:15:00.000Z',
    tillCode: TILL.code,
    cashierName: CASHIER.fullName,
    companyName: COMPANY,
    lines: quote.lines.map((line) => ({
      name: line.name,
      uomName: line.uomName,
      qty: line.qty,
      unitPrice: line.unitPrice ?? '0.00',
      total: line.total ?? '0.00',
    })),
    subtotal: quote.subtotal,
    discountTotal: quote.discountTotal,
    total: quote.total,
    vatTotal: quote.vatTotal,
    tenders: request.tenders.map((tender) => ({
      kind: tender.kind,
      amount: tender.amount,
      tendered: tender.tendered ?? null,
    })),
    change: change.toFixed(2),
    ebarimt: { mode: 'TEST', ddtd: null },
  };
}

/** A paired till with a signed-in cashier and an open shift; `extra` replaces or adds routes. */
export function storeRoutes(extra: Record<string, EdgeHandler> = {}): Record<string, EdgeHandler> {
  return {
    'GET /health': () => json(HEALTH),
    'GET /device': () => json(DEVICE),
    'GET /session': () => json(SESSION),
    'POST /auth/logout': () => noContent(),
    'POST /quote': (call) => json(quoteOf(call.body as EdgeQuoteRequest)),
    [`GET /products/barcode/${MILK_BARCODE}`]: () => json({ product: MILK, unitId: 11 }),
    [`GET /products/barcode/${BREAD_BARCODE}`]: () => json({ product: BREAD, unitId: 21 }),
    'GET /products/search': (call) => {
      const q = (call.url.searchParams.get('q') ?? '').toLowerCase();
      return json(PRODUCTS.filter((product) => product.name.toLowerCase().includes(q)));
    },
    'POST /sales': (call) => json(receiptOf(call.body as EdgeSaleRequest)),
    'GET /sales/recent': () => json([]),
    ...extra,
  };
}

/** A fetch for the kiosk's EdgeClient routed by `METHOD /path` (below `/edge/v1`). */
export function fakeEdge(routes: Record<string, EdgeHandler>) {
  const calls: EdgeCall[] = [];
  const fetch = vi.fn(async (input: string, init: RequestInit): Promise<Response> => {
    const url = new URL(input);
    const method = init.method ?? 'GET';
    const path = url.pathname.startsWith(EDGE_API_PREFIX)
      ? decodeURIComponent(url.pathname.slice(EDGE_API_PREFIX.length))
      : url.pathname;
    const body: unknown = typeof init.body === 'string' ? JSON.parse(init.body) : undefined;
    const call: EdgeCall = { method, path, url, headers: new Headers(init.headers), body };
    calls.push(call);
    const handler = routes[`${method} ${path}`];
    return handler ? handler(call) : problem('NOT_FOUND', 404);
  });
  return {
    fetch,
    calls,
    /** The calls of one route, oldest first. */
    callsTo: (route: string) => calls.filter((call) => `${call.method} ${call.path}` === route),
  };
}

export type FakeEdge = ReturnType<typeof fakeEdge>;
