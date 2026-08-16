import { PDFDocument, degrees } from 'pdf-lib';

const LOAD_OPTIONS = Object.freeze({ ignoreEncryption: true });

export async function mergePdfs(inputs) {
  if (!Array.isArray(inputs) || inputs.length < 2) throw new Error('至少需要 2 个 PDF');
  const output = await PDFDocument.create();
  for (const input of inputs) {
    const source = await PDFDocument.load(input, LOAD_OPTIONS);
    const pages = await output.copyPages(source, source.getPageIndices());
    pages.forEach(page => output.addPage(page));
  }
  return output.save();
}

export async function extractPdfPages(input, pageNumbers) {
  const source = await PDFDocument.load(input, LOAD_OPTIONS);
  const indexes = validatePageNumbers(pageNumbers, source.getPageCount());
  if (indexes.length === 0) throw new Error('无效的页码范围');
  const output = await PDFDocument.create();
  const pages = await output.copyPages(source, indexes);
  pages.forEach(page => output.addPage(page));
  return output.save();
}

export async function splitPdfPages(input) {
  const source = await PDFDocument.load(input, LOAD_OPTIONS);
  const outputs = [];
  for (const index of source.getPageIndices()) {
    const output = await PDFDocument.create();
    const [page] = await output.copyPages(source, [index]);
    output.addPage(page);
    outputs.push(await output.save());
  }
  return outputs;
}

export async function removePdfPages(input, pageNumbers) {
  const source = await PDFDocument.load(input, LOAD_OPTIONS);
  const indexesToRemove = new Set(validatePageNumbers(pageNumbers, source.getPageCount()));
  const indexesToKeep = source.getPageIndices().filter(index => !indexesToRemove.has(index));
  if (indexesToKeep.length === 0) throw new Error('不能删除全部页面');
  const output = await PDFDocument.create();
  const pages = await output.copyPages(source, indexesToKeep);
  pages.forEach(page => output.addPage(page));
  return output.save();
}

export async function rotatePdfPages(input, angle, pageNumbers = []) {
  if (![90, 180, 270].includes(angle)) throw new Error('旋转角度必须是 90、180 或 270');
  const document = await PDFDocument.load(input, LOAD_OPTIONS);
  const selectedIndexes = pageNumbers.length
    ? new Set(validatePageNumbers(pageNumbers, document.getPageCount()))
    : new Set(document.getPageIndices());
  for (const index of selectedIndexes) {
    const page = document.getPage(index);
    page.setRotation(degrees((page.getRotation().angle + angle) % 360));
  }
  return document.save();
}

export async function reorderPdfPages(input, pageOrder) {
  const source = await PDFDocument.load(input, LOAD_OPTIONS);
  const pageCount = source.getPageCount();
  const valid = Array.isArray(pageOrder)
    && pageOrder.length === pageCount
    && new Set(pageOrder).size === pageCount
    && pageOrder.every(index => Number.isInteger(index) && index >= 0 && index < pageCount);
  if (!valid) throw new Error('页面顺序必须包含每个页面且不能重复');
  const output = await PDFDocument.create();
  const pages = await output.copyPages(source, pageOrder);
  pages.forEach(page => output.addPage(page));
  return output.save();
}

function validatePageNumbers(pageNumbers, totalPages) {
  if (!Array.isArray(pageNumbers)) return [];
  return [...new Set(pageNumbers)]
    .filter(page => Number.isInteger(page) && page >= 1 && page <= totalPages)
    .sort((a, b) => a - b)
    .map(page => page - 1);
}
