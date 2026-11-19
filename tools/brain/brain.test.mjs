// The brain's tools (ADR-0213): mn.json merged by key, the key scan, the scripts' syntax, the guard.
//   node --test tools/brain/brain.test.mjs
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { check } from './guard.mjs';
import { merge, parse, print } from './merge-json.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..');
const json = (value) => parse(JSON.stringify(value));
const merged = (base, ours, theirs) => {
  const conflicts = [];
  const result = merge(json(base), json(ours), json(theirs), [], conflicts);
  return { text: print(result), conflicts };
};

test('mn.json keeps its exact text through parse and print', () => {
  const text = readFileSync(join(root, 'packages/shared/i18n/mn.json'), 'utf8');
  assert.equal(`${print(parse(text))}\n`, text);
});

test('keys that look like numbers keep their place', () => {
  const text = '{\n  "b": "1",\n  "130301": "2",\n  "a": "3"\n}';
  assert.equal(print(parse(text)), text);
});

test('two tasks that add keys at the end of one object both land', () => {
  const base = { finance: { save: 'Хадгалах' } };
  const { text, conflicts } = merged(
    base,
    { finance: { save: 'Хадгалах', one: 'Нэг' } },
    { finance: { save: 'Хадгалах', two: 'Хоёр' } },
  );
  assert.deepEqual(conflicts, []);
  assert.deepEqual(JSON.parse(text), { finance: { save: 'Хадгалах', two: 'Хоёр', one: 'Нэг' } });
});

test('a text one side changed and a branch the other side added', () => {
  const base = { a: { x: '1' }, b: '2' };
  const { text, conflicts } = merged(
    base,
    { a: { x: '1!' }, b: '2' },
    { a: { x: '1' }, b: '2', c: { y: '3' } },
  );
  assert.deepEqual(conflicts, []);
  assert.deepEqual(JSON.parse(text), { a: { x: '1!' }, b: '2', c: { y: '3' } });
});

test('a key one side removed stays removed', () => {
  const { text, conflicts } = merged({ a: '1', b: '2' }, { a: '1' }, { a: '1', b: '2', c: '3' });
  assert.deepEqual(conflicts, []);
  assert.deepEqual(JSON.parse(text), { a: '1', c: '3' });
});

test('the same key given two texts is a conflict, named by its path', () => {
  const { conflicts } = merged({ a: { x: '1' } }, { a: { x: 'ours' } }, { a: { x: 'theirs' } });
  assert.deepEqual(conflicts, ['a.x']);
});

test('the same new key with the same text is not a conflict', () => {
  const { conflicts } = merged({}, { a: 'x' }, { a: 'x' });
  assert.deepEqual(conflicts, []);
});

test('every translation key named in the code exists', () => {
  const run = spawnSync(process.execPath, [join(root, 'tools/fast-check/i18n-keys.mjs')], {
    encoding: 'utf8',
  });
  assert.equal(run.status, 0, run.stderr);
});

test('the shell tools parse', () => {
  for (const name of readdirSync(here).filter((file) => file.endsWith('.sh'))) {
    const run = spawnSync('bash', ['-n', join(here, name)], { encoding: 'utf8' });
    assert.equal(run.status, 0, `${name}: ${run.stderr}`);
  }
});

const home = '/home/u';
const dev = `${home}/bto-dev`;
const port = '15433'; // the real system's database

test('the guard blocks what Bto forbids', () => {
  const blocked = [
    ['git commit --no-verify -m x', dev],
    ['git commit -n -m x', dev],
    ['git commit -anm x', dev],
    ['git push --no-verify origin task/x', `${home}/bto-work/x`],
    ['git merge --no-verify task/x', dev],
    ['git rebase --no-verify origin/main', dev],
    ['git add -A', dev],
    ['git add --all', dev],
    ['git add .', dev],
    ['git add :/', dev],
    ['cd apps && git add .', dev],
    ['bash -c "git add -A"', dev],
    ['git -C ~/bto-work/x add -A', home],
    ['docker compose down -v', dev],
    ['docker compose -f docker-compose.yml down --volumes', home],
    ['docker-compose down -v', `${home}/bto`],
    ['git push --force origin main', dev],
    ['git push -f origin main', dev],
    ['git push --force-with-lease origin HEAD:main', dev],
    ['git push origin +main', dev],
    [`psql -h 127.0.0.1 -p ${port} bto`, dev],
    [`DATABASE_URL=postgres://x@127.0.0.1:${port}/bto pnpm db:migrate`, `${home}/bto-work/x`],
  ];
  for (const [command, cwd] of blocked) {
    assert.ok(check(command, cwd, home), `${command} (in ${cwd}) should be blocked`);
  }
});

test('the guard lets the ordinary commands run', () => {
  const allowed = [
    ['git add apps/web/src/x.tsx', dev],
    ['git commit -m "add -A flag docs"', dev],
    ['docker compose up -d --wait', dev],
    ['docker compose down', dev],
    ['git push origin main', dev],
    ['git push --force origin task/x', dev],
    [`psql -h 127.0.0.1 -p ${port} bto`, `${home}/bto`],
    ['git log --oneline', dev],
    ['git add .', `${home}/bto`],
    ['git push -n origin main', dev],
    ['git commit -C HEAD --amend', dev],
    ["git commit -m \"$(cat <<'EOF'\nfix: don't (ever) git add . or down -v\nEOF\n)\"", dev],
    ['cat > notes.txt <<EOF\ngit add -A\nEOF', dev],
    ['echo "git add ." # docker compose down -v', dev],
    ['', dev],
  ];
  for (const [command, cwd] of allowed) {
    assert.equal(check(command, cwd, home), null, `${command} (in ${cwd})`);
  }
});

test('the guard as a hook: exit 2 with a reason, 0 otherwise, 0 on input it cannot read', () => {
  const hook = (input) =>
    spawnSync(process.execPath, [join(here, 'guard.mjs')], { input, encoding: 'utf8' });
  const blocked = hook(JSON.stringify({ tool_input: { command: 'git add -A' }, cwd: dev }));
  assert.equal(blocked.status, 2);
  assert.match(blocked.stderr, /^guard: .*by name/);
  assert.equal(hook(JSON.stringify({ tool_input: { command: 'ls' }, cwd: dev })).status, 0);
  assert.equal(hook('not json').status, 0);
});
