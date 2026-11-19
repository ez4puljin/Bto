import { Injectable, Logger } from '@nestjs/common';
import { businessDate } from '@tugeel/shared/time';
import { CatalogImportService, CategoriesService } from '../../catalog';
import { PriceProfilesService, ProductPricesService } from '../../pricing';
import { ErxesError, type ErxesClient, type ErxesErrorReason } from '../erxes.client';
import {
  type BtoCategory,
  type ErxesItemKey,
  ErxesProductIndex,
  majorityProfile,
  placeErxesCategory,
  TillPlanIndex,
  tillPlans,
} from '../erxes-product-facts';
import {
  type ErxesFactProduct,
  POS_LIST,
  PRICING_PLANS,
  PRODUCT_CATEGORIES,
  PRODUCT_FACTS_PAGE,
  PRODUCT_TAGS,
  readCategories,
  readFactProduct,
  readPlans,
  readPosList,
  readTags,
} from '../erxes-wire';
import { ErxesSettingsFlowService } from './erxes-settings-flow.service';

export type { ErxesItemKey } from '../erxes-product-facts';

/** Why erxes was not read: no saved sign-in, or erxes did not answer as it should. */
export type ErxesFactsFailure = 'NOT_CONFIGURED' | 'KEY_UNREADABLE' | ErxesErrorReason;

export const ERXES_FACTS_FAILURES = [
  'NOT_CONFIGURED',
  'KEY_UNREADABLE',
  'LOGIN_FAILED',
  'UNREACHABLE',
  'TIMEOUT',
  'UNEXPECTED_ANSWER',
] as const satisfies readonly ErxesFactsFailure[];

/**
 * How erxes files and prices an Erkhet item (ADR-0223); null for an item erxes does not hold. Each
 * of the two is null when Bto has no counterpart for it.
 */
export interface ErxesProductFacts {
  /** The Bto category its erxes category became (ADR-0098 #2). */
  categoryId: number | null;
  /** The live Bto price profile its erxes price group carries (ADR-0207 #6). */
  profileId: number | null;
}

export interface ErxesFactsAnswer {
  failure: ErxesFactsFailure | null;
  /** In the keys' order. */
  facts: (ErxesProductFacts | null)[];
}

/** erxes's products a page; 13,142 active products are 14 pages. */
const PAGE = 1000;
const MAX_PAGES = 100;
const GAP_MS = 100;

const pause = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * The category and the price profile erxes gives the same product (ADR-0223), for «Эрхэт тулгалт»'s
 * «Bto-д нэмэх» and «Үнийг тааруулах». It reads erxes with queries only, between transactions, with
 * the saved sign-in: the active products, their categories, the product tags, the tills and the
 * pricing plans. Then for each item:
 *
 * - the erxes product: the one whose code is the item's code, else the one holding its barcode;
 * - its category: the Bto category the product master made of it (`placeErxesCategory`);
 * - its profile: its price group is the set of the till's tag plans that reach it, the key the
 *   copy of 2026-11-17 gave one Bto profile each; the profile is the one more than half of the Bto
 *   products of that group carry today (matched by code, products a plan names alone left out).
 *
 * Without a saved sign-in, or when erxes fails, it says why and knows nothing: the caller falls
 * back on what the person chose. Nothing is written anywhere.
 */
@Injectable()
export class ErxesProductFactsFlowService {
  private readonly logger = new Logger(ErxesProductFactsFlowService.name);

  constructor(
    private readonly settings: ErxesSettingsFlowService,
    private readonly catalog: CatalogImportService,
    private readonly categories: CategoriesService,
    private readonly prices: ProductPricesService,
    private readonly profiles: PriceProfilesService,
  ) {}

  async read(keys: readonly ErxesItemKey[]): Promise<ErxesFactsAnswer> {
    const unknown = (failure: ErxesFactsFailure | null): ErxesFactsAnswer => ({
      failure,
      facts: keys.map(() => null),
    });
    if (keys.length === 0) return unknown(null);
    const opened = await this.settings.client();
    if (opened.client === null) return unknown(opened.failure);
    let erxes: ErxesCatalog;
    try {
      erxes = await this.erxesCatalog(opened.client);
      opened.keep();
    } catch (error: unknown) {
      if (!(error instanceof ErxesError)) throw error;
      this.logger.warn(`erxes products not read: ${error.reason}: ${error.message}`);
      return unknown(error.reason);
    }
    return { failure: null, facts: await this.factsOf(erxes, keys) };
  }

  private async factsOf(
    erxes: ErxesCatalog,
    keys: readonly ErxesItemKey[],
  ): Promise<(ErxesProductFacts | null)[]> {
    const categories: BtoCategory[] = (await this.categories.list()).map((category) => ({
      id: category.id,
      parentId: category.parentId,
      name: category.name,
      skuFrom: category.skuFrom,
    }));
    const categoryNames = new Map(erxes.categories.map((one) => [one.erxesId, one.name]));
    const plans = new TillPlanIndex(tillPlans(erxes.plans, erxes.tills), erxes.tags);
    const products = new ErxesProductIndex(erxes.products);
    const votes = await this.votes(erxes.products, plans);
    const usable = new Set(
      (await this.profiles.forImport())
        .filter((profile) => !profile.archived && profile.current !== null)
        .map((profile) => profile.id),
    );
    return keys.map((key) => {
      const product = products.find(key);
      if (!product) return null;
      const categoryName = product.categoryId ? categoryNames.get(product.categoryId) : null;
      const profileId = majorityProfile(votes.get(plans.signature(product)));
      return {
        categoryId: placeErxesCategory(categoryName ?? null, categories),
        profileId: profileId !== null && usable.has(profileId) ? profileId : null,
      };
    });
  }

  /** Per price group, how many of its Bto products carry each profile today. */
  private async votes(
    products: readonly ErxesFactProduct[],
    plans: TillPlanIndex,
  ): Promise<Map<string, Map<number, number>>> {
    const bySku = new Map<string, number>();
    for (const product of await this.catalog.directory()) bySku.set(product.sku, product.id);
    const groupOf = new Map<number, string>();
    for (const product of products) {
      const id = product.code ? bySku.get(product.code) : undefined;
      if (id === undefined || plans.hasProductPlan(product)) continue;
      groupOf.set(id, plans.signature(product));
    }
    const terms = await this.prices.inForce([...groupOf.keys()], businessDate());
    const votes = new Map<string, Map<number, number>>();
    for (const [productId, group] of groupOf) {
      const profileId = terms.get(productId)?.profileId;
      if (profileId === undefined) continue;
      const tally = votes.get(group) ?? new Map<number, number>();
      tally.set(profileId, (tally.get(profileId) ?? 0) + 1);
      votes.set(group, tally);
    }
    return votes;
  }

  /** What Bto reads of erxes, each list whole. */
  private async erxesCatalog(client: ErxesClient): Promise<ErxesCatalog> {
    const categories = readCategories(await client.read(PRODUCT_CATEGORIES));
    const tags = readTags(await client.read(PRODUCT_TAGS));
    const tills = readPosList(await client.read(POS_LIST));
    const plans = readPlans(await client.read(PRICING_PLANS));
    const seen = new Map<string, ErxesFactProduct>();
    for (let page = 1; page <= MAX_PAGES; page += 1) {
      const answer = await client.read(PRODUCT_FACTS_PAGE, { perPage: PAGE, page });
      const rows = Array.isArray(answer) ? answer : [];
      for (const row of rows) {
        const product = readFactProduct(row);
        if (product && !seen.has(product.erxesId)) seen.set(product.erxesId, product);
      }
      if (rows.length < PAGE) break;
      await pause(GAP_MS);
    }
    return { categories, tags, tills, plans, products: [...seen.values()] };
  }
}

interface ErxesCatalog {
  categories: ReturnType<typeof readCategories>;
  tags: ReturnType<typeof readTags>;
  tills: ReturnType<typeof readPosList>;
  plans: ReturnType<typeof readPlans>;
  products: ErxesFactProduct[];
}
