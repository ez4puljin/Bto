import { randomUUID } from 'node:crypto';
import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { toProblem } from '../../src/common/errors/problem-details';
import { bearer } from './identity';

/** Catalog fixtures through the HTTP API, so tests exercise the same paths as the admin. */

export interface ProductBody {
  sku?: string;
  name: string;
  categoryId: number;
  baseUomId: number;
  [key: string]: unknown;
}

export interface UnitJson {
  id: number;
  uomId: number;
  uomCode: string | null;
  factorToBase: string;
  isBase: boolean;
  isDefaultSales: boolean;
  isDefaultPurchase: boolean;
  supersededBy: number | null;
  supersededAt: string | null;
  barcodes: {
    id: number;
    code: string;
    gtin14: string | null;
    barcodeType: string;
    isPrimary: boolean;
    isInternal: boolean;
  }[];
}

export interface ProductJson {
  id: number;
  sku: string;
  name: string;
  status: string;
  units: UnitJson[];
  [key: string]: unknown;
}

export const idempotency = () => ({ 'Idempotency-Key': randomUUID() });

/** The SQLSTATE-free error code of a failed service call (services throw AppError). */
export async function codeOf(promise: Promise<unknown>): Promise<string | undefined> {
  try {
    await promise;
    return undefined;
  } catch (error) {
    return toProblem(error, {}).code;
  }
}

export function catalogApi(app: NestExpressApplication, token: string) {
  const http = () => request(app.getHttpServer());
  const auth = bearer(token);
  return {
    http,
    async uomId(code: string): Promise<number> {
      const res = await http().get('/api/v1/uoms').set(auth).expect(200);
      const found = (res.body as { data: { id: number; code: string | null }[] }).data.find(
        (uom) => uom.code === code,
      );
      if (!found) throw new Error(`no unit of measure ${code}`);
      return found.id;
    },
    async category(name: string, parentId?: number): Promise<number> {
      const res = await http()
        .post('/api/v1/categories')
        .set(auth)
        .send({ name, ...(parentId ? { parentId } : {}) })
        .expect(201);
      return (res.body as { id: number }).id;
    },
    async product(body: ProductBody): Promise<ProductJson> {
      const res = await http().post('/api/v1/products').set(auth).send(body);
      if (res.status !== 201)
        throw new Error(`product create ${res.status}: ${JSON.stringify(res.body)}`);
      return res.body as ProductJson;
    },
    async get(id: number): Promise<ProductJson> {
      return (await http().get(`/api/v1/products/${id}`).set(auth).expect(200)).body as ProductJson;
    },
  };
}

export function unitOf(product: ProductJson, code: string): UnitJson {
  const unit = product.units.find((row) => row.uomCode === code && row.supersededAt === null);
  if (!unit) throw new Error(`no current ${code} unit on product ${product.id}`);
  return unit;
}
