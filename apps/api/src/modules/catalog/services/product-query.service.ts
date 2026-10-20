import { Inject, Injectable, type OnModuleInit } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { MAX_SELECTED_PRODUCTS } from '@tugeel/shared/catalog';
import { DB } from '../../../common/db/db.tokens';
import type { Db, Tx } from '../../../common/db/db.types';
import { AppError } from '../../../common/errors/app-error';
import {
  PRODUCT_SEGMENT_DIRECTORY,
  PRODUCT_SET_RESOLVER,
  type ProductSegmentDirectory,
  type ProductSegmentEntry,
  type ProductSetFilter,
  type ProductSetResolver,
} from '../hooks';
import {
  type ProductImageUrls,
  type ProductIndexRow,
  type ProductListItem,
  type ProductQuery,
  ProductsService,
  type UnitFlags,
} from './products.service';

/**
 * The product list's filters: today's (search, category, stage), a segment filter, and a set of
 * products another module chose (the rep app's «in stock», ADR-0068) that the rest narrows.
 */
export interface ProductListQuery extends ProductQuery, ProductSetFilter {
  onlyIds?: readonly number[];
}

/**
 * The product list with filters on other modules' data (ADR-0049 #4). Catalog keeps its rows,
 * order and cursor; the products a `where` or a segment keeps come from the resolver the segments
 * module binds. Without a bound resolver a filtered request is refused (503), never answered with
 * every product.
 */
@Injectable()
export class ProductQueryService implements OnModuleInit {
  private resolver: ProductSetResolver | null = null;
  private directory: ProductSegmentDirectory | null = null;

  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly products: ProductsService,
    private readonly moduleRef: ModuleRef,
  ) {}

  onModuleInit(): void {
    try {
      this.resolver = this.moduleRef.get<ProductSetResolver>(PRODUCT_SET_RESOLVER, {
        strict: false,
      });
    } catch {
      this.resolver = null;
    }
    try {
      this.directory = this.moduleRef.get<ProductSegmentDirectory>(PRODUCT_SEGMENT_DIRECTORY, {
        strict: false,
      });
    } catch {
      this.directory = null;
    }
  }

  /**
   * Live product segments by id, or those «Bto300» shows on its home in their order (ADR-0093),
   * from the directory the segments module binds; 503 when none is bound.
   */
  productSegments(
    query: { shownInApp: true } | { ids: readonly number[] },
  ): Promise<ProductSegmentEntry[]> {
    if (!this.directory) {
      throw new AppError('SERVICE_UNAVAILABLE', 'product segments are not available');
    }
    return this.directory.productSegments(query);
  }

  /**
   * The products a segment filter and `onlyIds` keep, ascending; null when the query has neither.
   * Every reader of the list (the page, the ids, a selection, an export) narrows the same way.
   */
  async within(
    filter: ProductSetFilter & { onlyIds?: readonly number[] },
  ): Promise<number[] | null> {
    const only =
      filter.onlyIds === undefined ? null : [...new Set(filter.onlyIds)].sort((a, b) => a - b);
    if (filter.where === undefined && filter.segmentId === undefined) return only;
    if (!this.resolver) {
      throw new AppError('SERVICE_UNAVAILABLE', 'segment filters are not available');
    }
    const kept = await this.resolver.productIds({
      ...(filter.where === undefined ? {} : { where: filter.where }),
      ...(filter.segmentId === undefined ? {} : { segmentId: filter.segmentId }),
    });
    if (only === null) return kept;
    const keep = new Set(kept);
    return only.filter((id) => keep.has(id));
  }

  /** One page of the list and, on the first page, how many products the filters keep. */
  async query(
    query: ProductListQuery,
  ): Promise<{ data: ProductListItem[]; nextCursor: string | null; total: number | null }> {
    const within = await this.within(query);
    const page = await this.products.listItems(query, within);
    const total = query.cursor === undefined ? await this.products.countItems(query, within) : null;
    return { ...page, total };
  }

  /**
   * The ids the filters keep in the list's order, at most `cap` of them, and how many they keep in
   * all: the rows of a filtered export (ADR-0049 #6).
   */
  async orderedIds(
    query: ProductListQuery,
    cap: number,
    executor: Db | Tx = this.db,
  ): Promise<{ ids: number[]; total: number }> {
    const within = await this.within(query);
    const ids = await this.products.orderedIds(query, within, cap + 1, executor);
    if (ids.length <= cap) return { ids, total: ids.length };
    return { ids: ids.slice(0, cap), total: await this.products.countItems(query, within) };
  }

  /**
   * Every product the filters keep in the list's order with its category and the moment it became
   * sale-ready, at most `cap`: «Bto300»'s shop index, read once per request (ADR-0093).
   */
  async index(query: ProductListQuery, cap: number): Promise<ProductIndexRow[]> {
    return this.products.indexRows(query, await this.within(query), cap);
  }

  /**
   * Every product the filters keep, in the list's order: «Таарсан бүх N-ийг сонгох» (ADR-0052).
   * More than the list may hold ticked is refused with the count.
   */
  async selectableIds(query: ProductListQuery): Promise<number[]> {
    const { ids, total } = await this.orderedIds(query, MAX_SELECTED_PRODUCTS);
    if (total > MAX_SELECTED_PRODUCTS) {
      throw new AppError(
        'SELECTION_TOO_LARGE',
        `${total} products match, at most ${MAX_SELECTED_PRODUCTS}`,
        { count: total, limit: MAX_SELECTED_PRODUCTS },
      );
    }
    return ids;
  }

  /** Ticked products in the list's order; unknown ids drop out (an export of the selection). */
  orderedOf(ids: readonly number[], executor: Db | Tx = this.db): Promise<number[]> {
    return this.products.orderedIds({}, ids, ids.length, executor);
  }

  /** List rows of these products in the order given. */
  listItemsOf(ids: readonly number[], executor: Db | Tx = this.db): Promise<ProductListItem[]> {
    return this.products.listItemsOf(ids, executor);
  }

  /** Each product's ready pictures, the primary first. */
  imagesOf(
    ids: readonly number[],
    executor: Db | Tx = this.db,
  ): Promise<Map<number, ProductImageUrls[]>> {
    return this.products.imagesOf(ids, executor);
  }

  /** product id → its primary picture's thumbnail URL, for products that have a ready one. */
  primaryThumbsOf(
    ids: readonly number[],
    executor: Db | Tx = this.db,
  ): Promise<Map<number, string>> {
    return this.products.primaryThumbsOf(ids, executor);
  }

  /** unit id → its unit of measure's code and default-sales flag, for current units. */
  unitFlagsOf(
    ids: readonly number[],
    executor: Db | Tx = this.db,
  ): Promise<Map<number, UnitFlags>> {
    return this.products.unitFlagsOf(ids, executor);
  }
}
