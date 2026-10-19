import { Inject, Injectable, Module, type OnApplicationBootstrap } from '@nestjs/common';
import { APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { JwtModule } from '@nestjs/jwt';
import { AppConfig } from '../../common/config/app-config';
import { DB } from '../../common/db/db.tokens';
import type { Db } from '../../common/db/db.types';
import { inTransaction } from '../../common/db/transaction';
import { JobWorkerService } from '../../common/jobs/worker/job-worker.service';
import { JobsWorkerModule } from '../../common/jobs/worker/jobs-worker.module';
import {
  ACCESS_TOKEN_TTL_SECONDS,
  JWT_AUDIENCE,
  JWT_CUSTOMER_AUDIENCE,
  JWT_ISSUER,
} from './auth.constants';
import { AuthController } from './controllers/auth.controller';
import { CustomerAuthController } from './controllers/customer-auth.controller';
import { MobileAuthController } from './controllers/mobile-auth.controller';
import { FilesController } from './controllers/files.controller';
import { AuditController, OrgController, SettingsController } from './controllers/org.controller';
import { RolesController } from './controllers/roles.controller';
import { UsersController } from './controllers/users.controller';
import { AuthGuard } from './guards/auth.guard';
import { ensureTransitWarehouse, syncAccessCatalog } from './reference-data';
import { IdempotencyInterceptor } from './interceptors/idempotency.interceptor';
import { HousekeepingJob } from './jobs/housekeeping.job';
import { AccessService } from './services/access.service';
import { AuditQueryService } from './services/audit-query.service';
import { AuditService } from './services/audit.service';
import { AuthService } from './services/auth.service';
import { CustomerAccessService } from './services/customer-access.service';
import { CustomerAccountsService } from './services/customer-accounts.service';
import { CustomerAuthService } from './services/customer-auth.service';
import { HousekeepingService } from './services/housekeeping.service';
import {
  CustomerLoginLimiter,
  DEFAULT_LOGIN_LIMITS,
  LOGIN_LIMITS,
  LoginLimiter,
} from './services/login-limiter.service';
import { NumberingService } from './services/numbering.service';
import { OrgService } from './services/org.service';
import { PasswordHasher } from './services/password-hasher.service';
import { PermissionHoldersService } from './services/permission-holders.service';
import { RolesService } from './services/roles.service';
import { ScopeService } from './services/scope.service';
import { SettingsService } from './services/settings.service';
import { StorageService } from './services/storage.service';
import { UserNamesService } from './services/user-names.service';
import { UsersService } from './services/users.service';
import { StorageUrlSigner } from './storage/url-signer';

const CORE_SERVICES = [
  AuditService,
  CustomerAccountsService,
  CustomerLoginLimiter,
  LoginLimiter,
  NumberingService,
  OrgService,
  PermissionHoldersService,
  ScopeService,
  SettingsService,
  StorageService,
  UserNamesService,
];

/** Identity services every process may use (api, worker jobs, CLIs). */
@Module({
  providers: [...CORE_SERVICES, { provide: LOGIN_LIMITS, useValue: DEFAULT_LOGIN_LIMITS }],
  exports: CORE_SERVICES,
})
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

/**
 * The HTTP side of identity (api only): the global fail-closed AuthGuard, JWT signing, the login
 * limiter, the auth routes and the boot-time sync (ADR-0027).
 */
@Module({
  imports: [
    IdentityModule,
    JwtModule.registerAsync({
      inject: [AppConfig],
      useFactory: (config: AppConfig) => ({
        secret: config.require('JWT_SECRET'),
        signOptions: {
          algorithm: 'HS256',
          expiresIn: ACCESS_TOKEN_TTL_SECONDS,
          issuer: JWT_ISSUER,
          audience: JWT_AUDIENCE,
        },
        verifyOptions: {
          algorithms: ['HS256'],
          issuer: JWT_ISSUER,
          // Staff and customer app tokens; the guard keeps each kind to its own routes.
          audience: [JWT_AUDIENCE, JWT_CUSTOMER_AUDIENCE],
          clockTolerance: 5,
        },
      }),
    }),
  ],
  controllers: [
    AuthController,
    CustomerAuthController,
    MobileAuthController,
    UsersController,
    RolesController,
    OrgController,
    SettingsController,
    AuditController,
    FilesController,
  ],
  providers: [
    IdentityBootstrap,
    AccessService,
    AuditQueryService,
    AuthService,
    CustomerAccessService,
    CustomerAuthService,
    PasswordHasher,
    RolesService,
    StorageUrlSigner,
    UsersService,
    { provide: APP_GUARD, useClass: AuthGuard },
    { provide: APP_INTERCEPTOR, useClass: IdempotencyInterceptor },
  ],
  exports: [AccessService, AuthService, PasswordHasher],
})
export class IdentityHttpModule {}

/** Registers identity's nightly housekeeping and its schedule once the worker has started. */
@Injectable()
export class IdentityJobsBootstrap implements OnApplicationBootstrap {
  constructor(
    private readonly worker: JobWorkerService,
    private readonly housekeeping: HousekeepingJob,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    await this.worker.register(this.housekeeping);
  }
}

/** The worker side of identity: the nightly housekeeping (ADR-0040). */
@Module({
  imports: [IdentityModule, JobsWorkerModule],
  providers: [HousekeepingService, HousekeepingJob, IdentityJobsBootstrap],
})
export class IdentityWorkerModule {}
