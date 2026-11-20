import { Inject, Injectable } from '@nestjs/common';
import type { Decimal } from '@tugeel/shared/money';
import { DB } from '../../../common/db/db.tokens';
import type { Db } from '../../../common/db/db.types';
import { inTransaction } from '../../../common/db/transaction';
import { FinJournalReader, FinReader } from '../../../finance-core';
import { BTO_SOURCE, FIN_DOC_TYPES } from '../../fin-bridge';
import type { Actor } from '../../identity';
import { ReceiptsService } from '../../inventory';
import { FinBooks } from './fin-books';

/** What bringing a receipt to ADR-0236 did, or would do: the cost changes and the entry. */
export interface PurchaseDiscountConversion {
  receiptId: number;
  number: string;
  /** The costing version written. */
  version: number;
  /** False: a dry run, rolled back. */
  applied: boolean;
  lines: {
    lineId: number;
    productId: number;
    productName: string;
    qtyBase: Decimal;
    discountAmount: Decimal;
    costBefore: Decimal;
    costAfter: Decimal;
    toStock: Decimal;
    toCostOfSales: Decimal;
    avgBefore: Decimal;
    avgAfter: Decimal;
  }[];
  /** The entry `BTO/RECEIPT_RECOST/<receipt>:<version>`; null when nothing was booked. */
  entry: {
    number: string;
    date: string;
    lines: {
      accountCode: string;
      accountName: string;
      postingKey: string | null;
      debit: Decimal;
      credit: Decimal;
      description: string | null;
    }[];
  } | null;
}

/** Ends a dry run's transaction with what it would have done. */
class DryRun extends Error {
  constructor(readonly outcome: PurchaseDiscountConversion) {
    super('dry run');
  }
}

/**
 * The one-off conversion of a receipt costed before ADR-0236 (`pnpm finance:purchase-discounts`):
 * its discount leaves its cost and becomes income. Inventory writes a costing version at the same
 * prices with the cost before the discount (`ReceiptsService.discountsOutOfCostInTx`), and the
 * supplier's bill books the difference as any re-costing: Dr stock (what is still on hand), Dr cost
 * of goods sold (what left) / Cr «Худалдан авалтын хөнгөлөлт», and the payable credited and debited
 * with the discount, so the supplier is owed the same. Dated by ADR-0233's rule (the receipt's
 * date, today when that month is closed). A dry run does all of it and rolls back.
 */
@Injectable()
export class PurchaseDiscountsService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly receipts: ReceiptsService,
    private readonly books: FinBooks,
    private readonly reader: FinReader,
    private readonly journal: FinJournalReader,
  ) {}

  /** Null: the receipt has no discount inside its cost (nothing to do). */
  async convert(
    actor: Actor,
    receiptId: number,
    options: { dryRun: boolean },
  ): Promise<PurchaseDiscountConversion | null> {
    const names = new Map(
      (await this.receipts.costing(receiptId)).lines.map((line) => [line.lineId, line.productName]),
    );
    try {
      return await inTransaction(this.db, async (tx) => {
        const change = await this.receipts.discountsOutOfCostInTx(tx, actor, receiptId);
        if (change === null) return null;
        const company = await this.books.company();
        const docId = `${receiptId}:${change.version}`;
        const document = (
          await this.reader.documentsOfSource(
            this.books.source(actor),
            {
              company,
              system: BTO_SOURCE,
              docType: FIN_DOC_TYPES.RECEIPT_RECOST.docType,
              docIds: [docId],
            },
            tx,
          )
        ).get(docId);
        const entry =
          document?.entryId == null
            ? null
            : await this.journal.entry(
                this.books.source(actor),
                { company, id: document.entryId },
                tx,
              );
        const outcome: PurchaseDiscountConversion = {
          receiptId,
          number: change.number,
          version: change.version,
          applied: !options.dryRun,
          lines: change.lines.map((line) => ({
            lineId: line.lineId,
            productId: line.productId,
            productName: names.get(line.lineId) ?? `#${line.productId}`,
            qtyBase: line.qtyBase,
            discountAmount: line.discountAmount,
            costBefore: line.costBefore,
            costAfter: line.costAfter,
            toStock: line.toStock,
            toCostOfSales: line.toCostOfSales,
            avgBefore: line.avgBefore,
            avgAfter: line.avgAfter,
          })),
          entry:
            entry === null
              ? null
              : {
                  number: entry.number,
                  date: entry.entryDate,
                  lines: entry.lines.map((line) => ({
                    accountCode: line.accountCode,
                    accountName: line.accountName,
                    postingKey: line.postingKey,
                    debit: line.debit,
                    credit: line.credit,
                    description: line.description,
                  })),
                },
        };
        if (options.dryRun) throw new DryRun(outcome);
        return outcome;
      });
    } catch (error) {
      if (error instanceof DryRun) return error.outcome;
      throw error;
    }
  }
}

/** The conversion as the command prints it: the product cost changes, then the entry. */
export function describeConversion(outcome: PurchaseDiscountConversion): string[] {
  const money = (value: Decimal) => value.toFixed(2);
  const out = [
    `${outcome.number} (receipt ${outcome.receiptId}): costing version ${outcome.version}, ${
      outcome.applied ? 'APPLIED' : 'DRY RUN, nothing written'
    }.`,
    'Product costs (cost before → after; of the difference: to the stock on hand, to the cost of goods sold; average before → after):',
    ...outcome.lines.map(
      (line) =>
        `  ${line.productName} × ${line.qtyBase.toString()}: discount ${money(line.discountAmount)}; ` +
        `cost ${money(line.costBefore)} → ${money(line.costAfter)}; ` +
        `stock +${money(line.toStock)}, cost of sales +${money(line.toCostOfSales)}; ` +
        `average ${line.avgBefore.toFixed(4)} → ${line.avgAfter.toFixed(4)}`,
    ),
  ];
  if (outcome.entry === null) return [...out, 'No entry: the books take nothing.'];
  return [
    ...out,
    `Entry ${outcome.applied ? outcome.entry.number : '(not numbered: dry run)'} dated ${outcome.entry.date}:`,
    ...outcome.entry.lines.map(
      (line) =>
        `  ${line.debit.gt(0) ? 'Dr' : 'Cr'} ${line.accountCode} ${line.accountName}` +
        ` ${money(line.debit.gt(0) ? line.debit : line.credit)}` +
        (line.description ? ` (${line.description})` : ''),
    ),
  ];
}
