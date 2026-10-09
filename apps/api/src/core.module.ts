import { type DynamicModule, Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { LoggerModule } from 'nestjs-pino';
import { AppConfig } from './common/config/app-config';
import { type Env, parseEnv, type ProcessRole } from './common/config/env.schema';
import { PROCESS_ROLE } from './common/config/process-role';
import { buildLoggerParams } from './common/logging/logger.config';

/** Configuration and logging shared by both entrypoints. */
@Module({})
export class CoreModule {
  static forRoot(role: ProcessRole): DynamicModule {
    return {
      module: CoreModule,
      global: true,
      imports: [
        ConfigModule.forRoot({
          isGlobal: true,
          cache: true,
          envFilePath: '.env',
          ignoreEnvFile: process.env.NODE_ENV === 'test',
          validate: (raw) => parseEnv(raw, role),
        }),
        LoggerModule.forRootAsync({
          inject: [ConfigService],
          useFactory: (config: ConfigService<Env, true>) =>
            buildLoggerParams(
              {
                NODE_ENV: config.get('NODE_ENV', { infer: true }),
                LOG_LEVEL: config.get('LOG_LEVEL', { infer: true }),
              },
              role,
            ),
        }),
      ],
      providers: [AppConfig, { provide: PROCESS_ROLE, useValue: role }],
      exports: [AppConfig, PROCESS_ROLE],
    };
  }
}
