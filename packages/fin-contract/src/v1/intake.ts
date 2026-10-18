import { z } from 'zod';
import type { FinErrorCode } from '../errors';
import {
  CodeSchema,
  CurrencySchema,
  type Dec,
  DecSchema,
  type IsoDate,
  IsoDateSchema,
  NonNegativeDecSchema,
  PositiveDecSchema,
  RefSchema,
  type Side,
  SideSchema,
  text,
  V1_LIMITS,
} from './primitives';

/**
 * The intake contract `fin.intake/1.x` (ADR-0071, docs/modules/finance-core.md §6): the one command
 * every source system sends the Finance Core and the result it gets back. The schemas parse
 * strictly (an unknown field is refused); the defaults (revision 1, `accountingDate =
 * documentDate`, the header party on party-control lines), the decimals at scale 2 and the hash are
 * the engine's (P3). Every fixture in `fixtures/intake/1.0` parses forever.
 */

export type ContractV1 = `fin.intake/1.${number}`;
export const CONTRACT_V1_PATTERN = /^fin\.intake\/1\.(0|[1-9]\d{0,3})$/;

/** A source system's document: the business identity of what it sends (ADR-0071 #2). */
export interface SourceKey {
  system: string;
  docType: string;
  docId: string;
  /** Default 1. */
  revision?: number;
}

export const PARTY_KINDS = ['COMPANY', 'INDIVIDUAL', 'EMPLOYEE', 'TAX_AUTHORITY', 'OTHER'] as const;
export type PartyKind = (typeof PARTY_KINDS)[number];

/**
 * A party as the source knows it; inserted on first sight, later names follow `FinConfig`.
 * INTERNAL parties are created only through `FinConfig` with their company link.
 */
export interface PartyIn {
  ref: string;
  name: string;
  kind: PartyKind;
  tin?: string;
  registerNo?: string;
}

/** Who did it: attribution only, never authorisation (ADR-0071 #7). */
export interface FinActor {
  kind: 'STAFF' | 'SOURCE' | 'SYSTEM';
  ref: string;
  label: string;
}

export interface IntakeCommandV1 {
  contract: ContractV1;
  /** uuid v7: the transmission's identity, echoed back; not hashed. */
  commandId: string;
  /** Codes; part of the hash. */
  tenant: string;
  company: string;
  /** For REVERSE, the target's key. */
  source: SourceKey & { docNo?: string };
  actor: FinActor;
  body: PostBody | ReverseBody;
}

export interface PostBody {
  action: 'POST';
  documentType: string;
  documentDate: IsoDate;
  accountingDate?: IsoDate;
  /** v1: must equal the company's functional currency. */
  currency: string;
  branch?: string;
  party?: PartyIn;
  dueDate?: IsoDate;
  description: string;
  /** Σ debit = Σ credit = controlTotal; for ALLOCATION Σ pairs[].amount. */
  controlTotal: Dec;
  /** 2..500; empty for class ALLOCATION. */
  lines: LineV1[];
  /** Class ALLOCATION only, required there. */
  allocate?: AllocateV1;
  /** At most 20 keys (orderNumber, folio, handedInBy). */
  attributes?: Record<string, string>;
}

export type SettleTarget = SourceKey | { groupRef: string } | { itemId: string };

export interface LineV1 {
  lineNo: number;
  key: string;
  side: Side;
  /** Above zero. */
  amount: Dec;
  /** Source FIN only. */
  accountCode?: string;
  description?: string;
  sourceLineRef?: string;
  /** `lineCount` ≤ 500; the base is the sender's responsibility. */
  tax?: { code: string; base: Dec; lineCount?: number };
  moneyAccount?: string;
  /** The header party by default on party-control keys. */
  party?: PartyIn;
  openItem?: { dueDate?: IsoDate; itemDate?: IsoDate; itemRef?: string; groupRef?: string };
  settles?: 'FIFO' | Array<{ target: SettleTarget; amount?: Dec }>;
  analyticRef?: string;
}

/** Pairs open items that already exist; posts no journal entry. */
export interface AllocateV1 {
  /** The party-control key whose account holds both items (AR, AP). */
  key: string;
  /** 1..200, each amount above zero. */
  pairs: Array<{ debit: ItemRefV1; credit: ItemRefV1; amount: Dec }>;
}

export type ItemRefV1 = { itemId: string } | { source: SourceKey; lineNo?: number };

export interface ReverseBody {
  action: 'REVERSE';
  accountingDate?: IsoDate;
  reason: string;
}

export const INTAKE_OUTCOMES = [
  'POSTED',
  'DUPLICATE',
  'CANCELLED',
  'HELD',
  'REJECTED',
  'CONFLICT',
] as const;
export type IntakeOutcome = (typeof INTAKE_OUTCOMES)[number];

/** A code from FIN_ERROR_CODES, or a newer one this client does not know (treated as permanent). */
export type FinErrorCodeV1 = FinErrorCode | (string & Record<never, never>);

export interface IntakeErrorV1 {
  code: FinErrorCodeV1;
  params: Record<string, string | number | null>;
  path?: string;
}

export interface IntakeResultV1 {
  contract: 'fin.intake/1';
  commandId: string;
  source: SourceKey;
  action: 'POST' | 'REVERSE';
  outcome: IntakeOutcome;
  document?: {
    id: string;
    number: string;
    journalNo: string | null;
    amount: Dec;
    accountingDate: IsoDate;
    period: string;
    reversed: boolean;
    lines: { lineNo: number; account: string; ruleId: string | null; side: Side; amount: Dec }[];
    openItems: { id: string; key: string; side: Side; amount: Dec; openAmount: Dec }[];
    allocations: { debitItemId: string; creditItemId: string; amount: Dec }[];
  };
  errors?: IntakeErrorV1[];
  retryable?: boolean;
}

// ---- schemas ---------------------------------------------------------------------------------

export const SourceKeySchema: z.ZodType<SourceKey> = z.strictObject({
  system: CodeSchema,
  docType: CodeSchema,
  docId: RefSchema,
  revision: z.int().min(1).max(V1_LIMITS.maxRevision).optional(),
});

const SourceSchema = z.strictObject({
  system: CodeSchema,
  docType: CodeSchema,
  docId: RefSchema,
  revision: z.int().min(1).max(V1_LIMITS.maxRevision).optional(),
  docNo: text(V1_LIMITS.maxDocNo).optional(),
});

export const PartyInSchema: z.ZodType<PartyIn> = z.strictObject({
  ref: RefSchema,
  name: text(V1_LIMITS.maxName),
  kind: z.enum(PARTY_KINDS),
  tin: text(V1_LIMITS.maxTaxId).optional(),
  registerNo: text(V1_LIMITS.maxTaxId).optional(),
});

export const FinActorSchema: z.ZodType<FinActor> = z.strictObject({
  kind: z.enum(['STAFF', 'SOURCE', 'SYSTEM']),
  ref: RefSchema,
  label: text(V1_LIMITS.maxLabel),
});

const SettleTargetSchema: z.ZodType<SettleTarget> = z.union([
  SourceKeySchema,
  z.strictObject({ groupRef: RefSchema }),
  z.strictObject({ itemId: RefSchema }),
]);

export const LineV1Schema: z.ZodType<LineV1> = z.strictObject({
  lineNo: z.int().min(1).max(V1_LIMITS.maxLines),
  key: CodeSchema,
  side: SideSchema,
  amount: PositiveDecSchema,
  accountCode: CodeSchema.optional(),
  description: text(V1_LIMITS.maxDescription).optional(),
  sourceLineRef: RefSchema.optional(),
  tax: z
    .strictObject({
      code: CodeSchema,
      base: DecSchema,
      lineCount: z.int().min(1).max(V1_LIMITS.maxLines).optional(),
    })
    .optional(),
  moneyAccount: CodeSchema.optional(),
  party: PartyInSchema.optional(),
  openItem: z
    .strictObject({
      dueDate: IsoDateSchema.optional(),
      itemDate: IsoDateSchema.optional(),
      itemRef: RefSchema.optional(),
      groupRef: RefSchema.optional(),
    })
    .optional(),
  settles: z
    .union([
      z.literal('FIFO'),
      z
        .array(z.strictObject({ target: SettleTargetSchema, amount: PositiveDecSchema.optional() }))
        .min(1)
        .max(V1_LIMITS.maxSettles),
    ])
    .optional(),
  analyticRef: RefSchema.optional(),
});

export const ItemRefV1Schema: z.ZodType<ItemRefV1> = z.union([
  z.strictObject({ itemId: RefSchema }),
  z.strictObject({
    source: SourceKeySchema,
    lineNo: z.int().min(1).max(V1_LIMITS.maxLines).optional(),
  }),
]);

export const AllocateV1Schema: z.ZodType<AllocateV1> = z.strictObject({
  key: CodeSchema,
  pairs: z
    .array(
      z.strictObject({
        debit: ItemRefV1Schema,
        credit: ItemRefV1Schema,
        amount: PositiveDecSchema,
      }),
    )
    .min(1)
    .max(V1_LIMITS.maxPairs),
});

const PostBodySchema = z
  .strictObject({
    action: z.literal('POST'),
    documentType: CodeSchema,
    documentDate: IsoDateSchema,
    accountingDate: IsoDateSchema.optional(),
    currency: CurrencySchema,
    branch: CodeSchema.optional(),
    party: PartyInSchema.optional(),
    dueDate: IsoDateSchema.optional(),
    description: text(V1_LIMITS.maxDescription),
    controlTotal: NonNegativeDecSchema,
    lines: z.array(LineV1Schema).max(V1_LIMITS.maxLines),
    allocate: AllocateV1Schema.optional(),
    attributes: z.record(CodeSchema, text(V1_LIMITS.maxAttributeValue)).optional(),
  })
  .superRefine((body, ctx) => {
    if (body.allocate) {
      if (body.lines.length > 0) {
        ctx.addIssue({ code: 'custom', path: ['lines'], message: 'an allocation has no lines' });
      }
    } else if (body.lines.length < 2) {
      ctx.addIssue({ code: 'custom', path: ['lines'], message: 'at least 2 lines' });
    }
    const seen = new Set<number>();
    body.lines.forEach((line, index) => {
      if (seen.has(line.lineNo)) {
        ctx.addIssue({ code: 'custom', path: ['lines', index, 'lineNo'], message: 'repeated' });
      }
      seen.add(line.lineNo);
    });
    if (body.attributes && Object.keys(body.attributes).length > V1_LIMITS.maxAttributes) {
      ctx.addIssue({
        code: 'custom',
        path: ['attributes'],
        message: `at most ${V1_LIMITS.maxAttributes} attributes`,
      });
    }
  });

const ReverseBodySchema = z.strictObject({
  action: z.literal('REVERSE'),
  accountingDate: IsoDateSchema.optional(),
  reason: text(V1_LIMITS.maxReason),
});

export const IntakeCommandV1Schema: z.ZodType<IntakeCommandV1> = z.strictObject({
  contract: z.custom<ContractV1>(
    (value) => typeof value === 'string' && CONTRACT_V1_PATTERN.test(value),
    'contract fin.intake/1.<minor>',
  ),
  commandId: z.uuidv7(),
  tenant: CodeSchema,
  company: CodeSchema,
  source: SourceSchema,
  actor: FinActorSchema,
  body: z.discriminatedUnion('action', [PostBodySchema, ReverseBodySchema]),
});

/** Results parse loosely: a client ignores the fields a newer server adds (ADR-0071 #11). */
export const IntakeResultV1Schema: z.ZodType<IntakeResultV1> = z.object({
  contract: z.literal('fin.intake/1'),
  commandId: z.string(),
  source: z.object({
    system: z.string(),
    docType: z.string(),
    docId: z.string(),
    revision: z.int().optional(),
  }),
  action: z.enum(['POST', 'REVERSE']),
  outcome: z.enum(INTAKE_OUTCOMES),
  document: z
    .object({
      id: z.string(),
      number: z.string(),
      journalNo: z.string().nullable(),
      amount: DecSchema,
      accountingDate: IsoDateSchema,
      period: z.string(),
      reversed: z.boolean(),
      lines: z.array(
        z.object({
          lineNo: z.int(),
          account: z.string(),
          ruleId: z.string().nullable(),
          side: SideSchema,
          amount: DecSchema,
        }),
      ),
      openItems: z.array(
        z.object({
          id: z.string(),
          key: z.string(),
          side: SideSchema,
          amount: DecSchema,
          openAmount: DecSchema,
        }),
      ),
      allocations: z.array(
        z.object({ debitItemId: z.string(), creditItemId: z.string(), amount: DecSchema }),
      ),
    })
    .optional(),
  errors: z
    .array(
      z.object({
        code: z.string(),
        params: z.record(z.string(), z.union([z.string(), z.number(), z.null()])),
        path: z.string().optional(),
      }),
    )
    .optional(),
  retryable: z.boolean().optional(),
});
