import { createRequire } from 'node:module';
import { readFile, writeFile, mkdir, stat } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { Socket } from 'node:net';
import {
  assertQaUrl,
  assertRunDirectory,
  parseEnvironment,
  withQaDatabase,
  QA_API_PORT,
} from './safety.mjs';
import { installLogicalClock } from './clock.mjs';
import { QA_DATABASE, MONTHS } from './dataset.mjs';

/** Seed-process-only network fence, including native http clients that do not use fetch. */
export function installLoopbackFence() {
  const originalConnect = Socket.prototype.connect;
  const originalFetch = globalThis.fetch;
  const allowedPorts = new Set([15432, QA_API_PORT]);
  Socket.prototype.connect = function (...args) {
    const normalized = Array.isArray(args[0]) ? args[0] : args;
    const first = normalized[0];
    const options =
      typeof first === 'object' && first !== null
        ? first
        : { port: first, host: typeof normalized[1] === 'string' ? normalized[1] : 'localhost' };
    if (
      options.path ||
      !allowedPorts.has(Number(options.port)) ||
      !['127.0.0.1', '::1', 'localhost', undefined].includes(options.host)
    )
      throw new Error('QA process blocks outbound network outside dedicated loopback services');
    return originalConnect.apply(this, args);
  };
  globalThis.fetch = function (input, options) {
    const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url);
    if (url.origin !== `http://127.0.0.1:${QA_API_PORT}` || url.username || url.password)
      throw new Error('QA fetch blocks external origins');
    return originalFetch.call(this, input, options);
  };
  let restored = false;
  return () => {
    if (restored) return;
    restored = true;
    Socket.prototype.connect = originalConnect;
    globalThis.fetch = originalFetch;
  };
}

const readJson = async (path) => JSON.parse(await readFile(path, 'utf8'));

/** No database creation, migration, reset, role/constraint alterations or production launch occurs here. */
export async function startRuntime({ repo, directory, explicitlyEnabled, database, password }) {
  if (explicitlyEnabled !== true || database !== QA_DATABASE || !password)
    throw new Error('Use explicit --apply, exact --database and BTO_QA_PASSWORD');
  const checkout = resolve(repo);
  const runDirectory = assertRunDirectory(checkout, directory);
  await stat(join(checkout, 'node_modules', '@nestjs', 'core', 'package.json'));
  const require = createRequire(join(checkout, 'apps/api/package.json'));
  const pg = require('pg');
  const time = require('@tugeel/shared/time');
  await mkdir(runDirectory, { recursive: true });
  const envFile = join(runDirectory, 'qa.env');
  let env;
  try {
    env = parseEnvironment(await readFile(envFile, 'utf8'));
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    const local = parseEnvironment(await readFile(join(checkout, 'apps/api/.env'), 'utf8'));
    env = {
      NODE_ENV: 'test',
      ROLE: 'api',
      API_PORT: String(QA_API_PORT),
      LOG_LEVEL: 'silent',
      DATABASE_URL: withQaDatabase(local.DATABASE_URL),
      DB_POOL_MAX: '4',
      PGBOSS_POOL_MAX: '2',
      JWT_SECRET: randomBytes(48).toString('hex'),
      AUTH_PEPPER: randomBytes(48).toString('hex'),
      POS_PIN_PEPPER: randomBytes(48).toString('hex'),
      STORAGE_DRIVER: 'local',
      STORAGE_LOCAL_DIR: join(runDirectory, 'storage'),
      COOKIE_SECURE: 'false',
      APP_VERSION: 'isolated-six-month-qa',
      REPORTS_MAX_RUNNING: '1',
      REPORTS_MAX_PER_USER: '1',
    };
    await writeFile(
      envFile,
      Object.entries(env)
        .map(([key, value]) => `${key}=${value}`)
        .join('\n') + '\n',
      { flag: 'wx', mode: 0o600 },
    );
  }
  assertQaUrl(env.DATABASE_URL);
  if (env.NODE_ENV !== 'test' || env.ROLE !== 'api' || env.API_PORT !== String(QA_API_PORT))
    throw new Error('QA environment does not match isolated API configuration');
  const prohibited =
    /^(?:AI_|LLM_|ELEVENLABS_|ERKHET_|MIGRATOR_DATABASE_URL|ADMIN_DATABASE_URL|TEST_ADMIN_DATABASE_URL)/;
  if (Object.keys(env).some((key) => prohibited.test(key)))
    throw new Error('QA environment must contain no provider or admin credentials');
  const affectedKeys = new Set([
    ...Object.keys(env),
    ...Object.keys(process.env).filter((key) => prohibited.test(key)),
  ]);
  const previous = new Map([...affectedKeys].map((key) => [key, process.env[key]]));
  for (const key of affectedKeys) if (prohibited.test(key)) delete process.env[key];
  Object.assign(process.env, env);
  const fenceRestore = installLoopbackFence();
  let clock, app, reader;
  const close = async () => {
    const errors = [];
    try {
      if (app) await app.close();
    } catch (error) {
      errors.push(error);
    }
    try {
      if (reader) await reader.end();
    } catch (error) {
      errors.push(error);
    }
    try {
      clock?.restore();
    } finally {
      fenceRestore();
      for (const [key, value] of previous)
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
    }
    if (errors.length) throw new AggregateError(errors, 'QA runtime shutdown failed');
  };
  try {
    clock = installLogicalClock({
      Client: pg.Client,
      time,
      databaseUrl: env.DATABASE_URL,
      nodeEnv: process.env.NODE_ENV,
      explicitlyEnabled,
    });
    reader = new pg.Client({ connectionString: env.DATABASE_URL });
    await reader.connect();
    const target = await reader.query(
      'SELECT current_database() AS database, current_user AS role',
    );
    if (target.rows[0].database !== QA_DATABASE || target.rows[0].role !== 'app')
      throw new Error('Seed runtime requires the dedicated QA database and normal app role');
    // This connection is exclusively read-only, independently of the application pool.
    await reader.query('SET default_transaction_read_only = on');
    // Migration metadata is intentionally unavailable to app. The parent records the migrator's
    // migration count/hash; here we verify the actual application-visible schema without elevating.
    const required = [
      ['products', 'sku'],
      ['suppliers', 'category_id'],
      ['goods_receipt_lines', 'printed_unit_price'],
      ['goods_receipt_lines', 'printed_price_factor'],
      ['stock_ledger', 'effective_date'],
      ['expiry_sale_allocations', 'loss_amount'],
    ];
    const columns = await reader.query(
      "SELECT table_name, column_name FROM information_schema.columns WHERE table_schema='public'",
    );
    for (const [table, column] of required)
      if (!columns.rows.some((row) => row.table_name === table && row.column_name === column))
        throw new Error(`Provision and migrate QA first: missing visible ${table}.${column}`);
    await reader.query('SELECT id FROM fin.journal_entries LIMIT 0');
    await reader.query('SELECT id FROM fin.open_items LIMIT 0');
    const partitions = await reader.query(
      "SELECT c.relname FROM pg_inherits i JOIN pg_class c ON c.oid=i.inhrelid JOIN pg_class p ON p.oid=i.inhparent WHERE p.relname IN ('stock_snapshot_daily','stock_snapshot_bin_monthly')",
    );
    for (const month of MONTHS)
      for (const table of ['stock_snapshot_daily', 'stock_snapshot_bin_monthly']) {
        const wanted = `${table}_p${month.replace('-', '_')}`;
        if (!partitions.rows.some((row) => row.relname === wanted))
          throw new Error(`Provision missing QA snapshot partition: ${wanted}`);
      }
    const existing = await reader.query(
      'SELECT (SELECT count(*) FROM products)::int AS products, (SELECT count(*) FROM suppliers)::int AS suppliers',
    );
    const manifestPath = join(runDirectory, 'run.json');
    let saved;
    try {
      saved = await readJson(manifestPath);
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
    if (!saved && (existing.rows[0].products || existing.rows[0].suppliers))
      throw new Error('Refusing nonempty database without this generator checkpoint');
    require('reflect-metadata');
    const { NestFactory } = require('@nestjs/core');
    const { AppModule } = require(join(checkout, 'apps/api/dist/app.module.js'));
    const { configureHttpApp, HTTP_APP_OPTIONS } = require(
      join(checkout, 'apps/api/dist/http-app.js'),
    );
    app = await NestFactory.create(AppModule, {
      ...HTTP_APP_OPTIONS,
      logger: false,
      abortOnError: false,
    });
    configureHttpApp(app);
    await app.listen(QA_API_PORT, '127.0.0.1');
    const { DB } = require(join(checkout, 'apps/api/dist/common/db/db.tokens.js'));
    const { createAdmin } = require(
      join(checkout, 'apps/api/dist/modules/identity/cli/create-admin.js'),
    );
    const users = await reader.query(
      "SELECT id, password_hash IS NOT NULL AS password_ready FROM users WHERE username='shiro'",
    );
    let setupCode;
    if (!users.rows.length || !users.rows[0].password_ready)
      setupCode = (
        await createAdmin(app.get(DB), {
          username: 'shiro',
          fullName: 'Shiro · туршилтын админ',
          pepper: env.AUTH_PEPPER,
        })
      ).code;
    const { StockPostingService } = require(
      join(checkout, 'apps/api/dist/modules/inventory/services/stock-posting.service.js'),
    );
    return {
      repo: checkout,
      directory: runDirectory,
      clock,
      app,
      reader,
      require,
      setupCode,
      password,
      shared: { money: require('@tugeel/shared/money'), pos: require('@tugeel/shared/pos') },
      stock: app.get(StockPostingService),
      close,
    };
  } catch (error) {
    try {
      await close();
    } catch (shutdown) {
      throw new AggregateError([error, shutdown], 'QA bootstrap and shutdown failed', {
        cause: shutdown,
      });
    }
    throw error;
  }
}
