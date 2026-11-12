import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { createHttpApp } from '../harness/apps';
import { bearer, login, seedUser } from '../harness/identity';

describe('GET /health', () => {
  let app: NestExpressApplication;

  beforeAll(async () => {
    app = await createHttpApp();
  });
  afterAll(async () => {
    await app.close();
  });

  it('reports every component up with a request id', async () => {
    const response = await request(app.getHttpServer()).get('/health').expect(200);
    expect(response.body).toEqual({ status: 'ok', db: 'up', pgboss: 'up', version: 'test' });
    expect(response.headers['cache-control']).toBe('no-store');
    expect(response.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('echoes a well-formed incoming x-request-id', async () => {
    const response = await request(app.getHttpServer())
      .get('/health')
      .set('x-request-id', 'caller-request-0001')
      .expect(200);
    expect(response.headers['x-request-id']).toBe('caller-request-0001');
  });

  it('sends a browser that opens /health to the status page, and nobody else', async () => {
    const browser = await request(app.getHttpServer())
      .get('/health')
      .set('Accept', 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8')
      .expect(302);
    expect(browser.headers.location).toBe('/system/status');
    // Probes, curl and fetch accept anything; the web page asks for JSON.
    for (const accept of ['*/*', 'application/json']) {
      const probe = await request(app.getHttpServer())
        .get('/health')
        .set('Accept', accept)
        .expect(200);
      expect(probe.body).toMatchObject({ status: 'ok' });
    }
  });

  it('shows the server panel to an admin only', async () => {
    const http = () => request(app.getHttpServer());
    await http().get('/api/v1/system/server').expect(401);
    const worker = await login(app, await seedUser(app, { roles: ['WAREHOUSE'] }));
    await http().get('/api/v1/system/server').set(bearer(worker.accessToken)).expect(403);

    const admin = await login(app, await seedUser(app, { roles: ['ADMIN'] }));
    const { body, headers } = await http()
      .get('/api/v1/system/server')
      .set(bearer(admin.accessToken))
      .expect(200);
    expect(headers['cache-control']).toBe('no-store');
    expect(body.host.cpuThreads).toBeGreaterThan(0);
    expect(body.cpu.percent).toBeGreaterThanOrEqual(0);
    expect(body.cpu.percent).toBeLessThanOrEqual(100);
    expect(body.memory.totalBytes).toBeGreaterThan(body.memory.usedBytes);
    expect(body.memory.percent).toBeGreaterThan(0);
    expect(body.disk.totalBytes).toBeGreaterThan(0);
    expect(body.database.sizeBytes).toBeGreaterThan(0);
    expect(body.database.connections).toBeGreaterThan(0);
    expect(body.process.rssBytes).toBeGreaterThan(0);
    expect(Array.isArray(body.history)).toBe(true);

    // Only the points after `since` come back: a moment in the future has none.
    const later = await http()
      .get(`/api/v1/system/server?since=${Date.now() + 60_000}`)
      .set(bearer(admin.accessToken))
      .expect(200);
    expect(later.body.history).toEqual([]);
  });

  it('is not served under /api/v1, and unknown routes are problem+json', async () => {
    const response = await request(app.getHttpServer()).get('/api/v1/health').expect(404);
    expect(response.headers['content-type']).toMatch(/^application\/problem\+json/);
    expect(response.body).toMatchObject({
      type: 'https://tugeel.local/errors/NOT_FOUND',
      status: 404,
      code: 'NOT_FOUND',
      instance: '/api/v1/health',
    });
    expect(response.body.requestId).toBe(response.headers['x-request-id']);
  });

  it('answers malformed JSON with 400 BAD_REQUEST problem+json', async () => {
    const response = await request(app.getHttpServer())
      .post('/api/v1/anything')
      .set('content-type', 'application/json')
      .send('{"broken":')
      .expect(400);
    expect(response.body).toMatchObject({ status: 400, code: 'BAD_REQUEST' });
  });
});
