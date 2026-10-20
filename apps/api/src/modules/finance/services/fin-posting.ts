import { Injectable } from '@nestjs/common';
import type { IntakeCommandV1 } from '@tugeel/fin-contract';
import { Decimal } from '@tugeel/shared/money';
import { eq } from 'drizzle-orm';
import type { Tx } from '../../../common/db/db.types';
import { AppError } from '../../../common/errors/app-error';
import {
  type FinCallContext,
  FinError,
  FinIntakeInTx,
  type FinIntakeResult,
  FinReader,
} from '../../../finance-core';
import { BTO_SOURCE, BTO_TENANT, FIN_DOC_TYPES, newCommandId, ROLE_OF_POSTING_KEY } from '../../fin-bridge';
import { invoices } from '../schema';
import { FinBooks } from './fin-books';

/** A command as Bto writes it: the envelope (contract, ids, tenant, company, actor) is added here. */
export type BtoCommand = Pick<IntakeCommandV1, 'source' | 'body'>;

/**
 * How Bto's receivables post through the Finance Core's intake (F2, ADR-0090): the envelope, the
 * core's refusals turned into today's answers where Bto had its own (a role without an account is
 * 409 ACCOUNT_ROLE_MISSING), and the invoices' open amounts kept as a mirror of their items in the
 * same transaction (ADR-0090 #4; dropped in H1, when the lists read the core).
 */
@Injectable()
export class FinPosting {
  constructor(
    private readonly intake: FinIntakeInTx,
    private readonly reader: FinReader,
    private readonly books: FinBooks,
  ) {}

  async submitInTx(tx: Tx, ctx: FinCallContext, command: BtoCommand): Promise<FinIntakeResult> {
    const company = await this.books.company();
    let result: FinIntakeResult;
    try {
      result = await this.intake.submitInTx(tx, ctx, {
        contract: 'fin.intake/1.0',
        commandId: newCommandId(),
        tenant: BTO_TENANT,
        company,
        actor: { ...ctx.actor },
        ...command,
      });
    } catch (error) {
      throw translated(error);
    }
    await this.syncInvoices(tx, result);
    return result;
  }

  /** Rewrites the open amount of every invoice whose item this posting touched. */
  async syncInvoices(tx: Tx, result: FinIntakeResult): Promise<void> {
    const document = result.document;
    if (!document) return;
    const ids = new Set<number>();
    for (const item of document.openItems) ids.add(Number.parseInt(item.id, 10));
    for (const allocation of document.allocations) {
      ids.add(Number.parseInt(allocation.debitItemId, 10));
      ids.add(Number.parseInt(allocation.creditItemId, 10));
    }
    if (ids.size === 0) return;
    const items = await this.reader.itemsInTx(tx, this.books.source(), {
      company: await this.books.company(),
      ids: [...ids],
    });
    for (const item of items) {
      if (
        item.sourceSystem !== BTO_SOURCE ||
        item.sourceDocType !== FIN_DOC_TYPES.SALES_INVOICE.docType ||
        !/^\d+$/.test(item.sourceDocId)
      ) {
        continue;
      }
      await tx
        .update(invoices)
        .set({ openAmount: item.openAmount })
        .where(eq(invoices.id, Number.parseInt(item.sourceDocId, 10)));
    }
  }
}

/** The core's refusals in today's words where finance had its own (ADR-0089 #3, ADR-0090). */
export function translated(error: unknown): unknown {
  if (!(error instanceof FinError)) return error;
  if (error.code === 'FIN_MAPPING_MISSING') {
    const key = typeof error.params?.key === 'string' ? error.params.key : '';
    const role = ROLE_OF_POSTING_KEY.get(key) ?? key;
    return new AppError('ACCOUNT_ROLE_MISSING', `no active account holds the role ${role}`, { role });
  }
  if (error.code === 'FIN_ACCOUNT_INACTIVE' && typeof error.params?.key === 'string') {
    const role = ROLE_OF_POSTING_KEY.get(error.params.key) ?? error.params.key;
    return new AppError('ACCOUNT_ROLE_MISSING', `no active account holds the role ${role}`, { role });
  }
  return error;
}

/** A Decimal as the contract's two-decimal string. */
export const dec2 = (value: Decimal): string => value.toFixed(2);
