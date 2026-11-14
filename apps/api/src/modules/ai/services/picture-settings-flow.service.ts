import { Inject, Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { eq, sql } from 'drizzle-orm';
import { AppConfig } from '../../../common/config/app-config';
import { DB } from '../../../common/db/db.tokens';
import type { Db } from '../../../common/db/db.types';
import { inTransaction } from '../../../common/db/transaction';
import { AppError } from '../../../common/errors/app-error';
import {
  PICTURE_ERROR_REASONS,
  PictureError,
  PictureGateway,
  type PictureSaved,
  type PictureSettingsStore,
} from '../../../integrations/picture';
import { type AuthContext, AuditService, StorageService, UserNamesService } from '../../identity';
import { aiPictureSettings } from '../schema';
import { openSecret, PICTURE_KEY_CONTEXT, sealSecret } from './secret-box';

/** The file kind of the company's logo (ADR-0198), public. */
export const PICTURE_STAMP = 'ai.picture_stamp';
const KEY_HINT_LENGTH = 4;

/** Why a check failed: the service's side, or no usable key on ours. */
export const PICTURE_CHECK_REASONS = [
  ...PICTURE_ERROR_REASONS,
  'NO_KEY',
  'KEY_UNREADABLE',
] as const;

type PictureSettingsRow = typeof aiPictureSettings.$inferSelect;

export interface PictureSettingsView {
  /** The saved key's last characters; the key itself never leaves the server. */
  keyHint: string | null;
  /** A saved key that AI_KEY_SECRET no longer opens. */
  keyUnreadable: boolean;
  /** AI_KEY_SECRET is set, so a key can be saved here. */
  secretReady: boolean;
  stampUrl: string | null;
  updatedAt: Date | null;
  updatedBy: string | null;
}

export interface PictureSettingsInput {
  /** A new key; null removes the saved one. */
  apiKey?: string | null;
  /** An uploaded logo; null takes the saved one away. */
  stampFileId?: number | null;
}

export interface PictureCheck {
  ok: boolean;
  reason: (typeof PICTURE_CHECK_REASONS)[number] | null;
  status: number | null;
  providerCode: string | null;
  /** What the service says is left on the account. */
  credits: string | null;
  freeCalls: number | null;
}

/**
 * The settings of product pictures (ADR-0198): the background service's key, sealed under
 * AI_KEY_SECRET like the model's, and the company's logo. It answers the picture gateway at every
 * call and is a flow service because the check calls the service, between transactions. The key
 * goes only to the service's own address and never into a response, an audit row or a log.
 */
@Injectable()
export class PictureSettingsFlowService implements OnModuleInit, PictureSettingsStore {
  private readonly logger = new Logger(PictureSettingsFlowService.name);

  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly config: AppConfig,
    private readonly gateway: PictureGateway,
    private readonly audit: AuditService,
    private readonly storage: StorageService,
    private readonly names: UserNamesService,
  ) {}

  onModuleInit(): void {
    this.gateway.attach(this);
  }

  // ---------------------------------------------------------------------------------------------
  // The gateway's side

  async saved(): Promise<PictureSaved> {
    const row = await this.row();
    if (!row) return { apiKey: null, stampFileId: null };
    const apiKey = this.keyOf(row);
    if (apiKey === null) {
      this.logger.error('the saved background service key cannot be opened: check AI_KEY_SECRET');
    }
    return { apiKey: apiKey ?? null, stampFileId: row.stampFileId };
  }

  // ---------------------------------------------------------------------------------------------
  // The settings screen

  async view(): Promise<PictureSettingsView> {
    const row = await this.row();
    const urls = row?.stampFileId ? await this.storage.publicUrls([row.stampFileId]) : null;
    const names = row?.updatedBy ? await this.names.namesOf([row.updatedBy]) : null;
    return {
      keyHint: row?.apiKeyHint ?? null,
      keyUnreadable: row ? this.keyOf(row) === null : false,
      secretReady: Boolean(this.config.get('AI_KEY_SECRET')),
      stampUrl: row?.stampFileId ? (urls?.get(row.stampFileId) ?? null) : null,
      updatedAt: row?.updatedAt ?? null,
      updatedBy: row?.updatedBy ? (names?.get(row.updatedBy) ?? null) : null,
    };
  }

  async update(actor: AuthContext, input: PictureSettingsInput): Promise<PictureSettingsView> {
    const secret = this.config.get('AI_KEY_SECRET');
    if (typeof input.apiKey === 'string' && !secret) {
      throw new AppError('AI_KEY_SECRET_MISSING', 'AI_KEY_SECRET is not set on the server');
    }
    const stampFileId = input.stampFileId;
    if (typeof stampFileId === 'number') {
      await this.storage.verifyUploaded(stampFileId, PICTURE_STAMP);
    }
    await inTransaction(this.db, async (tx) => {
      const [before] = await tx
        .select()
        .from(aiPictureSettings)
        .where(eq(aiPictureSettings.id, 1))
        .for('update');
      const next = {
        apiKeySealed: before?.apiKeySealed ?? null,
        apiKeyHint: before?.apiKeyHint ?? null,
        stampFileId: before?.stampFileId ?? null,
      };
      if (typeof input.apiKey === 'string' && secret) {
        next.apiKeySealed = sealSecret(input.apiKey, secret, PICTURE_KEY_CONTEXT);
        next.apiKeyHint = input.apiKey.slice(-KEY_HINT_LENGTH);
      } else if (input.apiKey === null) {
        next.apiKeySealed = null;
        next.apiKeyHint = null;
      }
      if (stampFileId !== undefined && stampFileId !== next.stampFileId) {
        if (stampFileId !== null) await this.storage.confirm(tx, stampFileId, PICTURE_STAMP);
        if (next.stampFileId !== null) await this.storage.markDeleted(tx, next.stampFileId);
        next.stampFileId = stampFileId;
      }
      if (before) {
        await tx
          .update(aiPictureSettings)
          .set({ ...next, updatedBy: actor.userId, updatedAt: sql`now()` })
          .where(eq(aiPictureSettings.id, 1));
      } else {
        await tx.insert(aiPictureSettings).values({ id: 1, ...next, updatedBy: actor.userId });
      }
      await this.audit.record(tx, actor, {
        action: before ? 'UPDATE' : 'CREATE',
        entity: 'ai_picture_settings',
        entityId: 1,
        ...(before ? { before: facts(before) } : {}),
        after: { ...facts(next), keyChanged: input.apiKey !== undefined },
      });
    });
    return this.view();
  }

  /** A free request with a typed key (not saved yet), or with the saved one. */
  async test(typedKey: string | undefined): Promise<PictureCheck> {
    const failed = (reason: PictureCheck['reason']): PictureCheck => ({
      ok: false,
      reason,
      status: null,
      providerCode: null,
      credits: null,
      freeCalls: null,
    });
    let apiKey = typedKey;
    if (!apiKey) {
      const row = await this.row();
      const saved = row ? this.keyOf(row) : undefined;
      if (saved === null) return failed('KEY_UNREADABLE');
      if (saved === undefined) return failed('NO_KEY');
      apiKey = saved;
    }
    try {
      const account = await this.gateway.removerFor(apiKey).account();
      return {
        ok: true,
        reason: null,
        status: null,
        providerCode: null,
        credits: account.credits,
        freeCalls: account.freeCalls,
      };
    } catch (error: unknown) {
      if (!(error instanceof PictureError)) throw error;
      return {
        ...failed(error.reason),
        status: error.status ?? null,
        providerCode: error.providerCode ?? null,
      };
    }
  }

  // ---------------------------------------------------------------------------------------------

  private async row(): Promise<PictureSettingsRow | null> {
    const [row] = await this.db.select().from(aiPictureSettings).where(eq(aiPictureSettings.id, 1));
    return row ?? null;
  }

  /** undefined: no key is saved; null: one is saved and AI_KEY_SECRET does not open it. */
  private keyOf(row: PictureSettingsRow): string | null | undefined {
    if (!row.apiKeySealed) return undefined;
    const secret = this.config.get('AI_KEY_SECRET');
    return secret ? openSecret(row.apiKeySealed, secret, PICTURE_KEY_CONTEXT) : null;
  }
}

/** What an audit row keeps of the settings: never the sealed key or its last characters. */
function facts(row: Pick<PictureSettingsRow, 'apiKeySealed' | 'stampFileId'>) {
  return { hasKey: row.apiKeySealed !== null, stampFileId: row.stampFileId };
}
