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
 * What «Bto-д тааруулах» can do, Erkhet → Bto only (owner 2026-11-16, 2026-11-19): add a missing
 * customer, take Erkhet's name for a customer, take Erkhet's unit price as the warehouse price, add
 * a missing product (ADR-0222) and price a product that has no price today (ADR-0222). Everything
 * else is shown for a person to settle; nothing is ever written to Erkhet.
 */
export function erkhetIssueAppliable(kind: ErkhetSyncKind, issue: ErkhetSyncIssue): boolean {
  if (kind === 'CUSTOMER') return issue === 'MISSING_IN_BTO' || issue === 'NAME_DIFFERS';
  return issue === 'PRICE_DIFFERS' || issue === 'MISSING_IN_BTO' || issue === 'NO_BTO_PRICE';
}

/** What a product row of «Bto-д тааруулах» takes beyond Erkhet's cells (ADR-0222, ADR-0223). */
export type ErkhetApplyChoice = 'categoryId' | 'profileId';

/**
 * What an issue's rows take: a new product a category and a price profile, a product priced from
 * Erkhet a profile; the other issues none. Each is the one erxes gives the same product, else the
 * one chosen in the dialog (ADR-0223).
 */
export function erkhetApplyChoices(
  kind: ErkhetSyncKind,
  issue: ErkhetSyncIssue,
): readonly ErkhetApplyChoice[] {
  if (kind !== 'PRODUCT') return [];
  if (issue === 'MISSING_IN_BTO') return ['categoryId', 'profileId'];
  if (issue === 'NO_BTO_PRICE') return ['profileId'];
  return [];
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
  // Read when present, never required (ADR-0222): what a product added from Erkhet takes.
  unitCode: 'Хэмжих нэгж код',
  unitName: 'Хэмжих нэгж нэр',
  /** One base unit in the pack unit («Задрах нэгж»): 1/12 for a box of 12, or 12 written the other way. */
  packRatio: 'Задрах харьцаа',
  /** Kilograms per base unit. */
  weight: 'Жин',
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

// ------------------------------------------------------------------------------------------------
// «Авлага, өглөгийн гүйлгээ» (ADR-0219): Erkhet's receivable and payable transactions copied into
// Bto's books under each party, every night until the go-live day.

/** The feature's settings as they start; the owner changes them on the page, never in code. */
export const ERKHET_LEDGER_DEFAULTS = {
  /** Erkhet's account of the customers' receivables. */
  receivableAccount: '120101',
  /** Erkhet's account of the suppliers' payables. */
  payableAccount: '310101',
  /** The first day copied line by line; the day before it carries the opening balance. */
  startDate: '2026-10-01',
} as const;

/** Which side of the books an Erkhet account is copied to. */
export const ERKHET_LEDGER_SIDES = ['RECEIVABLE', 'PAYABLE'] as const;
export type ErkhetLedgerSide = (typeof ERKHET_LEDGER_SIDES)[number];

/**
 * A run of the copy.
 * - `CHECK`: downloads and shows what would be posted; posts nothing.
 * - `POST`: posts what the latest download holds, and keeps up afterwards.
 * - `REVERT`: reverses every copied document.
 */
export const ERKHET_LEDGER_RUN_KINDS = ['CHECK', 'POST', 'REVERT'] as const;
export type ErkhetLedgerRunKind = (typeof ERKHET_LEDGER_RUN_KINDS)[number];

/**
 * Why a run of the copy failed, besides the reasons of a check (`ERKHET_FAILURES`).
 * - `ACCOUNT_NOT_FOUND`: Erkhet's filter does not list one of the account codes.
 * - `UNEXPECTED_PAGE`: a journal page did not hold its rows in a form Bto reads.
 * - `PERIOD_CLOSED`: a transaction is dated in a month Bto's books have closed.
 * - `CLEARING_MISSING`: the clearing account of the copies has no rule in Bto's chart.
 * - `POSTING_REFUSED`: the books refused a document for another reason (its code is kept).
 */
export const ERKHET_LEDGER_FAILURES = [
  ...ERKHET_FAILURES,
  'ACCOUNT_NOT_FOUND',
  'UNEXPECTED_PAGE',
  'PERIOD_CLOSED',
  'CLEARING_MISSING',
  'POSTING_REFUSED',
] as const;
export type ErkhetLedgerFailure = (typeof ERKHET_LEDGER_FAILURES)[number];

/**
 * Where a copied transaction (or a party's opening balance) stands in Bto's books.
 * - `PENDING`: downloaded, not posted yet.
 * - `POSTED`: in the books as Erkhet shows it.
 * - `UNMATCHED`: a party code of it is not in Bto; left out until the party exists.
 * - `REVERSED`: taken back (it vanished from Erkhet, or «Хуулсныг буцаах»).
 * - `BLOCKED`: it changed or vanished in Erkhet, but Bto's own allocation holds its item; a person
 *   releases that allocation first.
 */
export const ERKHET_LEDGER_STATES = [
  'PENDING',
  'POSTED',
  'UNMATCHED',
  'REVERSED',
  'BLOCKED',
] as const;
export type ErkhetLedgerState = (typeof ERKHET_LEDGER_STATES)[number];

/**
 * What «Bto-д оруулах» does with Bto's own documents on the copied accounts dated from the start
 * date (they are in Erkhet too, so they would count twice): never chosen silently.
 */
export const ERKHET_OWN_DOCUMENT_CHOICES = ['REVERSE', 'KEEP'] as const;
export type ErkhetOwnDocumentChoice = (typeof ERKHET_OWN_DOCUMENT_CHOICES)[number];

/** Why «Bto-д оруулах» or «Хуулсныг буцаах» did not start. */
export const ERKHET_LEDGER_REFUSALS = [
  'NOT_CONFIGURED',
  'RUNNING',
  'NOT_CHECKED',
  'CHOICE_REQUIRED',
  'NOT_REVERSIBLE',
  'NOTHING_POSTED',
] as const;
export type ErkhetLedgerRefusal = (typeof ERKHET_LEDGER_REFUSALS)[number];

export const ERKHET_LEDGER_LIMITS = {
  /** Lines on one page of Erkhet's general journal. */
  pageSize: 100,
  /** Pages read of one account in one run; more means the page never ends. */
  maxPages: 2_000,
  /** A pause between two requests to Erkhet, in milliseconds. */
  pauseMs: 150,
  /** Transactions whose own address is asked for in one run. */
  maxLinksPerRun: 1_500,
  /** A check older than this many hours is not posted from: «Шалгах» first. */
  checkFreshHours: 24,
  /** A run still under way after this many minutes was interrupted. */
  staleMinutes: 120,
  /** Unmatched parties and own documents listed on the page. */
  maxListed: 500,
  /** Transaction keys one request for addresses may carry. */
  maxLinkKeys: 200,
} as const;

/** Erkhet's general journal, its filter form and a transaction's actions: read-only requests. */
export const ERKHET_LEDGER_PATHS = {
  journal: 'transactions/',
  filterForm: 'transactions/get-filter-form/',
  actions: 'transactions/get-ptr-actions/',
} as const;

/** The first day Erkhet can hold a transaction; the opening balance is summed from it. */
export const ERKHET_HISTORY_START = '2000-01-01';

/** A copied transaction's key in Bto: Erkhet's account code and its transaction number. */
export const erkhetTrKey = (account: string, trId: number | string): string => `${account}:${trId}`;

/** The account and transaction of a key, or null when it is not one. */
export function parseErkhetTrKey(key: string): { account: string; trId: string } | null {
  const match = /^([0-9]{1,20}):([0-9]{1,18})$/.exec(key);
  return match?.[1] && match[2] ? { account: match[1], trId: match[2] } : null;
}

/** The party code of Erkhet's «код - нэр» customer text: the part before the first " - ". */
export function erkhetPartyOf(text: string): { code: string; name: string } | null {
  const value = text.trim();
  if (value === '') return null;
  const at = value.indexOf(' - ');
  const code = (at < 0 ? value : value.slice(0, at)).trim();
  if (code === '') return null;
  return { code, name: at < 0 ? '' : value.slice(at + 3).trim() };
}

/**
 * The copies in the Finance Core. They post as source BTO, because a party is known to the core by
 * its source's ref and the balances must combine with Bto's own; their document types and source
 * document types are their own, so no screen takes a copy for one of Bto's invoices or vouchers.
 */
export const ERKHET_BOOKS = {
  trType: 'ERKHET.TR',
  openingType: 'ERKHET.OPENING',
  allocationType: 'ERKHET.ALLOCATION',
  trDocType: 'ERKHET_TR',
  openingDocType: 'ERKHET_OPENING',
  allocationDocType: 'ERKHET_ALLOCATION',
  /** The posting key of every copy's other side: the journal list names no counter account. */
  clearingKey: 'ERKHET_CLEARING',
  /** The account that key starts on (its rule can be moved on «Данс»). */
  clearingAccount: '390102',
} as const;

/** A document type code of the copies. */
export const isErkhetDocumentType = (typeCode: string): boolean => typeCode.startsWith('ERKHET.');
/** A source document type of the copies. */
export const isErkhetSourceDocType = (docType: string | null): boolean =>
  docType !== null && docType.startsWith('ERKHET_');

/**
 * Why one of Bto's own documents cannot be reversed from «Авлага, өглөгийн гүйлгээ».
 * - `KIND`: an invoice, a supplier bill, an opening: it is voided on its own screen.
 * - `BANK_STATEMENT`: a bank statement line holds it; it is taken back from the statement, which
 *   opens the line again.
 */
export const ERKHET_OWN_DOCUMENT_BLOCKERS = ['KIND', 'BANK_STATEMENT'] as const;
export type ErkhetOwnDocumentBlocker = (typeof ERKHET_OWN_DOCUMENT_BLOCKERS)[number];
