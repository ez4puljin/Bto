import { DEFAULT_GL_ACCOUNTS, FINANCE_NUMBER_DEFAULTS, type GlRole } from '@tugeel/shared/finance';
import mn from '@tugeel/shared/i18n/mn.json';
import type {
  FinAccountControl,
  FinChartTemplateAccount,
  FinInstallationSpec,
} from '../../finance-core';
import type { Branch } from '../identity';

/** The owner's group (owner, 2026-10-20); one installation books into one of its companies. */
export const BTO_TENANT = 'BUTEN_ORGIL';
/** Bto as a source system of the Finance Core (ADR-0070). */
export const BTO_SOURCE = 'BTO';
/** The core's own screens, and the owner of the legacy party (ADR-0070 #8). */
export const FIN_SOURCE = 'FIN';
export const LEGACY_PARTY_REF = 'LEGACY_UNASSIGNED';

/**
 * Bto's document types in the core (F2, ADR-0090; migration 0034 wrote the same rows): the sale's
 * invoice and the sales return numbered by Bto, the vouchers, manual entries and allocations of the
 * core's screens (source FIN) numbered by the core. F3 (ADR-0091; migration 0035): the goods
 * receipt's supplier bill, a re-costing's difference (a bill, a credit or a journal by its sign) and
 * the supplier return, all numbered by Bto.
 */
export const FIN_DOC_TYPES = {
  SALES_INVOICE: { code: 'BTO.SALES_INVOICE', system: BTO_SOURCE, docType: 'SALES_INVOICE' },
  SALES_RETURN: { code: 'BTO.SALES_RETURN', system: BTO_SOURCE, docType: 'SALES_RETURN' },
  CUSTOMER_RECEIPT: { code: 'FIN.CUSTOMER_RECEIPT', system: FIN_SOURCE, docType: 'RECEIPT' },
  CUSTOMER_REFUND: { code: 'FIN.CUSTOMER_REFUND', system: FIN_SOURCE, docType: 'PAYMENT' },
  OTHER_RECEIPT: { code: 'FIN.OTHER_RECEIPT', system: FIN_SOURCE, docType: 'RECEIPT' },
  OTHER_PAYMENT: { code: 'FIN.OTHER_PAYMENT', system: FIN_SOURCE, docType: 'PAYMENT' },
  JOURNAL: { code: 'FIN.JOURNAL', system: FIN_SOURCE, docType: 'JOURNAL' },
  ALLOCATION: { code: 'FIN.ALLOCATION', system: FIN_SOURCE, docType: 'ALLOCATION' },
  // The opening trial balance (ADR-0102 #5), one per company, posted by the accountant's import.
  OPENING: { code: 'FIN.OPENING', system: FIN_SOURCE, docType: 'OPENING' },
  // The year close (ADR-0105 #4): income and expense into retained earnings on 31 December.
  YEAR_CLOSE: { code: 'FIN.YEAR_CLOSE', system: FIN_SOURCE, docType: 'YEAR_CLOSE' },
  SUPPLIER_BILL: { code: 'BTO.SUPPLIER_BILL', system: BTO_SOURCE, docType: 'GOODS_RECEIPT' },
  SUPPLIER_BILL_CREDIT: {
    code: 'BTO.SUPPLIER_BILL_CREDIT',
    system: BTO_SOURCE,
    docType: 'RECEIPT_RECOST',
  },
  RECEIPT_RECOST: { code: 'BTO.RECEIPT_RECOST', system: BTO_SOURCE, docType: 'RECEIPT_RECOST' },
  SUPPLIER_RETURN: { code: 'BTO.SUPPLIER_RETURN', system: BTO_SOURCE, docType: 'SUPPLIER_RETURN' },
  // F4 (ADR-0097): a stock posting's value and a receipt's revaluation, numbered by the core.
  STOCK_VALUE: { code: 'BTO.STOCK_VALUE', system: BTO_SOURCE, docType: 'STOCK' },
  STOCK_REVALUE: { code: 'BTO.STOCK_VALUE', system: BTO_SOURCE, docType: 'STOCK_REVALUE' },
} as const;

/** The stock value documents' first number format until the accountant chooses one (TODO-VERIFY, ADR-0097). */
export const STOCK_NUMBER_DEFAULT = { pattern: 'Б-{year}{month}{day}-', digits: 4 } as const;

/** The allocations' number format until the accountant chooses one (TODO-VERIFY, ADR-0090). */
export const ALLOCATION_NUMBER_DEFAULT = { pattern: 'Х-{year}{month}{day}-', digits: 4 } as const;

/** A customer's ref under source BTO; 0032_fin_foundation backfilled the same refs. */
export const customerRef = (customerId: number): string => `customer:${customerId}`;

/** The customer id of a `customer:<id>` ref, or null for another kind of ref. */
export function customerIdOfRef(ref: string): number | null {
  const match = /^customer:([0-9]+)$/.exec(ref);
  return match?.[1] === undefined ? null : Number.parseInt(match[1], 10);
}

/** A supplier's ref under source BTO (F3, ADR-0091); 0035_fin_payables backfilled the same refs. */
export const supplierRef = (supplierId: number): string => `supplier:${supplierId}`;

/** The supplier id of a `supplier:<id>` ref, or null for another kind of ref. */
export function supplierIdOfRef(ref: string): number | null {
  const match = /^supplier:([0-9]+)$/.exec(ref);
  return match?.[1] === undefined ? null : Number.parseInt(match[1], 10);
}

interface PostingKeySpec {
  code: string;
  requiredControl: FinAccountControl;
  requiresTaxCode: boolean;
}

const key = (
  code: string,
  requiredControl: FinAccountControl = 'NONE',
  requiresTaxCode = false,
): PostingKeySpec => ({ code, requiredControl, requiresTaxCode });

/**
 * One posting key per chart role of today (docs/modules/finance-core.md §5): F1's ledger posts
 * the same accounts. The tax roles are named for what the line is, not where it lands. A new
 * chart role fails typecheck here until it has a key.
 */
export const POSTING_KEY_OF_ROLE: Readonly<Record<GlRole, PostingKeySpec>> = {
  AR: key('AR', 'RECEIVABLE'),
  SALES: key('SALES'),
  SALES_DISCOUNT: key('SALES_DISCOUNT'),
  SALES_RETURN: key('SALES_RETURN'),
  VAT_PAYABLE: key('VAT_OUTPUT', 'NONE', true),
  CITY_TAX_PAYABLE: key('CITY_TAX_OUTPUT', 'NONE', true),
  // No document type uses it until the accountant answers D6 (docs/modules/finance-core.md).
  CUSTOMER_ADVANCE: key('CUSTOMER_ADVANCE', 'ADVANCE_RECEIVED'),
  CASH: key('CASH', 'MONEY'),
  BANK: key('BANK', 'MONEY'),
  OTHER_INCOME: key('OTHER_INCOME'),
  OTHER_EXPENSE: key('OTHER_EXPENSE'),
  // Neither MONEY nor RECEIVABLE: POS lines carry no money account and no party (ADR-0064).
  POS_CASH: key('POS_CASH'),
  CARD_CLEARING: key('CARD_CLEARING'),
  TRANSFER_CLEARING: key('TRANSFER_CLEARING'),
  POS_SALES: key('POS_SALES'),
  CASH_VARIANCE: key('CASH_VARIANCE'),
  // Payables (F3, ADR-0091): the supplier's bill credits AP and debits the stock and the input VAT.
  AP: key('AP', 'PAYABLE'),
  VAT_INPUT: key('VAT_INPUT', 'NONE', true),
  INVENTORY: key('INVENTORY'),
  // Stock and cost (F4, ADR-0097): every stock posting books its value against one of these.
  GOODS_RECEIVED: key('GOODS_RECEIVED'),
  COGS: key('COGS'),
  STOCK_LOSS: key('STOCK_LOSS'),
  STOCK_GAIN: key('STOCK_GAIN'),
  OPENING_STOCK: key('OPENING_STOCK'),
  ISSUE_INTERNAL: key('ISSUE_INTERNAL'),
  ISSUE_BONUS: key('ISSUE_BONUS'),
  ISSUE_MARKETING: key('ISSUE_MARKETING'),
  ISSUE_WRITE_OFF: key('ISSUE_WRITE_OFF'),
  ISSUE_TRANSFER_OUT: key('ISSUE_TRANSFER_OUT'),
  ISSUE_OTHER: key('ISSUE_OTHER'),
  // The year close (F6, ADR-0105): the profit or loss of a year closes into it.
  RETAINED_EARNINGS: key('RETAINED_EARNINGS'),
};

/** The key of a typed journal line: the accountant names the account (F2, ADR-0090). */
export const MANUAL_KEY = 'MANUAL';

/** The roles whose accounts reduce income: debit-normal although their kind is INCOME. */
const CONTRA_INCOME_ROLES: ReadonlySet<GlRole> = new Set(['SALES_RETURN', 'SALES_DISCOUNT']);

/** The role of each posting key (the inverse of POSTING_KEY_OF_ROLE). */
export const ROLE_OF_POSTING_KEY: ReadonlyMap<string, GlRole> = new Map(
  (Object.entries(POSTING_KEY_OF_ROLE) as [GlRole, PostingKeySpec][]).map(([role, spec]) => [
    spec.code,
    role,
  ]),
);

/**
 * The chart an empty company starts from (ADR-0089; the core never re-seeds a chart with accounts):
 * today's default accounts named from mn.json, each role's account mapped by its posting key.
 */
export function btoChartTemplate(): FinChartTemplateAccount[] {
  const names: Record<string, string> = mn.finance.seedAccounts;
  return DEFAULT_GL_ACCOUNTS.map((account) => ({
    code: account.code,
    name: names[account.code] ?? account.code,
    kind: account.kind,
    normalSide:
      account.kind === 'ASSET' ||
      account.kind === 'EXPENSE' ||
      (account.role !== null && CONTRA_INCOME_ROLES.has(account.role))
        ? 'DEBIT'
        : 'CREDIT',
    control: account.role === null ? 'NONE' : POSTING_KEY_OF_ROLE[account.role].requiredControl,
    key: account.role === null ? null : POSTING_KEY_OF_ROLE[account.role].code,
  }));
}

/**
 * What this installation books into (ADR-0084 #1): company `companyCode` of tenant BUTEN_ORGIL,
 * sources BTO and FIN, the posting keys, the legacy party, and Bto's branches, of which only ACTIVE
 * ones are mapped. The legal name is a first value only: the owner keeps it on «Компани».
 */
export function btoInstallationSpec(input: {
  companyCode: string;
  branches: readonly Pick<Branch, 'id' | 'code' | 'name' | 'status'>[];
}): FinInstallationSpec {
  return {
    tenant: { code: BTO_TENANT, name: 'Бүтэн-Оргил групп' },
    company: {
      code: input.companyCode,
      legalName: input.companyCode === 'BO' ? 'Бүтэн-Оргил ХХК' : input.companyCode,
      timezone: 'Asia/Ulaanbaatar',
      functionalCurrency: 'MNT',
    },
    sources: [
      { code: BTO_SOURCE, linkTemplate: null },
      { code: FIN_SOURCE, linkTemplate: null },
    ],
    postingKeys: [...Object.values(POSTING_KEY_OF_ROLE), key(MANUAL_KEY)],
    legacyParty: { system: FIN_SOURCE, ref: LEGACY_PARTY_REF, name: LEGACY_PARTY_REF },
    numberSeries: [
      { code: 'PAYMENT', ...FINANCE_NUMBER_DEFAULTS.PAYMENT },
      { code: 'JOURNAL', ...FINANCE_NUMBER_DEFAULTS.JOURNAL },
      { code: 'ALLOCATION', ...ALLOCATION_NUMBER_DEFAULT },
      { code: 'STOCK', ...STOCK_NUMBER_DEFAULT },
    ],
    documentTypes: [
      {
        code: FIN_DOC_TYPES.SALES_INVOICE.code,
        system: BTO_SOURCE,
        class: 'AR_INVOICE',
        numberMode: 'SOURCE',
        numberSeries: null,
      },
      {
        code: FIN_DOC_TYPES.SALES_RETURN.code,
        system: BTO_SOURCE,
        class: 'AR_CREDIT',
        numberMode: 'SOURCE',
        numberSeries: null,
      },
      {
        code: FIN_DOC_TYPES.CUSTOMER_RECEIPT.code,
        system: FIN_SOURCE,
        class: 'RECEIPT',
        numberMode: 'CORE',
        numberSeries: 'PAYMENT',
      },
      {
        code: FIN_DOC_TYPES.CUSTOMER_REFUND.code,
        system: FIN_SOURCE,
        class: 'PAYMENT',
        numberMode: 'CORE',
        numberSeries: 'PAYMENT',
      },
      {
        code: FIN_DOC_TYPES.OTHER_RECEIPT.code,
        system: FIN_SOURCE,
        class: 'RECEIPT',
        numberMode: 'CORE',
        numberSeries: 'PAYMENT',
      },
      {
        code: FIN_DOC_TYPES.OTHER_PAYMENT.code,
        system: FIN_SOURCE,
        class: 'PAYMENT',
        numberMode: 'CORE',
        numberSeries: 'PAYMENT',
      },
      {
        code: FIN_DOC_TYPES.JOURNAL.code,
        system: FIN_SOURCE,
        class: 'JOURNAL',
        numberMode: 'CORE',
        numberSeries: 'JOURNAL',
      },
      {
        code: FIN_DOC_TYPES.ALLOCATION.code,
        system: FIN_SOURCE,
        class: 'ALLOCATION',
        numberMode: 'CORE',
        numberSeries: 'ALLOCATION',
      },
      {
        code: FIN_DOC_TYPES.OPENING.code,
        system: FIN_SOURCE,
        class: 'OPENING',
        numberMode: 'CORE',
        numberSeries: 'JOURNAL',
      },
      {
        code: FIN_DOC_TYPES.YEAR_CLOSE.code,
        system: FIN_SOURCE,
        class: 'JOURNAL',
        numberMode: 'CORE',
        numberSeries: 'JOURNAL',
      },
      ...(
        [
          [FIN_DOC_TYPES.SUPPLIER_BILL.code, 'AP_BILL'],
          [FIN_DOC_TYPES.SUPPLIER_BILL_CREDIT.code, 'AP_CREDIT'],
          [FIN_DOC_TYPES.RECEIPT_RECOST.code, 'JOURNAL'],
          [FIN_DOC_TYPES.SUPPLIER_RETURN.code, 'AP_CREDIT'],
        ] as const
      ).map(([code, docClass]) => ({
        code,
        system: BTO_SOURCE,
        class: docClass,
        numberMode: 'SOURCE' as const,
        numberSeries: null,
      })),
      {
        code: FIN_DOC_TYPES.STOCK_VALUE.code,
        system: BTO_SOURCE,
        class: 'JOURNAL',
        numberMode: 'CORE',
        numberSeries: 'STOCK',
      },
    ],
    branches: input.branches.map((branch) => ({
      system: BTO_SOURCE,
      externalId: String(branch.id),
      code: branch.code,
      name: branch.name,
      active: branch.status === 'ACTIVE',
    })),
  };
}
