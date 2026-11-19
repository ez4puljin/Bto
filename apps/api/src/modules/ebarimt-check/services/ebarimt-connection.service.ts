import { Inject, Injectable, Logger } from '@nestjs/common';
import type { EbarimtApiEnvironment, EbarimtPullReason } from '@tugeel/shared/ebarimt-check';
import { eq, sql } from 'drizzle-orm';
import { AppConfig } from '../../../common/config/app-config';
import { openSealed, seal } from '../../../common/crypto/secret-box';
import { DB } from '../../../common/db/db.tokens';
import type { Db } from '../../../common/db/db.types';
import { inTransaction } from '../../../common/db/transaction';
import { AppError } from '../../../common/errors/app-error';
import type { EbarimtApiAccount } from '../../../integrations/ebarimt';
import { type Actor, type AuthContext, AuditService, UserNamesService } from '../../identity';
import { ebarimtCheckConnection } from '../schema';

/** Bind each sealed value to its column: neither can be moved to another use of the secret. */
const PASSWORD_CONTEXT = 'ebarimt_check_connection.password';
const API_KEY_CONTEXT = 'ebarimt_check_connection.api_key';

type ConnectionRow = typeof ebarimtCheckConnection.$inferSelect;

export interface EbarimtLastPull {
  at: Date;
  ok: boolean;
  reason: EbarimtPullReason | null;
  /** The service's own words on a refusal. */
  message: string | null;
  receipts: number | null;
  masked: number | null;
}

export interface EbarimtConnectionView {
  environment: EbarimtApiEnvironment;
  username: string | null;
  /** A password is saved; the password itself never leaves the server. */
  hasPassword: boolean;
  /** A saved password that ERKHET_KEY_SECRET no longer opens. */
  passwordUnreadable: boolean;
  hasApiKey: boolean;
  apiKeyUnreadable: boolean;
  companyRegister: string | null;
  nightly: boolean;
  /** ERKHET_KEY_SECRET is set, so a password and a key can be saved. */
  secretReady: boolean;
  /** Everything a pull needs is saved and can be opened. */
  complete: boolean;
  updatedAt: Date | null;
  updatedBy: string | null;
  lastPull: EbarimtLastPull | null;
}

export interface EbarimtConnectionInput {
  environment?: EbarimtApiEnvironment;
  username?: string | null;
  /** A new password; null removes the saved one; absent keeps it. */
  password?: string | null;
  /** A new key; null removes the saved one; absent keeps it. */
  apiKey?: string | null;
  companyRegister?: string | null;
  nightly?: boolean;
}

/** The saved connection opened, or why there is none. */
export type SavedConnection =
  | { account: EbarimtApiAccount; failure: null; nightly: boolean }
  | { account: null; failure: 'NOT_CONFIGURED' | 'KEY_UNREADABLE'; nightly: boolean };

/** What a pull ended with, for the page. */
export interface EbarimtPullRecord {
  ok: boolean;
  reason: EbarimtPullReason | null;
  message: string | null;
  receipts: number | null;
  masked: number | null;
}

/**
 * The connection to e-Barimt's purchases service (ADR-0228), typed on the Ebarimt page: the
 * environment, the sign-in, the tax authority's key, the company's register and the nightly
 * switch. The password and the key are sealed under ERKHET_KEY_SECRET with their own contexts (as
 * erxes's and WeSend's are) and never go into a response, an audit row or a log.
 */
@Injectable()
export class EbarimtConnectionService {
  private readonly logger = new Logger(EbarimtConnectionService.name);

  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly config: AppConfig,
    private readonly audit: AuditService,
    private readonly names: UserNamesService,
  ) {}

  async view(): Promise<EbarimtConnectionView> {
    const row = await this.row();
    const names = row?.updatedBy ? await this.names.namesOf([row.updatedBy]) : null;
    const password = row ? this.openOf(row.passwordSealed, PASSWORD_CONTEXT) : undefined;
    const apiKey = row ? this.openOf(row.apiKeySealed, API_KEY_CONTEXT) : undefined;
    return {
      environment: row?.environment ?? 'STAGING',
      username: row?.username ?? null,
      hasPassword: Boolean(row?.passwordSealed),
      passwordUnreadable: password === null,
      hasApiKey: Boolean(row?.apiKeySealed),
      apiKeyUnreadable: apiKey === null,
      companyRegister: row?.companyRegister ?? null,
      nightly: row?.nightly ?? false,
      secretReady: Boolean(this.config.get('ERKHET_KEY_SECRET')),
      complete: row ? this.accountOf(row).account !== null : false,
      updatedAt: row?.updatedAt ?? null,
      updatedBy: row?.updatedBy ? (names?.get(row.updatedBy) ?? null) : null,
      lastPull:
        row?.lastPullAt && row.lastPullOk !== null
          ? {
              at: row.lastPullAt,
              ok: row.lastPullOk,
              reason: row.lastPullReason,
              message: row.lastPullMessage,
              receipts: row.lastPullReceipts,
              masked: row.lastPullMasked,
            }
          : null,
    };
  }

  async update(actor: AuthContext, input: EbarimtConnectionInput): Promise<EbarimtConnectionView> {
    const secret = this.config.get('ERKHET_KEY_SECRET');
    if ((typeof input.password === 'string' || typeof input.apiKey === 'string') && !secret) {
      throw new AppError('ERKHET_KEY_SECRET_MISSING', 'ERKHET_KEY_SECRET is not set on the server');
    }
    await inTransaction(this.db, async (tx) => {
      const [before] = await tx
        .select()
        .from(ebarimtCheckConnection)
        .where(eq(ebarimtCheckConnection.id, 1))
        .for('update');
      const pick = <T>(typed: T | undefined, saved: T): T => (typed === undefined ? saved : typed);
      const next = {
        environment: input.environment ?? before?.environment ?? 'STAGING',
        username: pick(input.username, before?.username ?? null),
        companyRegister: pick(input.companyRegister, before?.companyRegister ?? null),
        nightly: input.nightly ?? before?.nightly ?? false,
        passwordSealed: before?.passwordSealed ?? null,
        apiKeySealed: before?.apiKeySealed ?? null,
      };
      // The real environment's password and key never go to the test one, nor the other way.
      if (before && next.environment !== before.environment) {
        next.passwordSealed = null;
        next.apiKeySealed = null;
      }
      if (typeof input.password === 'string' && secret) {
        next.passwordSealed = seal(input.password, secret, PASSWORD_CONTEXT);
      } else if (input.password === null) {
        next.passwordSealed = null;
      }
      if (typeof input.apiKey === 'string' && secret) {
        next.apiKeySealed = seal(input.apiKey, secret, API_KEY_CONTEXT);
      } else if (input.apiKey === null) {
        next.apiKeySealed = null;
      }
      if (before) {
        await tx
          .update(ebarimtCheckConnection)
          .set({ ...next, updatedBy: actor.userId, updatedAt: sql`now()` })
          .where(eq(ebarimtCheckConnection.id, 1));
      } else {
        await tx.insert(ebarimtCheckConnection).values({ id: 1, ...next, updatedBy: actor.userId });
      }
      await this.audit.record(tx, actor, {
        action: before ? 'UPDATE' : 'CREATE',
        entity: 'ebarimt_check_connection',
        entityId: 1,
        ...(before ? { before: facts(before) } : {}),
        after: {
          ...facts(next),
          passwordChanged: input.password !== undefined,
          apiKeyChanged: input.apiKey !== undefined,
        },
      });
    });
    return this.view();
  }

  /** The saved connection for a pull. */
  async saved(): Promise<SavedConnection> {
    const row = await this.row();
    if (!row) return { account: null, failure: 'NOT_CONFIGURED', nightly: false };
    const opened = this.accountOf(row);
    if (opened.failure === 'KEY_UNREADABLE') {
      this.logger.error(
        'the saved e-Barimt password or key cannot be opened: check ERKHET_KEY_SECRET',
      );
    }
    return opened.account
      ? { account: opened.account, failure: null, nightly: row.nightly }
      : { account: null, failure: opened.failure, nightly: row.nightly };
  }

  /** Keeps what a pull ended with beside the connection, for the page. */
  async recordPull(actor: Actor, record: EbarimtPullRecord): Promise<void> {
    const values = {
      lastPullAt: new Date(),
      lastPullOk: record.ok,
      lastPullReason: record.reason,
      lastPullMessage: record.message === null ? null : record.message.slice(0, 300),
      lastPullReceipts: record.receipts,
      lastPullMasked: record.masked,
    };
    await inTransaction(this.db, async (tx) => {
      const [row] = await tx
        .update(ebarimtCheckConnection)
        .set(values)
        .where(eq(ebarimtCheckConnection.id, 1))
        .returning({ id: ebarimtCheckConnection.id });
      if (!row) {
        await tx.insert(ebarimtCheckConnection).values({
          id: 1,
          ...values,
          updatedBy: actor.kind === 'STAFF' ? actor.userId : null,
        });
      }
    });
  }

  // ---------------------------------------------------------------------------------------------

  private async row(): Promise<ConnectionRow | null> {
    const [row] = await this.db
      .select()
      .from(ebarimtCheckConnection)
      .where(eq(ebarimtCheckConnection.id, 1));
    return row ?? null;
  }

  private accountOf(
    row: ConnectionRow,
  ):
    | { account: EbarimtApiAccount; failure: null }
    | { account: null; failure: 'NOT_CONFIGURED' | 'KEY_UNREADABLE' } {
    const password = this.openOf(row.passwordSealed, PASSWORD_CONTEXT);
    const apiKey = this.openOf(row.apiKeySealed, API_KEY_CONTEXT);
    if (password === null || apiKey === null) return { account: null, failure: 'KEY_UNREADABLE' };
    if (!row.username || !row.companyRegister || !password || !apiKey) {
      return { account: null, failure: 'NOT_CONFIGURED' };
    }
    return {
      account: {
        environment: row.environment,
        username: row.username,
        password,
        apiKey,
        pin: row.companyRegister,
      },
      failure: null,
    };
  }

  /** undefined: none is saved; null: one is saved and ERKHET_KEY_SECRET does not open it. */
  private openOf(sealed: string | null, context: string): string | null | undefined {
    if (!sealed) return undefined;
    const secret = this.config.get('ERKHET_KEY_SECRET');
    return secret ? openSealed(sealed, secret, context) : null;
  }
}

/** What an audit row keeps of the connection: never the sealed password or key. */
function facts(
  row: Pick<
    ConnectionRow,
    'environment' | 'username' | 'companyRegister' | 'nightly' | 'passwordSealed' | 'apiKeySealed'
  >,
) {
  return {
    environment: row.environment,
    username: row.username,
    companyRegister: row.companyRegister,
    nightly: row.nightly,
    hasPassword: row.passwordSealed !== null,
    hasApiKey: row.apiKeySealed !== null,
  };
}
