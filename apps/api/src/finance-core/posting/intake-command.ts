import { createHash } from 'node:crypto';
import {
  type FinPermission,
  type IntakeCommandV1,
  IntakeCommandV1Schema,
  type LineV1,
  type PostBody,
} from '@tugeel/fin-contract';
import { Decimal } from '@tugeel/shared/money';
import { canonicalJson } from '../../common/json/canonical';
import { FinError } from '../errors';
import type { FIN_DOCUMENT_CLASSES } from '../schema';

export type FinDocumentClass = (typeof FIN_DOCUMENT_CLASSES)[number];

/** The right a USER needs per class (docs/modules/finance-core.md §13); a SOURCE needs its grant. */
export const RIGHT_OF_CLASS: Readonly<Record<FinDocumentClass, FinPermission>> = {
  AR_INVOICE: 'finance.invoices.manage',
  AR_CREDIT: 'finance.invoices.manage',
  RECEIPT: 'finance.payments.record',
  PAYMENT: 'finance.payments.record',
  ALLOCATION: 'finance.payments.record',
  SETTLEMENT: 'finance.payments.record',
  JOURNAL: 'finance.journal.manage',
  OPENING: 'finance.journal.manage',
  AP_BILL: 'finance.payments.record',
  AP_CREDIT: 'finance.payments.record',
};

/** Every right that may post some class: a USER needs one of them to reach the company at all. */
export const POSTING_RIGHTS: readonly FinPermission[] = [...new Set(Object.values(RIGHT_OF_CLASS))];

const money = (value: string): string => new Decimal(value).toFixed(2);

function normalizeLine(line: LineV1): LineV1 {
  return {
    ...line,
    amount: money(line.amount),
    ...(line.tax
      ? { tax: { ...line.tax, base: money(line.tax.base), lineCount: line.tax.lineCount ?? 1 } }
      : {}),
    ...(line.settles && line.settles !== 'FIFO'
      ? {
          settles: line.settles.map((target) =>
            target.amount === undefined ? target : { ...target, amount: money(target.amount) },
          ),
        }
      : {}),
  };
}

/**
 * Parses a command with the schema of its major version and applies the defaults (ADR-0071 #2):
 * revision 1, `accountingDate = documentDate`, decimals at scale 2, a tax line counted once. The
 * header party is put on party-control lines when the accounts are known (it is not hashed apart).
 */
export function parseCommand(raw: unknown): IntakeCommandV1 {
  const parsed = IntakeCommandV1Schema.safeParse(raw);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    throw new FinError('FIN_PAYLOAD_INVALID', issue?.message, {
      path: issue?.path.join('.') ?? '',
    });
  }
  const cmd = parsed.data;
  const source = { ...cmd.source, revision: cmd.source.revision ?? 1 };
  if (cmd.body.action === 'REVERSE') return { ...cmd, source };
  const body: PostBody = {
    ...cmd.body,
    accountingDate: cmd.body.accountingDate ?? cmd.body.documentDate,
    controlTotal: money(cmd.body.controlTotal),
    lines: cmd.body.lines.map(normalizeLine),
    ...(cmd.body.allocate
      ? {
          allocate: {
            ...cmd.body.allocate,
            pairs: cmd.body.allocate.pairs.map((pair) => ({ ...pair, amount: money(pair.amount) })),
          },
        }
      : {}),
  };
  return { ...cmd, source, body };
}

/** SHA-256 of the canonical command without its transmission id and its actor (ADR-0071 #2). */
export function hashCommand(cmd: IntakeCommandV1): string {
  const { commandId: _commandId, actor: _actor, contract: _contract, ...hashed } = cmd;
  return createHash('sha256').update(canonicalJson(hashed)).digest('hex');
}
