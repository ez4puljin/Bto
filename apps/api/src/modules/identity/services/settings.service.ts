import { Inject, Injectable } from '@nestjs/common';
import {
  isSettingKey,
  parseSettingValue,
  SETTING_KEYS,
  settingDefault,
  type SettingKey,
  type SettingValue,
  type SettingValueOf,
} from '@tugeel/shared/settings';
import { businessDate, isIsoDate } from '@tugeel/shared/time';
import { and, asc, desc, eq, lte } from 'drizzle-orm';
import { DB } from '../../../common/db/db.tokens';
import type { Db, Tx } from '../../../common/db/db.types';
import { inTransaction } from '../../../common/db/transaction';
import { AppError } from '../../../common/errors/app-error';
import { type Actor, actorUserId } from '../auth-context';
import { settings } from '../schema';
import { AuditService } from './audit.service';

export interface SettingEntry {
  id: number;
  key: SettingKey;
  value: SettingValue;
  effectiveFrom: string;
  createdBy: number | null;
  createdAt: Date;
}

export interface SettingView {
  key: SettingKey;
  /** The value in force today (Ulaanbaatar), or the registry default, or null. */
  current: SettingValue | null;
  entries: SettingEntry[];
}

export interface CreateSettingInput {
  key: string;
  value: unknown;
  effectiveFrom: string;
}

function invalid(path: string, constraint: string, message: string): AppError {
  return new AppError('VALIDATION_FAILED', message, undefined, [{ path, constraint, message }]);
}

/**
 * Effective-dated settings (SPEC §5.1, ADR-0010 #7). Rows are never updated: a change is a new row
 * from a business date on. Only a row that is not yet in force may be deleted.
 */
@Injectable()
export class SettingsService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly audit: AuditService,
  ) {}

  /** The value in force on `onDate`; the registry default; otherwise 409 SETTING_MISSING. */
  async get<K extends SettingKey>(
    key: K,
    onDate: string = businessDate(),
    executor: Db | Tx = this.db,
  ): Promise<SettingValueOf<K>> {
    const value = await this.find(key, onDate, executor);
    if (value === undefined) {
      throw new AppError('SETTING_MISSING', `setting ${key} has no value on ${onDate}`, { key });
    }
    return value;
  }

  async find<K extends SettingKey>(
    key: K,
    onDate: string = businessDate(),
    executor: Db | Tx = this.db,
  ): Promise<SettingValueOf<K> | undefined> {
    const rows = await executor
      .select({ value: settings.value })
      .from(settings)
      .where(and(eq(settings.key, key), lte(settings.effectiveFrom, onDate)))
      .orderBy(desc(settings.effectiveFrom))
      .limit(1);
    const row = rows[0];
    if (!row) return settingDefault(key);
    const parsed = parseSettingValue(key, row.value);
    if (!parsed.ok) throw new Error(`stored value of setting ${key} is invalid`);
    return parsed.value;
  }

  /** Every registered key with its value today and its full history (newest first). */
  async list(today: string = businessDate()): Promise<SettingView[]> {
    const rows = await this.db
      .select()
      .from(settings)
      .orderBy(asc(settings.key), desc(settings.effectiveFrom));
    return SETTING_KEYS.map((key) => {
      const entries = rows.filter((row) => row.key === key).map((row) => toEntry(key, row));
      const inForce = entries.find((entry) => entry.effectiveFrom <= today);
      return { key, current: inForce?.value ?? settingDefault(key) ?? null, entries };
    });
  }

  async create(actor: Actor, input: CreateSettingInput): Promise<SettingEntry> {
    const key = input.key;
    if (!isSettingKey(key)) throw invalid('key', 'isSettingKey', `unknown setting ${key}`);
    if (!isIsoDate(input.effectiveFrom)) {
      throw invalid('effectiveFrom', 'isIsoDate', 'effectiveFrom must be YYYY-MM-DD');
    }
    const parsed = parseSettingValue(key, input.value);
    if (!parsed.ok) throw invalid('value', parsed.problem, `invalid value for ${key}`);
    const today = businessDate();
    return inTransaction(this.db, async (tx) => {
      if (input.effectiveFrom < today) {
        // Only the first value of a key may start in the past (to record the current state once).
        const existing = await tx
          .select({ id: settings.id })
          .from(settings)
          .where(eq(settings.key, key))
          .limit(1);
        if (existing.length) {
          throw new AppError('SETTING_NOT_EDITABLE', `${key}: new values start today or later`, {
            key,
          });
        }
      }
      const [row] = await tx
        .insert(settings)
        .values({
          key,
          value: parsed.value,
          effectiveFrom: input.effectiveFrom,
          createdBy: actorUserId(actor),
        })
        .returning();
      if (!row) throw new Error('settings insert returned no row');
      await this.audit.record(tx, actor, {
        action: 'CREATE',
        entity: 'settings',
        entityId: row.id,
        after: row,
      });
      return toEntry(key, row);
    });
  }

  /** Deletes a value that is not in force yet (effective after today). */
  async remove(actor: Actor, id: number): Promise<void> {
    const today = businessDate();
    await inTransaction(this.db, async (tx) => {
      const [row] = await tx.select().from(settings).where(eq(settings.id, id)).for('update');
      if (!row) throw new AppError('NOT_FOUND', `setting value ${id} not found`, { id });
      if (row.effectiveFrom <= today) {
        throw new AppError('SETTING_NOT_EDITABLE', `setting value ${id} is already in force`, {
          key: row.key,
        });
      }
      await tx.delete(settings).where(eq(settings.id, id));
      await this.audit.record(tx, actor, {
        action: 'DELETE',
        entity: 'settings',
        entityId: id,
        before: row,
      });
    });
  }
}

function toEntry(key: SettingKey, row: typeof settings.$inferSelect): SettingEntry {
  const parsed = parseSettingValue(key, row.value);
  if (!parsed.ok) throw new Error(`stored value of setting ${key} is invalid`);
  return {
    id: row.id,
    key,
    value: parsed.value,
    effectiveFrom: row.effectiveFrom,
    createdBy: row.createdBy,
    createdAt: row.createdAt,
  };
}
