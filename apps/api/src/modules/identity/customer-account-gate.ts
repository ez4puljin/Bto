import type { Db, Tx } from '../../common/db/db.types';

/**
 * Whether a customer may use the customer app at all (ADR-0079 #2: an inactive or archived
 * customer cannot sign in). identity owns the accounts but not the customers, so partners binds
 * this token; identity finds it through ModuleRef (`strict: false`) and refuses every sign-in while
 * nothing is bound (fail closed).
 */
export interface CustomerAccountGate {
  /** True when the customer exists and is ACTIVE; read with the caller's executor. */
  isActive(executor: Db | Tx, customerId: number): Promise<boolean>;
}

export const CUSTOMER_ACCOUNT_GATE = Symbol('CUSTOMER_ACCOUNT_GATE');
