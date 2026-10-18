import type { AccountKindV1, MoneyAccountKind } from './config';
import type { IntakeErrorV1, IntakeOutcome, SourceKey } from './intake';
import type { Dec, IsoDate, Side } from './primitives';

/**
 * What the read port returns (docs/modules/finance-core.md §8): in-process now, the same shapes
 * over HTTP from A2. Amounts are decimal strings, ids strings. Draft until P3 builds `FinReader`
 * (only `ExposureV1` and the tax position are fixed by the design); frozen when A2 publishes.
 */

/** A keyset page (ADR-0004 #3). */
export interface PageV1<T> {
  data: T[];
  nextCursor: string | null;
}

/** A party as a source system knows it (`customer:412`). */
export interface PartyRefV1 {
  system: string;
  ref: string;
}

/** Live in the company's timezone; the credit policy reads it (ADR-0073). */
export interface ExposureV1 {
  receivableOpen: Dec;
  creditsOpen: Dec;
  net: Dec;
  overdue: Dec;
  oldestDueDate: IsoDate | null;
}

export interface OpenItemV1 {
  id: string;
  party: PartyRefV1 | null;
  account: string;
  side: Side;
  document: { source: SourceKey; number: string };
  lineNo: number;
  itemRef: string | null;
  groupRef: string | null;
  itemDate: IsoDate;
  dueDate: IsoDate | null;
  amount: Dec;
  openAmount: Dec;
}

export interface StatementLineV1 {
  date: IsoDate;
  documentNumber: string;
  source: SourceKey;
  description: string;
  debit: Dec;
  credit: Dec;
  balance: Dec;
}

export interface StatementV1 {
  party: PartyRefV1;
  from: IsoDate;
  to: IsoDate;
  opening: Dec;
  lines: StatementLineV1[];
  closing: Dec;
}

export interface TbRowV1 {
  account: string;
  name: string;
  kind: AccountKindV1;
  openingDebit: Dec;
  openingCredit: Dec;
  debit: Dec;
  credit: Dec;
  closingDebit: Dec;
  closingCredit: Dec;
}

export interface LedgerLineV1 {
  entryNumber: string;
  date: IsoDate;
  lineNo: number;
  description: string;
  debit: Dec;
  credit: Dec;
  balance: Dec;
  party: PartyRefV1 | null;
  branch: string | null;
  source: SourceKey | null;
}

export interface DocumentV1 {
  id: string;
  type: string;
  number: string;
  source: SourceKey;
  documentDate: IsoDate;
  accountingDate: IsoDate;
  period: string;
  amount: Dec;
  party: PartyRefV1 | null;
  journalNo: string | null;
  reversed: boolean;
  postedAt: string;
}

export interface SourceKeyStatusV1 {
  source: SourceKey;
  status: 'POSTED' | 'HELD' | 'REJECTED' | 'CANCELLED';
  number: string | null;
}

/** A row of the pending and failed list (ADR-0071 #12). */
export interface IntakeV1 {
  source: SourceKey;
  action: 'POST' | 'REVERSE';
  status: Extract<IntakeOutcome, 'HELD' | 'REJECTED'>;
  docNo: string | null;
  errors: IntakeErrorV1[];
  attempts: number;
  firstAt: string;
  lastAt: string;
}

/** The last posting per source system (`fin_ctl.freshness`). */
export interface FreshnessV1 {
  sources: { system: string; lastPostedAt: string | null }[];
}

export interface TaxPositionV1 {
  registrations: { taxKind: string; registered: boolean; activityCode: string | null }[];
  rates: { code: string; ratePct: Dec }[];
}

export interface MoneyAccountV1 {
  id: string;
  code: string;
  name: string;
  kind: MoneyAccountKind;
  branch: string | null;
  account: string;
  status: 'ACTIVE' | 'INACTIVE';
}
