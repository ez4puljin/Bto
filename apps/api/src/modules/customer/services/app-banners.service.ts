import { Inject, Injectable } from '@nestjs/common';
import {
  BANNER_TITLE_MAX,
  type BannerLinkKind,
  type BannerState,
  bannerState,
} from '@tugeel/shared/sales';
import { businessDate, isIsoDate } from '@tugeel/shared/time';
import { and, asc, desc, eq, gt, inArray, isNull, lt, lte, or, sql } from 'drizzle-orm';
import { DB } from '../../../common/db/db.tokens';
import type { Db, Tx } from '../../../common/db/db.types';
import { inTransaction } from '../../../common/db/transaction';
import { invalid, notFound } from '../../../common/errors/app-error';
import { CatalogService, CategoriesService, ProductQueryService } from '../../catalog';
import { actorUserId, AuditService, type AuthContext, StorageService } from '../../identity';
import { SalesRepShopService } from '../../sales';
import { appBanners } from '../schema';

export const BANNER_IMAGE = 'customer.banner_image';

/** pg_advisory_xact_lock key: banners change their places one at a time. */
const BANNER_POSITION_LOCK = 72_036_002;

export interface BannerInput {
  imageFileId: number;
  title: string;
  linkKind: BannerLinkKind;
  linkId?: number | null;
  validFrom: string;
  /** Exclusive: the day after the last one; null runs until archived. */
  validTo?: string | null;
}

/** A banner as the admin's page lists it. */
export interface BannerView {
  id: number;
  title: string;
  imageUrl: string | null;
  linkKind: BannerLinkKind;
  linkId: number | null;
  /** The target's name («Ус, ундаа», «9201 · Coca-Cola»); null without a link or when gone. */
  linkName: string | null;
  /** The target is gone (archived segment, deleted category, product no longer on sale). */
  linkBroken: boolean;
  validFrom: string;
  validTo: string | null;
  position: number;
  state: BannerState;
  createdAt: Date;
}

/** A running banner as the app shows it: its link only when the target still exists. */
export interface RunningBanner {
  id: number;
  title: string;
  imageUrl: string | null;
  link: { kind: Exclude<BannerLinkKind, 'NONE'>; id: number } | null;
}

type BannerRow = typeof appBanners.$inferSelect;

/**
 * The banners of «Bto300»'s home (ADR-0092 #5): admins with `customer.home.manage` add them
 * with a picture, a title, a link and a period, move them up or down and archive them; nothing is
 * edited (a wrong banner is archived and made again, ADR-0093). Targets live in other modules and
 * are checked on every read: a banner whose target is gone stays, without its link.
 */
@Injectable()
export class AppBannersService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly audit: AuditService,
    private readonly storage: StorageService,
    private readonly catalog: CatalogService,
    private readonly categories: CategoriesService,
    private readonly productQuery: ProductQueryService,
    private readonly shop: SalesRepShopService,
  ) {}

  /** Every banner (live by default, or the archived ones) in position order. */
  async list(query: { archived?: boolean } = {}): Promise<BannerView[]> {
    const rows = await this.db
      .select()
      .from(appBanners)
      .where(
        query.archived ? sql`${appBanners.archivedAt} IS NOT NULL` : isNull(appBanners.archivedAt),
      )
      .orderBy(asc(appBanners.position));
    return this.views(rows);
  }

  async get(id: number): Promise<BannerView> {
    const [row] = await this.db.select().from(appBanners).where(eq(appBanners.id, id));
    if (!row) throw notFound('banner', id);
    const [view] = await this.views([row]);
    if (!view) throw notFound('banner', id);
    return view;
  }

  /**
   * The banners shown on `today`, in position order; a link whose target is gone (or, for a
   * product, no longer listed by the app: `listed`) is left out.
   */
  async running(today: string, listed: ReadonlySet<number>): Promise<RunningBanner[]> {
    const rows = await this.db
      .select()
      .from(appBanners)
      .where(
        and(
          isNull(appBanners.archivedAt),
          lte(appBanners.validFrom, today),
          or(isNull(appBanners.validTo), gt(appBanners.validTo, today)),
        ),
      )
      .orderBy(asc(appBanners.position));
    if (rows.length === 0) return [];
    const images = await this.storage.publicUrls(rows.map((row) => row.imageFileId));
    const live = await this.liveTargets(rows);
    return rows.map((row) => ({
      id: row.id,
      title: row.title,
      imageUrl: images.get(row.imageFileId) ?? null,
      link:
        row.linkKind === 'NONE' || row.linkId === null || !isLive(row, live, listed)
          ? null
          : { kind: row.linkKind, id: row.linkId },
    }));
  }

  async create(ctx: AuthContext, input: BannerInput): Promise<BannerView> {
    const today = businessDate();
    const title = input.title.trim();
    if ([...title].length < 1 || [...title].length > BANNER_TITLE_MAX) {
      throw invalid('title', 'length', `1 to ${BANNER_TITLE_MAX} characters`);
    }
    if (!isIsoDate(input.validFrom)) throw invalid('validFrom', 'isDate', 'validFrom is a date');
    if (input.validFrom < today) {
      throw invalid('validFrom', 'notPast', 'validFrom must be today or later');
    }
    const validTo = input.validTo ?? null;
    if (validTo !== null && !isIsoDate(validTo)) {
      throw invalid('validTo', 'isDate', 'validTo is a date');
    }
    if (validTo !== null && validTo <= input.validFrom) {
      throw invalid('validTo', 'afterStart', 'validTo must be after validFrom');
    }
    const linkId = input.linkKind === 'NONE' ? null : (input.linkId ?? null);
    if (input.linkKind === 'NONE' && input.linkId != null) {
      throw invalid('linkId', 'notAllowed', 'a banner without a link takes no linkId');
    }
    if (input.linkKind !== 'NONE' && linkId === null) {
      throw invalid('linkId', 'required', 'the linked segment, category or product');
    }
    if (linkId !== null) await this.assertTarget(input.linkKind, linkId);
    await this.storage.verifyUploaded(input.imageFileId, BANNER_IMAGE);
    const id = await inTransaction(this.db, async (tx) => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(${BANNER_POSITION_LOCK})`);
      await this.storage.confirm(tx, input.imageFileId, BANNER_IMAGE);
      const [last] = await tx
        .select({ max: sql<number | null>`max(${appBanners.position})::int` })
        .from(appBanners);
      const [row] = await tx
        .insert(appBanners)
        .values({
          imageFileId: input.imageFileId,
          title,
          linkKind: input.linkKind,
          linkId,
          validFrom: input.validFrom,
          validTo,
          position: (last?.max ?? 0) + 1,
          createdBy: actorUserId(ctx),
          updatedBy: actorUserId(ctx),
        })
        .returning();
      if (!row) throw new Error('banner insert returned no row');
      await this.audit.record(tx, ctx, {
        action: 'CREATE',
        entity: 'app_banners',
        entityId: row.id,
        after: auditView(row),
      });
      return row.id;
    });
    return this.get(id);
  }

  /**
   * Moves a live banner one place up or down among the live ones: it swaps places with its
   * neighbour in one statement; at the edge nothing changes.
   */
  async move(ctx: AuthContext, id: number, direction: 'UP' | 'DOWN'): Promise<BannerView> {
    await inTransaction(this.db, async (tx) => {
      const before = await this.lockLive(tx, id);
      const [neighbour] = await tx
        .select({ id: appBanners.id, position: appBanners.position })
        .from(appBanners)
        .where(
          and(
            isNull(appBanners.archivedAt),
            direction === 'UP'
              ? lt(appBanners.position, before.position)
              : gt(appBanners.position, before.position),
          ),
        )
        .orderBy(direction === 'UP' ? desc(appBanners.position) : asc(appBanners.position))
        .limit(1);
      if (!neighbour) return;
      await tx
        .update(appBanners)
        .set({
          position: sql`CASE WHEN ${appBanners.id} = ${id} THEN ${neighbour.position}::smallint ELSE ${before.position}::smallint END`,
          updatedBy: actorUserId(ctx),
          updatedAt: sql`now()`,
        })
        .where(inArray(appBanners.id, [id, neighbour.id]));
      await this.audit.record(tx, ctx, {
        action: 'MOVE',
        entity: 'app_banners',
        entityId: id,
        before: { position: before.position },
        after: { position: neighbour.position },
      });
    });
    return this.get(id);
  }

  /** Archives a banner: the app stops showing it at once; it is never deleted. */
  async archive(ctx: AuthContext, id: number): Promise<void> {
    await inTransaction(this.db, async (tx) => {
      const [before] = await tx
        .select()
        .from(appBanners)
        .where(eq(appBanners.id, id))
        .for('update');
      if (!before) throw notFound('banner', id);
      if (before.archivedAt) return;
      await tx
        .update(appBanners)
        .set({ archivedAt: sql`now()`, updatedBy: actorUserId(ctx), updatedAt: sql`now()` })
        .where(eq(appBanners.id, id));
      await this.audit.record(tx, ctx, {
        action: 'ARCHIVE',
        entity: 'app_banners',
        entityId: id,
        before: auditView(before),
      });
    });
  }

  /** Banners linking a segment and running today: their segments' lists stay open (ADR-0093). */
  async runningSegmentLinks(today: string): Promise<Set<number>> {
    const rows = await this.db
      .select({ linkId: appBanners.linkId })
      .from(appBanners)
      .where(
        and(
          isNull(appBanners.archivedAt),
          eq(appBanners.linkKind, 'SEGMENT'),
          lte(appBanners.validFrom, today),
          or(isNull(appBanners.validTo), gt(appBanners.validTo, today)),
        ),
      );
    return new Set(rows.flatMap((row) => (row.linkId === null ? [] : [row.linkId])));
  }

  private async lockLive(tx: Tx, id: number): Promise<BannerRow> {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(${BANNER_POSITION_LOCK})`);
    const [row] = await tx.select().from(appBanners).where(eq(appBanners.id, id)).for('update');
    if (!row || row.archivedAt) throw notFound('banner', id);
    return row;
  }

  /** A new banner's target must exist: a live product segment, a category, a product on sale. */
  private async assertTarget(kind: BannerLinkKind, id: number): Promise<void> {
    if (kind === 'SEGMENT') {
      if ((await this.productQuery.productSegments({ ids: [id] })).length === 0) {
        throw invalid('linkId', 'exists', `no live product segment ${id}`);
      }
    } else if (kind === 'CATEGORY') {
      if (!(await this.categories.list()).some((category) => category.id === id)) {
        throw invalid('linkId', 'exists', `no category ${id}`);
      }
    } else if (kind === 'PRODUCT') {
      if ((await this.shop.productsOf([id])).every((product) => !product.sellable)) {
        throw invalid('linkId', 'sellable', `product ${id} is not on sale in the app`);
      }
    }
  }

  /** The targets of these banners that still exist, by kind, with their names. */
  private async liveTargets(rows: readonly BannerRow[]) {
    const ids = (kind: BannerLinkKind) =>
      rows.flatMap((row) => (row.linkKind === kind && row.linkId !== null ? [row.linkId] : []));
    const segmentIds = ids('SEGMENT');
    const categoryIds = ids('CATEGORY');
    const productIds = ids('PRODUCT');
    const segments = new Map(
      (segmentIds.length ? await this.productQuery.productSegments({ ids: segmentIds }) : []).map(
        (segment) => [segment.id, segment.name],
      ),
    );
    const categories = new Map(
      (categoryIds.length ? await this.categories.list() : []).map((category) => [
        category.id,
        category.name,
      ]),
    );
    const products = new Map(
      (productIds.length ? await this.catalog.getMany(productIds) : []).map((product) => [
        product.id,
        `${product.sku} · ${product.name}`,
      ]),
    );
    const sellable = new Set(
      (productIds.length ? await this.shop.productsOf(productIds) : []).flatMap((product) =>
        product.sellable ? [product.id] : [],
      ),
    );
    return { segments, categories, products, sellable };
  }

  private async views(rows: readonly BannerRow[]): Promise<BannerView[]> {
    if (rows.length === 0) return [];
    const today = businessDate();
    const images = await this.storage.publicUrls(rows.map((row) => row.imageFileId));
    const live = await this.liveTargets(rows);
    return rows.map((row) => {
      const name =
        row.linkId === null
          ? null
          : row.linkKind === 'SEGMENT'
            ? live.segments.get(row.linkId)
            : row.linkKind === 'CATEGORY'
              ? live.categories.get(row.linkId)
              : live.products.get(row.linkId);
      return {
        id: row.id,
        title: row.title,
        imageUrl: images.get(row.imageFileId) ?? null,
        linkKind: row.linkKind,
        linkId: row.linkId,
        linkName: name ?? null,
        linkBroken: row.linkKind !== 'NONE' && !isLive(row, live, live.sellable),
        validFrom: row.validFrom,
        validTo: row.validTo,
        position: row.position,
        state: bannerState(
          { validFrom: row.validFrom, validTo: row.validTo, archived: row.archivedAt !== null },
          today,
        ),
        createdAt: row.createdAt,
      };
    });
  }
}

function isLive(
  row: BannerRow,
  live: { segments: ReadonlyMap<number, string>; categories: ReadonlyMap<number, string> },
  products: ReadonlySet<number>,
): boolean {
  if (row.linkId === null) return row.linkKind === 'NONE';
  switch (row.linkKind) {
    case 'SEGMENT':
      return live.segments.has(row.linkId);
    case 'CATEGORY':
      return live.categories.has(row.linkId);
    case 'PRODUCT':
      return products.has(row.linkId);
    case 'NONE':
      return true;
  }
}

function auditView(row: BannerRow) {
  return {
    title: row.title,
    imageFileId: row.imageFileId,
    linkKind: row.linkKind,
    linkId: row.linkId,
    validFrom: row.validFrom,
    validTo: row.validTo,
    position: row.position,
  };
}
