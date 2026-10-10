import { Inject, Injectable, Module, type OnApplicationBootstrap } from '@nestjs/common';
import { APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { JwtModule } from '@nestjs/jwt';
import { AppConfig } from '../../common/config/app-config';
import { DB } from '../../common/db/db.tokens';
import type { Db } from '../../common/db/db.types';
import { inTransaction } from '../../common/db/transaction';
import { ACCESS_TOKEN_TTL_SECONDS, JWT_AUDIENCE, JWT_ISSUER } from './auth.constants';
import { AuthController } from './controllers/auth.controller';
import { FilesController } from './controllers/files.controller';
import { AuditController, OrgController, SettingsController } from './controllers/org.controller';
import { RolesController } from './controllers/roles.controller';
import { UsersController } from './controllers/users.controller';
import { AuthGuard } from './guards/auth.guard';
import { ensureTransitWarehouse, syncAccessCatalog } from './reference-data';
import { IdempotencyInterceptor } from './interceptors/idempotency.interceptor';
import { AccessService } from './services/access.service';
import { AuditQueryService } from './services/audit-query.service';
import { AuditService } from './services/audit.service';
import { AuthService } from './services/auth.service';
import { DEFAULT_LOGIN_LIMITS, LOGIN_LIMITS, LoginLimiter } from './services/login-limiter.service';
import { NumberingService } from './services/numbering.service';
import { OrgService } from './services/org.service';
import { PasswordHasher } from './services/password-hasher.service';
import { RolesService } from './services/roles.service';
import { ScopeService } from './services/scope.service';
import { SettingsService } from './services/settings.service';
import { StorageService } from './services/storage.service';
import { UsersService } from './services/users.service';
import { StorageUrlSigner } from './storage/url-signer';

const CORE_SERVICES = [
  AuditService,
  NumberingService,
  OrgService,
  ScopeService,
  SettingsService,
  StorageService,
];

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
          audience: JWT_AUDIENCE,
          clockTolerance: 5,
        },
      }),
    }),
  ],
  controllers: [
    AuthController,
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
    PasswordHasher,
    LoginLimiter,
    RolesService,
    StorageUrlSigner,
    UsersService,
    { provide: LOGIN_LIMITS, useValue: DEFAULT_LOGIN_LIMITS },
    { provide: APP_GUARD, useClass: AuthGuard },
    { provide: APP_INTERCEPTOR, useClass: IdempotencyInterceptor },
  ],
  exports: [AccessService, AuthService, PasswordHasher],
})
export class IdentityHttpModule {}
