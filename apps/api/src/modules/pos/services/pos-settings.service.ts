import { Inject, Injectable } from '@nestjs/common';
import { POS_LIMITS } from '@tugeel/shared/pos';
import { sql } from 'drizzle-orm';
import { DB } from '../../../common/db/db.tokens';
import type { Db, Tx } from '../../../common/db/db.types';
import { inTransaction } from '../../../common/db/transaction';
import { AppError, invalid } from '../../../common/errors/app-error';
import { MoneyAccountsService } from '../../finance';
import { AuditService, type AuthContext, OrgService } from '../../identity';
import { posSettings } from '../schema';

export interface PosSettings {
  storeWarehouseId: number | null;
  storeWarehouseName: string | null;
  handoverMoneyAccountId: number | null;
  handoverMoneyAccountName: string | null;
  returnWindowDays: number;
  snapshotIntervalSec: number;
  supervisorRequired: boolean;
  receiptTitle: string | null;
  receiptFooter: string | null;
  ebarimtDistrictCode: string | null;
  ebarimtClassificationCode: string | null;
  updatedAt: Date | null;
}

export interface PosSettingsPatch {
  storeWarehouseId?: number | null;
  handoverMoneyAccountId?: number | null;
  returnWindowDays?: number;
  snapshotIntervalSec?: number;
  supervisorRequired?: boolean;
  receiptTitle?: string | null;
  receiptFooter?: string | null;
  ebarimtDistrictCode?: string | null;
  ebarimtClassificationCode?: string | null;
}

const DEFAULTS = {
  storeWarehouseId: null,
  handoverMoneyAccountId: null,
  returnWindowDays: POS_LIMITS.defaultReturnWindowDays,
  snapshotIntervalSec: POS_LIMITS.defaultSnapshotIntervalSec,
  supervisorRequired: true,
  receiptTitle: null,
  receiptFooter: null,
  ebarimtDistrictCode: null,
  ebarimtClassificationCode: null,
} as const;

/** The store's settings (ADR-0063 #2): one row, the shared defaults until the admin saves it. */
@Injectable()
export class PosSettingsService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly audit: AuditService,
    private readonly org: OrgService,
    private readonly moneyAccounts: MoneyAccountsService,
  ) {}

  async get(executor: Db | Tx = this.db): Promise<PosSettings> {
    const [row] = await executor.select().from(posSettings);
    const values = row ?? { ...DEFAULTS, updatedAt: null };
    const warehouse =
      values.storeWarehouseId === null
        ? null
        : await this.org.getWarehouse(values.storeWarehouseId, executor);
    const account =
      values.handoverMoneyAccountId === null
        ? null
        : await this.moneyAccounts.get(values.handoverMoneyAccountId, executor);
    return {
      storeWarehouseId: values.storeWarehouseId,
      storeWarehouseName: warehouse?.name ?? null,
      handoverMoneyAccountId: values.handoverMoneyAccountId,
      handoverMoneyAccountName: account?.name ?? null,
      returnWindowDays: values.returnWindowDays,
      snapshotIntervalSec: values.snapshotIntervalSec,
      supervisorRequired: values.supervisorRequired,
      receiptTitle: values.receiptTitle,
      receiptFooter: values.receiptFooter,
      ebarimtDistrictCode: values.ebarimtDistrictCode,
      ebarimtClassificationCode: values.ebarimtClassificationCode,
      updatedAt: values.updatedAt,
    };
  }

  async update(ctx: AuthContext, patch: PosSettingsPatch): Promise<PosSettings> {
    await inTransaction(this.db, async (tx) => {
      const before = await this.get(tx);
      const next = {
        storeWarehouseId:
          patch.storeWarehouseId === undefined ? before.storeWarehouseId : patch.storeWarehouseId,
        handoverMoneyAccountId:
          patch.handoverMoneyAccountId === undefined
            ? before.handoverMoneyAccountId
            : patch.handoverMoneyAccountId,
        returnWindowDays: patch.returnWindowDays ?? before.returnWindowDays,
        snapshotIntervalSec: patch.snapshotIntervalSec ?? before.snapshotIntervalSec,
        supervisorRequired: patch.supervisorRequired ?? before.supervisorRequired,
        receiptTitle: keep(patch.receiptTitle, before.receiptTitle),
        receiptFooter: keep(patch.receiptFooter, before.receiptFooter),
        ebarimtDistrictCode: keep(patch.ebarimtDistrictCode, before.ebarimtDistrictCode),
        ebarimtClassificationCode: keep(
          patch.ebarimtClassificationCode,
          before.ebarimtClassificationCode,
        ),
      };
      if (next.storeWarehouseId !== null) {
        const warehouse = await this.org.getWarehouse(next.storeWarehouseId, tx);
        if (warehouse.kind !== 'STORE') {
          throw new AppError('WAREHOUSE_KIND_NOT_ALLOWED', 'the tills sell from a STORE', {
            kind: warehouse.kind,
          });
        }
      }
      if (next.handoverMoneyAccountId !== null) {
        const account = await this.moneyAccounts.get(next.handoverMoneyAccountId, tx);
        if (account.kind !== 'CASH' || account.status !== 'ACTIVE') {
          throw invalid('handoverMoneyAccountId', 'cash', 'an active cash box');
        }
      }
      await tx
        .insert(posSettings)
        .values({ id: 1, ...next, updatedBy: ctx.userId, updatedAt: sql`now()` })
        .onConflictDoUpdate({
          target: posSettings.id,
          set: { ...next, updatedBy: ctx.userId, updatedAt: sql`now()` },
        });
      await this.audit.record(tx, ctx, {
        action: 'UPDATE',
        entity: 'pos_settings',
        entityId: 1,
        before: {
          storeWarehouseId: before.storeWarehouseId,
          handoverMoneyAccountId: before.handoverMoneyAccountId,
          returnWindowDays: before.returnWindowDays,
          snapshotIntervalSec: before.snapshotIntervalSec,
          supervisorRequired: before.supervisorRequired,
          receiptTitle: before.receiptTitle,
          receiptFooter: before.receiptFooter,
          ebarimtDistrictCode: before.ebarimtDistrictCode,
          ebarimtClassificationCode: before.ebarimtClassificationCode,
        },
        after: next,
      });
    });
    return this.get();
  }
}

/** A patched text: unchanged when absent, cleared when blank. */
function keep(value: string | null | undefined, before: string | null): string | null {
  if (value === undefined) return before;
  return value === null || value.trim() === '' ? null : value.trim();
}
