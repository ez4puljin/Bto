import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import {
  configuration,
  assertDatabase,
  healthMatches,
  watchChildren,
  assertQaManifest,
} from './start.mjs';
import { DATASET_ID } from '../qa-six-month/dataset.mjs';

test('main and QA have distinct immutable databases and local API/web ports', () => {
  const main = configuration('main'),
    qa = configuration('qa');
  assert.deepEqual([main.database, main.api, main.web], ['bto_local_shiro', 3300, 5173]);
  assert.deepEqual([qa.database, qa.api, qa.web], ['bto_qa_six_month_20261124', 3301, 5174]);
  assert.equal(main.label, '');
  assert.match(qa.label, /2026/);
  assert.throws(() => configuration('production'));
});

test('a different checkpoint or acceptance identity cannot activate QA browsing', () => {
  const manifest = { dataset: DATASET_ID };
  const accepted = { dataset: DATASET_ID, status: 'PASSED', accepted: true };
  assert.doesNotThrow(() => assertQaManifest(manifest, accepted));
  assert.throws(() => assertQaManifest({ dataset: 'other' }, accepted));
  assert.throws(() => assertQaManifest(manifest, { ...accepted, dataset: 'other' }));
  assert.throws(() => assertQaManifest(manifest, { ...accepted, accepted: false }));
});
test('local-start refuses swapped, remote and URL-overridden database targets', () => {
  const good = 'postgres://app:private@127.0.0.1:15432/bto_local_shiro';
  assert.doesNotThrow(() => assertDatabase(good, 'bto_local_shiro'));
  for (const wrong of [
    good.replace('15432', '5432'),
    good.replace('127.0.0.1', 'remote.example'),
    good.replace('bto_local_shiro', 'bto_qa_six_month_20261124'),
    good + '?options=anything',
    good + '#x',
  ])
    assert.throws(() => assertDatabase(wrong, 'bto_local_shiro'));
});
test('occupied services are reused only for the expected healthy app version', () => {
  assert.equal(healthMatches({ status: 'ok', db: 'up', version: 'dev' }, 'dev'), true);
  assert.equal(
    healthMatches({ status: 'ok', db: 'up', version: 'dev' }, 'isolated-six-month-qa'),
    false,
  );
  assert.equal(healthMatches({ status: 'ok', db: 'down', version: 'dev' }, 'dev'), false);
  assert.equal(healthMatches({ message: 'some other HTTP server' }, 'dev'), false);
});

test('API exit during later web startup is remembered and rejects readiness immediately', async () => {
  const watch = watchChildren(() => false);
  const api = Object.assign(new EventEmitter(), { exitCode: null, signalCode: null });
  const web = Object.assign(new EventEmitter(), { exitCode: null, signalCode: null });
  watch.add(api, 'main-api');
  watch.add(web, 'main-web');
  api.exitCode = 1;
  api.emit('exit', 1, null);
  await assert.rejects(watch.failed, /main-api stopped/);
  assert.throws(() => watch.assertAlive(), /main-api stopped/);
});

test('owned shutdown does not become an unexpected service failure', () => {
  const watch = watchChildren(() => true);
  const child = Object.assign(new EventEmitter(), { exitCode: null, signalCode: null });
  watch.add(child, 'qa-api');
  child.exitCode = 0;
  child.emit('exit', 0, null);
  assert.doesNotThrow(() => watch.assertAlive());
});
