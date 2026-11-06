import { Injectable } from '@nestjs/common';
import { type AccountJournal, taxSplit } from '@tugeel/shared/finance';
import { Decimal } from '@tugeel/shared/money';
import { businessDate } from '@tugeel/shared/time';
import { invalid } from '../../../common/errors/app-error';
import { TaxService } from '../../catalog';
import type { AuthContext } from '../../identity';
import { type GlAccount, GlAccountsService } from './gl-accounts.service';
import { type JournalLineInput, JournalService } from './journal.service';
import { MoneyAccountsService } from './money-accounts.service';

/** Who a line is for: a customer or a supplier, never both. */
export interface TransactionParty {
  customerId?: number | null;
  supplierId?: number | null;
}

export interface AccountTransactionInput {
  journal: AccountJournal;
  entryDate: string;
  description: string;
  accountId: number;
  /** The chosen account's side; the form turns «Орлого», «Үүсгэх» and the like into it. */
  side: 'DEBIT' | 'CREDIT';
  counterAccountId: number;
  amount: string;
  party?: TransactionParty | null;
  /** «Харилцсан ялгаатай харилцагч»; left out: the same party. */
  counterParty?: TransactionParty | null;
  withVat?: boolean;
  withCityTax?: boolean;
}

const MONEY_JOURNALS: readonly AccountJournal[] = ['CASH', 'BANK', 'MONEY'];
const POSTABLE: readonly AccountJournal[] = [
  'GENERAL',
  'CASH',
  'BANK',
  'MONEY',
  'RECEIVABLE_PAYABLE',
  'VAT',
  'FIXED_ASSET',
];

/**
 * A transaction by the account's journal (ADR-0150, Erkhet's «Касс», «Харилцах», «Авлага өглөг»,
 * «НӨАТ», «Ерөнхий журнал»): one form, one chosen account of that journal against a counter
 * account, with the tax split out of a tax-inclusive amount. It always balances: Bto has no
 * one-sided «бүрэн бус баримт». It posts as a manual entry (`JournalService.postManual`), so the
 * core's rules on money accounts and parties hold, and it is reversed like one. Stock accounts
 * only move through the warehouse's documents, or the books would leave the stock ledger.
 */
@Injectable()
export class AccountTransactionsService {
  constructor(
    private readonly accounts: GlAccountsService,
    private readonly journal: JournalService,
    private readonly money: MoneyAccountsService,
    private readonly tax: TaxService,
  ) {}

  async post(ctx: AuthContext, input: AccountTransactionInput, key?: string | null) {
    if (!POSTABLE.includes(input.journal)) {
      throw invalid('journal', 'stockDocuments', 'stock accounts move through stock documents');
    }
    const amount = new Decimal(input.amount);
    if (amount.lte(0)) throw invalid('amount', 'positive', 'an amount above zero');
    if (input.counterAccountId === input.accountId) {
      throw invalid('counterAccountId', 'different', 'another account');
    }
    const found = await this.accounts.activeByIds(
      [input.accountId, input.counterAccountId],
      (index) => (index === 0 ? 'accountId' : 'counterAccountId'),
    );
    const account = found.get(input.accountId) as GlAccount;
    const counter = found.get(input.counterAccountId) as GlAccount;
    if (account.journal !== input.journal) {
      throw invalid('accountId', 'ofJournal', 'an account of this journal');
    }
    if (counter.journal === 'INVENTORY') {
      throw invalid('counterAccountId', 'stockDocuments', 'stock accounts move through documents');
    }

    const debit = input.side === 'DEBIT';
    const split = await this.taxes(input, amount, debit);
    const lines: JournalLineInput[] = [
      await this.line(account, input.side, amount, input.party ?? null),
      await this.line(
        counter,
        debit ? 'CREDIT' : 'DEBIT',
        split.net,
        input.counterParty ?? input.party ?? null,
      ),
    ];
    if (split.vat.gt(0)) {
      lines.push(
        debit
          ? { role: 'VAT_PAYABLE', debit: new Decimal(0), credit: split.vat }
          : { role: 'VAT_INPUT', debit: split.vat, credit: new Decimal(0) },
      );
    }
    if (split.cityTax.gt(0)) {
      lines.push({ role: 'CITY_TAX_PAYABLE', debit: new Decimal(0), credit: split.cityTax });
    }
    const resolved = await Promise.all(
      lines.map(async (line) =>
        line.role
          ? { ...line, accountId: (await this.accounts.byRole(line.role)).id, role: undefined }
          : line,
      ),
    );
    return this.journal.postManual(
      ctx,
      { entryDate: input.entryDate, description: input.description, lines: resolved },
      key,
    );
  }

  /** A sale side (money in) splits VAT and city tax; a purchase side only VAT (ADR-0150). */
  private async taxes(input: AccountTransactionInput, amount: Decimal, debit: boolean) {
    if (!input.withVat && !input.withCityTax) {
      return { net: amount, vat: new Decimal(0), cityTax: new Decimal(0) };
    }
    const rates = await this.tax.companyRates(input.entryDate || businessDate());
    const vatRate = input.withVat ? rates.vatRatePct : new Decimal(0);
    const cityRate = input.withCityTax && debit ? rates.cityTaxRatePct : new Decimal(0);
    const split = taxSplit(amount, vatRate, cityRate);
    return {
      net: amount.minus(split.vat).minus(split.cityTax),
      vat: split.vat,
      cityTax: split.cityTax,
    };
  }

  private async line(
    account: GlAccount,
    side: 'DEBIT' | 'CREDIT',
    amount: Decimal,
    party: TransactionParty | null,
  ): Promise<JournalLineInput> {
    const zero = new Decimal(0);
    const line: JournalLineInput = {
      accountId: account.id,
      debit: side === 'DEBIT' ? amount : zero,
      credit: side === 'CREDIT' ? amount : zero,
    };
    if (MONEY_JOURNALS.includes(account.journal)) {
      const box = (await this.money.list()).find(
        (row) => row.glAccountId === account.id && row.status === 'ACTIVE',
      );
      if (box) line.moneyAccountId = box.id;
    }
    if (party) {
      if (party.customerId != null) line.customerId = party.customerId;
      else if (party.supplierId != null) line.supplierId = party.supplierId;
    }
    return line;
  }
}
