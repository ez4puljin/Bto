import type { Decimal } from '@tugeel/shared/money';
import type { CustomerKind } from '@tugeel/shared/taxpayer';
import type { Tx } from '../../common/db/db.types';
import type { Actor, AuthContext } from '../identity';

/** The partner lists a segment narrows (ADR-0049 #4). */
export type PartnerSetEntity = 'CUSTOMER' | 'SUPPLIER';

/**
 * Narrows the customer and supplier lists to a saved segment (ADR-0049 #4). The segments module
 * binds it to its evaluator; partners may not import segments. 404 for an unknown or archived
 * segment, 422 for a segment of another entity; customer segments keep only the customers the
 * caller may read (`CustomersService.visibleTo`).
 */
export interface PartnerSetResolver {
  /** Ascending ids of the customers or suppliers the segment keeps. */
  ids(ctx: AuthContext, entity: PartnerSetEntity, segmentId: number): Promise<number[]>;
}

export const PARTNER_SET_RESOLVER = Symbol('PARTNER_SET_RESOLVER');

/** A customer as its Finance Core party follows it (ADR-0070 #8, ADR-0084). */
export interface CustomerPartyFacts {
  id: number;
  kind: CustomerKind;
  name: string;
  tin: string | null;
  regNo: string | null;
}

/**
 * Called inside the transaction that creates a customer or changes its kind, name, TIN or register
 * number (ADR-0084). fin-bridge binds it to keep the customer's Finance Core party in step, in the
 * api and in the worker (imports); partners may not import fin-bridge.
 */
export interface CustomerChangedHook {
  onCustomerChanged(tx: Tx, actor: Actor, customer: CustomerPartyFacts): Promise<void>;
}

export const CUSTOMER_CHANGED_HOOK = Symbol('CUSTOMER_CHANGED_HOOK');

/** A supplier as its Finance Core party follows it (F3, ADR-0091). */
export interface SupplierPartyFacts {
  id: number;
  name: string;
  tin: string | null;
  regNo: string | null;
}

/**
 * Called inside the transaction that creates a supplier or changes its name, TIN or register number
 * (F3, ADR-0091). fin-bridge binds it to keep the supplier's Finance Core party in step, in the api
 * and in the worker (imports); partners may not import fin-bridge.
 */
export interface SupplierChangedHook {
  onSupplierChanged(tx: Tx, actor: Actor, supplier: SupplierPartyFacts): Promise<void>;
}

export const SUPPLIER_CHANGED_HOOK = Symbol('SUPPLIER_CHANGED_HOOK');

/** A customer's receivable past its due date (ADR-0101): the red reminder, never a block. */
export interface CustomerOverdue {
  /** Open invoices past their due date, MNT. */
  amount: Decimal;
  oldestDueDate: string | null;
}

/**
 * Reads the overdue receivables of customers for the reminders on staff screens and in the apps
 * (ADR-0101 #7). finance binds it over the Finance Core's open items; partners may not import
 * finance. Customers without an overdue amount are left out of the map.
 */
export interface CustomerDebtReader {
  overdueOf(customerIds: readonly number[]): Promise<Map<number, CustomerOverdue>>;
}

export const CUSTOMER_DEBT_READER = Symbol('CUSTOMER_DEBT_READER');
