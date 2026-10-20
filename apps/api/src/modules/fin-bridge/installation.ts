import { DEFAULT_GL_ACCOUNTS, type GlRole } from '@tugeel/shared/finance';
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

/** A customer's ref under source BTO; 0032_fin_foundation backfilled the same refs. */
export const customerRef = (customerId: number): string => `customer:${customerId}`;

/** The customer id of a `customer:<id>` ref, or null for another kind of ref. */
export function customerIdOfRef(ref: string): number | null {
  const match = /^customer:([0-9]+)$/.exec(ref);
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
  POS_SALES: key('POS_SALES'),
  CASH_VARIANCE: key('CASH_VARIANCE'),
};

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
    postingKeys: Object.values(POSTING_KEY_OF_ROLE),
    legacyParty: { system: FIN_SOURCE, ref: LEGACY_PARTY_REF, name: LEGACY_PARTY_REF },
    branches: input.branches.map((branch) => ({
      system: BTO_SOURCE,
      externalId: String(branch.id),
      code: branch.code,
      name: branch.name,
      active: branch.status === 'ACTIVE',
    })),
  };
}
