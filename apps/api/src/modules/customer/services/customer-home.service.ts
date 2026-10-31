import { Injectable } from '@nestjs/common';
import type { Decimal } from '@tugeel/shared/money';
import {
  HOME_SECTION_SIZE,
  HOME_TOGGLE_KINDS,
  type HomeSectionKey,
  type HomeSectionKind,
  homeSectionKey,
  type HomeSectionSort,
  type HomeToggleKind,
  RECENT_ORDER_DAYS,
} from '@tugeel/shared/sales';
import { addDays, businessDate, isIsoDate } from '@tugeel/shared/time';
import { AppError, notFound } from '../../../common/errors/app-error';
import {
  DEFAULT_PAGE_LIMIT,
  decodeCursor,
  encodeCursor,
  invalidCursor,
} from '../../../common/pagination/page';
import {
  CategoriesService,
  type CategoryView,
  type ProductIndexRow,
  ProductQueryService,
  type ProductSegmentEntry,
} from '../../catalog';
import type { CustomerContext } from '../../identity';
import { StockQueryService } from '../../inventory';
import { type DealBook, ProductDealsService, ProductPricesService } from '../../pricing';
import { AppSettingsService, CustomerOrdersService, type RepShopProduct } from '../../sales';
import { AppBannersService, type RunningBanner } from './app-banners.service';
import { type CustomerProduct, CustomerShopService, newSince } from './customer-shop.service';

/**
 * A product section of the home or a category page (ADR-0092 #1, #6). `P` is the card: a store's
 * `CustomerProduct`, or the rep app's `RepShopProduct` on the rep home (2026-10-23).
 */
export interface HomeSection<P = CustomerProduct> {
  key: string;
  kind: HomeSectionKind;
  /** A segment's name; the fixed sections are named by the app. */
  title: string | null;
  /** A segment's description. */
  subtitle: string | null;
  /** «Урамшуулал»: the earliest last day of the promotions shown. */
  lastDay: string | null;
  /** How many products the full list holds. */
  total: number;
  /** At most HOME_SECTION_SIZE, «Дууссан» last. */
  products: P[];
}

/** A category tile: a top category on the home, a subcategory on a category's page. */
export interface HomeCategory {
  id: number;
  name: string;
  /** The category's own picture, else one of its products' (ADR-0092 #6). */
  imageUrl: string | null;
  /** Products «Бараа» sells in it, its subcategories included. */
  productCount: number;
}

export interface CustomerHome<P = CustomerProduct> {
  today: string;
  banners: RunningBanner[];
  categories: HomeCategory[];
  sections: HomeSection<P>[];
}

export interface CategoryPage<P = CustomerProduct> {
  category: { id: number; parentId: number | null; name: string; imageUrl: string | null };
  productCount: number;
  banners: RunningBanner[];
  subcategories: HomeCategory[];
  sections: HomeSection<P>[];
}

export interface SectionPageQuery {
  sort?: HomeSectionSort;
  /** Each with its subcategories. */
  categoryIds?: readonly number[];
  inStock?: boolean;
  cursor?: string;
  limit?: number;
}

export interface SectionPage<P = CustomerProduct> {
  key: string;
  kind: HomeSectionKind;
  title: string | null;
  subtitle: string | null;
  lastDay: string | null;
  data: P[];
  nextCursor: string | null;
  /** On the first page. */
  total: number | null;
}

/** Products a category tile looks through for a picture when the category has none. */
const PICTURE_CANDIDATES = 20;

/**
 * What one request knows (ADR-0093): the shop's universe in the NEW order, what is free at home,
 * and the discount programs in force on the business date.
 */
interface Shop {
  today: string;
  rows: readonly ProductIndexRow[];
  /** id → its place in the NEW order. */
  rank: ReadonlyMap<number, number>;
  categoryOf: ReadonlyMap<number, number>;
  free: ReadonlySet<number>;
  book: DealBook;
}

/** A section's products, already in its DEFAULT order, before «Дууссан» moves last. */
interface SectionIds {
  key: HomeSectionKey;
  title: string | null;
  subtitle: string | null;
  ids: number[];
}

/**
 * Whose shop window it is. Everything but these is the same for both: the universe (the customer
 * shop's), each section's products and order, the tiles, the banners, the cursors.
 */
interface Viewer<P> {
  /**
   * A store's own sections (RECENT, FAVOURITES); null on the rep home, which leaves them out
   * and answers their keys 404 (the owner, 2026-10-23).
   */
  store: {
    recent: (today: string) => Promise<number[]>;
    favourites: () => Promise<number[]>;
  } | null;
  /** The cards of these listed products, in any order, priced with `book`'s programs. */
  cards: (ids: readonly number[], book: DealBook) => Promise<P[]>;
}

type StoreSectionKind = 'RECENT' | 'FAVOURITES';
const isStoreSection = (key: HomeSectionKey): key is { kind: StoreSectionKind } =>
  key.kind === 'RECENT' || key.kind === 'FAVOURITES';
const noSection = (key: string) => new AppError('NOT_FOUND', 'no such section', { key });
/** A fixed section the office may switch off (ADR-0127 #3). */
const isToggled = (key: HomeSectionKey): key is { kind: HomeToggleKind } =>
  (HOME_TOGGLE_KINDS as readonly string[]).includes(key.kind);

/**
 * «Bto300»'s home as a shop window (ADR-0092, ADR-0093), built only from other modules' public
 * services: the shop's index and stock words (sales, inventory), the shown segments (through
 * catalog's hook), the discount programs (pricing), the store's orders (sales) and ♡; the banners
 * are this module's. Every store read is for the token's own store. The rep app's home shows the
 * same window to a rep (the owner, 2026-10-23): the rep's cards, no RECENT or FAVOURITES.
 */
@Injectable()
export class CustomerHomeService {
  constructor(
    private readonly shop: CustomerShopService,
    private readonly banners: AppBannersService,
    private readonly productQuery: ProductQueryService,
    private readonly categories: CategoriesService,
    private readonly stock: StockQueryService,
    private readonly orders: CustomerOrdersService,
    private readonly deals: ProductDealsService,
    private readonly prices: ProductPricesService,
    private readonly settings: AppSettingsService,
  ) {}

  /** «Нүүр» (ADR-0092 #1): banners, the category grid and the sections in their fixed order. */
  home(ctx: CustomerContext): Promise<CustomerHome> {
    return this.window(this.storeViewer(ctx));
  }

  /**
   * The rep app's home (the owner, 2026-10-23): «Bto300»'s banners, category grid and sections
   * PROMOTIONS, the shown segments, DISCOUNTS and NEW over the same universe, with the rep's cards.
   */
  repHome(): Promise<CustomerHome<RepShopProduct>> {
    return this.window(this.repViewer());
  }

  /**
   * A section's full list (ADR-0092 #7): the section's order or another, «Дууссан» last, the
   * categories and «Зөвхөн байгаа бараа» filters, a cursor pinned to the first page's day.
   */
  sectionPage(
    ctx: CustomerContext,
    key: HomeSectionKey,
    query: SectionPageQuery,
  ): Promise<SectionPage> {
    return this.list(this.storeViewer(ctx), key, query);
  }

  /** The rep home's section list: the same, RECENT and FAVOURITES not found. */
  repSectionPage(
    key: HomeSectionKey,
    query: SectionPageQuery,
  ): Promise<SectionPage<RepShopProduct>> {
    return this.list(this.repViewer(), key, query);
  }

  /**
   * A category's page (ADR-0092 #6): its banners, its subcategories that hold listed products,
   * «Шинээр нэмэгдсэн бараа» and «Хямдралтай бараа» of its subtree, and how many products it has.
   */
  categoryPage(ctx: CustomerContext, id: number): Promise<CategoryPage> {
    return this.category(this.storeViewer(ctx), id);
  }

  /** The rep home's category page: the same, with the rep's cards. */
  repCategoryPage(id: number): Promise<CategoryPage<RepShopProduct>> {
    return this.category(this.repViewer(), id);
  }

  /** A store's window: its orders, its ♡, its cards (stock words, ♡). */
  private storeViewer(ctx: CustomerContext): Viewer<CustomerProduct> {
    return {
      store: {
        recent: (today) =>
          this.orders.recentProducts(ctx.customerId, addDays(today, 1 - RECENT_ORDER_DAYS)),
        favourites: () => this.shop.favouriteIds(ctx),
      },
      cards: (ids, book) => this.shop.productsOf(ctx, ids, book),
    };
  }

  /** A rep's window: no store of its own, the rep app's cards (numbers, badges). */
  private repViewer(): Viewer<RepShopProduct> {
    return { store: null, cards: (ids, book) => this.shop.repProductsOf(ids, book) };
  }

  private async window<P extends { id: number }>(viewer: Viewer<P>): Promise<CustomerHome<P>> {
    const shop = await this.read();
    const listed = new Set(shop.rank.keys());
    const tree = await this.categories.list();
    const shown = await this.productQuery.productSegments({ shownInApp: true });
    // The office switches the fixed sections on and off from «Апп → Нүүр» (ADR-0127 #3).
    const on = (await this.settings.current()).homeSections;
    const sections: SectionIds[] = [];
    if (viewer.store) sections.push(await this.sectionIds(viewer, shop, { kind: 'RECENT' }));
    if (on.PROMOTIONS) sections.push(await this.sectionIds(viewer, shop, { kind: 'PROMOTIONS' }));
    for (const segment of shown) {
      try {
        sections.push(await this.segmentIds(shop, segment));
      } catch (error) {
        // A segment whose conditions no longer hold (SEGMENT_INVALID) is left off, never the home.
        if (!(error instanceof AppError)) throw error;
      }
    }
    for (const kind of ['DISCOUNTS', 'NEW'] as const) {
      if (on[kind]) sections.push(await this.sectionIds(viewer, shop, { kind }));
    }
    if (viewer.store) sections.push(await this.sectionIds(viewer, shop, { kind: 'FAVOURITES' }));
    return {
      today: shop.today,
      banners: await this.banners.running(shop.today, listed),
      categories: await this.tiles(shop, tree, null),
      sections: await this.rows(viewer, shop, sections),
    };
  }

  private async list<P extends { id: number }>(
    viewer: Viewer<P>,
    key: HomeSectionKey,
    query: SectionPageQuery,
  ): Promise<SectionPage<P>> {
    const keyText = homeSectionKey(key);
    if (!viewer.store && isStoreSection(key)) throw noSection(keyText);
    if (isToggled(key) && !(await this.settings.current()).homeSections[key.kind]) {
      throw noSection(keyText);
    }
    const sort = query.sort ?? 'DEFAULT';
    const limit = query.limit ?? DEFAULT_PAGE_LIMIT;
    const after = cursorOf(query.cursor, keyText, sort);
    const shop = await this.read(after?.d);
    let section: SectionIds;
    if (key.kind === 'SEGMENT') {
      const [segment] = await this.productQuery.productSegments({ ids: [key.segmentId] });
      const open =
        segment &&
        (segment.appPosition !== null ||
          (await this.banners.runningSegmentLinks(shop.today)).has(segment.id));
      if (!segment || !open) throw noSection(keyText);
      section = await this.segmentIds(shop, segment);
    } else {
      section = await this.sectionIds(viewer, shop, key);
    }
    let ids = section.ids;
    if (query.categoryIds?.length) {
      const within = new Set<number>();
      for (const id of query.categoryIds) {
        for (const own of await this.categories.subtreeIds(id)) within.add(own);
      }
      ids = ids.filter((id) => within.has(shop.categoryOf.get(id) ?? -1));
    }
    if (query.inStock) ids = ids.filter((id) => shop.free.has(id));
    const ordered = await this.ordered(shop, ids, sort);
    let start = 0;
    if (after) {
      const at = ordered.indexOf(after.a);
      start = at >= 0 ? at + 1 : Math.min(after.o, ordered.length);
    }
    const slice = ordered.slice(start, start + limit);
    const end = start + slice.length;
    const last = slice.at(-1);
    return {
      key: keyText,
      kind: key.kind,
      title: section.title,
      subtitle: section.subtitle,
      lastDay: key.kind === 'PROMOTIONS' ? earliestLastDay(shop, section.ids) : null,
      data: await this.cards(viewer, shop, slice),
      nextCursor:
        end < ordered.length && last !== undefined
          ? encodeCursor({ k: keyText, s: sort, d: shop.today, a: last, o: end })
          : null,
      total: after ? null : ordered.length,
    };
  }

  private async category<P extends { id: number }>(
    viewer: Viewer<P>,
    id: number,
  ): Promise<CategoryPage<P>> {
    const tree = await this.categories.list();
    const category = tree.find((own) => own.id === id);
    if (!category) throw notFound('category', id);
    const shop = await this.read();
    const within = new Set(await this.categories.subtreeIds(id));
    const inside = (ids: readonly number[]) =>
      ids.filter((own) => within.has(shop.categoryOf.get(own) ?? -1));
    const sections: SectionIds[] = [];
    for (const kind of ['NEW', 'DEALS'] as const) {
      const section = await this.sectionIds(viewer, shop, { kind });
      sections.push({ ...section, ids: inside(section.ids) });
    }
    const banners = (await this.banners.running(shop.today, new Set(shop.rank.keys()))).filter(
      (banner) => banner.link?.kind === 'CATEGORY' && banner.link.id === id,
    );
    return {
      category: {
        id: category.id,
        parentId: category.parentId,
        name: category.name,
        imageUrl: category.imageUrl,
      },
      productCount: inside([...shop.rank.keys()]).length,
      banners,
      subcategories: await this.tiles(shop, tree, id),
      sections: await this.rows(viewer, shop, sections),
    };
  }

  /** The request's view of the shop; `day` pins a later page to its first page's day. */
  private async read(day?: string): Promise<Shop> {
    const today = day ?? businessDate();
    const rows = await this.shop.index();
    return {
      today,
      rows,
      rank: new Map(rows.map((row, index) => [row.id, index])),
      categoryOf: new Map(rows.map((row) => [row.id, row.categoryId])),
      free: new Set(await this.stock.productIdsAvailableAtHome()),
      book: await this.shop.dealBook(today),
    };
  }

  /**
   * A fixed section's listed products in its DEFAULT order (ADR-0092 #4, ADR-0093); only RECENT
   * and FAVOURITES ask whose window it is.
   */
  private async sectionIds<P>(
    viewer: Viewer<P>,
    shop: Shop,
    key: Exclude<HomeSectionKey, { kind: 'SEGMENT' }>,
  ): Promise<SectionIds> {
    const listed = (ids: Iterable<number>) => [...ids].filter((id) => shop.rank.has(id));
    const byNew = (ids: Iterable<number>) =>
      listed(ids).sort((a, b) => (shop.rank.get(a) ?? 0) - (shop.rank.get(b) ?? 0));
    const store = () => {
      if (!viewer.store) throw noSection(homeSectionKey(key));
      return viewer.store;
    };
    let ids: number[];
    switch (key.kind) {
      case 'RECENT':
        ids = listed(await store().recent(shop.today));
        break;
      case 'PROMOTIONS':
        ids = await this.byDeal(shop, byNew(shop.book.promotions()));
        break;
      case 'DISCOUNTS':
        ids = await this.byDeal(shop, byNew(shop.book.discounts()));
        break;
      case 'DEALS':
        ids = await this.byDeal(shop, byNew(shop.book.deals()));
        break;
      case 'NEW': {
        const since = newSince();
        ids = shop.rows.flatMap((row) =>
          row.saleReadyAt !== null && row.saleReadyAt.getTime() >= since ? [row.id] : [],
        );
        break;
      }
      case 'FAVOURITES':
        ids = listed(await store().favourites());
        break;
    }
    return { key, title: null, subtitle: null, ids };
  }

  /** A segment's listed products, the newest first (ADR-0092 #2). */
  private async segmentIds(shop: Shop, segment: ProductSegmentEntry): Promise<SectionIds> {
    const members = new Set((await this.productQuery.within({ segmentId: segment.id })) ?? []);
    return {
      key: { kind: 'SEGMENT', segmentId: segment.id },
      title: segment.name,
      subtitle: segment.description,
      ids: shop.rows.flatMap((row) => (members.has(row.id) ? [row.id] : [])),
    };
  }

  /** The biggest discount first, an unknown size last; ties keep the order given. */
  private async byDeal(shop: Shop, ids: readonly number[]): Promise<number[]> {
    const deals = await this.deals.dealsOf(shop.book, ids);
    const size = (id: number): Decimal | null => deals.get(id)?.percent ?? null;
    return [...ids].sort((a, b) => {
      const x = size(a);
      const y = size(b);
      if (x === null || y === null) return (x === null ? 1 : 0) - (y === null ? 1 : 0);
      return y.comparedTo(x);
    });
  }

  /** `ids` in the order asked, then «Дууссан» moved last (stable). */
  private async ordered(
    shop: Shop,
    ids: readonly number[],
    sort: HomeSectionSort,
  ): Promise<number[]> {
    let order: number[];
    switch (sort) {
      case 'DEFAULT':
        order = [...ids];
        break;
      case 'NEW':
        order = [...ids].sort((a, b) => (shop.rank.get(a) ?? 0) - (shop.rank.get(b) ?? 0));
        break;
      case 'DEAL':
        order = await this.byDeal(
          shop,
          [...ids].sort((a, b) => (shop.rank.get(a) ?? 0) - (shop.rank.get(b) ?? 0)),
        );
        break;
      case 'PRICE_ASC':
      case 'PRICE_DESC':
        order = (
          await this.prices.orderedByBasePrice(ids, {
            direction: sort === 'PRICE_ASC' ? 'ASC' : 'DESC',
            after: null,
            limit: ids.length,
            date: shop.today,
          })
        ).map((row) => row.productId);
        break;
    }
    return [
      ...order.filter((id) => shop.free.has(id)),
      ...order.filter((id) => !shop.free.has(id)),
    ];
  }

  /** Each section's first HOME_SECTION_SIZE cards; empty sections are left out. */
  private async rows<P extends { id: number }>(
    viewer: Viewer<P>,
    shop: Shop,
    sections: readonly SectionIds[],
  ): Promise<HomeSection<P>[]> {
    const kept = [];
    for (const section of sections) {
      if (section.ids.length === 0) continue;
      const order = await this.ordered(shop, section.ids, 'DEFAULT');
      kept.push({ section, first: order.slice(0, HOME_SECTION_SIZE) });
    }
    const cards = new Map(
      (await this.cards(viewer, shop, [...new Set(kept.flatMap((own) => own.first))])).map(
        (card) => [card.id, card],
      ),
    );
    return kept.map(({ section, first }) => ({
      key: homeSectionKey(section.key),
      kind: section.key.kind,
      title: section.title,
      subtitle: section.subtitle,
      lastDay: section.key.kind === 'PROMOTIONS' ? earliestLastDay(shop, section.ids) : null,
      total: section.ids.length,
      products: first.flatMap((id) => {
        const card = cards.get(id);
        return card ? [card] : [];
      }),
    }));
  }

  /** The cards of these products in this order, enriched in one batch. */
  private async cards<P extends { id: number }>(
    viewer: Viewer<P>,
    shop: Shop,
    ids: readonly number[],
  ): Promise<P[]> {
    if (ids.length === 0) return [];
    const cards = new Map((await viewer.cards(ids, shop.book)).map((card) => [card.id, card]));
    return ids.flatMap((id) => {
      const card = cards.get(id);
      return card ? [card] : [];
    });
  }

  /**
   * Category tiles: the top categories (`parentId` null) or a category's children that hold
   * listed products, by name, with their own picture or one of their newest products' thumbnail.
   */
  private async tiles(
    shop: Shop,
    tree: readonly CategoryView[],
    parentId: number | null,
  ): Promise<HomeCategory[]> {
    const parentOf = new Map(tree.map((category) => [category.id, category.parentId]));
    const tileOf = (categoryId: number): number | null => {
      let current: number | null = categoryId;
      for (let depth = 0; current !== null && depth < 16; depth += 1) {
        const parent: number | null = parentOf.get(current) ?? null;
        if (parent === parentId) return current;
        current = parent;
      }
      return null;
    };
    const members = new Map<number, number[]>();
    for (const row of shop.rows) {
      const tile = tileOf(row.categoryId);
      if (tile === null) continue;
      const own = members.get(tile);
      if (own) own.push(row.id);
      else members.set(tile, [row.id]);
    }
    const tiles = tree
      .filter((category) => category.parentId === parentId && members.has(category.id))
      .sort((a, b) => a.name.localeCompare(b.name, 'mn') || a.id - b.id);
    const candidates = tiles.flatMap((tile) =>
      tile.imageUrl ? [] : (members.get(tile.id) ?? []).slice(0, PICTURE_CANDIDATES),
    );
    const thumbs = await this.productQuery.primaryThumbsOf(candidates);
    return tiles.map((tile) => {
      const own = members.get(tile.id) ?? [];
      const sample = own.slice(0, PICTURE_CANDIDATES).find((id) => thumbs.has(id));
      return {
        id: tile.id,
        name: tile.name,
        imageUrl: tile.imageUrl ?? (sample === undefined ? null : (thumbs.get(sample) ?? null)),
        productCount: own.length,
      };
    });
  }
}

/** The earliest last day among the promotions marking these products. */
function earliestLastDay(shop: Shop, ids: readonly number[]): string | null {
  let earliest: string | null = null;
  for (const id of ids) {
    for (const program of shop.book.programsOf(id)) {
      if (program.validTo === null) continue;
      const lastDay = addDays(program.validTo, -1);
      if (earliest === null || lastDay < earliest) earliest = lastDay;
    }
  }
  return earliest;
}

/**
 * A section cursor: its key, sort and day, the last product shown and how many came before. The
 * day is a real date, today or the Ulaanbaatar business day before it (a list opened just before
 * midnight keeps its day); any other day, a future one included, is an invalid cursor.
 */
function cursorOf(
  cursor: string | undefined,
  key: string,
  sort: HomeSectionSort,
): { d: string; a: number; o: number } | null {
  const after = decodeCursor(cursor);
  if (!after) return null;
  const today = businessDate();
  if (
    after.k !== key ||
    after.s !== sort ||
    typeof after.d !== 'string' ||
    !isIsoDate(after.d) ||
    (after.d !== today && after.d !== addDays(today, -1)) ||
    typeof after.a !== 'number' ||
    !Number.isSafeInteger(after.a) ||
    typeof after.o !== 'number' ||
    !Number.isSafeInteger(after.o) ||
    after.o < 0
  ) {
    throw invalidCursor();
  }
  return { d: after.d, a: after.a, o: after.o };
}
