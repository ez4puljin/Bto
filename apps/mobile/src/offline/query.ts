import type { components } from '@tugeel/api-client';
import { classifyBarcode, lookupCandidates } from '@tugeel/shared/gtin';
import { Decimal } from '@tugeel/shared/money';
import { keysOf, matches, matchesStrictly, type RowKeys, type Terms, termsOf } from './match';
import type { ShopQuery } from '../shop/filters';
import type { KeptCustomer, KeptData, KeptProduct } from './walk';

type RepProductPage = components['schemas']['SalesRepProductPage'];
type RepCustomerPage = components['schemas']['SalesRepCustomerPage'];
type RepCustomerDetail = components['schemas']['SalesRepCustomerDetail'];
type HomeCategory = components['schemas']['CustomerAppHomeCategory'];
type CategoryPage = components['schemas']['SalesRepCategoryPage'];

/**
 * The shop, the store picker and the scanner over the kept copy (ADR-0225 #2): the barcode lookup
 * keys are the server's (`lookupCandidates`/`classifyBarcode` from `@tugeel/shared/gtin`); the
 * words of a search match through `./match` (a stopgap until the phone may use the server's
 * `@tugeel/shared/text`, see there); a category counts with its subcategories.
 */

/** A customer kept with its credit facts: the checkout warns of them without the server. */
export type KeptCustomerDetail = RepCustomerDetail & { creditHold: boolean };

interface Index {
  products: Map<number, KeptProduct>;
  productKeys: Map<number, RowKeys>;
  /** A barcode's lookup key → the product and the unit it is on. */
  barcodes: Map<string, { productId: number; unitId: number }[]>;
  customerKeys: Map<number, RowKeys>;
  /** A category → its children. */
  children: Map<number, number[]>;
}

const indexes = new WeakMap<KeptData, Index>();

/** Built once per copy, at its first search (about 13,000 products: a few hundred ms). */
function indexOf(data: KeptData): Index {
  const known = indexes.get(data);
  if (known) return known;
  const index: Index = {
    products: new Map(),
    productKeys: new Map(),
    barcodes: new Map(),
    customerKeys: new Map(),
    children: new Map(),
  };
  for (const product of data.products) {
    index.products.set(product.id, product);
    index.productKeys.set(product.id, keysOf(product.name, [product.sku]));
    for (const unit of product.units) {
      for (const code of unit.barcodes) {
        const classified = classifyBarcode(code);
        if (!classified.ok) continue;
        const key = classified.value.lookupKey;
        const list = index.barcodes.get(key) ?? [];
        list.push({ productId: product.id, unitId: unit.id });
        index.barcodes.set(key, list);
      }
    }
  }
  for (const customer of data.customers) {
    index.customerKeys.set(customer.id, keysOf(customer.name, [customer.code]));
  }
  for (const category of data.categories) {
    if (category.parentId === null) continue;
    const list = index.children.get(category.parentId) ?? [];
    list.push(category.id);
    index.children.set(category.parentId, list);
  }
  indexes.set(data, index);
  return index;
}

/** A category and every category under it. */
function subtree(index: Index, roots: readonly number[]): Set<number> {
  const all = new Set<number>();
  const queue = [...roots];
  while (queue.length > 0) {
    const id = queue.pop() as number;
    if (all.has(id)) continue;
    all.add(id);
    for (const child of index.children.get(id) ?? []) queue.push(child);
  }
  return all;
}

/** The barcode keys a scanned or typed code may be stored under, found among the kept units. */
export function keptBarcode(
  data: KeptData,
  code: string,
): { productId: number; unitId: number } | null {
  const index = indexOf(data);
  const hits = lookupCandidates(code).flatMap((key) => index.barcodes.get(key) ?? []);
  // Two products under one code: the server answers it as ambiguous; the phone takes none.
  const products = new Set(hits.map((hit) => hit.productId));
  return products.size === 1 ? (hits[0] ?? null) : null;
}

/** 0: the sku or a barcode exactly; 1: every word in the strict key; 2: the rest; null: no match. */
function rankOf(index: Index, product: KeptProduct, text: string, terms: Terms) {
  const keys = index.productKeys.get(product.id);
  if (!keys) return null;
  const digits = /^\d+$/.test(text);
  if (digits) {
    if (product.sku === text) return 0;
    const codes = new Set(lookupCandidates(text));
    const onUnit = product.units.some((unit) =>
      unit.barcodes.some((code) => {
        const classified = classifyBarcode(code);
        return classified.ok && codes.has(classified.value.lookupKey);
      }),
    );
    if (onUnit) return 0;
  }
  if (matches(keys, terms)) return matchesStrictly(keys, terms) ? 1 : 2;
  if (digits && product.sku.startsWith(text)) return 2;
  return null;
}

const priceOf = (product: KeptProduct) =>
  product.basePrice === null ? null : new Decimal(product.basePrice);

/** Every kept product the filters and the search keep, in the shop's order. */
export function keptProducts(data: KeptData, query: ShopQuery): KeptProduct[] {
  const index = indexOf(data);
  const text = query.q.trim();
  const terms = termsOf(text);
  const categories = query.categoryIds.length > 0 ? subtree(index, query.categoryIds) : null;
  const suppliers = query.supplierIds.length > 0 ? new Set(query.supplierIds) : null;
  const ranked: { product: KeptProduct; rank: number }[] = [];
  for (const product of data.products) {
    if (categories && !categories.has(product.categoryId)) continue;
    if (query.warehouseId !== null && product.homeWarehouseId !== query.warehouseId) continue;
    if (suppliers && (product.mainSupplierId === null || !suppliers.has(product.mainSupplierId))) {
      continue;
    }
    // The last known stock: never a live claim.
    if (query.inStock && (product.stockBlocked || !new Decimal(product.available).gt(0))) continue;
    if (query.bonus && product.deal?.effect !== 'BONUS') continue;
    let rank = 0;
    if (text !== '') {
      const found = rankOf(index, product, text, terms);
      if (found === null) continue;
      rank = found;
    }
    ranked.push({ product, rank });
  }
  const bySort = (a: KeptProduct, b: KeptProduct): number => {
    if (query.sort === 'NEW') {
      if (a.isNew !== b.isNew) return a.isNew ? -1 : 1;
      return b.id - a.id;
    }
    const pa = priceOf(a);
    const pb = priceOf(b);
    if (pa === null || pb === null) return pa === null ? (pb === null ? a.id - b.id : 1) : -1;
    const order = query.sort === 'PRICE_ASC' ? pa.comparedTo(pb) : pb.comparedTo(pa);
    return order !== 0 ? order : a.id - b.id;
  };
  ranked.sort((a, b) => a.rank - b.rank || bySort(a.product, b.product));
  return ranked.map((entry) => entry.product);
}

/** One page of the shop as `GET /sales-rep/products` pages it (the cursor is the offset). */
export function keptProductPage(
  data: KeptData,
  query: ShopQuery,
  cursor: string | null,
  limit: number,
): RepProductPage {
  const all = keptProducts(data, query);
  const from = cursor ? Math.max(0, Number.parseInt(cursor, 10) || 0) : 0;
  const rows = all.slice(from, from + limit);
  return {
    data: rows,
    nextCursor: from + limit < all.length ? String(from + limit) : null,
    total: cursor ? null : all.length,
  };
}

/** Kept products by id, in the order asked (the unknown ones left out). */
export function keptProductsOf(data: KeptData, ids: readonly number[]): KeptProduct[] {
  const index = indexOf(data);
  return ids.flatMap((id) => {
    const product = index.products.get(id);
    return product ? [product] : [];
  });
}

/** The phone's digits only, for a phone search. */
const digitsOf = (text: string | null) => (text ?? '').replace(/\D/g, '');

/** Every kept customer the search keeps (name, code or phone), by name. */
export function keptCustomers(data: KeptData, q: string): KeptCustomer[] {
  const index = indexOf(data);
  const text = q.trim();
  const terms = termsOf(text);
  const digits = digitsOf(text);
  const kept = data.customers.filter((customer) => {
    if (text === '') return true;
    const keys = index.customerKeys.get(customer.id);
    if (keys && matches(keys, terms)) return true;
    return digits.length >= 4 && digitsOf(customer.phone).includes(digits);
  });
  return kept.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : a.id - b.id));
}

/** One page of the store picker as `GET /sales-rep/customers` pages it. */
export function keptCustomerPage(
  data: KeptData,
  q: string,
  cursor: string | null,
  limit: number,
): RepCustomerPage {
  const all = keptCustomers(data, q);
  const from = cursor ? Math.max(0, Number.parseInt(cursor, 10) || 0) : 0;
  return {
    data: all.slice(from, from + limit).map((customer) => ({
      id: customer.id,
      code: customer.code,
      name: customer.name,
      phone: customer.phone,
      address: customer.address,
      overdue: customer.overdue,
    })),
    nextCursor: from + limit < all.length ? String(from + limit) : null,
  };
}

/** A kept customer as the checkout reads it, with its credit facts; null when not kept. */
export function keptCustomer(data: KeptData, id: number): KeptCustomerDetail | null {
  const customer = data.customers.find((one) => one.id === id);
  if (!customer) return null;
  return {
    id: customer.id,
    code: customer.code,
    name: customer.name,
    phone: customer.phone,
    addresses: customer.addresses,
    contacts: customer.contacts,
    overdue: customer.overdue,
    creditHold: customer.creditHold,
  };
}

/** How many kept products are in each category's subtree. */
function countsOf(data: KeptData): Map<number, number> {
  const parents = new Map(data.categories.map((category) => [category.id, category.parentId]));
  const counts = new Map<number, number>();
  for (const product of data.products) {
    let id: number | null | undefined = product.categoryId;
    const seen = new Set<number>();
    while (id !== null && id !== undefined && !seen.has(id)) {
      seen.add(id);
      counts.set(id, (counts.get(id) ?? 0) + 1);
      id = parents.get(id);
    }
  }
  return counts;
}

const byName = (a: { name: string }, b: { name: string }) =>
  a.name < b.name ? -1 : a.name > b.name ? 1 : 0;

/** «Бүх ангилал» without the server: the top categories with kept products, by name. */
export function keptCategoryTiles(data: KeptData): HomeCategory[] {
  const counts = countsOf(data);
  return data.categories
    .filter((category) => category.parentId === null && (counts.get(category.id) ?? 0) > 0)
    .sort(byName)
    .map((category) => ({
      id: category.id,
      name: category.name,
      imageUrl: category.imageUrl,
      iconKey: category.iconKey,
      productCount: counts.get(category.id) ?? 0,
    }));
}

/**
 * A category's page without the server: its subcategories with kept products and its count; no
 * banners and no sections (those are the server's); «… бүх бараа» opens the kept shop.
 */
export function keptCategoryPage(data: KeptData, id: number): CategoryPage | null {
  const category = data.categories.find((one) => one.id === id);
  if (!category) return null;
  const counts = countsOf(data);
  return {
    category: {
      id: category.id,
      parentId: category.parentId,
      name: category.name,
      imageUrl: category.imageUrl,
      iconKey: category.iconKey,
    },
    productCount: counts.get(id) ?? 0,
    banners: [],
    subcategories: data.categories
      .filter((child) => child.parentId === id && (counts.get(child.id) ?? 0) > 0)
      .sort(byName)
      .map((child) => ({
        id: child.id,
        name: child.name,
        imageUrl: child.imageUrl,
        iconKey: child.iconKey,
        productCount: counts.get(child.id) ?? 0,
      })),
    sections: [],
  };
}
