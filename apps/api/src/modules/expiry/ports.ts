import type { Decimal } from '@tugeel/shared/money';
import type { Db, Tx } from '../../common/db/db.types';
import type { Actor } from '../identity';
import type { ExpiryChannel } from '@tugeel/shared/expiry';
export type { ExpirySaleOffer, ExpirySaleInput, ExpiryReturnInput } from '@tugeel/shared/expiry';

/** Implemented by POS/sales adapters. Expiry never imports their tables or Nest modules. */
export const EXPIRY_SALE_CONTEXTS = Symbol('EXPIRY_SALE_CONTEXTS');
export interface ExpirySaleContext {
  warehouseId: number;
  channel: ExpiryChannel;
  contextId: number;
  name: string;
}
export interface ExpirySaleContexts {
  list(executor: Db | Tx, productId?: number): Promise<ExpirySaleContext[]>;
  quote(
    executor: Db | Tx,
    productId: number,
    context: ExpirySaleContext,
    unitPriceOverride?: Decimal,
  ): Promise<{ unitPrice: string | null; netUnitPrice: string | null }>;
}
/** Synchronous liability sink, bound by the application composition root. */
export const EXPIRY_PAYROLL_SOURCE = Symbol('EXPIRY_PAYROLL_SOURCE');
export interface ExpiryPayrollSourceInput {
  sourceKind: 'EXPIRY_SALE' | 'EXPIRY_RETURN';
  sourceKey: string;
  sourceReference: string;
  requestedMonth: string | null;
  reversesSourceKey?: string;
  allocations: readonly { userId: number; amount: string }[];
}
export interface ExpiryPayrollSource {
  lockInTx(tx: Tx): Promise<void>;
  recordInTx(tx: Tx, actor: Actor, input: ExpiryPayrollSourceInput): Promise<void>;
}
