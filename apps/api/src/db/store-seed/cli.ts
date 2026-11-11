import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { Client } from 'pg';
import { z } from 'zod';
import { loadDotEnvIfPresent } from '../../common/config/dotenv';
import type { SeedClass } from './manifest';
import { runStoreSeed, seededFileKeys, type SeedPlan } from './seed';

/**
 * `pnpm store:seed` (ADR-0186 #5, tools/store-seed/README.md): a dry run unless `--apply` is given.
 *
 *   SEED_TARGET_DATABASE_URL   the empty, migrated database, as role migrator (never defaulted)
 *   SEED_SOURCE_DATABASE_URL   the database holding the master data; default: MIGRATOR_DATABASE_URL
 *                              of apps/api/.env (it is only read, in a read-only transaction)
 *
 * Prints table names and row counts only: never a row, never a connection string.
 */
const pgUrl = z.url({ protocol: /^postgres(ql)?$/ });

const HEADINGS: Record<SeedClass, string> = {
  copy: 'COPIED',
  empty: 'LEFT EMPTY',
  undecided: 'NOT DECIDED (left empty)',
};

function where(url: string): string {
  const parsed = new URL(url);
  return `${parsed.hostname}:${parsed.port || '5432'}/${decodeURIComponent(parsed.pathname.slice(1))}`;
}

function printPlan(plan: SeedPlan, print: (line: string) => void): void {
  for (const kind of ['copy', 'empty', 'undecided'] as const) {
    const tables = plan.tables.filter((table) => table.class === kind);
    print('');
    print(`== ${HEADINGS[kind]}: ${tables.length} tables`);
    for (const table of tables) {
      const rows =
        kind === 'copy'
          ? table.copyRows === table.sourceRows
            ? `${table.copyRows} rows`
            : `${table.copyRows} of ${table.sourceRows} rows`
          : `${table.sourceRows} rows stay behind`;
      print(`  ${table.key.padEnd(46)} ${rows.padEnd(24)} ${table.note ?? ''}`.trimEnd());
    }
  }
  if (plan.warnings.length) {
    print('');
    print('== WARNINGS');
    for (const warning of plan.warnings) print(`  ${warning}`);
  }
  if (plan.problems.length) {
    print('');
    print('== PROBLEMS (nothing is copied until these are gone)');
    for (const problem of plan.problems) print(`  ${problem}`);
  }
}

async function sameDatabase(source: Client, target: Client): Promise<boolean> {
  const sql = `SELECT current_database() || '@' || pg_postmaster_start_time()::text AS id`;
  const [a, b] = [await source.query<{ id: string }>(sql), await target.query<{ id: string }>(sql)];
  return a.rows[0]?.id === b.rows[0]?.id;
}

/** `<root>/public/<key>` or `<root>/private/<key>`, whichever holds the object. */
function writeFilesList(keys: string[], storageDir: string, out: string): string {
  const lines: string[] = [];
  let missing = 0;
  for (const key of keys) {
    const found = ['public', 'private'].find((dir) => existsSync(join(storageDir, dir, key)));
    if (found) lines.push(`${found}/${key}`);
    else missing += 1;
  }
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, lines.length ? `${lines.join('\n')}\n` : '');
  return `files list: ${lines.length} files written to ${out}${missing ? `, ${missing} not found under ${storageDir}` : ''}`;
}

async function main(): Promise<void> {
  loadDotEnvIfPresent(join(process.cwd(), '.env'));
  const { values } = parseArgs({
    options: {
      apply: { type: 'boolean', default: false },
      'files-list': { type: 'string' },
      'storage-dir': { type: 'string' },
    },
  });
  const env = z
    .object({
      SEED_SOURCE_DATABASE_URL: pgUrl.optional(),
      MIGRATOR_DATABASE_URL: pgUrl.optional(),
      SEED_TARGET_DATABASE_URL: pgUrl,
      STORAGE_LOCAL_DIR: z.string().optional(),
    })
    .safeParse(process.env);
  if (!env.success) {
    throw new Error(
      'set SEED_TARGET_DATABASE_URL to the empty, migrated database (role migrator); see tools/store-seed/README.md',
    );
  }
  const sourceUrl = env.data.SEED_SOURCE_DATABASE_URL ?? env.data.MIGRATOR_DATABASE_URL;
  if (!sourceUrl) throw new Error('set SEED_SOURCE_DATABASE_URL (or MIGRATOR_DATABASE_URL)');
  const targetUrl = env.data.SEED_TARGET_DATABASE_URL;

  const source = new Client({ connectionString: sourceUrl, application_name: 'bto-store-seed' });
  const target = new Client({ connectionString: targetUrl, application_name: 'bto-store-seed' });
  await source.connect();
  await target.connect();
  try {
    console.log(`source: ${where(sourceUrl)} (read only)`);
    console.log(`target: ${where(targetUrl)}`);
    if (await sameDatabase(source, target)) {
      throw new Error('the source and the target are the same database');
    }
    const result = await runStoreSeed(source, target, {
      dryRun: !values.apply,
      log: (line) => console.log(`  ${line}`),
    });
    printPlan(result.plan, (line) => console.log(line));
    console.log('');
    if (result.plan.problems.length) {
      console.log('Refused: nothing was written.');
      process.exitCode = 2;
      return;
    }
    if (!values.apply) {
      console.log('Dry run: nothing was written. Run again with --apply to copy.');
    } else {
      const rows = result.copied.reduce((sum, table) => sum + table.inserted, 0);
      console.log(
        `Copied ${rows} rows into ${result.copied.length} tables; ${result.sequences} sequences set.`,
      );
    }
    if (values['files-list']) {
      const storageDir = resolve(
        values['storage-dir'] ?? env.data.STORAGE_LOCAL_DIR ?? '../../.data/storage',
      );
      console.log(
        writeFilesList(await seededFileKeys(source), storageDir, resolve(values['files-list'])),
      );
    }
  } finally {
    await source.end();
    await target.end();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
