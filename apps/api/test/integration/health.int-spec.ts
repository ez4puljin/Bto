import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { createHttpApp } from '../harness/apps';

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
