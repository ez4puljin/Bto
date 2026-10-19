import type { NestExpressApplication } from '@nestjs/platform-express';
import { businessDate } from '@tugeel/shared/time';
import type { Client } from 'pg';
import request from 'supertest';
import { buildOpenApiDocument } from '../../src/openapi/openapi';
import { connectAs, createHttpApp } from '../harness/apps';
import { type AppStore, appStore, storeOrderBody } from '../harness/customer-app';
import { financeApi, salesFlow } from '../harness/finance';
import { bearer, login, seedUser } from '../harness/identity';

type Method = 'get' | 'post' | 'put' | 'patch' | 'delete';
const METHODS: readonly Method[] = ['get', 'post', 'put', 'patch', 'delete'];

/** Routes outside the OpenAPI document, each public by design (signed file URLs). */
const HIDDEN_PUBLIC_ROUTES = ['PUT /api/v1/files/local/:name', 'GET /api/v1/files/public/:name'];

interface Operation {
  method: Method;
  path: string;
  schemes: string[];
}

/** Every operation of the in-process OpenAPI document with its security schemes. */
function operationsOf(app: NestExpressApplication): Operation[] {
  const document = buildOpenApiDocument(app);
  return Object.entries(document.paths).flatMap(([path, item]) =>
    METHODS.flatMap((method) => {
      const operation = (item as Record<string, { security?: Record<string, string[]>[] }>)[method];
      if (!operation) return [];
      return [
        {
          method,
          path,
          schemes: (operation.security ?? []).flatMap((entry) => Object.keys(entry)),
        },
      ];
    }),
  );
}

/** The routes Express actually serves, as `METHOD /path/:param`. */
function servedRoutes(app: NestExpressApplication): string[] {
  const instance = app.getHttpAdapter().getInstance() as {
    router: { stack: { route?: { path: string; methods: Record<string, boolean> } }[] };
  };
  return instance.router.stack.flatMap((layer) =>
    layer.route
      ? Object.keys(layer.route.methods).map(
          (method) => `${method.toUpperCase()} ${layer.route?.path ?? ''}`,
        )
      : [],
  );
}

/** `/api/v1/customers/{id}` with every parameter filled in. */
const concrete = (path: string) =>
  path.replace(/\{([^}]+)\}/g, (_whole, name: string) => (/id$/i.test(name) ? '1' : 'x'));

/**
 * The customer app's isolation (ADR-0079 #3, ADR-0082), against the whole route table: a customer
 * token is refused by every staff operation before anything runs, a staff token by every customer
 * operation, and a store never reads another store's order or invoice.
 */
describe('customer app isolation', () => {
  let app: NestExpressApplication;
  let sql: Client;
  let admin: string;
  let store: AppStore;
  let other: AppStore;
  let otherOrderId: number;
  let otherInvoiceId: number;

  beforeAll(async () => {
    app = await createHttpApp();
    await app.listen(0, '127.0.0.1');
    sql = await connectAs('app');
    admin = (await login(app, await seedUser(app, { roles: ['ADMIN'] }))).accessToken;
    const office = (await login(app, await seedUser(app, { roles: ['OFFICE'] }))).accessToken;
    const flow = await salesFlow(app, admin, 'CAI');
    await request(app.getHttpServer())
      .put('/api/v1/sales-settings/channels')
      .set(bearer(admin))
      .send({
        channel: 'CUSTOMER_APP',
        pipelineId: flow.pipeline.id,
        stageId: flow.stage('Захиалга').id,
      })
      .expect(200);
    const product = await flow.product('9401', 'Тусгаарлалт', '1000', '20');
    store = await appStore(app, office);
    other = await appStore(app, office);
    const order = (
      await other.api
        .send(storeOrderBody(businessDate(), [{ productUnitId: flow.pcs(product), qty: '2' }]))
        .expect(201)
    ).body as { id: number };
    otherOrderId = order.id;
    await flow.sell(order.id);
    const invoice = await financeApi(app, admin).invoiceOfOrder(order.id);
    otherInvoiceId = invoice?.id ?? 0;
  });
  afterAll(async () => {
    await sql.end();
    await app.close();
  });

  it('documents every route but the two public file URLs', () => {
    const documented = new Set(
      operationsOf(app).map(
        (operation) =>
          `${operation.method.toUpperCase()} ${operation.path.replace(/\{([^}]+)\}/g, ':$1')}`,
      ),
    );
    // The catch-all under the prefix answers 404 for unknown paths (every method); nothing else
    // may be served without being documented.
    const undocumented = servedRoutes(app).filter(
      (route) => !documented.has(route) && !route.endsWith(' /api/v1{/*splat}'),
    );
    expect(undocumented.sort()).toEqual([...HIDDEN_PUBLIC_ROUTES].sort());
  });

  it('refuses a customer token on every staff operation, before anything runs', async () => {
    const counts = async () =>
      (
        await sql.query<{ audit: string; keys: string }>(
          'SELECT (SELECT count(*) FROM audit_log) AS audit, (SELECT count(*) FROM idempotency_keys) AS keys',
        )
      ).rows[0];
    const before = await counts();
    const operations = operationsOf(app);
    const staff = operations.filter((operation) => operation.schemes.includes('bearer'));
    const edge = operations.filter((operation) => operation.schemes.includes('edge-token'));
    expect(staff.length).toBeGreaterThan(300);
    const answers = new Map<string, { status: number; reason: unknown }>();
    for (const operation of [...staff, ...edge]) {
      const response = await request(app.getHttpServer())
        [operation.method](concrete(operation.path))
        .set(bearer(store.token));
      answers.set(`${operation.method.toUpperCase()} ${operation.path}`, {
        status: response.status,
        reason: (response.body as { params?: { reason?: unknown } }).params?.reason,
      });
    }
    const wrong = [...answers].filter(([key, answer]) => {
      const isEdge = edge.some(
        (operation) => `${operation.method.toUpperCase()} ${operation.path}` === key,
      );
      return isEdge
        ? answer.status !== 401
        : answer.status !== 403 || answer.reason !== 'CUSTOMER_TOKEN';
    });
    expect(wrong).toEqual([]);
    expect(await counts()).toEqual(before);
  });

  it('refuses a staff token on every customer operation', async () => {
    const customer = operationsOf(app).filter((operation) =>
      operation.schemes.includes('customer'),
    );
    expect(customer.length).toBeGreaterThan(20);
    const wrong: string[] = [];
    for (const operation of customer) {
      const response = await request(app.getHttpServer())
        [operation.method](concrete(operation.path))
        .set(bearer(admin));
      const reason = (response.body as { params?: { reason?: unknown } }).params?.reason;
      if (response.status !== 403 || reason !== 'STAFF_TOKEN') {
        wrong.push(`${operation.method} ${operation.path} ${response.status}`);
      }
    }
    expect(wrong).toEqual([]);
  });

  it('never lets a store read another store’s order or invoice', async () => {
    await store.api.get(`/orders/${otherOrderId}`).expect(404);
    await store.api.get(`/orders/${otherOrderId}/reorder`).expect(404);
    await store.api.get(`/invoices/${otherInvoiceId}`).expect(404);
    const orders = (await store.api.get('/orders').expect(200)).body as { data: { id: number }[] };
    expect(orders.data.map((row) => row.id)).not.toContain(otherOrderId);
    const invoices = (await store.api.get('/invoices').expect(200)).body as { id: number }[];
    expect(invoices.map((row) => row.id)).not.toContain(otherInvoiceId);
    expect((await store.api.get('/payments').expect(200)).body).toMatchObject({ total: 0 });
    const notifications = (await store.api.get('/notifications').expect(200)).body as {
      data: { orderId: number | null }[];
    };
    expect(notifications.data.some((row) => row.orderId === otherOrderId)).toBe(false);
    // The other store reads its own.
    await other.api.get(`/orders/${otherOrderId}`).expect(200);
    await other.api.get(`/invoices/${otherInvoiceId}`).expect(200);
  });
});
