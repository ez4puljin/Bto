import { Injectable, Module, type OnApplicationBootstrap } from '@nestjs/common';
import { JobWorkerService } from '../../common/jobs/worker/job-worker.service';
import { JobsWorkerModule } from '../../common/jobs/worker/jobs-worker.module';
import { FinanceCoreModule } from '../../finance-core';
import { CatalogModule } from '../catalog';
import { EbarimtModule } from '../ebarimt';
import { FinBridgeModule } from '../fin-bridge';
import { IdentityModule } from '../identity';
import {
  InventoryModule,
  PURCHASE_BOOKS,
  RECEIPT_COUNTER_ACCOUNTS,
  RECEIPT_MONEY_ACCOUNTS,
  STOCK_BOOKS,
  STOCK_COUNT_ACCOUNTS,
} from '../inventory';
import { CUSTOMER_DEBT_READER, PartnersModule } from '../partners';
import { CREDIT_CHECKER, SALE_SINK } from '../sales';
import {
  GlAccountsController,
  JournalController,
  MoneyAccountsController,
} from './controllers/books.controller';
import {
  CreditNotesController,
  InvoicesController,
  PaymentsController,
} from './controllers/documents.controller';
import {
  CustomerBalancesController,
  FinanceAttentionController,
  FinanceSettingsController,
} from './controllers/receivables.controller';
import { AllocationsController } from './controllers/allocations.controller';
import { BankStatementsController } from './controllers/bank-statements.controller';
import { SupplierBalancesController } from './controllers/payables.controller';
import { PeriodsController } from './controllers/periods.controller';
import { IssueExpenseAccountsController } from './controllers/issue-expense-accounts.controller';
import { ReportsController } from './controllers/reports.controller';
import { StockCountAccountsController } from './controllers/stock-count-accounts.controller';
import { FinanceReconcileJob } from './jobs/reconcile.job';
import { AllocationsService } from './services/allocations.service';
import { ApLedgerService } from './services/ap-ledger.service';
import { FinPosting } from './services/fin-posting';
import { FinanceImportsService } from './services/finance-imports.service';
import { PeriodsService } from './services/periods.service';
import { LedgerReportsController } from './controllers/ledger-reports.controller';
import { LedgerReportsService } from './services/ledger-reports.service';
import { ReportsService } from './services/reports.service';
import { ArLedgerService } from './services/ar-ledger.service';
import { BankStatementsService } from './services/bank-statements.service';
import { CreditControlService } from './services/credit-control.service';
import { CreditNotesService } from './services/credit-notes.service';
import { PosCreditService } from './services/pos-credit.service';
import { PosVoucherBillingService } from './services/pos-voucher-billing.service';
import { CustomerDebtsService } from './services/customer-debts.service';
import { FinBooks } from './services/fin-books';
import { AccountTransactionsService } from './services/account-transactions.service';
import { FinanceSettingsService } from './services/finance-settings.service';
import { GlAccountsService } from './services/gl-accounts.service';
import { InvoiceQueryService } from './services/invoice-query.service';
import { IssueExpenseAccountsService } from './services/issue-expense-accounts.service';
import { InvoiceEbarimtService } from './services/invoice-ebarimt.service';
import { InvoicingService } from './services/invoicing.service';
import { JournalRepostService } from './services/journal-repost.service';
import { JournalService } from './services/journal.service';
import { MoneyAccountsService } from './services/money-accounts.service';
import { PaymentsService } from './services/payments.service';
import {
  RepCollectionsController,
  SalesRepCollectionsController,
} from './controllers/rep-collections.controller';
import { RepCollectionsService } from './services/rep-collections.service';
import { StatementsController } from './controllers/statements.controller';
import { StatementsService } from './services/statements.service';
import { ReceiptCounterAccountsService } from './services/receipt-counter-accounts.service';
import { ReceiptMoneyAccountsService } from './services/receipt-money-accounts.service';
import { StockBooksService } from './services/stock-books.service';
import { StockCountAccountsService } from './services/stock-count-accounts.service';
import { SupplierBillsService } from './services/supplier-bills.service';

const SERVICES = [
  FinBooks,
  FinPosting,
  AllocationsService,
  FinanceSettingsService,
  AccountTransactionsService,
  GlAccountsService,
  JournalService,
  ArLedgerService,
  ApLedgerService,
  CreditControlService,
  CustomerDebtsService,
  InvoiceQueryService,
  InvoiceEbarimtService,
  InvoicingService,
  MoneyAccountsService,
  PaymentsService,
  CreditNotesService,
  PosCreditService,
  PosVoucherBillingService,
  ReceiptCounterAccountsService,
  ReceiptMoneyAccountsService,
  SupplierBillsService,
  StockBooksService,
  JournalRepostService,
  PeriodsService,
  FinanceImportsService,
  ReportsService,
  LedgerReportsService,
  IssueExpenseAccountsService,
  StockCountAccountsService,
  BankStatementsService,
  RepCollectionsService,
  StatementsService,
];

/**
 * Finance I (docs/modules/finance.md, ADR-0060): invoices from sold orders, the receivables
 * ledger, the cash and bank vouchers, credit notes and the general journal — the chart, the money
 * accounts and the journal kept by the Finance Core since F1's ledger (ADR-0089), reached through
 * fin-bridge's contexts. It answers the two hooks of sales (`CREDIT_CHECKER`, `SALE_SINK`) and
 * inventory's `RECEIPT_MONEY_ACCOUNTS` and `PURCHASE_BOOKS` (the suppliers' payables, F3,
 * ADR-0091), and partners' `CUSTOMER_DEBT_READER` (the overdue reminders, ADR-0101); those modules
 * find them through `ModuleRef` and never import this module.
 */
@Module({
  imports: [
    IdentityModule,
    CatalogModule,
    PartnersModule,
    InventoryModule,
    FinanceCoreModule,
    FinBridgeModule,
    EbarimtModule,
  ],
  providers: [
    ...SERVICES,
    { provide: CREDIT_CHECKER, useExisting: CreditControlService },
    { provide: SALE_SINK, useExisting: InvoicingService },
    { provide: RECEIPT_MONEY_ACCOUNTS, useExisting: ReceiptMoneyAccountsService },
    { provide: RECEIPT_COUNTER_ACCOUNTS, useExisting: ReceiptCounterAccountsService },
    { provide: PURCHASE_BOOKS, useExisting: SupplierBillsService },
    { provide: STOCK_BOOKS, useExisting: StockBooksService },
    { provide: STOCK_COUNT_ACCOUNTS, useExisting: StockCountAccountsService },
    { provide: CUSTOMER_DEBT_READER, useExisting: CustomerDebtsService },
  ],
  exports: [
    ...SERVICES,
    CREDIT_CHECKER,
    SALE_SINK,
    RECEIPT_MONEY_ACCOUNTS,
    RECEIPT_COUNTER_ACCOUNTS,
    PURCHASE_BOOKS,
    STOCK_BOOKS,
    STOCK_COUNT_ACCOUNTS,
    CUSTOMER_DEBT_READER,
  ],
})
export class FinanceModule {}

/**
 * The HTTP side of finance (api only): the controllers. The default chart of an empty company is
 * seeded by fin-bridge's boot step (ADR-0089).
 */
@Module({
  imports: [FinanceModule],
  controllers: [
    InvoicesController,
    CreditNotesController,
    PaymentsController,
    GlAccountsController,
    IssueExpenseAccountsController,
    StockCountAccountsController,
    MoneyAccountsController,
    JournalController,
    LedgerReportsController,
    CustomerBalancesController,
    FinanceAttentionController,
    FinanceSettingsController,
    AllocationsController,
    BankStatementsController,
    SupplierBalancesController,
    PeriodsController,
    ReportsController,
    SalesRepCollectionsController,
    RepCollectionsController,
    StatementsController,
  ],
})
export class FinanceHttpModule {}

/** Registers the finance jobs and their schedules once the worker has started (worker only). */
@Injectable()
export class FinanceJobsBootstrap implements OnApplicationBootstrap {
  constructor(
    private readonly worker: JobWorkerService,
    private readonly reconcile: FinanceReconcileJob,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    await this.worker.register(this.reconcile);
  }
}

/** The worker side of finance: the nightly receivables reconciliation (ADR-0060 #4). */
@Module({
  imports: [FinanceModule, JobsWorkerModule],
  providers: [FinanceReconcileJob, FinanceJobsBootstrap],
})
export class FinanceWorkerModule {}
