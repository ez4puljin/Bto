import { Injectable } from '@nestjs/common';
import type { PostBody } from '@tugeel/fin-contract';
import { Decimal } from '@tugeel/shared/money';
import { businessDate } from '@tugeel/shared/time';
import type { Tx } from '../../../common/db/db.types';
import { FinReader } from '../../../finance-core';
import { BTO_SOURCE, FIN_DOC_TYPES, FinPartiesBridge } from '../../fin-bridge';
import type { Actor } from '../../identity';
import type {
  PurchaseBooks,
  ReceiptBookFacts,
  ReceiptBookTotals,
  SupplierReturnFacts,
} from '../../inventory';
import { FinBooks } from './fin-books';
import { FinPosting } from './fin-posting';
import { controlTotal, intakeLines, type RoleLine } from './intake-lines';

const ZERO = new Decimal(0);

/** The open items of one receipt's payable share this group (its bill and its re-costings). */
export const receiptGroupRef = (receiptId: number): string => `receipt:${receiptId}`;

/**
 * The supplier's payable from Bto's purchases (F3, ADR-0091), bound as inventory's PURCHASE_BOOKS
 * and posted through the Finance Core's intake inside the receipt's or the issue's transaction, as
 * source BTO with the staff member as the actor (a warehouse user needs no finance right):
 * - a receipt that gets its prices (costing version 1) is the supplier's bill
 *   `BTO/GOODS_RECEIPT/<id>`: Dr stock, Dr input VAT / Cr payable, due on its date;
 * - a later costing books only the difference `BTO/RECEIPT_RECOST/<id>:<version>`: a bill when the
 *   payable grows, a credit settling the receipt's open bill when it shrinks, a journal when only
 *   the stock and the VAT move;
 * - a supplier return `BTO/SUPPLIER_RETURN/<id>`: Dr payable / Cr stock, Cr input VAT, left open
 *   for the accountant to pair (TODO-VERIFY D8).
 * The accounts are the rules of the keys AP, VAT_INPUT and INVENTORY (temporary, TODO-VERIFY D16).
 */
@Injectable()
export class SupplierBillsService implements PurchaseBooks {
  constructor(
    private readonly intake: FinPosting,
    private readonly books: FinBooks,
    private readonly parties: FinPartiesBridge,
    private readonly reader: FinReader,
  ) {}

  async receiptCostedInTx(tx: Tx, actor: Actor, facts: ReceiptBookFacts): Promise<void> {
    const groupRef = receiptGroupRef(facts.receiptId);
    if (facts.previous === null) {
      const { payable, vat, vatBase, stock } = facts.totals;
      if (!payable.gt(0)) return;
      await this.post(tx, actor, facts.supplierId, {
        docType: FIN_DOC_TYPES.SUPPLIER_BILL.docType,
        docId: String(facts.receiptId),
        docNo: facts.number,
        documentType: FIN_DOC_TYPES.SUPPLIER_BILL.code,
        date: facts.date,
        lines: [
          { role: 'INVENTORY', debit: stock, credit: ZERO },
          { role: 'VAT_INPUT', debit: vat, credit: ZERO, taxBase: vatBase },
          {
            role: 'AP',
            debit: ZERO,
            credit: payable,
            extra: { openItem: { dueDate: facts.date, groupRef } },
          },
        ],
      });
      return;
    }
    const delta = difference(facts.totals, facts.previous);
    const today = businessDate();
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
          debit: ZERO,
          credit: delta.payable,
          extra: { openItem: { dueDate: today, groupRef } },
        }
      : delta.payable.lt(0)
        ? {
            role: 'AP',
            debit: delta.payable.negated(),
            credit: ZERO,
            extra: {
              openItem: { groupRef },
              ...(billsOpen.gt(0) ? { settles: [{ target: { groupRef } }] } : {}),
            },
          }
        : null;
    if (ap === null && delta.stock.isZero() && delta.vat.isZero()) return;
    const type =
      ap === null
        ? FIN_DOC_TYPES.RECEIPT_RECOST
        : delta.payable.gt(0)
          ? FIN_DOC_TYPES.SUPPLIER_BILL
          : FIN_DOC_TYPES.SUPPLIER_BILL_CREDIT;
    await this.post(tx, actor, facts.supplierId, {
      docType: FIN_DOC_TYPES.RECEIPT_RECOST.docType,
      docId: `${facts.receiptId}:${facts.version}`,
      docNo: `${facts.number}/${facts.version}`,
      documentType: type.code,
      date: today,
      lines: [
        signed('INVENTORY', delta.stock),
        { ...signed('VAT_INPUT', delta.vat), taxBase: delta.vatBase.abs() },
        ...(ap === null ? [] : [ap]),
      ],
    });
  }

  async supplierReturnPostedInTx(tx: Tx, actor: Actor, facts: SupplierReturnFacts): Promise<void> {
    const payable = facts.cost.plus(facts.vat);
    if (!payable.gt(0)) return;
    await this.post(tx, actor, facts.supplierId, {
      docType: FIN_DOC_TYPES.SUPPLIER_RETURN.docType,
      docId: String(facts.issueId),
      docNo: facts.number,
      documentType: FIN_DOC_TYPES.SUPPLIER_RETURN.code,
      date: facts.date,
      lines: [
        { role: 'AP', debit: payable, credit: ZERO },
        { role: 'INVENTORY', debit: ZERO, credit: facts.cost },
        { role: 'VAT_INPUT', debit: ZERO, credit: facts.vat, taxBase: facts.vatBase },
      ],
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
      lines: RoleLine[];
    },
  ): Promise<void> {
    await this.parties.supplierPartyInTx(tx, actor, supplierId);
    const party = await this.parties.supplierPartyIn(tx, supplierId);
    const lines = doc.lines.filter((line) => !(line.debit.isZero() && line.credit.isZero()));
    const body: PostBody = {
      action: 'POST',
      documentType: doc.documentType,
      documentDate: doc.date,
      currency: 'MNT',
      party,
      dueDate: doc.date,
      description: `${doc.docNo} — ${party.name}`.slice(0, 300),
      controlTotal: controlTotal(lines),
      lines: intakeLines(lines),
    };
    await this.intake.submitInTx(tx, this.books.source(actor), {
      source: { system: BTO_SOURCE, docType: doc.docType, docId: doc.docId, docNo: doc.docNo },
      body,
    });
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
