import type { NestExpressApplication } from '@nestjs/platform-express';
import { addDays, businessDate } from '@tugeel/shared/time';
import request from 'supertest';
import { idempotency } from './catalog';
import { bearer } from './identity';

/** Customer orders (ADR-0055) through HTTP, as the office enters them. */

export interface OrderLineJson {
  id: number;
  productId: number;
  productUnitId: number;
  unitName: string;
  qty: string;
  qtyBase: string;
  warehouseId: number;
  qtyApproved: string;
  qtyBackordered: string;
  total: string | null;
  parts: {
    uomName: string;
    basis: string;
    qty: string;
    listPrice: string;
    unitPrice: string;
    total: string;
  }[];
}

export interface OrderJson {
  id: number;
  number: string | null;
  status: string;
  customerId: number;
  fulfilment: string;
  deliveryDate: string;
  addressId: number | null;
  addressText: string | null;
  contactName: string | null;
  contactPhone: string | null;
  paymentMethod: string;
  priceDate: string | null;
  subtotal: string | null;
  discountTotal: string | null;
  total: string | null;
  cancelReason: string | null;
  lines: OrderLineJson[];
  events: { fromStatus: string | null; toStatus: string; reason: string | null }[];
}

/** A pickup order for tomorrow paid in cash, unless the fields say otherwise. */
export function orderBody(
  customerId: number,
  lines: { productUnitId: number; qty: string }[],
  fields: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    customerId,
    fulfilment: 'PICKUP',
    deliveryDate: addDays(businessDate(), 1),
    paymentMethod: 'CASH',
    lines,
    ...fields,
  };
}

export function salesApi(app: NestExpressApplication, token: string) {
  const http = () => request(app.getHttpServer());
  const auth = bearer(token);
  return {
    http,
    create: (body: Record<string, unknown>) =>
      http().post('/api/v1/sales-orders').set(auth).set(idempotency()).send(body),
    update: (id: number, body: Record<string, unknown>) =>
      http().put(`/api/v1/sales-orders/${id}`).set(auth).send(body),
    submit: (id: number, key = idempotency()) =>
      http().post(`/api/v1/sales-orders/${id}/submit`).set(auth).set(key).send({}),
    cancel: (id: number, reason: string) =>
      http()
        .post(`/api/v1/sales-orders/${id}/cancel`)
        .set(auth)
        .set(idempotency())
        .send({ reason }),
    async get(id: number): Promise<OrderJson> {
      return (await http().get(`/api/v1/sales-orders/${id}`).set(auth).expect(200))
        .body as OrderJson;
    },
    /** Creates a draft and returns it. */
    async draft(body: Record<string, unknown>): Promise<OrderJson> {
      const res = await http().post('/api/v1/sales-orders').set(auth).set(idempotency()).send(body);
      if (res.status !== 201)
        throw new Error(`order create ${res.status}: ${JSON.stringify(res.body)}`);
      return res.body as OrderJson;
    },
  };
}
