import { randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { type ArEntryKind, FINANCE_LIMITS, type FinanceDocKind } from '@tugeel/shared/finance';
import { Decimal } from '@tugeel/shared/money';
import { businessDate } from '@tugeel/shared/time';
import { DB } from '../../../common/db/db.tokens';
import type { Db } from '../../../common/db/db.types';
import { inTransaction } from '../../../common/db/transaction';
import { invalid, notFound } from '../../../common/errors/app-error';
import { type FinOpenItemRow, FinReader } from '../../../finance-core';
import { BTO_SOURCE, FIN_DOC_TYPES, FIN_SOURCE, FinPartiesBridge } from '../../fin-bridge';
import { AuditService, type AuthContext } from '../../identity';
import { CustomersService } from '../../partners';
import { FinBooks } from './fin-books';
import { FinPosting } from './fin-posting';
import { assertNotFuture } from './journal.service';

/** An open item of a customer's receivables, as the allocation dialog lists it. */
export interface OpenItem {
  id: number;
  side: 'DEBIT' | 'CREDIT';
  kind: ArEntryKind;
  /** Where the item's document opens in Bto's screens (an invoice, a voucher, a credit note…). */
  documentType: FinanceDocKind;
  documentId: number;
  number: string;
  itemDate: string;
  dueDate: string | null;
  amount: Decimal;
  openAmount: Decimal;
}

export interface AllocationInput {
  customerId: number;
  date: string | null;
  description: string | null;
  pairs: readonly { debitItemId: number; creditItemId: number; amount: Decimal }[];
  /** The request's Idempotency-Key: the allocation document's identity (ADR-0071 #10). */
  key?: string | null;
}

export interface AllocationResult {
  id: number;
  number: string;
  date: string;
  customerId: number;
  amount: Decimal;
  pairs: { debitItemId: number; creditItemId: number; amount: Decimal }[];
}

const MAX_PAIRS = 200;
const KIND_OF_TYPE: Readonly<Record<string, { kind: ArEntryKind; docType: FinanceDocKind }>> = {
  [FIN_DOC_TYPES.SALES_INVOICE.code]: { kind: 'INVOICE', docType: 'INVOICE' },
  [FIN_DOC_TYPES.SALES_RETURN.code]: { kind: 'CREDIT_NOTE', docType: 'CREDIT_NOTE' },
  [FIN_DOC_TYPES.CUSTOMER_RECEIPT.code]: { kind: 'PAYMENT', docType: 'PAYMENT' },
  [FIN_DOC_TYPES.CUSTOMER_REFUND.code]: { kind: 'REFUND', docType: 'PAYMENT' },
};

/**
 * The accountant's manual allocation (ADR-0072 #7, docs/modules/finance-core.md §11): a customer's
 * open credit item (a payment's or a credit note's remainder) paired with open debit items (its
 * invoices, a refund) by hand. Nothing in Bto or the core applies a credit on its own (owner, D7).
 * Each allocation is a FIN.ALLOCATION document of the core, posted as the user with
 * `finance.payments.record`; it books no journal entry and is undone by a reversal.
 */
@Injectable()
export class AllocationsService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly audit: AuditService,
    private readonly customers: CustomersService,
    private readonly reader: FinReader,
    private readonly posting: FinPosting,
    private readonly books: FinBooks,
    private readonly parties: FinPartiesBridge,
  ) {}

  /** A customer's open items on the receivables, oldest due first. */
  async openItems(customerId: number): Promise<OpenItem[]> {
    await this.customerOrThrow(customerId);
    const party = (await this.parties.partiesOfCustomers([customerId])).get(customerId);
    if (party === undefined) return [];
    const rows = await this.reader.openItems(this.books.source(), {
      company: await this.books.company(),
      partyId: Number.parseInt(party, 10),
    });
    return rows.map(toOpenItem);
  }

  async allocate(ctx: AuthContext, input: AllocationInput): Promise<AllocationResult> {
    const date = input.date ?? businessDate();
    assertNotFuture(date, 'date');
    if (input.pairs.length === 0) throw invalid('pairs', 'min', 'at least one pair');
    if (input.pairs.length > MAX_PAIRS) throw invalid('pairs', 'max', `at most ${MAX_PAIRS}`);
    let total = new Decimal(0);
    input.pairs.forEach((pair, index) => {
      if (!pair.amount.gt(0) || pair.amount.decimalPlaces() > 2) {
        throw invalid(`pairs[${index}].amount`, 'money', 'a positive amount with 2 decimals');
      }
      total = total.plus(pair.amount);
    });
    const description = input.description?.trim() || null;
    if (description && description.length > FINANCE_LIMITS.maxDescription) {
      throw invalid('description', 'length', `1 to ${FINANCE_LIMITS.maxDescription} characters`);
    }
    const customer = await this.customerOrThrow(input.customerId);
    const result = await inTransaction(this.db, async (tx) => {
      await this.customers.lockForUpdate(tx, customer.id);
      await this.parties.customerPartyInTx(tx, ctx, customer.id);
      const posted = await this.posting.submitInTx(tx, this.books.user(ctx), {
        source: {
          system: FIN_SOURCE,
          docType: FIN_DOC_TYPES.ALLOCATION.docType,
          docId: input.key ?? randomUUID(),
        },
        body: {
          action: 'POST',
          documentType: FIN_DOC_TYPES.ALLOCATION.code,
          documentDate: date,
          currency: 'MNT',
          party: await this.parties.customerPartyIn(tx, customer.id),
          description: (description ?? customer.name).slice(0, FINANCE_LIMITS.maxDescription),
          controlTotal: total.toFixed(2),
          lines: [],
          allocate: {
            key: 'AR',
            pairs: input.pairs.map((pair) => ({
              debit: { itemId: String(pair.debitItemId) },
              credit: { itemId: String(pair.creditItemId) },
              amount: pair.amount.toFixed(2),
            })),
          },
        },
      });
      const document = posted.document;
      if (!document) throw new Error('the allocation was not posted');
      await this.audit.record(tx, ctx, {
        action: 'CREATE',
        entity: 'allocations',
        entityId: Number.parseInt(document.id, 10),
        after: { number: document.number, customerId: customer.id, amount: total.toFixed(2) },
      });
      return document;
    });
    return {
      id: Number.parseInt(result.id, 10),
      number: result.number,
      date,
      customerId: customer.id,
      amount: total,
      pairs: result.allocations.map((pair) => ({
        debitItemId: Number.parseInt(pair.debitItemId, 10),
        creditItemId: Number.parseInt(pair.creditItemId, 10),
        amount: new Decimal(pair.amount),
      })),
    };
  }

  /** Undoes an allocation document: both items' open amounts come back. */
  async reverse(
    ctx: AuthContext,
    id: number,
    reason: string,
  ): Promise<{ id: number; number: string }> {
    const trimmed = reason.trim();
    if (trimmed.length === 0 || trimmed.length > FINANCE_LIMITS.maxReason) {
      throw invalid('reason', 'length', `1 to ${FINANCE_LIMITS.maxReason} characters`);
    }
    const { rows } = await this.reader.documents(this.books.source(), {
      company: await this.books.company(),
      typeCodes: [FIN_DOC_TYPES.ALLOCATION.code],
      ids: [id],
    });
    const [document] = rows;
    if (!document) throw notFound('allocation', id);
    if (document.reversal) {
      throw invalid('id', 'notReversed', `allocation ${document.number} is reversed already`);
    }
    await inTransaction(this.db, async (tx) => {
      const customerId =
        document.partyId === null
          ? undefined
          : (await this.parties.customersOfParties([String(document.partyId)])).get(
              String(document.partyId),
            );
      if (customerId !== undefined) await this.customers.lockForUpdate(tx, customerId);
      await this.posting.submitInTx(tx, this.books.user(ctx), {
        source: {
          system: FIN_SOURCE,
          docType: document.sourceDocType,
          docId: document.sourceDocId,
        },
        body: { action: 'REVERSE', accountingDate: businessDate(), reason: trimmed },
      });
      await this.audit.record(tx, ctx, {
        action: 'VOID',
        entity: 'allocations',
        entityId: id,
        before: { number: document.number },
        after: { reason: trimmed },
      });
    });
    return { id, number: document.number };
  }

  private async customerOrThrow(customerId: number) {
    const [customer] = await this.customers.getMany([customerId]);
    if (!customer) throw notFound('customer', customerId);
    return customer;
  }
}

function toOpenItem(row: FinOpenItemRow): OpenItem {
  const known = KIND_OF_TYPE[row.document.typeCode];
  const bto = row.document.sourceSystem === BTO_SOURCE && /^\d+$/.test(row.document.sourceDocId);
  return {
    id: row.id,
    side: row.side,
    kind: known?.kind ?? 'ADJUSTMENT',
    documentType: known?.docType ?? 'JOURNAL',
    documentId: bto
      ? Number.parseInt(row.document.sourceDocId, 10)
      : known
        ? row.document.id
        : (row.document.entryId ?? row.document.id),
    number: row.document.number,
    itemDate: row.itemDate,
    dueDate: row.dueDate,
    amount: row.amount,
    openAmount: row.openAmount,
  };
}
