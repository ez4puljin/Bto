import { Injectable } from '@nestjs/common';
import type { IntakeCommandV1, PartyIn } from '@tugeel/fin-contract';
import {
  ERKHET_BOOKS,
  type ErkhetLedgerSide,
  isErkhetDocumentType,
  isErkhetSourceDocType,
} from '@tugeel/shared/erkhet';
import { Decimal } from '@tugeel/shared/money';
import { businessDate } from '@tugeel/shared/time';
import type { Tx } from '../../../common/db/db.types';
import {
  FinChartService,
  FinError,
  FinIntakeInTx,
  type FinIntakeResult,
  FinReader,
  FinReports,
} from '../../../finance-core';
import { type Actor, systemActor } from '../../identity';
import { newCommandId } from '../command-id';
import { BTO_SOURCE, BTO_TENANT, ERKHET_DOC_TYPES, FIN_SOURCE } from '../installation';
import { FinContexts } from './contexts.service';
import { FinPartiesBridge } from './parties-bridge.service';

/** A copy's command as the erkhet module writes it: the envelope is added here. */
export interface ErkhetCopyCommand {
  docType:
    | typeof ERKHET_BOOKS.trDocType
    | typeof ERKHET_BOOKS.openingDocType
    | typeof ERKHET_BOOKS.allocationDocType;
  docId: string;
  revision: number;
  docNo?: string;
  body: IntakeCommandV1['body'];
}

/** An open item of a party that a copy opened. */
export interface ErkhetCopyItem {
  id: number;
  side: 'DEBIT' | 'CREDIT';
  /** The due date, else the item's date: the order items are paired in. */
  date: string;
  open: Decimal;
}

/** How one of Bto's own documents can be taken back from «Авлага, өглөгийн гүйлгээ». */
export type OwnDocumentKind = 'VOUCHER' | 'JOURNAL' | 'OTHER';

/**
 * A document of Bto's own that moves a party's balance on a copied account. Erkhet holds the same
 * transaction, so with the copies in the books it counts twice.
 */
export interface OwnDocument {
  /** The core's document; null for an entry without one. */
  documentId: number | null;
  /** Its journal entry (a manual entry is reversed by it). */
  entryId: number;
  number: string;
  date: string;
  side: ErkhetLedgerSide;
  kind: OwnDocumentKind;
  sourceSystem: string;
  sourceDocType: string;
  partyName: string | null;
  /** Debit − credit on the account, of the document's live lines. */
  amount: Decimal;
}

/**
 * The books refused a copy: the core's error code and its parameters (`FIN_PERIOD_CLOSED` with the
 * month, `FIN_REVERSAL_BLOCKED` when another allocation holds the copy's item).
 */
export class ErkhetBooksRefusal extends Error {
  constructor(
    readonly code: string,
    readonly params: Readonly<Record<string, unknown>>,
  ) {
    super(`the books refused a copy: ${code}`);
    this.name = 'ErkhetBooksRefusal';
  }
}

const VOUCHER_DOC_TYPES: readonly string[] = ['RECEIPT', 'PAYMENT'];
const CONTROL_KEY: Readonly<Record<ErkhetLedgerSide, string>> = { RECEIVABLE: 'AR', PAYABLE: 'AP' };

/**
 * The copies of Erkhet's receivable and payable transactions in the Finance Core (ADR-0219). The
 * erkhet module decides what to post; this service is the only way it reaches the books: as source
 * BTO, with the copies' own document types, through the intake. It also reads what the copies need
 * of the books: a party's copied open items and Bto's own documents on the copied accounts.
 */
@Injectable()
export class FinErkhetBooks {
  constructor(
    private readonly contexts: FinContexts,
    private readonly intake: FinIntakeInTx,
    private readonly reader: FinReader,
    private readonly reports: FinReports,
    private readonly chart: FinChartService,
    private readonly parties: FinPartiesBridge,
  ) {}

  /**
   * Posts or reverses one copy inside the caller's transaction. POSTED and DUPLICATE answer; a
   * refusal of the core (a closed month, a blocked reversal) throws `ErkhetBooksRefusal`, and the
   * caller's transaction rolls back.
   */
  async submitInTx(tx: Tx, actor: Actor, command: ErkhetCopyCommand): Promise<FinIntakeResult> {
    if (!Object.values(ERKHET_DOC_TYPES).some((type) => type.docType === command.docType)) {
      throw new Error(`${command.docType} is not a document type of the Erkhet copies`);
    }
    const ctx = this.contexts.forSource(actor);
    try {
      return await this.intake.submitInTx(tx, ctx, {
        contract: 'fin.intake/1.0',
        commandId: newCommandId(),
        tenant: BTO_TENANT,
        company: await this.contexts.companyCode(),
        actor: { ...ctx.actor },
        source: {
          system: BTO_SOURCE,
          docType: command.docType,
          docId: command.docId,
          revision: command.revision,
          ...(command.docNo ? { docNo: command.docNo } : {}),
        },
        body: command.body,
      });
    } catch (error: unknown) {
      if (error instanceof FinError) throw new ErkhetBooksRefusal(error.code, error.params ?? {});
      throw error;
    }
  }

  /** A customer (receivables) or supplier (payables) as the intake names its party. */
  partyIn(tx: Tx, side: ErkhetLedgerSide, id: number): Promise<PartyIn> {
    return side === 'RECEIVABLE'
      ? this.parties.customerPartyIn(tx, id)
      : this.parties.supplierPartyIn(tx, id);
  }

  /** The open items the copies opened for a customer or a supplier, oldest first. */
  async copiedOpenItems(side: ErkhetLedgerSide, id: number): Promise<ErkhetCopyItem[]> {
    const party =
      side === 'RECEIVABLE'
        ? (await this.parties.partiesOfCustomers([id])).get(id)
        : (await this.parties.partiesOfSuppliers([id])).get(id);
    if (party === undefined) return [];
    const rows = await this.reader.openItems(this.read(), {
      company: await this.contexts.companyCode(),
      partyId: Number.parseInt(party, 10),
      control: side,
    });
    return rows
      .filter((row) => isErkhetDocumentType(row.document.typeCode))
      .map((row) => ({
        id: row.id,
        side: row.side,
        date: row.dueDate ?? row.itemDate,
        open: row.openAmount,
      }));
  }

  /** Whether the copies' clearing key has an account today (migration 0112 or the chart template). */
  async clearingReady(): Promise<boolean> {
    const rules = await this.chart.rules(this.read(), {
      company: await this.contexts.companyCode(),
      on: businessDate(),
    });
    const rule = rules.get(ERKHET_BOOKS.clearingKey);
    return rule !== undefined && rule.accountId !== null;
  }

  /**
   * Bto's own documents that move a party's balance on the receivable and payable accounts: every
   * source document whose live lines there, with a party, do not net to zero (a reversed document
   * and its reversal do), the copies left out. `truncated` when an account holds more lines than
   * the core's ledger report reads at once.
   */
  async ownDocuments(): Promise<{ documents: OwnDocument[]; truncated: boolean }> {
    const ctx = this.read();
    const company = await this.contexts.companyCode();
    const today = businessDate();
    const rules = await this.chart.rules(ctx, { company, on: today });
    const documents: OwnDocument[] = [];
    let truncated = false;
    for (const side of ['RECEIVABLE', 'PAYABLE'] as const) {
      const accountId = rules.get(CONTROL_KEY[side])?.accountId ?? null;
      if (accountId === null) continue;
      const lines = await this.reports.ledgerLines(ctx, {
        company,
        accountId,
        from: '2000-01-01',
        to: today,
      });
      truncated ||= lines.truncated;
      const byKey = new Map<string, OwnDocument>();
      for (const line of lines.rows) {
        if (line.partyId === null || isErkhetSourceDocType(line.sourceDocType)) continue;
        // A document and its reversal share the source key; an entry without one stands alone.
        const key =
          line.sourceDocType === null || line.sourceDocId === null
            ? `entry:${line.entryId}`
            : `${line.system}/${line.sourceDocType}/${line.sourceDocId}`;
        const amount = line.debit.minus(line.credit);
        const known = byKey.get(key);
        if (known) {
          known.amount = known.amount.plus(amount);
          continue;
        }
        byKey.set(key, {
          documentId: line.documentId,
          entryId: line.entryId,
          number: line.documentNumber ?? line.entryNumber,
          date: line.entryDate,
          side,
          kind: kindOf(line.system, line.sourceDocType),
          sourceSystem: line.system,
          sourceDocType: line.sourceDocType ?? '',
          partyName: line.partyName,
          amount,
        });
      }
      for (const document of byKey.values()) {
        if (!document.amount.isZero()) documents.push(document);
      }
    }
    documents.sort((a, b) =>
      a.date === b.date ? a.entryId - b.entryId : a.date < b.date ? -1 : 1,
    );
    return { documents, truncated };
  }

  private read() {
    return this.contexts.forSource(systemActor('fin-bridge:erkhet'));
  }
}

function kindOf(system: string, sourceDocType: string | null): OwnDocumentKind {
  if (system !== FIN_SOURCE || sourceDocType === null) return 'OTHER';
  if (VOUCHER_DOC_TYPES.includes(sourceDocType)) return 'VOUCHER';
  return sourceDocType === 'JOURNAL' ? 'JOURNAL' : 'OTHER';
}
