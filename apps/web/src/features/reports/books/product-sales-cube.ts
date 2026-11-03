import type {
  PaidAmount,
  ProductSalesData,
  ProductSalesDocument,
  ProductSalesPayment,
  ProductSalesRow,
} from './book-api';

/**
 * «Борлуулалт /Бараагаар/» worked out in the browser (ADR-0135): the period's lines come once
 * (`GET /reports/product-sales/data`); every other condition, the grouping, the split by payment
 * and a row's documents are computed here, so a change shows at once. Figures are whole numbers
 * of their smallest unit (`bigint`): quantities in thousandths, money in cents, costs in 10⁻⁸,
 * a till sale's payment shares in 10⁻⁹; every figure is rounded half up only when shown, as the
 * server's report does.
 */

export const SALES_GROUPINGS = ['none', 'category', 'brand', 'segment', 'user'] as const;
export type SalesGrouping = (typeof SALES_GROUPINGS)[number];

export interface SalesConditions {
  source: 'ALL' | 'WHOLESALE' | 'POS';
  kind: 'ALL' | 'SALES' | 'RETURNS';
  repUserId?: number;
  customerCategoryId?: number;
  customerId?: number;
  productId?: number;
  /** A category and everything under it (`categoryTree`). */
  categoryIds?: ReadonlySet<number>;
  warehouseId?: number;
  brandIds: readonly number[];
  segmentIds: readonly number[];
}

const QTY = 3;
const MONEY = 2;
const COST = 8;
const SHARE = 9;
const NO_GROUP = 'NONE';
const APP_GROUP = 'APP';
const SALE_KINDS = new Set(['INVOICE', 'POS_SALE']);
const RETURN_KINDS = new Set(['CREDIT_NOTE', 'POS_RETURN']);
/** The rows shown at most (the totals still read every line). */
export const MAX_SHOWN_ROWS = 5_000;
const MAX_DOCUMENTS = 1_000;

const TEN = 10n;
const pow = (places: number) => TEN ** BigInt(places);

/** A decimal text as a whole number of 10⁻`places` (more digits rounded half up). */
export function parseScaled(text: string, places: number): bigint {
  const value = text.trim();
  const negative = value.startsWith('-');
  const [whole = '0', frac = ''] = value.replace(/^[-+]/, '').split('.');
  const kept = `${frac}${'0'.repeat(places)}`.slice(0, places);
  let n = BigInt(`${whole || '0'}${kept}`);
  if ((frac[places] ?? '0') >= '5') n += 1n;
  return negative ? -n : n;
}

/** `value / divisor` rounded half up, away from zero on a tie. */
function divRound(value: bigint, divisor: bigint): bigint {
  const negative = value < 0n !== divisor < 0n;
  const a = value < 0n ? -value : value;
  const b = divisor < 0n ? -divisor : divisor;
  const q = (a * 2n + b) / (b * 2n);
  return negative ? -q : q;
}

/** A whole number of 10⁻`places` as text with `digits` decimals (rounded half up). */
export function formatScaled(value: bigint, places: number, digits: number): string {
  const n = places > digits ? divRound(value, pow(places - digits)) : value * pow(digits - places);
  const negative = n < 0n;
  const text = (negative ? -n : n).toString().padStart(digits + 1, '0');
  const whole = text.slice(0, text.length - digits);
  const frac = digits > 0 ? `.${text.slice(text.length - digits)}` : '';
  return `${negative && n !== 0n ? '-' : ''}${whole}${frac}`;
}

/** A quantity as the server writes it: no trailing zeros. */
function qtyText(value: bigint): string {
  const text = formatScaled(value, QTY, QTY);
  return text.includes('.') ? text.replace(/\.?0+$/, '') : text;
}

const moneyText = (value: bigint) => formatScaled(value, MONEY, MONEY);
const costText = (value: bigint) => formatScaled(value, COST, MONEY);
const paidText = (value: bigint) => formatScaled(value, MONEY + SHARE, MONEY);
/** Money in cents brought to the costs' scale. */
const asCost = (cents: bigint) => cents * pow(COST - MONEY);

type Product = ProductSalesData['products'][number];
type Doc = ProductSalesData['docs'][number];

export interface SalesCube {
  data: ProductSalesData;
  qty: bigint[];
  sales: bigint[];
  returns: bigint[];
  /** Null without `reports.margins.view`. */
  cost: bigint[] | null;
  /** Each document's payment shares in 10⁻⁹ (a wholesale one is all «Авлага»). */
  shares: { key: string; share: bigint }[][];
  /** The lines of each product (by its index). */
  productLines: number[][];
  customerCategory: Map<number, number | null>;
  customerName: Map<number, string>;
}

/** Parses the period's data once. */
export function buildCube(data: ProductSalesData): SalesCube {
  const { lines } = data;
  const productLines: number[][] = data.products.map(() => []);
  lines.product.forEach((product, line) => productLines[product]?.push(line));
  const shares = data.docs.map((doc) => {
    const weights = doc.tenders.map((tender) => ({
      key: tender.key,
      weight: parseScaled(tender.amount, MONEY),
    }));
    const total = weights.reduce((sum, w) => sum + w.weight, 0n);
    if (weights.length === 0) return [];
    if (total === 0n) return [{ key: weights[0]?.key ?? NO_GROUP, share: pow(SHARE) }];
    return weights.map((w) => ({ key: w.key, share: (w.weight * pow(SHARE)) / total }));
  });
  return {
    data,
    qty: lines.qty.map((v) => parseScaled(v, QTY)),
    sales: lines.sales.map((v) => parseScaled(v, MONEY)),
    returns: lines.returns.map((v) => parseScaled(v, MONEY)),
    cost: data.margins ? lines.cost.map((v) => parseScaled(v, COST)) : null,
    shares,
    productLines,
    customerCategory: new Map(data.customers.map((c) => [c.id, c.categoryId])),
    customerName: new Map(data.customers.map((c) => [c.id, c.name])),
  };
}

/** A category and every category under it. */
export function categoryTree(
  categories: readonly { id: number; parentId: number | null }[],
  id: number,
): Set<number> {
  const children = new Map<number, number[]>();
  for (const category of categories) {
    if (category.parentId === null) continue;
    children.set(category.parentId, [...(children.get(category.parentId) ?? []), category.id]);
  }
  const out = new Set<number>();
  const stack = [id];
  while (stack.length > 0) {
    const next = stack.pop() as number;
    if (out.has(next)) continue;
    out.add(next);
    stack.push(...(children.get(next) ?? []));
  }
  return out;
}

function docPasses(doc: Doc, cond: SalesConditions, cube: SalesCube): boolean {
  if (cond.source !== 'ALL' && doc.source !== cond.source) return false;
  if (cond.kind === 'SALES' && !SALE_KINDS.has(doc.kind)) return false;
  if (cond.kind === 'RETURNS' && !RETURN_KINDS.has(doc.kind)) return false;
  if (cond.customerId !== undefined && doc.customerId !== cond.customerId) return false;
  if (cond.repUserId !== undefined && doc.userId !== cond.repUserId) return false;
  if (cond.customerCategoryId !== undefined) {
    const category = doc.customerId === null ? null : cube.customerCategory.get(doc.customerId);
    if (category !== cond.customerCategoryId) return false;
  }
  return true;
}

function productPasses(product: Product, cond: SalesConditions): boolean {
  if (cond.productId !== undefined && product.id !== cond.productId) return false;
  if (
    cond.categoryIds &&
    (product.categoryId === null || !cond.categoryIds.has(product.categoryId))
  )
    return false;
  if (
    cond.brandIds.length > 0 &&
    (product.brandId === null || !cond.brandIds.includes(product.brandId))
  )
    return false;
  if (cond.segmentIds.length > 0 && !product.segmentIds.some((id) => cond.segmentIds.includes(id)))
    return false;
  return true;
}

/** The groups a line counts in under `by` (a product in two segments counts in both). */
function groupsOf(
  by: SalesGrouping,
  product: Product,
  doc: Doc,
  cond: SalesConditions,
): readonly string[] {
  switch (by) {
    case 'none':
      return [''];
    case 'category':
      return [product.categoryId === null ? NO_GROUP : String(product.categoryId)];
    case 'brand':
      return [product.brandId === null ? NO_GROUP : String(product.brandId)];
    case 'segment': {
      const ids =
        cond.segmentIds.length > 0
          ? product.segmentIds.filter((id) => cond.segmentIds.includes(id))
          : product.segmentIds;
      return ids.length > 0 ? ids.map(String) : [NO_GROUP];
    }
    case 'user':
      return [doc.userId !== null ? String(doc.userId) : doc.app ? APP_GROUP : NO_GROUP];
  }
}

/** Which lines pass the conditions (null: none pass). */
function passing(cube: SalesCube, cond: SalesConditions) {
  const docs = cube.data.docs.map((doc) => docPasses(doc, cond, cube));
  const products = cube.data.products.map((product) => productPasses(product, cond));
  const { lines } = cube.data;
  return (line: number) =>
    (docs[lines.doc[line] ?? -1] ?? false) &&
    (products[lines.product[line] ?? -1] ?? false) &&
    (cond.warehouseId === undefined || lines.warehouse[line] === cond.warehouseId);
}

interface Sum {
  qty: bigint;
  sales: bigint;
  returns: bigint;
  cost: bigint;
  paid: Map<string, bigint>;
}

const emptySum = (): Sum => ({ qty: 0n, sales: 0n, returns: 0n, cost: 0n, paid: new Map() });

function addLine(sum: Sum, cube: SalesCube, line: number, payments: boolean): void {
  sum.qty += cube.qty[line] ?? 0n;
  const sales = cube.sales[line] ?? 0n;
  sum.sales += sales;
  sum.returns += cube.returns[line] ?? 0n;
  if (cube.cost) sum.cost += cube.cost[line] ?? 0n;
  if (!payments || sales === 0n) return;
  for (const { key, share } of cube.shares[cube.data.lines.doc[line] ?? -1] ?? []) {
    sum.paid.set(key, (sum.paid.get(key) ?? 0n) + sales * share);
  }
}

function paidOut(sum: Sum): PaidAmount[] {
  const out: PaidAmount[] = [];
  for (const [key, value] of sum.paid) {
    const amount = paidText(value);
    if (!/^-?0\.00$/.test(amount)) out.push({ key, amount });
  }
  return out;
}

export interface SalesReport {
  by: SalesGrouping;
  rows: ProductSalesRow[];
  payments: ProductSalesPayment[];
  totals: {
    sales: string;
    returns: string;
    cost: string | null;
    profit: string | null;
    paid: PaidAmount[];
  };
  /** More rows than `MAX_SHOWN_ROWS`. */
  truncated: boolean;
}

/** The report under the conditions: the products (in their groups), the totals, the columns. */
export function salesReport(
  cube: SalesCube,
  cond: SalesConditions,
  by: SalesGrouping,
  payments: boolean,
  names: { none: string; app: string },
): SalesReport {
  const passes = passing(cube, cond);
  const { lines, docs, products } = cube.data;
  const rows = new Map<string, Sum & { product: number; group: string }>();
  const total = emptySum();
  const used = new Set<string>();
  for (let line = 0; line < lines.doc.length; line += 1) {
    if (!passes(line)) continue;
    const product = products[lines.product[line] ?? -1];
    const doc = docs[lines.doc[line] ?? -1];
    if (!product || !doc) continue;
    addLine(total, cube, line, payments);
    if (payments && (cube.sales[line] ?? 0n) !== 0n) {
      for (const { key } of cube.shares[lines.doc[line] ?? -1] ?? []) used.add(key);
    }
    for (const group of groupsOf(by, product, doc, cond)) {
      const key = `${lines.product[line]}|${group}`;
      let row = rows.get(key);
      if (!row) {
        row = { ...emptySum(), product: lines.product[line] ?? 0, group };
        rows.set(key, row);
      }
      addLine(row, cube, line, payments);
    }
  }
  const groupName = groupNames(cube, by, names);
  const margins = cube.cost !== null;
  const sorted = [...rows.values()].sort((a, b) => {
    if (a.sales !== b.sales) return b.sales > a.sales ? 1 : -1;
    const skuA = products[a.product]?.sku ?? '';
    const skuB = products[b.product]?.sku ?? '';
    return skuA.localeCompare(skuB) || a.group.localeCompare(b.group);
  });
  const out = sorted.slice(0, MAX_SHOWN_ROWS).map((row): ProductSalesRow => {
    const product = products[row.product] as Product;
    const profit = asCost(row.sales) - row.cost;
    return {
      productId: product.id,
      sku: product.sku,
      name: product.name,
      unit: product.unit,
      categoryId: product.categoryId,
      categoryName: null,
      group: by === 'none' ? null : row.group,
      groupName: by === 'none' ? null : (groupName.get(row.group) ?? row.group),
      qty: qtyText(row.qty),
      sales: moneyText(row.sales),
      returns: moneyText(row.returns),
      avgPrice:
        row.qty === 0n ? null : formatScaled(divRound(row.sales * pow(QTY), row.qty), MONEY, MONEY),
      cost: margins ? costText(row.cost) : null,
      profit: margins ? costText(profit) : null,
      margin: margins ? marginText(profit, row.sales) : null,
      paid: paidOut(row),
    };
  });
  const profit = asCost(total.sales) - total.cost;
  return {
    by,
    rows: out,
    payments: cube.data.payments.filter((payment) => used.has(payment.key)),
    totals: {
      sales: moneyText(total.sales),
      returns: moneyText(total.returns),
      cost: margins ? costText(total.cost) : null,
      profit: margins ? costText(profit) : null,
      paid: paidOut(total),
    },
    truncated: sorted.length > MAX_SHOWN_ROWS,
  };
}

/** Gross margin in percent with one decimal, null without sales (profit in 10⁻⁸, sales in cents). */
function marginText(profit: bigint, salesCents: bigint): string | null {
  if (salesCents <= 0n) return null;
  return formatScaled(divRound(profit * 1000n, asCost(salesCents)), 1, 1);
}

function groupNames(
  cube: SalesCube,
  by: SalesGrouping,
  names: { none: string; app: string },
): Map<string, string> {
  const list =
    by === 'category'
      ? cube.data.names.categories
      : by === 'brand'
        ? cube.data.names.brands
        : by === 'segment'
          ? cube.data.names.segments
          : by === 'user'
            ? cube.data.names.users
            : [];
  return new Map<string, string>([
    [NO_GROUP, names.none],
    [APP_GROUP, names.app],
    ...list.map((item): [string, string] => [String(item.id), item.name]),
  ]);
}

/** The documents behind one product's row (in `group` under `by`), oldest first. */
export function salesDocuments(
  cube: SalesCube,
  cond: SalesConditions,
  by: SalesGrouping,
  productId: number,
  group: string | null,
  payments: boolean,
): { rows: ProductSalesDocument[]; truncated: boolean } {
  const { lines, docs, products } = cube.data;
  const index = products.findIndex((product) => product.id === productId);
  const product = products[index];
  if (!product) return { rows: [], truncated: false };
  const passes = passing(cube, cond);
  const sums = new Map<number, Sum>();
  for (const line of cube.productLines[index] ?? []) {
    if (!passes(line)) continue;
    const docIndex = lines.doc[line] ?? -1;
    const doc = docs[docIndex];
    if (!doc) continue;
    if (by !== 'none' && group !== null && !groupsOf(by, product, doc, cond).includes(group)) {
      continue;
    }
    let sum = sums.get(docIndex);
    if (!sum) {
      sum = emptySum();
      sums.set(docIndex, sum);
    }
    addLine(sum, cube, line, payments);
  }
  const rows = [...sums.entries()]
    .map(([docIndex, sum]): ProductSalesDocument => {
      const doc = docs[docIndex] as Doc;
      return {
        kind: doc.kind,
        id: doc.id,
        number: doc.number,
        date: doc.date,
        invoiceId: doc.invoiceId,
        customerId: doc.customerId,
        customerName:
          doc.customerId === null ? null : (cube.customerName.get(doc.customerId) ?? null),
        qty: qtyText(sum.qty),
        sales: moneyText(sum.sales),
        cost: cube.cost ? costText(sum.cost) : null,
        paid: paidOut(sum),
      };
    })
    .sort((a, b) => a.date.localeCompare(b.date) || a.kind.localeCompare(b.kind) || a.id - b.id);
  return { rows: rows.slice(0, MAX_DOCUMENTS), truncated: rows.length > MAX_DOCUMENTS };
}
