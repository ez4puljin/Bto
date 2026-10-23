import { Inject, Injectable } from '@nestjs/common';
import { Decimal } from '@tugeel/shared/money';
import {
  type EdgeCartLine,
  type EdgeCashier,
  type EdgeVoidRequest,
  type EdgeVoidResponse,
  lineMoney,
  type SnapshotCashier,
  type VoidDocWire,
  type VoidReason,
} from '@tugeel/shared/pos';
import { eq } from 'drizzle-orm';
import { EDGE_DB, type EdgeDb, type EdgeTx, inEdgeTransaction } from '../db/edge-db';
import { edgeVoids } from '../db/schema';
import { CheckoutService } from './checkout.service';
import { KioskAuthService } from './kiosk-auth.service';
import { OutboxService } from './outbox.service';
import { EdgeShiftsService } from './shifts.service';

/**
 * Goods taken off a cart before payment (ADR-0104): the kiosk asks for a supervisor's PIN when a
 * line is removed, a quantity lowered or a cart cancelled, and the edge logs it with its value at
 * today's prices and replays it to the centre (VOID) for the owner's «Хасалт» list.
 */
@Injectable()
export class EdgeVoidsService {
  constructor(
    @Inject(EDGE_DB) private readonly db: EdgeDb,
    private readonly auth: KioskAuthService,
    private readonly checkout: CheckoutService,
    private readonly shifts: EdgeShiftsService,
    private readonly outbox: OutboxService,
  ) {}

  async record(
    tillCode: string,
    cashier: EdgeCashier,
    request: EdgeVoidRequest,
  ): Promise<EdgeVoidResponse> {
    const [existing] = await this.db
      .select({ doc: edgeVoids.doc })
      .from(edgeVoids)
      .where(eq(edgeVoids.clientId, request.clientId));
    if (existing) return { clientId: request.clientId, approvedByName: null };
    const approver = await this.auth.approve(request.approval);
    await inEdgeTransaction(this.db, (tx) =>
      this.write(tx, tillCode, cashier, approver, request.clientId, request.reason, request.lines),
    );
    return { clientId: request.clientId, approvedByName: approver?.fullName ?? null };
  }

  /** The void's rows and its outbox entry, inside the caller's transaction. */
  async write(
    tx: EdgeTx,
    tillCode: string,
    cashier: EdgeCashier,
    approver: SnapshotCashier | null,
    clientId: string,
    reason: VoidReason,
    lines: readonly EdgeCartLine[],
  ): Promise<void> {
    const quoted = this.checkout.quote(lines);
    const docLines = quoted.lines.map((line) => {
      const unitPrice = new Decimal(line.unitPrice ?? '0');
      return {
        productId: line.productId,
        productUnitId: line.productUnitId,
        qty: new Decimal(line.qty).toFixed(3),
        unitPrice: unitPrice.toFixed(2),
        total: lineMoney(line.qty, unitPrice).total.toFixed(2),
      };
    });
    const total = docLines.reduce((sum, line) => sum.plus(line.total), new Decimal(0));
    const shift = await this.shifts.current(tillCode, tx);
    const voidedAt = new Date();
    const doc: VoidDocWire = {
      clientId,
      tillCode,
      shiftClientId: shift?.clientId ?? null,
      cashierUserId: cashier.userId,
      approvedByUserId: approver?.userId ?? null,
      voidedAt: voidedAt.toISOString(),
      reason,
      lines: docLines,
      total: total.toFixed(2),
    };
    await tx
      .insert(edgeVoids)
      .values({
        clientId,
        tillCode,
        cashierUserId: cashier.userId,
        approvedByUserId: approver?.userId ?? null,
        reason,
        voidedAt,
        total,
        doc,
      })
      .onConflictDoNothing({ target: edgeVoids.clientId });
    await this.outbox.enqueue(tx, { kind: 'VOID', clientId, voided: doc });
  }
}
