import type { Decimal } from '../money';
import { normalizeMnPhone } from '../phone';
import { addDays, businessDate, isIsoDate } from '../time';

/**
 * Customer orders (architecture §5.6, ADR-0055): the states, how an order is fulfilled and paid,
 * the limits, and the checks of an order header the api and the web share. Messages live in
 * mn.json under `sales`.
 */
export const ORDER_STATUSES = [
  'DRAFT',
  'SUBMITTED',
  'APPROVAL_PENDING',
  'CONFIRMED',
  'PICKING',
  'PACKED',
  'DISPATCHED',
  'DELIVERED',
  'DELIVERY_FAILED',
  'INVOICED',
  'CLOSED',
  'CANCELLED',
] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];

/** Where an order came from; the office enters ADMIN orders. */
export const ORDER_CHANNELS = ['ADMIN', 'CUSTOMER_APP', 'SALES_REP', 'POS'] as const;
export type OrderChannel = (typeof ORDER_CHANNELS)[number];

/** PICKUP: the customer collects at the warehouse; DELIVERY: a company truck brings it. */
export const FULFILMENTS = ['PICKUP', 'DELIVERY'] as const;
export type Fulfilment = (typeof FULFILMENTS)[number];

/** How the customer means to pay (owner 2026-10-15); finance uses it from delivery 3. */
export const PAYMENT_METHODS = ['CASH', 'BANK_TRANSFER', 'CREDIT'] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

/**
 * What a stage does when a card arrives (ADR-0056 #3): nothing; CONFIRM submits a draft (number,
 * prices, reservations — the "incomplete sale"); PICK starts picking; SALE issues the picked stock
 * out of STAGING (the "main sale"); TRANSFER moves the picked goods out of STAGING into the
 * pipeline's store warehouse as a received push transfer, no sale (ADR-0125); CANCEL cancels with
 * a reason.
 */
export const STAGE_ACTIONS = ['NONE', 'CONFIRM', 'PICK', 'SALE', 'TRANSFER', 'CANCEL'] as const;
export type StageAction = (typeof STAGE_ACTIONS)[number];

/** The documents a stage may print when a card arrives. */
export const PRINT_KINDS = ['PICK_LIST', 'DELIVERY_NOTE'] as const;
export type PrintKind = (typeof PRINT_KINDS)[number];

/**
 * Who sees a pipeline (ADR-0057 #2): PUBLIC = every holder of `sales.orders.read`; PRIVATE = its
 * VIEW roles (MANAGE and ALL_ORDERS imply VIEW).
 */
export const PIPELINE_VISIBILITIES = ['PUBLIC', 'PRIVATE'] as const;
export type PipelineVisibility = (typeof PIPELINE_VISIBILITIES)[number];

/**
 * Rights on a pipeline: VIEW (a private pipeline), MANAGE (configure it, see all its orders),
 * ALL_ORDERS (see every order of an own-orders-only pipeline, not only one's own).
 */
export const PIPELINE_RIGHTS = ['VIEW', 'MANAGE', 'ALL_ORDERS'] as const;
export type PipelineRight = (typeof PIPELINE_RIGHTS)[number];
export const STAGE_RIGHTS = ['VIEW', 'EDIT', 'MOVE'] as const;
export type StageRight = (typeof STAGE_RIGHTS)[number];

/**
 * How a stage orders its cards, the same for everyone (ADR-0057 #6): newest or oldest first,
 * the nearest delivery date first, the largest total first, the longest in the stage first.
 */
export const CARD_SORTS = ['NEWEST', 'OLDEST', 'DELIVERY', 'TOTAL', 'WAITING'] as const;
export type CardSort = (typeof CARD_SORTS)[number];

export const BOARD_LIMITS = {
  maxName: 80,
  maxStages: 30,
  maxBoards: 50,
  maxPipelines: 100,
  /** Cards a stage shows on the board; the list view holds the rest. */
  cardsPerStage: 200,
  /** Orders printed on one page. */
  maxPrint: 100,
} as const;

/** The states an order may be edited in (ADR-0056 #4): until picking starts. */
export const EDITABLE_STATUSES: readonly OrderStatus[] = ['DRAFT', 'CONFIRMED'];

export function isEditable(status: OrderStatus): boolean {
  return EDITABLE_STATUSES.includes(status);
}

/** The states after which nothing more happens to an order on a board: it may be archived. */
export const FINISHED_STATUSES: readonly OrderStatus[] = [
  'DELIVERED',
  'INVOICED',
  'CLOSED',
  'CANCELLED',
];

export function isFinished(status: OrderStatus): boolean {
  return FINISHED_STATUSES.includes(status);
}

/**
 * The company's order number format (ADR-0057 #3): literal characters and the tokens `{year}`,
 * `{month}`, `{day}`, rendered with the day the order is created, then a counter of `digits`
 * digits shared by every pipeline (`20261015_0001`). The pattern ends with a character that is
 * not a digit, so a number splits into exactly one prefix and its counter.
 */
export const ORDER_NUMBER_TOKENS = ['year', 'month', 'day'] as const;
export type OrderNumberToken = (typeof ORDER_NUMBER_TOKENS)[number];
export const ORDER_NUMBER_DEFAULTS = { pattern: '{year}{month}{day}_', digits: 4 } as const;
export const ORDER_NUMBER_LIMITS = { maxPattern: 24, minDigits: 1, maxDigits: 8 } as const;

export type OrderNumberIssue =
  | {
      path: 'pattern';
      code: 'EMPTY' | 'TOO_LONG' | 'UNKNOWN_TOKEN' | 'BAD_CHAR' | 'ENDS_WITH_DIGIT' | 'RESERVED';
    }
  | { path: 'digits'; code: 'RANGE' };

/** Letters (Latin and Mongolian Cyrillic), digits and `-` `_` `.` `/` between the tokens. */
const LITERAL = /^[0-9A-Za-zА-ЯЁӨҮа-яёөү._/-]$/u;
const TOKEN = /\{([a-z]+)\}/g;

/** What is wrong with a number format; an empty list when it may be saved. */
export function orderNumberPatternIssues(pattern: string, digits: number): OrderNumberIssue[] {
  const issues: OrderNumberIssue[] = [];
  if (
    !Number.isInteger(digits) ||
    digits < ORDER_NUMBER_LIMITS.minDigits ||
    digits > ORDER_NUMBER_LIMITS.maxDigits
  ) {
    issues.push({ path: 'digits', code: 'RANGE' });
  }
  if (pattern === '') return [{ path: 'pattern', code: 'EMPTY' }, ...issues];
  if (pattern.length > ORDER_NUMBER_LIMITS.maxPattern) {
    return [{ path: 'pattern', code: 'TOO_LONG' }, ...issues];
  }
  const tokens = [...pattern.matchAll(TOKEN)].map((match) => match[1] ?? '');
  if (tokens.some((token) => !(ORDER_NUMBER_TOKENS as readonly string[]).includes(token))) {
    issues.unshift({ path: 'pattern', code: 'UNKNOWN_TOKEN' });
  } else if ([...pattern.replace(TOKEN, '')].some((char) => !LITERAL.test(char))) {
    issues.unshift({ path: 'pattern', code: 'BAD_CHAR' });
  } else if (/[0-9}]$/.test(pattern)) {
    issues.unshift({ path: 'pattern', code: 'ENDS_WITH_DIGIT' });
  } else if (pattern.toUpperCase().startsWith('SO-')) {
    issues.unshift({ path: 'pattern', code: 'RESERVED' });
  }
  return issues;
}

/** The pattern with its tokens replaced by the parts of `isoDate` (`YYYY-MM-DD`). */
export function orderNumberPrefix(pattern: string, isoDate: string): string {
  const parts: Record<OrderNumberToken, string> = {
    year: isoDate.slice(0, 4),
    month: isoDate.slice(5, 7),
    day: isoDate.slice(8, 10),
  };
  return pattern.replace(TOKEN, (whole, token: string) =>
    token in parts ? parts[token as OrderNumberToken] : whole,
  );
}

/** A number: the prefix and the counter padded to `digits` (never cut when it grows longer). */
export function formatOrderNumber(prefix: string, digits: number, value: number): string {
  return `${prefix}${String(value).padStart(digits, '0')}`;
}

/** The number the pattern gives on `isoDate` for counter `value` (previews and the api). */
export function renderOrderNumber(
  pattern: string,
  digits: number,
  isoDate: string,
  value: number,
): string {
  return formatOrderNumber(orderNumberPrefix(pattern, isoDate), digits, value);
}

export const ORDER_LIMITS = {
  maxLines: 200,
  maxNote: 500,
  maxContactName: 120,
  maxCancelReason: 500,
} as const;

/** States an order may be cancelled from today (picking and packing join when they are built). */
export const CANCELLABLE_STATUSES: readonly OrderStatus[] = [
  'DRAFT',
  'SUBMITTED',
  'APPROVAL_PENDING',
  'CONFIRMED',
];

export function isCancellable(status: OrderStatus): boolean {
  return CANCELLABLE_STATUSES.includes(status);
}

/** The delivery date a new order proposes: tomorrow in Ulaanbaatar. */
export function defaultDeliveryDate(today: string = businessDate()): string {
  return addDays(today, 1);
}

/**
 * The rep app's shop orders (ADR-0068): NEW, the latest to become sale-ready first; PRICE_ASC and
 * PRICE_DESC by one base unit's price in whole packs (the warehouse price), unpriced last.
 */
export const REP_PRODUCT_SORTS = ['NEW', 'PRICE_ASC', 'PRICE_DESC'] as const;
export type RepProductSort = (typeof REP_PRODUCT_SORTS)[number];

/**
 * Products a price sort orders at most. A price sort reads every product the filters keep; above
 * this it is refused with the count (SELECTION_TOO_LARGE), never cut short.
 */
export const REP_PRICE_SORT_MAX = 100_000;

/** Days one request of the rep's orders may span, both ends included. */
export const REP_ORDER_RANGE_MAX_DAYS = 366;

/**
 * The rep app's order-history state filter: DRAFT; ACTIVE, submitted but not yet delivered; SOLD,
 * delivered (invoiced and closed included); CANCELLED.
 */
export const REP_ORDER_STATES = ['DRAFT', 'ACTIVE', 'SOLD', 'CANCELLED'] as const;
export type RepOrderState = (typeof REP_ORDER_STATES)[number];

const REP_ORDER_STATE_STATUSES: Record<RepOrderState, readonly OrderStatus[]> = {
  DRAFT: ['DRAFT'],
  ACTIVE: [
    'SUBMITTED',
    'APPROVAL_PENDING',
    'CONFIRMED',
    'PICKING',
    'PACKED',
    'DISPATCHED',
    'DELIVERY_FAILED',
  ],
  SOLD: ['DELIVERED', 'INVOICED', 'CLOSED'],
  CANCELLED: ['CANCELLED'],
};

/** The order statuses a rep's state filter keeps; every status belongs to exactly one state. */
export function repOrderStatusesOf(state: RepOrderState): readonly OrderStatus[] {
  return REP_ORDER_STATE_STATUSES[state];
}

/**
 * The rep app's map: a store the rep ordered for within this many days, today included, is fresh;
 * any other store (or one never ordered for) is shown as waiting for a visit.
 */
export const REP_MAP_FRESH_DAYS = 7;

/**
 * True when a store has no order, or its last order's Ulaanbaatar day lies before the fresh window
 * (`today` and the REP_MAP_FRESH_DAYS - 1 days before it). Both dates are `YYYY-MM-DD`.
 */
export function storeIsStale(lastOrderDate: string | null, today: string): boolean {
  return lastOrderDate === null || lastOrderDate < addDays(today, -(REP_MAP_FRESH_DAYS - 1));
}

/**
 * The customer app's stock in three words (ADR-0079 #4): the number never reaches a customer.
 * OUT when nothing is free; LOW below the product's minimum level in its home warehouse when one
 * is set, otherwise below one whole pack, otherwise below CUSTOMER_LOW_STOCK_BASE base units.
 */
export const STOCK_WORDS = ['IN', 'LOW', 'OUT'] as const;
export type StockWord = (typeof STOCK_WORDS)[number];

/** «Цөөхөн» for a product with neither a minimum level nor a pack (Claude's default, ADR-0079 #4). */
export const CUSTOMER_LOW_STOCK_BASE = 10;

/**
 * The word for `available` base units: `minLevel` is the home warehouse's minimum (null = none
 * set), `packBase` the base units of one whole pack (null = no pack).
 */
export function stockWord(
  available: Decimal,
  minLevel: Decimal | null,
  packBase: Decimal | null,
): StockWord {
  if (available.lte(0)) return 'OUT';
  const threshold =
    minLevel !== null && minLevel.gt(0)
      ? minLevel
      : packBase !== null && packBase.gt(0)
        ? packBase
        : null;
  if (threshold !== null) return available.lt(threshold) ? 'LOW' : 'IN';
  return available.lt(CUSTOMER_LOW_STOCK_BASE) ? 'LOW' : 'IN';
}

/**
 * An order's progress in the customer's words (ADR-0079 #6): PENDING «Хүлээгдэж буй» until the
 * office confirms, CONFIRMED «Батлагдсан», PREPARING «Бэлтгэж буй», READY «Бэлэн», DELIVERED
 * «Хүргэгдсэн», CANCELLED «Цуцлагдсан».
 */
export const CUSTOMER_ORDER_STATES = [
  'PENDING',
  'CONFIRMED',
  'PREPARING',
  'READY',
  'DELIVERED',
  'CANCELLED',
] as const;
export type CustomerOrderState = (typeof CUSTOMER_ORDER_STATES)[number];

const CUSTOMER_ORDER_STATE_OF: Record<OrderStatus, CustomerOrderState> = {
  DRAFT: 'PENDING',
  SUBMITTED: 'PENDING',
  APPROVAL_PENDING: 'PENDING',
  CONFIRMED: 'CONFIRMED',
  PICKING: 'PREPARING',
  PACKED: 'READY',
  DISPATCHED: 'READY',
  DELIVERY_FAILED: 'READY',
  DELIVERED: 'DELIVERED',
  INVOICED: 'DELIVERED',
  CLOSED: 'DELIVERED',
  CANCELLED: 'CANCELLED',
};

/** Every order status in the customer's words; exactly one word per status. */
export function customerOrderStateOf(status: OrderStatus): CustomerOrderState {
  return CUSTOMER_ORDER_STATE_OF[status];
}

/** The statuses one customer word stands for (the app's order filter). */
export function customerOrderStatusesOf(state: CustomerOrderState): OrderStatus[] {
  return ORDER_STATUSES.filter((status) => CUSTOMER_ORDER_STATE_OF[status] === state);
}

/**
 * The day an app order may ask for (ADR-0079 #5): today, tomorrow, the day after, or another day
 * within this many days of today.
 */
export const CUSTOMER_ORDER_MAX_DAYS = 60;

/** True when `deliveryDate` is today … today + CUSTOMER_ORDER_MAX_DAYS (both `YYYY-MM-DD`). */
export function isCustomerDeliveryDate(deliveryDate: string, today: string): boolean {
  return (
    isIsoDate(deliveryDate) &&
    deliveryDate >= today &&
    deliveryDate <= addDays(today, CUSTOMER_ORDER_MAX_DAYS)
  );
}

/** Orders one page of the store's history carries at most (the app asks for 30, «Нүүр» for 2). */
export const CUSTOMER_ORDER_PAGE_MAX = 50;

/** Products a section of «Bto300»'s home carries at most (ADR-0092 #1); its chevron opens all. */
export const HOME_SECTION_SIZE = 10;

/** «Сүүлд захиалсан бараа»: the store's orders of this many days, today included (ADR-0092 #4). */
export const RECENT_ORDER_DAYS = 90;

/**
 * The home's product sections (ADR-0092 #1, ADR-0093): RECENT, PROMOTIONS, the shown SEGMENTs in
 * their order, DISCOUNTS, NEW and FAVOURITES, always in that order; DEALS (promotions and
 * discounts together) is a category page's «Хямдралтай бараа» and the shop's chip.
 */
export const HOME_SECTION_KINDS = [
  'RECENT',
  'PROMOTIONS',
  'SEGMENT',
  'DISCOUNTS',
  'NEW',
  'FAVOURITES',
  'DEALS',
] as const;
export type HomeSectionKind = (typeof HOME_SECTION_KINDS)[number];

/** A section's key in the routes: `recent`, …, or `segment-<id>`. */
export type HomeSectionKey =
  | { kind: Exclude<HomeSectionKind, 'SEGMENT'> }
  | {
      kind: 'SEGMENT';
      segmentId: number;
    };

export function homeSectionKey(key: HomeSectionKey): string {
  return key.kind === 'SEGMENT' ? `segment-${key.segmentId}` : key.kind.toLowerCase();
}

/** The section a route's key names, or null. */
export function parseHomeSectionKey(value: string): HomeSectionKey | null {
  const segment = /^segment-([1-9][0-9]{0,14})$/.exec(value);
  if (segment?.[1]) return { kind: 'SEGMENT', segmentId: Number.parseInt(segment[1], 10) };
  const kind = value.toUpperCase();
  return kind !== 'SEGMENT' && (HOME_SECTION_KINDS as readonly string[]).includes(kind)
    ? { kind: kind as Exclude<HomeSectionKind, 'SEGMENT'> }
    : null;
}

/**
 * A section's full list orders (ADR-0092 #7): DEFAULT, the home row's own order (the most ordered,
 * the biggest discount, the newest, the latest ♡); DEAL, the biggest discount first; NEW; the
 * price either way. «Дууссан» products always come last.
 */
export const HOME_SECTION_SORTS = ['DEFAULT', 'DEAL', 'NEW', 'PRICE_ASC', 'PRICE_DESC'] as const;
export type HomeSectionSort = (typeof HOME_SECTION_SORTS)[number];

/** What a banner of the home opens (ADR-0092 #5): nothing, a segment's list, a category, a product. */
export const BANNER_LINK_KINDS = ['NONE', 'SEGMENT', 'CATEGORY', 'PRODUCT'] as const;
export type BannerLinkKind = (typeof BANNER_LINK_KINDS)[number];

/** A banner's title (its alt text) is 1–80 characters. */
export const BANNER_TITLE_MAX = 80;

/** A banner relative to today: not started, shown, past its last day, or archived. */
export const BANNER_STATES = ['SCHEDULED', 'RUNNING', 'ENDED', 'ARCHIVED'] as const;
export type BannerState = (typeof BANNER_STATES)[number];

/** `validTo` is exclusive, like notices and discount programs (YYYY-MM-DD). */
export function bannerState(
  banner: { validFrom: string; validTo: string | null; archived: boolean },
  today: string,
): BannerState {
  if (banner.archived) return 'ARCHIVED';
  if (banner.validFrom > today) return 'SCHEDULED';
  if (banner.validTo !== null && banner.validTo <= today) return 'ENDED';
  return 'RUNNING';
}

export interface OrderHeaderInput {
  fulfilment: Fulfilment;
  deliveryDate: string;
  addressId: number | null;
  contactPhone: string | null;
}

export type OrderHeaderIssue =
  | { path: 'deliveryDate'; code: 'isDate' | 'notPast' }
  | { path: 'addressId'; code: 'required' }
  | { path: 'contactPhone'; code: 'phone' };

/**
 * What is wrong with an order header: a delivery date that is not a date or lies in the past, a
 * delivery without an address, a contact phone that is not a Mongolian mobile number.
 */
export function orderHeaderIssues(
  input: OrderHeaderInput,
  today: string = businessDate(),
): OrderHeaderIssue[] {
  const issues: OrderHeaderIssue[] = [];
  if (!isIsoDate(input.deliveryDate)) issues.push({ path: 'deliveryDate', code: 'isDate' });
  else if (input.deliveryDate < today) issues.push({ path: 'deliveryDate', code: 'notPast' });
  if (input.fulfilment === 'DELIVERY' && input.addressId === null) {
    issues.push({ path: 'addressId', code: 'required' });
  }
  if (input.contactPhone !== null && normalizeMnPhone(input.contactPhone) === null) {
    issues.push({ path: 'contactPhone', code: 'phone' });
  }
  return issues;
}
