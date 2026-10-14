import { Inject, Injectable, type OnModuleInit } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { DB } from '../../../common/db/db.tokens';
import type { Db, Tx } from '../../../common/db/db.types';
import { AppError } from '../../../common/errors/app-error';
import { PRODUCT_SET_RESOLVER, type ProductSetFilter, type ProductSetResolver } from '../hooks';
import { type ProductListItem, type ProductQuery, ProductsService } from './products.service';

/** The product list's filters: today's (search, category, stage) and a segment filter. */
export interface ProductListQuery extends ProductQuery, ProductSetFilter {}

/**
 * The product list with filters on other modules' data (ADR-0049 #4). Catalog keeps its rows,
 * order and cursor; the products a `where` or a segment keeps come from the resolver the segments
 * module binds. Without a bound resolver a filtered request is refused (503), never answered with
 * every product.
 */
@Injectable()
export class ProductQueryService implements OnModuleInit {
  private resolver: ProductSetResolver | null = null;

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
  }

  /** The products a segment filter keeps, ascending; null when the query has none. */
  async within(filter: ProductSetFilter): Promise<number[] | null> {
    if (filter.where === undefined && filter.segmentId === undefined) return null;
    if (!this.resolver) {
      throw new AppError('SERVICE_UNAVAILABLE', 'segment filters are not available');
    }
    return this.resolver.productIds({
      ...(filter.where === undefined ? {} : { where: filter.where }),
      ...(filter.segmentId === undefined ? {} : { segmentId: filter.segmentId }),
    });
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

  /** Ticked products in the list's order; unknown ids drop out (an export of the selection). */
  orderedOf(ids: readonly number[], executor: Db | Tx = this.db): Promise<number[]> {
    return this.products.orderedIds({}, ids, ids.length, executor);
  }

  /** List rows of these products in the order given. */
  listItemsOf(ids: readonly number[], executor: Db | Tx = this.db): Promise<ProductListItem[]> {
    return this.products.listItemsOf(ids, executor);
  }
}
