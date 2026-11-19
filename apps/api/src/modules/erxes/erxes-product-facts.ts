import { nameKey } from '@tugeel/shared/text';
import {
  ERXES_TILL_POS,
  type ErxesFactProduct,
  type ErxesPlan,
  type ErxesPos,
  type ErxesTag,
} from './erxes-wire';

// How an erxes product's category and price group become Bto's (ADR-0223). Pure, so the rules are
// proved without erxes or a database.

/** A Bto category as the placing rule reads it. */
export interface BtoCategory {
  id: number;
  parentId: number | null;
  name: string;
  /** The start of its code range, as the database keeps it; null without one. */
  skuFrom: string | null;
}

/** «101 Дарс виски»: the hundred's digit and the two after it (ADR-0098, `placeCategory`). */
const NUMBERED = /^(\d)(\d{2})\b/;
/** Where the product master put a product filed under a group's own name (ADR-0098 #2). */
const UNFILED = 'Ангилаагүй';

const numberOf = (name: string): bigint | null => {
  const found = NUMBERED.exec(name.trim());
  return found ? BigInt(`${found[1]}${found[2]}`) : null;
};

const only = <T>(list: readonly T[]): T | null => (list.length === 1 ? (list[0] ?? null) : null);

/**
 * The Bto category an erxes category became at the product master migration (ADR-0098 #2, the rule
 * of `tools/migration/erxes-rules.mjs` `placeCategory`), read against Bto's categories as they are
 * now:
 *
 * - a numbered «101 Дарс виски» is the category whose range starts at 101000; else the one category
 *   whose own name carries the number 101 (a range or a name may have changed since);
 * - «+Тамхи» is the top category «Тамхи»;
 * - a group's own name («Шингэн Бүтээгдэхүүн») is that group's «Ангилаагүй»;
 * - another name is the one category of that name («Хүүхдийн Бүтээгдэхүүн»).
 *
 * Null when Bto has none, or more than one («Хархорин Боломж» was never copied).
 */
export function placeErxesCategory(
  name: string | null,
  categories: readonly BtoCategory[],
): number | null {
  const raw = (name ?? '').trim();
  if (raw === '') return null;
  const number = numberOf(raw);
  if (number !== null) {
    const start = number * 1000n;
    const byRange = only(
      categories.filter((one) => one.skuFrom !== null && BigInt(one.skuFrom) === start),
    );
    if (byRange) return byRange.id;
    return only(categories.filter((one) => numberOf(one.name) === number))?.id ?? null;
  }
  const plus = raw.startsWith('+');
  const key = nameKey(plus ? raw.slice(1) : raw);
  if (key === '') return null;
  const same = only(
    categories.filter((one) => nameKey(one.name) === key && (!plus || one.parentId === null)),
  );
  if (!same) return null;
  if (!plus && same.parentId === null) {
    const unfiled = only(
      categories.filter(
        (one) => one.parentId === same.id && nameKey(one.name) === nameKey(UNFILED),
      ),
    );
    if (unfiled) return unfiled.id;
  }
  return same.id;
}

/**
 * The plans that price the supermarket's till (ADR-0207): active, and either named for the till's
 * branch and department or for no branch, department or pipeline at all. Empty when erxes has no
 * such till.
 */
export function tillPlans(plans: readonly ErxesPlan[], tills: readonly ErxesPos[]): ErxesPlan[] {
  const till = tills.find((one) => one.name === ERXES_TILL_POS);
  if (!till?.branchId || !till.departmentId) return [];
  const { branchId, departmentId } = till;
  return plans.filter(
    (plan) =>
      plan.active &&
      ((plan.branchIds.includes(branchId) && plan.departmentIds.includes(departmentId)) ||
        (plan.branchIds.length === 0 && plan.departmentIds.length === 0 && !plan.pipelineId)),
  );
}

/**
 * Which of the till's plans reach a product (erxes's `pricing` plugin): a tag plan by the product's
 * tags, a plan's tag taking its child tags and its excluded tags and products taken away; a product
 * plan by the product itself.
 */
export class TillPlanIndex {
  private readonly byTag: { plan: ErxesPlan; tags: Set<string>; excluded: Set<string> }[];
  private readonly byProduct = new Set<string>();

  constructor(plans: readonly ErxesPlan[], tags: readonly ErxesTag[]) {
    const children = new Map<string, string[]>();
    for (const tag of tags) {
      if (tag.parentId === null) continue;
      children.set(tag.parentId, [...(children.get(tag.parentId) ?? []), tag.erxesId]);
    }
    const withChildren = (ids: readonly string[]) => {
      const found = new Set<string>();
      const stack = [...ids];
      for (let id = stack.pop(); id !== undefined; id = stack.pop()) {
        if (found.has(id)) continue;
        found.add(id);
        stack.push(...(children.get(id) ?? []));
      }
      return found;
    };
    this.byTag = plans
      .filter((plan) => plan.applyType === 'tag')
      .map((plan) => {
        const excluded = withChildren(plan.tagsExcluded);
        return {
          plan,
          tags: new Set([...withChildren(plan.tags)].filter((tag) => !excluded.has(tag))),
          excluded: new Set(plan.productsExcluded),
        };
      });
    for (const plan of plans) {
      if (plan.applyType === 'product') for (const id of plan.products) this.byProduct.add(id);
    }
  }

  /**
   * The product's price group: the tag plans that reach it, as one key. The copy of 2026-11-17
   * (ADR-0207 #6) gave every key its own Bto profile («Үндсэн» for the key of the plans of
   * «oldCategories - BB», «Нэмэгдэлгүй» for none), so products of one key carry one profile.
   */
  signature(product: ErxesFactProduct): string {
    return this.byTag
      .filter(
        (entry) =>
          !entry.excluded.has(product.erxesId) && product.tagIds.some((tag) => entry.tags.has(tag)),
      )
      .map((entry) => entry.plan.erxesId)
      .sort()
      .join('.');
  }

  /** A plan names the product itself: the copy gave some of these a profile of their own. */
  hasProductPlan(product: ErxesFactProduct): boolean {
    return this.byProduct.has(product.erxesId);
  }
}

/**
 * The profile most products of one price group carry in Bto, when it is more than half of them;
 * null when the group has no priced product in Bto or no profile holds a majority.
 */
export function majorityProfile(votes: ReadonlyMap<number, number> | undefined): number | null {
  if (!votes) return null;
  let total = 0;
  let best: { profileId: number; count: number } | null = null;
  for (const [profileId, count] of votes) {
    total += count;
    if (best === null || count > best.count) best = { profileId, count };
  }
  return best !== null && best.count * 2 > total ? best.profileId : null;
}

/** What an Erkhet item is looked up in erxes by (ADR-0223 #1). */
export interface ErxesItemKey {
  code: string | null;
  barcodes: readonly string[];
}

/** erxes's products by code and by barcode, for finding an Erkhet item among them. */
export class ErxesProductIndex {
  private readonly byCode = new Map<string, ErxesFactProduct[]>();
  private readonly byBarcode = new Map<string, ErxesFactProduct[]>();

  constructor(readonly products: readonly ErxesFactProduct[]) {
    const add = (map: Map<string, ErxesFactProduct[]>, key: string, product: ErxesFactProduct) =>
      map.set(key, [...(map.get(key) ?? []), product]);
    for (const product of products) {
      if (product.code) add(this.byCode, product.code, product);
      for (const barcode of new Set(product.barcodes)) add(this.byBarcode, barcode, product);
    }
  }

  /**
   * The one erxes product of the item: Erkhet's code is erxes's code (the old ERP compared the two
   * masters by it); else the one product holding one of the item's barcodes. Null otherwise.
   */
  find(key: ErxesItemKey): ErxesFactProduct | null {
    const code = key.code?.trim();
    if (code) {
      const byCode = this.byCode.get(code);
      if (byCode?.length === 1) return byCode[0] ?? null;
    }
    const holders = new Map<string, ErxesFactProduct>();
    for (const barcode of key.barcodes) {
      for (const product of this.byBarcode.get(barcode.trim()) ?? []) {
        holders.set(product.erxesId, product);
      }
    }
    return holders.size === 1 ? ([...holders.values()][0] ?? null) : null;
  }
}
