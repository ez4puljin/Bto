import { Injectable, Logger } from '@nestjs/common';
import { CatalogService, CategoriesService } from '../../catalog';
import { type RepProduct, SalesRepShopService, type ShopScope } from '../../sales';
import { familyHint, PhoneSearchIndex } from '../phone-search';

/** How long a built index serves before the next search rebuilds it in the background. */
const FRESH_MS = 10 * 60_000;
/** Candidates whose stock and sale state are read for one answer. */
const CANDIDATES = 20;
/** Product ids per catalog read while building. */
const CHUNK = 2_000;

export interface PhoneSearchRow {
  product: RepProduct;
  match: 'exact' | 'partial';
}

export interface PhoneSearchResult {
  rows: PhoneSearchRow[];
  /** «Түмний: кола, жүрж — 2л» when two or more rows share their first word. */
  family: string | null;
  /** Milliseconds: the index's own search, and the whole answer. */
  ms: { index: number; total: number };
}

interface Built {
  key: string;
  index: PhoneSearchIndex;
  at: number;
}

/**
 * The phone's product search (ADR-0232 #6, docs/modules/phone-agent.md §3): the names of the
 * products «Bto300»'s shop lists, held in memory and searched by `PhoneSearchIndex`, so a word the
 * names lack or a mis-heard one still finds the product. The index is only the candidates: each
 * answer reads its rows again through the shop (`productsOf`), so a product that left the shop or
 * stopped selling since the index was built never reaches the caller, and the stock is today's.
 * An answered call starts the build (`warm`, a few seconds on 13k products, while the greeting
 * plays); a search without an index waits for it. Later searches use the last index and rebuild it
 * in the background once it is older than ten minutes, so a new or renamed product is found within
 * about ten minutes. The build lets the event loop go between slices of 500 products.
 */
@Injectable()
export class PhoneProductSearchService {
  private readonly logger = new Logger(PhoneProductSearchService.name);
  private built: Built | null = null;
  private building: Promise<Built> | null = null;

  constructor(
    private readonly shop: SalesRepShopService,
    private readonly catalog: CatalogService,
    private readonly categories: CategoriesService,
  ) {}

  /** Builds the index ahead of the first search (a call was just answered); never throws. */
  warm(): void {
    void this.shop
      .customerScope()
      .then((scope) => this.indexFor(scope))
      .catch(() => undefined);
  }

  /** Drops the index: the next search builds it from the catalog as it is now (tests). */
  forget(): void {
    this.built = null;
  }

  async search(query: string, cap: number): Promise<PhoneSearchResult> {
    const started = performance.now();
    const scope = await this.shop.customerScope();
    const index = await this.indexFor(scope);
    const searchedAt = performance.now();
    const hits = index.search(query, CANDIDATES);
    const indexMs = performance.now() - searchedAt;
    const products = new Map(
      (
        await this.shop.productsOf(
          scope,
          hits.map((hit) => hit.id),
        )
      ).map((product) => [product.id, product]),
    );
    // Sellable only; exact before partial, then the better match, then in stock first.
    const rows = hits
      .flatMap((hit, order) => {
        const product = products.get(hit.id);
        if (!product?.sellable) return [];
        const match = hit.exact ? ('exact' as const) : ('partial' as const);
        return [{ row: { product, match }, score: Math.round(hit.score * 20), order }];
      })
      .sort(
        (a, b) =>
          rank(a.row) - rank(b.row) ||
          b.score - a.score ||
          inStock(a.row) - inStock(b.row) ||
          a.order - b.order,
      )
      .slice(0, cap)
      .map(({ row }) => row);
    return {
      rows,
      family: familyHint(rows.map((row) => row.product.name)),
      ms: { index: Math.round(indexMs), total: Math.round(performance.now() - started) },
    };
  }

  /** The index of this scope's shop: the last one while fresh, a rebuild started when it is not. */
  private async indexFor(scope: ShopScope): Promise<PhoneSearchIndex> {
    const key = JSON.stringify(scope);
    const built = this.built;
    if (built && built.key === key) {
      if (Date.now() - built.at > FRESH_MS) void this.rebuild(scope, key).catch(() => undefined);
      return built.index;
    }
    return (await this.rebuild(scope, key)).index;
  }

  private rebuild(scope: ShopScope, key: string): Promise<Built> {
    if (this.building) return this.building;
    const started = Date.now();
    this.building = this.build(scope)
      .then((index) => {
        this.built = { key, index, at: Date.now() };
        this.logger.log({ products: index.size, ms: Date.now() - started }, 'phone search index');
        return this.built;
      })
      .finally(() => {
        this.building = null;
      });
    return this.building;
  }

  private async build(scope: ShopScope): Promise<PhoneSearchIndex> {
    const rows = await this.shop.index(scope);
    const all = await this.categories.list();
    const byId = new Map(all.map((category) => [category.id, category]));
    const chain = (id: number): string[] => {
      const names: string[] = [];
      let current = byId.get(id);
      for (let depth = 0; current && depth < 10; depth += 1) {
        names.push(current.name);
        current = current.parentId === null ? undefined : byId.get(current.parentId);
      }
      return names;
    };
    const ids = rows.map((row) => row.id);
    const entries = [];
    for (let at = 0; at < ids.length; at += CHUNK) {
      for (const product of await this.catalog.getMany(ids.slice(at, at + CHUNK))) {
        entries.push({
          id: product.id,
          name: product.name,
          sku: product.sku,
          categoryNames: chain(product.categoryId),
        });
      }
    }
    return PhoneSearchIndex.build(entries);
  }
}

const rank = (row: PhoneSearchRow) => (row.match === 'exact' ? 0 : 1);
const inStock = (row: PhoneSearchRow) => (row.product.available.gt(0) ? 0 : 1);
