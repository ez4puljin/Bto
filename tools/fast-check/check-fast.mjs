#!/usr/bin/env node
// The check before a push (ADR-0213): only what the change can have broken, all of it at once, each
// compiler remembering its last run. CI still runs the whole `pnpm check` afterwards.
//
//   pnpm check:fast                 what changed since origin/main (commits, the working tree, new files)
//   pnpm check:fast --base <ref>    what changed since <ref>
//   pnpm check:fast --all           every step, whatever changed
//   pnpm check:fast --no-tests      without the unit tests beside the changed files
//
// Steps, chosen from the changed paths:
//   packages/**      rebuild the packages first (the api compiles against their dist), then every app
//   apps/web/**      tsc -p apps/web/tsconfig.fast.json (incremental, i18n keys as plain strings)
//   apps/mobile/**   tsc -p apps/mobile/tsconfig.fast.json
//   apps/api/**      tsc -p apps/api/tsconfig.json --noEmit --incremental
//   mn.json, web or mobile sources   tools/fast-check/i18n-keys.mjs (every named key exists)
//   changed sources  eslint on those files only; the unit tests beside them (a.tsx → a.test.tsx)
// The compilers' memory lives in .fastcheck/ (gitignored, one per checkout).
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

// At most three checks run on this PC at once, whatever number of tasks finish together: a check
// takes a few gigabytes, and the real system and its apps come first. The fourth waits for a slot.
if (!process.env.BTO_CHECK_SLOT) {
  const slots = Number.parseInt(process.env.BTO_CHECK_SLOTS ?? '3', 10);
  const dir = join(tmpdir(), 'bto-check-slots');
  mkdirSync(dir, { recursive: true });
  let told = false;
  for (;;) {
    for (let slot = 1; slot <= slots; slot += 1) {
      const held = spawnSync(
        'flock',
        [
          '-n',
          '-E',
          '75',
          join(dir, `slot-${slot}`),
          process.execPath,
          fileURLToPath(import.meta.url),
          ...process.argv.slice(2),
        ],
        { stdio: 'inherit', env: { ...process.env, BTO_CHECK_SLOT: String(slot) } },
      );
      if (held.status !== 75) process.exit(held.status ?? 1);
    }
    if (!told) console.log('check:fast: three checks are running; waiting for a free slot');
    told = true;
    spawnSync('sleep', ['3']);
  }
}
const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const option = (name) => (args.includes(name) ? args[args.indexOf(name) + 1] : undefined);
const ALL = flag('--all');
const TESTS = !flag('--no-tests');

function git(...argv) {
  const out = spawnSync('git', argv, { cwd: root, encoding: 'utf8' });
  return out.status === 0 ? out.stdout.trim() : '';
}

const base = option('--base') ?? (git('merge-base', 'HEAD', 'origin/main') || 'HEAD');
const changed = [
  ...new Set(
    [git('diff', '--name-only', base), git('ls-files', '--others', '--exclude-standard')]
      .join('\n')
      .split('\n')
      .filter(Boolean),
  ),
];
const under = (prefix) => changed.filter((file) => file.startsWith(prefix));
const SOURCE = /\.(ts|tsx|mts|cts|js|mjs|cjs)$/;
const sources = changed.filter((file) => SOURCE.test(file) && existsSync(join(root, file)));

// The translations are read by the web and the staff app only: a new key is not a change of a package.
const MN = 'packages/shared/i18n/mn.json';
const translations = changed.includes(MN);
const packages = ALL || under('packages/').some((file) => file !== MN);
const web = ALL || packages || translations || under('apps/web/').length > 0;
const mobile = ALL || packages || translations || under('apps/mobile/').length > 0;
const api = ALL || packages || under('apps/api/').length > 0;
const tsconfigs = ALL || changed.some((file) => /(^|\/)tsconfig[^/]*\.json$/.test(file));

mkdirSync(join(root, '.fastcheck'), { recursive: true });
/** A file inside a dependency as that workspace package resolves it (a package's exports hide its bin). */
function inPackage(dir, name, file) {
  const require = createRequire(join(root, dir, 'package.json'));
  for (const base of require.resolve.paths(name) ?? []) {
    if (existsSync(join(base, name, file))) return join(base, name, file);
  }
  throw new Error(`${name}/${file} not found from ${dir}`);
}
const tsc = inPackage('.', 'typescript', 'bin/tsc');

/** One step: a name, a working directory and a command line. */
const steps = [];
const add = (name, cwd, argv) => steps.push({ name, cwd: join(root, cwd), argv });

if (web || tsconfigs) {
  add('web types', 'apps/web', [tsc, '-p', 'tsconfig.fast.json']);
  add('web node types', 'apps/web', [tsc, '-p', 'tsconfig.node.json']);
}
if (mobile || tsconfigs) {
  add('staff app types', 'apps/mobile', [tsc, '-p', 'tsconfig.fast.json']);
  add('staff app node types', 'apps/mobile', [tsc, '-p', 'tsconfig.node.json']);
}
if (api || tsconfigs) {
  add('api types', 'apps/api', [
    tsc,
    '-p',
    'tsconfig.json',
    '--noEmit',
    '--incremental',
    '--tsBuildInfoFile',
    join(root, '.fastcheck/api.tsbuildinfo'),
  ]);
}
if (packages) {
  for (const name of ['shared', 'api-client', 'fin-contract']) {
    if (existsSync(join(root, 'packages', name, 'tsconfig.json'))) {
      add(`${name} types`, `packages/${name}`, [tsc, '-p', 'tsconfig.json', '--noEmit']);
    }
  }
}
if (web || mobile) {
  add('i18n keys', '.', [join(root, 'tools/fast-check/i18n-keys.mjs')]);
}
if (sources.length > 0) {
  add('eslint (changed files)', '.', [
    '--max-old-space-size=6144',
    inPackage('.', 'eslint', 'bin/eslint.js'),
    '--config',
    'eslint.config.mjs',
    '--max-warnings',
    '0',
    '--no-warn-ignored',
    ...sources,
  ]);
}
if (TESTS) {
  // The tests that sit beside what changed: a.tsx → a.test.tsx, and every changed test itself. The
  // import graph is not followed (one dialog reaches sixty-seven test files through the routes); CI
  // runs every suite, and a guarded change names its own suites.
  const TEST = /\.(test|spec)\.(ts|tsx)$/;
  const beside = new Set();
  for (const file of sources.filter((name) => /\.(ts|tsx)$/.test(name))) {
    if (TEST.test(file)) beside.add(file);
    const stem = file.replace(/\.(ts|tsx)$/, '');
    for (const candidate of [`${stem}.test.ts`, `${stem}.test.tsx`, `${stem}.spec.ts`]) {
      if (existsSync(join(root, candidate))) beside.add(candidate);
    }
  }
  const tests = [...beside];
  for (const [name, dir] of [
    ['web', 'apps/web'],
    ['staff app', 'apps/mobile'],
    ['shared', 'packages/shared'],
    ['api-client', 'packages/api-client'],
    ['fin-contract', 'packages/fin-contract'],
  ]) {
    const mine = tests.filter((file) => file.startsWith(`${dir}/`));
    if (mine.length === 0) continue;
    add(`${name} tests (${mine.length})`, dir, [
      inPackage(dir, 'vitest', 'vitest.mjs'),
      'run',
      '--maxWorkers=4',
      ...mine.map((file) => file.slice(dir.length + 1)),
    ]);
  }
  const apiTests = tests.filter(
    (file) => file.startsWith('apps/api/src/') && file.endsWith('.spec.ts'),
  );
  if (apiTests.length > 0) {
    add(`api tests (${apiTests.length})`, 'apps/api', [
      'scripts/jest.cjs',
      '--selectProjects',
      'unit',
      '--maxWorkers=4',
      '--runTestsByPath',
      ...apiTests.map((file) => file.slice('apps/api/'.length)),
    ]);
  }
}

if (steps.length === 0) {
  console.log(
    `check:fast: nothing to check (${changed.length} changed files since ${base.slice(0, 8)})`,
  );
  process.exit(0);
}

const seconds = (since) => ((Date.now() - since) / 1000).toFixed(1).padStart(6);
const started = Date.now();

// The api compiles against the packages' dist: rebuild it first when a package changed or it is missing.
if (packages || !existsSync(join(root, 'packages/shared/dist'))) {
  const since = Date.now();
  const built = spawnSync('pnpm', ['run', 'build:packages'], {
    cwd: root,
    encoding: 'utf8',
    env: { ...process.env, pnpm_config_verify_deps_before_run: 'false' },
  });
  if (built.status !== 0) {
    console.log(`FAIL ${seconds(since)}s  build packages\n${(built.stdout + built.stderr).trim()}`);
    process.exit(1);
  }
  console.log(`ok   ${seconds(since)}s  build packages`);
}

function run(step) {
  return new Promise((done) => {
    const since = Date.now();
    // Low priority: the development server and the real system on this PC come first.
    const child = spawn('nice', ['-n', '10', process.execPath, ...step.argv], { cwd: step.cwd });
    let output = '';
    child.stdout.on('data', (chunk) => (output += chunk));
    child.stderr.on('data', (chunk) => (output += chunk));
    child.on('close', (status) => {
      const ok = status === 0;
      console.log(`${ok ? 'ok  ' : 'FAIL'} ${seconds(since)}s  ${step.name}`);
      done({ ...step, ok, output });
    });
  });
}

const results = await Promise.all(steps.map(run));
const failed = results.filter((result) => !result.ok);
for (const result of failed) {
  const lines = result.output.trim().split('\n');
  console.log(`\n--- ${result.name} ---`);
  console.log(lines.slice(-80).join('\n'));
}
console.log(
  `\ncheck:fast ${failed.length === 0 ? 'green' : 'RED'} in ${seconds(started).trim()}s ` +
    `(${changed.length} changed files since ${base.slice(0, 8)}, ${steps.length} steps)`,
);
process.exit(failed.length === 0 ? 0 : 1);
