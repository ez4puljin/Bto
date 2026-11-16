/**
 * «Эрхэт тулгалт» (ADR-0203): Erkhet's customers and items against Bto's, while Erkhet is still the
 * company's books. The names the api and the web share.
 *
 * Customers are matched by their code. Items are matched by barcode, because Bto gave many products
 * a new code (ADR-0098); an Erkhet item without a barcode is matched by its code to a Bto product
 * that has no barcode either.
 */

export const ERKHET_SYNC_KINDS = ['CUSTOMER', 'PRODUCT'] as const;
export type ErkhetSyncKind = (typeof ERKHET_SYNC_KINDS)[number];

/**
 * What a row of a check says.
 * - `MISSING_IN_BTO`: Erkhet has it and Bto does not.
 * - `GROUP_NOT_TAKEN`: an Erkhet customer missing in Bto whose group has no category in Bto
 *   (Kharkhorin and the suppliers were left out on purpose, ADR-0107): shown, never created.
 * - `NAME_DIFFERS`: the same customer code under another name.
 * - `PRICE_DIFFERS`: Erkhet's unit price is not Bto's warehouse price today.
 * - `NO_BTO_PRICE`: the product is in Bto without price terms today.
 * - `INACTIVE_IN_BTO`: Bto has it, switched off.
 * - `AMBIGUOUS`: an item's barcodes belong to several Bto products.
 * - `NO_BARCODE`: an item without a barcode that its code does not settle.
 * - `MISSING_IN_ERKHET`: active in Bto and not in Erkhet's list.
 */
export const ERKHET_SYNC_ISSUES = [
  'MISSING_IN_BTO',
  'GROUP_NOT_TAKEN',
  'NAME_DIFFERS',
  'PRICE_DIFFERS',
  'NO_BTO_PRICE',
  'INACTIVE_IN_BTO',
  'AMBIGUOUS',
  'NO_BARCODE',
  'MISSING_IN_ERKHET',
] as const;
export type ErkhetSyncIssue = (typeof ERKHET_SYNC_ISSUES)[number];

/** The issues each kind of row can carry, in the order the page shows them. */
export const ERKHET_ISSUES_OF: Readonly<Record<ErkhetSyncKind, readonly ErkhetSyncIssue[]>> = {
  CUSTOMER: [
    'MISSING_IN_BTO',
    'NAME_DIFFERS',
    'INACTIVE_IN_BTO',
    'GROUP_NOT_TAKEN',
    'MISSING_IN_ERKHET',
  ],
  PRODUCT: [
    'PRICE_DIFFERS',
    'MISSING_IN_BTO',
    'NO_BTO_PRICE',
    'INACTIVE_IN_BTO',
    'AMBIGUOUS',
    'NO_BARCODE',
    'MISSING_IN_ERKHET',
  ],
};

/**
 * What «Bto-д тааруулах» can do, Erkhet → Bto only (owner 2026-11-16): add a missing customer,
 * take Erkhet's name for a customer, take Erkhet's unit price as the warehouse price. Everything
 * else is shown for a person to settle; nothing is ever written to Erkhet.
 */
export function erkhetIssueAppliable(kind: ErkhetSyncKind, issue: ErkhetSyncIssue): boolean {
  if (kind === 'CUSTOMER') return issue === 'MISSING_IN_BTO' || issue === 'NAME_DIFFERS';
  return issue === 'PRICE_DIFFERS';
}

export const ERKHET_RUN_STATUSES = ['QUEUED', 'RUNNING', 'DONE', 'FAILED'] as const;
export type ErkhetRunStatus = (typeof ERKHET_RUN_STATUSES)[number];

/** Why a check failed: our settings, Erkhet's sign-in, its answer, or the files it gave. */
export const ERKHET_FAILURES = [
  'NOT_CONFIGURED',
  'KEY_UNREADABLE',
  'LOGIN_FAILED',
  'COMPANY_UNREACHABLE',
  'UNREACHABLE',
  'TIMEOUT',
  'UNEXPECTED_ANSWER',
  'UNEXPECTED_FILE',
  'INTERRUPTED',
  'INTERNAL',
] as const;
export type ErkhetFailure = (typeof ERKHET_FAILURES)[number];

/** How a row ended once «Bto-д тааруулах» looked at it. */
export const ERKHET_RESOLUTIONS = ['APPLIED', 'STALE', 'REFUSED'] as const;
export type ErkhetResolution = (typeof ERKHET_RESOLUTIONS)[number];

export const ERKHET_LIMITS = {
  /** Rows «Bto-д тааруулах» takes at once. */
  maxApply: 500,
  /** Rows read from one of Erkhet's lists. */
  maxRows: 60_000,
  /** Checks whose rows are kept; older ones keep their counts only. */
  keptRuns: 5,
  /** A check still running after this many minutes was interrupted. */
  staleMinutes: 20,
} as const;

/** A price difference of this or less reads as none: prices are whole tugriks. */
export const ERKHET_PRICE_TOLERANCE = '0.5';

/** The lists Bto reads, as Erkhet's own «Excel» button downloads them: read-only requests. */
export const ERKHET_LIST_PATHS = {
  items: 'inventory/item/list/',
  customers: 'customers/list/',
} as const;

/** The columns each list must have; a file without them is refused whole. */
export const ERKHET_ITEM_COLUMNS = {
  code: 'Код',
  name: 'Нэр',
  category: 'Ангилал нэр',
  barcodes: 'Баркод',
  price: 'Нэгж үнэ',
} as const;

export const ERKHET_CUSTOMER_COLUMNS = {
  code: 'Код',
  name: 'Нэр',
  groupCode: 'Бүлэг код',
  groupName: 'Бүлэг нэр',
  phone: 'Утас',
} as const;

/** An Erkhet company id as it stands in its addresses. */
export const ERKHET_COMPANY_ID_PATTERN = /^\d{4,20}$/;
