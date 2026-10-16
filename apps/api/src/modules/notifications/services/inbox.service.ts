import { Inject, Injectable } from '@nestjs/common';
import {
  NOTICE_LIMITS,
  type NoticeKind,
  type UserNotificationKind,
} from '@tugeel/shared/notifications';
import { businessDate } from '@tugeel/shared/time';
import { and, count, desc, eq, gt, isNull, lt, lte, or, sql } from 'drizzle-orm';
import { DB } from '../../../common/db/db.tokens';
import type { Db } from '../../../common/db/db.types';
import { idIn } from '../../../common/db/days';
import { decodeCursor, DEFAULT_PAGE_LIMIT, toPage } from '../../../common/pagination/page';
import { type AuthContext, StorageService } from '../../identity';
import { CustomersService } from '../../partners';
import { appNoticeReads, appNotices, userNotifications } from '../schema';
import { NoticesService, RECIPIENT_PERMISSION } from './notices.service';

export interface MyNotice {
  id: number;
  kind: NoticeKind;
  title: string;
  body: string;
  imageUrl: string | null;
  popup: boolean;
  validFrom: string;
  validTo: string | null;
  productIds: number[];
  read: boolean;
  createdAt: Date;
}

export interface MyNotification {
  id: number;
  kind: UserNotificationKind;
  orderId: number | null;
  orderNumber: string;
  customerName: string;
  orderTotal: string | null;
  invoiceNumber: string | null;
  read: boolean;
  createdAt: Date;
}

/** What the sale stored (ADR-0062 #4), read back defensively. */
interface SoldPayload {
  orderNumber: string;
  customerId: number | null;
  orderTotal: string | null;
  invoiceNumber: string | null;
}

function soldPayload(value: unknown): SoldPayload {
  const record =
    typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {};
  const text = (key: string): string | null => {
    const field = record[key];
    return typeof field === 'string' ? field : null;
  };
  return {
    orderNumber: text('orderNumber') ?? '',
    customerId: typeof record.customerId === 'number' ? record.customerId : null,
    orderTotal: text('orderTotal'),
    invoiceNumber: text('invoiceNumber'),
  };
}

/**
 * The signed-in user's notices and notifications (ADR-0062 #3): the running notices for holders of
 * `sales.orders.rep`, and the notifications addressed to the user. Reading is idempotent.
 */
@Injectable()
export class InboxService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly notices: NoticesService,
    private readonly storage: StorageService,
    private readonly customers: CustomersService,
  ) {}

  /** The running notices (newest first, capped) and the unread count over both kinds. */
  async summary(ctx: AuthContext): Promise<{ unread: number; notices: MyNotice[] }> {
    const notices = ctx.permissions.has(RECIPIENT_PERMISSION) ? await this.running(ctx) : [];
    const [own] = await this.db
      .select({ unread: count() })
      .from(userNotifications)
      .where(and(eq(userNotifications.userId, ctx.userId), isNull(userNotifications.readAt)));
    return {
      unread: notices.filter((notice) => !notice.read).length + (own?.unread ?? 0),
      notices,
    };
  }

  /** The user's own notifications, newest first. */
  async list(
    ctx: AuthContext,
    query: { cursor?: string; limit?: number },
  ): Promise<{ data: MyNotification[]; nextCursor: string | null }> {
    const limit = query.limit ?? DEFAULT_PAGE_LIMIT;
    const cursor = decodeCursor(query.cursor);
    const after = typeof cursor?.id === 'number' ? cursor.id : null;
    const rows = await this.db
      .select()
      .from(userNotifications)
      .where(
        and(
          eq(userNotifications.userId, ctx.userId),
          after === null ? undefined : lt(userNotifications.id, after),
        ),
      )
      .orderBy(desc(userNotifications.id))
      .limit(limit + 1);
    const page = toPage(rows, limit, (row) => ({ id: row.id }));
    const payloads = new Map(page.data.map((row) => [row.id, soldPayload(row.payload)]));
    const customerIds = [...payloads.values()].flatMap((payload) =>
      payload.customerId === null ? [] : [payload.customerId],
    );
    const names = new Map(
      (await this.customers.getMany([...new Set(customerIds)])).map((customer) => [
        customer.id,
        customer.name,
      ]),
    );
    return {
      data: page.data.map((row) => {
        const payload = payloads.get(row.id) ?? soldPayload(null);
        return {
          id: row.id,
          kind: row.kind,
          orderId: row.orderId,
          orderNumber: payload.orderNumber,
          customerName: payload.customerId === null ? '' : (names.get(payload.customerId) ?? ''),
          orderTotal: payload.orderTotal,
          invoiceNumber: payload.invoiceNumber,
          read: row.readAt !== null,
          createdAt: row.createdAt,
        };
      }),
      nextCursor: page.nextCursor,
    };
  }

  /**
   * Marks notices (closed or opened on the phone) and own notifications as read; ids that are not
   * running or not the user's are ignored. Answers the unread count afterwards.
   */
  async read(
    ctx: AuthContext,
    ids: { noticeIds?: readonly number[]; notificationIds?: readonly number[] },
  ): Promise<{ unread: number }> {
    const noticeIds = ids.noticeIds ?? [];
    if (noticeIds.length > 0 && ctx.permissions.has(RECIPIENT_PERMISSION)) {
      const today = businessDate();
      const running = await this.db
        .select({ id: appNotices.id })
        .from(appNotices)
        .where(and(idIn(appNotices.id, noticeIds), runningOn(today)));
      if (running.length > 0) {
        await this.db
          .insert(appNoticeReads)
          .values(running.map((row) => ({ noticeId: row.id, userId: ctx.userId })))
          .onConflictDoNothing();
      }
    }
    const notificationIds = ids.notificationIds ?? [];
    if (notificationIds.length > 0) {
      await this.db
        .update(userNotifications)
        .set({ readAt: sql`now()` })
        .where(
          and(
            eq(userNotifications.userId, ctx.userId),
            idIn(userNotifications.id, notificationIds),
            isNull(userNotifications.readAt),
          ),
        );
    }
    return { unread: (await this.summary(ctx)).unread };
  }

  private async running(ctx: AuthContext): Promise<MyNotice[]> {
    const today = businessDate();
    const rows = await this.db
      .select({ notice: appNotices, readAt: appNoticeReads.readAt })
      .from(appNotices)
      .leftJoin(
        appNoticeReads,
        and(eq(appNoticeReads.noticeId, appNotices.id), eq(appNoticeReads.userId, ctx.userId)),
      )
      .where(runningOn(today))
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

/** Not withdrawn, started and not ended on `today` (Ulaanbaatar, ADR-0062 #1). */
function runningOn(today: string) {
  return and(
    isNull(appNotices.withdrawnAt),
    lte(appNotices.validFrom, today),
    or(isNull(appNotices.validTo), gt(appNotices.validTo, today)),
  );
}
