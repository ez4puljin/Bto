// Runs the Expo CLI of this app (`pnpm --filter @tugeel/mobile expo <command>`) without letting it
// rewrite tsconfig.json (EXPO_NO_TYPESCRIPT_SETUP) or report usage (EXPO_NO_TELEMETRY).
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import path from 'node:path';

const appRoot = path.resolve(import.meta.dirname, '..');
const cli = createRequire(path.join(appRoot, 'package.json')).resolve('expo/bin/cli');

export const EXPO_ENV = { EXPO_NO_TYPESCRIPT_SETUP: '1', EXPO_NO_TELEMETRY: '1' };

if (import.meta.main) {
  const result = spawnSync(process.execPath, [cli, ...process.argv.slice(2)], {
    cwd: appRoot,
    stdio: 'inherit',
    env: { ...process.env, ...EXPO_ENV },
  });
  process.exit(result.status ?? 1);
}
