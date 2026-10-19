import { Inject, Injectable, Module, type OnApplicationBootstrap } from '@nestjs/common';
import { DB } from '../../common/db/db.tokens';
import type { Db } from '../../common/db/db.types';
import { inTransaction } from '../../common/db/transaction';
import { ensureDefaultCompany, FinanceCoreModule } from '../../finance-core';
import { IdentityModule, OrgService } from '../identity';
import { CUSTOMER_CHANGED_HOOK, PartnersModule } from '../partners';
import { CompanyController } from './controllers/company.controller';
import { btoInstallationSpec } from './installation';
import { FinCompanyBridge } from './services/company-bridge.service';
import { FinContexts } from './services/contexts.service';
import { FinPartiesBridge } from './services/parties-bridge.service';

/**
 * Makes sure the installation's company, sources, posting keys, legacy party and branches exist
 * before the process serves requests or runs jobs (ADR-0084; the core's `ensureDefaultCompany`,
 * idempotent under an advisory lock). Bto's branches are read at every boot, so a branch added or
 * closed on «Салбар» is mapped at the next start (ACTIVE ones only).
 */
@Injectable()
export class FinBridgeBootstrap implements OnApplicationBootstrap {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly org: OrgService,
    private readonly contexts: FinContexts,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    const spec = btoInstallationSpec({
      companyCode: await this.contexts.companyCode(),
      branches: await this.org.listBranches(),
    });
    await inTransaction(this.db, (tx) => ensureDefaultCompany(tx, spec));
  }
}

const SERVICES = [FinContexts, FinPartiesBridge, FinCompanyBridge];

/**
 * Bto's side of the Finance Core (ADR-0084, docs/modules/fin-bridge.md): the call contexts, the
 * customers' parties through partners' CUSTOMER_CHANGED_HOOK, the company record and the boot step.
 * Imported by the api and the worker (imports create customers there); nothing else imports it.
 */
@Module({
  imports: [IdentityModule, PartnersModule, FinanceCoreModule],
  providers: [
    ...SERVICES,
    FinBridgeBootstrap,
    { provide: CUSTOMER_CHANGED_HOOK, useExisting: FinPartiesBridge },
  ],
  exports: [...SERVICES, CUSTOMER_CHANGED_HOOK],
})
export class FinBridgeModule {}

/** The HTTP side (api only): «Компани». */
@Module({
  imports: [FinBridgeModule],
  controllers: [CompanyController],
})
export class FinBridgeHttpModule {}
