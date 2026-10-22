import { Injectable } from '@nestjs/common';
import type { GlRole } from '@tugeel/shared/finance';
import mn from '@tugeel/shared/i18n/mn.json';
import { Decimal } from '@tugeel/shared/money';
import type { Tx } from '../../../common/db/db.types';
import { BTO_SOURCE, FIN_DOC_TYPES } from '../../fin-bridge';
import type { Actor } from '../../identity';
import type {
  StockBookKind,
  StockBooks,
  StockPostedFacts,
  StockRevaluedFacts,
} from '../../inventory';
import { FinBooks } from './fin-books';
import { FinPosting } from './fin-posting';
import { controlTotal, intakeLines, type RoleLine } from './intake-lines';

const ZERO = new Decimal(0);

/** The counter account of each kind of stock line (F4, ADR-0097; TODO-VERIFY D8). */
const ROLE_OF_KIND: Readonly<Record<Exclude<StockBookKind, 'ISSUE'>, GlRole>> = {
  RECEIPT: 'GOODS_RECEIVED',
  SALE: 'COGS',
  SALE_RETURN: 'COGS',
  LOSS: 'STOCK_LOSS',
  GAIN: 'STOCK_GAIN',
  OPENING: 'OPENING_STOCK',
};

/** A goods-issue expense type's account (ADR-0081's seeded codes); an admin-added type: OTHER. */
const ROLE_OF_ISSUE_TYPE: Readonly<Record<string, GlRole>> = {
  INTERNAL_USE: 'ISSUE_INTERNAL',
  BONUS: 'ISSUE_BONUS',
  MARKETING: 'ISSUE_MARKETING',
  WRITE_OFF: 'ISSUE_WRITE_OFF',
  TRANSFER_OUT: 'ISSUE_TRANSFER_OUT',
};

/** What each stock document is called in an entry's description (mn.json). */
const LABELS: Readonly<Record<string, string>> = mn.finance.stockBooks;

/**
 * The stock's value in the books (F4, ADR-0097), bound as inventory's STOCK_BOOKS and posted through
 * the Finance Core's intake inside the stock posting's transaction, as source BTO with the staff
 * member as the actor (a refusal rolls the posting back; a till's sale is parked as any refusal):
 * - every posting of a stock document → `BTO/STOCK/<docType>:<docId>:<first ledger row>`, a JOURNAL
 *   of type BTO.STOCK_VALUE: the change of INVENTORY against the kind's account — goods received
 *   (cleared by the supplier's bill, F3), the cost of goods sold or returned, a loss or a gain, the
 *   opening stock's offset, an expense type's account;
 * - a receipt's costing → `BTO/STOCK_REVALUE/<receipt>:<version>`: what moved the stock's value on
 *   INVENTORY, what had already left on COGS, against goods received.
 * So INVENTORY follows the stock's value, and goods received holds what is received but not billed.
 */
@Injectable()
export class StockBooksService implements StockBooks {
  constructor(
    private readonly intake: FinPosting,
    private readonly books: FinBooks,
  ) {}

  async stockPostedInTx(tx: Tx, actor: Actor, facts: StockPostedFacts): Promise<void> {
    const lines: RoleLine[] = [];
    let stock = ZERO;
    for (const line of facts.lines) {
      stock = stock.plus(line.value);
      const role =
        line.kind === 'ISSUE'
          ? (ROLE_OF_ISSUE_TYPE[line.issueType ?? ''] ?? 'ISSUE_OTHER')
          : ROLE_OF_KIND[line.kind];
      lines.push(opposite(role, line.value));
    }
    lines.unshift(signed('INVENTORY', stock));
    const label = LABELS[facts.docType] ?? facts.docType;
    await this.post(tx, actor, {
      docType: FIN_DOC_TYPES.STOCK_VALUE.docType,
      docId: `${facts.docType}:${facts.docId}:${facts.firstLedgerId}`,
      date: facts.date,
      description: `${label} ${facts.number ?? `#${facts.docId}`}`,
      lines,
    });
  }

  async stockRevaluedInTx(tx: Tx, actor: Actor, facts: StockRevaluedFacts): Promise<void> {
    await this.post(tx, actor, {
      docType: FIN_DOC_TYPES.STOCK_REVALUE.docType,
      docId: `${facts.receiptId}:${facts.version}`,
      date: facts.date,
      description: `${LABELS.revalue ?? 'GR'} ${facts.number ?? `#${facts.receiptId}`}/${facts.version}`,
      lines: [
        signed('INVENTORY', facts.absorbed),
        signed('COGS', facts.variance),
        opposite('GOODS_RECEIVED', facts.absorbed.plus(facts.variance)),
      ],
    });
  }

  private async post(
    tx: Tx,
    actor: Actor,
    doc: { docType: string; docId: string; date: string; description: string; lines: RoleLine[] },
  ): Promise<void> {
    const lines = doc.lines.filter((line) => !(line.debit.isZero() && line.credit.isZero()));
    if (lines.length < 2) return;
    await this.intake.submitInTx(tx, this.books.source(actor), {
      source: { system: BTO_SOURCE, docType: doc.docType, docId: doc.docId },
      body: {
        action: 'POST',
        documentType: FIN_DOC_TYPES.STOCK_VALUE.code,
        documentDate: doc.date,
        currency: 'MNT',
        description: doc.description.slice(0, 300),
        controlTotal: controlTotal(lines),
        lines: intakeLines(lines),
      },
    });
  }
}

/** A debit when the value grows, a credit when it shrinks. */
function signed(role: GlRole, value: Decimal): RoleLine {
  return value.gte(0)
    ? { role, debit: value, credit: ZERO }
    : { role, debit: ZERO, credit: value.negated() };
}

/** The other side of a stock change: a credit when the stock grew. */
function opposite(role: GlRole, value: Decimal): RoleLine {
  return signed(role, value.negated());
}
