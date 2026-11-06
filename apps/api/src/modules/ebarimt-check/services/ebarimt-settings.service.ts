import { Inject, Injectable } from '@nestjs/common';
import { DB } from '../../../common/db/db.tokens';
import type { Db } from '../../../common/db/db.types';
import { invalid } from '../../../common/errors/app-error';
import { inTransaction } from '../../../common/db/transaction';
import { actorUserId, type AuthContext, AuditService } from '../../identity';
import { ReceiptsService } from '../../inventory';
import { ebarimtCheckAccounts } from '../schema';

export interface EbarimtAccountOption {
  code: string;
  name: string;
  /** The account a receipt that names none books to (the key AP's). */
  isDefault: boolean;
  /** Its receipts count as the month's purchases. */
  counted: boolean;
}

/** Which accounts' receipts count as a month's purchases (owner 2026-11-07, ADR-0168). */
@Injectable()
export class EbarimtSettingsService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly audit: AuditService,
    private readonly receipts: ReceiptsService,
  ) {}

  /**
   * The accounts a receipt may name, each marked whether it counts, and any account chosen earlier
   * that has since left that list (retired): still shown, so it can be taken off.
   */
  async options(): Promise<EbarimtAccountOption[]> {
    const [accounts, chosen] = await Promise.all([
      this.receipts.counterAccounts(),
      this.db.select().from(ebarimtCheckAccounts),
    ]);
    const codes = new Set(chosen.map((row) => row.accountCode));
    const none = codes.size === 0;
    const rows = accounts.map((account) => ({
      code: account.code,
      name: account.name,
      isDefault: account.isDefault,
      counted: none ? account.isDefault : codes.has(account.code),
    }));
    const known = new Set(accounts.map((account) => account.code));
    for (const code of codes) {
      if (!known.has(code)) rows.push({ code, name: '', isDefault: false, counted: true });
    }
    return rows.sort((a, b) => a.code.localeCompare(b.code));
  }

  /** The codes that count, and the code a receipt naming none stands for. */
  async counted(): Promise<{ codes: Set<string>; defaultCode: string | null }> {
    const options = await this.options();
    return {
      codes: new Set(options.filter((option) => option.counted).map((option) => option.code)),
      defaultCode: options.find((option) => option.isDefault)?.code ?? null,
    };
  }

  async save(ctx: AuthContext, accountCodes: readonly string[]): Promise<EbarimtAccountOption[]> {
    const codes = [...new Set(accountCodes)];
    if (codes.length === 0) {
      throw invalid('accountCodes', 'atLeastOne', 'at least one account counts');
    }
    const options = await this.options();
    const known = new Set(options.map((option) => option.code));
    for (const code of codes) {
      if (!known.has(code)) throw invalid('accountCodes', 'exists', `${code} is not on the list`);
    }
    await inTransaction(this.db, async (tx) => {
      const before = await tx.select().from(ebarimtCheckAccounts).for('update');
      await tx.delete(ebarimtCheckAccounts);
      await tx
        .insert(ebarimtCheckAccounts)
        .values(codes.map((accountCode) => ({ accountCode, addedBy: actorUserId(ctx) })));
      await this.audit.record(tx, ctx, {
        action: 'UPDATE',
        entity: 'ebarimt_check_accounts',
        entityId: 0,
        before: { accountCodes: before.map((row) => row.accountCode) },
        after: { accountCodes: codes },
      });
    });
    return this.options();
  }
}
