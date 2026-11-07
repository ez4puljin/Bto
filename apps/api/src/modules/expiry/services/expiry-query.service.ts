import { Inject, Injectable } from '@nestjs/common';
import {
  EXPIRY_SOON_DAYS,
  EXPIRY_URGENT_DAYS,
  type ExpiryLiabilityType,
  type ExpiryView,
} from '@tugeel/shared/expiry';
import { addDays, businessDate, isIsoDate } from '@tugeel/shared/time';
import { and, asc, desc, eq, gt, gte, lt, lte, ne, or, type SQL, sql } from 'drizzle-orm';
import { ATTENTION_CAP } from '../../../common/attention';
import { idIn } from '../../../common/db/days';
import { DB } from '../../../common/db/db.tokens';
import type { Db } from '../../../common/db/db.types';
import { notFound } from '../../../common/errors/app-error';
import {
  decodeCursor,
  DEFAULT_PAGE_LIMIT,
  invalidCursor,
  toPage,
} from '../../../common/pagination/page';
import { ProductQueryService } from '../../catalog';
import { type AuthContext, OrgService } from '../../identity';
import { ProductLocationsService } from '../../inventory';
import { ProductSuppliersService, SuppliersService } from '../../partners';
import { expiryItemChanges, expiryItems } from '../schema';
import { ExpiryViewService } from './expiry-view.service';

const { expiryDate, id: itemId, productId, status } = expiryItems;

export interface ExpiryListQuery {
  view?: ExpiryView;
  q?: string;
  supplierId?: number;
  warehouseId?: number;
  createdByName?: string;
  liability?: ExpiryLiabilityType;
  productId?: number;
  cursor?: string;
  limit?: number;
}

const open = (): SQL => ne(status, 'ARCHIVED');

/** Open records within `from … to`, both ends included. */
const openBetween = (from: string, to: string): SQL =>
  and(open(), gte(expiryDate, from), lte(expiryDate, to)) ?? sql`false`;

/** What a view keeps. URGENT and SOON are the summary's cards, so both start today. */
function inViewOf(view: ExpiryView, today: string): SQL {
  switch (view) {
    case 'ACTIVE':
      return open();
    case 'EXPIRED':
      return and(open(), lt(expiryDate, today)) ?? sql`false`;
    case 'URGENT':
      return openBetween(today, addDays(today, EXPIRY_URGENT_DAYS));
    case 'SOON':
      return openBetween(today, addDays(today, EXPIRY_SOON_DAYS));
    default:
      return eq(status, view);
  }
}

/** The list's cursor: the date and id of a page's last row; 422 for anything else. */
function afterOf(cursor: string | undefined): { date: string; id: number } | null {
  const key = decodeCursor(cursor);
  if (key === undefined) return null;
  const { d: date, i: id } = key;
  if (typeof date !== 'string' || !isIsoDate(date) || !Number.isSafeInteger(id)) {
    throw invalidCursor();
  }
  return { date, id: id as number };
}

/** Rows after a cursor in the list's order: the date one way, then always the higher id first. */
function keyset(after: { date: string; id: number }, newestFirst: boolean): SQL | undefined {
  return or(
    newestFirst ? lt(expiryDate, after.date) : gt(expiryDate, after.date),
    and(eq(expiryDate, after.date), lt(itemId, after.id)),
  );
}

const byName = (a: { name: string }, b: { name: string }) => a.name.localeCompare(b.name, 'mn');

/**
 * Reading the register (ADR-0172 #8). Rows are paged on the register's own columns: a text search,
 * a supplier or a warehouse first narrows the register's distinct products through their owners, and
 * nothing joins another module's tables.
 */
@Injectable()
export class ExpiryQueryService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly views: ExpiryViewService,
    private readonly productQuery: ProductQueryService,
    private readonly productSuppliers: ProductSuppliersService,
    private readonly suppliers: SuppliersService,
    private readonly locations: ProductLocationsService,
    private readonly org: OrgService,
  ) {}

  async list(query: ExpiryListQuery) {
    const limit = query.limit ?? DEFAULT_PAGE_LIMIT;
    const view = query.view ?? 'ACTIVE';
    const after = afterOf(query.cursor);
    const inView = inViewOf(view, businessDate());
    const narrowed = await this.narrowedProducts(inView, query);
    if (narrowed?.length === 0) return { data: [], nextCursor: null };
    const newestFirst = view === 'ARCHIVED';
    const rows = await this.db
      .select()
      .from(expiryItems)
      .where(
        and(
          inView,
          query.productId === undefined ? undefined : eq(productId, query.productId),
          query.createdByName === undefined
            ? undefined
            : eq(expiryItems.createdByName, query.createdByName),
          query.liability === undefined
            ? undefined
            : eq(expiryItems.liabilityType, query.liability),
          narrowed === null ? undefined : idIn(productId, narrowed),
          after === null ? undefined : keyset(after, newestFirst),
        ),
      )
      .orderBy(newestFirst ? desc(expiryDate) : asc(expiryDate), desc(itemId))
      .limit(limit + 1);
    const page = toPage(rows, limit, (row) => ({ d: row.expiryDate, i: row.id }));
    return { data: await this.views.views(page.data), nextCursor: page.nextCursor };
  }

  async get(id: number) {
    const [row] = await this.db.select().from(expiryItems).where(eq(itemId, id));
    if (!row) throw notFound('expiry item', id);
    return this.views.view(row);
  }

  /** The record's quantity history, oldest first. */
  async history(id: number) {
    const [row] = await this.db.select({ id: itemId }).from(expiryItems).where(eq(itemId, id));
    if (!row) throw notFound('expiry item', id);
    return this.db
      .select()
      .from(expiryItemChanges)
      .where(eq(expiryItemChanges.itemId, id))
      .orderBy(asc(expiryItemChanges.changedAt), asc(expiryItemChanges.id));
  }

  async summary() {
    const today = businessDate();
    const counted = (where: SQL) => sql<number>`(count(*) FILTER (WHERE ${where}))::int`;
    const [row] = await this.db
      .select({
        active: counted(open()),
        expired: counted(inViewOf('EXPIRED', today)),
        urgent: counted(inViewOf('URGENT', today)),
        soon: counted(inViewOf('SOON', today)),
        archived: counted(eq(status, 'ARCHIVED')),
        review: counted(eq(status, 'REVIEW')),
        cityReturn: counted(eq(status, 'CITY_RETURN')),
        internalSale: counted(eq(status, 'INTERNAL_SALE')),
      })
      .from(expiryItems);
    if (!row) throw new Error('a count always answers a row');
    return {
      today,
      soonDays: EXPIRY_SOON_DAYS,
      urgentDays: EXPIRY_URGENT_DAYS,
      active: row.active,
      expired: row.expired,
      urgent: row.urgent,
      soon: row.soon,
      archived: row.archived,
      byStatus: {
        REVIEW: row.review,
        CITY_RETURN: row.cityReturn,
        INTERNAL_SALE: row.internalSale,
      },
    };
  }

  /** The choices of the list's filters, from the records in that view. */
  async filters(view: ExpiryView = 'ACTIVE') {
    const inView = inViewOf(view, businessDate());
    const productIds = await this.distinctProducts(inView);
    const mainSupplier = await this.productSuppliers.mainSupplierOf(productIds);
    const suppliers = await this.suppliers.getMany([...new Set(mainSupplier.values())]);
    const home = await this.locations.homeOf(productIds);
    const warehouseNames = await this.org.warehouseNames([...new Set(home.values())]);
    const creators = await this.db
      .selectDistinct({ name: expiryItems.createdByName })
      .from(expiryItems)
      .where(inView);
    return {
      suppliers: suppliers.map(({ id, name }) => ({ id, name })).sort(byName),
      warehouses: [...warehouseNames].map(([id, name]) => ({ id, name })).sort(byName),
      creators: creators.sort(byName).map((row) => row.name),
    };
  }

  /** The two home tiles (ADR-0172 #10): the work of whoever decides what happens to the goods. */
  async attention(ctx: AuthContext): Promise<{ expired: number; dueSoon: number }> {
    if (!ctx.permissions.has('expiry.items.manage')) return { expired: 0, dueSoon: 0 };
    const today = businessDate();
    const count = async (where: SQL) =>
      (
        await this.db
          .select({ one: sql`1` })
          .from(expiryItems)
          .where(where)
          .limit(ATTENTION_CAP)
      ).length;
    return {
      expired: await count(inViewOf('EXPIRED', today)),
      dueSoon: await count(inViewOf('URGENT', today)),
    };
  }

  /** The products a text, a supplier or a warehouse keep of those in the view; null: no such filter. */
  private async narrowedProducts(inView: SQL, query: ExpiryListQuery): Promise<number[] | null> {
    const q = query.q?.trim();
    if (!q && query.supplierId === undefined && query.warehouseId === undefined) return null;
    let kept = await this.distinctProducts(inView);
    if (query.supplierId !== undefined) {
      const mainSupplier = await this.productSuppliers.mainSupplierOf(kept);
      kept = kept.filter((id) => mainSupplier.get(id) === query.supplierId);
    }
    if (query.warehouseId !== undefined) {
      const home = await this.locations.homeOf(kept);
      kept = kept.filter((id) => home.get(id) === query.warehouseId);
    }
    if (!q || kept.length === 0) return kept;
    // Narrowed to the register's own products, the cap of the search can never cut a match off.
    return (await this.productQuery.orderedIds({ q, onlyIds: kept }, kept.length)).ids;
  }

  private async distinctProducts(inView: SQL): Promise<number[]> {
    const rows = await this.db.selectDistinct({ productId }).from(expiryItems).where(inView);
    return rows.map((row) => row.productId);
  }
}
