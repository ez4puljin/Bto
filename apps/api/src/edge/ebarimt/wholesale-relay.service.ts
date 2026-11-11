import { Inject, Injectable, Logger, type OnApplicationBootstrap } from '@nestjs/common';
import {
  buildRelayReceipt,
  EbarimtBuildError,
  type PosapiReceiptRequest,
  type RelayOperation,
  type RelayOutcome,
  type RelayResultWire,
} from '@tugeel/shared/mn';
import type { EdgePrintSecrets } from '@tugeel/shared/pos';
import { and, asc, eq, isNull } from 'drizzle-orm';
import { EdgeConfig } from '../config/edge-env';
import { EDGE_DB, type EdgeDb } from '../db/edge-db';
import { edgeRelayOps } from '../db/schema';
import { CentralClient, CentralError } from '../services/central.client';
import { SnapshotStore } from '../services/snapshot.store';
import { EbarimtService } from './ebarimt.service';
import { PosapiClient } from './posapi.client';

type RelayRow = typeof edgeRelayOps.$inferSelect;

/** What one step did: nothing was due, an operation was handled, or the centre was away. */
export type RelayStep = 'idle' | 'worked' | 'failed';

/** What PosAPI answered, as the row keeps it (never the lottery or the QR data). */
interface Settled {
  outcome: RelayOutcome;
  errorCode?: 'POSAPI_REFUSED' | 'EDGE_BUILD' | null;
  ddtd?: string | null;
  posapiDate?: string | null;
  merchantTin?: string | null;
  merchantName?: string | null;
  message?: string | null;
}

/** Reports wait at most this long in memory with their secrets; after it the print is a copy. */
const SECRETS_TTL_MS = 30 * 60_000;

/**
 * The store's half of the wholesale e-Barimt relay (ADR-0185): the centre cannot reach the store
 * PosAPI, so this edge asks it for one receipt operation at a time, issues or cancels it at the
 * store PosAPI and reports the outcome until the centre acknowledges.
 *
 * Exactly once, never a blind retry (ADR-0017): an operation is stored (CLAIMED) before PosAPI is
 * called and marked CALLING for the call; one found CALLING at boot may have reached PosAPI and is
 * reported INDETERMINATE; a row is never called a second time. PosAPI away before the request left
 * is NOT_SENT (the centre offers the receipt again later, as a new attempt). The lottery and the
 * QR data stay in this process's memory until the report that carries them is acknowledged, and
 * are never stored or logged. Off unless `EBARIMT_WHOLESALE_RELAY` is on with the PosAPI provider.
 */
@Injectable()
export class WholesaleRelayService implements OnApplicationBootstrap {
  private readonly logger = new Logger(WholesaleRelayService.name);
  private readonly secrets = new Map<number, { secrets: EdgePrintSecrets; expiresAt: number }>();
  private running: Promise<RelayStep> | null = null;

  constructor(
    @Inject(EDGE_DB) private readonly db: EdgeDb,
    private readonly config: EdgeConfig,
    private readonly central: CentralClient,
    private readonly posapi: PosapiClient,
    private readonly ebarimt: EbarimtService,
    private readonly store: SnapshotStore,
  ) {}

  get enabled(): boolean {
    return this.config.get('EBARIMT_WHOLESALE_RELAY') && this.ebarimt.enabled;
  }

  /** A call cut short by a restart may have reached PosAPI: a person looks it up. */
  async onApplicationBootstrap(): Promise<void> {
    if (!this.enabled) return;
    await this.closeInterrupted('the edge restarted during the call');
  }

  /**
   * Operations left CALLING: PosAPI was called and the outcome never stored (a restart, or the
   * edge's database failing right after the call). The receipt may exist: INDETERMINATE.
   */
  private async closeInterrupted(message: string): Promise<void> {
    await this.db
      .update(edgeRelayOps)
      .set({ status: 'DONE', outcome: 'INDETERMINATE', message, settledAt: new Date() })
      .where(eq(edgeRelayOps.status, 'CALLING'));
  }

  /** The loop's step, one run at a time: report what is settled, then handle one operation. */
  runOnce(): Promise<RelayStep> {
    if (!this.enabled) return Promise.resolve('idle');
    if (!this.running) {
      this.running = this.step().finally(() => {
        this.running = null;
      });
    }
    return this.running;
  }

  private async step(): Promise<RelayStep> {
    try {
      // One step runs at a time, so a row still CALLING here lost its outcome in an earlier step.
      await this.closeInterrupted('the outcome of the call was not stored');
      const reported = await this.reportSettled();
      // Stored and never called (the edge stopped between the two): safe to call now.
      const [stored] = await this.db
        .select()
        .from(edgeRelayOps)
        .where(eq(edgeRelayOps.status, 'CLAIMED'))
        .orderBy(asc(edgeRelayOps.id))
        .limit(1);
      const row = stored ?? (await this.claim());
      if (!row) return reported > 0 ? 'worked' : 'idle';
      if (row.status === 'CLAIMED') await this.process(row);
      await this.reportSettled();
      return 'worked';
    } catch (error) {
      if (error instanceof CentralError) return 'failed';
      throw error;
    }
  }

  /** Asks the centre for an operation and stores it before anything else happens to it. */
  private async claim(): Promise<RelayRow | null> {
    const { operation } = await this.central.ebarimtClaim();
    if (!operation) return null;
    await this.db
      .insert(edgeRelayOps)
      .values({
        receiptId: operation.receiptId,
        attempt: operation.attempt,
        op: operation.op,
        docNumber: operation.docNumber,
        request: operation,
      })
      .onConflictDoNothing({
        target: [edgeRelayOps.receiptId, edgeRelayOps.op, edgeRelayOps.attempt],
      });
    // Handed again by the centre (its answer or ours was lost): the stored row decides.
    const [row] = await this.db
      .select()
      .from(edgeRelayOps)
      .where(
        and(
          eq(edgeRelayOps.receiptId, operation.receiptId),
          eq(edgeRelayOps.op, operation.op),
          eq(edgeRelayOps.attempt, operation.attempt),
        ),
      );
    if (!row) throw new Error('edge_relay_ops insert left no row');
    // Settled and acknowledged before, yet the centre still waits: say it again.
    if (row.status === 'DONE' && row.reportedAt !== null) {
      await this.db
        .update(edgeRelayOps)
        .set({ reportedAt: null })
        .where(eq(edgeRelayOps.id, row.id));
    }
    return row;
  }

  private async process(row: RelayRow): Promise<void> {
    const operation: RelayOperation = row.request;
    if (operation.op === 'CANCEL') {
      if (!(await this.markCalling(row.id))) return;
      const result = await this.posapi.cancel(operation.ddtd, operation.posapiDate);
      switch (result.kind) {
        case 'CANCELLED':
          return this.settle(row.id, { outcome: 'CANCELLED' });
        case 'REFUSED':
          return this.settle(row.id, {
            outcome: 'REFUSED',
            errorCode: 'POSAPI_REFUSED',
            message: result.message,
          });
        case 'NOT_SENT':
          return this.settle(row.id, { outcome: 'NOT_SENT', message: result.error });
        case 'INDETERMINATE':
          return this.settle(row.id, { outcome: 'INDETERMINATE', message: result.error });
      }
    }
    const merchant = await this.ebarimt.merchantFacts();
    if (!merchant) {
      // PosAPI could not be asked who it issues for: nothing was sent.
      return this.settle(row.id, {
        outcome: 'NOT_SENT',
        message: 'PosAPI did not name its merchant (GET /rest/info)',
      });
    }
    const settings = this.store.peek()?.snapshot.settings;
    let request: PosapiReceiptRequest;
    try {
      request = buildRelayReceipt(operation, {
        merchantTin: merchant.tin,
        districtCode: settings?.ebarimtDistrictCode ?? '',
        branchNo: this.config.get('EBARIMT_BRANCH_NO') ?? null,
        posNo: merchant.posNo,
        defaultClassificationCode: settings?.ebarimtClassificationCode ?? null,
      });
    } catch (error) {
      if (!(error instanceof EbarimtBuildError)) throw error;
      return this.settle(row.id, {
        outcome: 'REFUSED',
        errorCode: 'EDGE_BUILD',
        message: `${error.code}: ${error.message}`,
      });
    }
    if (!(await this.markCalling(row.id))) return;
    const result = await this.posapi.issue(request);
    switch (result.kind) {
      case 'ISSUED':
        this.secrets.set(row.id, {
          secrets: result.secrets,
          expiresAt: Date.now() + SECRETS_TTL_MS,
        });
        return this.settle(row.id, {
          outcome: 'ISSUED',
          ddtd: result.ddtd,
          posapiDate: result.posapiDate,
          merchantTin: merchant.tin,
          merchantName: merchant.name,
        });
      case 'REFUSED':
        return this.settle(row.id, {
          outcome: 'REFUSED',
          errorCode: 'POSAPI_REFUSED',
          message: result.message,
        });
      case 'NOT_SENT':
        return this.settle(row.id, { outcome: 'NOT_SENT', message: result.error });
      case 'INDETERMINATE':
        this.logger.warn(
          { receiptId: row.receiptId, attempt: row.attempt },
          'a wholesale receipt went unanswered; the accountant checks it',
        );
        return this.settle(row.id, { outcome: 'INDETERMINATE', message: result.error });
    }
  }

  /** The claim of the call itself: only a stored, never-called row may reach PosAPI. */
  private async markCalling(id: number): Promise<boolean> {
    const [claimed] = await this.db
      .update(edgeRelayOps)
      .set({ status: 'CALLING', calledAt: new Date() })
      .where(and(eq(edgeRelayOps.id, id), eq(edgeRelayOps.status, 'CLAIMED')))
      .returning({ id: edgeRelayOps.id });
    return claimed !== undefined;
  }

  private async settle(id: number, settled: Settled): Promise<void> {
    await this.db
      .update(edgeRelayOps)
      .set({
        status: 'DONE',
        outcome: settled.outcome,
        errorCode: settled.errorCode ?? null,
        ddtd: settled.ddtd ?? null,
        posapiDate: settled.posapiDate ?? null,
        merchantTin: settled.merchantTin ?? null,
        merchantName: settled.merchantName ?? null,
        message: settled.message?.slice(0, 300) ?? null,
        settledAt: new Date(),
      })
      .where(eq(edgeRelayOps.id, id));
  }

  /** Tells the centre every settled operation it has not acknowledged, oldest first. */
  private async reportSettled(): Promise<number> {
    const rows = await this.db
      .select()
      .from(edgeRelayOps)
      .where(and(eq(edgeRelayOps.status, 'DONE'), isNull(edgeRelayOps.reportedAt)))
      .orderBy(asc(edgeRelayOps.id))
      .limit(20);
    for (const row of rows) {
      if (!row.outcome) continue;
      const held = this.secrets.get(row.id);
      const secrets = held && held.expiresAt > Date.now() ? held.secrets : null;
      const wire: RelayResultWire = {
        receiptId: row.receiptId,
        attempt: row.attempt,
        op: row.op,
        outcome: row.outcome,
        ddtd: row.ddtd,
        posapiDate: row.posapiDate,
        merchantTin: row.merchantTin,
        merchantName: row.merchantName,
        errorCode: row.errorCode,
        message: row.message,
        lottery: secrets?.lottery ?? null,
        qrData: secrets?.qrData ?? null,
      };
      await this.central.ebarimtResult(wire);
      this.secrets.delete(row.id);
      await this.db
        .update(edgeRelayOps)
        .set({ reportedAt: new Date() })
        .where(eq(edgeRelayOps.id, row.id));
    }
    return rows.length;
  }
}
