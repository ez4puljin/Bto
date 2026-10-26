import { request as httpRequest } from 'node:http';
import { Injectable } from '@nestjs/common';
import {
  DDTD_PATTERN,
  type PosapiReceiptRequest,
  type PosapiResultStatus,
  posapiJson,
} from '@tugeel/shared/mn';
import type { EdgePrintSecrets } from '@tugeel/shared/pos';
import { EdgeConfig } from '../config/edge-env';

/** A connection not made within this long was never made: the call is safe to make again. */
const CONNECT_TIMEOUT_MS = 3_000;
/** PosAPI's answers are small; anything bigger is not PosAPI. */
const MAX_BODY_BYTES = 1_000_000;

/**
 * How a call ended, as far as the edge can know (ADR-0065): ANSWERED with an HTTP status and a
 * body; NOT_SENT when no connection was ever made (refused, unreachable, the connect timed out),
 * so PosAPI cannot have acted on it; INDETERMINATE when the request may have reached PosAPI and
 * no complete answer came back (a timeout after the connection, a reset, a cut-off body).
 */
export type PosapiCall =
  | { kind: 'ANSWERED'; status: number; body: string }
  | { kind: 'NOT_SENT'; error: string }
  | { kind: 'INDETERMINATE'; error: string };

/** A `POST /rest/receipt` turned into what the edge keeps, plus what only the printer may see. */
export type PosapiIssueResult =
  | {
      kind: 'ISSUED';
      ddtd: string;
      /** PosAPI's `date`, verbatim. */
      posapiDate: string;
      /** Never stored or logged: handed to the printable cache and dropped (CLAUDE.md NEVER). */
      secrets: EdgePrintSecrets;
    }
  | { kind: 'REFUSED'; status: PosapiResultStatus | null; message: string }
  | { kind: 'NOT_SENT'; error: string }
  | { kind: 'INDETERMINATE'; error: string };

export type PosapiCancelResult =
  | { kind: 'CANCELLED' }
  | { kind: 'REFUSED'; message: string }
  | { kind: 'NOT_SENT'; error: string }
  | { kind: 'INDETERMINATE'; error: string };

export interface PosapiInfo {
  version: string | null;
  /** The PosAPI's own number, sent back as each receipt's `posNo`. */
  posNo: string | null;
  lastSentDate: string | null;
  leftLotteries: number | null;
  merchants: { tin: string; name: string; vatPayer: boolean }[];
}

/**
 * The store PosAPI 3.0 (architecture §9.1, ADR-0065): a small typed client over `node:http` with
 * a fresh connection per call, so it can tell a call that never left from one that may have been
 * acted on. Response bodies are parsed here and never logged; the lottery and the QR data leave
 * only as the `secrets` of an issued receipt. Never called inside a database transaction.
 */
@Injectable()
export class PosapiClient {
  constructor(private readonly config: EdgeConfig) {}

  async issue(receipt: PosapiReceiptRequest): Promise<PosapiIssueResult> {
    const call = await this.call('POST', '/rest/receipt', posapiJson(receipt));
    if (call.kind !== 'ANSWERED') return call;
    const body = parseObject(call.body);
    if (!body) {
      return { kind: 'INDETERMINATE', error: `PosAPI answered ${call.status} without JSON` };
    }
    const status = textOf(body.status) as PosapiResultStatus | null;
    const ddtd = textOf(body.id);
    const date = textOf(body.date);
    if (call.status >= 200 && call.status < 300 && status === 'SUCCESS' && ddtd && date) {
      if (!DDTD_PATTERN.test(ddtd)) {
        return { kind: 'INDETERMINATE', error: 'PosAPI answered SUCCESS with a malformed id' };
      }
      return {
        kind: 'ISSUED',
        ddtd,
        posapiDate: date,
        secrets: { lottery: textOf(body.lottery), qrData: textOf(body.qrData) },
      };
    }
    if (status === 'ERROR' || status === 'PAYMENT') {
      return { kind: 'REFUSED', status, message: messageOf(body) };
    }
    // A 5xx, or a 2xx/4xx that says neither: the receipt may exist.
    return { kind: 'INDETERMINATE', error: `PosAPI answered ${call.status}: ${messageOf(body)}` };
  }

  /** `DELETE /rest/receipt` with the ДДТД and PosAPI's own date string (a full return). */
  async cancel(ddtd: string, posapiDate: string): Promise<PosapiCancelResult> {
    const call = await this.call(
      'DELETE',
      '/rest/receipt',
      JSON.stringify({ id: ddtd, date: posapiDate }),
    );
    if (call.kind !== 'ANSWERED') return call;
    if (call.status >= 200 && call.status < 300) {
      const body = parseObject(call.body);
      const status = body ? textOf(body.status) : null;
      if (!status || status === 'SUCCESS') return { kind: 'CANCELLED' };
      return { kind: 'REFUSED', message: messageOf(body) };
    }
    if (call.status >= 500) {
      return { kind: 'INDETERMINATE', error: `PosAPI answered ${call.status}` };
    }
    return { kind: 'REFUSED', message: messageOf(parseObject(call.body)) };
  }

  async info(): Promise<PosapiInfo> {
    const call = await this.call('GET', '/rest/info', null);
    if (call.kind !== 'ANSWERED') throw new Error(call.error);
    const body = parseObject(call.body);
    if (call.status !== 200 || !body) throw new Error(`PosAPI /rest/info answered ${call.status}`);
    const merchants = Array.isArray(body.merchants) ? body.merchants : [];
    return {
      version: textOf(body.version),
      posNo: textOf(body.posNo),
      lastSentDate: textOf(body.lastSentDate),
      leftLotteries: typeof body.leftLotteries === 'number' ? body.leftLotteries : null,
      merchants: merchants.flatMap((merchant: unknown) => {
        if (!merchant || typeof merchant !== 'object') return [];
        const row = merchant as Record<string, unknown>;
        const tin = textOf(row.tin);
        return tin ? [{ tin, name: textOf(row.name) ?? '', vatPayer: row.vatPayer === true }] : [];
      }),
    };
  }

  /** `GET /rest/sendData`: PosAPI sends its stored receipts to the tax office now. */
  async sendData(): Promise<void> {
    const call = await this.call('GET', '/rest/sendData', null);
    if (call.kind !== 'ANSWERED') throw new Error(call.error);
    if (call.status < 200 || call.status >= 300) {
      throw new Error(
        `PosAPI /rest/sendData answered ${call.status}: ${messageOf(parseObject(call.body))}`,
      );
    }
  }

  private call(method: string, path: string, payload: string | null): Promise<PosapiCall> {
    const base = this.config.get('POSAPI_URL');
    if (!base) return Promise.resolve({ kind: 'NOT_SENT', error: 'POSAPI_URL is not set' });
    const timeoutMs = this.config.get('POSAPI_TIMEOUT_MS');
    return new Promise<PosapiCall>((resolve) => {
      let connected = false;
      let settled = false;
      const done = (result: PosapiCall) => {
        if (settled) return;
        settled = true;
        clearTimeout(connectTimer);
        resolve(result);
      };
      const req = httpRequest(new URL(path, base), {
        method,
        agent: false,
        timeout: timeoutMs,
        headers: {
          accept: 'application/json',
          ...(payload === null
            ? {}
            : {
                'content-type': 'application/json; charset=utf-8',
                'content-length': Buffer.byteLength(payload),
              }),
        },
      });
      const connectTimer = setTimeout(() => {
        if (!connected) req.destroy(new Error(`no connection within ${CONNECT_TIMEOUT_MS} ms`));
      }, CONNECT_TIMEOUT_MS);
      req.on('socket', (socket) => {
        if (socket.connecting) socket.once('connect', () => (connected = true));
        else connected = true;
      });
      req.on('timeout', () => req.destroy(new Error(`no answer within ${timeoutMs} ms`)));
      req.on('error', (error) => {
        done(
          connected
            ? { kind: 'INDETERMINATE', error: error.message }
            : { kind: 'NOT_SENT', error: error.message },
        );
      });
      req.on('response', (res) => {
        const chunks: Buffer[] = [];
        let size = 0;
        res.on('data', (chunk: Buffer) => {
          size += chunk.length;
          if (size > MAX_BODY_BYTES) res.destroy(new Error('PosAPI answer too large'));
          else chunks.push(chunk);
        });
        res.on('error', (error) => done({ kind: 'INDETERMINATE', error: error.message }));
        res.on('aborted', () => done({ kind: 'INDETERMINATE', error: 'the answer was cut off' }));
        res.on('end', () =>
          done({
            kind: 'ANSWERED',
            status: res.statusCode ?? 0,
            body: Buffer.concat(chunks).toString('utf8'),
          }),
        );
      });
      req.end(payload ?? undefined);
    });
  }
}

function parseObject(text: string): Record<string, unknown> | null {
  try {
    const value: unknown = JSON.parse(text);
    return value && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

function textOf(value: unknown): string | null {
  if (typeof value === 'string') return value.trim() || null;
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return null;
}

/** PosAPI's message for a refusal, cut short; never the whole body (it may hold a lottery). */
function messageOf(body: Record<string, unknown> | null): string {
  const message = body ? (textOf(body.message) ?? textOf(body.error)) : null;
  return (message ?? 'no message').slice(0, 300);
}
