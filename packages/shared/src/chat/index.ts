/**
 * The customer chat of «Bto300» (ADR-0224): what the api, the customer app, the staff app and the
 * web share — who writes a message, who answers a conversation, the scripted bot's buttons, the
 * limits and the live stream's events. The database checks the same shapes.
 */

/** Who wrote a message: the store, the scripted bot, or a staff member. */
export const CHAT_SENDERS = ['CUSTOMER', 'BOT', 'STAFF'] as const;
export type ChatSender = (typeof CHAT_SENDERS)[number];

/** Who answers a conversation now: the bot, or staff (the bot is then silent). */
export const CHAT_MODES = ['BOT', 'STAFF'] as const;
export type ChatMode = (typeof CHAT_MODES)[number];

/**
 * The scripted bot's buttons (ADR-0224 #2), in the order it offers them; `STAFF` is always the
 * last one and hands the conversation to staff. A button's `id` on a message is an opaque string:
 * a later flow editor offers its own ids without a change of the message tables.
 */
export const CHAT_BOT_BUTTONS = [
  'ORDER_STATUS',
  'DELIVERY_INFO',
  'BALANCE',
  'HOURS_ADDRESS',
  'STAFF',
] as const;
export type ChatBotButton = (typeof CHAT_BOT_BUTTONS)[number];

export function isChatBotButton(value: unknown): value is ChatBotButton {
  return typeof value === 'string' && (CHAT_BOT_BUTTONS as readonly string[]).includes(value);
}

/**
 * The step of the bot's flow that wrote a bot message (`flowNode`): the scripted flow's steps
 * today, a flow editor's node ids later (any string of the same shape).
 */
export const CHAT_BOT_NODES = [
  'GREETING',
  'ORDER_STATUS',
  'DELIVERY_INFO',
  'BALANCE',
  'HOURS_ADDRESS',
  'HANDOFF',
  'FALLBACK',
  'CLOSED',
] as const;
export type ChatBotNode = (typeof CHAT_BOT_NODES)[number];

/** A quick reply under a bot message: the customer presses it instead of typing. */
export interface ChatButton {
  id: string;
  label: string;
}

/** Which conversations the staff list shows. */
export const CHAT_LIST_STATES = ['WAITING', 'STAFF', 'ALL'] as const;
export type ChatListState = (typeof CHAT_LIST_STATES)[number];

/** The office's three texts (ADR-0224 #2); null in the settings = the built-in default. */
export const CHAT_TEXT_KEYS = ['greeting', 'deliveryText', 'hoursText'] as const;
export type ChatTextKey = (typeof CHAT_TEXT_KEYS)[number];

export const CHAT_LIMITS = {
  /** Characters of a message a customer or a staff member writes, counted after trimming. */
  messageMax: 1000,
  /** Characters of any stored message (a bot answer lists orders). */
  bodyMax: 2000,
  /** Characters of one of the office's three texts. */
  textMax: 1000,
  /** Buttons under one bot message; characters of a button's id and label. */
  buttonsMax: 8,
  buttonIdMax: 64,
  buttonLabelMax: 40,
  /** Messages one store may send within a minute; the next one answers 429. */
  sendsPerMinute: 12,
  /** Messages a page of the history carries: the default and the most. */
  pageDefault: 30,
  pageMax: 100,
  /** Orders the bot's «Захиалгын төлөв» lists, newest first. */
  ordersShown: 3,
} as const;

/**
 * The live streams' events (ADR-0224 #7), on `customer-app/chat/live` and `chat/live`:
 * `ready` once the listener is up (refetch then), `message` (a new message with its conversation),
 * `conversation` (a conversation changed without a message: read, closed, taken), `resync` (the
 * listener was away: refetch), `ping`.
 */
export const CHAT_LIVE_EVENTS = ['ready', 'message', 'conversation', 'resync', 'ping'] as const;
export type ChatLiveEvent = (typeof CHAT_LIVE_EVENTS)[number];

/** A stream sends `ping` this often, so a proxy never closes it as idle. */
export const CHAT_PING_SECONDS = 20;

/** The length of a text as the database counts it: Unicode characters, not UTF-16 units. */
export function chatLength(text: string): number {
  return [...text].length;
}

/**
 * What a typed text stands for in the scripted flow: the button whose label it repeats (ignoring
 * case and the spaces around it), else null — the bot never guesses.
 */
export function chatButtonOfText(text: string, buttons: readonly ChatButton[]): string | null {
  const typed = text.trim().toLocaleLowerCase('mn');
  return buttons.find((button) => button.label.toLocaleLowerCase('mn') === typed)?.id ?? null;
}
