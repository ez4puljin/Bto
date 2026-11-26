import assert from 'node:assert/strict';
import test from 'node:test';
import { optionsOf, throwRunFailures } from './run.mjs';
import { QA_DATABASE } from './dataset.mjs';

test('cleanup failures preserve the original business failure and every cleanup cause', () => {
  const original = new Error('business write failed'),
    checkpoint = new Error('checkpoint failed'),
    shutdown = new Error('shutdown failed');
  assert.throws(
    () => throwRunFailures({ failed: true, error: original, cleanupErrors: [] }),
    (failure) => failure === original,
  );
  assert.throws(
    () =>
      throwRunFailures({ failed: true, error: original, cleanupErrors: [checkpoint, shutdown] }),
    (failure) => {
      assert.equal(failure.cause, original);
      assert.deepEqual(failure.errors, [original, checkpoint, shutdown]);
      return true;
    },
  );
  assert.throws(
    () => throwRunFailures({ failed: false, cleanupErrors: [shutdown] }),
    (failure) => failure.cause === shutdown && failure.errors[0] === shutdown,
  );
  assert.doesNotThrow(() => throwRunFailures({ failed: false, cleanupErrors: [] }));
});

test('runner defaults to a read-only preview and refuses accidental target/window changes', () => {
  assert.equal(optionsOf([]).apply, false);
  assert.equal(
    optionsOf(['--apply', '--repo', '/explicit-checkout', '--database', QA_DATABASE]).through,
    '2026-11-23',
  );
  for (const args of [
    ['--apply'],
    ['--apply', '--database', QA_DATABASE],
    ['--apply', '--database', 'ordinary_database'],
    ['--through', '2026-11-24'],
    ['--through'],
    ['--unsafe'],
    ['--through', '2026-06-31'],
  ])
    assert.throws(() => optionsOf(args));
  assert.equal(
    optionsOf([
      '--apply',
      '--repo',
      '/explicit-checkout',
      '--database',
      QA_DATABASE,
      '--through',
      '2026-06-01',
    ]).through,
    '2026-06-01',
  );
});
