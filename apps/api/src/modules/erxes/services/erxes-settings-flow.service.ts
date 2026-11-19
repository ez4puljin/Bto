import { Inject, Injectable, Logger } from '@nestjs/common';
import { eq, sql } from 'drizzle-orm';
import { AppConfig } from '../../../common/config/app-config';
import { openSealed, seal } from '../../../common/crypto/secret-box';
import { DB } from '../../../common/db/db.tokens';
import type { Db } from '../../../common/db/db.types';
import { inTransaction } from '../../../common/db/transaction';
import { AppError } from '../../../common/errors/app-error';
import { type AuthContext, AuditService, UserNamesService } from '../../identity';
import {
  type ErxesAccount,
  ErxesClient,
  ErxesError,
  ERXES_ERROR_REASONS,
  ERXES_FETCH,
  type ErxesFetch,
} from '../erxes.client';
import { erxesDeals, type ErxesPullFailure, erxesSettings } from '../schema';

/** Binds the sealed password to its column (the secret also seals Erkhet's and WeSend's). */
const PASSWORD_CONTEXT = 'erxes_settings.password';

/** The company's erxes; another address can be saved. */
export const ERXES_DEFAULT_URL = 'https://erxes.bto.mn';

export const ERXES_CHECK_REASONS = [
  ...ERXES_ERROR_REASONS,
  'NOT_CONFIGURED',
  'KEY_UNREADABLE',
] as const;

type SettingsRow = typeof erxesSettings.$inferSelect;

export interface ErxesSettingsView {
  baseUrl: string;
  email: string | null;
  /** A password is saved; the password itself never leaves the server. */
  hasPassword: boolean;
  /** A saved password that ERKHET_KEY_SECRET no longer opens. */
  passwordUnreadable: boolean;
  /** ERKHET_KEY_SECRET is set, so a password can be saved. */
  secretReady: boolean;
  /** The switch: on, new deals of the ticked pipelines are copied every minute. */
  enabled: boolean;
  /** The sign-in is whole. */
  complete: boolean;
  lastPullAt: Date | null;
  lastOkAt: Date | null;
  lastFailure: ErxesPullFailure | null;
  lastFailureDetail: string | null;
  /** Deals that wait for a person. */
  waiting: number;
  updatedAt: Date | null;
  updatedBy: string | null;
}

export interface ErxesSettingsInput {
  baseUrl?: string | null;
  email?: string | null;
  /** A new password; null removes the saved one. */
  password?: string | null;
  enabled?: boolean;
}

export interface ErxesSignInInput {
  baseUrl?: string;
  email?: string;
  /** A typed password; without it the saved one. */
  password?: string;
}

export interface ErxesCheck {
  ok: boolean;
  reason: (typeof ERXES_CHECK_REASONS)[number] | null;
  status: number | null;
  /** What erxes said, in English, for the person who looks into a failure; never a secret. */
  detail: string | null;
}

type OpenedAccount =
  | { account: ErxesAccount; failure: null }
  | { account: null; failure: 'NOT_CONFIGURED' | 'KEY_UNREADABLE' };

export type SavedErxesAccount = OpenedAccount & { enabled: boolean };

/** `https://host` without a path; null when it is not such an address. */
export function erxesOrigin(text: string): string | null {
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
 * The sign-in to erxes (ADR-0218 #2): the address, an erxes user's email and password, sealed
 * under ERKHET_KEY_SECRET with its own context, and the switch. A flow service because the check
 * and every client sign in to erxes, between transactions. The password goes only to the saved
 * address and never into a response, an audit row or a log; the session token erxes gives is
 * kept in this process's memory only.
 */
@Injectable()
export class ErxesSettingsFlowService {
  private readonly logger = new Logger(ErxesSettingsFlowService.name);
  /** The session of the saved sign-in: a new sign-in (another sealed value) starts a new one. */
  private session: { key: string; token: string } | null = null;

  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(ERXES_FETCH) private readonly fetchFn: ErxesFetch,
    private readonly config: AppConfig,
    private readonly audit: AuditService,
    private readonly names: UserNamesService,
  ) {}

  async view(): Promise<ErxesSettingsView> {
    const row = await this.row();
    const names = row?.updatedBy ? await this.names.namesOf([row.updatedBy]) : null;
    const password = row ? this.passwordOf(row) : undefined;
    const [count] = await this.db
      .select({ waiting: sql<number>`count(*)::int` })
      .from(erxesDeals)
      .where(eq(erxesDeals.status, 'WAITING'));
    return {
      baseUrl: row?.baseUrl ?? ERXES_DEFAULT_URL,
      email: row?.email ?? null,
      hasPassword: Boolean(row?.passwordSealed),
      passwordUnreadable: password === null,
      secretReady: Boolean(this.config.get('ERKHET_KEY_SECRET')),
      enabled: row?.enabled ?? false,
      complete: row ? this.accountOf(row).account !== null : false,
      lastPullAt: row?.lastPullAt ?? null,
      lastOkAt: row?.lastOkAt ?? null,
      lastFailure: row?.lastFailure ?? null,
      lastFailureDetail: row?.lastFailureDetail ?? null,
      waiting: count?.waiting ?? 0,
      updatedAt: row?.updatedAt ?? null,
      updatedBy: row?.updatedBy ? (names?.get(row.updatedBy) ?? null) : null,
    };
  }

  async update(actor: AuthContext, input: ErxesSettingsInput): Promise<ErxesSettingsView> {
    const secret = this.config.get('ERKHET_KEY_SECRET');
    if (typeof input.password === 'string' && !secret) {
      throw new AppError('ERKHET_KEY_SECRET_MISSING', 'ERKHET_KEY_SECRET is not set on the server');
    }
    await inTransaction(this.db, async (tx) => {
      const [before] = await tx
        .select()
        .from(erxesSettings)
        .where(eq(erxesSettings.id, 1))
        .for('update');
      const was = before?.baseUrl ?? ERXES_DEFAULT_URL;
      const next = {
        baseUrl: input.baseUrl === undefined ? was : (input.baseUrl ?? ERXES_DEFAULT_URL),
        email: input.email === undefined ? (before?.email ?? null) : input.email,
        passwordSealed: before?.passwordSealed ?? null,
        enabled: input.enabled ?? before?.enabled ?? false,
      };
      if (typeof input.password === 'string' && secret) {
        next.passwordSealed = seal(input.password, secret, PASSWORD_CONTEXT);
      } else if (input.password === null) {
        next.passwordSealed = null;
      }
      // A password saved for one address is never sent to another: a new address needs it typed again.
      if (before && next.baseUrl !== was && typeof input.password !== 'string') {
        next.passwordSealed = null;
      }
      if (before) {
        await tx
          .update(erxesSettings)
          .set({ ...next, updatedBy: actor.userId, updatedAt: sql`now()` })
          .where(eq(erxesSettings.id, 1));
      } else {
        await tx.insert(erxesSettings).values({ id: 1, ...next, updatedBy: actor.userId });
      }
      await this.audit.record(tx, actor, {
        action: before ? 'UPDATE' : 'CREATE',
        entity: 'erxes_settings',
        entityId: 1,
        ...(before ? { before: facts(before) } : {}),
        after: { ...facts(next), passwordChanged: input.password !== undefined },
      });
    });
    return this.view();
  }

  /** Signs in with what is typed (not saved yet), the saved values filling what is not typed. */
  async test(typed: ErxesSignInInput): Promise<ErxesCheck> {
    const failed = (reason: ErxesCheck['reason'], status?: number): ErxesCheck => ({
      ok: false,
      reason,
      status: status ?? null,
      detail: null,
    });
    const row = await this.row();
    const saved = row?.baseUrl ?? ERXES_DEFAULT_URL;
    const baseUrl = typed.baseUrl ?? saved;
    const email = typed.email ?? row?.email ?? null;
    let password: string | null | undefined = typed.password;
    if (!password) {
      // The saved password belongs to the saved address only.
      if (baseUrl !== saved) return failed('NOT_CONFIGURED');
      password = row ? this.passwordOf(row) : undefined;
      if (password === null) return failed('KEY_UNREADABLE');
    }
    if (!email || !password) return failed('NOT_CONFIGURED');
    try {
      await new ErxesClient({ baseUrl, email, password }, this.fetchFn).signIn();
      return { ok: true, reason: null, status: null, detail: null };
    } catch (error: unknown) {
      if (!(error instanceof ErxesError)) throw error;
      return failed(error.reason, error.status);
    }
  }

  /** The saved sign-in opened, or why there is none. */
  async saved(): Promise<SavedErxesAccount> {
    const row = await this.row();
    if (!row) return { account: null, failure: 'NOT_CONFIGURED', enabled: false };
    const opened = this.accountOf(row);
    if (opened.failure === 'KEY_UNREADABLE') {
      this.logger.error('the saved erxes password cannot be opened: check ERKHET_KEY_SECRET');
    }
    return { ...opened, enabled: row.enabled };
  }

  /**
   * A client for the saved sign-in that carries on the session of the one before it, and a way to
   * hand the session back when the work is done.
   */
  async client(): Promise<
    | { client: ErxesClient; baseUrl: string; keep: () => void; failure: null }
    | { client: null; failure: 'NOT_CONFIGURED' | 'KEY_UNREADABLE' }
  > {
    const row = await this.row();
    const opened: OpenedAccount = row
      ? this.accountOf(row)
      : { account: null, failure: 'NOT_CONFIGURED' };
    if (opened.account === null) return { client: null, failure: opened.failure };
    const key = `${opened.account.baseUrl}|${opened.account.email}|${row?.passwordSealed ?? ''}`;
    const client = new ErxesClient(
      opened.account,
      this.fetchFn,
      this.session?.key === key ? this.session.token : null,
    );
    return {
      client,
      baseUrl: opened.account.baseUrl,
      failure: null,
      keep: () => {
        this.session = client.session ? { key, token: client.session } : null;
      },
    };
  }

  /**
   * What the last pull came to, for the settings page. A refresh or a range read that fails is
   * written here too (ADR-0220), so a refused query is seen on the page and never passes as an
   * empty answer.
   */
  async recordPull(failure: ErxesPullFailure | null, detail: string | null): Promise<void> {
    await this.db
      .update(erxesSettings)
      .set({
        lastPullAt: sql`now()`,
        ...(failure === null ? { lastOkAt: sql`now()` } : {}),
        lastFailure: failure,
        lastFailureDetail: detail === null ? null : detail.slice(0, 500),
      })
      .where(eq(erxesSettings.id, 1));
  }

  // ---------------------------------------------------------------------------------------------

  private async row(): Promise<SettingsRow | null> {
    const [row] = await this.db.select().from(erxesSettings).where(eq(erxesSettings.id, 1));
    return row ?? null;
  }

  private accountOf(row: SettingsRow): OpenedAccount {
    const password = this.passwordOf(row);
    if (password === null) return { account: null, failure: 'KEY_UNREADABLE' };
    if (!row.email || !password) return { account: null, failure: 'NOT_CONFIGURED' };
    return {
      account: { baseUrl: row.baseUrl ?? ERXES_DEFAULT_URL, email: row.email, password },
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
function facts(row: Pick<SettingsRow, 'baseUrl' | 'email' | 'passwordSealed' | 'enabled'>) {
  return {
    baseUrl: row.baseUrl,
    email: row.email,
    hasPassword: row.passwordSealed !== null,
    enabled: row.enabled,
  };
}
