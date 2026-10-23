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
  FinOrgService,
  FinReader,
} from '../../../finance-core';
import {
  BTO_SOURCE,
  BTO_TENANT,
  FIN_DOC_TYPES,
  newCommandId,
  ROLE_OF_POSTING_KEY,
} from '../../fin-bridge';
import { OrgService } from '../../identity';
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
    private readonly org: OrgService,
    private readonly finOrg: FinOrgService,
  ) {}

  /**
   * Posts a command; `branchId` (a Bto branch) tags a POST and every line it writes with that
   * branch (ADR-0106 #4, D26: receivables stay at company level, the branch is a line's dimension).
   */
  async submitInTx(
    tx: Tx,
    ctx: FinCallContext,
    command: BtoCommand,
    branchId: number | null = null,
  ): Promise<FinIntakeResult> {
    const company = await this.books.company();
    const branch =
      command.body.action === 'POST' ? await this.branchRefInTx(tx, company, branchId) : null;
    const body =
      command.body.action === 'POST' && branch !== null
        ? { ...command.body, branch }
        : command.body;
    let result: FinIntakeResult;
    try {
      result = await this.intake.submitInTx(tx, ctx, {
        contract: 'fin.intake/1.0',
        commandId: newCommandId(),
        tenant: BTO_TENANT,
        company,
        actor: { ...ctx.actor },
        source: command.source,
        body,
      });
    } catch (error) {
      throw translated(error);
    }
    await this.syncInvoices(tx, result);
    return result;
  }

  /** The ref of the one branch these warehouses share (none when they span several). */
  async branchRefOfWarehousesInTx(tx: Tx, warehouseIds: readonly number[]): Promise<string | null> {
    const branchId = await this.org.branchOfWarehouses(warehouseIds, tx);
    return this.branchRefInTx(tx, await this.books.company(), branchId);
  }

  /**
   * The core's ref of a Bto branch, mapped now when it was added after the last boot (a read when
   * nothing changed); a closed branch tags nothing, since the core never maps one (ADR-0084 #1).
   */
  private async branchRefInTx(
    tx: Tx,
    company: string,
    branchId: number | null,
  ): Promise<string | null> {
    if (branchId === null) return null;
    const branch = await this.org.getBranch(branchId, tx);
    if (branch.status !== 'ACTIVE') return null;
    await this.finOrg.syncBranchInTx(tx, this.books.source(), {
      company,
      branch: { externalId: String(branch.id), code: branch.code, name: branch.name, active: true },
    });
    return String(branch.id);
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
    return new AppError('ACCOUNT_ROLE_MISSING', `no active account holds the role ${role}`, {
      role,
    });
  }
  if (error.code === 'FIN_ACCOUNT_INACTIVE' && typeof error.params?.key === 'string') {
    const role = ROLE_OF_POSTING_KEY.get(error.params.key) ?? error.params.key;
    return new AppError('ACCOUNT_ROLE_MISSING', `no active account holds the role ${role}`, {
      role,
    });
  }
  return error;
}

/** A Decimal as the contract's two-decimal string. */
export const dec2 = (value: Decimal): string => value.toFixed(2);
