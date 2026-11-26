// `pnpm lint`: ESLint over the whole repository in a few processes, one after another, instead of one.
// The typed rules keep every TypeScript program they load in memory until the process ends; one
// process over everything needed about 9.7 GB on 2026-11-26 and ran out of its 6 GB heap on CI. Split
// by app, the largest group (the web) needs about 5 GB, and the run is a little faster. Every file is
// linted exactly once: the last group is everything outside the groups before it.
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const ESLINT = 'node_modules/eslint/bin/eslint.js';
const GROUPS = ['apps/api', 'apps/web', 'apps/mobile'];
const BASE = [
  '--max-old-space-size=6144',
  ESLINT,
  '--config',
  'eslint.config.mjs',
  '--max-warnings',
  '0',
];

const runs = [
  ...GROUPS.map((group) => ({ name: group, args: [group] })),
  {
    name: 'the rest',
    args: [...GROUPS.flatMap((group) => ['--ignore-pattern', `${group}/**`]), '.'],
  },
];

let failed = false;
for (const run of runs) {
  const started = Date.now();
  const result = spawnSync(process.execPath, [...BASE, ...run.args], {
    cwd: ROOT,
    stdio: 'inherit',
  });
  const seconds = Math.round((Date.now() - started) / 1000);
  if (result.status !== 0) {
    failed = true;
    console.error(`eslint: ${run.name} failed (${result.status ?? result.signal}) in ${seconds}s`);
  } else {
    console.log(`eslint: ${run.name} ok in ${seconds}s`);
  }
}
process.exit(failed ? 1 : 0);
