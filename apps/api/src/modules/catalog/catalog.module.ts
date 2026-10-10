import { Inject, Injectable, Module, type OnApplicationBootstrap } from '@nestjs/common';
import { DB } from '../../common/db/db.tokens';
import type { Db } from '../../common/db/db.types';
import { inTransaction } from '../../common/db/transaction';
import { IdentityModule } from '../identity';
import { syncSystemUoms } from './reference-data';

const CORE_SERVICES: never[] = [];

/** Catalog services every process may use (api, worker jobs, imports). */
@Module({ imports: [IdentityModule], providers: CORE_SERVICES, exports: CORE_SERVICES })
export class CatalogModule {}

/** Syncs the system units of measure before the api serves requests. */
@Injectable()
export class CatalogBootstrap implements OnApplicationBootstrap {
  constructor(@Inject(DB) private readonly db: Db) {}

  async onApplicationBootstrap(): Promise<void> {
    await inTransaction(this.db, (tx) => syncSystemUoms(tx));
  }
}

/** The HTTP side of the catalog (api only): admin and lookup routes, the boot-time sync. */
@Module({
  imports: [CatalogModule],
  providers: [CatalogBootstrap],
})
export class CatalogHttpModule {}
