import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { EDGE_DEVICE_HEADER } from '@tugeel/shared/pos';
import { Client, escapeIdentifier } from 'pg';
import request from 'supertest';
import { withDatabase } from '../../src/db/provisioning';
import { runEdgeMigrations } from '../../src/edge/db/migrate';
import { configureEdgeHttpApp, EDGE_APP_OPTIONS } from '../../src/edge/edge-http';
import { EdgeModule } from '../../src/edge/edge.module';
import { loadTestEnv } from './test-env';

/**
 * The store edge in tests (ADR-0067): a database of its own per Jest worker, dropped and created,
 * then migrated; the edge app on it with its timers off, replaying to a centre the test runs.
 */
export async function edgeDatabase(): Promise<string> {
  const env = loadTestEnv();
  const name = `${env.prefix}_edge_w${process.env.JEST_WORKER_ID ?? '1'}`;
  const admin = new Client({
    connectionString: env.adminUrl,
    application_name: 'tugeel-test-edge',
  });
  await admin.connect();
  try {
    await admin.query(`DROP DATABASE IF EXISTS ${escapeIdentifier(name)} WITH (FORCE)`);
    await admin.query(`CREATE DATABASE ${escapeIdentifier(name)}`);
  } finally {
    await admin.end();
  }
  const url = withDatabase(env.adminUrl, name);
  await runEdgeMigrations(url, () => undefined);
  return url;
}

export async function createEdgeApp(options: {
  databaseUrl: string;
  centralUrl: string;
  nodeToken: string;
  /** ADR-0065: the store PosAPI and the taxpayer lookup (fakes the test runs); absent = fake receipts. */
  ebarimt?: { posapiUrl: string; lookupUrl: string; timeoutMs?: number };
}): Promise<NestExpressApplication> {
  process.env.EBARIMT_PROVIDER = options.ebarimt ? 'posapi' : 'fake';
  if (options.ebarimt) {
    process.env.POSAPI_URL = options.ebarimt.posapiUrl;
    process.env.EBARIMT_BRANCH_NO = '01';
    process.env.EBARIMT_LOOKUP_URL = options.ebarimt.lookupUrl;
    process.env.POSAPI_TIMEOUT_MS = String(options.ebarimt.timeoutMs ?? 2_000);
  } else {
    delete process.env.POSAPI_URL;
    delete process.env.EBARIMT_BRANCH_NO;
    delete process.env.EBARIMT_LOOKUP_URL;
    delete process.env.POSAPI_TIMEOUT_MS;
  }
  process.env.EDGE_DATABASE_URL = options.databaseUrl;
  process.env.CENTRAL_API_URL = options.centralUrl;
  process.env.EDGE_NODE_TOKEN = options.nodeToken;
  process.env.EDGE_JWT_SECRET = 'test-edge-session-key-0123456789abcdef';
  process.env.POS_PIN_PEPPER = process.env.POS_PIN_PEPPER ?? process.env.AUTH_PEPPER;
  process.env.EDGE_TIMERS = 'false';
  process.env.EDGE_PORT = '0';
  const moduleRef = await Test.createTestingModule({ imports: [EdgeModule.forRoot()] }).compile();
  const app = moduleRef.createNestApplication<NestExpressApplication>(EDGE_APP_OPTIONS);
  configureEdgeHttpApp(app);
  await app.init();
  return app;
}

/** The kiosk's calls: a bound device and, after the PIN, a cashier's session. */
export function kioskApi(app: NestExpressApplication) {
  let device = '';
  let session = '';
  const http = () => request(app.getHttpServer());
  const headers = () => ({
    [EDGE_DEVICE_HEADER]: device,
    ...(session ? { authorization: `Bearer ${session}` } : {}),
  });
  return {
    setDevice(token: string) {
      device = token;
    },
    setSession(token: string) {
      session = token;
    },
    get: (path: string) => http().get(`/edge/v1${path}`).set(headers()),
    post: (path: string, body?: object) =>
      http()
        .post(`/edge/v1${path}`)
        .set(headers())
        .send(body ?? {}),
  };
}
