import { Inject, Injectable, Logger } from '@nestjs/common';
import { eq, sql } from 'drizzle-orm';
import { AppConfig } from '../../../common/config/app-config';
import { openSealed, seal } from '../../../common/crypto/secret-box';
import { DB } from '../../../common/db/db.tokens';
import type { Db, Tx } from '../../../common/db/db.types';
import { inTransaction } from '../../../common/db/transaction';
import { AppError } from '../../../common/errors/app-error';
import { SmsError, SmsGateway } from '../../../integrations/sms';
import { type AuthContext, AuditService, UserNamesService } from '../../identity';
import { smsSettings } from '../schema';

/** Binds the sealed key to its column (ADR-0216): it cannot be moved to Erkhet's password. */
const KEY_CONTEXT = 'sms_settings.api_key';

type SettingsRow = typeof smsSettings.$inferSelect;

export interface SmsSettingsView {
  /** A key is saved; the key itself never leaves the server. */
  hasKey: boolean;
  /** The saved key's last four characters, to tell keys apart. */
  keyLast4: string | null;
  /** A saved key that ERKHET_KEY_SECRET no longer opens. */
  keyUnreadable: boolean;
  /** ERKHET_KEY_SECRET is set, so a key can be saved here. */
  secretReady: boolean;
  enabled: boolean;
  updatedAt: Date | null;
  updatedBy: string | null;
}

export interface SmsSettingsInput {
  /** A new key; null removes the saved one. */
  apiKey?: string | null;
  enabled?: boolean;
}

/** WeSend's answer to «Холболт шалгах», or why there is none. */
export interface SmsCheck {
  ok: boolean;
  /** Credits left (1 credit = 1₮). */
  balance: number | null;
  /** WeSend's code (`invalid_api_key`, …) or ours (`not_configured`, `key_unreadable`, `timeout`). */
  reason: string | null;
}

/** The key the sender uses, or why none can be used. */
export type SavedKey =
  | { apiKey: string; failure: null }
  | { apiKey: null; failure: 'not_configured' | 'key_unreadable' | 'sms_disabled' };

/**
 * WeSend's key (ADR-0216), typed on «Тохиргоо → SMS» and sealed under ERKHET_KEY_SECRET with its
 * own context (the secret both the api and the worker read). A flow service because the check and
 * the balance ask WeSend, between transactions. The key goes only to WeSend, never into a
 * response, an audit row or a log.
 */
@Injectable()
export class SmsSettingsFlowService {
  private readonly logger = new Logger(SmsSettingsFlowService.name);

  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly config: AppConfig,
    private readonly gateway: SmsGateway,
    private readonly audit: AuditService,
    private readonly names: UserNamesService,
  ) {}

  async view(): Promise<SmsSettingsView> {
    const row = await this.row();
    const names = row?.updatedBy ? await this.names.namesOf([row.updatedBy]) : null;
    const key = row ? this.keyOf(row) : undefined;
    return {
      hasKey: Boolean(row?.apiKeySealed),
      keyLast4: typeof key === 'string' ? key.slice(-4) : null,
      keyUnreadable: key === null,
      secretReady: Boolean(this.config.get('ERKHET_KEY_SECRET')),
      enabled: row?.enabled ?? true,
      updatedAt: row?.updatedAt ?? null,
      updatedBy: row?.updatedBy ? (names?.get(row.updatedBy) ?? null) : null,
    };
  }

  async update(actor: AuthContext, input: SmsSettingsInput): Promise<SmsSettingsView> {
    const secret = this.config.get('ERKHET_KEY_SECRET');
    if (typeof input.apiKey === 'string' && !secret) {
      throw new AppError('SMS_KEY_SECRET_MISSING', 'ERKHET_KEY_SECRET is not set on the server');
    }
    await inTransaction(this.db, async (tx) => {
      const [before] = await tx
        .select()
        .from(smsSettings)
        .where(eq(smsSettings.id, 1))
        .for('update');
      const next = {
        apiKeySealed: before?.apiKeySealed ?? null,
        enabled: input.enabled ?? before?.enabled ?? true,
      };
      if (typeof input.apiKey === 'string' && secret) {
        next.apiKeySealed = seal(input.apiKey, secret, KEY_CONTEXT);
      } else if (input.apiKey === null) {
        next.apiKeySealed = null;
      }
      if (before) {
        await tx
          .update(smsSettings)
          .set({ ...next, updatedBy: actor.userId, updatedAt: sql`now()` })
          .where(eq(smsSettings.id, 1));
      } else {
        await tx.insert(smsSettings).values({ id: 1, ...next, updatedBy: actor.userId });
      }
      await this.audit.record(tx, actor, {
        action: before ? 'UPDATE' : 'CREATE',
        entity: 'sms_settings',
        entityId: 1,
        ...(before ? { before: facts(before) } : {}),
        after: { ...facts(next), keyChanged: input.apiKey !== undefined },
      });
    });
    return this.view();
  }

  /** Asks WeSend for the balance with a typed key (not saved), else the saved one; saves nothing. */
  async test(typedKey?: string): Promise<SmsCheck> {
    let apiKey = typedKey;
    if (!apiKey) {
      const row = await this.row();
      const saved = row ? this.keyOf(row) : undefined;
      if (saved === null) return { ok: false, balance: null, reason: 'key_unreadable' };
      if (!saved) return { ok: false, balance: null, reason: 'not_configured' };
      apiKey = saved;
    }
    try {
      return { ok: true, balance: await this.gateway.clientFor(apiKey).balance(), reason: null };
    } catch (error: unknown) {
      if (!(error instanceof SmsError)) throw error;
      return { ok: false, balance: null, reason: error.code };
    }
  }

  /** The saved key for sending: opened, and only while sending is on. */
  async savedKey(executor: Db | Tx = this.db): Promise<SavedKey> {
    const row = await this.row(executor);
    if (!row?.apiKeySealed) return { apiKey: null, failure: 'not_configured' };
    const key = this.keyOf(row);
    if (key === null) {
      this.logger.error('the saved WeSend key cannot be opened: check ERKHET_KEY_SECRET');
      return { apiKey: null, failure: 'key_unreadable' };
    }
    if (!key) return { apiKey: null, failure: 'not_configured' };
    if (!row.enabled) return { apiKey: null, failure: 'sms_disabled' };
    return { apiKey: key, failure: null };
  }

  // ---------------------------------------------------------------------------------------------

  private async row(executor: Db | Tx = this.db): Promise<SettingsRow | null> {
    const [row] = await executor.select().from(smsSettings).where(eq(smsSettings.id, 1));
    return row ?? null;
  }

  /** undefined: none is saved; null: one is saved and ERKHET_KEY_SECRET does not open it. */
  private keyOf(row: SettingsRow): string | null | undefined {
    if (!row.apiKeySealed) return undefined;
    const secret = this.config.get('ERKHET_KEY_SECRET');
    return secret ? openSealed(row.apiKeySealed, secret, KEY_CONTEXT) : null;
  }
}

/** What an audit row keeps of the settings: never the key. */
function facts(row: Pick<SettingsRow, 'apiKeySealed' | 'enabled'>) {
  return { hasKey: row.apiKeySealed !== null, enabled: row.enabled };
}
