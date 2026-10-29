import { Injectable } from '@nestjs/common';
import type { PartyIn } from '@tugeel/fin-contract';
import type { GlRole } from '@tugeel/shared/finance';
import mn from '@tugeel/shared/i18n/mn.json';
import { Decimal } from '@tugeel/shared/money';
import { nameKey } from '@tugeel/shared/text';
import { businessDate } from '@tugeel/shared/time';
import type { Tx } from '../../../common/db/db.types';
import { FinChartService, FinReader } from '../../../finance-core';
import { BTO_SOURCE, FIN_DOC_TYPES, FinPartiesBridge } from '../../fin-bridge';
import { type Actor, OrgService, UserNamesService } from '../../identity';
import type {
  DamageChargeFacts,
  StockBookKind,
  StockBookParty,
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

/**
 * A goods-issue expense type's account (ADR-0081's seeded codes). Any other type (admin-added, or a
 * supplier return to someone who is not a supplier) books on its own key when finance gave it an
 * account (ADR-0106 #3), else on OTHER.
 */
const ROLE_OF_ISSUE_TYPE: Readonly<Record<string, GlRole>> = {
  INTERNAL_USE: 'ISSUE_INTERNAL',
  BONUS: 'ISSUE_BONUS',
  MARKETING: 'ISSUE_MARKETING',
  WRITE_OFF: 'ISSUE_WRITE_OFF',
  TRANSFER_OUT: 'ISSUE_TRANSFER_OUT',
  // Damage charged to a person (ADR-0117 #3): the goods leave at cost as a cost of sale, the
  // charge at the sale price is the party's receivable (`damageChargedInTx`); TODO-VERIFY D8.
  DAMAGE_CHARGE: 'COGS',
};

/** A staff member's party ref under source BTO (ADR-0117 #2); kind EMPLOYEE. */
export const userRef = (userId: number): string => `user:${userId}`;

/** A typed recipient's party ref: equal names (by their search key) are one party. */
export const otherRef = (name: string): string => `other:${nameKey(name).slice(0, 100)}`;

/** The posting key of a goods-issue expense type without a seeded account (ADR-0106 #3). */
export const issueTypeKey = (typeId: number): string => `ISSUE_TYPE_${typeId}`;

/** The seeded account role of an expense type code, if it has one. */
export const issueRoleOf = (code: string | null | undefined): GlRole | null =>
  ROLE_OF_ISSUE_TYPE[code ?? ''] ?? null;

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
    private readonly org: OrgService,
    private readonly chart: FinChartService,
    private readonly parties: FinPartiesBridge,
    private readonly users: UserNamesService,
    private readonly reader: FinReader,
  ) {}

  async stockPostedInTx(tx: Tx, actor: Actor, facts: StockPostedFacts): Promise<void> {
    const lines: RoleLine[] = [];
    let stock = ZERO;
    const ownKeys = await this.ownIssueKeys(tx, actor, facts);
    // A goods issue's party rides on its expense line and on the document (ADR-0117 #2), so the
    // account report filters by account and party.
    const party = facts.party ? await this.partyIn(tx, actor, facts.party) : undefined;
    for (const line of facts.lines) {
      stock = stock.plus(line.value);
      if (line.kind !== 'ISSUE') {
        lines.push(opposite(ROLE_OF_KIND[line.kind], line.value));
        continue;
      }
      const role = issueRoleOf(line.issueType);
      const key = line.issueTypeId == null ? null : issueTypeKey(line.issueTypeId);
      const expense: RoleLine =
        role !== null
          ? opposite(role, line.value)
          : {
              ...opposite('ISSUE_OTHER', line.value),
              ...(key !== null && ownKeys.has(key) ? { key } : {}),
            };
      lines.push(party ? { ...expense, extra: { ...expense.extra, party } } : expense);
    }
    lines.unshift(signed('INVENTORY', stock));
    const label = LABELS[facts.docType] ?? facts.docType;
    await this.post(tx, actor, {
      docType: FIN_DOC_TYPES.STOCK_VALUE.docType,
      docId: `${facts.docType}:${facts.docId}:${facts.firstLedgerId}`,
      date: facts.date,
      description: `${label} ${facts.number ?? `#${facts.docId}`}`,
      warehouseIds: facts.warehouseIds,
      lines,
      party,
    });
  }

  /**
   * Damage charged to a person (ADR-0117 #3): one confirmed part of a «Хүнд тооцох» issue is the
   * party's receivable at the sale price, `BTO/DAMAGE_CHARGE/<issue>:<warehouse>`, an AR_INVOICE
   * of type BTO.DAMAGE_CHARGE numbered by Bto: Dr AR (the item, due on the posting day) / Cr other
   * income; no VAT (TODO-VERIFY with the accountant). The goods themselves left at cost through
   * `stockPostedInTx` (COGS), so the margin is the difference of the two documents.
   */
  async damageChargedInTx(tx: Tx, actor: Actor, facts: DamageChargeFacts): Promise<void> {
    if (!facts.amount.gt(0)) return;
    const party = await this.partyIn(tx, actor, facts.party);
    const lines: RoleLine[] = [
      { role: 'AR', debit: facts.amount, credit: ZERO },
      { role: 'OTHER_INCOME', debit: ZERO, credit: facts.amount },
    ];
    await this.intake.submitInTx(
      tx,
      this.books.source(actor),
      {
        source: {
          system: BTO_SOURCE,
          docType: FIN_DOC_TYPES.DAMAGE_CHARGE.docType,
          docId: facts.docId,
          docNo: facts.docNo.slice(0, 60),
        },
        body: {
          action: 'POST',
          documentType: FIN_DOC_TYPES.DAMAGE_CHARGE.code,
          documentDate: facts.date,
          currency: 'MNT',
          party,
          dueDate: facts.date,
          description: `${LABELS.damage ?? 'GI'} ${facts.docNo} — ${party.name}`.slice(0, 300),
          controlTotal: controlTotal(lines),
          lines: intakeLines(lines),
        },
      },
      await this.org.branchOfWarehouses(facts.warehouseIds, tx),
    );
  }

  /** A correction (ADR-0117 #5): the corrected part's charge is reversed, dated today. */
  async damageReversedInTx(tx: Tx, actor: Actor, docId: string, reason: string): Promise<void> {
    const known = await this.reader.documentsOfSource(
      this.books.source(actor),
      {
        company: await this.books.company(),
        system: BTO_SOURCE,
        docType: FIN_DOC_TYPES.DAMAGE_CHARGE.docType,
        docIds: [docId],
      },
      this.books.executor(tx),
    );
    if (!known.has(docId)) return;
    await this.intake.submitInTx(tx, this.books.source(actor), {
      source: { system: BTO_SOURCE, docType: FIN_DOC_TYPES.DAMAGE_CHARGE.docType, docId },
      body: { action: 'REVERSE', accountingDate: businessDate(), reason: reason.slice(0, 500) },
    });
  }

  /**
   * A goods issue's party as the intake names it (ADR-0117 #2): a customer's or a supplier's own
   * party, a staff member as EMPLOYEE `user:<id>`, a typed name as OTHER by its search key (the
   * stored name follows the latest spelling).
   */
  private async partyIn(tx: Tx, actor: Actor, party: StockBookParty): Promise<PartyIn> {
    switch (party.kind) {
      case 'CUSTOMER':
        if (party.id === null) break;
        await this.parties.customerPartyInTx(tx, actor, party.id);
        return this.parties.customerPartyIn(tx, party.id);
      case 'SUPPLIER':
        if (party.id === null) break;
        await this.parties.supplierPartyInTx(tx, actor, party.id);
        return this.parties.supplierPartyIn(tx, party.id);
      case 'USER': {
        if (party.id === null) break;
        const user = (await this.users.summariesOf([party.id])).get(party.id);
        return {
          ref: userRef(party.id),
          kind: 'EMPLOYEE',
          name: (user?.fullName ?? party.name).trim().slice(0, 200) || userRef(party.id),
        };
      }
      case 'OTHER':
        break;
    }
    const name = party.name.trim().slice(0, 200) || '—';
    return { ref: otherRef(name), kind: 'OTHER', name };
  }

  async stockRevaluedInTx(tx: Tx, actor: Actor, facts: StockRevaluedFacts): Promise<void> {
    await this.post(tx, actor, {
      docType: FIN_DOC_TYPES.STOCK_REVALUE.docType,
      docId: `${facts.receiptId}:${facts.version}`,
      date: facts.date,
      description: `${LABELS.revalue ?? 'GR'} ${facts.number ?? `#${facts.receiptId}`}/${facts.version}`,
      warehouseIds: facts.warehouseIds,
      lines: [
        signed('INVENTORY', facts.absorbed),
        signed('COGS', facts.variance),
        opposite('GOODS_RECEIVED', facts.absorbed.plus(facts.variance)),
      ],
    });
  }

  /** The expense-type keys that hold an account on the posting's date (none asked: none read). */
  private async ownIssueKeys(
    tx: Tx,
    actor: Actor,
    facts: StockPostedFacts,
  ): Promise<ReadonlySet<string>> {
    const unseeded = facts.lines.some(
      (line) => line.kind === 'ISSUE' && issueRoleOf(line.issueType) === null,
    );
    if (!unseeded) return new Set();
    const rules = await this.chart.rules(
      this.books.source(actor),
      { company: await this.books.company(), on: facts.date },
      tx,
    );
    return new Set(
      [...rules.values()].filter((rule) => rule.accountId !== null).map((rule) => rule.key),
    );
  }

  private async post(
    tx: Tx,
    actor: Actor,
    doc: {
      docType: string;
      docId: string;
      date: string;
      description: string;
      warehouseIds: readonly number[];
      lines: RoleLine[];
      party?: PartyIn;
    },
  ): Promise<void> {
    const lines = doc.lines.filter((line) => !(line.debit.isZero() && line.credit.isZero()));
    if (lines.length < 2) return;
    await this.intake.submitInTx(
      tx,
      this.books.source(actor),
      {
        source: { system: BTO_SOURCE, docType: doc.docType, docId: doc.docId },
        body: {
          action: 'POST',
          documentType: FIN_DOC_TYPES.STOCK_VALUE.code,
          documentDate: doc.date,
          currency: 'MNT',
          ...(doc.party ? { party: doc.party } : {}),
          description: doc.description.slice(0, 300),
          controlTotal: controlTotal(lines),
          lines: intakeLines(lines),
        },
      },
      await this.org.branchOfWarehouses(doc.warehouseIds, tx),
    );
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
