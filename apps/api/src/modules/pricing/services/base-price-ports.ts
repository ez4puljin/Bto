import type { Decimal } from '@tugeel/shared/money';
import type { LocationPriceSettings, PriceList } from '@tugeel/shared/pricing';
import type { Db, Tx } from '../../../common/db/db.types';
import type { Actor } from '../../identity';

export const BASE_PRICE_OBSERVER = Symbol('BASE_PRICE_OBSERVER');
export interface BasePriceObserver {
  lockInTx(tx: Tx): Promise<void>;
  manualInTx(
    tx: Tx,
    actor: Actor,
    productId: number,
    before: Decimal | null,
    after: Decimal | null,
    validFrom?: string,
  ): Promise<void>;
  locationSettings(
    warehouseId: number,
    executor?: Db | Tx,
    date?: string,
  ): Promise<LocationPriceSettings | null>;
}

export const PRICE_CONTEXT_WAREHOUSE = Symbol('PRICE_CONTEXT_WAREHOUSE');
export interface PriceContextWarehouse {
  resolve(
    executor: Db | Tx,
    input: { list: PriceList; pipelineId: number | null; tillId: number | null },
  ): Promise<number | null>;
}

export const PRICE_CHANGE_NOTIFIER = Symbol('PRICE_CHANGE_NOTIFIER');
export interface ReceiptPriceChanges {
  receiptId: number;
  receiptNumber: string;
  changes: readonly {
    eventId: number;
    productId: number;
    sku: string;
    name: string;
    oldBasePrice: string | null;
    newBasePrice: string;
    overrodeManual: boolean;
  }[];
  warnings: readonly {
    eventId: number;
    productId: number;
    sku: string;
    name: string;
    reason: 'PRINTED_PRICE_MISSING' | 'PRINTED_PRICE_CONFLICT' | 'PRICE_OUT_OF_RANGE';
  }[];
}
export interface PriceChangeNotifier {
  notifyInTx(tx: Tx, actor: Actor, facts: ReceiptPriceChanges): Promise<void>;
}
