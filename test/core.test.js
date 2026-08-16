import test from 'node:test';
import assert from 'node:assert/strict';

import {
  FILE_WARNING_LIMITS,
  assessDocumentRisk,
  classifyPdfError,
  createFileFingerprint,
  createExportFilename,
  formatFileSize,
  parsePageRange,
  validatePdfFile,
} from '../src/core.js';

test('parsePageRange normalizes ranges, removes duplicates, and clamps pages', () => {
  assert.deepEqual(parsePageRange('1, 3, 3, 5-8, 99', 7), [1, 3, 5, 6, 7]);
});

test('parsePageRange rejects reversed and malformed ranges', () => {
  assert.deepEqual(parsePageRange('8-5, x, 1-2-3', 10), []);
});

test('validatePdfFile accepts PDF extension case-insensitively and rejects empty files', () => {
  assert.equal(validatePdfFile({ name: 'report.PDF', type: '', size: 12 }).ok, true);
  assert.equal(validatePdfFile({ name: 'report.txt', type: 'text/plain', size: 12 }).ok, false);
  assert.equal(validatePdfFile({ name: 'empty.pdf', type: 'application/pdf', size: 0 }).ok, false);
});

test('assessDocumentRisk uses separate mobile and desktop warning limits', () => {
  assert.equal(assessDocumentRisk({ fileSize: FILE_WARNING_LIMITS.mobileBytes + 1, mobile: true }).level, 'warning');
  assert.equal(assessDocumentRisk({ fileSize: FILE_WARNING_LIMITS.mobileBytes + 1, mobile: false }).level, 'normal');
  assert.equal(assessDocumentRisk({ pageCount: FILE_WARNING_LIMITS.desktopPages + 1 }).level, 'warning');
});

test('formatFileSize and fingerprint produce stable user-facing values', () => {
  assert.equal(formatFileSize(1024 * 1024), '1.00 MB');
  assert.equal(formatFileSize(-1), '未知大小');
  assert.equal(createFileFingerprint({ name: 'a.pdf', size: 10, lastModified: 20 }), 'a.pdf:10:20');
});

test('classifyPdfError gives actionable categories without exposing raw parser noise', () => {
  assert.equal(classifyPdfError(new Error('encrypted document')).code, 'password');
  assert.equal(classifyPdfError(new Error('Invalid PDF structure')).code, 'invalid');
  assert.equal(classifyPdfError(new Error('Out of memory')).code, 'memory');
  assert.equal(classifyPdfError({ name: 'TaskCancelledError', message: 'cancelled' }).code, 'cancelled');
});

test('createExportFilename preserves identity while removing unsafe path characters', () => {
  assert.equal(createExportFilename('季度/报告.PDF', 'split pages', 'ZIP'), '季度-报告-split-pages.zip');
  assert.equal(createExportFilename('', '', ''), 'document-output.pdf');
});
