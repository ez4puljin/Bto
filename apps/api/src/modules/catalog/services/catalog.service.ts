import { Inject, Injectable } from '@nestjs/common';
import { and, eq, inArray, isNull } from 'drizzle-orm';
import { DB } from '../../../common/db/db.tokens';
import type { Db, Tx } from '../../../common/db/db.types';
import { products } from '../schema';
import {
  type ProductDetail,
  type ProductQuery,
  ProductsService,
  type ProductSummary,
} from './products.service';

/** Read access to products for other modules (docs/architecture.md §4 catalog row). */
@Injectable()
export class CatalogService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly products: ProductsService,
  ) {}

  get(id: number, executor: Db | Tx = this.db): Promise<ProductDetail> {
    return this.products.get(id, executor);
  }

  async getMany(ids: readonly number[], executor: Db | Tx = this.db): Promise<ProductSummary[]> {
    if (ids.length === 0) return [];
    const rows = await executor
      .select()
      .from(products)
      .where(inArray(products.id, [...ids]));
    return this.products.summaries(rows, executor);
  }

  search(query: ProductQuery) {
    return this.products.list(query);
  }

  /** Active products waiting for their prices (ADR-0044), counted up to `cap` (ADR-0047 #7). */
  async countWaitingForPrices(cap: number): Promise<number> {
    const rows = await this.db
      .select({ id: products.id })
      .from(products)
      .where(and(eq(products.status, 'ACTIVE'), isNull(products.saleReadyAt)))
      .limit(cap);
    return rows.length;
  }
}
