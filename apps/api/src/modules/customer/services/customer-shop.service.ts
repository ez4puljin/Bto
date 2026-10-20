import { Inject, Injectable } from '@nestjs/common';
import { NEW_PRODUCT_DAYS } from '@tugeel/shared/catalog';
import { Decimal } from '@tugeel/shared/money';
import type { DiscountEffect } from '@tugeel/shared/pricing';
import { type RepProductSort, type StockWord, stockWord } from '@tugeel/shared/sales';
import { businessDate } from '@tugeel/shared/time';
import { and, desc, eq } from 'drizzle-orm';
import { DB } from '../../../common/db/db.tokens';
import type { Db } from '../../../common/db/db.types';
import { AppError, notFound } from '../../../common/errors/app-error';
import {
  BarcodeService,
  CategoriesService,
  type ProductImageUrls,
  type ProductIndexRow,
} from '../../catalog';
import type { CustomerContext } from '../../identity';
import {
  type DealBook,
  PriceQuoteService,
  type ProductDeal,
  ProductDealsService,
  type Quote,
} from '../../pricing';
import { type RepProduct, SalesRepShopService } from '../../sales';
import { customerFavourites } from '../schema';

/**
 * A product as «Bto300» shows it (ADR-0079 #4, ADR-0092 #7): the wholesale unit prices, the stock
 * in three words (never the number), the store's ♡, and the badge of its discount program.
 */
export interface CustomerProduct {
  id: number;
  sku: string;
  name: string;
  categoryId: number;
  thumbUrl: string | null;
  images: ProductImageUrls[];
  isNew: boolean;
  stock: StockWord;
  favourite: boolean;
  /** One base unit in whole packs, whole MNT; null without terms today. */
  basePrice: Decimal | null;
  /**
   * One base unit in whole packs after the product's unconditional programs, when lower than the
   * price without them (the card strikes the old price through, ADR-0093); null otherwise.
   */
  dealPrice: Decimal | null;
  /** The badge (ADR-0092 #3); null when no program marks the product. */
  deal: ProductDeal | null;
  units: RepProduct['units'];
}

/** An ORDER program's step reached by the cart and the next one (ADR-0092 #3: the cart's hint). */
export interface OrderDealHint {
  programId: number;
  name: string;
  effect: DiscountEffect;
  reached: { threshold: Decimal; value: Decimal } | null;
  /** The next step and how much the cart still needs for it; null past the last step. */
  next: { threshold: Decimal; value: Decimal; missing: Decimal } | null;
}

export interface CustomerQuote {
  quote: Quote;
  /** By line, in the order asked: the stock word and whether the quantity may wait for stock. */
  stock: { productUnitId: number; stock: StockWord; mayBackorder: boolean }[];
  orderDeals: OrderDealHint[];
}

export interface CustomerCategory {
  id: number;
  parentId: number | null;
  name: string;
}

const DAY_MS = 86_400_000;

/** The moment after which a product that became sale-ready is «Шинэ» (the rep app's rule). */
export function newSince(now = Date.now()): number {
  return now - NEW_PRODUCT_DAYS * DAY_MS;
}

/**
 * The customer app's shop (ADR-0079 #4) over the rep shop's read model (sales): ACTIVE, sale-ready
 * products with a home warehouse, priced by pricing, the stock turned into words here; the store's
 * favourites kept per account; each card with its discount badge (ADR-0092 #3). The caller is
 * always the token's own store.
 */
@Injectable()
export class CustomerShopService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly shop: SalesRepShopService,
    private readonly categories: CategoriesService,
    private readonly barcodes: BarcodeService,
    private readonly quotes: PriceQuoteService,
    private readonly deals: ProductDealsService,
  ) {}

  /** The WHOLESALE programs in force today and the products they mark (one read per request). */
  dealBook(today = businessDate()): Promise<DealBook> {
    return this.deals.book('WHOLESALE', today);
  }

  /** The shop's universe in the NEW order (ADR-0093): every product «Bto300» lists. */
  index(): Promise<ProductIndexRow[]> {
    return this.shop.index();
  }

  async productPage(
    ctx: CustomerContext,
    query: {
      q?: string;
      categoryIds?: readonly number[];
      favourites?: boolean;
      /** «Хямдралтай»: promotions and discounts (ADR-0092 #7). */
      deals?: boolean;
      /** «Шинэ»: sale-ready within NEW_PRODUCT_DAYS. */
      new?: boolean;
      /** «Зөвхөн байгаа бараа». */
      inStock?: boolean;
      sort?: RepProductSort;
      cursor?: string;
      limit?: number;
    },
  ): Promise<{
    data: CustomerProduct[];
    nextCursor: string | null;
    total: number | null;
    favouriteCount: number | null;
  }> {
    const favourites = await this.favouriteIds(ctx);
    const first = query.cursor === undefined;
    const book = await this.dealBook();
    let only: number[] | undefined = query.favourites ? favourites : undefined;
    const narrow = (ids: Iterable<number>) => {
      const keep = new Set(ids);
      only = (only ?? [...keep]).filter((id) => keep.has(id));
    };
    if (query.deals) narrow(book.deals());
    if (query.new) {
      const since = newSince();
      narrow(
        (await this.index()).flatMap((row) =>
          row.saleReadyAt !== null && row.saleReadyAt.getTime() >= since ? [row.id] : [],
        ),
      );
    }
    if (only !== undefined && only.length === 0) {
      return {
        data: [],
        nextCursor: null,
        total: 0,
        favouriteCount: first ? (await this.listed(favourites)).length : null,
      };
    }
    const page = await this.shop.productPage({
      ...(query.q ? { q: query.q } : {}),
      ...(query.categoryIds?.length ? { categoryIds: query.categoryIds } : {}),
      ...(only === undefined ? {} : { onlyIds: only }),
      ...(query.inStock ? { inStock: true } : {}),
      ...(query.sort ? { sort: query.sort } : {}),
      ...(query.cursor === undefined ? {} : { cursor: query.cursor }),
      ...(query.limit === undefined ? {} : { limit: query.limit }),
      withHome: true,
    });
    return {
      data: await this.decorate(page.data, new Set(favourites), book),
      nextCursor: page.nextCursor,
      total: page.total,
      favouriteCount: first ? (await this.listed(favourites)).length : null,
    };
  }

  /** Products by id (the cart, a notice's products): only those the shop lists, in that order. */
  async productsOf(
    ctx: CustomerContext,
    ids: readonly number[],
    book?: DealBook,
  ): Promise<CustomerProduct[]> {
    const starred = new Set(await this.favouriteIds(ctx));
    return this.decorate(await this.listed(ids), starred, book ?? (await this.dealBook()));
  }

  /** The shop's raw rows by id, home warehouse required (sale-ready and active already). */
  async listed(ids: readonly number[]): Promise<RepProduct[]> {
    if (ids.length === 0) return [];
    return (await this.shop.productsOf([...new Set(ids)])).filter(
      (product) => product.homeWarehouseId !== null,
    );
  }

  /** The cards of these rows: stock words, ♡, badges and the struck-through price, in order. */
  async decorate(
    rows: readonly RepProduct[],
    starred: ReadonlySet<number>,
    book: DealBook,
  ): Promise<CustomerProduct[]> {
    const ids = rows.map((row) => row.id);
    const deals = await this.deals.dealsOf(book, ids);
    const packs = await this.deals.packPrices(book, ids);
    return rows.map((product) => {
      const pack = packs.get(product.id);
      return {
        id: product.id,
        sku: product.sku,
        name: product.name,
        categoryId: product.categoryId,
        thumbUrl: product.thumbUrl,
        images: product.images,
        isNew: product.isNew,
        stock: wordOf(product),
        favourite: starred.has(product.id),
        basePrice: product.basePrice,
        dealPrice: pack && pack.price.lt(pack.regular) ? pack.price : null,
        deal: deals.get(product.id) ?? null,
        units: product.units,
      };
    });
  }

  thumbs(): Promise<string[]> {
    return this.shop.thumbs();
  }

  async categoryTree(): Promise<CustomerCategory[]> {
    return (await this.categories.list()).map((category) => ({
      id: category.id,
      parentId: category.parentId,
      name: category.name,
    }));
  }

  /**
   * The product of a scanned barcode with the unit it names (a box barcode opens the box unit,
   * ADR-0079 #4); 404 when no listed product carries it.
   */
  async barcode(
    ctx: CustomerContext,
    code: string,
  ): Promise<{ productUnitId: number; product: CustomerProduct }> {
    const found = await this.barcodes.lookup(code);
    const products = await this.productsOf(
      ctx,
      found.map((row) => row.productId),
    );
    for (const row of found) {
      const product = products.find((own) => own.id === row.productId);
      if (product?.units.some((unit) => unit.id === row.unitId)) {
        return { productUnitId: row.unitId, product };
      }
    }
    throw new AppError('NOT_FOUND', 'no product of the shop carries the barcode', { code });
  }

  /** The store's ♡ products, the newest first. */
  async favouriteIds(ctx: CustomerContext): Promise<number[]> {
    const rows = await this.db
      .select({ productId: customerFavourites.productId })
      .from(customerFavourites)
      .where(eq(customerFavourites.customerUserId, ctx.customerUserId))
      .orderBy(desc(customerFavourites.createdAt), desc(customerFavourites.productId));
    return rows.map((row) => row.productId);
  }

  /** ♡ a product the shop lists; a second one changes nothing. */
  async star(ctx: CustomerContext, productId: number): Promise<void> {
    if ((await this.listed([productId])).length === 0) throw notFound('product', productId);
    await this.db
      .insert(customerFavourites)
      .values({ customerUserId: ctx.customerUserId, productId })
      .onConflictDoNothing();
  }

  async unstar(ctx: CustomerContext, productId: number): Promise<void> {
    await this.db
      .delete(customerFavourites)
      .where(
        and(
          eq(customerFavourites.customerUserId, ctx.customerUserId),
          eq(customerFavourites.productId, productId),
        ),
      );
  }

  /**
   * The cart priced by the server (ADR-0079 #4, ADR-0006 #6): the WHOLESALE list today, as the
   * office's confirmation will price it again; each line's stock word and whether its quantity is
   * above what is free now («Зарим нь хойшилж магадгүй»), and what the order amount programs still
   * need («500,000₮ хүрвэл 3%», ADR-0092 #3). The number itself never leaves.
   */
  async quote(lines: readonly { productUnitId: number; qty: Decimal }[]): Promise<CustomerQuote> {
    const today = businessDate();
    const quote = await this.quotes.quote({ list: 'WHOLESALE', date: today, lines: [...lines] });
    const products = new Map(
      (await this.listed(quote.lines.map((line) => line.productId))).map((product) => [
        product.id,
        product,
      ]),
    );
    const book = await this.dealBook(today);
    return {
      quote,
      stock: quote.lines.map((line) => {
        const product = products.get(line.productId);
        const available = product?.available ?? new Decimal(0);
        return {
          productUnitId: line.productUnitId,
          stock: product ? wordOf(product) : 'OUT',
          mayBackorder: line.qtyBase.gt(available),
        };
      }),
      orderDeals: book.orderPrograms.map((program) => {
        const reached = [...program.steps]
          .reverse()
          .find((step) => step.threshold.lte(quote.orderAmount));
        const next = program.steps.find((step) => step.threshold.gt(quote.orderAmount));
        return {
          programId: program.id,
          name: program.name,
          effect: program.effect,
          reached: reached ? { threshold: reached.threshold, value: reached.value } : null,
          next: next
            ? {
                threshold: next.threshold,
                value: next.value,
                missing: next.threshold.minus(quote.orderAmount),
              }
            : null,
        };
      }),
    };
  }
}

export function wordOf(product: RepProduct): StockWord {
  return stockWord(product.available, product.minLevel, product.packBase);
}
