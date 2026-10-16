import type { NestExpressApplication } from '@nestjs/platform-express';
import { addDays, businessDate } from '@tugeel/shared/time';
import request from 'supertest';
import { idempotency } from './catalog';
import { bearer } from './identity';

/** The sales-rep app's routes (ADR-0061 #5) through HTTP, as the phone calls them. */

export interface RepContextJson {
  today: string;
  boards: {
    id: number;
    name: string;
    pipelines: {
      id: number;
      name: string;
      stages: { id: number; name: string; action: string }[];
    }[];
  }[];
  defaultStageId: number | null;
}

export interface RepOrderJson {
  id: number;
  number: string | null;
  status: string;
  customerId: number;
  customerName: string;
  fulfilment: string;
  deliveryDate: string;
  addressText: string | null;
  paymentMethod: string;
  subtotal: string | null;
  total: string | null;
  pipelineName: string | null;
  stageName: string | null;
  lines: {
    productId: number;
    productUnitId: number;
    qty: string;
    qtyBase: string;
    qtyApproved: string;
    qtyBackordered: string;
    total: string | null;
    parts: { uomName: string; basis: string; qty: string; unitPrice: string; total: string }[];
  }[];
  events: { fromStatus: string | null; toStatus: string }[];
}

export interface RepOrderPageJson {
  data: {
    id: number;
    number: string | null;
    status: string;
    customerName: string;
    total: string | null;
    lineCount: number;
    stageName: string | null;
  }[];
  nextCursor: string | null;
  summary: { count: number; total: string; drafts: number } | null;
}

export interface RepProductJson {
  id: number;
  sku: string;
  sellable: boolean;
  available: string;
  units: {
    id: number;
    uomName: string;
    factorToBase: string;
    isBase: boolean;
    wholesale: string | null;
    basis: string | null;
  }[];
}

/** A rep's order: a pickup for tomorrow paid in cash on the stage, unless the fields say otherwise. */
export function repOrderBody(
  stageId: number,
  customerId: number,
  lines: { productUnitId: number; qty: string }[],
  fields: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    stageId,
    customerId,
    fulfilment: 'PICKUP',
    deliveryDate: addDays(businessDate(), 1),
    paymentMethod: 'CASH',
    lines,
    ...fields,
  };
}

export function repApi(app: NestExpressApplication, token: string) {
  const http = () => request(app.getHttpServer());
  const auth = bearer(token);
  return {
    http,
    async context(): Promise<RepContextJson> {
      return (await http().get('/api/v1/sales-rep/context').set(auth).expect(200))
        .body as RepContextJson;
    },
    create: (body: Record<string, unknown>, key = idempotency()) =>
      http().post('/api/v1/sales-rep/orders').set(auth).set(key).send(body),
    async order(body: Record<string, unknown>): Promise<RepOrderJson> {
      const res = await http()
        .post('/api/v1/sales-rep/orders')
        .set(auth)
        .set(idempotency())
        .send(body);
      if (res.status !== 201)
        throw new Error(`rep order ${res.status}: ${JSON.stringify(res.body)}`);
      return res.body as RepOrderJson;
    },
    async list(query: Record<string, unknown>): Promise<RepOrderPageJson> {
      return (await http().get('/api/v1/sales-rep/orders').query(query).set(auth).expect(200))
        .body as RepOrderPageJson;
    },
    get: (id: number) => http().get(`/api/v1/sales-rep/orders/${id}`).set(auth),
    async products(query: Record<string, unknown> = {}): Promise<RepProductJson[]> {
      return (
        (await http().get('/api/v1/sales-rep/products').query(query).set(auth).expect(200))
          .body as { data: RepProductJson[] }
      ).data;
    },
  };
}
