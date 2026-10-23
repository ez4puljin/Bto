import { Inject, Injectable } from '@nestjs/common';
import { Decimal } from '@tugeel/shared/money';
import {
  type EdgeApproval,
  type EdgeCartLine,
  type EdgeCashier,
  type EdgeParkedBasket,
  type EdgeParkRequest,
  POS_LIMITS,
} from '@tugeel/shared/pos';
import { and, asc, count, eq } from 'drizzle-orm';
import { AppError } from '../../common/errors/app-error';
import { EDGE_DB, type EdgeDb, inEdgeTransaction } from '../db/edge-db';
import { edgeParked } from '../db/schema';
import { CheckoutService } from './checkout.service';
import { KioskAuthService } from './kiosk-auth.service';
import { EdgeVoidsService } from './voids.service';

type ParkedRow = typeof edgeParked.$inferSelect;

const PREVIEW_NAMES = 3;

/**
 * Carts set aside (ADR-0104): a customer who went back for something waits on the till that
 * parked the cart, which resumes it later at that moment's prices. Only that till sees its
 * baskets; cancelling one is a void approved by a supervisor.
 */
@Injectable()
export class EdgeParkedService {
  constructor(
    @Inject(EDGE_DB) private readonly db: EdgeDb,
    private readonly checkout: CheckoutService,
    private readonly auth: KioskAuthService,
    private readonly voids: EdgeVoidsService,
  ) {}

  async list(tillCode: string): Promise<EdgeParkedBasket[]> {
    const rows = await this.db
      .select()
      .from(edgeParked)
      .where(eq(edgeParked.tillCode, tillCode))
      .orderBy(asc(edgeParked.parkedAt));
    return rows.map(basketOf);
  }

  async park(
    tillCode: string,
    cashier: EdgeCashier,
    request: EdgeParkRequest,
  ): Promise<EdgeParkedBasket> {
    const quoted = this.checkout.quote(request.lines);
    return inEdgeTransaction(this.db, async (tx) => {
      const [existing] = await tx
        .select()
        .from(edgeParked)
        .where(eq(edgeParked.clientId, request.clientId));
      if (existing) return basketOf(existing);
      // The till's baskets, locked so two parks at once cannot pass the limit together.
      await tx
        .select({ clientId: edgeParked.clientId })
        .from(edgeParked)
        .where(eq(edgeParked.tillCode, tillCode))
        .for('update');
      const [held] = await tx
        .select({ count: count() })
        .from(edgeParked)
        .where(eq(edgeParked.tillCode, tillCode));
      if ((held?.count ?? 0) >= POS_LIMITS.maxParked) {
        throw new AppError('POS_PARKED_LIMIT', `till ${tillCode} holds too many baskets`, {
          max: POS_LIMITS.maxParked,
        });
      }
      const [row] = await tx
        .insert(edgeParked)
        .values({
          clientId: request.clientId,
          tillCode,
          cashierUserId: cashier.userId,
          cashierName: cashier.fullName,
          lines: request.lines.map((line) => ({
            productUnitId: line.productUnitId,
            qty: line.qty,
          })),
          itemCount: request.lines.length,
          total: new Decimal(quoted.total),
          preview: quoted.lines
            .slice(0, PREVIEW_NAMES)
            .map((line) => line.name)
            .join(', '),
        })
        .returning();
      if (!row) throw new Error('no parked row');
      return basketOf(row);
    });
  }

  /** The basket's lines back to its till's cart; the basket is gone. */
  async resume(tillCode: string, clientId: string): Promise<EdgeCartLine[]> {
    const [row] = await this.db
      .delete(edgeParked)
      .where(and(eq(edgeParked.clientId, clientId), eq(edgeParked.tillCode, tillCode)))
      .returning();
    if (!row) throw new AppError('NOT_FOUND', `parked basket ${clientId} not found`, { clientId });
    return row.lines;
  }

  /** A basket the customer never came back for: a CART_CANCELLED void with the approver. */
  async discard(
    tillCode: string,
    cashier: EdgeCashier,
    clientId: string,
    approval: EdgeApproval | null,
  ): Promise<void> {
    const approver = await this.auth.approve(approval);
    await inEdgeTransaction(this.db, async (tx) => {
      const [row] = await tx
        .delete(edgeParked)
        .where(and(eq(edgeParked.clientId, clientId), eq(edgeParked.tillCode, tillCode)))
        .returning();
      if (!row)
        throw new AppError('NOT_FOUND', `parked basket ${clientId} not found`, { clientId });
      await this.voids.write(
        tx,
        tillCode,
        cashier,
        approver,
        clientId,
        'CART_CANCELLED',
        row.lines,
      );
    });
  }
}

function basketOf(row: ParkedRow): EdgeParkedBasket {
  return {
    clientId: row.clientId,
    tillCode: row.tillCode,
    cashierName: row.cashierName,
    parkedAt: row.parkedAt.toISOString(),
    lines: row.lines,
    itemCount: row.itemCount,
    total: row.total.toFixed(2),
    preview: row.preview,
  };
}
