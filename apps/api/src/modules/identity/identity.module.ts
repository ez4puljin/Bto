import { Inject, Injectable, Module, type OnApplicationBootstrap } from '@nestjs/common';
import { DB } from '../../common/db/db.tokens';
import type { Db } from '../../common/db/db.types';
import { inTransaction } from '../../common/db/transaction';
import { ensureTransitWarehouse, syncAccessCatalog } from './reference-data';
import { AuditService } from './services/audit.service';
import { NumberingService } from './services/numbering.service';
import { OrgService } from './services/org.service';
import { ScopeService } from './services/scope.service';
import { SettingsService } from './services/settings.service';

const CORE_SERVICES = [AuditService, NumberingService, OrgService, ScopeService, SettingsService];

/** Identity services every process may use (api, worker jobs, CLIs). */
@Module({ providers: CORE_SERVICES, exports: CORE_SERVICES })
export class IdentityModule {}

/** Syncs the permission catalog, system roles and TRANSIT before the api serves requests. */
@Injectable()
export class IdentityBootstrap implements OnApplicationBootstrap {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly org: OrgService,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    await inTransaction(this.db, async (tx) => {
      await syncAccessCatalog(tx);
      const transit = await ensureTransitWarehouse(tx);
      if (transit) await this.org.notifyWarehouseCreated(tx, transit);
    });
  }
}

/** The HTTP side of identity (api only): boot sync now; guards and controllers from phase 4 on. */
@Module({ imports: [IdentityModule], providers: [IdentityBootstrap] })
export class IdentityHttpModule {}
