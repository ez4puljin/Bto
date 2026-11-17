import { SmsError, type SmsFetch, type SmsRequest, type SmsSent } from './sms.types';

export const WESEND_BASE_URL = 'https://api.wesend.mn/v1';
/** A text's whole exchange; past it the message is FAILED `timeout` and never resent blind. */
export const WESEND_SEND_TIMEOUT_MS = 20_000;
export const WESEND_BALANCE_TIMEOUT_MS = 10_000;

const CODE = /^[a-z_]{1,64}$/;
const PRINTABLE_ASCII = /^[\x21-\x7e]{1,255}$/;

type Json = Record<string, unknown>;

const isObject = (value: unknown): value is Json =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
/** An error's name; a DOMException is not always an `Error` across realms. */
const nameOf = (error: unknown): string | null =>
  typeof error === 'object' && error !== null && 'name' in error && typeof error.name === 'string'
    ? error.name
    : null;
const numberOrNull = (value: unknown): number | null =>
  typeof value === 'number' && Number.isFinite(value) ? value : null;

/**
 * WeSend's SMS api (wesend.mn, ADR-0216): `POST /v1/sms` and `GET /v1/balance` with the account's
 * key as a bearer token. No retry here: the sending flow decides what a refusal means.
 */
export class WesendClient {
  constructor(
    private readonly apiKey: string,
    private readonly fetchFn: SmsFetch,
    private readonly baseUrl: string = WESEND_BASE_URL,
  ) {}

  async send(request: SmsRequest): Promise<SmsSent> {
    if (!PRINTABLE_ASCII.test(request.idempotencyKey)) {
      throw new SmsError('invalid_request', 'idempotency key is not printable ASCII', null, null);
    }
    const payload = await this.exchange(
      `${this.baseUrl}/sms`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
          'Idempotency-Key': request.idempotencyKey,
        },
        body: JSON.stringify({ to: request.to, text: request.text }),
      },
      WESEND_SEND_TIMEOUT_MS,
    );
    const id = payload.id;
    if (typeof id !== 'string' && typeof id !== 'number') {
      throw new SmsError('unexpected_answer', 'WeSend answered without a message id', 200, null);
    }
    return {
      id: String(id),
      parts: numberOrNull(payload.parts),
      credits: numberOrNull(payload.credits),
      balance: numberOrNull(payload.balance),
    };
  }

  /** The account's credits (1 credit = 1₮). */
  async balance(): Promise<number> {
    const payload = await this.exchange(
      `${this.baseUrl}/balance`,
      { method: 'GET', headers: { Authorization: `Bearer ${this.apiKey}` } },
      WESEND_BALANCE_TIMEOUT_MS,
    );
    const nested = isObject(payload.data) ? payload.data : {};
    const value =
      numberOrNull(payload.balance) ??
      numberOrNull(payload.credits) ??
      numberOrNull(nested.balance) ??
      numberOrNull(nested.credits);
    if (value === null) {
      throw new SmsError('unexpected_answer', 'WeSend answered without a balance', 200, null);
    }
    return value;
  }

  private async exchange(url: string, init: RequestInit, timeoutMs: number): Promise<Json> {
    let response: Response;
    try {
      response = await this.fetchFn(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
    } catch (error: unknown) {
      const timedOut = nameOf(error) === 'TimeoutError' || nameOf(error) === 'AbortError';
      throw timedOut
        ? new SmsError('timeout', `WeSend did not answer within ${timeoutMs} ms`, null, null)
        : new SmsError('network_error', 'WeSend could not be reached', null, null);
    }
    let payload: unknown;
    try {
      payload = await response.json();
    } catch (error: unknown) {
      const timedOut = nameOf(error) === 'TimeoutError';
      throw timedOut
        ? new SmsError('timeout', 'WeSend timed out while answering', response.status, null)
        : new SmsError('unexpected_answer', 'WeSend answered without JSON', response.status, null);
    }
    if (response.ok && isObject(payload)) return payload;
    const failure = isObject(payload) && isObject(payload.error) ? payload.error : {};
    const code =
      typeof failure.code === 'string' && CODE.test(failure.code)
        ? failure.code
        : response.ok
          ? 'unexpected_answer'
          : 'unknown_error';
    const retryAfter = Number.parseInt(response.headers.get('retry-after') ?? '', 10);
    throw new SmsError(
      code,
      `WeSend refused: ${response.status} ${code}`,
      response.status,
      Number.isFinite(retryAfter) ? retryAfter : null,
    );
  }
}
