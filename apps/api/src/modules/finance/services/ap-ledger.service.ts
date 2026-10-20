import { Injectable } from '@nestjs/common';
import type { PayableDocKind, PayableEntryKind } from '@tugeel/shared/finance';
import { Decimal } from '@tugeel/shared/money';
import { notFound } from '../../../common/errors/app-error';
import { DEFAULT_PAGE_LIMIT, decodeCursor, encodeCursor } from '../../../common/pagination/page';
import { type FinOpenItemRow, type FinPartyLedgerRow, FinReader } from '../../../finance-core';
import { BTO_SOURCE, FIN_DOC_TYPES, FinPartiesBridge } from '../../fin-bridge';
import { SuppliersService } from '../../partners';
import type { LedgerQuery } from './ar-ledger.service';
import { FinBooks } from './fin-books';

/** A supplier's payable: what the company owes it (open bills less its open debits). */
export interface SupplierBalance {
  supplierId: number;
  /** Σ credit − Σ debit of the payable lines; negative = the company paid ahead. */
  balance: Decimal;
  /** The oldest open bill's date (bills are due on their date, owner 2026-10-20). */
  oldestBillDate: string | null;
  updatedAt: Date | null;
}

export interface SupplierBalanceRow extends SupplierBalance {
  code: string;
  name: string;
  status: string;
}

export interface PayableEntry {
  id: number;
  entryDate: string;
  kind: PayableEntryKind;
  docType: PayableDocKind;
  /** The receipt's, the issue's or the journal entry's id. */
  docId: number;
  docNumber: string;
  debit: Decimal;
  credit: Decimal;
  /** What the company owes after this line, oldest first. */
  balanceAfter: Decimal;
  createdAt: Date;
}

export interface PayableLedgerPage {
  data: PayableEntry[];
  nextCursor: string | null;
  /** What the company owed before `from` (0 without `from`). */
  opening: Decimal;
}

/** An open item of a supplier's payables, as the allocation dialog lists it. */
export interface PayableOpenItem {
  id: number;
  side: 'DEBIT' | 'CREDIT';
  kind: PayableEntryKind;
  documentType: PayableDocKind;
  documentId: number;
  number: string;
  itemDate: string;
  dueDate: string | null;
  amount: Decimal;
  openAmount: Decimal;
}

export interface SupplierBalancesQuery {
  q?: string;
  cursor?: string;
  limit?: number;
}

/** A payable line's document type in Bto's terms (F3, ADR-0091). */
const KIND_OF_TYPE: Readonly<Record<string, { kind: PayableEntryKind; docType: PayableDocKind }>> =
  {
    [FIN_DOC_TYPES.SUPPLIER_BILL.code]: { kind: 'BILL', docType: 'RECEIPT' },
    [FIN_DOC_TYPES.SUPPLIER_BILL_CREDIT.code]: { kind: 'RECOST', docType: 'RECEIPT' },
    [FIN_DOC_TYPES.RECEIPT_RECOST.code]: { kind: 'RECOST', docType: 'RECEIPT' },
    [FIN_DOC_TYPES.SUPPLIER_RETURN.code]: { kind: 'RETURN', docType: 'ISSUE' },
  };

/**
 * The suppliers' payables, read from the Finance Core (F3, ADR-0091): a supplier's balance is the
 * open items of its party on the payable accounts, its ledger the payable lines with their
 * documents (a receipt's bill and its re-costings, a supplier return, a manual entry). Shown as
 * what the company owes (credit − debit). Nothing is written here.
 */
@Injectable()
export class ApLedgerService {
  constructor(
    private readonly suppliers: SuppliersService,
    private readonly reader: FinReader,
    private readonly books: FinBooks,
    private readonly parties: FinPartiesBridge,
  ) {}

  /** One supplier's payable (zeros for a supplier without payable lines). */
  async rowOf(supplierId: number): Promise<SupplierBalanceRow> {
    const supplier = await this.supplierOrThrow(supplierId);
    const party = await this.partyOf(supplierId);
    const row =
      party === null
        ? null
        : await this.reader.partyBalance(this.books.source(), {
            company: await this.books.company(),
            partyId: party,
            control: 'PAYABLE',
          });
    return {
      supplierId,
      code: supplier.code,
      name: supplier.name,
      status: supplier.status,
      balance: row?.net ?? new Decimal(0),
      oldestBillDate: row?.oldestDueDate ?? null,
      updatedAt: row?.updatedAt ?? null,
    };
  }

  /** The suppliers with payables, largest balance first. */
  async balances(
    query: SupplierBalancesQuery,
  ): Promise<{ data: SupplierBalanceRow[]; nextCursor: string | null }> {
    const limit = query.limit ?? DEFAULT_PAGE_LIMIT;
    const after = decodeCursor(query.cursor);
    let partyIds: number[] | undefined;
    if (query.q?.trim()) {
      const ids = (await this.suppliers.list({ q: query.q.trim(), limit: 200 })).data.map(
        (supplier) => supplier.id,
      );
      if (ids.length === 0) return { data: [], nextCursor: null };
      partyIds = [...(await this.parties.partiesOfSuppliers(ids)).values()].map((id) =>
        Number.parseInt(id, 10),
      );
      if (partyIds.length === 0) return { data: [], nextCursor: null };
    }
    const rows = await this.reader.partyBalances(this.books.source(), {
      company: await this.books.company(),
      control: 'PAYABLE',
      ...(partyIds ? { partyIds } : {}),
      ...(typeof after?.balance === 'string' && typeof after?.id === 'number'
        ? { after: { net: after.balance, partyId: after.id } }
        : {}),
      limit,
    });
    const page = rows.slice(0, limit);
    const last = page.at(-1);
    const supplierOf = await this.parties.suppliersOfParties(
      page.map((row) => String(row.partyId)),
    );
    const suppliers = new Map(
      (await this.suppliers.getMany([...new Set(supplierOf.values())])).map((supplier) => [
        supplier.id,
        supplier,
      ]),
    );
    return {
      data: page.flatMap((row) => {
        const supplierId = supplierOf.get(String(row.partyId));
        if (supplierId === undefined) return [];
        const supplier = suppliers.get(supplierId);
        return [
          {
            supplierId,
            code: supplier?.code ?? '',
            name: supplier?.name ?? '',
            status: supplier?.status ?? 'ACTIVE',
            balance: row.net,
            oldestBillDate: row.oldestDueDate,
            updatedAt: row.updatedAt,
          },
        ];
      }),
      nextCursor:
        rows.length > limit && last
          ? encodeCursor({ balance: last.net.toFixed(2), id: last.partyId })
          : null,
    };
  }

  /** The supplier's payable lines newest first with what is owed after each, and the opening. */
  async ledger(supplierId: number, query: LedgerQuery): Promise<PayableLedgerPage> {
    await this.supplierOrThrow(supplierId);
    const limit = query.limit ?? DEFAULT_PAGE_LIMIT;
    const party = await this.partyOf(supplierId);
    if (party === null) return { data: [], nextCursor: null, opening: new Decimal(0) };
    const after = decodeCursor(query.cursor);
    const { rows, opening } = await this.reader.partyLedger(this.books.source(), {
      company: await this.books.company(),
      partyId: party,
      control: 'PAYABLE',
      ...(query.from ? { from: query.from } : {}),
      ...(query.to ? { to: query.to } : {}),
      ...(typeof after?.id === 'number' ? { beforeLineId: after.id } : {}),
      limit,
    });
    const page = rows.slice(0, limit);
    const last = page.at(-1);
    return {
      data: page.map((row) => ({
        id: row.lineId,
        entryDate: row.entryDate,
        ...documentOf(row),
        debit: row.debit,
        credit: row.credit,
        balanceAfter: row.balanceAfter.negated(),
        createdAt: row.postedAt,
      })),
      nextCursor: rows.length > limit && last ? encodeCursor({ id: last.lineId }) : null,
      opening: opening.negated(),
    };
  }

  /** A supplier's open items on the payables, oldest first (the allocation dialog). */
  async openItems(supplierId: number): Promise<PayableOpenItem[]> {
    await this.supplierOrThrow(supplierId);
    const party = await this.partyOf(supplierId);
    if (party === null) return [];
    const rows = await this.reader.openItems(this.books.source(), {
      company: await this.books.company(),
      partyId: party,
      control: 'PAYABLE',
    });
    return rows.map(toOpenItem);
  }

  private async partyOf(supplierId: number): Promise<number | null> {
    const party = (await this.parties.partiesOfSuppliers([supplierId])).get(supplierId);
    return party === undefined ? null : Number.parseInt(party, 10);
  }

  private async supplierOrThrow(supplierId: number) {
    const [supplier] = await this.suppliers.getMany([supplierId]);
    if (!supplier) throw notFound('supplier', supplierId);
    return supplier;
  }
}

/** The receipt or issue id of a purchase document's source id (`<id>` or `<id>:<version>`). */
function btoDocId(sourceDocId: string): number | null {
  const match = /^(\d+)(?::\d+)?$/.exec(sourceDocId);
  return match?.[1] === undefined ? null : Number.parseInt(match[1], 10);
}

/** A re-costing's difference is a RECOST whichever class it took (a bill when the payable grew). */
function kindOf(sourceDocType: string, kind: PayableEntryKind): PayableEntryKind {
  return sourceDocType === FIN_DOC_TYPES.RECEIPT_RECOST.docType ? 'RECOST' : kind;
}

function documentOf(row: FinPartyLedgerRow): {
  kind: PayableEntryKind;
  docType: PayableDocKind;
  docId: number;
  docNumber: string;
} {
  const target = row.reverses ?? row.document;
  const known = target ? KIND_OF_TYPE[target.typeCode] : undefined;
  const id = target && target.sourceSystem === BTO_SOURCE ? btoDocId(target.sourceDocId) : null;
  if (!target || !known || id === null) {
    // A manual entry (a payment, a service bill) or its reversal: the journal entry is the document.
    return {
      kind: row.reverses ? 'VOID' : 'MANUAL',
      docType: 'JOURNAL',
      docId: row.entryId,
      docNumber: row.document?.number ?? '',
    };
  }
  return {
    kind: row.reverses ? 'VOID' : kindOf(target.sourceDocType, known.kind),
    docType: known.docType,
    docId: id,
    docNumber: target.number,
  };
}

function toOpenItem(row: FinOpenItemRow): PayableOpenItem {
  const known = KIND_OF_TYPE[row.document.typeCode];
  const id = row.document.sourceSystem === BTO_SOURCE ? btoDocId(row.document.sourceDocId) : null;
  const bto = known !== undefined && id !== null;
  return {
    id: row.id,
    side: row.side,
    kind: bto ? kindOf(row.document.sourceDocType, known.kind) : 'MANUAL',
    documentType: bto ? known.docType : 'JOURNAL',
    documentId: bto ? id : (row.document.entryId ?? row.document.id),
    number: row.document.number,
    itemDate: row.itemDate,
    dueDate: row.dueDate,
    amount: row.amount,
    openAmount: row.openAmount,
  };
}
