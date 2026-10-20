import { Decimal } from '@tugeel/shared/money';
import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import type { FinTx } from '../db/fin-db';
import { finAllocations, finOpenItems, finPartyBalances, finPartyCompanies } from '../schema';

/**
 * The sub-ledger's shared writes (ADR-0072 #5, #6, #8): the party lock, an allocation lowering two
 * open items, and the party-balance cache. Only `posting/**` calls them, inside a posting.
 */

/** Locks the parties' company rows FOR NO KEY UPDATE in id order: the lock of every balance change. */
export async function lockPartiesInTx(
  tx: FinTx,
  companyId: number,
  partyIds: Iterable<number>,
): Promise<void> {
  const ids = [...new Set(partyIds)].sort((a, b) => a - b);
  if (ids.length === 0) return;
  await tx
    .select({ partyId: finPartyCompanies.partyId })
    .from(finPartyCompanies)
    .where(and(eq(finPartyCompanies.companyId, companyId), inArray(finPartyCompanies.partyId, ids)))
    .orderBy(asc(finPartyCompanies.partyId))
    .for('no key update');
}

export interface AllocationWrite {
  companyId: number;
  partyId: number;
  accountId: number;
  debitItemId: number;
  creditItemId: number;
  amount: Decimal;
  documentId: number;
  reversesAllocationId?: number | null;
  mirror?: boolean;
}

/**
 * Writes an allocation and moves both items' open amounts: down for a pairing, back up for the
 * allocation that undoes one (`reversesAllocationId`). The items are locked by the caller.
 */
export async function writeAllocationInTx(
  tx: FinTx,
  write: AllocationWrite,
): Promise<{ id: number; debitItemId: number; creditItemId: number; amount: Decimal }> {
  const [row] = await tx
    .insert(finAllocations)
    .values({
      companyId: write.companyId,
      partyId: write.partyId,
      accountId: write.accountId,
      debitItemId: write.debitItemId,
      creditItemId: write.creditItemId,
      amount: write.amount,
      documentId: write.documentId,
      reversesAllocationId: write.reversesAllocationId ?? null,
      mirror: write.mirror ?? false,
    })
    .returning({ id: finAllocations.id });
  if (!row) throw new Error('fin allocation was not created');
  const delta = write.reversesAllocationId == null ? write.amount.negated() : write.amount;
  await tx
    .update(finOpenItems)
    .set({ openAmount: sql`${finOpenItems.openAmount} + ${delta.toFixed(2)}::numeric` })
    .where(
      and(
        eq(finOpenItems.companyId, write.companyId),
        inArray(finOpenItems.id, [write.debitItemId, write.creditItemId]),
      ),
    );
  return {
    id: row.id,
    debitItemId: write.debitItemId,
    creditItemId: write.creditItemId,
    amount: write.amount,
  };
}

/** Rewrites the cache rows of these (party, account) pairs from their open items. */
export async function refreshPartyBalancesInTx(
  tx: FinTx,
  companyId: number,
  pairs: Iterable<{ partyId: number; accountId: number }>,
): Promise<void> {
  const seen = new Set<string>();
  for (const pair of pairs) {
    const key = `${pair.partyId}:${pair.accountId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const [sums] = await tx
      .select({
        openDebit: sql<string>`coalesce(sum(${finOpenItems.openAmount}) FILTER (WHERE ${finOpenItems.side} = 'DEBIT'), 0)`,
        openCredit: sql<string>`coalesce(sum(${finOpenItems.openAmount}) FILTER (WHERE ${finOpenItems.side} = 'CREDIT'), 0)`,
        oldest: sql<
          string | null
        >`min(${finOpenItems.dueDate}) FILTER (WHERE ${finOpenItems.side} = 'DEBIT' AND ${finOpenItems.openAmount} > 0)::text`,
      })
      .from(finOpenItems)
      .where(
        and(
          eq(finOpenItems.companyId, companyId),
          eq(finOpenItems.partyId, pair.partyId),
          eq(finOpenItems.accountId, pair.accountId),
        ),
      );
    const values = {
      openDebit: new Decimal(sums?.openDebit ?? 0),
      openCredit: new Decimal(sums?.openCredit ?? 0),
      oldestDueDate: sums?.oldest ?? null,
    };
    await tx
      .insert(finPartyBalances)
      .values({ companyId, partyId: pair.partyId, accountId: pair.accountId, ...values })
      .onConflictDoUpdate({
        target: [finPartyBalances.companyId, finPartyBalances.partyId, finPartyBalances.accountId],
        set: { ...values, updatedAt: sql`now()` },
      });
  }
}
