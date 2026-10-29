import { Injectable } from '@nestjs/common';
import type { PoSupplierStatus } from '@tugeel/shared/procurement';
import { and, eq, sql } from 'drizzle-orm';
import type { Tx } from '../../../common/db/db.types';
import { type Actor, actorUserId, AuditService } from '../../identity';
import type { ReceiptProgress } from '../../inventory';
import { purchaseOrderSuppliers } from '../schema';
import { PurchaseOrdersService } from './purchase-orders.service';

/**
 * Inventory's RECEIPT_PROGRESS (ADR-0115): an order's supplier follows its receipt — «Нягтлан
 * шалгаж» when the keepers' last confirmation posts it, «Орлого авсан» when the accountant's price
 * check costs it. Runs in the receipt's transaction, which holds the receipt's lock (receipt →
 * order, the order `PurchaseOrdersService.move` keeps); a receipt without an order changes nothing.
 */
@Injectable()
export class OrderProgressService implements ReceiptProgress {
  constructor(
    private readonly audit: AuditService,
    private readonly orders: PurchaseOrdersService,
  ) {}

  receiptPostedInTx(tx: Tx, actor: Actor, receiptId: number): Promise<void> {
    return this.advance(tx, actor, receiptId, 'ARRIVED', 'ACCOUNTING');
  }

  receiptCostedInTx(tx: Tx, actor: Actor, receiptId: number): Promise<void> {
    return this.advance(tx, actor, receiptId, 'ACCOUNTING', 'RECEIVED');
  }

  private async advance(
    tx: Tx,
    actor: Actor,
    receiptId: number,
    from: PoSupplierStatus,
    to: PoSupplierStatus,
  ): Promise<void> {
    const moved = await tx
      .update(purchaseOrderSuppliers)
      .set({ status: to, statusChangedAt: sql`now()`, statusChangedBy: actorUserId(actor) })
      .where(
        and(
          eq(purchaseOrderSuppliers.receiptId, receiptId),
          eq(purchaseOrderSuppliers.status, from),
        ),
      )
      .returning();
    for (const row of moved) {
      await this.audit.record(tx, actor, {
        action: 'UPDATE',
        entity: 'purchase_order_suppliers',
        entityId: row.id,
        before: { status: from },
        after: { status: to, receiptId },
      });
      await this.orders.refreshStatus(tx, row.orderId);
    }
  }
}
