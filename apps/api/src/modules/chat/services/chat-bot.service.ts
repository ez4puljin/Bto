import { Injectable } from '@nestjs/common';
import mn from '@tugeel/shared/i18n/mn.json';
import { Decimal } from '@tugeel/shared/money';
import { ArLedgerService } from '../../finance';
import { CustomersService } from '../../partners';
import { CustomerOrdersService } from '../../sales';
import {
  CHAT_BOT_BUTTONS,
  CHAT_LIMITS,
  type ChatBotNode,
  type ChatButton,
  isChatBotButton,
} from '@tugeel/shared/chat';
import { ChatSettingsService } from './chat-settings.service';

const BOT = mn.chat.bot;
const ZERO = new Decimal(0);

/** What the bot says next: written as one BOT message by the caller, inside its transaction. */
export interface BotReply {
  /** The step of the flow that answered; stored as the message's `flow_node`. */
  node: ChatBotNode;
  body: string;
  /** The quick replies under the message; null = none. */
  buttons: ChatButton[] | null;
  /** True when this answer hands the conversation to staff. */
  handOff: boolean;
}

/**
 * The bot's flow as the chat calls it (ADR-0224 #2, #8). The scripted flow below is its one
 * implementation today; a flow the office draws later answers the same three questions, and the
 * message tables do not change. Every method only reads and is called before the transaction that
 * writes its answer.
 */
export interface ChatFlow {
  /** The first message of a new conversation. */
  greet(customerId: number): Promise<BotReply>;
  /**
   * The answer to a customer's message while the bot answers: `buttonId` is the pressed button
   * (or the button a typed text repeats), null for free text; `afterFallback` says the bot's last
   * word was already «choose a button». Null = the bot stays silent.
   */
  answer(
    customerId: number,
    buttonId: string | null,
    afterFallback: boolean,
  ): Promise<BotReply | null>;
  /** The note written when staff close a conversation: the bot answers again. */
  closed(): Promise<BotReply>;
}

/** `12345.5` → `12,345.50`, a whole amount without the decimals: never through a float. */
export function chatAmount(value: Decimal): string {
  const fixed = value.abs().toFixed(2);
  const [whole = '0', cents = '00'] = fixed.split('.');
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return cents === '00' ? grouped : `${grouped}.${cents}`;
}

const fill = (template: string, values: Record<string, string>): string =>
  template.replace(/\{\{(\w+)\}\}/g, (_, key: string) => values[key] ?? '');

/**
 * The scripted bot (ADR-0224 #2): never a language model. It greets, answers four topics by
 * button — two from the system (the store's own latest orders, its own balance: the figures
 * «Bto300» already shows it, nothing about stock or costs), two from the office's texts — and
 * hands over to staff. Typed text that repeats no button gets the buttons once more, never a
 * guess.
 */
@Injectable()
export class ChatBotService implements ChatFlow {
  constructor(
    private readonly settings: ChatSettingsService,
    private readonly orders: CustomerOrdersService,
    private readonly ledger: ArLedgerService,
    private readonly customers: CustomersService,
  ) {}

  /** The five buttons, «Ажилтантай холбогдох» last. */
  menu(): ChatButton[] {
    return CHAT_BOT_BUTTONS.map((id) => ({ id, label: BOT.buttons[id] }));
  }

  async greet(): Promise<BotReply> {
    return this.say('GREETING', (await this.settings.inForce()).greeting);
  }

  async answer(
    customerId: number,
    buttonId: string | null,
    afterFallback: boolean,
  ): Promise<BotReply | null> {
    if (!isChatBotButton(buttonId)) {
      return afterFallback ? null : this.say('FALLBACK', BOT.fallback);
    }
    switch (buttonId) {
      case 'ORDER_STATUS':
        return this.say('ORDER_STATUS', await this.orderStatus(customerId));
      case 'DELIVERY_INFO':
        return this.say('DELIVERY_INFO', (await this.settings.inForce()).deliveryText);
      case 'BALANCE':
        return this.say('BALANCE', await this.balance(customerId));
      case 'HOURS_ADDRESS':
        return this.say('HOURS_ADDRESS', (await this.settings.inForce()).hoursText);
      case 'STAFF':
        return { node: 'HANDOFF', body: BOT.handoff, buttons: null, handOff: true };
    }
  }

  closed(): Promise<BotReply> {
    return Promise.resolve(this.say('CLOSED', BOT.closed));
  }

  private say(node: ChatBotNode, body: string): BotReply {
    return { node, body, buttons: this.menu(), handOff: false };
  }

  /** The store's latest orders: number, day and the state in the app's own words. */
  private async orderStatus(customerId: number): Promise<string> {
    const { data } = await this.orders.page(customerId, { limit: CHAT_LIMITS.ordersShown });
    if (data.length === 0) return BOT.orders.empty;
    const lines = data.map((order) =>
      fill(BOT.orders.line, {
        number: order.number ?? BOT.orders.noNumber,
        date: order.createdDate,
        state: mn.sales.customerStates[order.state],
      }),
    );
    return [BOT.orders.title, ...lines].join('\n');
  }

  /**
   * The store's balance as «Тооцоо» shows it (ADR-0079 #7): the debt or the advance, what is
   * overdue, and with a limit what is left of it (the limit less the balance and the confirmed
   * orders not yet invoiced, never below 0); the hold without its reason.
   */
  private async balance(customerId: number): Promise<string> {
    const terms = await this.customers.creditTerms(customerId);
    const { balance } = await this.ledger.balanceOf(customerId);
    const overdue = await this.ledger.overdueOf(customerId);
    const lines = [
      balance.gt(0)
        ? fill(BOT.balance.debt, { amount: chatAmount(balance) })
        : balance.lt(0)
          ? fill(BOT.balance.advance, { amount: chatAmount(balance) })
          : BOT.balance.clear,
    ];
    if (overdue.amount.gt(0)) {
      lines.push(fill(BOT.balance.overdue, { amount: chatAmount(overdue.amount) }));
    }
    if (terms.creditLimit !== null) {
      const exposure = balance.plus(await this.orders.openExposureOf(customerId));
      lines.push(
        fill(BOT.balance.creditLeft, {
          available: chatAmount(Decimal.max(ZERO, terms.creditLimit.minus(exposure))),
          limit: chatAmount(terms.creditLimit),
        }),
      );
    }
    if (terms.creditHold) lines.push(BOT.balance.creditHold);
    return lines.join('\n');
  }
}
