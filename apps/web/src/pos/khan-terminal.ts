/**
 * Khan Bank's card terminal at the till (ADR-0208). The terminal hangs on the till PC's USB port;
 * Databank's GoConnection service on that PC speaks to it and answers plain HTTP/JSON on the PC's
 * own loopback address. So these calls are made by the till's browser and can never be made by a
 * server: on any other machine `localhost` is not the till.
 *
 * A sale is real money and there is no test mode: nothing here is ever sent twice on its own.
 */

/** GoConnection's address on a till PC as it is installed. */
export const KHAN_TERMINAL_URL = 'http://localhost:27028';
/** A till PC whose service listens elsewhere keeps its address here (this browser only). */
export const KHAN_TERMINAL_URL_KEY = 'bto.kiosk.khan-terminal-url.v1';

/** The status question creates no transaction and must not hang the payment. */
const STATUS_TIMEOUT_MS = 4_000;
/** A lookup answers in about a second; it moves no money, so it may be given up and asked again. */
const LOOKUP_TIMEOUT_MS = 8_000;
/** The terminal's code for «no transaction with this reference». */
const NOT_FOUND_CODE = '38B';

export function khanTerminalUrl(): string {
  try {
    const kept = window.localStorage.getItem(KHAN_TERMINAL_URL_KEY)?.trim();
    if (kept) return kept.replace(/\/+$/, '');
  } catch {
    // A blocked storage: the installed address.
  }
  return KHAN_TERMINAL_URL;
}

/** The terminal as `get-status-info` named it; every field as the service sent it. */
export interface TerminalInfo {
  terminalId: string | null;
  terminalName: string | null;
  port: string | null;
  version: string | null;
}

/** The terminal's service did not say it is ready: not running, not on this PC, or blocked. */
export class TerminalUnavailable extends Error {
  constructor(message = 'the card terminal is not ready') {
    super(message);
    this.name = 'TerminalUnavailable';
  }
}

/**
 * How a request to the terminal ended.
 * - APPROVED: the terminal took the money (a settlement: the batch was closed).
 * - DECLINED: the terminal answered and it is not a success — refused, cancelled, timed out.
 * - FAILED: GoConnection answered with an error of its own (its `Exception`).
 * - UNKNOWN: it was sent and no usable answer came back. The card MAY have been charged; only
 *   the terminal's paper slip tells. Never sent again by itself.
 */
export type TerminalOutcome =
  | { outcome: 'APPROVED'; response: unknown }
  | { outcome: 'DECLINED'; response: unknown; message: string | null }
  | { outcome: 'FAILED'; response: unknown; message: string | null }
  | { outcome: 'UNKNOWN'; response: unknown; message: string | null };

export interface TerminalSale {
  /** `db_ref_no`: the till's own reference of the charge, digits only. */
  refNo: string;
  /** Tögrög as a decimal string; sent as it is, never ×100. */
  amount: string;
  /** `vatps_bill_type`: «1» a citizen's receipt, «3» a company's (as the till it replaces sends). */
  billType: '1' | '3';
}

/**
 * What the terminal knows of the transaction with a reference (`getLastTransaction`: despite its
 * name it answers for the `db_ref_no` given, not for the latest one; no money moves, about a
 * second). Seen on the real terminal 2026-11-17.
 * - APPROVED: it holds an approved transaction (`000`) with that reference; `amount` as it says.
 * - NONE: it holds none (`38B`, «Гүйлгээ олдсонгүй»).
 * - OTHER: it answered something else (another code, or the service's Exception).
 * - UNKNOWN: no usable answer.
 */
export type TerminalLookup =
  | { found: 'APPROVED'; response: unknown; amount: string | null }
  | { found: 'NONE'; response: unknown }
  | { found: 'OTHER'; response: unknown; message: string | null }
  | { found: 'UNKNOWN'; message: string | null };

/** What the payment needs of a terminal; the tests give a fake one. */
export interface CardTerminalClient {
  checkStatus(signal?: AbortSignal): Promise<TerminalInfo>;
  sale(request: TerminalSale): Promise<TerminalOutcome>;
  settlement(refNo: string): Promise<TerminalOutcome>;
  lookup(refNo: string): Promise<TerminalLookup>;
}

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

const text = (value: unknown): string | null =>
  typeof value === 'string' && value.trim() ? value.trim() : null;

/** The amount as the terminal is given it: «12500», never «12500.00». */
function amountText(amount: string): string {
  const [whole = '0', cents = ''] = amount.trim().split('.');
  const rest = cents.replace(/0+$/, '');
  return rest ? `${whole}.${rest}` : whole;
}

export class KhanTerminal implements CardTerminalClient {
  private readonly url: () => string;
  private readonly fetchImpl: FetchLike;

  constructor(options: { url?: string | (() => string); fetch?: FetchLike } = {}) {
    const url = options.url ?? khanTerminalUrl;
    this.url = typeof url === 'string' ? () => url : url;
    this.fetchImpl = options.fetch ?? ((input, init) => globalThis.fetch(input, init));
  }

  /** Whether the terminal is ready. Makes no transaction: asked as often as needed. */
  async checkStatus(signal?: AbortSignal): Promise<TerminalInfo> {
    const timeout = new AbortController();
    const timer = setTimeout(() => timeout.abort(), STATUS_TIMEOUT_MS);
    const abort = () => timeout.abort();
    signal?.addEventListener('abort', abort);
    let body: unknown;
    try {
      const response = await this.fetchImpl(`${this.url()}/ajax/get-status-info`, {
        method: 'GET',
        signal: timeout.signal,
      });
      body = await response.json();
    } catch {
      throw new TerminalUnavailable();
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener('abort', abort);
    }
    if (!isRecord(body) || body.status_code !== 'ok') throw new TerminalUnavailable();
    const ret = isRecord(body.ret) ? body.ret : {};
    return {
      terminalId: text(ret.terminal_id),
      terminalName: text(ret.terminal_name),
      port: text(ret.port_num),
      version: text(ret.goconn_version),
    };
  }

  /**
   * Shows the amount on the terminal and waits for the card and the PIN — as long as it takes,
   * with no timeout of ours. Succeeds only on `status` with `response.response_code === "000"`.
   */
  async sale(request: TerminalSale): Promise<TerminalOutcome> {
    return this.ask(
      'doSaleTransaction',
      {
        db_ref_no: request.refNo,
        amount: amountText(request.amount),
        vatps_bill_type: request.billType,
      },
      (code) => code === '000',
    );
  }

  /** The terminal's settlement with the bank; succeeds on `response.response_code === true`. */
  settlement(refNo: string): Promise<TerminalOutcome> {
    return this.ask('doSettlement', { db_ref_no: refNo }, (code) => code === true);
  }

  /** Asks the terminal about the transaction with this reference. Free: asked as often as needed. */
  async lookup(refNo: string): Promise<TerminalLookup> {
    const timeout = new AbortController();
    const timer = setTimeout(() => timeout.abort(), LOOKUP_TIMEOUT_MS);
    let answer: TerminalOutcome;
    try {
      answer = await this.ask(
        'getLastTransaction',
        { db_ref_no: refNo },
        (code) => code === '000',
        timeout.signal,
      );
    } finally {
      clearTimeout(timer);
    }
    if (answer.outcome === 'UNKNOWN') return { found: 'UNKNOWN', message: answer.message };
    const told = isRecord(answer.response) ? answer.response.response : null;
    const fields = isRecord(told) ? told : {};
    if (answer.outcome === 'APPROVED') {
      // An answer about another reference says nothing of this one.
      if (text(fields.db_ref_no) !== refNo) {
        return { found: 'OTHER', response: answer.response, message: null };
      }
      return { found: 'APPROVED', response: answer.response, amount: text(fields.amount) };
    }
    if (answer.outcome === 'DECLINED' && fields.response_code === NOT_FOUND_CODE) {
      return { found: 'NONE', response: answer.response };
    }
    return { found: 'OTHER', response: answer.response, message: answer.message };
  }

  /** Sends one request, once. Nothing usable back — a broken connection, no JSON — is UNKNOWN. */
  private async ask(
    service: string,
    params: Record<string, string>,
    approved: (code: unknown) => boolean,
    signal?: AbortSignal,
  ): Promise<TerminalOutcome> {
    let body: unknown;
    try {
      const response = await this.fetchImpl(this.url(), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ service_name: service, service_params: params }),
        ...(signal ? { signal } : {}),
      });
      body = await response.json();
    } catch (error) {
      return {
        outcome: 'UNKNOWN',
        response: null,
        message: error instanceof Error ? error.message : null,
      };
    }
    return this.read(body, approved);
  }

  private read(body: unknown, approved: (code: unknown) => boolean): TerminalOutcome {
    const response = isRecord(body) && isRecord(body.response) ? body.response : null;
    if (!isRecord(body) || !response) {
      return { outcome: 'UNKNOWN', response: body ?? null, message: null };
    }
    if (body.status) {
      return approved(response.response_code)
        ? { outcome: 'APPROVED', response: body }
        : { outcome: 'DECLINED', response: body, message: text(response.response_msg) };
    }
    const exception = isRecord(response.Exception) ? response.Exception : null;
    return {
      outcome: 'FAILED',
      response: body,
      message: text(exception?.ErrorMessage) ?? text(response.response_msg),
    };
  }
}
