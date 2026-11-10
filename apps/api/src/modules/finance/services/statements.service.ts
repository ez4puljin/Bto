import { Inject, Injectable } from '@nestjs/common';
import {
  balanceDifference,
  buildStatement,
  linkableRows,
  STATEMENT_ROWS,
  type StatementKind,
  statementOfKind,
  type StatementRow,
} from '@tugeel/shared/finance';
import mn from '@tugeel/shared/i18n/mn.json';
import type { Decimal } from '@tugeel/shared/money';
import { eq, sql } from 'drizzle-orm';
import { DB } from '../../../common/db/db.tokens';
import type { Db } from '../../../common/db/db.types';
import { inTransaction } from '../../../common/db/transaction';
import { invalid } from '../../../common/errors/app-error';
import {
  type ExcelColumn,
  type ExcelRow,
  tableWorkbook,
} from '../../../common/excel/table-workbook';
import { FinReports } from '../../../finance-core';
import { FIN_DOC_TYPES } from '../../fin-bridge';
import { AuditService, type AuthContext } from '../../identity';
import { statementRowLinks } from '../schema';
import { FinBooks } from './fin-books';
import { GlAccountsService } from './gl-accounts.service';

/** The entries that empty the result accounts: left out of СТ-2 and of the result shown in СТ-1. */
const CLOSING_DOC_TYPES = [FIN_DOC_TYPES.YEAR_CLOSE.docType];

export interface Statement {
  kind: StatementKind;
  from: string;
  to: string;
  rows: StatementRow[];
  /** СТ-1: assets minus liabilities and equity at both dates; zero when it balances. */
  difference: { opening: Decimal; amount: Decimal } | null;
}

/**
 * The statements СТ-1 and СТ-2 (ADR-0184) from the Finance Core's journal: each account's balances
 * read once, placed on the form's rows by the shared template — the accountant's own links first,
 * the code prefixes otherwise — and summed. A link is a setting of the installation's one company.
 */
@Injectable()
export class StatementsService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly audit: AuditService,
    private readonly books: FinBooks,
    private readonly reports: FinReports,
    private readonly accounts: GlAccountsService,
  ) {}

  async get(
    ctx: AuthContext,
    query: { kind: StatementKind; from: string; to: string },
  ): Promise<Statement> {
    const balances = await this.reports.statementBalances(this.books.user(ctx), {
      company: await this.books.company(),
      from: query.from,
      to: query.to,
      closingDocTypes: CLOSING_DOC_TYPES,
    });
    const links = new Map(
      (await this.db.select().from(statementRowLinks)).map((row) => [row.accountId, row.rowCode]),
    );
    const rows = buildStatement(
      query.kind,
      balances.map((balance) => ({
        accountId: balance.accountId,
        code: balance.code,
        name: balance.name,
        kind: balance.kind,
        ...(query.kind === 'BALANCE'
          ? { opening: balance.opening, amount: balance.closing }
          : { opening: null, amount: balance.period }),
      })),
      links,
    );
    return {
      kind: query.kind,
      from: query.from,
      to: query.to,
      rows,
      difference: query.kind === 'BALANCE' ? balanceDifference(rows) : null,
    };
  }

  /** Puts an account on a row of its statement; `null` returns it to the default row. */
  async link(ctx: AuthContext, accountId: number, rowCode: string | null): Promise<void> {
    const account = await this.accounts.get(accountId);
    if (rowCode !== null && !linkableRows(account.kind).some((row) => row.code === rowCode)) {
      throw invalid('rowCode', 'row', `not a row of ${statementOfKind(account.kind)} for it`);
    }
    await inTransaction(this.db, async (tx) => {
      const [before] = await tx
        .select()
        .from(statementRowLinks)
        .where(eq(statementRowLinks.accountId, accountId))
        .for('update');
      if ((before?.rowCode ?? null) === rowCode) return;
      if (rowCode === null) {
        await tx.delete(statementRowLinks).where(eq(statementRowLinks.accountId, accountId));
      } else {
        await tx
          .insert(statementRowLinks)
          .values({ accountId, rowCode, updatedBy: ctx.userId })
          .onConflictDoUpdate({
            target: statementRowLinks.accountId,
            set: { rowCode, updatedBy: ctx.userId, updatedAt: sql`now()` },
          });
      }
      await this.audit.record(tx, ctx, {
        action: 'UPDATE',
        entity: 'statement_row_links',
        entityId: accountId,
        before: { accountCode: account.code, rowCode: before?.rowCode ?? null },
        after: { accountCode: account.code, rowCode },
      });
    });
  }

  /** The statement as an Excel sheet: the form's rows, then each row's accounts under it. */
  async workbook(
    ctx: AuthContext,
    query: { kind: StatementKind; from: string; to: string },
  ): Promise<Buffer> {
    const statement = await this.get(ctx, query);
    const labels = mn.finance.statements;
    const names: Record<string, string> = labels.rows;
    const balance = query.kind === 'BALANCE';
    const columns: ExcelColumn[] = [
      { name: labels.columns.no, kind: 'text' },
      { name: labels.columns.row, kind: 'text' },
      ...(balance ? [{ name: labels.columns.opening, kind: 'number' } as ExcelColumn] : []),
      { name: balance ? labels.columns.closing : labels.columns.amount, kind: 'number' },
    ];
    const cell = (value: Decimal | null) => (value === null ? null : value.toFixed(2));
    const rows: ExcelRow[] = statement.rows.flatMap((row) => [
      [
        row.no,
        names[row.code] ?? row.code,
        ...(balance ? [cell(row.opening)] : []),
        cell(row.amount),
      ],
      ...row.accounts.map((account): ExcelRow => [
        '',
        `    ${account.code} ${account.name}`,
        ...(balance ? [cell(account.opening)] : []),
        cell(account.amount),
      ]),
    ]);
    return tableWorkbook(
      `${labels.kinds[query.kind]} ${query.from} – ${query.to}`,
      { yes: '', no: '' },
      (sheet) => Promise.resolve(sheet.addRows(columns, rows)),
    );
  }
}

/** Every row code of a statement, for a DTO's documentation and tests. */
export const statementRowCodes = (kind: StatementKind): string[] =>
  STATEMENT_ROWS[kind].map((row) => row.code);
