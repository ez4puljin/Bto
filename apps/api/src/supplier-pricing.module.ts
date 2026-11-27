import { Injectable, Module } from '@nestjs/common';
import type { Db, Tx } from './common/db/db.types';
import { notFound } from './common/errors/app-error';
import type { Actor } from './modules/identity';
import { NotificationsModule, ReceiptPriceNotifier } from './modules/notifications';
import { PosModule, PosTillsService } from './modules/pos';
import {
  PricingModule,
  PRICE_CHANGE_NOTIFIER,
  PRICE_CONTEXT_WAREHOUSE,
  type ReceiptPriceChanges,
} from './modules/pricing';

/** Public module ports meet here; pricing never imports sales/POS/notifications internals. */
@Injectable()
export class SupplierPricingBridge {
  constructor(
    private readonly notifications: ReceiptPriceNotifier,
    private readonly tills: PosTillsService,
  ) {}

  async notifyInTx(tx: Tx, _actor: Actor, facts: ReceiptPriceChanges): Promise<void> {
    await this.notifications.recordInTx(tx, facts);
  }

  async resolve(
    executor: Db | Tx,
    context: { list: string; pipelineId: number | null; tillId: number | null },
  ): Promise<number | null> {
    if (context.list !== 'RETAIL' || context.tillId === null) return null;
    const till = (await this.tills.saleContexts(executor)).find((row) => row.id === context.tillId);
    if (!till) throw notFound('pos till', context.tillId);
    return till.warehouseId;
  }
}

@Module({
  imports: [PricingModule, NotificationsModule, PosModule],
  providers: [
    SupplierPricingBridge,
    { provide: PRICE_CHANGE_NOTIFIER, useExisting: SupplierPricingBridge },
    { provide: PRICE_CONTEXT_WAREHOUSE, useExisting: SupplierPricingBridge },
  ],
  exports: [PRICE_CHANGE_NOTIFIER, PRICE_CONTEXT_WAREHOUSE],
})
export class SupplierPricingModule {}
