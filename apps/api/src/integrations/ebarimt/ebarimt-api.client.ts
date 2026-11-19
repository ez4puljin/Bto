import { createHash } from 'node:crypto';
import { Decimal } from '@tugeel/shared/money';
import { exactAmount, JsonNumber, parseExactJson, textOf } from './ebarimt-json';
import {
  type EbarimtApiAccount,
  EbarimtApiError,
  type EbarimtFetch,
  type EbarimtHosts,
  type EbarimtPurchase,
} from './ebarimt.types';

export const EBARIMT_TOKEN_TIMEOUT_MS = 20_000;
/** A week of a company's purchases; the service has no paging. */
export const EBARIMT_LIST_TIMEOUT_MS = 90_000;
/** A token is dropped this long before the realm says it ends. */
const TOKEN_MARGIN_MS = 30_000;
/** A realm that names no lifetime: five minutes, its usual. */
const DEFAULT_TOKEN_SECONDS = 300;
/** The most of the service's own words kept for the page. */
const DETAIL_MAX = 300;
/** An answer larger than this is not a week of one company's purchases. */
const MAX_ANSWER_BYTES = 50 * 1024 * 1024;
/** The sign-in's client at the tax authority's realm (developer.itc.gov.mn). */
const CLIENT_ID = 'vatps';

interface CachedToken {
  token: string;
  until: number;
}

/** Tokens kept until they end, one per sign-in; shared by the clients of one gateway. */
export class EbarimtTokenCache {
  private readonly tokens = new Map<string, CachedToken>();

  constructor(private readonly now: () => number = Date.now) {}

  get(key: string): string | null {
    const cached = this.tokens.get(key);
    if (!cached) return null;
    if (cached.until <= this.now()) {
      this.tokens.delete(key);
      return null;
    }
    return cached.token;
  }

  put(key: string, token: string, seconds: number): void {
    this.tokens.set(key, { token, until: this.now() + seconds * 1000 - TOKEN_MARGIN_MS });
  }

  drop(key: string): void {
    this.tokens.delete(key);
  }
}

/** One date, `YYYY-MM-DD`. */
const DAY = /^\d{4}-\d{2}-\d{2}$/;

/**
 * e-Barimt's purchases service over plain `fetch` (ADR-0228): a token by the realm's password
 * grant, then `getSaleListERP` for a span of days. Reads only: nothing here can change e-Barimt.
 * Amounts come as JSON numbers with up to six decimals and are read from their text into Decimal.
 */
export class EbarimtApiClient {
  private readonly cacheKey: string;

  constructor(
    private readonly account: EbarimtApiAccount,
    private readonly hosts: EbarimtHosts,
    private readonly fetchFn: EbarimtFetch,
    private readonly tokens: EbarimtTokenCache,
    private readonly timeouts: { token: number; list: number } = {
      token: EBARIMT_TOKEN_TIMEOUT_MS,
      list: EBARIMT_LIST_TIMEOUT_MS,
    },
  ) {
    // The key names the sign-in without holding it.
    this.cacheKey = createHash('sha256')
      .update([hosts.auth, account.username, account.password].join('\u0000'))
      .digest('base64url');
  }

  /** A token for the saved sign-in, from the cache while it lasts. */
  async token(): Promise<string> {
    const cached = this.tokens.get(this.cacheKey);
    if (cached) return cached;
    const form = new URLSearchParams({
      grant_type: 'password',
      client_id: CLIENT_ID,
      username: this.account.username,
      password: this.account.password,
    });
    const response = await this.send(
      `${this.hosts.auth}/protocol/openid-connect/token`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          Accept: 'application/json',
        },
        body: form.toString(),
      },
      this.timeouts.token,
    );
    const body = await this.readJson(response);
    const record = isRecord(body) ? body : {};
    if (response.status === 400 || response.status === 401) {
      throw new EbarimtApiError('SIGN_IN_REFUSED', 'the realm refused the sign-in', {
        status: response.status,
        detail: shorten(textOf(record.error_description) ?? textOf(record.error)),
      });
    }
    if (!response.ok) {
      throw new EbarimtApiError('REFUSED', 'the realm did not answer the sign-in', {
        status: response.status,
        detail: shorten(textOf(record.error_description) ?? textOf(record.error)),
      });
    }
    const token = typeof record.access_token === 'string' ? record.access_token : '';
    if (token === '') {
      throw new EbarimtApiError('BAD_RESPONSE', 'the realm answered without a token', {
        status: response.status,
      });
    }
    const lifetime = exactAmount(record.expires_in);
    const seconds = lifetime && lifetime.isInteger() && lifetime.gt(0) ? lifetime.toNumber() : 0;
    this.tokens.put(this.cacheKey, token, seconds || DEFAULT_TOKEN_SECONDS);
    return token;
  }

  /**
   * The company's purchase receipts dated from `startDate` to `endDate`, both included. The service
   * has no paging, so callers ask for a week at a time. A refused token is asked for again once.
   */
  async purchases(startDate: string, endDate: string): Promise<EbarimtPurchase[]> {
    if (!DAY.test(startDate) || !DAY.test(endDate) || endDate < startDate) {
      throw new RangeError('a span of days is asked as YYYY-MM-DD, from before to');
    }
    let response = await this.listRequest(await this.token(), startDate, endDate);
    if (response.status === 401) {
      this.tokens.drop(this.cacheKey);
      await response.body?.cancel();
      response = await this.listRequest(await this.token(), startDate, endDate);
    }
    const body = await this.readJson(response);
    const record = isRecord(body) ? body : null;
    const detail = shorten(textOf(record?.msg) ?? textOf(record?.message));
    if (!response.ok) {
      throw new EbarimtApiError('REFUSED', 'the service refused the request', {
        status: response.status,
        detail,
      });
    }
    if (!record) {
      throw new EbarimtApiError('BAD_RESPONSE', 'the answer is not JSON', {
        status: response.status,
      });
    }
    // The answer's own status: 200 on success, anything else with its reason in `msg`.
    const status = textOf(record.status);
    if (status !== null && status !== '200') {
      throw new EbarimtApiError('REFUSED', 'the service answered with a refusal', {
        status: response.status,
        detail: detail ?? shorten(textOf(record.code)),
      });
    }
    if (!Array.isArray(record.data)) {
      if (record.data === null || record.data === undefined) return [];
      throw new EbarimtApiError('BAD_RESPONSE', 'the answer holds no list', {
        status: response.status,
      });
    }
    const purchases: EbarimtPurchase[] = [];
    for (const group of record.data) {
      if (!isRecord(group)) throw badLine('a group of the answer is not an object');
      const list = group.receiptBuyModelList;
      if (list === null || list === undefined) continue;
      if (!Array.isArray(list)) throw badLine('a group holds no list of receipts');
      for (const line of list) purchases.push(purchaseOf(line));
    }
    return purchases;
  }

  private listRequest(token: string, startDate: string, endDate: string): Promise<Response> {
    return this.send(
      `${this.hosts.api}/api/tpi/receipt/getSaleListERP`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'X-API-KEY': this.account.apiKey,
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify({ pin: this.account.pin, startDate, endDate, subPin: [] }),
      },
      this.timeouts.list,
    );
  }

  private async send(url: string, init: RequestInit, timeoutMs: number): Promise<Response> {
    try {
      return await this.fetchFn(url, {
        ...init,
        redirect: 'error',
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch {
      // The error may name the address but never what was sent.
      throw new EbarimtApiError('UNREACHABLE', 'e-Barimt did not answer');
    }
  }

  /** The body read as exact JSON; null when it is empty or not JSON. */
  private async readJson(response: Response): Promise<unknown> {
    let text: string;
    try {
      const bytes = await response.arrayBuffer();
      if (bytes.byteLength > MAX_ANSWER_BYTES) {
        throw new EbarimtApiError('BAD_RESPONSE', 'the answer is too large', {
          status: response.status,
        });
      }
      text = new TextDecoder().decode(bytes);
    } catch (error: unknown) {
      if (error instanceof EbarimtApiError) throw error;
      throw new EbarimtApiError('UNREACHABLE', 'the answer broke off', { status: response.status });
    }
    if (text.trim() === '') return null;
    try {
      return parseExactJson(text);
    } catch {
      return null;
    }
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    !(value instanceof JsonNumber)
  );
}

function shorten(text: string | null): string | null {
  if (text === null) return null;
  return text.length > DETAIL_MAX ? `${text.slice(0, DETAIL_MAX - 1)}…` : text;
}

function badLine(message: string): EbarimtApiError {
  return new EbarimtApiError('BAD_RESPONSE', message);
}

function amountOf(line: Record<string, unknown>, key: string, required: boolean) {
  const amount = exactAmount(line[key]);
  if (amount === undefined || (amount === null && required)) {
    throw badLine(`a receipt's ${key} is not an amount`);
  }
  return amount;
}

function purchaseOf(line: unknown): EbarimtPurchase {
  if (!isRecord(line)) throw badLine('a receipt is not an object');
  const total = amountOf(line, 'amountTotal', true);
  if (total === null) throw badLine('a receipt has no total');
  const zero = new Decimal(0);
  return {
    ddtd: textOf(line.prPosRno),
    sellerName: textOf(line.name),
    sellerRegNo: textOf(line.regNo),
    buyerRegNo: textOf(line.buyerRegNo),
    date: textOf(line.date),
    vat: amountOf(line, 'amountVat', false) ?? zero,
    cityTax: amountOf(line, 'amountCitytax', false) ?? zero,
    total,
    net: amountOf(line, 'amountNet', false) ?? zero,
    fromType: textOf(line.fromType),
    receiptType: textOf(line.receiptType),
  };
}
