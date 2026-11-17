/** `fetch` as the WeSend client uses it; tests pass a fake. */
export type SmsFetch = (url: string, init: RequestInit) => Promise<Response>;

/** One text to one number. */
export interface SmsRequest {
  /** Eight local digits, `99112233`. */
  to: string;
  text: string;
  /**
   * The same key for every attempt at one message: WeSend answers a repeated key with the first
   * answer, so a retried job never sends a second SMS (1–255 printable ASCII).
   */
  idempotencyKey: string;
}

/** WeSend's answer to a sent text. */
export interface SmsSent {
  id: string;
  parts: number | null;
  credits: number | null;
  /** Credits left on the account after this text, when WeSend says. */
  balance: number | null;
}

/**
 * A refused or failed exchange. `code` is WeSend's own (`insufficient_credits`, …) or ours
 * (`timeout`, `network_error`, `unexpected_answer`); it never carries the key, the number or the text.
 */
export class SmsError extends Error {
  readonly code: string;
  readonly status: number | null;
  /** Seconds WeSend asked to wait (`Retry-After` of a 429). */
  readonly retryAfter: number | null;

  constructor(code: string, message: string, status: number | null, retryAfter: number | null) {
    super(message);
    this.name = 'SmsError';
    this.code = code;
    this.status = status;
    this.retryAfter = retryAfter;
  }
}
