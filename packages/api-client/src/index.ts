import createClient, { type Client, type Middleware } from 'openapi-fetch';
import type { components, paths } from './generated/schema';

export type { components, operations, paths } from './generated/schema';

export type ApiClient = Client<paths>;
export type ProblemDetails = components['schemas']['ProblemDetails'];
export type HealthResponse = components['schemas']['HealthResponse'];

export interface CreateApiClientOptions {
  /** Origin only (e.g. window.location.origin); paths already contain /api/v1. */
  baseUrl: string;
  /** Returns the current access token, if any; sent as a Bearer token. */
  getToken?: () => string | null | undefined | Promise<string | null | undefined>;
  /** Custom fetch (tests, React Native). */
  fetch?: (input: Request) => Promise<Response>;
  /** UUID source; Hermes has no crypto.randomUUID, so the mobile app passes expo-crypto's. */
  randomUUID?: () => string;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function createApiClient(options: CreateApiClientOptions): ApiClient {
  const uuid = options.randomUUID ?? (() => globalThis.crypto.randomUUID());
  const client = createClient<paths>({
    baseUrl: options.baseUrl.replace(/\/+$/, ''),
    ...(options.fetch ? { fetch: options.fetch } : {}),
  });
  const headers: Middleware = {
    async onRequest({ request }) {
      if (!request.headers.has('x-request-id')) request.headers.set('x-request-id', uuid());
      const token = await options.getToken?.();
      if (token) request.headers.set('authorization', `Bearer ${token}`);
      return request;
    },
  };
  client.use(headers);
  return client;
}

/**
 * Header for document-creating POSTs (ADR-0004). Create the key ONCE per user intent and resend the
 * same key on retries, so the server can replay the stored response instead of posting twice.
 */
export function idempotencyKey(key: string): { 'Idempotency-Key': string } {
  if (!UUID.test(key)) throw new Error('Idempotency-Key must be a UUID');
  return { 'Idempotency-Key': key };
}
