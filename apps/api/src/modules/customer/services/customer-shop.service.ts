import { Inject, Injectable } from '@nestjs/common';
import { Decimal } from '@tugeel/shared/money';
import { type RepProductSort, type StockWord, stockWord } from '@tugeel/shared/sales';
import { businessDate } from '@tugeel/shared/time';
import { and, desc, eq } from 'drizzle-orm';
import { DB } from '../../../common/db/db.tokens';
import type { Db } from '../../../common/db/db.types';
import { AppError, notFound } from '../../../common/errors/app-error';
import { BarcodeService, CategoriesService, type ProductImageUrls } from '../../catalog';
import type { CustomerContext } from '../../identity';
import { PriceQuoteService, type Quote } from '../../pricing';
import { type RepProduct, SalesRepShopService } from '../../sales';
import { customerFavourites } from '../schema';

/**
 * A product as «Bto300» shows it (ADR-0079 #4): the wholesale unit prices, the stock in three
 * words (never the number), the store's ★.
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
  units: RepProduct['units'];
}

export interface CustomerQuote {
  quote: Quote;
  /** By line, in the order asked: the stock word and whether the quantity may wait for stock. */
  stock: { productUnitId: number; stock: StockWord; mayBackorder: boolean }[];
}

export interface CustomerCategory {
  id: number;
  parentId: number | null;
  name: string;
}

/**
 * The customer app's shop (ADR-0079 #4) over the rep shop's read model (sales): ACTIVE, sale-ready
 * products with a home warehouse, priced by pricing, the stock turned into words here; the store's
 * favourites kept per account. The caller is always the token's own store.
 */
@Injectable()
export class CustomerShopService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly shop: SalesRepShopService,
    private readonly categories: CategoriesService,
    private readonly barcodes: BarcodeService,
    private readonly quotes: PriceQuoteService,
  ) {}

  async productPage(
    ctx: CustomerContext,
    query: {
      q?: string;
      categoryIds?: readonly number[];
      favourites?: boolean;
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
    if (query.favourites && favourites.length === 0) {
      return { data: [], nextCursor: null, total: 0, favouriteCount: 0 };
    }
    const page = await this.shop.productPage({
      ...(query.q ? { q: query.q } : {}),
      ...(query.categoryIds?.length ? { categoryIds: query.categoryIds } : {}),
      ...(query.favourites ? { onlyIds: favourites } : {}),
      ...(query.sort ? { sort: query.sort } : {}),
      ...(query.cursor === undefined ? {} : { cursor: query.cursor }),
      ...(query.limit === undefined ? {} : { limit: query.limit }),
      withHome: true,
    });
    const starred = new Set(favourites);
    return {
      data: page.data.map((product) => toCustomerProduct(product, starred)),
      nextCursor: page.nextCursor,
      total: page.total,
      favouriteCount: first ? (await this.listed(favourites)).length : null,
    };
  }

  /** Products by id (the cart, the ★ tiles, a notice's products): only those the shop lists. */
  async productsOf(ctx: CustomerContext, ids: readonly number[]): Promise<CustomerProduct[]> {
    const starred = new Set(await this.favouriteIds(ctx));
    return (await this.listed(ids)).map((product) => toCustomerProduct(product, starred));
  }

  /** The shop's raw rows by id, home warehouse required (sale-ready and active already). */
  async listed(ids: readonly number[]): Promise<RepProduct[]> {
    if (ids.length === 0) return [];
    return (await this.shop.productsOf([...new Set(ids)])).filter(
      (product) => product.homeWarehouseId !== null,
    );
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

  /** The store's ★ products, the newest first. */
  async favouriteIds(ctx: CustomerContext): Promise<number[]> {
    const rows = await this.db
      .select({ productId: customerFavourites.productId })
      .from(customerFavourites)
      .where(eq(customerFavourites.customerUserId, ctx.customerUserId))
      .orderBy(desc(customerFavourites.createdAt), desc(customerFavourites.productId));
    return rows.map((row) => row.productId);
  }

  /** ★ a product the shop lists; a second star changes nothing. */
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
   * above what is free now («Зарим нь хойшилж магадгүй»). The number itself never leaves.
   */
  async quote(lines: readonly { productUnitId: number; qty: Decimal }[]): Promise<CustomerQuote> {
    const quote = await this.quotes.quote({
      list: 'WHOLESALE',
      date: businessDate(),
      lines: [...lines],
    });
    const products = new Map(
      (await this.listed(quote.lines.map((line) => line.productId))).map((product) => [
        product.id,
        product,
      ]),
    );
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
    };
  }
}

export function wordOf(product: RepProduct): StockWord {
  return stockWord(product.available, product.minLevel, product.packBase);
}

function toCustomerProduct(product: RepProduct, starred: ReadonlySet<number>): CustomerProduct {
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
    units: product.units,
  };
}
