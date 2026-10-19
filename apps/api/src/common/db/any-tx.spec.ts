import type { FinTx } from '../../finance-core';
import type { AnyTx } from './any-tx';
import type { Tx } from './db.types';

// Compile-time proofs (typecheck and ts-jest fail otherwise): Bto's transaction is an AnyTx, so the
// core's in-transaction calls (`submitInTx(tx: FinTx, …)`, ADR-0069 #7) accept it.
const asAnyTx = (tx: Tx): AnyTx => tx;
const asFinTx = (tx: Tx): FinTx => tx;

describe('AnyTx', () => {
  it("accepts Bto's Tx and is the core's FinTx", () => {
    expect([asAnyTx, asFinTx].every((check) => typeof check === 'function')).toBe(true);
  });
});
