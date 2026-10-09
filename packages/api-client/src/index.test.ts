import { describe, expect, it } from 'vitest';
import { createApiClient, idempotencyKey } from './index';

const healthy = () =>
  new Response(JSON.stringify({ status: 'ok', db: 'up', pgboss: 'up', version: 'test' }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });

describe('createApiClient', () => {
  it('adds x-request-id and the bearer token, and keeps the base URL clean', async () => {
    const seen: Request[] = [];
    const client = createApiClient({
      baseUrl: 'http://tugeel.test/',
      getToken: () => 'token-1',
      randomUUID: () => '00000000-0000-4000-8000-000000000001',
      fetch: (request) => {
        seen.push(request);
        return Promise.resolve(healthy());
      },
    });
    const { data } = await client.GET('/health');
    expect(data?.status).toBe('ok');
    expect(seen[0]?.url).toBe('http://tugeel.test/health');
    expect(seen[0]?.headers.get('x-request-id')).toBe('00000000-0000-4000-8000-000000000001');
    expect(seen[0]?.headers.get('authorization')).toBe('Bearer token-1');
  });

  it('keeps an x-request-id the caller already set', async () => {
    let seen: Request | undefined;
    const client = createApiClient({
      baseUrl: 'http://tugeel.test',
      fetch: (request) => {
        seen = request;
        return Promise.resolve(healthy());
      },
    });
    await client.GET('/health', { headers: { 'x-request-id': 'caller-chosen-id-1' } });
    expect(seen?.headers.get('x-request-id')).toBe('caller-chosen-id-1');
    expect(seen?.headers.has('authorization')).toBe(false);
  });
});

describe('idempotencyKey', () => {
  it('accepts a UUID and rejects anything else', () => {
    expect(idempotencyKey('0198f3a2-7c1d-7e4b-9a2f-3c4d5e6f7a8b')).toEqual({
      'Idempotency-Key': '0198f3a2-7c1d-7e4b-9a2f-3c4d5e6f7a8b',
    });
    expect(() => idempotencyKey('order-1')).toThrow('UUID');
  });
});
