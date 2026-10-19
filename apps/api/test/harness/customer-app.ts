import type { NestExpressApplication } from '@nestjs/platform-express';
import request, { type Response } from 'supertest';
import { idempotency } from './catalog';
import { bearer, testIp } from './identity';
import { partnersApi } from './partners';

/** The customer app «Bto300» through its own routes (ADR-0079), as the phone would call them. */

export const STORE_PASSWORD = 'delguur-nuuts-9';

let phones = 0;
/** A sign-in phone unique within this Jest worker (E.164; the tables are truncated per file). */
export function uniquePhone(): string {
  phones += 1;
  const worker = Number.parseInt(process.env.JEST_WORKER_ID ?? '1', 10) % 10;
  return `+9768${worker}${String(phones).padStart(6, '0')}`;
}

export interface StoreSession {
  accessToken: string;
  refreshToken: string;
  account: { id: number; customerId: number; phone: string; sessionExpiresAt: string };
  response: Response;
}

export interface AppStore {
  customerId: number;
  phone: string;
  password: string;
  session: StoreSession;
  token: string;
  /** The `/customer-app/*` routes as this store. */
  api: ReturnType<typeof storeApi>;
}

/** The office's «Апп» card: link a phone, issue a code, close or reopen the app. */
export function appAccountApi(app: NestExpressApplication, staffToken: string) {
  const http = () => request(app.getHttpServer());
  const auth = bearer(staffToken);
  return {
    get: (customerId: number) =>
      http().get(`/api/v1/customers/${customerId}/app-account`).set(auth),
    link: (customerId: number, phone: string) =>
      http().put(`/api/v1/customers/${customerId}/app-account`).set(auth).send({ phone }),
    code: (customerId: number) =>
      http().post(`/api/v1/customers/${customerId}/app-account/code`).set(auth),
    disable: (customerId: number) =>
      http().post(`/api/v1/customers/${customerId}/app-account/disable`).set(auth),
    enable: (customerId: number) =>
      http().post(`/api/v1/customers/${customerId}/app-account/enable`).set(auth),
    async issueCode(customerId: number): Promise<string> {
      const response = await this.code(customerId).expect(200);
      return (response.body as { code: string }).code;
    },
  };
}

/** `/auth/customer/*` without an Origin header, as a phone sends it. */
export function storeAuth(app: NestExpressApplication) {
  const http = () => request(app.getHttpServer());
  return {
    login: (phone: string, password: string, ip = testIp()) =>
      http()
        .post('/api/v1/auth/customer/login')
        .set('X-Forwarded-For', ip)
        .send({ phone, password }),
    setup: (phone: string, code: string, newPassword: string, ip = testIp()) =>
      http()
        .post('/api/v1/auth/customer/password/setup')
        .set('X-Forwarded-For', ip)
        .send({ phone, code, newPassword }),
    refresh: (refreshToken: string) =>
      http().post('/api/v1/auth/customer/refresh').send({ refreshToken }),
    logout: (refreshToken: string) =>
      http().post('/api/v1/auth/customer/logout').send({ refreshToken }),
  };
}

export function sessionOf(response: Response): StoreSession {
  const body = response.body as Omit<StoreSession, 'response'>;
  return { ...body, response };
}

/** The `/customer-app/*` routes with a customer token. */
export function storeApi(app: NestExpressApplication, token: string) {
  const http = () => request(app.getHttpServer());
  const auth = bearer(token);
  return {
    http,
    auth,
    get: (path: string) => http().get(`/api/v1/customer-app${path}`).set(auth),
    post: (path: string, body: object = {}) =>
      http().post(`/api/v1/customer-app${path}`).set(auth).send(body),
    put: (path: string) => http().put(`/api/v1/customer-app${path}`).set(auth),
    delete: (path: string) => http().delete(`/api/v1/customer-app${path}`).set(auth),
    /** «Захиалга илгээх» with a fresh Idempotency-Key unless one is given. */
    send: (body: object, key: Record<string, string> = idempotency()) =>
      http().post('/api/v1/customer-app/orders').set(auth).set(key).send(body),
  };
}

/**
 * A store that uses the app: a new active customer (with an address), its phone linked by the
 * office, the code redeemed with STORE_PASSWORD, signed in.
 */
export async function appStore(
  app: NestExpressApplication,
  officeToken: string,
  fields: Record<string, unknown> = {},
): Promise<AppStore> {
  const customer = await partnersApi(app, officeToken).customer({
    name: `Дэлгүүр ${uniquePhone().slice(-4)}`,
    address: { address: 'Мөрөн, 3-р баг' },
    ...fields,
  });
  const phone = uniquePhone();
  const accounts = appAccountApi(app, officeToken);
  await accounts.link(customer.id, phone).expect(200);
  const code = await accounts.issueCode(customer.id);
  const response = await storeAuth(app).setup(phone, code, STORE_PASSWORD).expect(200);
  const session = sessionOf(response);
  return {
    customerId: customer.id,
    phone,
    password: STORE_PASSWORD,
    session,
    token: session.accessToken,
    api: storeApi(app, session.accessToken),
  };
}

/** A customer order body the checkout sends: pickup today, cash. */
export function storeOrderBody(
  today: string,
  lines: { productUnitId: number; qty: string }[],
  fields: Record<string, unknown> = {},
) {
  return { fulfilment: 'PICKUP', deliveryDate: today, paymentMethod: 'CASH', lines, ...fields };
}
