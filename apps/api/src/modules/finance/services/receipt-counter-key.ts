import { businessDate } from '@tugeel/shared/time';
import type { Tx } from '../../../common/db/db.types';
import type { FinCallContext, FinChartService } from '../../../finance-core';

/**
 * The accounts a receipt may credit (ADR-0154): the chart's «310 Дансны өглөг» (3101…; 310201 is the
 * goods-received clearing a receipt's own stock entry uses) and «Тооллогын зөрүү».
 */
export const isReceiptCounterCode = (code: string): boolean =>
  code.startsWith('3101') || code === '313011';

/** The posting key of a receipt's counter account. */
export const receiptCounterKey = (code: string): string => `AP_${code}`;

/** Before any document: a receipt may be dated earlier than the day its account was added. */
const RULE_FROM = '2000-01-01';

/**
 * Gives the accounts that came into the chart (by hand or from Erkhet's list) the key a receipt
 * credits them by, as the staff member adding them: a warehouse user could not write a rule.
 */
export async function ensureReceiptCounterKeysInTx(
  tx: Tx,
  chart: FinChartService,
  ctx: FinCallContext,
  company: string,
  accounts: readonly { id: number; code: string; status?: string }[],
): Promise<void> {
  const wanted = accounts.filter(
    (account) => isReceiptCounterCode(account.code) && account.status !== 'INACTIVE',
  );
  if (wanted.length === 0) return;
  const rules = await chart.rules(ctx, { company, on: businessDate() }, tx);
  for (const account of wanted) {
    const key = receiptCounterKey(account.code);
    if (rules.get(key)?.accountId === account.id) continue;
    await chart.defineKeyInTx(tx, ctx, { company, code: key });
    await chart.setRuleInTx(tx, ctx, {
      company,
      key,
      accountId: account.id,
      effectiveFrom: RULE_FROM,
    });
  }
}
