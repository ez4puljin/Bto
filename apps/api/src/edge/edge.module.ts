import { type DynamicModule, Global, Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { LoggerModule } from 'nestjs-pino';
import { HttpCoreModule } from '../common/errors/http-core.module';
import { buildLoggerParams } from '../common/logging/logger.config';
import { EdgeConfig, parseEdgeEnv } from './config/edge-env';
import { KioskController } from './controllers/kiosk.controller';
import { EdgeDbModule } from './db/edge-db';
import { EbarimtService } from './ebarimt/ebarimt.service';
import { PosapiClient } from './ebarimt/posapi.client';
import { PrintableCache } from './ebarimt/printable.cache';
import { TaxpayerClient } from './ebarimt/taxpayer.client';
import { KioskGuard } from './guards/kiosk.guard';
import { CentralClient } from './services/central.client';
import { CheckoutService } from './services/checkout.service';
import { CreditGate } from './services/credit-gate.service';
import { CustomerStore } from './services/customer.store';
import { VoucherStore } from './services/voucher.store';
import { DevicesService } from './services/devices.service';
import { KioskAuthService } from './services/kiosk-auth.service';
import { OutboxService } from './services/outbox.service';
import { EdgeParkedService } from './services/parked.service';
import { EdgeReturnsService } from './services/returns.service';
import { EdgeShiftsService } from './services/shifts.service';
import { SnapshotStore } from './services/snapshot.store';
import { SyncRunner } from './services/sync.runner';
import { EdgeVoidsService } from './services/voids.service';

/** Typed access to the edge's environment for every provider. */
@Global()
@Module({ providers: [EdgeConfig], exports: [EdgeConfig] })
class EdgeConfigModule {}

/**
 * The store edge (ADR-0063, ADR-0067), a third process of the api image (`ROLE=edge`): its own
 * database, the snapshot, the kiosk's routes under `/edge/v1`, the outbox to the centre. It shares
 * the api's error format, validation and logging, none of its modules. `forRoot()` reads and
 * validates the environment when it is called (the tests set it first).
 */
@Module({})
export class EdgeModule {
  static forRoot(): DynamicModule {
    return {
      module: EdgeModule,
      imports: [
        ConfigModule.forRoot({
          isGlobal: true,
          envFilePath: '.env.edge',
          ignoreEnvFile: process.env.NODE_ENV === 'test',
          validate: (raw) => parseEdgeEnv(raw),
        }),
        EdgeConfigModule,
        LoggerModule.forRootAsync({
          inject: [EdgeConfig],
          useFactory: (config: EdgeConfig) =>
            buildLoggerParams(
              { NODE_ENV: config.get('NODE_ENV'), LOG_LEVEL: config.get('LOG_LEVEL') },
              'edge',
            ),
        }),
        JwtModule.registerAsync({
          inject: [EdgeConfig],
          useFactory: (config: EdgeConfig) => ({
            secret: config.get('EDGE_JWT_SECRET'),
            signOptions: { algorithm: 'HS256' },
            verifyOptions: { algorithms: ['HS256'] },
          }),
        }),
        HttpCoreModule,
        EdgeDbModule,
      ],
      controllers: [KioskController],
      providers: [
        SnapshotStore,
        CustomerStore,
        VoucherStore,
        CreditGate,
        CentralClient,
        OutboxService,
        SyncRunner,
        DevicesService,
        KioskAuthService,
        EdgeShiftsService,
        CheckoutService,
        EdgeVoidsService,
        EdgeParkedService,
        EdgeReturnsService,
        PosapiClient,
        TaxpayerClient,
        PrintableCache,
        EbarimtService,
        KioskGuard,
      ],
    };
  }
}
