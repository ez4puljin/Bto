import { Injectable } from '@nestjs/common';
import type {
  CreditCheckRequestWire,
  CreditCheckResponseWire,
  CustomerFeedResponseWire,
  HeartbeatWire,
  SnapshotResponseWire,
  SyncEventWire,
  SyncResponseWire,
  VoucherFeedResponseWire,
  LoyaltyFeedResponseWire,
} from '@tugeel/shared/pos';
import { EdgeConfig } from '../config/edge-env';

/** A call to the centre that failed: no answer (offline), or an answer that is not a success. */
export class CentralError extends Error {
  constructor(
    message: string,
    readonly status: number | null,
    readonly code: string | null,
  ) {
    super(message);
    this.name = 'CentralError';
  }
}

const TIMEOUT_MS = 30_000;

/**
 * The edge's only door to the centre (ADR-0063 #4): the snapshot, the ordered documents and the
 * heartbeat, each with the node's token. Never called inside an edge transaction.
 */
@Injectable()
export class CentralClient {
  private readonly base: string;
  private readonly token: string;
  private readonly creditTimeoutMs: number;

  constructor(config: EdgeConfig) {
    this.base = `${config.get('CENTRAL_API_URL').replace(/\/+$/, '')}/api/v1/pos/sync`;
    this.token = config.get('EDGE_NODE_TOKEN');
    this.creditTimeoutMs = config.get('EDGE_CREDIT_CHECK_TIMEOUT_MS');
  }

  /** ADR-0109: the customers a till may charge, or only the version when `since` names it. */
  customers(since: string | null): Promise<CustomerFeedResponseWire> {
    const query = since ? `?since=${encodeURIComponent(since)}` : '';
    return this.call<CustomerFeedResponseWire>('GET', `/customers${query}`);
  }

  /** ADR-0110: the codes a till may take, or only the version when `since` names it. */
  vouchers(since: string | null): Promise<VoucherFeedResponseWire> {
    const query = since ? `?since=${encodeURIComponent(since)}` : '';
    return this.call<VoucherFeedResponseWire>('GET', `/vouchers${query}`);
  }

  /** ADR-0112: the bonus card's members and tiers, or only the version when `since` names it. */
  loyalty(since: string | null): Promise<LoyaltyFeedResponseWire> {
    const query = since ? `?since=${encodeURIComponent(since)}` : '';
    return this.call<LoyaltyFeedResponseWire>('GET', `/loyalty${query}`);
  }

  /** The centre's credit check before a credit sale; a short wait, the till decides otherwise. */
  creditCheck(request: CreditCheckRequestWire): Promise<CreditCheckResponseWire> {
    return this.call<CreditCheckResponseWire>(
      'POST',
      '/credit-check',
      request,
      this.creditTimeoutMs,
    );
  }

  snapshot(since: string | null): Promise<SnapshotResponseWire> {
    const query = since ? `?since=${encodeURIComponent(since)}` : '';
    return this.call<SnapshotResponseWire>('GET', `/snapshot${query}`);
  }

  push(events: readonly SyncEventWire[]): Promise<SyncResponseWire> {
    return this.call<SyncResponseWire>('POST', '/events', { events });
  }

  async heartbeat(beat: HeartbeatWire): Promise<void> {
    await this.call<unknown>('POST', '/heartbeat', beat);
  }

  private async call<T>(
    method: 'GET' | 'POST',
    path: string,
    body?: unknown,
    timeoutMs: number = TIMEOUT_MS,
  ): Promise<T> {
    let response: Response;
    try {
      response = await fetch(`${this.base}${path}`, {
        method,
        headers: {
          authorization: `Bearer ${this.token}`,
          accept: 'application/json',
          ...(body === undefined ? {} : { 'content-type': 'application/json' }),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (error: unknown) {
      const reason = error instanceof Error ? error.message : String(error);
      throw new CentralError(`centre unreachable: ${reason}`, null, null);
    }
    if (!response.ok) {
      const problem = (await response.json().catch(() => null)) as { code?: string } | null;
      throw new CentralError(
        `centre answered ${response.status}${problem?.code ? ` ${problem.code}` : ''}`,
        response.status,
        problem?.code ?? null,
      );
    }
    return (await response.json()) as T;
  }
}
