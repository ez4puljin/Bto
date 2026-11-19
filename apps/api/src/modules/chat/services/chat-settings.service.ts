import { Inject, Injectable } from '@nestjs/common';
import mn from '@tugeel/shared/i18n/mn.json';
import { eq, sql } from 'drizzle-orm';
import { DB } from '../../../common/db/db.tokens';
import type { Db, Tx } from '../../../common/db/db.types';
import { inTransaction } from '../../../common/db/transaction';
import { invalid } from '../../../common/errors/app-error';
import { actorUserId, AuditService, type AuthContext } from '../../identity';
import { CHAT_LIMITS, CHAT_TEXT_KEYS, type ChatTextKey, chatLength } from '@tugeel/shared/chat';
import { chatSettings } from '../schema';

/** The right that changes the bot's texts (ADR-0224 #5). */
export const CHAT_SETTINGS_MANAGE = 'chat.settings.manage';

/** The office's three texts as stored: null = the built-in default is in force. */
export type ChatTexts = Record<ChatTextKey, string | null>;

/** The built-in texts (mn.json `chat.bot.defaults`): neutral, they promise nothing. */
export const CHAT_DEFAULT_TEXTS: Record<ChatTextKey, string> = mn.chat.bot.defaults;

export interface ChatSettingsView {
  /** What the office typed; null where it typed nothing. */
  texts: ChatTexts;
  /** What the bot says where the office typed nothing. */
  defaults: Record<ChatTextKey, string>;
  updatedAt: Date | null;
  updatedBy: number | null;
}

/**
 * The chat's settings (ADR-0224 #2): the greeting, «Хүргэлтийн мэдээлэл» and «Ажлын цаг, хаяг».
 * No row means the defaults; the bot reads the text in force at the moment it answers.
 */
@Injectable()
export class ChatSettingsService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly audit: AuditService,
  ) {}

  async view(executor: Db | Tx = this.db): Promise<ChatSettingsView> {
    const [row] = await executor.select().from(chatSettings).where(eq(chatSettings.id, 1));
    return {
      texts: {
        greeting: row?.greeting ?? null,
        deliveryText: row?.deliveryText ?? null,
        hoursText: row?.hoursText ?? null,
      },
      defaults: CHAT_DEFAULT_TEXTS,
      updatedAt: row?.updatedAt ?? null,
      updatedBy: row?.updatedBy ?? null,
    };
  }

  /** The three texts as the bot says them now. */
  async inForce(): Promise<Record<ChatTextKey, string>> {
    const { texts } = await this.view();
    return {
      greeting: texts.greeting ?? CHAT_DEFAULT_TEXTS.greeting,
      deliveryText: texts.deliveryText ?? CHAT_DEFAULT_TEXTS.deliveryText,
      hoursText: texts.hoursText ?? CHAT_DEFAULT_TEXTS.hoursText,
    };
  }

  /** Writes the three texts (an empty one goes back to the default) and one audit row. */
  async update(
    ctx: AuthContext,
    input: Partial<Record<ChatTextKey, string | null>>,
  ): Promise<ChatSettingsView> {
    const texts = {} as ChatTexts;
    for (const key of CHAT_TEXT_KEYS) {
      const text = input[key]?.trim() || null;
      if (text !== null && chatLength(text) > CHAT_LIMITS.textMax) {
        throw invalid(key, 'maxLength', `at most ${CHAT_LIMITS.textMax} characters`);
      }
      texts[key] = text;
    }
    return inTransaction(this.db, async (tx) => {
      await tx
        .insert(chatSettings)
        .values({ id: 1, updatedBy: actorUserId(ctx) })
        .onConflictDoNothing({ target: chatSettings.id });
      // Locked before `before` is read: two saves run one after the other.
      await tx.execute(sql`SELECT id FROM chat_settings WHERE id = 1 FOR UPDATE`);
      const before = (await this.view(tx)).texts;
      await tx
        .update(chatSettings)
        .set({ ...texts, updatedBy: actorUserId(ctx), updatedAt: sql`now()` })
        .where(eq(chatSettings.id, 1));
      await this.audit.record(tx, ctx, {
        action: 'UPDATE',
        entity: 'chat_settings',
        entityId: 1,
        before,
        after: texts,
      });
      return this.view(tx);
    });
  }
}
