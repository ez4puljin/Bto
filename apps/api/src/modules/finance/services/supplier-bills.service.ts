import { Injectable } from '@nestjs/common';
import type { PostBody } from '@tugeel/fin-contract';
import { Decimal } from '@tugeel/shared/money';
import { businessDate } from '@tugeel/shared/time';
import type { Tx } from '../../../common/db/db.types';
import { FinReader } from '../../../finance-core';
import { BTO_SOURCE, FIN_DOC_TYPES, FinPartiesBridge } from '../../fin-bridge';
import { type Actor, OrgService } from '../../identity';
import {
  type PurchaseBooks,
  type ReceiptBookFacts,
  type ReceiptBookTotals,
  StockPostingService,
  type SupplierReturnFacts,
} from '../../inventory';
import { FinBooks } from './fin-books';
import { FinPosting } from './fin-posting';
import { controlTotal, intakeLines, type RoleLine } from './intake-lines';
import { receiptCounterKey } from './receipt-counter-key';

const ZERO = new Decimal(0);

/** The open items of one receipt's payable share this group (its bill and its re-costings). */
export const receiptGroupRef = (receiptId: number): string => `receipt:${receiptId}`;

/**
 * The supplier's payable from Bto's purchases (F3, ADR-0091), bound as inventory's PURCHASE_BOOKS
 * and posted through the Finance Core's intake inside the receipt's or the issue's transaction, as
 * source BTO with the staff member as the actor (a warehouse user needs no finance right):
 * - a receipt that gets its prices (costing version 1) is the supplier's bill
 *   `BTO/GOODS_RECEIPT/<id>`, one entry straight from the stock to the payable (ADR-0233): Dr stock
 *   (the costed value less what had already left), Dr cost of goods sold (that part: goods sold
 *   before the prices came), Dr input VAT / Cr payable, due on the receipt's date;
 * - a later costing books only the difference of the same four `BTO/RECEIPT_RECOST/<id>:<version>`:
 *   a bill when the payable grows, a credit settling the receipt's open bill when it shrinks, a
 *   journal when only the stock, the cost of sales and the VAT move;
 * - a supplier return `BTO/SUPPLIER_RETURN/<id>`: Dr payable / Cr stock, Cr input VAT, left open
 *   for the accountant to pair (TODO-VERIFY D8).
 * Both receipt entries are dated the receipt's date, or today when that month is closed. The
 * confirmation of a receipt books nothing (its quantities only); goods received 310201 is no longer
 * used, except to clear what a receipt confirmed before ADR-0233 had credited there.
 * The accounts are the rules of the keys AP, VAT_INPUT, INVENTORY and COGS (temporary, TODO-VERIFY
 * D16).
 */
@Injectable()
export class SupplierBillsService implements PurchaseBooks {
  constructor(
    private readonly intake: FinPosting,
    private readonly books: FinBooks,
    private readonly parties: FinPartiesBridge,
    private readonly reader: FinReader,
    private readonly org: OrgService,
    private readonly stock: StockPostingService,
  ) {}

  /**
   * `facts.previous` null: the whole receipt as one bill (its first costing; the development
   * re-post at its latest). `revision`: the bill's revision when a re-post books it again.
   */
  async receiptCostedInTx(
    tx: Tx,
    actor: Actor,
    facts: ReceiptBookFacts,
    revision = 1,
  ): Promise<void> {
    const groupRef = receiptGroupRef(facts.receiptId);
    // The account chosen on the receipt has a key of its own (ADR-0154), its re-costings too.
    const counterKey = facts.counterAccountCode
      ? { key: receiptCounterKey(facts.counterAccountCode) }
      : {};
    const first = facts.previous === null;
    const delta = facts.previous === null ? facts.totals : difference(facts.totals, facts.previous);
    // What the costing charged to goods that had already left; the rest of the value is stock.
    const variance = await this.stock.costingVariance(
      facts.receiptId,
      tx,
      first ? undefined : facts.version,
    );
    const cleared = first ? await this.bookedAtConfirmation(tx, actor, facts.receiptId) : ZERO;
    // A lower payable settles what is still open of the receipt's bills; the rest stays open.
    const billsOpen = delta.payable.lt(0)
      ? await this.reader.groupOpenInTx(tx, this.books.source(actor), {
          company: await this.books.company(),
          system: BTO_SOURCE,
          groupRef,
          side: 'CREDIT',
        })
      : ZERO;
    const ap: RoleLine | null = delta.payable.gt(0)
      ? {
          role: 'AP',
          ...counterKey,
          debit: ZERO,
          credit: delta.payable,
          extra: { openItem: { dueDate: facts.date, groupRef } },
        }
      : delta.payable.lt(0)
        ? {
            role: 'AP',
            ...counterKey,
            debit: delta.payable.negated(),
            credit: ZERO,
            extra: {
              openItem: { groupRef },
              ...(billsOpen.gt(0) ? { settles: [{ target: { groupRef } }] } : {}),
            },
          }
        : null;
    const type =
      ap === null
        ? FIN_DOC_TYPES.RECEIPT_RECOST
        : delta.payable.gt(0)
          ? FIN_DOC_TYPES.SUPPLIER_BILL
          : FIN_DOC_TYPES.SUPPLIER_BILL_CREDIT;
    await this.post(tx, actor, facts.supplierId, {
      ...(first
        ? {
            docType: FIN_DOC_TYPES.SUPPLIER_BILL.docType,
            docId: String(facts.receiptId),
            docNo: facts.number,
            revision,
          }
        : {
            docType: FIN_DOC_TYPES.RECEIPT_RECOST.docType,
            docId: `${facts.receiptId}:${facts.version}`,
            docNo: `${facts.number}/${facts.version}`,
          }),
      documentType: type.code,
      date: facts.date,
      warehouseIds: facts.warehouseIds,
      lines: [
        signed('INVENTORY', delta.stock.minus(variance).minus(cleared)),
        signed('COGS', variance),
        signed('GOODS_RECEIVED', cleared),
        { ...signed('VAT_INPUT', delta.vat), taxBase: delta.vatBase.abs() },
        ...(ap === null ? [] : [ap]),
      ],
    });
  }

  /**
   * What a receipt confirmed before ADR-0233 credited to goods received (310201) for its stock at
   * the provisional cost, `BTO/STOCK/GR:<id>:<first ledger row>`: its bill clears that instead of
   * debiting the stock a second time. Zero for every receipt confirmed since.
   */
  private async bookedAtConfirmation(tx: Tx, actor: Actor, receiptId: number): Promise<Decimal> {
    const entry = await this.stock.receiptEntry(receiptId, tx);
    if (entry === null || entry.value.isZero()) return ZERO;
    const docId = `GR:${receiptId}:${entry.firstLedgerId}`;
    const known = await this.reader.documentsOfSource(
      this.books.source(actor),
      {
        company: await this.books.company(),
        system: BTO_SOURCE,
        docType: FIN_DOC_TYPES.STOCK_VALUE.docType,
        docIds: [docId],
      },
      this.books.executor(tx),
    );
    const document = known.get(docId);
    return document && document.reversal === null ? entry.value : ZERO;
  }

  /** One confirmed part of a supplier return (ADR-0117 #2), `BTO/SUPPLIER_RETURN/<issue>:<warehouse>`. */
  async supplierReturnPostedInTx(tx: Tx, actor: Actor, facts: SupplierReturnFacts): Promise<void> {
    const payable = facts.cost.plus(facts.vat);
    if (!payable.gt(0)) return;
    await this.post(tx, actor, facts.supplierId, {
      docType: FIN_DOC_TYPES.SUPPLIER_RETURN.docType,
      docId: facts.docId,
      docNo: facts.docNo,
      documentType: FIN_DOC_TYPES.SUPPLIER_RETURN.code,
      date: facts.date,
      warehouseIds: facts.warehouseIds,
      lines: [
        { role: 'AP', debit: payable, credit: ZERO },
        { role: 'INVENTORY', debit: ZERO, credit: facts.cost },
        { role: 'VAT_INPUT', debit: ZERO, credit: facts.vat, taxBase: facts.vatBase },
      ],
    });
  }

  /**
   * A correction of a posted supplier return (ADR-0117 #5): the corrected part's credit is
   * reversed, dated today; nothing to reverse (a part that booked no payable) is not an error.
   */
  async supplierReturnReversedInTx(
    tx: Tx,
    actor: Actor,
    docId: string,
    reason: string,
  ): Promise<void> {
    const known = await this.reader.documentsOfSource(
      this.books.source(actor),
      {
        company: await this.books.company(),
        system: BTO_SOURCE,
        docType: FIN_DOC_TYPES.SUPPLIER_RETURN.docType,
        docIds: [docId],
      },
      this.books.executor(tx),
    );
    if (!known.has(docId)) return;
    await this.intake.submitInTx(tx, this.books.source(actor), {
      source: { system: BTO_SOURCE, docType: FIN_DOC_TYPES.SUPPLIER_RETURN.docType, docId },
      body: { action: 'REVERSE', accountingDate: businessDate(), reason: reason.slice(0, 500) },
    });
  }

  /** One purchase document of the supplier, its zero lines left out. */
  private async post(
    tx: Tx,
    actor: Actor,
    supplierId: number,
    doc: {
      docType: string;
      docId: string;
      docNo: string;
      documentType: string;
      date: string;
      revision?: number;
      warehouseIds: readonly number[];
      lines: RoleLine[];
    },
  ): Promise<void> {
    await this.parties.supplierPartyInTx(tx, actor, supplierId);
    const party = await this.parties.supplierPartyIn(tx, supplierId);
    const lines = doc.lines.filter((line) => !(line.debit.isZero() && line.credit.isZero()));
    if (lines.length < 2) return;
    // A closed month never stops a costing or a return: the entry goes on today then (ADR-0233).
    const accountingDate = await this.reader.postingDate(
      this.books.source(actor),
      { company: await this.books.company(), date: doc.date },
      this.books.executor(tx),
    );
    const body: PostBody = {
      action: 'POST',
      documentType: doc.documentType,
      documentDate: doc.date,
      ...(accountingDate === doc.date ? {} : { accountingDate }),
      currency: 'MNT',
      party,
      dueDate: doc.date,
      description: `${doc.docNo} — ${party.name}`.slice(0, 300),
      controlTotal: controlTotal(lines),
      lines: intakeLines(lines),
    };
    await this.intake.submitInTx(
      tx,
      this.books.source(actor),
      {
        source: {
          system: BTO_SOURCE,
          docType: doc.docType,
          docId: doc.docId,
          docNo: doc.docNo,
          ...(doc.revision && doc.revision > 1 ? { revision: doc.revision } : {}),
        },
        body,
      },
      await this.org.branchOfWarehouses(doc.warehouseIds, tx),
    );
  }
}

/** This version's totals less the replaced version's. */
function difference(now: ReceiptBookTotals, before: ReceiptBookTotals): ReceiptBookTotals {
  return {
    payable: now.payable.minus(before.payable),
    vat: now.vat.minus(before.vat),
    vatBase: now.vatBase.minus(before.vatBase),
    stock: now.stock.minus(before.stock),
  };
}

/** A line on the side of its amount's sign (a debit when it grows). */
function signed(role: RoleLine['role'], amount: Decimal): RoleLine {
  return amount.gte(0)
    ? { role, debit: amount, credit: ZERO }
    : { role, debit: ZERO, credit: amount.negated() };
}
