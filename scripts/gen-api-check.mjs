// ADR-0004: the committed API client must match the API. Regenerates it, then compares with git.
// In CI a difference fails the build; locally it only warns, so the regenerated files can be committed.
import { execFileSync, spawnSync } from 'node:child_process';
import { join } from 'node:path';

const ROOT = join(import.meta.dirname, '..');
const generated = ['packages/api-client/openapi.json', 'packages/api-client/src/generated'];

// One fixed command string through the shell (pnpm is a .cmd launcher on Windows).
const result = spawnSync('pnpm run gen:api', { cwd: ROOT, stdio: 'inherit', shell: true });
if (result.status !== 0) process.exit(result.status ?? 1);

const status = execFileSync('git', ['status', '--porcelain', '--', ...generated], {
  cwd: ROOT,
  encoding: 'utf8',
}).trim();

if (!status) {
  console.log('gen:api:check ok (generated API client is up to date)');
} else if (process.env.CI) {
  console.error(`The generated API client is stale. Run \`pnpm gen:api\` and commit:\n${status}`);
  process.exit(1);
} else {
  console.warn(`gen:api:check: the generated API client changed; commit these files:\n${status}`);
}
