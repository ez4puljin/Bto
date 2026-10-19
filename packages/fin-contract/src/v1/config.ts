import { z } from 'zod';
import {
  CodeSchema,
  type Dec,
  DecSchema,
  type IsoDate,
  IsoDateSchema,
  text,
  V1_LIMITS,
} from './primitives';

/**
 * The configuration port's messages, `fin.config/1` (docs/modules/finance-core.md §8): accounts,
 * document types, posting rules, tax codes and rates reach the core as data, never as code
 * (ADR-0072, ADR-0074 #1). Draft until P3 builds `FinConfig`; frozen when A2 publishes the package.
 */

export const ACCOUNT_KINDS = ['ASSET', 'LIABILITY', 'EQUITY', 'INCOME', 'EXPENSE'] as const;
export type AccountKindV1 = (typeof ACCOUNT_KINDS)[number];

/** What an account must carry on every line: a party (party controls) or a money account. */
export const ACCOUNT_CONTROLS = [
  'NONE',
  'RECEIVABLE',
  'PAYABLE',
  'ADVANCE_RECEIVED',
  'ADVANCE_PAID',
  'MONEY',
] as const;
export type AccountControl = (typeof ACCOUNT_CONTROLS)[number];

/** The closed set of classes the engine knows (ADR-0072); document types are rows of a class. */
export const DOCUMENT_CLASSES = [
  'AR_INVOICE',
  'AR_CREDIT',
  'RECEIPT',
  'PAYMENT',
  'ALLOCATION',
  'SETTLEMENT',
  'JOURNAL',
  'OPENING',
  'AP_BILL',
  'AP_CREDIT',
] as const;
export type DocumentClass = (typeof DOCUMENT_CLASSES)[number];

export const MONEY_ACCOUNT_KINDS = ['CASH', 'BANK', 'CLEARING'] as const;
export type MoneyAccountKind = (typeof MONEY_ACCOUNT_KINDS)[number];

export const CONFIG_STATUSES = ['ACTIVE', 'INACTIVE'] as const;
export type ConfigStatus = (typeof CONFIG_STATUSES)[number];

export interface AccountV1 {
  company: string;
  code: string;
  name: string;
  parent?: string | null;
  isGroup: boolean;
  kind: AccountKindV1;
  normalSide: 'DEBIT' | 'CREDIT';
  control: AccountControl;
  /** On the drain report: a clearing balance that must empty (ADR-0072). */
  drains: boolean;
  status: ConfigStatus;
}

export interface DocumentTypeV1 {
  company: string;
  code: string;
  sourceSystem: string;
  class: DocumentClass;
  /** SOURCE: the sender's number is kept; CORE: the core numbers from its series. */
  numberMode: 'SOURCE' | 'CORE';
  numberSeries?: string | null;
  /** Where an unapplied remainder goes; null keeps it as an open item (D6). */
  unappliedKey?: string | null;
  requiresApproval: boolean;
  allowedInSoftClose: boolean;
  /** The posting keys it uses; it turns ACTIVE only when each has a rule (the coverage check). */
  keys: string[];
}

export interface PostingRuleV1 {
  company: string;
  postingKey: string;
  documentType?: string | null;
  sourceSystem?: string | null;
  branch?: string | null;
  account: string;
  effectiveFrom: IsoDate;
}

export interface TaxCodeV1 {
  company: string;
  code: string;
  /** A kind of the localisation layer, e.g. VAT or CITY_TAX in `@tugeel/shared/mn`. */
  kind: string;
  outKey: string;
  inKey?: string | null;
}

export interface TaxRateV1 {
  company: string;
  code: string;
  effectiveFrom: IsoDate;
  ratePct: Dec;
}

export interface CoverageReportV1 {
  company: string;
  documentType: string;
  active: boolean;
  missing: { key: string; branch: string | null }[];
}

export const AccountV1Schema: z.ZodType<AccountV1> = z.strictObject({
  company: CodeSchema,
  code: CodeSchema,
  name: text(V1_LIMITS.maxName),
  parent: CodeSchema.nullable().optional(),
  isGroup: z.boolean(),
  kind: z.enum(ACCOUNT_KINDS),
  normalSide: z.enum(['DEBIT', 'CREDIT']),
  control: z.enum(ACCOUNT_CONTROLS),
  drains: z.boolean(),
  status: z.enum(CONFIG_STATUSES),
});

export const DocumentTypeV1Schema: z.ZodType<DocumentTypeV1> = z.strictObject({
  company: CodeSchema,
  code: CodeSchema,
  sourceSystem: CodeSchema,
  class: z.enum(DOCUMENT_CLASSES),
  numberMode: z.enum(['SOURCE', 'CORE']),
  numberSeries: CodeSchema.nullable().optional(),
  unappliedKey: CodeSchema.nullable().optional(),
  requiresApproval: z.boolean(),
  allowedInSoftClose: z.boolean(),
  keys: z.array(CodeSchema).max(50),
});

export const PostingRuleV1Schema: z.ZodType<PostingRuleV1> = z.strictObject({
  company: CodeSchema,
  postingKey: CodeSchema,
  documentType: CodeSchema.nullable().optional(),
  sourceSystem: CodeSchema.nullable().optional(),
  branch: CodeSchema.nullable().optional(),
  account: CodeSchema,
  effectiveFrom: IsoDateSchema,
});

export const TaxCodeV1Schema: z.ZodType<TaxCodeV1> = z.strictObject({
  company: CodeSchema,
  code: CodeSchema,
  kind: CodeSchema,
  outKey: CodeSchema,
  inKey: CodeSchema.nullable().optional(),
});

export const TaxRateV1Schema: z.ZodType<TaxRateV1> = z.strictObject({
  company: CodeSchema,
  code: CodeSchema,
  effectiveFrom: IsoDateSchema,
  ratePct: DecSchema.regex(/^(100(\.0{1,2})?|\d{1,2}(\.\d{1,2})?)$/, 'a rate from 0 to 100'),
});
