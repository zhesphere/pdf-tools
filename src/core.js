export const FILE_WARNING_LIMITS = Object.freeze({
  desktopBytes: 200 * 1024 * 1024,
  mobileBytes: 50 * 1024 * 1024,
  desktopPages: 300,
  mobilePages: 80,
});

export function formatFileSize(bytes) {
  if (!Number.isFinite(bytes) || bytes < 0) return '未知大小';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

export function isPdfFile(file) {
  if (!file || typeof file.name !== 'string') return false;
  return file.type === 'application/pdf' || /\.pdf$/i.test(file.name);
}

export function validatePdfFile(file) {
  if (!isPdfFile(file)) return { ok: false, message: '请选择 PDF 文件' };
  if (!Number.isFinite(file.size) || file.size <= 0) {
    return { ok: false, message: '文件为空或无法读取' };
  }
  return { ok: true, message: '' };
}

export function assessDocumentRisk({ fileSize = 0, pageCount = 0, mobile = false }) {
  const byteLimit = mobile ? FILE_WARNING_LIMITS.mobileBytes : FILE_WARNING_LIMITS.desktopBytes;
  const pageLimit = mobile ? FILE_WARNING_LIMITS.mobilePages : FILE_WARNING_LIMITS.desktopPages;
  const reasons = [];
  if (fileSize > byteLimit) reasons.push(`文件超过建议值 ${formatFileSize(byteLimit)}`);
  if (pageCount > pageLimit) reasons.push(`页数超过建议值 ${pageLimit} 页`);
  return {
    level: reasons.length ? 'warning' : 'normal',
    reasons,
    message: reasons.length ? `${reasons.join('，')}，处理可能较慢或占用较多内存` : '',
  };
}

export function parsePageRange(rangeStr, totalPages) {
  const result = new Set();
  if (!rangeStr || rangeStr.trim() === '' || totalPages < 1) return [];

  for (const rawPart of rangeStr.split(',')) {
    const part = rawPart.trim();
    if (!part) continue;
    if (part.includes('-')) {
      const segments = part.split('-');
      if (segments.length !== 2) continue;
      const [start, end] = segments.map(value => Number.parseInt(value.trim(), 10));
      if (!Number.isInteger(start) || !Number.isInteger(end) || start > end) continue;
      for (let page = Math.max(1, start); page <= Math.min(end, totalPages); page += 1) {
        result.add(page);
      }
    } else {
      const page = Number.parseInt(part, 10);
      if (Number.isInteger(page) && page >= 1 && page <= totalPages) result.add(page);
    }
  }

  return [...result].sort((a, b) => a - b);
}

export function createFileFingerprint(file) {
  return [file.name, file.size, file.lastModified || 0].join(':');
}
