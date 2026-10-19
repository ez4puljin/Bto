import type { MoneyAccountKind } from '@tugeel/shared/finance';
import type { Tx } from '../../common/db/db.types';

/**
 * What finance tells others (ADR-0079 #8): a customer payment recorded by the accountant, by
 * value, inside the voucher's transaction after the ledger. Notifications binds the token so the
 * store's app shows «Төлбөр бүртгэгдлээ»; PaymentsService resolves it through ModuleRef
 * (`strict: false`) and does without it when nothing is bound. Finance never imports the listener.
 */
export interface PaymentRecordedNotice {
  paymentId: number;
  paymentNumber: string;
  customerId: number;
  /** Two decimals, as finance serialises money. */
  amount: string;
  paidOn: string;
  /** The cash box or the bank account it came into. */
  method: MoneyAccountKind;
  /** The invoices it settled, oldest due first, with the amount each took. */
  invoices: { invoiceId: number; number: string; amount: string }[];
}

export interface PaymentListener {
  /** One statement in the voucher's transaction; an error aborts it (never caught, 25P02). */
  onPaymentRecorded(tx: Tx, notice: PaymentRecordedNotice): Promise<void>;
}

export const PAYMENT_LISTENER = Symbol('PAYMENT_LISTENER');
