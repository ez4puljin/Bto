// The brain's tools (ADR-0213): mn.json merged by key, the key scan, the scripts' syntax.
//   node --test tools/brain/brain.test.mjs
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
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
