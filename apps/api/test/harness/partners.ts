import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { idempotency } from './catalog';
import { bearer } from './identity';

/** Partners fixtures through the HTTP API, so tests exercise the same paths as the admin. */

export interface AddressJson {
  id: number;
  label: string | null;
  address: string | null;
  lat: string | null;
  lng: string | null;
  gpsSource: string | null;
  isDefault: boolean;
  archivedAt: string | null;
}

export interface CustomerJson {
  id: number;
  code: string;
  kind: string;
  name: string;
  tin: string | null;
  tinSource: string | null;
  phone: string | null;
  regNo: string | null;
  creditLimit: string | null;
  creditHold: boolean;
  tinPending: boolean;
  settlementGroup: string;
  addresses: AddressJson[];
  contacts: { id: number; name: string | null; phone: string | null }[];
  [key: string]: unknown;
}

export interface SupplierJson {
  id: number;
  code: string;
  name: string;
  [key: string]: unknown;
}

export function partnersApi(app: NestExpressApplication, token: string) {
  const http = () => request(app.getHttpServer());
  const auth = bearer(token);
  return {
    http,
    auth,
    async customer(body: Record<string, unknown>): Promise<CustomerJson> {
      const res = await http()
        .post('/api/v1/customers')
        .set(auth)
        .set(idempotency())
        .send({ kind: 'COMPANY', settlementGroup: 'DAY_20', ...body });
      if (res.status !== 201) {
        throw new Error(`customer create ${res.status}: ${JSON.stringify(res.body)}`);
      }
      return res.body as CustomerJson;
    },
    async getCustomer(id: number): Promise<CustomerJson> {
      return (await http().get(`/api/v1/customers/${id}`).set(auth).expect(200))
        .body as CustomerJson;
    },
    async supplier(body: Record<string, unknown>): Promise<SupplierJson> {
      const res = await http().post('/api/v1/suppliers').set(auth).set(idempotency()).send(body);
      if (res.status !== 201) {
        throw new Error(`supplier create ${res.status}: ${JSON.stringify(res.body)}`);
      }
      return res.body as SupplierJson;
    },
  };
}
