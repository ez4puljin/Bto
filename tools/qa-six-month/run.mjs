import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { writeFile } from 'node:fs/promises';
import { summary, QA_DATABASE, DAYS, LAST_DAY } from './dataset.mjs';
import { startRuntime } from './runtime.mjs';
import { createJournal } from './journal.mjs';
import { seedCatalogue } from './catalogue.mjs';
import { seedHistory } from './history.mjs';
import { reconcile } from './reconcile.mjs';

export function optionsOf(argv) {
  const options = { apply: false, repo: process.cwd(), through: LAST_DAY };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--apply') options.apply = true;
    else if (arg === '--catalogue-only') options.catalogueOnly = true;
    else if (['--repo', '--directory', '--database', '--through'].includes(arg)) {
      const value = argv[++i];
      if (!value || value.startsWith('--')) throw new Error(`Missing value for ${arg}`);
      options[arg.slice(2)] = value;
    } else throw new Error(`Unknown argument ${arg}`);
  }
  if (!DAYS.includes(options.through))
    throw new Error('--through must be a day in 2026-06-01..2026-11-23');
  if (options.apply && options.database !== QA_DATABASE)
    throw new Error(`--apply requires --database ${QA_DATABASE}`);
  return options;
}

export function throwRunFailures({ failed, error, cleanupErrors }) {
  if (failed && !cleanupErrors.length) throw error;
  if (failed)
    throw new AggregateError([error, ...cleanupErrors], 'QA business action and cleanup failed', {
      cause: error,
    });
  if (cleanupErrors.length)
    throw new AggregateError(cleanupErrors, 'QA runner shutdown failed', {
      cause: cleanupErrors[0],
    });
}

export async function run(argv = process.argv.slice(2)) {
  const options = optionsOf(argv);
  if (!options.apply) {
    process.stdout.write(
      JSON.stringify(
        { ...summary(), execution: 'PREVIEW; no application or database opened' },
        null,
        2,
      ) + '\n',
    );
    return;
  }
  if (!process.env.BTO_QA_PASSWORD)
    throw new Error('Supply the private QA administrator password as BTO_QA_PASSWORD');
  let runtime, journal;
  let failed = false,
    error;
  const cleanupErrors = [];
  try {
    runtime = await startRuntime({
      ...options,
      explicitlyEnabled: true,
      password: process.env.BTO_QA_PASSWORD,
    });
    journal = await createJournal(runtime);
    await seedCatalogue(journal);
    if (!options.catalogueOnly) await seedHistory(journal, options);
    const report = options.catalogueOnly
      ? { status: 'CATALOGUE_ONLY', executedAt: new Date().toISOString(), accepted: false }
      : await reconcile(journal, options.through);
    journal.state.acceptance = report;
    await journal.save();
    await writeFile(
      join(runtime.directory, 'acceptance.json'),
      JSON.stringify(report, null, 2) + '\n',
      { mode: 0o600 },
    );
    process.stdout.write(
      `QA ${report.status}: ${options.through}; API seed process will now close\n`,
    );
    if (report.status === 'FAILED') process.exitCode = 1;
  } catch (failure) {
    failed = true;
    error = failure;
    if (journal) {
      journal.state.failure = { at: new Date().toISOString(), message: failure.message };
      try {
        await journal.save();
      } catch (checkpointFailure) {
        cleanupErrors.push(checkpointFailure);
      }
    }
  } finally {
    // Keep both cleanup paths active even if one of them fails.
    try {
      await journal?.close();
    } catch (error) {
      cleanupErrors.push(error);
    }
    try {
      await runtime?.close();
    } catch (error) {
      cleanupErrors.push(error);
    }
  }
  throwRunFailures({ failed, error, cleanupErrors });
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url)
  run().catch((error) => {
    process.stderr.write(`${error.stack}\n`);
    process.exitCode = 1;
  });
