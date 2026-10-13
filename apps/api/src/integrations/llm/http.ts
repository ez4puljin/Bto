import type { z } from 'zod';
import { type FetchFn, LlmError } from './llm.types';

const PROVIDER_CODE = /^[A-Za-z0-9_.-]{1,64}$/;

/**
 * POSTs JSON and returns the parsed answer, or throws an `LlmError`. The timeout covers the whole
 * exchange, body included. No retry: the person asks again (ADR-0045).
 */
export async function postJson<T>(
  fetchFn: FetchFn,
  url: string,
  headers: Record<string, string>,
  body: unknown,
  timeoutMs: number,
  answer: z.ZodType<T>,
): Promise<T> {
  let response: Response;
  try {
    response = await fetchFn(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...headers },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (error: unknown) {
    throw transportError(error, timeoutMs);
  }
  let payload: unknown;
  try {
    payload = await response.json();
  } catch (error: unknown) {
    if (isAbort(error)) throw transportError(error, timeoutMs);
    payload = undefined; // not JSON
  }
  if (!response.ok) {
    throw new LlmError('HTTP', `the provider answered HTTP ${response.status}`, {
      status: response.status,
      providerCode: providerCodeOf(payload),
    });
  }
  const parsed = answer.safeParse(payload);
  if (!parsed.success) {
    throw new LlmError('INVALID_RESPONSE', 'the provider answered in an unexpected shape');
  }
  return parsed.data;
}

/** By name: the abort reason is a DOMException, which may come from another realm than `Error`. */
function isAbort(error: unknown): boolean {
  const name =
    typeof error === 'object' && error !== null ? (error as { name?: unknown }).name : '';
  return name === 'TimeoutError' || name === 'AbortError';
}

function transportError(error: unknown, timeoutMs: number): LlmError {
  if (isAbort(error)) return new LlmError('TIMEOUT', `no answer within ${timeoutMs} ms`);
  return new LlmError('NETWORK', 'the provider could not be reached');
}

/** OpenAI `{ error: { code, type } }`, Anthropic `{ error: { type } }`; anything else is dropped. */
function providerCodeOf(payload: unknown): string | undefined {
  if (typeof payload !== 'object' || payload === null) return undefined;
  const error = (payload as { error?: unknown }).error;
  if (typeof error !== 'object' || error === null) return undefined;
  const { code, type } = error as { code?: unknown; type?: unknown };
  const candidate = typeof code === 'string' ? code : typeof type === 'string' ? type : undefined;
  return candidate !== undefined && PROVIDER_CODE.test(candidate) ? candidate : undefined;
}

/** Joins a base URL and an endpoint name, whatever slashes the configuration carries. */
export function endpoint(baseUrl: string, name: string): string {
  return `${baseUrl.replace(/\/+$/, '')}/${name}`;
}
