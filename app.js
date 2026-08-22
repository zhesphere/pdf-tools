import * as PDFLib from 'pdf-lib';
import * as pdfjsLib from 'pdfjs-dist';
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import JSZip from 'jszip';
import {
  assessDocumentRisk,
  classifyPdfError,
  createExportFilename,
  createFileFingerprint,
  formatFileSize,
  validatePdfFile,
} from './src/core.js';
import { createTaskRun, waitForTask } from './src/task-controller.js';
import {
  clearLocalSession,
  loadRecipe,
  loadSettings,
  saveRecipe,
  saveSettings,
} from './src/session-store.js';
import {
  extractPdfPages,
  mergePdfs,
  removePdfPages,
  reorderPdfPages,
  rotatePdfPages,
  splitPdfPages,
} from './src/pdf-operations.js';

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

function downloadBlob(blob, filename) {
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(link.href), 1000);
}

function downloadPdf(pdfBytes, filename) {
  const blob = new Blob([pdfBytes], { type: 'application/pdf' });
  downloadBlob(blob, filename);
}

function warnAboutFileRisk(files) {
  const largest = [...files].sort((a, b) => b.size - a.size)[0];
  if (!largest) return;
  const risk = assessDocumentRisk({
    fileSize: largest.size,
    mobile: window.matchMedia('(max-width: 768px)').matches,
  });
  if (risk.level === 'warning') showToast(risk.message, 'info', 6000);
}

// ==================== Navigation ====================
const navItems = document.querySelectorAll('.nav-item');
const toolPanels = document.querySelectorAll('.tool-panel');

navItems.forEach(item => {
  item.setAttribute('aria-pressed', item.classList.contains('active') ? 'true' : 'false');
  item.addEventListener('click', () => {
    navItems.forEach(n => {
      n.classList.remove('active');
      n.setAttribute('aria-pressed', 'false');
    });
    item.classList.add('active');
    item.setAttribute('aria-pressed', 'true');
    const tool = item.dataset.tool;
    toolPanels.forEach(p => p.classList.remove('active'));
    document.getElementById(`tool-${tool}`).classList.add('active');
  });
});

// ==================== App Shell & Privacy ====================
const settings = loadSettings();
document.documentElement.dataset.theme = settings.theme
  || (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');

document.getElementById('theme-toggle').addEventListener('click', () => {
  const theme = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
  document.documentElement.dataset.theme = theme;
  saveSettings({ ...loadSettings(), theme });
});

const privacyDialog = document.getElementById('privacy-dialog');
const openPrivacyDialog = () => privacyDialog.showModal();
document.getElementById('privacy-open').addEventListener('click', openPrivacyDialog);
document.getElementById('privacy-footer-open').addEventListener('click', openPrivacyDialog);
document.getElementById('privacy-close').addEventListener('click', () => privacyDialog.close());
document.getElementById('clear-local-data').addEventListener('click', () => {
  clearLocalSession();
  document.documentElement.dataset.theme = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  showToast('本地设置与恢复记录已清除', 'success');
});

if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {});
  });
}

// ==================== Toast Notifications ====================
function showToast(message, type = 'info', duration = 3000) {
  const container = document.getElementById('toast-container');
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.textContent = message;
  container.appendChild(toast);
  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateX(100%)';
    toast.style.transition = 'all 0.3s ease';
    setTimeout(() => toast.remove(), 300);
  }, duration);
}

function createTaskUi(progressEl, statusEl) {
  const fill = progressEl.querySelector('.progress-fill');
  const cancelButton = document.createElement('button');
  cancelButton.type = 'button';
  cancelButton.className = 'btn-secondary task-cancel';
  cancelButton.textContent = '取消任务';
  cancelButton.hidden = true;
  progressEl.insertAdjacentElement('afterend', cancelButton);
  progressEl.setAttribute('role', 'progressbar');
  progressEl.setAttribute('aria-valuemin', '0');
  progressEl.setAttribute('aria-valuemax', '100');

  let activeRun = null;
  cancelButton.addEventListener('click', () => {
    if (!activeRun) return;
    activeRun.cancel();
    cancelButton.disabled = true;
    statusEl.textContent = '正在取消…';
  });

  return {
    start(message) {
      activeRun?.cancel();
      progressEl.style.display = 'block';
      progressEl.classList.add('determinate');
      fill.style.width = '0%';
      progressEl.setAttribute('aria-valuenow', '0');
      cancelButton.hidden = false;
      cancelButton.disabled = false;
      statusEl.textContent = message;
      statusEl.className = 'status-text';
      activeRun = createTaskRun({
        onProgress: progress => {
          const percent = Math.round(progress.ratio * 100);
          fill.style.width = `${percent}%`;
          progressEl.setAttribute('aria-valuenow', String(percent));
          if (progress.message) statusEl.textContent = progress.message;
        },
      });
      return activeRun;
    },
    fail(error, run) {
      if (run && activeRun !== run) return classifyPdfError(error);
      const result = classifyPdfError(error);
      statusEl.textContent = result.code === 'cancelled' ? `ℹ️ ${result.message}` : `❌ ${result.message}`;
      statusEl.className = result.code === 'cancelled' ? 'status-text' : 'status-text error';
      showToast(result.message, result.code === 'cancelled' ? 'info' : 'error', 5000);
      return result;
    },
    finish(run) {
      if (run && activeRun !== run) return;
      progressEl.style.display = 'none';
      progressEl.classList.remove('determinate');
      cancelButton.hidden = true;
      activeRun = null;
    },
    get activeRun() {
      return activeRun;
    },
  };
}

// ==================== Drag & Drop Helpers ====================
function setupDragDrop(dropzoneId, inputId, callback, multiple = false) {
  const dropzone = document.getElementById(dropzoneId);
  const input = document.getElementById(inputId);

  dropzone.setAttribute('role', 'button');
  dropzone.setAttribute('tabindex', '0');
  dropzone.setAttribute('aria-controls', inputId);

  dropzone.addEventListener('click', () => input.click());
  dropzone.addEventListener('keydown', event => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      input.click();
    }
  });

  dropzone.addEventListener('dragover', (e) => {
    e.preventDefault();
    dropzone.classList.add('drag-over');
  });

  dropzone.addEventListener('dragleave', () => {
    dropzone.classList.remove('drag-over');
  });

  dropzone.addEventListener('drop', (e) => {
    e.preventDefault();
    dropzone.classList.remove('drag-over');
    const files = Array.from(e.dataTransfer.files).filter(file => validatePdfFile(file).ok);
    if (files.length === 0) {
      showToast('请选择PDF文件', 'error');
      return;
    }
    if (!multiple && files.length > 1) {
      showToast('此工具仅支持单个PDF文件', 'info');
    }
    warnAboutFileRisk(files);
    callback(multiple ? files : files[0]);
  });

  input.addEventListener('change', () => {
    const files = Array.from(input.files);
    if (files.length === 0) return;
    const validFiles = files.filter(file => validatePdfFile(file).ok);
    if (validFiles.length === 0) {
      showToast(validatePdfFile(files[0]).message, 'error');
      input.value = '';
      return;
    }
    warnAboutFileRisk(validFiles);
    callback(multiple ? validFiles : validFiles[0]);
    input.value = '';
  });
}

// ==================== 1. Merge PDF ====================
(function() {
  let mergeFiles = [];

  const fileList = document.getElementById('merge-file-list');
  const mergeBtn = document.getElementById('merge-btn');
  const statusEl = document.getElementById('merge-status');
  const progressEl = document.getElementById('merge-progress');
  const taskUi = createTaskUi(progressEl, statusEl);

  function renderFileList() {
    fileList.innerHTML = '';
    mergeFiles.forEach((file, index) => {
      const item = document.createElement('div');
      item.className = 'file-item';
      item.draggable = true;
      item.dataset.index = index;
      item.innerHTML = `
        <span class="order-badge">${index + 1}</span>
        <svg class="file-icon" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
          <polyline points="14 2 14 8 20 8"/>
        </svg>
        <span class="file-name">${file.name}</span>
        <span class="file-size">${formatFileSize(file.size)}</span>
        <span class="file-actions">
          <button class="move-file-btn" data-index="${index}" data-direction="-1" aria-label="将 ${file.name} 前移" ${index === 0 ? 'disabled' : ''}>↑</button>
          <button class="move-file-btn" data-index="${index}" data-direction="1" aria-label="将 ${file.name} 后移" ${index === mergeFiles.length - 1 ? 'disabled' : ''}>↓</button>
          <button class="remove-btn" data-index="${index}" aria-label="移除 ${file.name}">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
            </svg>
          </button>
        </span>
      `;
      fileList.appendChild(item);
    });

    mergeBtn.disabled = mergeFiles.length < 2;

    // Drag to reorder
    document.querySelectorAll('#merge-file-list .file-item').forEach(item => {
      item.addEventListener('dragstart', (e) => {
        e.dataTransfer.effectAllowed = 'move';
        item.classList.add('dragging');
        e.dataTransfer.setData('text/plain', item.dataset.index);
      });
      item.addEventListener('dragend', () => item.classList.remove('dragging'));
      item.addEventListener('dragover', (e) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
      });
      item.addEventListener('drop', (e) => {
        e.preventDefault();
        const from = parseInt(e.dataTransfer.getData('text/plain'));
        const to = parseInt(item.dataset.index);
        if (from !== to) {
          const [moved] = mergeFiles.splice(from, 1);
          mergeFiles.splice(to, 0, moved);
          renderFileList();
        }
      });
    });

    // Remove buttons
    document.querySelectorAll('#merge-file-list .move-file-btn').forEach(btn => {
      btn.addEventListener('click', event => {
        event.stopPropagation();
        const from = Number.parseInt(btn.dataset.index, 10);
        const to = from + Number.parseInt(btn.dataset.direction, 10);
        if (to < 0 || to >= mergeFiles.length) return;
        [mergeFiles[from], mergeFiles[to]] = [mergeFiles[to], mergeFiles[from]];
        renderFileList();
      });
    });

    document.querySelectorAll('#merge-file-list .remove-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const idx = parseInt(btn.dataset.index);
        mergeFiles.splice(idx, 1);
        renderFileList();
      });
    });
  }

  setupDragDrop('merge-dropzone', 'merge-input', (files) => {
    mergeFiles = [...mergeFiles, ...files];
    renderFileList();
    showToast(`已添加 ${files.length} 个文件`, 'info');
  }, true);

  mergeBtn.addEventListener('click', async () => {
    const task = taskUi.start('准备合并文件…');
    mergeBtn.disabled = true;

    try {
      const inputs = [];
      for (let index = 0; index < mergeFiles.length; index += 1) {
        task.throwIfCancelled();
        inputs.push(await mergeFiles[index].arrayBuffer());
        task.report(index + 1, mergeFiles.length * 5, `正在读取第 ${index + 1}/${mergeFiles.length} 个文件`);
      }
      const pdfBytes = await mergePdfs(inputs, {
        signal: task.signal,
        checkpoint: (completed, total, message) => task.checkpoint(completed + total / 4, total * 1.25, message),
      });
      const filename = createExportFilename(mergeFiles[0].name, `merged-${mergeFiles.length}`);
      downloadPdf(pdfBytes, filename);

      statusEl.textContent = `✅ ${filename} 下载已开始`;
      statusEl.className = 'status-text success';
      showToast('合并完成! 下载已开始', 'success');
    } catch (error) {
      taskUi.fail(error, task);
    } finally {
      taskUi.finish(task);
      mergeBtn.disabled = mergeFiles.length < 2;
    }
  });
})();

// ==================== 2. Split PDF ====================
(function() {
  let splitFile = null;
  const selectedDiv = document.getElementById('split-selected');
  const extractBtn = document.getElementById('split-extract-btn');
  const splitAllBtn = document.getElementById('split-all-btn');
  const pagesInput = document.getElementById('split-pages');
  const statusEl = document.getElementById('split-status');
  const progressEl = document.getElementById('split-progress');
  const taskUi = createTaskUi(progressEl, statusEl);

  function setFile(file) {
    splitFile = file;
    selectedDiv.style.display = 'flex';
    selectedDiv.innerHTML = `
      📄 ${file.name} (${formatFileSize(file.size)})
      <button class="remove-file" id="split-remove" aria-label="移除当前文件">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
        </svg>
      </button>
    `;
    document.getElementById('split-remove').addEventListener('click', () => {
      splitFile = null;
      selectedDiv.style.display = 'none';
      extractBtn.disabled = true;
      splitAllBtn.disabled = true;
    });
    extractBtn.disabled = false;
    splitAllBtn.disabled = false;
  }

  setupDragDrop('split-dropzone', 'split-input', setFile);

  extractBtn.addEventListener('click', async () => {
    const task = taskUi.start('准备提取页面…');
    extractBtn.disabled = true;
    splitAllBtn.disabled = true;

    try {
      const arrayBuffer = await splitFile.arrayBuffer();
      const pdfBytes = await extractPdfPages(arrayBuffer, pagesInput.value.trim(), {
        signal: task.signal,
        checkpoint: task.checkpoint.bind(task),
      });
      const filename = createExportFilename(splitFile.name, 'extracted-pages');
      downloadPdf(pdfBytes, filename);

      statusEl.textContent = `✅ ${filename} 下载已开始`;
      statusEl.className = 'status-text success';
      showToast('提取完成! 下载已开始', 'success');
    } catch (error) {
      taskUi.fail(error, task);
    } finally {
      taskUi.finish(task);
      extractBtn.disabled = !splitFile;
      splitAllBtn.disabled = !splitFile;
    }
  });

  splitAllBtn.addEventListener('click', async () => {
    const task = taskUi.start('准备拆分页面…');
    extractBtn.disabled = true;
    splitAllBtn.disabled = true;

    try {
      const arrayBuffer = await splitFile.arrayBuffer();
      const pages = await splitPdfPages(arrayBuffer, {
        signal: task.signal,
        checkpoint: (completed, total, message) => task.checkpoint(completed, total * 1.25, message),
      });
      const zip = new JSZip();

      pages.forEach((pageBytes, index) => {
        zip.file(`page_${String(index + 1).padStart(3, '0')}.pdf`, pageBytes);
      });

      const zipBlob = await zip.generateAsync({ type: 'blob' }, metadata => {
        task.throwIfCancelled();
        task.report(80 + metadata.percent * 0.2, 100, `正在打包 ${Math.round(metadata.percent)}%`);
      });
      const filename = createExportFilename(splitFile.name, 'split-pages', 'zip');
      downloadBlob(zipBlob, filename);

      statusEl.textContent = `✅ ${filename} 下载已开始（共 ${pages.length} 页）`;
      statusEl.className = 'status-text success';
      showToast(`拆分完成! ${pages.length} 个页面已打包下载`, 'success');
    } catch (error) {
      taskUi.fail(error, task);
    } finally {
      taskUi.finish(task);
      extractBtn.disabled = !splitFile;
      splitAllBtn.disabled = !splitFile;
    }
  });
})();

// ==================== 3. Remove Pages ====================
(function() {
  let removeFile = null;
  const selectedDiv = document.getElementById('remove-selected');
  const removeBtn = document.getElementById('remove-btn');
  const pagesInput = document.getElementById('remove-pages');
  const statusEl = document.getElementById('remove-status');
  const progressEl = document.getElementById('remove-progress');
  const taskUi = createTaskUi(progressEl, statusEl);

  function setFile(file) {
    removeFile = file;
    selectedDiv.style.display = 'flex';
    selectedDiv.innerHTML = `
      📄 ${file.name} (${formatFileSize(file.size)})
      <button class="remove-file" id="remove-clear" aria-label="移除当前文件">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
        </svg>
      </button>
    `;
    document.getElementById('remove-clear').addEventListener('click', () => {
      removeFile = null;
      selectedDiv.style.display = 'none';
      removeBtn.disabled = true;
    });
    removeBtn.disabled = false;
  }

  setupDragDrop('remove-dropzone', 'remove-input', setFile);

  removeBtn.addEventListener('click', async () => {
    const task = taskUi.start('准备删除页面…');
    removeBtn.disabled = true;

    try {
      const arrayBuffer = await removeFile.arrayBuffer();
      const pdfBytes = await removePdfPages(arrayBuffer, pagesInput.value.trim(), {
        signal: task.signal,
        checkpoint: task.checkpoint.bind(task),
      });
      const filename = createExportFilename(removeFile.name, 'pages-removed');
      downloadPdf(pdfBytes, filename);

      statusEl.textContent = `✅ ${filename} 下载已开始`;
      statusEl.className = 'status-text success';
      showToast('页面删除完成! 下载已开始', 'success');
    } catch (error) {
      taskUi.fail(error, task);
    } finally {
      taskUi.finish(task);
      removeBtn.disabled = !removeFile;
    }
  });
})();

// ==================== 4. Rotate PDF ====================
(function() {
  let rotateFile = null;
  let selectedAngle = 90;
  const selectedDiv = document.getElementById('rotate-selected');
  const rotateBtn = document.getElementById('rotate-btn');
  const pagesInput = document.getElementById('rotate-pages');
  const statusEl = document.getElementById('rotate-status');
  const progressEl = document.getElementById('rotate-progress');
  const taskUi = createTaskUi(progressEl, statusEl);

  document.querySelectorAll('.rotate-option').forEach(opt => {
    opt.addEventListener('click', () => {
      document.querySelectorAll('.rotate-option').forEach(o => o.classList.remove('selected'));
      opt.classList.add('selected');
      selectedAngle = parseInt(opt.dataset.angle);
    });
  });
  // Default
  document.querySelector('.rotate-option[data-angle="90"]').classList.add('selected');

  function setFile(file) {
    rotateFile = file;
    selectedDiv.style.display = 'flex';
    selectedDiv.innerHTML = `
      📄 ${file.name} (${formatFileSize(file.size)})
      <button class="remove-file" id="rotate-clear" aria-label="移除当前文件">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
        </svg>
      </button>
    `;
    document.getElementById('rotate-clear').addEventListener('click', () => {
      rotateFile = null;
      selectedDiv.style.display = 'none';
      rotateBtn.disabled = true;
    });
    rotateBtn.disabled = false;
  }

  setupDragDrop('rotate-dropzone', 'rotate-input', setFile);

  rotateBtn.addEventListener('click', async () => {
    const task = taskUi.start('准备旋转页面…');
    rotateBtn.disabled = true;

    try {
      const arrayBuffer = await rotateFile.arrayBuffer();
      const pdfBytes = await rotatePdfPages(arrayBuffer, selectedAngle, pagesInput.value.trim(), {
        signal: task.signal,
        checkpoint: task.checkpoint.bind(task),
      });
      const filename = createExportFilename(rotateFile.name, 'rotated');
      downloadPdf(pdfBytes, filename);

      statusEl.textContent = `✅ ${filename} 下载已开始`;
      statusEl.className = 'status-text success';
      showToast('旋转完成! 下载已开始', 'success');
    } catch (error) {
      taskUi.fail(error, task);
    } finally {
      taskUi.finish(task);
      rotateBtn.disabled = !rotateFile;
    }
  });
})();

// ==================== 5. Reorder Pages ====================
(function() {
  const selectedDiv = document.getElementById('reorder-selected');
  const workspace = document.getElementById('reorder-workspace');
  const thumbnailGrid = document.getElementById('reorder-thumbnail-grid');
  const pageCountEl = document.getElementById('reorder-page-count');
  const reverseBtn = document.getElementById('reorder-reverse-btn2');
  const customInput = document.getElementById('reorder-custom2');
  const customBtn = document.getElementById('reorder-custom-btn2');
  const exportBtn = document.getElementById('reorder-export-btn');
  const statusEl = document.getElementById('reorder-status');
  const progressEl = document.getElementById('reorder-progress');
  const taskUi = createTaskUi(progressEl, statusEl);

  const state = {
    pdfBytes: null,
    totalPages: 0,
    pageOrder: [],    // current order: [0, 1, 2, ...]  (zero-based indices)
    thumbScale: 0.3,
    reorderFile: null,
    fingerprint: '',
  };

  function persistPageOrder() {
    if (!state.fingerprint || state.pageOrder.length === 0) return;
    saveRecipe({ tool: 'reorder', fingerprint: state.fingerprint, pageOrder: state.pageOrder });
  }

  function setFile(file) {
    state.reorderFile = file;
    selectedDiv.style.display = 'flex';
    selectedDiv.innerHTML = `
      📄 ${file.name} (${formatFileSize(file.size)})
      <button class="remove-file" id="reorder-clear" aria-label="移除当前文件">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
        </svg>
      </button>
    `;
    document.getElementById('reorder-clear').addEventListener('click', resetAll);
    loadAndRender(file);
  }

  function resetAll() {
    taskUi.activeRun?.cancel();
    state.reorderFile = null;
    state.pdfBytes = null;
    state.totalPages = 0;
    state.pageOrder = [];
    state.fingerprint = '';
    selectedDiv.style.display = 'none';
    workspace.style.display = 'none';
    thumbnailGrid.innerHTML = '';
    pageCountEl.textContent = '';
    statusEl.textContent = '';
    statusEl.className = 'status-text';
  }

  setupDragDrop('reorder-dropzone', 'reorder-input', setFile);

  async function loadAndRender(file) {
    const task = taskUi.start('正在读取 PDF…');

    try {
      const arrayBuffer = await file.arrayBuffer();
      state.pdfBytes = arrayBuffer;
      state.fingerprint = createFileFingerprint(file);

      // Load with pdf.js for rendering
      const loadingTask = pdfjsLib.getDocument({ data: arrayBuffer.slice(0) });
      const pdfDoc = await loadingTask.promise;
      state.totalPages = pdfDoc.numPages;

      // Default order: 0, 1, 2, ...
      state.pageOrder = Array.from({ length: state.totalPages }, (_, i) => i);
      const savedRecipe = loadRecipe(state.fingerprint);
      const savedOrder = savedRecipe?.tool === 'reorder' ? savedRecipe.pageOrder : null;
      const isValidSavedOrder = Array.isArray(savedOrder)
        && savedOrder.length === state.totalPages
        && new Set(savedOrder).size === state.totalPages
        && savedOrder.every(index => Number.isInteger(index) && index >= 0 && index < state.totalPages);
      if (isValidSavedOrder) {
        state.pageOrder = savedOrder;
        showToast('已恢复最近 24 小时内的页面顺序', 'info', 5000);
      }

      const risk = assessDocumentRisk({
        fileSize: file.size,
        pageCount: state.totalPages,
        mobile: window.matchMedia('(max-width: 768px)').matches,
      });
      if (risk.level === 'warning') showToast(risk.message, 'info', 6000);

      // Show workspace first so thumbnail grid has layout dimensions
      workspace.style.display = 'block';
      pageCountEl.textContent = `共 ${state.totalPages} 页 — 拖拽缩略图调整顺序`;

      await renderThumbnails(pdfDoc, task);
      statusEl.textContent = '';
      showToast(`已加载 ${state.totalPages} 页，可拖拽重排`, 'success');
    } catch (error) {
      taskUi.fail(error, task);
    } finally {
      taskUi.finish(task);
    }
  }

  async function renderThumbnails(pdfDoc, task) {
    thumbnailGrid.innerHTML = '';

    // Calculate a reasonable thumb scale
    const gridWidth = thumbnailGrid.clientWidth || 900;
    const cols = Math.max(2, Math.floor(gridWidth / 176));
    const cardWidth = Math.max(120, (gridWidth - (cols - 1) * 16) / cols);
    const thumbScale = cardWidth / 595; // A4 width ≈ 595pt

    for (let i = 0; i < state.totalPages; i++) {
      task.throwIfCancelled();
      const origIdx = state.pageOrder[i];
      const pageNum = origIdx + 1;

      const pdfPage = await pdfDoc.getPage(pageNum);
      const viewport = pdfPage.getViewport({ scale: thumbScale });

      const canvas = document.createElement('canvas');
      canvas.width = viewport.width;
      canvas.height = viewport.height;
      canvas.className = 'thumb-canvas';
      const ctx = canvas.getContext('2d');
      await pdfPage.render({ canvasContext: ctx, viewport: viewport }).promise;

      // Card wrapper
      const card = document.createElement('div');
      card.className = 'reorder-thumb-card';
      card.draggable = true;
      card.dataset.orderIndex = i; // position in current order
      card.dataset.pageIndex = origIdx;

      // Order badge (top-left circle)
      const badge = document.createElement('div');
      badge.className = 'thumb-badge';
      badge.textContent = i + 1;
      card.appendChild(badge);

      card.appendChild(canvas);

      // Page number label
      const label = document.createElement('div');
      label.className = 'thumb-page-num';
      label.textContent = `第 ${pageNum} 页`;
      card.appendChild(label);

      const actions = document.createElement('div');
      actions.className = 'thumb-actions';
      const previousButton = document.createElement('button');
      previousButton.type = 'button';
      previousButton.textContent = '←';
      previousButton.disabled = i === 0;
      previousButton.setAttribute('aria-label', `将第 ${pageNum} 页前移`);
      const nextButton = document.createElement('button');
      nextButton.type = 'button';
      nextButton.textContent = '→';
      nextButton.disabled = i === state.totalPages - 1;
      nextButton.setAttribute('aria-label', `将第 ${pageNum} 页后移`);
      actions.append(previousButton, nextButton);
      card.appendChild(actions);

      const movePage = targetIndex => {
        const currentIndex = Number.parseInt(card.dataset.orderIndex, 10);
        const [moved] = state.pageOrder.splice(currentIndex, 1);
        state.pageOrder.splice(targetIndex, 0, moved);
        persistPageOrder();
        syncThumbnailCards();
      };
      previousButton.addEventListener('click', event => {
        event.stopPropagation();
        movePage(Number.parseInt(card.dataset.orderIndex, 10) - 1);
      });
      nextButton.addEventListener('click', event => {
        event.stopPropagation();
        movePage(Number.parseInt(card.dataset.orderIndex, 10) + 1);
      });

      // ===== Drag events =====
      card.addEventListener('dragstart', (e) => {
        e.dataTransfer.effectAllowed = 'move';
        card.classList.add('dragging');
        e.dataTransfer.setData('text/plain', card.dataset.orderIndex);
      });

      card.addEventListener('dragend', () => {
        card.classList.remove('dragging');
        // Remove all drag-over highlights
        document.querySelectorAll('.reorder-thumb-card.drag-over').forEach(c => c.classList.remove('drag-over'));
      });

      card.addEventListener('dragover', (e) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        card.classList.add('drag-over');
      });

      card.addEventListener('dragleave', () => {
        card.classList.remove('drag-over');
      });

      card.addEventListener('drop', (e) => {
        e.preventDefault();
        card.classList.remove('drag-over');
        const fromIdx = parseInt(e.dataTransfer.getData('text/plain'));
        const toIdx = parseInt(card.dataset.orderIndex);
        if (!isNaN(fromIdx) && !isNaN(toIdx) && fromIdx !== toIdx) {
          // Reorder the pageOrder array
          const [moved] = state.pageOrder.splice(fromIdx, 1);
          state.pageOrder.splice(toIdx, 0, moved);
          persistPageOrder();
          syncThumbnailCards();
        }
      });

      thumbnailGrid.appendChild(card);
      await task.checkpoint(i + 1, state.totalPages, `正在生成缩略图 ${i + 1}/${state.totalPages}`);
    }
  }

  function syncThumbnailCards() {
    state.pageOrder.forEach((pageIndex, orderIndex) => {
      const card = thumbnailGrid.querySelector(`[data-page-index="${pageIndex}"]`);
      if (!card) return;
      card.dataset.orderIndex = orderIndex;
      card.querySelector('.thumb-badge').textContent = orderIndex + 1;
      const [previousButton, nextButton] = card.querySelectorAll('.thumb-actions button');
      previousButton.disabled = orderIndex === 0;
      nextButton.disabled = orderIndex === state.totalPages - 1;
      thumbnailGrid.appendChild(card);
    });
  }

  // ============ Reverse ============
  reverseBtn.addEventListener('click', () => {
    state.pageOrder.reverse();
    persistPageOrder();
    syncThumbnailCards();
    showToast('页面顺序已反转', 'info');
  });

  // ============ Custom text order ============
  customBtn.addEventListener('click', async () => {
    const val = customInput.value.trim();
    if (!val) return showToast('请输入自定义顺序', 'error');

    try {
      const parts = val.split(',').map(n => parseInt(n.trim()));
      if (parts.length !== state.totalPages) {
        return showToast(`页数不符: 需要 ${state.totalPages} 个数字，输入了 ${parts.length} 个`, 'error');
      }
      if (parts.some(n => isNaN(n) || n < 1 || n > state.totalPages)) {
        return showToast(`页码必须在 1-${state.totalPages} 之间`, 'error');
      }
      if (new Set(parts).size !== state.totalPages) {
        return showToast('每个页码必须且只能出现一次', 'error');
      }
      state.pageOrder = parts.map(n => n - 1); // convert to 0-based
      persistPageOrder();
      syncThumbnailCards();
      showToast('自定义顺序已应用', 'success');
    } catch (err) {
      showToast('格式错误: ' + err.message, 'error');
    }
  });

  // Also allow Enter key in the custom input
  customInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') customBtn.click();
  });

  // ============ Export ============
  exportBtn.addEventListener('click', async () => {
    const task = taskUi.start('准备生成 PDF…');
    exportBtn.disabled = true;

    try {
      const pdfBytes = await reorderPdfPages(state.pdfBytes.slice(0), state.pageOrder, {
        signal: task.signal,
        checkpoint: task.checkpoint.bind(task),
      });
      const filename = createExportFilename(state.reorderFile.name, 'reordered');
      downloadPdf(pdfBytes, filename);

      statusEl.textContent = `✅ ${filename} 下载已开始`;
      statusEl.className = 'status-text success';
      showToast('重排完成! 下载已开始', 'success');
    } catch (error) {
      taskUi.fail(error, task);
    } finally {
      taskUi.finish(task);
      exportBtn.disabled = false;
    }
  });
})();

// ==================== 6. Edit PDF ====================
(function() {
  const uploadArea = document.getElementById('edit-upload');
  const editorDiv = document.getElementById('edit-editor');
  const pagesContainer = document.getElementById('edit-pages-container');
  const statusEl = document.getElementById('edit-status');
  const progressEl = document.getElementById('edit-progress');
  const zoomLabel = document.getElementById('edit-zoom-label');
  const exportBtn = document.getElementById('edit-export');
  const taskUi = createTaskUi(progressEl, statusEl);

  const state = {
    pdfBytes: null,
    pdfDoc: null,
    totalPages: 0,
    scale: 1.5,
    pageDims: [],       // [{ width, height }] in PDF points
    annotations: [],    // [{ id, type, pageIndex, x, y, w, h, text?, imageDataUrl?, fontSize?, color? }]
    selectedId: null,
    nextId: 1,
    editFile: null,
  };

  // Show upload zone initially
  uploadArea.style.display = 'block';

  function resetEditor() {
    state.pdfBytes = null;
    state.pdfDoc = null;
    state.totalPages = 0;
    state.scale = 1.5;
    state.pageDims = [];
    state.annotations = [];
    state.selectedId = null;
    state.nextId = 1;
    state.editFile = null;
    pagesContainer.innerHTML = '';
    uploadArea.style.display = 'block';
    editorDiv.style.display = 'none';
    zoomLabel.textContent = '150%';
  }

  function selectAnnotation(id) {
    state.selectedId = id;
    document.querySelectorAll('.annotation-item').forEach(el => {
      el.classList.toggle('selected', el.dataset.id === String(id));
    });
  }

  function deselectAll() {
    state.selectedId = null;
    document.querySelectorAll('.annotation-item.selected').forEach(el => el.classList.remove('selected'));
  }

  // ============ Upload & Render ============
  function setFile(file) {
    state.editFile = file;
    loadAndRender(file);
  }

  setupDragDrop('edit-dropzone', 'edit-input', setFile);

  async function loadAndRender(file) {
    const task = taskUi.start('正在读取 PDF…');

    try {
      const arrayBuffer = await file.arrayBuffer();
      task.throwIfCancelled();
      state.pdfBytes = arrayBuffer;
      state.annotations = [];
      state.selectedId = null;
      state.nextId = 1;

      // Load with pdf.js for rendering
      const loadingTask = pdfjsLib.getDocument({ data: arrayBuffer.slice(0) });
      state.pdfDoc = await loadingTask.promise;
      task.throwIfCancelled();
      state.totalPages = state.pdfDoc.numPages;

      // Load with pdf-lib to get page dimensions
      const pdfLibDoc = await PDFLib.PDFDocument.load(arrayBuffer, { ignoreEncryption: true });
      state.pageDims = [];
      for (let i = 0; i < state.totalPages; i++) {
        task.throwIfCancelled();
        const page = pdfLibDoc.getPage(i);
        const { width, height } = page.getSize();
        state.pageDims.push({ width, height });
        await task.checkpoint(i + 1, state.totalPages * 2, `正在分析第 ${i + 1}/${state.totalPages} 页`);
      }

      await renderAllPages(task, state.totalPages);

      uploadArea.style.display = 'none';
      editorDiv.style.display = 'block';
      statusEl.textContent = '';
      showToast(`已加载 ${state.totalPages} 页`, 'success');
    } catch (error) {
      taskUi.fail(error, task);
    } finally {
      taskUi.finish(task);
    }
  }

  async function renderAllPages(task = null, progressOffset = 0) {
    pagesContainer.innerHTML = '';

    for (let i = 0; i < state.totalPages; i++) {
      task?.throwIfCancelled();
      const pageNum = i + 1;
      const dim = state.pageDims[i];

      // Card wrapper
      const card = document.createElement('div');
      card.className = 'edit-page-card';
      card.style.width = (dim.width * state.scale) + 'px';
      card.style.height = (dim.height * state.scale) + 'px';

      // Page number badge
      const badge = document.createElement('div');
      badge.style.cssText = 'position:absolute;top:8px;right:8px;background:rgba(0,0,0,0.6);color:white;padding:2px 8px;border-radius:10px;font-size:12px;z-index:5;pointer-events:none;';
      badge.textContent = `第 ${pageNum} 页`;
      card.appendChild(badge);

      // Canvas
      const pdfPage = await state.pdfDoc.getPage(pageNum);
      const viewport = pdfPage.getViewport({ scale: state.scale });
      const canvas = document.createElement('canvas');
      canvas.width = viewport.width;
      canvas.height = viewport.height;
      canvas.style.display = 'block';
      const ctx = canvas.getContext('2d');
      const renderTask = pdfPage.render({ canvasContext: ctx, viewport: viewport });
      await renderTask.promise;
      task?.throwIfCancelled();
      card.appendChild(canvas);

      // Annotations layer
      const annLayer = document.createElement('div');
      annLayer.className = 'annotations-layer';
      annLayer.dataset.pageIndex = i;
      card.appendChild(annLayer);

      pagesContainer.appendChild(card);
      if (task) {
        await task.checkpoint(
          progressOffset + pageNum,
          progressOffset + state.totalPages,
          `正在渲染第 ${pageNum}/${state.totalPages} 页`,
        );
      }
    }

    // Re-render all existing annotations
    renderAllAnnotations();
    updateZoomLabel();
  }

  // ============ Annotation Rendering ============
  function renderAllAnnotations() {
    // Clear all annotation layers
    document.querySelectorAll('.annotations-layer').forEach(layer => layer.innerHTML = '');

    state.annotations.forEach(ann => {
      const layer = document.querySelector(`.annotations-layer[data-page-index="${ann.pageIndex}"]`);
      if (!layer) return;

      const el = document.createElement('div');
      el.className = 'annotation-item';
      if (ann.id === state.selectedId) el.classList.add('selected');
      el.dataset.id = ann.id;
      el.style.left = ann.x + 'px';
      el.style.top = ann.y + 'px';
      el.style.width = ann.w + 'px';
      el.style.height = ann.h + 'px';

      if (ann.type === 'text') {
        el.classList.add('annotation-text');
        el.textContent = ann.text || '';
        el.style.fontSize = (ann.fontSize || 16) + 'px';
      } else if (ann.type === 'image') {
        el.classList.add('annotation-image');
        const img = document.createElement('img');
        img.src = ann.imageDataUrl;
        img.draggable = false;
        el.appendChild(img);
      }

      // Resize handles
      ['nw','ne','sw','se'].forEach(pos => {
        const handle = document.createElement('div');
        handle.className = `annotation-resize-handle resize-${pos}`;
        handle.addEventListener('mousedown', (e) => startResize(e, ann.id, pos));
        el.appendChild(handle);
      });

      // Events
      el.addEventListener('mousedown', (e) => startDrag(e, ann.id));
      el.addEventListener('click', (e) => { e.stopPropagation(); selectAnnotation(ann.id); });
      el.addEventListener('dblclick', (e) => { e.stopPropagation(); editTextAnnotation(ann.id); });

      layer.appendChild(el);
    });
  }

  function updateZoomLabel() {
    zoomLabel.textContent = Math.round(state.scale * 100) + '%';
  }

  // ============ Drag & Resize ============
  let dragInfo = null;

  function startDrag(e, id) {
    if (e.target.classList.contains('annotation-resize-handle')) return;
    e.preventDefault();
    const ann = state.annotations.find(a => a.id === id);
    if (!ann) return;
    selectAnnotation(id);
    dragInfo = { id, type: 'move', startX: e.clientX, startY: e.clientY, origX: ann.x, origY: ann.y };
    window.addEventListener('mousemove', onDrag);
    window.addEventListener('mouseup', stopDrag);
  }

  function startResize(e, id, handle) {
    e.preventDefault();
    e.stopPropagation();
    const ann = state.annotations.find(a => a.id === id);
    if (!ann) return;
    selectAnnotation(id);
    dragInfo = {
      id, type: 'resize', handle,
      startX: e.clientX, startY: e.clientY,
      origX: ann.x, origY: ann.y, origW: ann.w, origH: ann.h
    };
    window.addEventListener('mousemove', onDrag);
    window.addEventListener('mouseup', stopDrag);
  }

  function onDrag(e) {
    if (!dragInfo) return;
    const ann = state.annotations.find(a => a.id === dragInfo.id);
    if (!ann) return;

    const dx = e.clientX - dragInfo.startX;
    const dy = e.clientY - dragInfo.startY;

    if (dragInfo.type === 'move') {
      ann.x = Math.max(0, dragInfo.origX + dx);
      ann.y = Math.max(0, dragInfo.origY + dy);
    } else if (dragInfo.type === 'resize') {
      const h = dragInfo.handle;
      if (h.includes('e')) ann.w = Math.max(20, dragInfo.origW + dx);
      if (h.includes('w')) { ann.x = dragInfo.origX + dx; ann.w = Math.max(20, dragInfo.origW - dx); }
      if (h.includes('s')) ann.h = Math.max(20, dragInfo.origH + dy);
      if (h.includes('n')) { ann.y = dragInfo.origY + dy; ann.h = Math.max(20, dragInfo.origH - dy); }
    }

    renderAllAnnotations();
  }

  function stopDrag() {
    dragInfo = null;
    window.removeEventListener('mousemove', onDrag);
    window.removeEventListener('mouseup', stopDrag);
  }

  // ============ Text Annotation ============
  function editTextAnnotation(id) {
    const ann = state.annotations.find(a => a.id === id);
    if (!ann || ann.type !== 'text') return;
    const newText = prompt('编辑文字:', ann.text || '');
    if (newText !== null) {
      ann.text = newText;
      renderAllAnnotations();
    }
  }

  document.getElementById('edit-add-text').addEventListener('click', () => {
    const text = prompt('输入要添加的文字:');
    if (!text || !text.trim()) return;

    // Place on first visible page
    const pageIndex = 0; // default to first page
    const dim = state.pageDims[pageIndex];
    const maxX = dim.width * state.scale - 100;
    const maxY = dim.height * state.scale - 40;

    const ann = {
      id: state.nextId++,
      type: 'text',
      pageIndex,
      x: Math.min(20, maxX),
      y: Math.min(20, maxY),
      w: Math.min(text.length * 16 + 20, maxX),
      h: 36,
      text: text.trim(),
      fontSize: 16,
      color: '#333',
    };
    state.annotations.push(ann);
    selectAnnotation(ann.id);
    renderAllAnnotations();
    showToast('文字已添加（可拖拽移动）', 'info');
  });

  // ============ Image Annotation ============
  document.getElementById('edit-add-image').addEventListener('click', () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.onchange = async () => {
      const file = input.files[0];
      if (!file) return;

      const reader = new FileReader();
      reader.onload = () => {
        const img = new Image();
        img.onload = () => {
          const pageIndex = 0;
          const dim = state.pageDims[pageIndex];
          const maxW = dim.width * state.scale;
          let w = img.width;
          let h = img.height;
          // Scale down if too large
          if (w > maxW * 0.8) { const ratio = (maxW * 0.8) / w; w *= ratio; h *= ratio; }

          const ann = {
            id: state.nextId++,
            type: 'image',
            pageIndex,
            x: 20,
            y: 20,
            w: Math.round(w),
            h: Math.round(h),
            imageDataUrl: reader.result,
          };
          state.annotations.push(ann);
          selectAnnotation(ann.id);
          renderAllAnnotations();
          showToast('图片已添加（可拖拽调整位置和大小）', 'info');
        };
        img.src = reader.result;
      };
      reader.readAsDataURL(file);
    };
    input.click();
  });

  // ============ Zoom ============
  document.getElementById('edit-zoom-in').addEventListener('click', async () => {
    if (state.scale >= 4) return;
    state.scale = Math.round((state.scale + 0.25) * 100) / 100;
    const task = taskUi.start('正在更新预览…');
    try {
      await renderAllPages(task);
    } catch (error) {
      taskUi.fail(error, task);
    } finally {
      taskUi.finish(task);
    }
  });

  document.getElementById('edit-zoom-out').addEventListener('click', async () => {
    if (state.scale <= 0.5) return;
    state.scale = Math.round((state.scale - 0.25) * 100) / 100;
    const task = taskUi.start('正在更新预览…');
    try {
      await renderAllPages(task);
    } catch (error) {
      taskUi.fail(error, task);
    } finally {
      taskUi.finish(task);
    }
  });

  // ============ Delete & Deselect ============
  document.addEventListener('keydown', (e) => {
    // Only when edit tool is active
    const editPanel = document.getElementById('tool-edit');
    if (!editPanel.classList.contains('active')) return;
    if (state.selectedId === null) return;

    if (e.key === 'Delete' || e.key === 'Backspace') {
      if (document.activeElement && document.activeElement.closest('.annotation-text')) return;
      state.annotations = state.annotations.filter(a => a.id !== state.selectedId);
      state.selectedId = null;
      renderAllAnnotations();
      showToast('标注已删除', 'info');
    }
  });

  document.addEventListener('click', (e) => {
    const editPanel = document.getElementById('tool-edit');
    if (!editPanel.classList.contains('active')) return;
    if (!e.target.closest('.annotation-item') && !e.target.closest('#edit-add-text') && !e.target.closest('#edit-add-image')) {
      deselectAll();
    }
  });

  // ============ Export PDF ============
  exportBtn.addEventListener('click', async () => {
    const task = taskUi.start('正在生成 PDF…');
    exportBtn.disabled = true;

    try {
      const pdfDoc = await PDFLib.PDFDocument.load(state.pdfBytes.slice(0), { ignoreEncryption: true });
      task.throwIfCancelled();

      for (let i = 0; i < state.totalPages; i++) {
        task.throwIfCancelled();
        const page = pdfDoc.getPage(i);
        const pageH = state.pageDims[i].height;
        const pageAnns = state.annotations.filter(a => a.pageIndex === i);

        for (const ann of pageAnns) {
          task.throwIfCancelled();
          // Convert CSS coordinates to PDF coordinates
          const pdfX = ann.x / state.scale;
          const pdfY = pageH - (ann.y + ann.h) / state.scale;
          const pdfW = ann.w / state.scale;
          const pdfH = ann.h / state.scale;

          if (ann.type === 'text' && ann.text) {
            // Render text on offscreen canvas → embed as PNG
            const textCanvas = document.createElement('canvas');
            const fontSize = (ann.fontSize || 16) * 2; // 2x for sharpness
            const font = fontSize + 'px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
            textCanvas.width = ann.w * 2;
            textCanvas.height = ann.h * 2;
            const tctx = textCanvas.getContext('2d');
            tctx.scale(2, 2);
            tctx.font = font;
            tctx.fillStyle = ann.color || '#333';
            tctx.textBaseline = 'top';

            // Word wrap
            const maxWidth = ann.w - 20;
            const words = ann.text.split('');
            let line = '';
            let y = 8;
            const lineHeight = (ann.fontSize || 16) * 1.4;
            for (const char of words) {
              const testLine = line + char;
              if (tctx.measureText(testLine).width > maxWidth && line.length > 0) {
                tctx.fillText(line, 10, y);
                y += lineHeight;
                line = char;
              } else {
                line = testLine;
              }
            }
            if (line) tctx.fillText(line, 10, y);

            const pngBytes = await new Promise(resolve => {
              textCanvas.toBlob(blob => {
                const reader = new FileReader();
                reader.onload = () => resolve(new Uint8Array(reader.result));
                reader.readAsArrayBuffer(blob);
              }, 'image/png');
            });

            const pngImage = await pdfDoc.embedPng(pngBytes);
            task.throwIfCancelled();
            page.drawImage(pngImage, { x: pdfX, y: pdfY, width: pdfW, height: pdfH });
          } else if (ann.type === 'image' && ann.imageDataUrl) {
            // Decode data URL
            const base64 = ann.imageDataUrl.split(',')[1];
            const binaryStr = atob(base64);
            const bytes = new Uint8Array(binaryStr.length);
            for (let j = 0; j < binaryStr.length; j++) bytes[j] = binaryStr.charCodeAt(j);

            // Detect format
            const isPng = ann.imageDataUrl.startsWith('data:image/png');
            const image = isPng ? await pdfDoc.embedPng(bytes) : await pdfDoc.embedJpg(bytes);
            page.drawImage(image, { x: pdfX, y: pdfY, width: pdfW, height: pdfH });
          }
        }
        await task.checkpoint(i + 1, state.totalPages, `正在生成第 ${i + 1}/${state.totalPages} 页`);
      }

      const pdfBytes = await pdfDoc.save();
      task.throwIfCancelled();
      const filename = createExportFilename(state.editFile?.name, 'annotated');
      downloadPdf(pdfBytes, filename);

      statusEl.textContent = `✅ ${filename} 下载已开始`;
      statusEl.className = 'status-text success';
      showToast('标注 PDF 已生成，下载已开始', 'success');
    } catch (error) {
      taskUi.fail(error, task);
    } finally {
      taskUi.finish(task);
      exportBtn.disabled = !state.pdfBytes;
    }
  });
})();

// ==================== 7. Translate PDF ====================
(function() {
  const uploadArea = document.getElementById('translate-upload');
  const viewerDiv = document.getElementById('translate-viewer');
  const pagesContainer = document.getElementById('translate-pages-container');
  const fullContainer = document.getElementById('translate-full-container');
  const pdfCol = document.getElementById('translate-pdf-col');
  const resultInner = document.getElementById('translate-result-inner');
  const popup = document.getElementById('translate-popup');
  const popupOriginal = document.getElementById('translate-popup-original');
  const popupResult = document.getElementById('translate-popup-result');
  const popupClose = document.getElementById('translate-popup-close');
  const fullTranslateBtn = document.getElementById('translate-full-btn');
  const hintEl = document.getElementById('translate-hint');
  const statusEl = document.getElementById('translate-status');
  const progressEl = document.getElementById('translate-progress');
  const langFrom = document.getElementById('translate-lang-from');
  const langTo = document.getElementById('translate-lang-to');
  const consentCheck = document.getElementById('translate-consent');
  const taskUi = createTaskUi(progressEl, statusEl);
  let selectionRun = null;

  const state = {
    pdfBytes: null,
    pdfDoc: null,
    totalPages: 0,
    scale: 1.5,
    fullScale: 0.8,
    pageDims: [],
    mode: 'select',
  };

  uploadArea.style.display = 'block';

  // ============ Translation API (MyMemory) ============
  const MYMEMORY_API_KEY = ''; // 可选：在 https://mymemory.translated.net 免费注册获取 key，可提升每日配额至 10000 字

  async function translateText(text, from, to, task = null, retries = 2) {
    if (!text || !text.trim()) return '';
    if (!consentCheck.checked) {
      throw new Error('请先确认联网翻译的隐私说明');
    }
    // 修复：auto 应该传给 API 让其自动检测，而非硬编码为 en
    const langPair = `${from}|${to}`;
    let url = `https://api.mymemory.translated.net/get?q=${encodeURIComponent(text)}&langpair=${langPair}`;
    if (MYMEMORY_API_KEY) {
      url += `&key=${MYMEMORY_API_KEY}`;
    }

    let lastError;
    for (let attempt = 0; attempt <= retries; attempt++) {
      task?.throwIfCancelled();
      try {
        const resp = await fetch(url, { signal: task?.signal });
        if (!resp.ok) {
          if (resp.status === 429 || resp.status === 403) {
            throw new Error('翻译服务请求过于频繁，请稍后再试（免费API有每日配额限制）');
          }
          throw new Error(`翻译服务请求失败 (HTTP ${resp.status})`);
        }
        const data = await resp.json();
        if (data.responseStatus !== 200) {
          const errMsg = data.responseDetails || '未知错误';
          throw new Error(`翻译服务返回错误: ${errMsg}`);
        }
        return data.responseData.translatedText;
      } catch (err) {
        task?.throwIfCancelled();
        lastError = err;
        if (attempt < retries && (err.message.includes('过于频繁') || err.message.includes('429'))) {
          // 指数退避重试
          await waitForTask((attempt + 1) * 2000, task?.signal);
        } else if (attempt < retries) {
          await waitForTask(1000, task?.signal);
        }
      }
    }
    throw lastError;
  }

  async function translateChunked(text, from, to, task = null) {
    const maxLen = 500;
    if (text.length <= maxLen) return translateText(text, from, to, task);
    const chunks = [];
    let remaining = text;
    while (remaining.length > 0) {
      if (remaining.length <= maxLen) { chunks.push(remaining); break; }
      let cut = remaining.lastIndexOf('.', maxLen);
      if (cut < maxLen / 2) cut = remaining.lastIndexOf(' ', maxLen);
      if (cut < maxLen / 2) cut = maxLen;
      chunks.push(remaining.slice(0, cut + 1));
      remaining = remaining.slice(cut + 1);
    }
    const results = [];
    for (let i = 0; i < chunks.length; i++) {
      task?.throwIfCancelled();
      results.push(await translateText(chunks[i], from, to, task));
      // 增加延迟以减少被限流风险
      if (i < chunks.length - 1) await waitForTask(500, task?.signal);
    }
    return results.join(' ');
  }

  // ============ Upload & Render ============
  setupDragDrop('translate-dropzone', 'translate-input', (file) => {
    loadTranslatePDF(file);
  });

  async function loadTranslatePDF(file) {
    const task = taskUi.start('正在读取 PDF…');

    try {
      const arrayBuffer = await file.arrayBuffer();
      task.throwIfCancelled();
      state.pdfBytes = arrayBuffer;

      const loadingTask = pdfjsLib.getDocument({ data: arrayBuffer.slice(0) });
      state.pdfDoc = await loadingTask.promise;
      task.throwIfCancelled();
      state.totalPages = state.pdfDoc.numPages;

      const pdfLibDoc = await PDFLib.PDFDocument.load(arrayBuffer, { ignoreEncryption: true });
      state.pageDims = [];
      for (let i = 0; i < state.totalPages; i++) {
        task.throwIfCancelled();
        const page = pdfLibDoc.getPage(i);
        state.pageDims.push(page.getSize());
        await task.checkpoint(i + 1, state.totalPages * 2, `正在分析第 ${i + 1}/${state.totalPages} 页`);
      }

      // Render in select mode by default
      await renderPagesTo(pagesContainer, state.scale, true, task, state.totalPages, state.totalPages * 2);
      pagesContainer.style.display = 'block';
      fullContainer.style.display = 'none';

      uploadArea.style.display = 'none';
      viewerDiv.style.display = 'block';
      fullTranslateBtn.style.display = (state.mode === 'full') ? 'inline-flex' : 'none';
      hintEl.style.display = (state.mode === 'select') ? 'inline' : 'none';
      statusEl.textContent = '';
      showToast(`已加载 ${state.totalPages} 页`, 'success');
    } catch (error) {
      taskUi.fail(error, task);
    } finally {
      taskUi.finish(task);
    }
  }

  async function renderPagesTo(
    container,
    scale,
    withTextLayer,
    task = null,
    progressOffset = 0,
    progressTotal = progressOffset + state.totalPages,
  ) {
    container.innerHTML = '';

    // Calculate a good scale for the available width
    let useScale = scale;
    if (container === pdfCol) {
      const colWidth = pdfCol.clientWidth - 16; // padding
      const maxPageW = Math.max(...state.pageDims.map(d => d.width));
      if (maxPageW * scale > colWidth) {
        useScale = colWidth / maxPageW * 0.95;
      }
    }

    for (let i = 0; i < state.totalPages; i++) {
      task?.throwIfCancelled();
      const pageNum = i + 1;
      const dim = state.pageDims[i];

      const card = document.createElement('div');
      card.className = 'translate-page-card';
      card.style.width = (dim.width * useScale) + 'px';
      card.style.height = (dim.height * useScale) + 'px';

      const badge = document.createElement('div');
      badge.style.cssText = 'position:absolute;top:8px;right:8px;background:rgba(0,0,0,0.6);color:white;padding:2px 8px;border-radius:10px;font-size:12px;z-index:5;pointer-events:none;';
      badge.textContent = `第 ${pageNum} 页`;
      card.appendChild(badge);

      const pdfPage = await state.pdfDoc.getPage(pageNum);
      const viewport = pdfPage.getViewport({ scale: useScale });
      const canvas = document.createElement('canvas');
      canvas.width = viewport.width;
      canvas.height = viewport.height;
      canvas.style.display = 'block';
      const ctx = canvas.getContext('2d');
      await pdfPage.render({ canvasContext: ctx, viewport: viewport }).promise;
      task?.throwIfCancelled();
      card.appendChild(canvas);

      if (withTextLayer) {
        const textLayerDiv = document.createElement('div');
        textLayerDiv.className = 'textLayer';
        textLayerDiv.style.width = viewport.width + 'px';
        textLayerDiv.style.height = viewport.height + 'px';
        const textContent = await pdfPage.getTextContent();
        const textLayer = new pdfjsLib.TextLayer({
          textContentSource: textContent,
          container: textLayerDiv,
          viewport: viewport,
        });
        await textLayer.render();
        task?.throwIfCancelled();
        textLayerDiv.dataset.pageIndex = i;
        card.appendChild(textLayerDiv);
      }

      container.appendChild(card);
      if (task) {
        await task.checkpoint(
          progressOffset + pageNum,
          progressTotal,
          `正在渲染第 ${pageNum}/${state.totalPages} 页`,
        );
      }
    }
  }

  // ============ Selection → Translation Popup ============
  popupClose.addEventListener('click', () => { popup.style.display = 'none'; });

  document.addEventListener('mouseup', () => {
    const translatePanel = document.getElementById('tool-translate');
    if (!translatePanel || !translatePanel.classList.contains('active')) return;
    if (state.mode !== 'select') return;

    setTimeout(async () => {
      const selection = window.getSelection();
      const selectedText = selection.toString().trim();
      if (!selectedText || selectedText.length < 2 || selectedText.length > 2000) return;
      if (!pagesContainer.contains(selection.anchorNode)) return;

      const range = selection.getRangeAt(0);
      const rect = range.getBoundingClientRect();
      popup.style.display = 'block';
      popup.style.left = Math.min(rect.right + 12, window.innerWidth - 380) + 'px';
      popup.style.top = Math.max(10, rect.top - 10) + 'px';
      popupOriginal.textContent = selectedText;
      popupResult.textContent = '翻译中...';

      selectionRun?.cancel();
      const task = createTaskRun();
      selectionRun = task;

      try {
        const result = await translateChunked(selectedText, langFrom.value, langTo.value, task);
        if (selectionRun === task) popupResult.textContent = result;
      } catch (err) {
        if (selectionRun === task) {
          const result = classifyPdfError(err);
          popupResult.textContent = result.code === 'cancelled' ? '已取消' : '翻译失败，请重试';
        }
      } finally {
        if (selectionRun === task) selectionRun = null;
      }
    }, 300);
  });

  document.addEventListener('mousedown', (e) => {
    if (popup.style.display === 'block' && !popup.contains(e.target)) {
      popup.style.display = 'none';
    }
  });

  // ============ Mode Switching ============
  document.querySelectorAll('.translate-mode-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      selectionRun?.cancel();
      document.querySelectorAll('.translate-mode-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      state.mode = btn.dataset.mode;

      if (state.mode === 'select') {
        fullTranslateBtn.style.display = 'none';
        hintEl.style.display = 'inline';
        pagesContainer.style.display = 'block';
        fullContainer.style.display = 'none';
        popup.style.display = 'none';
      } else {
        fullTranslateBtn.style.display = 'inline-flex';
        hintEl.style.display = 'none';
        popup.style.display = 'none';
        if (state.totalPages > 0) {
          // Show two-column with placeholder
          pagesContainer.style.display = 'none';
        fullContainer.style.display = 'grid';
          const task = taskUi.start('正在准备对照预览…');
          try {
            await renderPagesTo(pdfCol, state.fullScale, false, task);
            resultInner.innerHTML = '<div style="padding:40px;text-align:center;color:var(--text-muted);">点击「开始全文翻译」查看对照结果</div>';
          } catch (error) {
            taskUi.fail(error, task);
          } finally {
            taskUi.finish(task);
          }
        }
      }
    });
  });

  // ============ Full Translation ============
  fullTranslateBtn.addEventListener('click', async () => {
    if (state.totalPages === 0) return;

    const task = taskUi.start('正在准备全文翻译…');
    fullTranslateBtn.disabled = true;
    resultInner.innerHTML = '';

    // Show two-column layout
    pagesContainer.style.display = 'none';
    fullContainer.style.display = 'grid';
    try {
      await renderPagesTo(pdfCol, state.fullScale, false, task, 0, state.totalPages * 3);
      // Extract paragraphs preserving format
      const paragraphs = [];
      for (let i = 0; i < state.totalPages; i++) {
        task.throwIfCancelled();
        const page = await state.pdfDoc.getPage(i + 1);
        const textContent = await page.getTextContent();

        // Group by Y position into lines
        const lines = [];
        let curLine = { y: null, items: [] };
        for (const item of textContent.items) {
          if (!item.str || !item.str.trim()) continue;
          const y = Math.round(item.transform[5]);
          if (curLine.y === null) curLine.y = y;
          if (Math.abs(y - curLine.y) > 5) {
            if (curLine.items.length) lines.push(curLine);
            curLine = { y, items: [item] };
          } else {
            curLine.items.push(item);
          }
        }
        if (curLine.items.length) lines.push(curLine);

        // Sort top to bottom (higher Y = higher on page)
        lines.sort((a, b) => b.y - a.y);

        // Group into paragraphs by Y gap
        let paraLines = [];
        for (let j = 0; j < lines.length; j++) {
          const lineText = lines[j].items.map(it => it.str).join(' ').trim();
          if (!lineText) continue;
          if (paraLines.length && Math.abs(lines[j].y - lines[j-1].y) > 20) {
            paragraphs.push({ pageIndex: i, text: paraLines.join(' ') });
            paraLines = [];
          }
          paraLines.push(lineText);
        }
        if (paraLines.length) paragraphs.push({ pageIndex: i, text: paraLines.join(' ') });
        task.report(state.totalPages + i + 1, state.totalPages * 3, `正在提取第 ${i + 1}/${state.totalPages} 页文字`);
      }

      // Translate paragraph by paragraph
      const from = langFrom.value;
      const to = langTo.value;
      let failCount = 0;
      for (let k = 0; k < paragraphs.length; k++) {
        task.throwIfCancelled();
        task.report(
          state.totalPages * 2 + ((k + 1) / paragraphs.length) * state.totalPages,
          state.totalPages * 3,
          `正在翻译第 ${k + 1}/${paragraphs.length} 段`,
        );
        try {
          paragraphs[k].translated = await translateChunked(paragraphs[k].text, from, to, task);
        } catch (err) {
          task.throwIfCancelled();
          paragraphs[k].translated = `[翻译失败: ${err.message}]`;
          failCount++;
          // 如果连续失败超过3次，可能配额已耗尽，停止继续请求
          if (failCount >= 3) {
            statusEl.textContent = `⚠️ 连续翻译失败，可能已达免费API每日配额限制。已翻译 ${k + 1 - failCount}/${paragraphs.length} 段`;
            break;
          }
          // 失败后等待更长时间再试下一段
          await waitForTask(2000, task.signal);
        }
        // 段落之间稍作延迟
        if (k < paragraphs.length - 1) await waitForTask(300, task.signal);
      }

      // Render results on the right — preserving original format
      let html = '<div class="translate-result-inner">';
      let lastPage = -1;
      for (const para of paragraphs) {
        // Page label when crossing page boundary
        if (para.pageIndex !== lastPage) {
          lastPage = para.pageIndex;
          html += `<div class="translate-result-page-label">📄 第 ${lastPage + 1} 页</div>`;
        }
        html += `
          <div class="translate-result-para">
            <div class="translate-result-original-label">原文</div>
            <div class="translate-result-original">${escapeHtml(para.text)}</div>
            <div class="translate-result-translated-label">译文</div>
            <div class="translate-result-translated">${escapeHtml(para.translated || '...')}</div>
          </div>`;
      }
      html += '</div>';
      resultInner.innerHTML = html;

      const successCount = paragraphs.filter(p => p.translated && !p.translated.startsWith('[翻译失败')).length;
      if (failCount > 0) {
        statusEl.textContent = `⚠️ 翻译部分完成 — ${successCount}/${paragraphs.length} 段成功（免费API有每日配额限制）`;
        statusEl.className = 'status-text';
        showToast(`翻译部分完成: ${successCount}/${paragraphs.length} 段`, 'info');
      } else {
        statusEl.textContent = '✅ 全文翻译完成 — 左侧PDF原文，右侧中英对照';
        statusEl.className = 'status-text success';
        showToast(`全文翻译完成! 共 ${paragraphs.length} 段`, 'success');
      }
    } catch (error) {
      const result = taskUi.fail(error, task);
      resultInner.innerHTML = `<div style="padding:24px;color:var(--danger);">${escapeHtml(result.message)}</div>`;
    } finally {
      taskUi.finish(task);
      fullTranslateBtn.disabled = false;
    }
  });

  function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  langFrom.addEventListener('change', () => { popup.style.display = 'none'; });
  langTo.addEventListener('change', () => { popup.style.display = 'none'; });
})();
