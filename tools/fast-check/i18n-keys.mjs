#!/usr/bin/env node
// Every translation key the web and the staff app name must exist in mn.json (ADR-0213).
// The fast check compiles without i18next's typed keys (they cost a minute and a half and a new key
// rechecked every file), so this scan stands in for them; the full `pnpm typecheck` in CI still types
// every key.
//   node tools/fast-check/i18n-keys.mjs
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const mn = JSON.parse(readFileSync(join(root, 'packages/shared/i18n/mn.json'), 'utf8'));

/** The value at a dotted path, or undefined. */
function at(path) {
  let node = mn;
  for (const part of path.split('.')) {
    if (node === null || typeof node !== 'object' || !(part in node)) return undefined;
    node = node[part];
  }
  return node;
}

const PLURALS = ['_zero', '_one', '_two', '_few', '_many', '_other'];
function exists(key) {
  return at(key) !== undefined || PLURALS.some((suffix) => at(key + suffix) !== undefined);
}

function* sources(dir) {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === 'dist' || name === 'build') continue;
    const path = join(dir, name);
    if (statSync(path).isDirectory()) yield* sources(path);
    else if (/\.(ts|tsx)$/.test(name) && !name.endsWith('.d.ts')) yield path;
  }
}

const KEY = /^[A-Za-z0-9_]+(\.[A-Za-z0-9_-]+)+$/;
// t('a.b'), t("a.b"), i18nKey="a.b": a whole key.
const LITERAL = /(?:\bt\(\s*|i18nKey=\{?\s*)(['"])([^'"\n]+)\1/g;
// t(`a.b.${x}`): the branch before the first placeholder.
const TEMPLATE = /\bt\(\s*`([A-Za-z0-9_.-]+)\.\$\{/g;

const missing = [];
for (const base of ['apps/web/src', 'apps/mobile/app', 'apps/mobile/src']) {
  for (const file of sources(join(root, base))) {
    const text = readFileSync(file, 'utf8');
    const lineOf = (index) => text.slice(0, index).split('\n').length;
    for (const match of text.matchAll(LITERAL)) {
      const key = match[2];
      if (KEY.test(key) && !exists(key))
        missing.push(`${relative(root, file)}:${lineOf(match.index)}  ${key}`);
    }
    for (const match of text.matchAll(TEMPLATE)) {
      const branch = match[1];
      const node = at(branch);
      if (node === null || typeof node !== 'object') {
        missing.push(
          `${relative(root, file)}:${lineOf(match.index)}  ${branch}.* (no such branch)`,
        );
      }
    }
  }
}

if (missing.length > 0) {
  console.error(`mn.json has no such key (${missing.length}):`);
  for (const line of missing) console.error(`  ${line}`);
  process.exit(1);
}
console.log('i18n keys: every named key exists');
