import test from 'node:test';
import assert from 'node:assert/strict';

import { createPdfPreviewController } from '../src/pdf-preview-controller.js';

function createObserverHarness() {
  let callback;
  return {
    factory(nextCallback) {
      callback = nextCallback;
      return { observe() {}, disconnect() {} };
    },
    show(...elements) {
      callback(elements.map(target => ({ target, isIntersecting: true })));
    },
    hide(...elements) {
      callback(elements.map(target => ({ target, isIntersecting: false })));
    },
  };
}

test('preview rendering respects concurrency and releases hidden pages', async () => {
  const observer = createObserverHarness();
  const pending = [];
  const started = [];
  const unloaded = [];
  const elements = [{ id: 1 }, { id: 2 }, { id: 3 }];
  const controller = createPdfPreviewController({
    concurrency: 1,
    observerFactory: observer.factory,
    renderPage: ({ pageIndex }) => new Promise(resolve => {
      started.push(pageIndex);
      pending.push(() => resolve({ cleanup: () => unloaded.push(`cleanup-${pageIndex}`) }));
    }),
    unloadPage: (_element, pageIndex) => unloaded.push(pageIndex),
  });

  elements.forEach((element, index) => controller.observe(element, index));
  observer.show(...elements);
  await Promise.resolve();
  assert.deepEqual(started, [0]);

  pending.shift()();
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.deepEqual(started, [0, 1]);

  observer.hide(elements[0]);
  assert.deepEqual(unloaded, ['cleanup-0', 0]);
  controller.clear();
});

test('clearing a preview cancels active rendering without reporting an error', async () => {
  const observer = createObserverHarness();
  let cancelled = false;
  const errors = [];
  const element = {};
  const controller = createPdfPreviewController({
    observerFactory: observer.factory,
    onError: error => errors.push(error),
    renderPage: ({ registerCancel }) => new Promise((_resolve, reject) => {
      registerCancel(() => {
        cancelled = true;
        reject(new Error('cancelled'));
      });
    }),
  });

  controller.observe(element, 0);
  observer.show(element);
  controller.clear();
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(cancelled, true);
  assert.deepEqual(errors, []);
});
