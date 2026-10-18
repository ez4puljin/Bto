// `pnpm core:standalone` (ADR-0069 #8): the Finance Core compiles on its own, and its build holds only
// its own files, the whitelisted platform files and the allowed packages. Run after the workspace
// packages are built (the api resolves their types from dist, ADR-0025). The classifier is tested by
// standalone.test.mjs.
import { execFileSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  FINANCE_CORE_API_FILES,
  FINANCE_CORE_NPM_PACKAGES,
  FINANCE_CORE_PACKAGES,
} from './whitelist.mjs';

const ROOT = join(import.meta.dirname, '..', '..');
const CORE = 'apps/api/src/finance-core/';
const TSCONFIG = 'apps/api/tsconfig.finance-core.json';

/** Built files of the allowed workspace packages, by path prefix. */
const PACKAGE_PREFIXES = FINANCE_CORE_PACKAGES.map((name) => {
  const [, pkg, subpath] = /^@tugeel\/([^/]+)(?:\/(.+))?$/.exec(name) ?? [];
  if (!pkg) throw new Error(`not a workspace package: ${name}`);
  return subpath ? `packages/${pkg}/dist/${subpath}/` : `packages/${pkg}/dist/`;
});

/** The npm package a node_modules path belongs to, or null. */
export function npmPackageOf(path) {
  const match = /(?:^|\/)node_modules\/((?:@[^/]+\/)?[^/]+)\//.exec(path);
  return match ? match[1] : null;
}

/**
 * Sorts the repository-relative paths of a build into allowed and refused. A path is allowed when
 * it is a core file, a whitelisted api file, a built file of an allowed workspace package, or a
 * file of an allowed npm package.
 */
export function classify(paths) {
  const apiFiles = new Set(FINANCE_CORE_API_FILES.map((file) => `apps/api/${file}`));
  const npm = new Set(FINANCE_CORE_NPM_PACKAGES);
  const allowed = [];
  const refused = [];
  for (const path of paths) {
    const pkg = npmPackageOf(path);
    const ok =
      pkg !== null
        ? npm.has(pkg)
        : path.startsWith(CORE) ||
          apiFiles.has(path) ||
          PACKAGE_PREFIXES.some((prefix) => path.startsWith(prefix));
    (ok ? allowed : refused).push(path);
  }
  return { allowed, refused };
}

function listCoreSources(directory = join(ROOT, CORE)) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return listCoreSources(path);
    return entry.name.endsWith('.ts') && !entry.name.endsWith('.spec.ts')
      ? [relative(ROOT, path).split(sep).join('/')]
      : [];
  });
}

function main() {
  const tsc = join(ROOT, 'node_modules', 'typescript', 'bin', 'tsc');
  const run = (...args) =>
    execFileSync(process.execPath, [tsc, ...args, '-p', TSCONFIG], { cwd: ROOT, encoding: 'utf8' });
  let compiles = true;
  try {
    run('--noEmit');
  } catch (error) {
    compiles = false;
    console.error(error.stdout || error.message);
  }
  const root = ROOT.split(sep).join('/');
  const paths = run('--listFilesOnly')
    .split(/\r?\n/)
    .filter(Boolean)
    .map((path) => {
      const normal = path.split(sep).join('/');
      return normal.startsWith(`${root}/`) ? normal.slice(root.length + 1) : normal;
    });
  const { allowed, refused } = classify(paths);
  const listed = new Set(paths);
  const unlisted = listCoreSources().filter((file) => !listed.has(file));
  const repoFiles = allowed.filter((path) => npmPackageOf(path) === null);
  const packages = [...new Set(allowed.map(npmPackageOf).filter(Boolean))].sort();
  console.log(`core:standalone: ${paths.length} files`);
  for (const file of repoFiles) console.log(`  ${file}`);
  console.log(`  npm: ${packages.join(', ')}`);
  if (refused.length || unlisted.length) {
    for (const path of refused) console.error(`  not allowed: ${path}`);
    for (const path of unlisted) console.error(`  core file outside the build: ${path}`);
    console.error(
      'core:standalone: the core reaches beyond its whitelist (tools/finance-core/whitelist.mjs)',
    );
  }
  if (!compiles) console.error('core:standalone: the Finance Core does not compile on its own');
  if (refused.length || unlisted.length || !compiles) process.exit(1);
  console.log('core:standalone ok');
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) main();
