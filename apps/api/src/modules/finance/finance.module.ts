import { Injectable, Module, type OnApplicationBootstrap } from '@nestjs/common';
import { JobWorkerService } from '../../common/jobs/worker/job-worker.service';
import { JobsWorkerModule } from '../../common/jobs/worker/jobs-worker.module';
import { FinanceCoreModule } from '../../finance-core';
import { CatalogModule } from '../catalog';
import { FinBridgeModule } from '../fin-bridge';
import { IdentityModule } from '../identity';
import { InventoryModule, RECEIPT_MONEY_ACCOUNTS } from '../inventory';
import { PartnersModule } from '../partners';
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
import { FinanceReconcileJob } from './jobs/reconcile.job';
import { ArLedgerService } from './services/ar-ledger.service';
import { CreditControlService } from './services/credit-control.service';
import { CreditNotesService } from './services/credit-notes.service';
import { FinBooks } from './services/fin-books';
import { FinanceSettingsService } from './services/finance-settings.service';
import { GlAccountsService } from './services/gl-accounts.service';
import { InvoiceQueryService } from './services/invoice-query.service';
import { InvoicingService } from './services/invoicing.service';
import { JournalRepostService } from './services/journal-repost.service';
import { JournalService } from './services/journal.service';
import { MoneyAccountsService } from './services/money-accounts.service';
import { PaymentsService } from './services/payments.service';
import { ReceiptMoneyAccountsService } from './services/receipt-money-accounts.service';

const SERVICES = [
  FinBooks,
  FinanceSettingsService,
  GlAccountsService,
  JournalService,
  ArLedgerService,
  CreditControlService,
  InvoiceQueryService,
  InvoicingService,
  MoneyAccountsService,
  PaymentsService,
  CreditNotesService,
  ReceiptMoneyAccountsService,
  JournalRepostService,
];

/**
 * Finance I (docs/modules/finance.md, ADR-0060): invoices from sold orders, the receivables
 * ledger, the cash and bank vouchers, credit notes and the general journal — the chart, the money
 * accounts and the journal kept by the Finance Core since F1's ledger (ADR-0089), reached through
 * fin-bridge's contexts. It answers the two hooks of sales (`CREDIT_CHECKER`, `SALE_SINK`); sales
 * finds them through `ModuleRef` and never imports this module.
 */
@Module({
  imports: [
    IdentityModule,
    CatalogModule,
    PartnersModule,
    InventoryModule,
    FinanceCoreModule,
    FinBridgeModule,
  ],
  providers: [
    ...SERVICES,
    { provide: CREDIT_CHECKER, useExisting: CreditControlService },
    { provide: SALE_SINK, useExisting: InvoicingService },
    { provide: RECEIPT_MONEY_ACCOUNTS, useExisting: ReceiptMoneyAccountsService },
  ],
  exports: [...SERVICES, CREDIT_CHECKER, SALE_SINK, RECEIPT_MONEY_ACCOUNTS],
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
    MoneyAccountsController,
    JournalController,
    CustomerBalancesController,
    FinanceAttentionController,
    FinanceSettingsController,
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
