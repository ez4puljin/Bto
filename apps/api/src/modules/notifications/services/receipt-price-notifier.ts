import { Injectable } from '@nestjs/common';
import type { PriceChangeNoticeFacts, PriceChangeSummary } from '@tugeel/shared/notifications';
import { sql } from 'drizzle-orm';
import type { Tx } from '../../../common/db/db.types';
import { PermissionHoldersService } from '../../identity';
import { userPriceNotifications } from '../schema';

/** Internal bell only: the immutable price batch and its receipt commit together (ADR-0246). */
@Injectable()
export class ReceiptPriceNotifier {
  constructor(private readonly holders: PermissionHoldersService) {}

  async recordInTx(tx: Tx, facts: PriceChangeNoticeFacts): Promise<void> {
    if (facts.changes.length === 0 && facts.warnings.length === 0) return;
    const recipients = await this.holders.activeHolders('pricing.prices.manage', {}, tx);
    if (recipients.length === 0) return;
    const ids = [...facts.changes, ...facts.warnings].map((event) => event.eventId);
    const first = ids.reduce((min, id) => (id < min ? id : min), ids[0] ?? 0);
    const key = String(facts.receiptId) + ':' + String(first);
    const payload: PriceChangeSummary = {
      receiptId: facts.receiptId,
      receiptNumber: facts.receiptNumber,
      changeCount: facts.changes.length,
      warningCount: facts.warnings.length,
      overwrittenManualCount: facts.changes.filter((change) => change.overrodeManual).length,
      changes: facts.changes.slice(0, 20),
      warnings: facts.warnings.slice(0, 20),
    };
    // Explicit columns preserve the SQL permission boundary: app cannot supply an ID, timestamp,
    // read marker or mutate a stored event. The default consumes the shared legacy inbox sequence.
    await tx.execute(sql`
      INSERT INTO ${userPriceNotifications} (user_id, price_change_key, payload)
      VALUES ${sql.join(
        recipients.map((userId) => sql`(${userId}, ${key}, ${JSON.stringify(payload)}::jsonb)`),
        sql`, `,
      )}
      ON CONFLICT (price_change_key, user_id) DO NOTHING
    `);
  }
}
