import { join } from 'node:path';
import { loadDotEnvIfPresent } from '../common/config/dotenv';
import { planFromEnv, provisionEnvironment } from './provisioning';

/**
 * `pnpm db:provision` (dev, via tsx) or `node dist/db/provision.js` (container). Needs
 * ADMIN_DATABASE_URL, DATABASE_URL and MIGRATOR_DATABASE_URL; see deploy/runbook.md.
 */
async function main(): Promise<void> {
  loadDotEnvIfPresent(join(process.cwd(), '.env'));
  await provisionEnvironment(planFromEnv(process.env), (line) => console.log(line));
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
