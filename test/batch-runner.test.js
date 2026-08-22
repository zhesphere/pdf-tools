import test from 'node:test';
import assert from 'node:assert/strict';

import { runBatch, summarizeBatchResults } from '../src/batch-runner.js';
test('batch runner keeps processing after an isolated file failure', async () => {
  const completed = [];
  const outcome = await runBatch([1, 2, 3], async value => {
    if (value === 2) throw new Error('bad file');
    return value * 10;
  }, { onItemComplete: result => completed.push(result.status) });

  assert.equal(outcome.cancelled, false);
  assert.deepEqual(outcome.results.map(result => result.status), ['success', 'failed', 'success']);
  assert.deepEqual(outcome.results.map(result => result.value), [10, undefined, 30]);
  assert.deepEqual(completed, ['success', 'failed', 'success']);
  assert.deepEqual(summarizeBatchResults(outcome.results), { total: 3, success: 2, failed: 1 });
});

test('batch cancellation stops before the next file', async () => {
  const controller = new AbortController();
  const processed = [];

  const outcome = await runBatch([1, 2, 3], async value => {
    processed.push(value);
    controller.abort();
    return value;
  }, { signal: controller.signal });
  assert.equal(outcome.cancelled, true);
  assert.deepEqual(processed, [1]);
});
