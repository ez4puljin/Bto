import { Inject, Injectable } from '@nestjs/common';
import {
  type CustomerNotificationKind,
  NOTICE_LIMITS,
  type NoticeKind,
} from '@tugeel/shared/notifications';
import { businessDate } from '@tugeel/shared/time';
import { and, count, desc, eq, isNull, lt, sql } from 'drizzle-orm';
import { DB } from '../../../common/db/db.tokens';
import { idIn } from '../../../common/db/days';
import type { Db } from '../../../common/db/db.types';
import { decodeCursor, DEFAULT_PAGE_LIMIT, toPage } from '../../../common/pagination/page';
import { type CustomerContext, StorageService } from '../../identity';
import { appNoticeCustomerReads, appNotices, customerNotifications } from '../schema';
import { runningOn } from './inbox.service';
import { NoticesService } from './notices.service';

/** A running customers' notice as «Bto300» shows it (the popup, the bell's list). */
export interface CustomerNotice {
  id: number;
  kind: NoticeKind;
  title: string;
  body: string;
  imageUrl: string | null;
  popup: boolean;
  validFrom: string;
  validTo: string | null;
  /** «Бараа харах»: the products in the admin's order; the app reads them from the shop. */
  productIds: number[];
  read: boolean;
  createdAt: Date;
}

/** A notification of the store (ADR-0079 #8); `payload` is what the event stored, by value. */
export interface CustomerNotification {
  id: number;
  kind: CustomerNotificationKind;
  orderId: number | null;
  invoiceId: number | null;
  paymentId: number | null;
  payload: Record<string, unknown>;
  read: boolean;
  createdAt: Date;
}

const asRecord = (value: unknown): Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};

/**
 * The customer app's bell (ADR-0079 #8): the running notices addressed to customers and the
 * store's own notifications, always of the token's own account. Reading is idempotent.
 */
@Injectable()
export class CustomerInboxService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly notices: NoticesService,
    private readonly storage: StorageService,
  ) {}

  async summary(ctx: CustomerContext): Promise<{ unread: number; notices: CustomerNotice[] }> {
    const notices = await this.running(ctx);
    const [own] = await this.db
      .select({ unread: count() })
      .from(customerNotifications)
      .where(
        and(
          eq(customerNotifications.customerUserId, ctx.customerUserId),
          isNull(customerNotifications.readAt),
        ),
      );
    return {
      unread: notices.filter((notice) => !notice.read).length + (own?.unread ?? 0),
      notices,
    };
  }

  /** The store's notifications, newest first (keyset by id). */
  async list(
    ctx: CustomerContext,
    query: { cursor?: string; limit?: number },
  ): Promise<{ data: CustomerNotification[]; nextCursor: string | null }> {
    const limit = query.limit ?? DEFAULT_PAGE_LIMIT;
    const cursor = decodeCursor(query.cursor);
    const after = typeof cursor?.id === 'number' ? cursor.id : null;
    const rows = await this.db
      .select()
      .from(customerNotifications)
      .where(
        and(
          eq(customerNotifications.customerUserId, ctx.customerUserId),
          after === null ? undefined : lt(customerNotifications.id, after),
        ),
      )
      .orderBy(desc(customerNotifications.id))
      .limit(limit + 1);
    const page = toPage(rows, limit, (row) => ({ id: row.id }));
    return {
      data: page.data.map((row) => ({
        id: row.id,
        kind: row.kind,
        orderId: row.orderId,
        invoiceId: row.invoiceId,
        paymentId: row.paymentId,
        payload: asRecord(row.payload),
        read: row.readAt !== null,
        createdAt: row.createdAt,
      })),
      nextCursor: page.nextCursor,
    };
  }

  /** Marks running customers' notices and the store's own notifications read; others ignored. */
  async read(
    ctx: CustomerContext,
    ids: { noticeIds?: readonly number[]; notificationIds?: readonly number[] },
  ): Promise<{ unread: number }> {
    const noticeIds = ids.noticeIds ?? [];
    if (noticeIds.length > 0) {
      const running = await this.db
        .select({ id: appNotices.id })
        .from(appNotices)
        .where(and(idIn(appNotices.id, noticeIds), runningOn(businessDate(), 'CUSTOMERS')));
      if (running.length > 0) {
        await this.db
          .insert(appNoticeCustomerReads)
          .values(running.map((row) => ({ noticeId: row.id, customerUserId: ctx.customerUserId })))
          .onConflictDoNothing();
      }
    }
    const notificationIds = ids.notificationIds ?? [];
    if (notificationIds.length > 0) {
      await this.db
        .update(customerNotifications)
        .set({ readAt: sql`now()` })
        .where(
          and(
            eq(customerNotifications.customerUserId, ctx.customerUserId),
            idIn(customerNotifications.id, notificationIds),
            isNull(customerNotifications.readAt),
          ),
        );
    }
    return { unread: (await this.summary(ctx)).unread };
  }

  private async running(ctx: CustomerContext): Promise<CustomerNotice[]> {
    const rows = await this.db
      .select({ notice: appNotices, readAt: appNoticeCustomerReads.readAt })
      .from(appNotices)
      .leftJoin(
        appNoticeCustomerReads,
        and(
          eq(appNoticeCustomerReads.noticeId, appNotices.id),
          eq(appNoticeCustomerReads.customerUserId, ctx.customerUserId),
        ),
      )
      .where(runningOn(businessDate(), 'CUSTOMERS'))
      .orderBy(desc(appNotices.id))
      .limit(NOTICE_LIMITS.summaryMax);
    const productIds = await this.notices.productIdsOf(rows.map((row) => row.notice.id));
    const images = await this.storage.publicUrls(
      rows.flatMap((row) => (row.notice.imageFileId === null ? [] : [row.notice.imageFileId])),
    );
    return rows.map(({ notice, readAt }) => ({
      id: notice.id,
      kind: notice.kind,
      title: notice.title,
      body: notice.body,
      imageUrl: notice.imageFileId === null ? null : (images.get(notice.imageFileId) ?? null),
      popup: notice.popup,
      validFrom: notice.validFrom,
      validTo: notice.validTo,
      productIds: productIds.get(notice.id) ?? [],
      read: readAt !== null,
      createdAt: notice.createdAt,
    }));
  }
}
