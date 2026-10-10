import type { INestApplicationContext, Provider, Type } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test, type TestingModuleBuilder } from '@nestjs/testing';
import { Client } from 'pg';
import { AppModule } from '../../src/app.module';
import { configureHttpApp } from '../../src/http-app';
import { WorkerModule } from '../../src/worker.module';

export interface HttpAppOptions {
  /** Extra controllers next to AppModule: probe routes for guard and interceptor tests. */
  controllers?: Type<unknown>[];
  /** Extra providers, e.g. a WAREHOUSE_CREATED_HOOK probe. */
  providers?: Provider[];
  /** Provider overrides, e.g. lower throttle limits. */
  override?: (builder: TestingModuleBuilder) => TestingModuleBuilder;
}

/** The HTTP api exactly as main.ts configures it, on this worker's test database. */
export async function createHttpApp(options: HttpAppOptions = {}): Promise<NestExpressApplication> {
  const base = Test.createTestingModule({
    imports: [AppModule],
    controllers: options.controllers ?? [],
    providers: options.providers ?? [],
  });
  const moduleRef = await (options.override ? options.override(base) : base).compile();
  const app = moduleRef.createNestApplication<NestExpressApplication>({ bufferLogs: true });
  configureHttpApp(app);
  await app.init();
  return app;
}

/** The worker context (job handlers registered, loopback health on a random port). */
export async function createWorker(): Promise<INestApplicationContext> {
  const moduleRef = await Test.createTestingModule({ imports: [WorkerModule] }).compile();
  await moduleRef.init();
  return moduleRef;
}

export type Role = 'app' | 'migrator' | 'admin';

/** A plain pg client connected to this worker's database as the given role. */
export async function connectAs(role: Role): Promise<Client> {
  const url =
    role === 'app'
      ? process.env.DATABASE_URL
      : role === 'migrator'
        ? process.env.MIGRATOR_DATABASE_URL
        : process.env.TEST_DATABASE_ADMIN_URL;
  const client = new Client({ connectionString: url, application_name: `tugeel-test-${role}` });
  await client.connect();
  return client;
}

/** The SQLSTATE of a failed query, e.g. 42501 for insufficient privilege. */
export async function sqlStateOf(query: Promise<unknown>): Promise<string | undefined> {
  try {
    await query;
    return undefined;
  } catch (error: unknown) {
    return (error as { code?: string }).code;
  }
}

/** Polls until `check` returns a value or the timeout elapses. */
export async function waitFor<T>(
  check: () => Promise<T | undefined>,
  timeoutMs = 20_000,
  intervalMs = 250,
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await check();
    if (value !== undefined) return value;
    if (Date.now() > deadline) throw new Error(`condition not met within ${timeoutMs} ms`);
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
}
