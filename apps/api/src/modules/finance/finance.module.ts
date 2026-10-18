import { Inject, Injectable, Module, type OnApplicationBootstrap } from '@nestjs/common';
import { DB } from '../../common/db/db.tokens';
import type { Db } from '../../common/db/db.types';
import { inTransaction } from '../../common/db/transaction';
import { JobWorkerService } from '../../common/jobs/worker/job-worker.service';
import { JobsWorkerModule } from '../../common/jobs/worker/jobs-worker.module';
import { CatalogModule } from '../catalog';
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
import { ensureDefaultAccounts } from './reference-data';
import { ArLedgerService } from './services/ar-ledger.service';
import { CreditControlService } from './services/credit-control.service';
import { CreditNotesService } from './services/credit-notes.service';
import { FinanceSettingsService } from './services/finance-settings.service';
import { GlAccountsService } from './services/gl-accounts.service';
import { InvoiceQueryService } from './services/invoice-query.service';
import { InvoicingService } from './services/invoicing.service';
import { JournalService } from './services/journal.service';
import { MoneyAccountsService } from './services/money-accounts.service';
import { PaymentsService } from './services/payments.service';
import { ReceiptMoneyAccountsService } from './services/receipt-money-accounts.service';

const SERVICES = [
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
];

/**
 * Finance I (docs/modules/finance.md, ADR-0060): invoices from sold orders, the receivables
 * ledger, the cash and bank vouchers, credit notes and the general journal. It answers the two
 * hooks of sales (`CREDIT_CHECKER`, `SALE_SINK`); sales finds them through `ModuleRef` and never
 * imports this module.
 */
@Module({
  imports: [IdentityModule, CatalogModule, PartnersModule, InventoryModule],
  providers: [
    ...SERVICES,
    { provide: CREDIT_CHECKER, useExisting: CreditControlService },
    { provide: SALE_SINK, useExisting: InvoicingService },
    { provide: RECEIPT_MONEY_ACCOUNTS, useExisting: ReceiptMoneyAccountsService },
  ],
  exports: [...SERVICES, CREDIT_CHECKER, SALE_SINK, RECEIPT_MONEY_ACCOUNTS],
})
export class FinanceModule {}

/** Inserts the default accounts that are missing before the api serves requests (ADR-0060 #7). */
@Injectable()
export class FinanceBootstrap implements OnApplicationBootstrap {
  constructor(@Inject(DB) private readonly db: Db) {}

  async onApplicationBootstrap(): Promise<void> {
    await inTransaction(this.db, (tx) => ensureDefaultAccounts(tx));
  }
}

/** The HTTP side of finance (api only): the controllers and the boot-time account sync. */
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
  providers: [FinanceBootstrap],
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
