import { Inject, Injectable } from '@nestjs/common';
import type { LineV1 } from '@tugeel/fin-contract';
import mn from '@tugeel/shared/i18n/mn.json';
import { Decimal } from '@tugeel/shared/money';
import { businessDate } from '@tugeel/shared/time';
import { nameKey, normalizeName } from '@tugeel/shared/text';
import { DB } from '../../../common/db/db.tokens';
import type { Db, Tx } from '../../../common/db/db.types';
import {
  type FinAccountControl,
  type FinAccountKind,
  type FinCallContext,
  type FinChartImportApplied,
  type FinChartImportRow,
  FinChartService,
  FinJournalReader,
  FinReader,
  type FinSide,
} from '../../../finance-core';
import {
  FIN_DOC_TYPES,
  FIN_SOURCE,
  FinContexts,
  FinPartiesBridge,
  MANUAL_KEY,
  POSTING_KEY_OF_ROLE,
} from '../../fin-bridge';
import { type Actor, PermissionHoldersService } from '../../identity';
import { FinBooks } from './fin-books';
import { FinPosting } from './fin-posting';

const MONEY_SCALE = 2;

/** An account of the company as the chart import checks a row against it. */
export interface ChartAccountFact {
  id: number;
  name: string;
  kind: FinAccountKind;
  normalSide: FinSide;
  control: FinAccountControl;
  status: 'ACTIVE' | 'INACTIVE';
  groupId: number | null;
  /** It holds journal lines: its kind, side and control stay (ADR-0102 #4). */
  inUse: boolean;
}

export interface ChartFacts {
  accounts: Map<string, ChartAccountFact>;
  /** Posting key → the control its account must have (NONE: any). */
  keys: Map<string, FinAccountControl>;
  /** Posting key → the account its rule points to today (null: none). */
  rules: Map<string, number | null>;
  /** Group code → the group. */
  groups: Map<string, { id: number; name: string }>;
}

export interface OpeningAccountFact {
  code: string;
  name: string;
  control: FinAccountControl;
  status: 'ACTIVE' | 'INACTIVE';
}

export interface OpeningFacts {
  accounts: Map<string, OpeningAccountFact>;
  /** Money account code → the code of its account. */
  moneyAccounts: Map<string, { accountCode: string; status: 'ACTIVE' | 'INACTIVE' }>;
  /** The account INVENTORY's rule points to today, and OPENING_STOCK's (ADR-0102 #6). */
  inventoryAccountCode: string | null;
  openingStockAccountCode: string | null;
  /** The number of the company's live opening document, if any (one per company). */
  liveOpening: string | null;
}

/** One line of the opening document, as the import planned it. */
export interface OpeningLine {
  accountCode: string;
  side: FinSide;
  /** Two decimals, above zero. */
  amount: string;
  customerId: number | null;
  supplierId: number | null;
  moneyAccountCode: string | null;
  ref: string | null;
  refDate: string | null;
  dueDate: string | null;
  description: string | null;
}

/** The parties whose control lines name a customer (else a supplier). */
export const CUSTOMER_CONTROLS: ReadonlySet<FinAccountControl> = new Set([
  'RECEIVABLE',
  'ADVANCE_RECEIVED',
]);
export const SUPPLIER_CONTROLS: ReadonlySet<FinAccountControl> = new Set([
  'PAYABLE',
  'ADVANCE_PAID',
]);

/** The opening's source document type and the id of an import's n-th document (ADR-0102 #5). */
const OPENING_DOC_TYPE = FIN_DOC_TYPES.OPENING.docType;
export const openingDocId = (importId: number, n: number): string => `import:${importId}:${n}`;

/** Rows per opening document: the contract's 500 lines less the offset line (ADR-0102 #5). */
export const OPENING_ROWS_PER_DOCUMENT = 499;

const label = (text: string): string => nameKey(normalizeName(text));

/** A kind, control or side written in a sheet: its code, or one of its Mongolian labels. */
function lookup<T extends string>(
  codes: readonly T[],
  labels: Readonly<Record<string, string>>,
  text: string,
): T | null {
  const upper = text.trim().toUpperCase();
  const byCode = codes.find((code) => code === upper);
  if (byCode) return byCode;
  const key = label(text);
  for (const code of codes) {
    const names = (labels[code] ?? '').split('|');
    if (names.some((name) => name && label(name) === key)) return code;
  }
  return null;
}

const KINDS: readonly FinAccountKind[] = ['ASSET', 'LIABILITY', 'EQUITY', 'INCOME', 'EXPENSE'];
const CONTROLS: readonly FinAccountControl[] = [
  'NONE',
  'RECEIVABLE',
  'PAYABLE',
  'ADVANCE_RECEIVED',
  'ADVANCE_PAID',
  'MONEY',
];
const SIDES: readonly FinSide[] = ['DEBIT', 'CREDIT'];

/**
 * The finance side of the chart and opening imports (ADR-0102 #4–#6): what the importer checks
 * rows against, and the writes it makes inside the import's transaction through the Finance Core —
 * the chart as the committing staff member, the opening as an OPENING document of source FIN.
 * The worker reads that member's finance rights per company for the commit (they are a job's, not a
 * request's).
 */
@Injectable()
export class FinanceImportsService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly books: FinBooks,
    private readonly contexts: FinContexts,
    private readonly chart: FinChartService,
    private readonly journal: FinJournalReader,
    private readonly reader: FinReader,
    private readonly posting: FinPosting,
    private readonly parties: FinPartiesBridge,
    private readonly holders: PermissionHoldersService,
  ) {}

  /** A kind written as its code or its label («Хөрөнгө», «Өр төлбөр», …). */
  kindOf(text: string): FinAccountKind | null {
    const own: Record<string, string> = mn.finance.accountKinds;
    const more: Record<string, string> = mn.finance.chartImport.kinds;
    const labels = Object.fromEntries(
      KINDS.map((kind) => [kind, [own[kind], more[kind]].filter(Boolean).join('|')]),
    );
    return lookup(KINDS, labels, text);
  }

  /** A control written as its code or its label («Авлага», «Өглөг», «Мөнгө», «Клиринг», …). */
  controlOf(text: string): FinAccountControl | null {
    return lookup(CONTROLS, mn.finance.chartImport.controls, text);
  }

  /** A normal side written as DEBIT / CREDIT or «Дебит» / «Кредит». */
  sideOf(text: string): FinSide | null {
    return lookup(SIDES, mn.finance.chartImport.sides, text);
  }

  /** The posting key of a role written as its code, its label (mn.json) or the key itself. */
  keyOfRole(text: string): string | null {
    const upper = text.trim().toUpperCase();
    const roles = Object.keys(POSTING_KEY_OF_ROLE) as (keyof typeof POSTING_KEY_OF_ROLE)[];
    for (const role of roles) {
      const spec = POSTING_KEY_OF_ROLE[role];
      const name: string | undefined = (mn.finance.roles as Record<string, string>)[role];
      if (role === upper || spec.code === upper || (name && label(name) === label(text))) {
        return spec.code;
      }
    }
    return null;
  }

  async chartFacts(executor: Db | Tx = this.db): Promise<ChartFacts> {
    const ctx = this.books.source();
    const company = await this.books.company();
    const tx = this.books.executor(executor);
    const accounts = await this.chart.accounts(ctx, { company }, tx);
    const inUse = await this.journal.accountsInUse(
      ctx,
      { company, ids: accounts.map((account) => account.id) },
      tx,
    );
    return {
      accounts: new Map(
        accounts.map((account) => [
          account.code,
          {
            id: account.id,
            name: account.name,
            kind: account.kind,
            normalSide: account.normalSide,
            control: account.control,
            status: account.status,
            groupId: account.groupId,
            inUse: inUse.has(account.id),
          },
        ]),
      ),
      keys: await this.chart.postingKeys(ctx, { company }, tx),
      rules: new Map(
        [...(await this.chart.rules(ctx, { company, on: businessDate() }, tx))].map(
          ([key, rule]) => [key, rule.accountId],
        ),
      ),
      groups: new Map(
        (await this.chart.groups(ctx, { company }, tx)).map((group) => [
          group.code,
          { id: group.id, name: group.name },
        ]),
      ),
    };
  }

  async openingFacts(executor: Db | Tx = this.db): Promise<OpeningFacts> {
    const ctx = this.books.source();
    const company = await this.books.company();
    const tx = this.books.executor(executor);
    const accounts = await this.chart.accounts(ctx, { company }, tx);
    const byId = new Map(accounts.map((account) => [account.id, account]));
    const money = await this.chart.moneyAccounts(ctx, { company }, tx);
    const rules = await this.chart.rules(ctx, { company, on: businessDate() }, tx);
    const codeOfKey = (key: string): string | null => {
      const accountId = rules.get(key)?.accountId;
      return accountId == null ? null : (byId.get(accountId)?.code ?? null);
    };
    const live = await this.reader.documents(ctx, {
      company,
      typeCodes: [FIN_DOC_TYPES.OPENING.code],
      reversed: false,
      limit: 1,
    });
    return {
      accounts: new Map(
        accounts.map((account) => [
          account.code,
          {
            code: account.code,
            name: account.name,
            control: account.control,
            status: account.status,
          },
        ]),
      ),
      moneyAccounts: new Map(
        money.map((row) => [row.code, { accountCode: row.accountCode, status: row.status }]),
      ),
      inventoryAccountCode: codeOfKey(POSTING_KEY_OF_ROLE.INVENTORY.code),
      openingStockAccountCode: codeOfKey(POSTING_KEY_OF_ROLE.OPENING_STOCK.code),
      liveOpening: live.rows[0]?.number ?? null,
    };
  }

  /** Erkhet's chart, as the staff member who committed the import (ADR-0102 #4). */
  async importChartInTx(
    tx: Tx,
    actor: Actor,
    rows: readonly FinChartImportRow[],
  ): Promise<FinChartImportApplied[]> {
    return this.chart.importChartInTx(tx, await this.staff(tx, actor), {
      company: await this.books.company(),
      rows,
      on: businessDate(),
    });
  }

  async revertChartInTx(
    tx: Tx,
    actor: Actor,
    applied: readonly FinChartImportApplied[],
  ): Promise<void> {
    await this.chart.revertChartInTx(tx, await this.staff(tx, actor), {
      company: await this.books.company(),
      applied,
      on: businessDate(),
    });
  }

  /**
   * The opening trial balance as OPENING documents dated `date` (ADR-0102 #5), each of at most
   * {@link OPENING_ROWS_PER_DOCUMENT} rows plus, when its rows do not balance on their own, one line
   * on the opening offset account (OPENING_STOCK's) that does; the file balances, so those lines
   * cancel out. Every row is a line by its account's code: a receivable or advance received names its
   * customer, a payable or advance paid its supplier, each such line its own open item with the
   * original document's ref, date and due date; a money line its money account. Keyed
   * `FIN/OPENING/import:<id>:<n>`.
   */
  async postOpeningInTx(
    tx: Tx,
    actor: Actor,
    input: {
      importId: number;
      date: string;
      offsetAccountCode: string;
      lines: readonly OpeningLine[];
    },
  ): Promise<{ documents: number; numbers: string[] }> {
    const ctx = await this.staff(tx, actor);
    const numbers: string[] = [];
    let documents = 0;
    for (let start = 0; start < input.lines.length; start += OPENING_ROWS_PER_DOCUMENT) {
      const chunk = input.lines.slice(start, start + OPENING_ROWS_PER_DOCUMENT);
      documents += 1;
      const lines: LineV1[] = [];
      let debit = new Decimal(0);
      let credit = new Decimal(0);
      for (const line of chunk) {
        let party: LineV1['party'];
        if (line.customerId !== null) {
          await this.parties.customerPartyInTx(tx, actor, line.customerId);
          party = await this.parties.customerPartyIn(tx, line.customerId);
        } else if (line.supplierId !== null) {
          await this.parties.supplierPartyInTx(tx, actor, line.supplierId);
          party = await this.parties.supplierPartyIn(tx, line.supplierId);
        }
        const amount = new Decimal(line.amount);
        if (line.side === 'DEBIT') debit = debit.plus(amount);
        else credit = credit.plus(amount);
        const openItem =
          party && (line.ref || line.refDate || line.dueDate)
            ? {
                ...(line.ref ? { itemRef: line.ref } : {}),
                ...(line.refDate ? { itemDate: line.refDate } : {}),
                ...(line.dueDate ? { dueDate: line.dueDate } : {}),
              }
            : undefined;
        lines.push({
          lineNo: lines.length + 1,
          key: MANUAL_KEY,
          side: line.side,
          amount: amount.toFixed(MONEY_SCALE),
          accountCode: line.accountCode,
          ...(line.moneyAccountCode ? { moneyAccount: line.moneyAccountCode } : {}),
          ...(party ? { party } : {}),
          ...(openItem ? { openItem } : {}),
          ...(line.description ? { description: line.description } : {}),
        });
      }
      if (!debit.eq(credit)) {
        const offset = debit.gt(credit) ? debit.minus(credit) : credit.minus(debit);
        lines.push({
          lineNo: lines.length + 1,
          key: MANUAL_KEY,
          side: debit.gt(credit) ? 'CREDIT' : 'DEBIT',
          amount: offset.toFixed(MONEY_SCALE),
          accountCode: input.offsetAccountCode,
        });
      }
      const result = await this.posting.submitInTx(tx, ctx, {
        source: {
          system: FIN_SOURCE,
          docType: OPENING_DOC_TYPE,
          docId: openingDocId(input.importId, documents),
        },
        body: {
          action: 'POST',
          documentType: FIN_DOC_TYPES.OPENING.code,
          documentDate: input.date,
          currency: 'MNT',
          description: mn.finance.chartImport.openingDescription,
          controlTotal: Decimal.max(debit, credit).toFixed(MONEY_SCALE),
          lines,
        },
      });
      if (result.document?.number) numbers.push(result.document.number);
    }
    return { documents, numbers };
  }

  /**
   * Reverses the import's opening documents on their own date (the month must be open, ADR-0102
   * #5); one reversed by hand from «Журнал» already is left as it is.
   */
  async reverseOpeningInTx(
    tx: Tx,
    actor: Actor,
    input: { importId: number; date: string; documents: number },
  ): Promise<void> {
    const ctx = await this.staff(tx, actor);
    const company = await this.books.company();
    const ids = Array.from({ length: input.documents }, (_, index) =>
      openingDocId(input.importId, index + 1),
    );
    const live = await this.reader.documentsOfSource(
      this.books.source(),
      { company, system: FIN_SOURCE, docType: OPENING_DOC_TYPE, docIds: ids },
      tx,
    );
    for (const docId of ids) {
      const document = live.get(docId);
      if (!document || document.reversal) continue;
      await this.posting.submitInTx(tx, ctx, {
        source: { system: FIN_SOURCE, docType: OPENING_DOC_TYPE, docId },
        body: {
          action: 'REVERSE',
          accountingDate: input.date,
          reason: mn.finance.chartImport.openingReverted,
        },
      });
    }
  }

  /** The staff member behind an import's commit or revert, with their finance rights now. */
  private async staff(tx: Tx, actor: Actor): Promise<FinCallContext> {
    if (actor.kind !== 'STAFF') throw new Error('a finance import is committed by a staff member');
    return this.contexts.forStaff(actor, await this.holders.companyPermissionsOf(actor.userId, tx));
  }
}
