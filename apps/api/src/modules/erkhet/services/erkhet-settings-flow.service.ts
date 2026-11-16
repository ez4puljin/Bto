import { Inject, Injectable, Logger } from '@nestjs/common';
import { eq, sql } from 'drizzle-orm';
import { AppConfig } from '../../../common/config/app-config';
import { openSealed, seal } from '../../../common/crypto/secret-box';
import { DB } from '../../../common/db/db.tokens';
import type { Db, Tx } from '../../../common/db/db.types';
import { inTransaction } from '../../../common/db/transaction';
import { AppError } from '../../../common/errors/app-error';
import {
  type ErkhetAccount,
  ERKHET_ERROR_REASONS,
  ErkhetError,
  ErkhetGateway,
} from '../../../integrations/erkhet';
import { type AuthContext, AuditService, UserNamesService } from '../../identity';
import { erkhetSettings } from '../schema';

/** Binds the sealed password to its column. */
const PASSWORD_CONTEXT = 'erkhet_settings.password';

/** Why a sign-in check failed: Erkhet's side, or nothing usable saved on ours. */
export const ERKHET_CHECK_REASONS = [
  ...ERKHET_ERROR_REASONS,
  'NOT_CONFIGURED',
  'KEY_UNREADABLE',
] as const;

type SettingsRow = typeof erkhetSettings.$inferSelect;

export interface ErkhetSettingsView {
  baseUrl: string | null;
  companyId: string | null;
  username: string | null;
  /** A password is saved; the password itself never leaves the server. */
  hasPassword: boolean;
  /** A saved password that ERKHET_KEY_SECRET no longer opens. */
  passwordUnreadable: boolean;
  /** ERKHET_KEY_SECRET is set, so a password can be saved here. */
  secretReady: boolean;
  nightly: boolean;
  /** Everything a check needs is saved. */
  complete: boolean;
  updatedAt: Date | null;
  updatedBy: string | null;
}

export interface ErkhetSettingsInput {
  baseUrl?: string | null;
  companyId?: string | null;
  username?: string | null;
  /** A new password; null removes the saved one. */
  password?: string | null;
  nightly?: boolean;
}

export interface ErkhetSignInInput {
  baseUrl?: string;
  companyId?: string;
  username?: string;
  /** A typed password; without it the saved one. */
  password?: string;
}

export interface ErkhetCheck {
  ok: boolean;
  reason: (typeof ERKHET_CHECK_REASONS)[number] | null;
  status: number | null;
}

/** The saved sign-in opened, or why there is none. */
export type SavedAccount =
  | { account: ErkhetAccount; failure: null }
  | { account: null; failure: 'NOT_CONFIGURED' | 'KEY_UNREADABLE' };

/** `https://host` without a path, a query or a trailing slash; null when it is not such an address. */
export function erkhetOrigin(text: string): string | null {
  let url: URL;
  try {
    url = new URL(text.trim());
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' || url.username || url.password) return null;
  return url.origin;
}

/**
 * Erkhet's sign-in (ADR-0203 #2): the address, the company, the name and the password, sealed
 * under ERKHET_KEY_SECRET. A flow service because the check signs in to Erkhet, between
 * transactions. The password goes only to the saved address and never into a response, an audit
 * row or a log.
 */
@Injectable()
export class ErkhetSettingsFlowService {
  private readonly logger = new Logger(ErkhetSettingsFlowService.name);

  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly config: AppConfig,
    private readonly gateway: ErkhetGateway,
    private readonly audit: AuditService,
    private readonly names: UserNamesService,
  ) {}

  async view(): Promise<ErkhetSettingsView> {
    const row = await this.row();
    const names = row?.updatedBy ? await this.names.namesOf([row.updatedBy]) : null;
    const password = row ? this.passwordOf(row) : undefined;
    return {
      baseUrl: row?.baseUrl ?? null,
      companyId: row?.companyId ?? null,
      username: row?.username ?? null,
      hasPassword: Boolean(row?.passwordSealed),
      passwordUnreadable: password === null,
      secretReady: Boolean(this.config.get('ERKHET_KEY_SECRET')),
      nightly: row?.nightly ?? true,
      complete: row ? this.accountOf(row).account !== null : false,
      updatedAt: row?.updatedAt ?? null,
      updatedBy: row?.updatedBy ? (names?.get(row.updatedBy) ?? null) : null,
    };
  }

  async update(actor: AuthContext, input: ErkhetSettingsInput): Promise<ErkhetSettingsView> {
    const secret = this.config.get('ERKHET_KEY_SECRET');
    if (typeof input.password === 'string' && !secret) {
      throw new AppError('ERKHET_KEY_SECRET_MISSING', 'ERKHET_KEY_SECRET is not set on the server');
    }
    await inTransaction(this.db, async (tx) => {
      const [before] = await tx
        .select()
        .from(erkhetSettings)
        .where(eq(erkhetSettings.id, 1))
        .for('update');
      const next = {
        baseUrl: input.baseUrl === undefined ? (before?.baseUrl ?? null) : input.baseUrl,
        companyId: input.companyId === undefined ? (before?.companyId ?? null) : input.companyId,
        username: input.username === undefined ? (before?.username ?? null) : input.username,
        passwordSealed: before?.passwordSealed ?? null,
        nightly: input.nightly ?? before?.nightly ?? true,
      };
      if (typeof input.password === 'string' && secret) {
        next.passwordSealed = seal(input.password, secret, PASSWORD_CONTEXT);
      } else if (input.password === null) {
        next.passwordSealed = null;
      }
      // A password saved for one address is never sent to another: a new address needs it typed again.
      if (before && next.baseUrl !== before.baseUrl && typeof input.password !== 'string') {
        next.passwordSealed = null;
      }
      if (before) {
        await tx
          .update(erkhetSettings)
          .set({ ...next, updatedBy: actor.userId, updatedAt: sql`now()` })
          .where(eq(erkhetSettings.id, 1));
      } else {
        await tx.insert(erkhetSettings).values({ id: 1, ...next, updatedBy: actor.userId });
      }
      await this.audit.record(tx, actor, {
        action: before ? 'UPDATE' : 'CREATE',
        entity: 'erkhet_settings',
        entityId: 1,
        ...(before ? { before: facts(before) } : {}),
        after: { ...facts(next), passwordChanged: input.password !== undefined },
      });
    });
    return this.view();
  }

  /** Signs in with what is typed (not saved yet), the saved values filling what is not typed. */
  async test(typed: ErkhetSignInInput): Promise<ErkhetCheck> {
    const failed = (reason: ErkhetCheck['reason'], status?: number): ErkhetCheck => ({
      ok: false,
      reason,
      status: status ?? null,
    });
    const row = await this.row();
    const baseUrl = typed.baseUrl ?? row?.baseUrl ?? null;
    const companyId = typed.companyId ?? row?.companyId ?? null;
    const username = typed.username ?? row?.username ?? null;
    let password: string | null | undefined = typed.password;
    if (!password) {
      // The saved password belongs to the saved address only.
      if (typed.baseUrl !== undefined && typed.baseUrl !== row?.baseUrl) {
        return failed('NOT_CONFIGURED');
      }
      password = row ? this.passwordOf(row) : undefined;
      if (password === null) return failed('KEY_UNREADABLE');
    }
    if (!baseUrl || !companyId || !username || !password) return failed('NOT_CONFIGURED');
    try {
      await this.gateway.clientFor({ baseUrl, companyId, username, password }).signIn();
      return { ok: true, reason: null, status: null };
    } catch (error: unknown) {
      if (!(error instanceof ErkhetError)) throw error;
      return failed(error.reason, error.status);
    }
  }

  /** The saved sign-in for a check. */
  async saved(executor: Db | Tx = this.db): Promise<SavedAccount & { nightly: boolean }> {
    const row = await this.row(executor);
    if (!row) return { account: null, failure: 'NOT_CONFIGURED', nightly: false };
    const opened = this.accountOf(row);
    if (opened.failure === 'KEY_UNREADABLE') {
      this.logger.error('the saved Erkhet password cannot be opened: check ERKHET_KEY_SECRET');
    }
    return { ...opened, nightly: row.nightly };
  }

  // ---------------------------------------------------------------------------------------------

  private async row(executor: Db | Tx = this.db): Promise<SettingsRow | null> {
    const [row] = await executor.select().from(erkhetSettings).where(eq(erkhetSettings.id, 1));
    return row ?? null;
  }

  private accountOf(row: SettingsRow): SavedAccount {
    const password = this.passwordOf(row);
    if (password === null) return { account: null, failure: 'KEY_UNREADABLE' };
    if (!row.baseUrl || !row.companyId || !row.username || !password) {
      return { account: null, failure: 'NOT_CONFIGURED' };
    }
    return {
      account: {
        baseUrl: row.baseUrl,
        companyId: row.companyId,
        username: row.username,
        password,
      },
      failure: null,
    };
  }

  /** undefined: none is saved; null: one is saved and ERKHET_KEY_SECRET does not open it. */
  private passwordOf(row: SettingsRow): string | null | undefined {
    if (!row.passwordSealed) return undefined;
    const secret = this.config.get('ERKHET_KEY_SECRET');
    return secret ? openSealed(row.passwordSealed, secret, PASSWORD_CONTEXT) : null;
  }
}

/** What an audit row keeps of the settings: never the sealed password. */
function facts(
  row: Pick<SettingsRow, 'baseUrl' | 'companyId' | 'username' | 'passwordSealed' | 'nightly'>,
) {
  return {
    baseUrl: row.baseUrl,
    companyId: row.companyId,
    username: row.username,
    hasPassword: row.passwordSealed !== null,
    nightly: row.nightly,
  };
}
