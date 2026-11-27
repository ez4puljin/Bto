import { createRequire } from 'node:module';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { ROOT, configuration, environment, verifyDatabase } from './start.mjs';

const [kind, mode] = process.argv.slice(2);
const config = configuration(mode);
if (!['api', 'web'].includes(kind)) throw new Error('Unknown local service');
let close,
  stopping = false;
async function shutdown() {
  if (stopping) return;
  stopping = true;
  try {
    if (close) await close();
    process.exit(0);
  } catch {
    console.error('Local service shutdown failed');
    process.exit(1);
  }
}
process.on('message', (message) => {
  if (message === 'shutdown') void shutdown();
});
process.on('disconnect', () => {
  void shutdown();
});
if (kind === 'web') {
  process.env.API_PORT = String(config.api);
  process.env.VITE_QA_LABEL = config.label;
  process.chdir(join(ROOT, 'apps/web'));
  const require = createRequire(join(ROOT, 'apps/web/package.json'));
  const { createServer } = await import(pathToFileURL(require.resolve('vite')).href);
  const server = await createServer({
    server: { port: config.web, host: '127.0.0.1', strictPort: true },
  });
  close = () => server.close();
  await server.listen();
} else if (mode === 'qa') {
  await verifyDatabase(config, await environment(config));
  const { startRuntime } = await import('../qa-six-month/runtime.mjs');
  const runtime = await startRuntime({
    repo: ROOT,
    database: config.database,
    explicitlyEnabled: true,
    password: 'existing-user-browse-only',
    browseOnly: true,
  });
  runtime.clock.restore();
  close = () => runtime.close();
} else {
  Object.assign(process.env, await environment(config), { ROLE: 'api' });
  process.chdir(join(ROOT, 'apps/api'));
  close = async () => {
    if (process.listenerCount('SIGTERM')) {
      process.emit('SIGTERM');
      await new Promise(() => {}); // Nest's shutdown hooks own the final process exit.
    }
  };
  createRequire(join(ROOT, 'apps/api/package.json'))(join(ROOT, 'apps/api/dist/main.js'));
}
console.log(`${mode} ${kind} started`);
