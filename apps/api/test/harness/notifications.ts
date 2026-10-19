import type { NestExpressApplication } from '@nestjs/platform-express';
import { businessDate } from '@tugeel/shared/time';
import request from 'supertest';
import { idempotency } from './catalog';
import { bearer } from './identity';

export interface AppNoticeJson {
  id: number;
  kind: string;
  title: string;
  body: string;
  imageUrl: string | null;
  popup: boolean;
  validFrom: string;
  validTo: string | null;
  state: 'SCHEDULED' | 'RUNNING' | 'ENDED' | 'WITHDRAWN';
  products: { id: number; sku: string; name: string; thumbUrl: string | null }[];
  recipients: number;
  reads: number;
  createdByName: string;
  withdrawnAt: string | null;
  withdrawnByName: string | null;
}

export interface MyNoticeJson {
  id: number;
  title: string;
  popup: boolean;
  imageUrl: string | null;
  productIds: number[];
  read: boolean;
}

export interface MySummaryJson {
  unread: number;
  notices: MyNoticeJson[];
}

export interface MyNotificationJson {
  id: number;
  kind: 'ORDER_SOLD';
  orderId: number | null;
  orderNumber: string;
  customerName: string;
  orderTotal: string | null;
  invoiceNumber: string | null;
  read: boolean;
}

/** A notice body running from today, without products or a picture unless given. */
export function noticeBody(fields: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    kind: 'PROMOTION',
    title: 'Урамшуулал',
    body: 'Энэ долоо хоногт хайрцаг бүрт нэг ширхэг бэлэг.',
    productIds: [],
    validFrom: businessDate(),
    validTo: null,
    popup: true,
    ...fields,
  };
}

/** Bytes that pass the PNG signature check (the storage never decodes them). */
export function pngBytes(size = 200): Buffer {
  const body = Buffer.alloc(size, 7);
  body.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  return body;
}

/** The admin's notices (ADR-0062) and a user's own inbox, as the web and the app call them. */
export function notificationsApi(app: NestExpressApplication, token: string) {
  const http = () => request(app.getHttpServer());
  const auth = bearer(token);
  return {
    http,
    create(body: Record<string, unknown>, key: Record<string, string> = idempotency()) {
      return http().post('/api/v1/app-notices').set(auth).set(key).send(body);
    },
    async notice(body: Record<string, unknown>): Promise<AppNoticeJson> {
      return (await this.create(body).expect(201)).body as AppNoticeJson;
    },
    async list(): Promise<AppNoticeJson[]> {
      return (
        (await http().get('/api/v1/app-notices').query({ limit: 200 }).set(auth).expect(200))
          .body as { data: AppNoticeJson[] }
      ).data;
    },
    async find(id: number): Promise<AppNoticeJson> {
      const found = (await this.list()).find((notice) => notice.id === id);
      if (!found) throw new Error(`notice ${id} not listed`);
      return found;
    },
    withdraw(id: number) {
      return http().post(`/api/v1/app-notices/${id}/withdraw`).set(auth);
    },
    async upload(bytes: Buffer = pngBytes()): Promise<number> {
      const issued = (
        await http()
          .post('/api/v1/files/presign')
          .set(auth)
          .send({
            kind: 'notifications.notice_image',
            contentType: 'image/png',
            sizeBytes: bytes.length,
          })
          .expect(201)
      ).body as { fileId: number; uploadUrl: string };
      await http().put(issued.uploadUrl).set('Content-Type', 'image/png').send(bytes).expect(204);
      return issued.fileId;
    },
    async summary(): Promise<MySummaryJson> {
      return (await http().get('/api/v1/me/notifications/summary').set(auth).expect(200))
        .body as MySummaryJson;
    },
    async mine(): Promise<MyNotificationJson[]> {
      return (
        (await http().get('/api/v1/me/notifications').set(auth).expect(200)).body as {
          data: MyNotificationJson[];
        }
      ).data;
    },
    async read(ids: { noticeIds?: number[]; notificationIds?: number[] }): Promise<number> {
      return (
        (await http().post('/api/v1/me/notifications/read').set(auth).send(ids).expect(200))
          .body as { unread: number }
      ).unread;
    },
  };
}
