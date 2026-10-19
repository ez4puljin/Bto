import { Inject, Injectable } from '@nestjs/common';
import {
  NOTICE_LIMITS,
  type NoticeAudience,
  type NoticeKind,
  type NoticeState,
  noticeState,
  noticeTextLength,
} from '@tugeel/shared/notifications';
import { businessDate, isIsoDate } from '@tugeel/shared/time';
import { and, asc, count, desc, eq, lt, sql } from 'drizzle-orm';
import { DB } from '../../../common/db/db.tokens';
import type { Db } from '../../../common/db/db.types';
import { idIn } from '../../../common/db/days';
import { inTransaction } from '../../../common/db/transaction';
import { AppError, invalid, notFound } from '../../../common/errors/app-error';
import { decodeCursor, DEFAULT_PAGE_LIMIT, toPage } from '../../../common/pagination/page';
import { CatalogService } from '../../catalog';
import {
  AuditService,
  type AuthContext,
  CustomerAccountsService,
  PermissionHoldersService,
  StorageService,
  UserNamesService,
} from '../../identity';
import { appNoticeCustomerReads, appNoticeProducts, appNoticeReads, appNotices } from '../schema';

export const NOTICE_IMAGE = 'notifications.notice_image';
/** Who the notices are for (ADR-0062 #2). */
export const RECIPIENT_PERMISSION = 'sales.orders.rep';

export interface NoticeInput {
  kind: NoticeKind;
  /** The sales reps' app (the default) or the customers' «Bto300» (ADR-0079 #8). */
  audience?: NoticeAudience;
  title: string;
  body: string;
  imageFileId?: number | null;
  productIds: readonly number[];
  validFrom: string;
  validTo?: string | null;
  popup: boolean;
}

export interface NoticeProduct {
  id: number;
  sku: string;
  name: string;
  thumbUrl: string | null;
}

export interface NoticeView {
  id: number;
  kind: NoticeKind;
  audience: NoticeAudience;
  title: string;
  body: string;
  imageUrl: string | null;
  popup: boolean;
  validFrom: string;
  validTo: string | null;
  state: NoticeState;
  products: NoticeProduct[];
  recipients: number;
  reads: number;
  createdBy: number;
  createdByName: string;
  createdAt: Date;
  withdrawnAt: Date | null;
  withdrawnByName: string | null;
}

type NoticeRow = typeof appNotices.$inferSelect;

/**
 * The admin's notices (ADR-0062 #1–#2): written once, withdrawn instead of edited; listed with
 * their state on the business date and how many recipients read them. The picture is checked
 * before the transaction (a storage call) and attached inside it.
 */
@Injectable()
export class NoticesService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly audit: AuditService,
    private readonly storage: StorageService,
    private readonly catalog: CatalogService,
    private readonly holders: PermissionHoldersService,
    private readonly names: UserNamesService,
    private readonly customerAccounts: CustomerAccountsService,
  ) {}

  async create(ctx: AuthContext, input: NoticeInput): Promise<NoticeView> {
    const today = businessDate();
    const title = input.title.trim();
    const body = input.body.trim();
    checkLength('title', title, NOTICE_LIMITS.titleMax);
    checkLength('body', body, NOTICE_LIMITS.bodyMax);
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
    const imageFileId = input.imageFileId ?? null;
    if (imageFileId !== null) await this.storage.verifyUploaded(imageFileId, NOTICE_IMAGE);

    const id = await inTransaction(this.db, async (tx) => {
      const found = new Map(
        (await this.catalog.getMany(input.productIds, tx)).map((product) => [product.id, product]),
      );
      for (const [index, productId] of input.productIds.entries()) {
        const product = found.get(productId);
        if (!product) throw notFound('product', productId);
        if (product.status !== 'ACTIVE' || product.saleReadyAt === null) {
          throw new AppError(
            'PRODUCT_NOT_SELLABLE',
            `${product.sku} is not on sale`,
            { sku: product.sku },
            [{ path: `productIds.${index}`, constraint: 'sellable', message: product.sku }],
          );
        }
      }
      if (imageFileId !== null) await this.storage.confirm(tx, imageFileId, NOTICE_IMAGE);
      const [row] = await tx
        .insert(appNotices)
        .values({
          kind: input.kind,
          audience: input.audience ?? 'SALES_REPS',
          title,
          body,
          imageFileId,
          popup: input.popup,
          validFrom: input.validFrom,
          validTo,
          createdBy: ctx.userId,
        })
        .returning({ id: appNotices.id });
      if (!row) throw new Error('app notice insert returned no row');
      if (input.productIds.length > 0) {
        // One statement, in product order; `position` keeps the admin's order.
        await tx
          .insert(appNoticeProducts)
          .values(
            input.productIds
              .map((productId, index) => ({ noticeId: row.id, productId, position: index + 1 }))
              .sort((a, b) => a.productId - b.productId),
          );
      }
      await this.audit.record(tx, ctx, {
        action: 'CREATE',
        entity: 'app_notices',
        entityId: row.id,
        after: {
          kind: input.kind,
          audience: input.audience ?? 'SALES_REPS',
          title,
          popup: input.popup,
          validFrom: input.validFrom,
          validTo,
          imageFileId,
          productIds: input.productIds,
        },
      });
      return row.id;
    });
    return this.get(id);
  }

  /** Every notice, newest first, with its state today. */
  async list(query: {
    cursor?: string;
    limit?: number;
  }): Promise<{ data: NoticeView[]; nextCursor: string | null }> {
    const limit = query.limit ?? DEFAULT_PAGE_LIMIT;
    const cursor = decodeCursor(query.cursor);
    const after = typeof cursor?.id === 'number' ? cursor.id : null;
    const rows = await this.db
      .select()
      .from(appNotices)
      .where(after === null ? undefined : lt(appNotices.id, after))
      .orderBy(desc(appNotices.id))
      .limit(limit + 1);
    const page = toPage(rows, limit, (row) => ({ id: row.id }));
    return { data: await this.views(page.data), nextCursor: page.nextCursor };
  }

  async get(id: number): Promise<NoticeView> {
    const [row] = await this.db.select().from(appNotices).where(eq(appNotices.id, id));
    if (!row) throw notFound('app notice', id);
    const [view] = await this.views([row]);
    if (!view) throw notFound('app notice', id);
    return view;
  }

  /** Takes a notice off every phone at once (ADR-0062 #1); withdrawing it again changes nothing. */
  async withdraw(ctx: AuthContext, id: number): Promise<NoticeView> {
    await inTransaction(this.db, async (tx) => {
      const [row] = await tx
        .select({ id: appNotices.id, withdrawnAt: appNotices.withdrawnAt })
        .from(appNotices)
        .where(eq(appNotices.id, id))
        .for('update');
      if (!row) throw notFound('app notice', id);
      if (row.withdrawnAt !== null) return;
      await tx
        .update(appNotices)
        .set({ withdrawnAt: sql`now()`, withdrawnBy: ctx.userId })
        .where(eq(appNotices.id, id));
      await this.audit.record(tx, ctx, {
        action: 'WITHDRAW',
        entity: 'app_notices',
        entityId: id,
      });
    });
    return this.get(id);
  }

  /** The products of notices in the admin's order, by notice. */
  async productIdsOf(noticeIds: readonly number[]): Promise<Map<number, number[]>> {
    const byNotice = new Map<number, number[]>();
    if (noticeIds.length === 0) return byNotice;
    const rows = await this.db
      .select({ noticeId: appNoticeProducts.noticeId, productId: appNoticeProducts.productId })
      .from(appNoticeProducts)
      .where(idIn(appNoticeProducts.noticeId, noticeIds))
      .orderBy(asc(appNoticeProducts.noticeId), asc(appNoticeProducts.position));
    for (const row of rows) {
      const list = byNotice.get(row.noticeId) ?? [];
      list.push(row.productId);
      byNotice.set(row.noticeId, list);
    }
    return byNotice;
  }

  private async views(rows: readonly NoticeRow[]): Promise<NoticeView[]> {
    if (rows.length === 0) return [];
    const today = businessDate();
    const ids = rows.map((row) => row.id);
    const productIds = await this.productIdsOf(ids);
    const products = new Map(
      (await this.catalog.getMany([...new Set([...productIds.values()].flat())])).map((product) => [
        product.id,
        product,
      ]),
    );
    const images = await this.storage.publicUrls(
      rows.flatMap((row) => (row.imageFileId === null ? [] : [row.imageFileId])),
    );
    const names = await this.names.namesOf(
      rows.flatMap((row) => [
        row.createdBy,
        ...(row.withdrawnBy === null ? [] : [row.withdrawnBy]),
      ]),
    );
    // The reps who hold the permission through a role other than ADMIN; the stores' active app
    // accounts (ADR-0079 #8). Each notice counts the reads of its own audience.
    const recipients = rows.some((row) => row.audience === 'SALES_REPS')
      ? await this.holders.activeHolders(RECIPIENT_PERMISSION, { excludeAdminOnly: true })
      : [];
    const stores = rows.some((row) => row.audience === 'CUSTOMERS')
      ? await this.customerAccounts.activeAccountIds()
      : [];
    const reads = new Map<number, number>();
    const repNotices = rows.filter((row) => row.audience === 'SALES_REPS').map((row) => row.id);
    if (recipients.length > 0 && repNotices.length > 0) {
      const counted = await this.db
        .select({ noticeId: appNoticeReads.noticeId, reads: count() })
        .from(appNoticeReads)
        .where(
          and(idIn(appNoticeReads.noticeId, repNotices), idIn(appNoticeReads.userId, recipients)),
        )
        .groupBy(appNoticeReads.noticeId);
      for (const row of counted) reads.set(row.noticeId, row.reads);
    }
    const storeNotices = rows.filter((row) => row.audience === 'CUSTOMERS').map((row) => row.id);
    if (stores.length > 0 && storeNotices.length > 0) {
      const counted = await this.db
        .select({ noticeId: appNoticeCustomerReads.noticeId, reads: count() })
        .from(appNoticeCustomerReads)
        .where(
          and(
            idIn(appNoticeCustomerReads.noticeId, storeNotices),
            idIn(appNoticeCustomerReads.customerUserId, stores),
          ),
        )
        .groupBy(appNoticeCustomerReads.noticeId);
      for (const row of counted) reads.set(row.noticeId, row.reads);
    }
    return rows.map((row) => ({
      id: row.id,
      kind: row.kind,
      audience: row.audience,
      title: row.title,
      body: row.body,
      imageUrl: row.imageFileId === null ? null : (images.get(row.imageFileId) ?? null),
      popup: row.popup,
      validFrom: row.validFrom,
      validTo: row.validTo,
      state: noticeState(
        { validFrom: row.validFrom, validTo: row.validTo, withdrawn: row.withdrawnAt !== null },
        today,
      ),
      products: (productIds.get(row.id) ?? []).flatMap((productId) => {
        const product = products.get(productId);
        return product
          ? [{ id: product.id, sku: product.sku, name: product.name, thumbUrl: product.thumbUrl }]
          : [];
      }),
      recipients: row.audience === 'CUSTOMERS' ? stores.length : recipients.length,
      reads: reads.get(row.id) ?? 0,
      createdBy: row.createdBy,
      createdByName: names.get(row.createdBy) ?? '',
      createdAt: row.createdAt,
      withdrawnAt: row.withdrawnAt,
      withdrawnByName: row.withdrawnBy === null ? null : (names.get(row.withdrawnBy) ?? null),
    }));
  }
}

/** Characters as the database counts them, after trimming (ADR-0062 #1). */
function checkLength(path: string, value: string, max: number): void {
  const length = noticeTextLength(value);
  if (length === 0) throw invalid(path, 'isNotEmpty', `${path} is required`);
  if (length > max) throw invalid(path, 'maxLength', `${path} is longer than ${max}`);
}
