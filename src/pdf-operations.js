import { PDFDocument, degrees } from 'pdf-lib';
import { parsePageRange } from './core.js';
import { throwIfAborted } from './task-controller.js';

const LOAD_OPTIONS = Object.freeze({ ignoreEncryption: true });

export async function mergePdfs(inputs, options = {}) {
  if (!Array.isArray(inputs) || inputs.length < 2) throw new Error('至少需要 2 个 PDF');
  const output = await PDFDocument.create();
  for (let inputIndex = 0; inputIndex < inputs.length; inputIndex += 1) {
    throwIfAborted(options.signal);
    const input = inputs[inputIndex];
    const source = await PDFDocument.load(input, LOAD_OPTIONS);
    const pages = await output.copyPages(source, source.getPageIndices());
    pages.forEach(page => output.addPage(page));
    await reportProgress(options, inputIndex + 1, inputs.length, `正在合并第 ${inputIndex + 1}/${inputs.length} 个文件`);
  }
  throwIfAborted(options.signal);
  return output.save();
}

export async function extractPdfPages(input, pageNumbers, options = {}) {
  throwIfAborted(options.signal);
  const source = await PDFDocument.load(input, LOAD_OPTIONS);
  const indexes = validatePageNumbers(normalizePageRequest(pageNumbers, source.getPageCount()), source.getPageCount());
  if (indexes.length === 0) throw new Error('无效的页码范围');
  const output = await PDFDocument.create();
  for (let position = 0; position < indexes.length; position += 1) {
    throwIfAborted(options.signal);
    const [page] = await output.copyPages(source, [indexes[position]]);
    output.addPage(page);
    await reportProgress(options, position + 1, indexes.length, `正在提取第 ${position + 1}/${indexes.length} 页`);
  }
  return output.save();
}

export async function splitPdfPages(input, options = {}) {
  throwIfAborted(options.signal);
  const source = await PDFDocument.load(input, LOAD_OPTIONS);
  const outputs = [];
  const indexes = source.getPageIndices();
  for (let position = 0; position < indexes.length; position += 1) {
    throwIfAborted(options.signal);
    const index = indexes[position];
    const output = await PDFDocument.create();
    const [page] = await output.copyPages(source, [index]);
    output.addPage(page);
    outputs.push(await output.save());
    await reportProgress(options, position + 1, indexes.length, `正在拆分第 ${position + 1}/${indexes.length} 页`);
  }
  return outputs;
}

export async function removePdfPages(input, pageNumbers, options = {}) {
  throwIfAborted(options.signal);
  const source = await PDFDocument.load(input, LOAD_OPTIONS);
  const indexesToRemove = new Set(validatePageNumbers(normalizePageRequest(pageNumbers, source.getPageCount()), source.getPageCount()));
  const indexesToKeep = source.getPageIndices().filter(index => !indexesToRemove.has(index));
  if (indexesToKeep.length === 0) throw new Error('不能删除全部页面');
  const output = await PDFDocument.create();
  for (let position = 0; position < indexesToKeep.length; position += 1) {
    throwIfAborted(options.signal);
    const [page] = await output.copyPages(source, [indexesToKeep[position]]);
    output.addPage(page);
    await reportProgress(options, position + 1, indexesToKeep.length, `正在保留第 ${position + 1}/${indexesToKeep.length} 页`);
  }
  return output.save();
}

export async function rotatePdfPages(input, angle, pageNumbers = [], options = {}) {
  if (![90, 180, 270].includes(angle)) throw new Error('旋转角度必须是 90、180 或 270');
  throwIfAborted(options.signal);
  const document = await PDFDocument.load(input, LOAD_OPTIONS);
  const normalizedPages = normalizePageRequest(pageNumbers, document.getPageCount());
  const selectedIndexes = normalizedPages.length
    ? new Set(validatePageNumbers(normalizedPages, document.getPageCount()))
    : new Set(document.getPageIndices());
  const indexes = [...selectedIndexes];
  for (let position = 0; position < indexes.length; position += 1) {
    throwIfAborted(options.signal);
    const index = indexes[position];
    const page = document.getPage(index);
    page.setRotation(degrees((page.getRotation().angle + angle) % 360));
    await reportProgress(options, position + 1, indexes.length, `正在旋转第 ${position + 1}/${indexes.length} 页`);
  }
  return document.save();
}

export async function reorderPdfPages(input, pageOrder, options = {}) {
  throwIfAborted(options.signal);
  const source = await PDFDocument.load(input, LOAD_OPTIONS);
  const pageCount = source.getPageCount();
  const valid = Array.isArray(pageOrder)
    && pageOrder.length === pageCount
    && new Set(pageOrder).size === pageCount
    && pageOrder.every(index => Number.isInteger(index) && index >= 0 && index < pageCount);
  if (!valid) throw new Error('页面顺序必须包含每个页面且不能重复');
  const output = await PDFDocument.create();
  for (let position = 0; position < pageOrder.length; position += 1) {
    throwIfAborted(options.signal);
    const [page] = await output.copyPages(source, [pageOrder[position]]);
    output.addPage(page);
    await reportProgress(options, position + 1, pageOrder.length, `正在生成第 ${position + 1}/${pageOrder.length} 页`);
  }
  return output.save();
}

async function reportProgress(options, completed, total, message) {
  if (typeof options.checkpoint === 'function') {
    await options.checkpoint(completed, total, message);
    return;
  }
  options.onProgress?.({ completed, total, ratio: completed / Math.max(1, total), message });
}

function validatePageNumbers(pageNumbers, totalPages) {
  if (!Array.isArray(pageNumbers)) return [];
  return [...new Set(pageNumbers)]
    .filter(page => Number.isInteger(page) && page >= 1 && page <= totalPages)
    .sort((a, b) => a - b)
    .map(page => page - 1);
}

function normalizePageRequest(pageRequest, totalPages) {
  if (typeof pageRequest === 'string') return parsePageRange(pageRequest, totalPages);
  return Array.isArray(pageRequest) ? pageRequest : [];
}
