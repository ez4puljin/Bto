import {
  ERKHET_PRICE_TOLERANCE,
  type ErkhetSyncIssue,
  type ErkhetSyncKind,
} from '@tugeel/shared/erkhet';
import type { SettlementGroup } from '@tugeel/shared/finance';
import { lookupCandidates } from '@tugeel/shared/gtin';
import type { Decimal } from '@tugeel/shared/money';
import { normalizeMnPhone } from '@tugeel/shared/phone';
import type { CustomerKind } from '@tugeel/shared/taxpayer';
import { normalizeName } from '@tugeel/shared/text';
import type { ErkhetItemPlan, ErkhetListSummary } from '../schema';
import type { ErkhetCustomerRow, ErkhetItemRow } from './erkhet-sheets';

/** A row a check found to differ, before it is stored. */
export interface FoundItem {
  kind: ErkhetSyncKind;
  issue: ErkhetSyncIssue;
  erkhetCode: string | null;
  erkhetName: string | null;
  erkhetGroup: string | null;
  erkhetBarcodes: string | null;
  erkhetPrice: Decimal | null;
  btoId: number | null;
  btoCode: string | null;
  btoName: string | null;
  btoPrice: Decimal | null;
  plan: ErkhetItemPlan | null;
}

export interface Compared {
  items: FoundItem[];
  summary: ErkhetListSummary;
}

export interface BtoCustomer {
  id: number;
  code: string;
  name: string;
  status: 'ACTIVE' | 'INACTIVE';
  kind: CustomerKind;
  categoryId: number | null;
  settlementGroup: SettlementGroup;
}

export interface BtoProduct {
  id: number;
  sku: string;
  name: string;
  status: 'ACTIVE' | 'INACTIVE';
  /** Barcodes on its units. */
  barcodes: number;
}

const blank = {
  erkhetCode: null,
  erkhetName: null,
  erkhetGroup: null,
  erkhetBarcodes: null,
  erkhetPrice: null,
  btoId: null,
  btoCode: null,
  btoName: null,
  btoPrice: null,
  plan: null,
} satisfies Omit<FoundItem, 'kind' | 'issue'>;

function summaryOf(erkhet: number, bto: number, agreed: number, items: FoundItem[]) {
  const issues: Partial<Record<ErkhetSyncIssue, number>> = {};
  for (const item of items) issues[item.issue] = (issues[item.issue] ?? 0) + 1;
  return { erkhet, bto, agreed, issues } satisfies ErkhetListSummary;
}

/** A customer code as Bto takes it (`customers_code_format`). */
const BTO_CUSTOMER_CODE = /^[0-9]{1,20}$/;

/** The value most rows hold; the first seen wins a tie. */
function mostCommon<T>(values: readonly T[]): T | undefined {
  const counts = new Map<T, number>();
  let best: T | undefined;
  let bestCount = 0;
  for (const value of values) {
    const count = (counts.get(value) ?? 0) + 1;
    counts.set(value, count);
    if (count > bestCount) {
      best = value;
      bestCount = count;
    }
  }
  return best;
}

/** The first mobile number in Erkhet's «Утас» cell, as Bto stores phones; null when none reads. */
export function firstPhone(cell: string): string | null {
  for (const part of cell.split(/[^0-9+]+/)) {
    if (part.length < 8) continue;
    const phone = normalizeMnPhone(part);
    if (phone) return phone;
  }
  return null;
}

/**
 * Erkhet's customers against Bto's, by code (ADR-0203 #3). A customer Erkhet has and Bto lacks can
 * be added only when its Erkhet group is a category in Bto: the groups left out at the migration
 * (Kharkhorin, the suppliers; ADR-0107) have none and stay out. A new customer takes the
 * settlement group and the kind most customers of its category have.
 */
export function compareCustomers(
  erkhet: readonly ErkhetCustomerRow[],
  bto: readonly BtoCustomer[],
  categoryOf: (groupName: string) => { id: number; active: boolean } | null,
): Compared {
  const items: FoundItem[] = [];
  const byCode = new Map(bto.map((customer) => [customer.code, customer]));
  const membersOf = new Map<number, BtoCustomer[]>();
  for (const customer of bto) {
    if (customer.categoryId === null) continue;
    const members = membersOf.get(customer.categoryId) ?? [];
    members.push(customer);
    membersOf.set(customer.categoryId, members);
  }
  const everyGroup = mostCommon(bto.map((customer) => customer.settlementGroup)) ?? 'DAY_20';
  const seen = new Set<string>();
  let agreed = 0;
  for (const row of erkhet) {
    if (seen.has(row.code)) continue;
    seen.add(row.code);
    const side = {
      ...blank,
      erkhetCode: row.code,
      erkhetName: row.name,
      erkhetGroup: [row.groupCode, row.groupName].filter(Boolean).join(' ') || null,
    };
    const customer = byCode.get(row.code);
    if (customer) {
      const ours = { btoId: customer.id, btoCode: customer.code, btoName: customer.name };
      if (customer.status !== 'ACTIVE') {
        items.push({ kind: 'CUSTOMER', issue: 'INACTIVE_IN_BTO', ...side, ...ours });
      } else if (normalizeName(customer.name) !== row.name) {
        items.push({ kind: 'CUSTOMER', issue: 'NAME_DIFFERS', ...side, ...ours });
      } else {
        agreed += 1;
      }
      continue;
    }
    const category = row.groupName ? categoryOf(row.groupName) : null;
    if (!category?.active || !row.name) {
      items.push({ kind: 'CUSTOMER', issue: 'GROUP_NOT_TAKEN', ...side });
      continue;
    }
    // A code with a letter cannot be a code in Bto: at the migration such a customer took another
    // code (ADR-0107), so it is shown without a plan and never added a second time from here.
    if (!BTO_CUSTOMER_CODE.test(row.code)) {
      items.push({ kind: 'CUSTOMER', issue: 'MISSING_IN_BTO', ...side });
      continue;
    }
    const members = membersOf.get(category.id) ?? [];
    items.push({
      kind: 'CUSTOMER',
      issue: 'MISSING_IN_BTO',
      ...side,
      plan: {
        categoryId: category.id,
        settlementGroup: mostCommon(members.map((member) => member.settlementGroup)) ?? everyGroup,
        kind: mostCommon(members.map((member) => member.kind)) ?? 'COMPANY',
        phone: firstPhone(row.phone),
      },
    });
  }
  let active = 0;
  for (const customer of bto) {
    if (customer.status !== 'ACTIVE') continue;
    active += 1;
    if (seen.has(customer.code)) continue;
    items.push({
      kind: 'CUSTOMER',
      issue: 'MISSING_IN_ERKHET',
      ...blank,
      btoId: customer.id,
      btoCode: customer.code,
      btoName: customer.name,
    });
  }
  return { items, summary: summaryOf(seen.size, active, agreed, items) };
}

/** Every lookup key the barcodes of Erkhet's items may be stored under in Bto. */
export function itemLookupKeys(erkhet: readonly ErkhetItemRow[]): string[] {
  const keys = new Set<string>();
  for (const row of erkhet) {
    for (const code of row.barcodes) {
      for (const key of lookupCandidates(code)) keys.add(key);
    }
  }
  return [...keys];
}

/**
 * Erkhet's items against Bto's products (ADR-0203 #4). The codes differ between the systems
 * (ADR-0098), so an item is found by its barcodes; one without a barcode is found by its code,
 * and only in a Bto product that has no barcode either, where the code is all there is to go by.
 * The price compared is Erkhet's «Нэгж үнэ» against Bto's warehouse price in force today, both per
 * base unit.
 */
export function compareProducts(
  erkhet: readonly ErkhetItemRow[],
  bto: readonly BtoProduct[],
  ownerOf: ReadonlyMap<string, number>,
  priceOf: ReadonlyMap<number, Decimal>,
): Compared {
  const items: FoundItem[] = [];
  const byId = new Map(bto.map((product) => [product.id, product]));
  const bySku = new Map(bto.map((product) => [product.sku, product]));
  const matched = new Set<number>();
  const seen = new Set<string>();
  let agreed = 0;
  for (const row of erkhet) {
    if (seen.has(row.code)) continue;
    seen.add(row.code);
    const side = {
      ...blank,
      erkhetCode: row.code,
      erkhetName: row.name,
      erkhetGroup: row.category || null,
      erkhetBarcodes: row.barcodes.join(', ') || null,
      erkhetPrice: row.price,
    };
    let product: BtoProduct | undefined;
    if (row.barcodes.length > 0) {
      const owners = new Set<number>();
      for (const code of row.barcodes) {
        for (const key of lookupCandidates(code)) {
          const owner = ownerOf.get(key);
          if (owner !== undefined && byId.has(owner)) owners.add(owner);
        }
      }
      if (owners.size === 0) {
        // What «Bto-д нэмэх» needs of Erkhet's list beyond the row's columns (ADR-0222).
        const plan = {
          unitCode: row.unitCode || null,
          unitName: row.unitName || null,
          packRatio: row.packRatio,
          weight: row.weight,
        };
        items.push({ kind: 'PRODUCT', issue: 'MISSING_IN_BTO', ...side, plan });
        continue;
      }
      if (owners.size > 1) {
        const found = [...owners].sort((a, b) => a - b).map((id) => byId.get(id));
        for (const id of owners) matched.add(id);
        items.push({
          kind: 'PRODUCT',
          issue: 'AMBIGUOUS',
          ...side,
          btoCode: found.map((one) => one?.sku).join(', '),
          btoName: found.map((one) => one?.name).join(' · '),
        });
        continue;
      }
      product = byId.get([...owners][0] ?? 0);
    } else {
      const sameCode = bySku.get(row.code);
      if (sameCode?.barcodes === 0) {
        product = sameCode;
      } else {
        items.push({
          kind: 'PRODUCT',
          issue: 'NO_BARCODE',
          ...side,
          ...(sameCode
            ? { btoId: sameCode.id, btoCode: sameCode.sku, btoName: sameCode.name }
            : {}),
        });
        if (sameCode) matched.add(sameCode.id);
        continue;
      }
    }
    if (!product) continue;
    matched.add(product.id);
    const price = priceOf.get(product.id);
    const ours = {
      btoId: product.id,
      btoCode: product.sku,
      btoName: product.name,
      btoPrice: price ?? null,
    };
    if (product.status !== 'ACTIVE') {
      items.push({ kind: 'PRODUCT', issue: 'INACTIVE_IN_BTO', ...side, ...ours });
    } else if (price === undefined) {
      items.push({ kind: 'PRODUCT', issue: 'NO_BTO_PRICE', ...side, ...ours });
    } else if (
      row.price !== null &&
      row.price.gt(0) &&
      row.price.minus(price).abs().gt(ERKHET_PRICE_TOLERANCE)
    ) {
      items.push({ kind: 'PRODUCT', issue: 'PRICE_DIFFERS', ...side, ...ours });
    } else {
      agreed += 1;
    }
  }
  let active = 0;
  for (const product of bto) {
    if (product.status !== 'ACTIVE') continue;
    active += 1;
    if (matched.has(product.id)) continue;
    items.push({
      kind: 'PRODUCT',
      issue: 'MISSING_IN_ERKHET',
      ...blank,
      btoId: product.id,
      btoCode: product.sku,
      btoName: product.name,
      btoPrice: priceOf.get(product.id) ?? null,
    });
  }
  return { items, summary: summaryOf(seen.size, active, agreed, items) };
}
