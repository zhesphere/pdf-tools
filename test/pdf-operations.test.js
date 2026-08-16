import test from 'node:test';
import assert from 'node:assert/strict';
import { PDFDocument } from 'pdf-lib';

import {
  extractPdfPages,
  mergePdfs,
  removePdfPages,
  reorderPdfPages,
  rotatePdfPages,
  splitPdfPages,
} from '../src/pdf-operations.js';

async function createPdf(widths) {
  const document = await PDFDocument.create();
  widths.forEach(width => document.addPage([width, 200]));
  return document.save();
}

async function inspectPdf(bytes) {
  const document = await PDFDocument.load(bytes);
  return {
    pages: document.getPageCount(),
    widths: document.getPages().map(page => page.getWidth()),
    rotations: document.getPages().map(page => page.getRotation().angle),
  };
}

test('mergePdfs preserves all pages in input order', async () => {
  const merged = await mergePdfs([await createPdf([200, 210]), await createPdf([300])]);
  assert.deepEqual(await inspectPdf(merged), {
    pages: 3,
    widths: [200, 210, 300],
    rotations: [0, 0, 0],
  });
});

test('extract, remove, split, rotate, and reorder produce valid PDFs', async () => {
  const source = await createPdf([200, 300, 400]);
  assert.deepEqual((await inspectPdf(await extractPdfPages(source, [1, 3]))).widths, [200, 400]);
  assert.deepEqual((await inspectPdf(await removePdfPages(source, [2]))).widths, [200, 400]);

  const split = await splitPdfPages(source);
  assert.equal(split.length, 3);
  assert.deepEqual(await Promise.all(split.map(async bytes => (await inspectPdf(bytes)).pages)), [1, 1, 1]);

  const rotated = await inspectPdf(await rotatePdfPages(source, 90, [2]));
  assert.deepEqual(rotated.rotations, [0, 90, 0]);

  const reordered = await inspectPdf(await reorderPdfPages(source, [2, 0, 1]));
  assert.deepEqual(reordered.widths, [400, 200, 300]);
});

test('destructive and ambiguous page operations fail safely', async () => {
  const source = await createPdf([200, 300]);
  await assert.rejects(() => removePdfPages(source, [1, 2]), /不能删除全部页面/);
  await assert.rejects(() => reorderPdfPages(source, [0, 0]), /不能重复/);
  await assert.rejects(() => rotatePdfPages(source, 45), /旋转角度/);
});
