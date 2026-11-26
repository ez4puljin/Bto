import { readFile, mkdir } from 'node:fs/promises';
import { openSync, closeSync } from 'node:fs';
import { spawn, spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { parseEnvironment, qaAdminLogin } from '../qa-six-month/safety.mjs';
import { DATASET_ID } from '../qa-six-month/dataset.mjs';

export const ROOT = resolve(fileURLToPath(new URL('../..', import.meta.url)));
export function configuration(mode) {
  if (!['main', 'qa'].includes(mode)) throw new Error('Use start-main.cmd or start-test.cmd');
  return mode === 'main'
    ? { mode, database: 'bto_local_shiro', api: 3300, web: 5173, label: '' }
    : {
        mode,
        database: 'bto_qa_six_month_20261124',
        api: 3301,
        web: 5174,
        label: 'Туршилтын мэдээлэл · 2026.06–11',
      };
}
export function assertDatabase(value, database) {
  const u = new URL(value);
  if (
    !['postgres:', 'postgresql:'].includes(u.protocol) ||
    u.hostname !== '127.0.0.1' ||
    u.port !== '15432' ||
    u.pathname !== '/' + database ||
    u.search ||
    u.hash
  )
    throw new Error('Refusing unexpected database target (connection details suppressed)');
}
export function healthMatches(data, version) {
  return data?.status === 'ok' && data?.db === 'up' && data?.version === version;
}
export function assertQaManifest(manifest, accepted) {
  if (manifest.dataset !== DATASET_ID || accepted.dataset !== DATASET_ID)
    throw new Error('QA checkpoint and acceptance must identify this exact dataset');
  if (accepted.accepted !== true || accepted.status !== 'PASSED')
    throw new Error('QA history is not accepted');
}
export async function environment(config) {
  const file = config.mode === 'main' ? 'apps/api/.env' : '.data/local-dev/qa-six-month/qa.env';
  const values = parseEnvironment(await readFile(join(ROOT, file), 'utf8'));
  assertDatabase(values.DATABASE_URL, config.database);
  if (values.API_PORT !== String(config.api))
    throw new Error('Configured API port differs from launcher');
  if (config.mode === 'qa') {
    const manifest = JSON.parse(
      await readFile(join(ROOT, '.data/local-dev/qa-six-month/run.json'), 'utf8'),
    );
    const accepted = JSON.parse(
      await readFile(join(ROOT, '.data/local-dev/qa-six-month/acceptance.json'), 'utf8'),
    );
    assertQaManifest(manifest, accepted);
  }
  return values;
}
export async function verifyDatabase(config, values) {
  const require = createRequire(join(ROOT, 'apps/api/package.json'));
  const { Client } = require('pg');
  const client = new Client({
    connectionString: values.DATABASE_URL,
    connectionTimeoutMillis: 5000,
  });
  await client.connect();
  try {
    await client.query('BEGIN READ ONLY');
    const row = (await client.query('SELECT current_database() AS database, current_user AS role'))
      .rows[0];
    if (row.database !== config.database || row.role !== 'app')
      throw new Error('Expected local app database role');
    if (config.mode === 'qa') {
      const users = await client.query(
        'SELECT id FROM users WHERE username=$1 AND password_hash IS NOT NULL',
        [qaAdminLogin(values)],
      );
      if (users.rows.length !== 1)
        throw new Error('QA administrator must already exist; startup never creates one');
    }
    await client.query('COMMIT');
  } finally {
    await client.end();
  }
}
async function ensurePostgres() {
  const bin = join(ROOT, '.data/local-dev/runtime/postgresql/pgsql/bin');
  const ready = spawnSync(join(bin, 'pg_isready.exe'), ['-h', '127.0.0.1', '-p', '15432'], {
    windowsHide: true,
    timeout: 5000,
  });
  if (ready.status === 0) return;
  const data = join(ROOT, '.data/local-dev/pg18');
  if ((await readFile(join(data, 'PG_VERSION'), 'utf8')).trim() !== '18')
    throw new Error('Existing PostgreSQL 18 data directory is required');
  const started = spawnSync(
    join(bin, 'pg_ctl.exe'),
    ['-D', data, '-l', join(ROOT, '.data/local-dev/pg-start.log'), '-w', '-t', '60', 'start'],
    { cwd: ROOT, windowsHide: true, timeout: 65000, stdio: 'ignore' },
  );
  if (started.status !== 0)
    throw new Error('PostgreSQL start failed; see .data/local-dev/pg-start.log');
}
async function health(port, version) {
  try {
    const response = await fetch(`http://127.0.0.1:${port}/health`, {
      signal: AbortSignal.timeout(1800),
    });
    if (!response.ok || !healthMatches(await response.json(), version))
      throw new Error('Unexpected health response');
    return true;
  } catch (error) {
    if (error.cause?.code === 'ECONNREFUSED') return false;
    throw new Error(
      `Port ${port} is occupied or unresponsive; its existing process was not stopped`,
      { cause: error },
    );
  }
}
export function watchChildren(isStopping) {
  const owned = [];
  let failure, rejectFailure;
  const failed = new Promise((_, reject) => {
    rejectFailure = reject;
  });
  void failed.catch(() => {}); // Startup also checks synchronously; keep early rejection handled.
  const record = (label, cause) => {
    if (isStopping() || failure) return;
    failure = new Error(`${label} stopped; see .data/local-dev/local-start/${label}.log`, {
      cause,
    });
    rejectFailure(failure);
  };
  return {
    failed,
    add(child, label) {
      owned.push({ child, label });
      child.on('error', (error) => record(label, error));
      child.once('exit', () => record(label));
    },
    assertAlive() {
      for (const { child, label } of owned)
        if (child.exitCode !== null || child.signalCode !== null) record(label);
      if (failure) throw failure;
    },
  };
}
export async function run(mode) {
  const config = configuration(mode),
    values = await environment(config);
  await ensurePostgres();
  await verifyDatabase(config, values);
  const version = config.mode === 'qa' ? 'isolated-six-month-qa' : (values.APP_VERSION ?? 'dev');
  const logDir = join(ROOT, '.data/local-dev/local-start');
  await mkdir(logDir, { recursive: true });
  const children = [];
  let stopping = false;
  const watch = watchChildren(() => stopping);
  const stop = async () => {
    if (stopping) return;
    stopping = true;
    await Promise.all(
      children.map(async (child) => {
        if (!child.pid || child.exitCode !== null || child.signalCode !== null) return;
        const closed = new Promise((done) => child.once('exit', done));
        if (child.connected) child.send('shutdown');
        await Promise.race([closed, delay(15000)]);
        // Last-resort cleanup targets only a child created by this exact launcher, never a port/name.
        if (child.exitCode === null && child.signalCode === null) child.kill('SIGTERM');
        await closed;
      }),
    );
  };
  const onSignal = () => {
    void stop().then(() => process.exit(0));
  };
  process.on('SIGINT', onSignal);
  process.on('SIGTERM', onSignal);
  try {
    for (const [kind, port] of [
      ['api', config.api],
      ['web', config.web],
    ]) {
      if (stopping) return;
      watch.assertAlive();
      if (await Promise.race([health(port, version), watch.failed])) {
        console.log(`Reusing ${mode} ${kind} on ${port}`);
        continue;
      }
      const fd = openSync(join(logDir, `${mode}-${kind}.log`), 'a');
      let child;
      try {
        child = spawn(process.execPath, [join(ROOT, 'tools/local-start/child.mjs'), kind, mode], {
          cwd: ROOT,
          env: {
            ...process.env,
            NODE_OPTIONS: '',
            VSCODE_INSPECTOR_OPTIONS: '',
            POWERSHELL_TELEMETRY_OPTOUT: '1',
            DOTNET_CLI_TELEMETRY_OPTOUT: '1',
            OTEL_SDK_DISABLED: 'true',
            DO_NOT_TRACK: '1',
          },
          windowsHide: true,
          stdio: ['ignore', fd, fd, 'ipc'],
        });
      } finally {
        closeSync(fd);
      }
      children.push(child);
      watch.add(child, `${mode}-${kind}`);
      const deadline = Date.now() + 180000;
      while (true) {
        if (stopping) return;
        watch.assertAlive();
        if (await Promise.race([health(port, version), watch.failed])) break;
        if (Date.now() > deadline)
          throw new Error(`${mode} ${kind} startup timed out; see its local-start log`);
        await Promise.race([delay(500), watch.failed]);
      }
    }
    watch.assertAlive();
    console.log(`READY: http://127.0.0.1:${config.web}`);
    if (!children.length) return;
    console.log('Keep this window open. Ctrl+C stops only the services started by this window.');
    await watch.failed;
  } finally {
    await stop();
    process.off('SIGINT', onSignal);
    process.off('SIGTERM', onSignal);
  }
}
if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url)
  run(process.argv[2]).catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
