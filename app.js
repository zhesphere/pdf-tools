// ==================== Utility Functions ====================

function formatFileSize(bytes) {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(2) + ' MB';
}

function parsePageRange(rangeStr, totalPages) {
  const result = new Set();
  if (!rangeStr || rangeStr.trim() === '') return [];

  const parts = rangeStr.split(',');
  for (let part of parts) {
    part = part.trim();
    if (part.includes('-')) {
      const [start, end] = part.split('-').map(n => parseInt(n.trim()));
      if (!isNaN(start) && !isNaN(end)) {
        for (let i = Math.max(1, start); i <= Math.min(end, totalPages); i++) {
          result.add(i);
        }
      }
    } else {
      const num = parseInt(part);
      if (!isNaN(num) && num >= 1 && num <= totalPages) {
        result.add(num);
      }
    }
  }

  return Array.from(result).sort((a, b) => a - b);
}

function downloadBlob(blob, filename) {
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(link.href);
}

function downloadPdf(pdfBytes, filename) {
  const blob = new Blob([pdfBytes], { type: 'application/pdf' });
  downloadBlob(blob, filename);
}

// ==================== Navigation ====================
const navItems = document.querySelectorAll('.nav-item');
const toolPanels = document.querySelectorAll('.tool-panel');

navItems.forEach(item => {
  item.addEventListener('click', () => {
    navItems.forEach(n => n.classList.remove('active'));
    item.classList.add('active');
    const tool = item.dataset.tool;
    toolPanels.forEach(p => p.classList.remove('active'));
    document.getElementById(`tool-${tool}`).classList.add('active');
  });
});

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

// ==================== Drag & Drop Helpers ====================
function setupDragDrop(dropzoneId, inputId, callback, multiple = false) {
  const dropzone = document.getElementById(dropzoneId);
  const input = document.getElementById(inputId);

  dropzone.addEventListener('click', () => input.click());

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
    const files = Array.from(e.dataTransfer.files).filter(f => f.type === 'application/pdf' || f.name.endsWith('.pdf'));
    if (files.length === 0) {
      showToast('请选择PDF文件', 'error');
      return;
    }
    if (!multiple && files.length > 1) {
      showToast('此工具仅支持单个PDF文件', 'info');
    }
    callback(multiple ? files : files[0]);
  });

  input.addEventListener('change', () => {
    const files = Array.from(input.files);
    if (files.length === 0) return;
    callback(multiple ? files : files[0]);
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
        <button class="remove-btn" data-index="${index}">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
          </svg>
        </button>
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
    progressEl.style.display = 'block';
    statusEl.textContent = '处理中...';
    statusEl.className = 'status-text';
    mergeBtn.disabled = true;

    try {
      const mergedPdf = await PDFLib.PDFDocument.create();

      for (const file of mergeFiles) {
        const arrayBuffer = await file.arrayBuffer();
        const pdf = await PDFLib.PDFDocument.load(arrayBuffer, { ignoreEncryption: true });
        const copiedPages = await mergedPdf.copyPages(pdf, pdf.getPageIndices());
        copiedPages.forEach(page => mergedPdf.addPage(page));
      }

      const pdfBytes = await mergedPdf.save();
      downloadPdf(pdfBytes, 'merged.pdf');

      statusEl.textContent = '✅ 下载已开始';
      statusEl.className = 'status-text success';
      showToast('合并完成! 下载已开始', 'success');
    } catch (error) {
      statusEl.textContent = '❌ 合并PDF失败: ' + error.message;
      statusEl.className = 'status-text error';
      showToast('合并失败: ' + error.message, 'error');
    } finally {
      progressEl.style.display = 'none';
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

  function setFile(file) {
    splitFile = file;
    selectedDiv.style.display = 'flex';
    selectedDiv.innerHTML = `
      📄 ${file.name} (${formatFileSize(file.size)})
      <button class="remove-file" id="split-remove">
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
    progressEl.style.display = 'block';
    statusEl.textContent = '处理中...';
    statusEl.className = 'status-text';
    extractBtn.disabled = true;
    splitAllBtn.disabled = true;

    try {
      const arrayBuffer = await splitFile.arrayBuffer();
      const sourcePdf = await PDFLib.PDFDocument.load(arrayBuffer, { ignoreEncryption: true });
      const totalPages = sourcePdf.getPageCount();
      const pageNumbers = parsePageRange(pagesInput.value.trim(), totalPages);

      if (pageNumbers.length === 0) {
        throw new Error('无效的页码范围');
      }

      const newPdf = await PDFLib.PDFDocument.create();
      for (const pageNum of pageNumbers) {
        const [copiedPage] = await newPdf.copyPages(sourcePdf, [pageNum - 1]);
        newPdf.addPage(copiedPage);
      }

      const pdfBytes = await newPdf.save();
      downloadPdf(pdfBytes, 'extracted.pdf');

      statusEl.textContent = '✅ 下载已开始';
      statusEl.className = 'status-text success';
      showToast('提取完成! 下载已开始', 'success');
    } catch (error) {
      statusEl.textContent = '❌ ' + error.message;
      statusEl.className = 'status-text error';
      showToast(error.message, 'error');
    } finally {
      progressEl.style.display = 'none';
      extractBtn.disabled = !splitFile;
      splitAllBtn.disabled = !splitFile;
    }
  });

  splitAllBtn.addEventListener('click', async () => {
    progressEl.style.display = 'block';
    statusEl.textContent = '处理中（大文件可能较慢）...';
    statusEl.className = 'status-text';
    extractBtn.disabled = true;
    splitAllBtn.disabled = true;

    try {
      const arrayBuffer = await splitFile.arrayBuffer();
      const sourcePdf = await PDFLib.PDFDocument.load(arrayBuffer, { ignoreEncryption: true });
      const totalPages = sourcePdf.getPageCount();
      const zip = new JSZip();

      for (let i = 0; i < totalPages; i++) {
        const newPdf = await PDFLib.PDFDocument.create();
        const [copiedPage] = await newPdf.copyPages(sourcePdf, [i]);
        newPdf.addPage(copiedPage);
        const pageBytes = await newPdf.save();
        zip.file(`page_${String(i + 1).padStart(3, '0')}.pdf`, pageBytes);
      }

      const zipBlob = await zip.generateAsync({ type: 'blob' });
      downloadBlob(zipBlob, 'split_pages.zip');

      statusEl.textContent = '✅ 下载已开始（共 ' + totalPages + ' 页）';
      statusEl.className = 'status-text success';
      showToast(`拆分完成! ${totalPages} 个页面已打包下载`, 'success');
    } catch (error) {
      statusEl.textContent = '❌ 拆分PDF失败: ' + error.message;
      statusEl.className = 'status-text error';
      showToast('拆分失败: ' + error.message, 'error');
    } finally {
      progressEl.style.display = 'none';
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

  function setFile(file) {
    removeFile = file;
    selectedDiv.style.display = 'flex';
    selectedDiv.innerHTML = `
      📄 ${file.name} (${formatFileSize(file.size)})
      <button class="remove-file" id="remove-clear">
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
    progressEl.style.display = 'block';
    statusEl.textContent = '处理中...';
    statusEl.className = 'status-text';
    removeBtn.disabled = true;

    try {
      const arrayBuffer = await removeFile.arrayBuffer();
      const sourcePdf = await PDFLib.PDFDocument.load(arrayBuffer, { ignoreEncryption: true });
      const totalPages = sourcePdf.getPageCount();
      const pagesToRemove = new Set(parsePageRange(pagesInput.value.trim(), totalPages));
      const newPdf = await PDFLib.PDFDocument.create();

      for (let i = 0; i < totalPages; i++) {
        if (!pagesToRemove.has(i + 1)) {
          const [copiedPage] = await newPdf.copyPages(sourcePdf, [i]);
          newPdf.addPage(copiedPage);
        }
      }

      if (newPdf.getPageCount() === 0) {
        throw new Error('删除后PDF将没有页面');
      }

      const pdfBytes = await newPdf.save();
      downloadPdf(pdfBytes, 'pages_removed.pdf');

      statusEl.textContent = '✅ 下载已开始';
      statusEl.className = 'status-text success';
      showToast('页面删除完成! 下载已开始', 'success');
    } catch (error) {
      statusEl.textContent = '❌ ' + error.message;
      statusEl.className = 'status-text error';
      showToast(error.message, 'error');
    } finally {
      progressEl.style.display = 'none';
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
      <button class="remove-file" id="rotate-clear">
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
    progressEl.style.display = 'block';
    statusEl.textContent = '处理中...';
    statusEl.className = 'status-text';
    rotateBtn.disabled = true;

    try {
      const arrayBuffer = await rotateFile.arrayBuffer();
      const sourcePdf = await PDFLib.PDFDocument.load(arrayBuffer, { ignoreEncryption: true });
      const totalPages = sourcePdf.getPageCount();

      const pagesToRotate = pagesInput.value.trim()
        ? parsePageRange(pagesInput.value.trim(), totalPages)
        : null;

      for (let i = 0; i < totalPages; i++) {
        if (!pagesToRotate || pagesToRotate.includes(i + 1)) {
          const page = sourcePdf.getPage(i);
          const currentRotation = page.getRotation().angle;
          page.setRotation(PDFLib.degrees((currentRotation + selectedAngle) % 360));
        }
      }

      const pdfBytes = await sourcePdf.save();
      downloadPdf(pdfBytes, 'rotated.pdf');

      statusEl.textContent = '✅ 下载已开始';
      statusEl.className = 'status-text success';
      showToast('旋转完成! 下载已开始', 'success');
    } catch (error) {
      statusEl.textContent = '❌ 旋转PDF失败: ' + error.message;
      statusEl.className = 'status-text error';
      showToast('旋转失败: ' + error.message, 'error');
    } finally {
      progressEl.style.display = 'none';
      rotateBtn.disabled = !rotateFile;
    }
  });
})();

// ==================== 5. Reorder Pages ====================
(function() {
  let reorderFile = null;
  const selectedDiv = document.getElementById('reorder-selected');
  const reverseBtn = document.getElementById('reorder-reverse-btn');
  const customBtn = document.getElementById('reorder-custom-btn');
  const customInput = document.getElementById('reorder-custom');
  const statusEl = document.getElementById('reorder-status');
  const progressEl = document.getElementById('reorder-progress');

  function setFile(file) {
    reorderFile = file;
    selectedDiv.style.display = 'flex';
    selectedDiv.innerHTML = `
      📄 ${file.name} (${formatFileSize(file.size)})
      <button class="remove-file" id="reorder-clear">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
        </svg>
      </button>
    `;
    document.getElementById('reorder-clear').addEventListener('click', () => {
      reorderFile = null;
      selectedDiv.style.display = 'none';
      reverseBtn.disabled = true;
      customBtn.disabled = true;
    });
    reverseBtn.disabled = false;
    customBtn.disabled = false;
  }

  setupDragDrop('reorder-dropzone', 'reorder-input', setFile);

  async function doReorder(order) {
    progressEl.style.display = 'block';
    statusEl.textContent = '处理中...';
    statusEl.className = 'status-text';
    reverseBtn.disabled = true;
    customBtn.disabled = true;

    try {
      const arrayBuffer = await reorderFile.arrayBuffer();
      const sourcePdf = await PDFLib.PDFDocument.load(arrayBuffer, { ignoreEncryption: true });
      const totalPages = sourcePdf.getPageCount();

      let newOrder;
      if (order === 'reverse') {
        newOrder = Array.from({ length: totalPages }, (_, i) => totalPages - 1 - i);
      } else {
        newOrder = order.split(',').map(n => parseInt(n.trim()) - 1);
        if (newOrder.length !== totalPages) {
          throw new Error('新顺序的页数与原PDF不符');
        }
      }

      const newPdf = await PDFLib.PDFDocument.create();
      for (const idx of newOrder) {
        const [copiedPage] = await newPdf.copyPages(sourcePdf, [idx]);
        newPdf.addPage(copiedPage);
      }

      const pdfBytes = await newPdf.save();
      downloadPdf(pdfBytes, 'reordered.pdf');

      statusEl.textContent = '✅ 下载已开始';
      statusEl.className = 'status-text success';
      showToast('重排完成! 下载已开始', 'success');
    } catch (error) {
      statusEl.textContent = '❌ ' + error.message;
      statusEl.className = 'status-text error';
      showToast(error.message, 'error');
    } finally {
      progressEl.style.display = 'none';
      reverseBtn.disabled = !reorderFile;
      customBtn.disabled = !reorderFile;
    }
  }

  reverseBtn.addEventListener('click', () => doReorder('reverse'));
  customBtn.addEventListener('click', () => doReorder(customInput.value.trim()));
})();

// ==================== 6. PDF Info ====================
(function() {
  const statusEl = document.getElementById('info-status');
  const resultDiv = document.getElementById('info-result');

  function setFile(file) {
    showInfo(file);
  }

  setupDragDrop('info-dropzone', 'info-input', setFile);

  async function showInfo(file) {
    statusEl.textContent = '读取中...';
    statusEl.className = 'status-text';
    resultDiv.style.display = 'none';

    try {
      const arrayBuffer = await file.arrayBuffer();
      const pdf = await PDFLib.PDFDocument.load(arrayBuffer, { ignoreEncryption: true });
      const totalPages = pdf.getPageCount();

      // Get page sizes
      const pages = [];
      for (let i = 0; i < totalPages; i++) {
        const page = pdf.getPage(i);
        const { width, height } = page.getSize();
        pages.push({ page: i + 1, width: Math.round(width), height: Math.round(height) });
      }

      const info = {
        fileName: file.name,
        pageCount: totalPages,
        fileSize: file.size,
        fileSizeFormatted: formatFileSize(file.size),
        pages: pages,
        title: pdf.getTitle() || 'N/A',
        author: pdf.getAuthor() || 'N/A',
        creator: pdf.getCreator() || 'N/A',
        creationDate: pdf.getCreationDate() || null,
        modificationDate: pdf.getModificationDate() || null,
      };

      resultDiv.innerHTML = `
        <table class="info-table">
          <tr><th>文件名</th><td>${info.fileName}</td></tr>
          <tr><th>页数</th><td><strong>${info.pageCount}</strong> 页</td></tr>
          <tr><th>文件大小</th><td>${info.fileSizeFormatted} (${info.fileSize.toLocaleString()} bytes)</td></tr>
          <tr><th>标题</th><td>${info.title || 'N/A'}</td></tr>
          <tr><th>作者</th><td>${info.author || 'N/A'}</td></tr>
          <tr><th>创建工具</th><td>${info.creator || 'N/A'}</td></tr>
          ${info.creationDate ? `<tr><th>创建日期</th><td>${new Date(info.creationDate).toLocaleString()}</td></tr>` : ''}
          ${info.modificationDate ? `<tr><th>修改日期</th><td>${new Date(info.modificationDate).toLocaleString()}</td></tr>` : ''}
          <tr><th>页面尺寸</th><td>
            <div style="max-height: 200px; overflow-y: auto;">
              ${info.pages.map(p => `第${p.page}页: ${p.width} × ${p.height} pt`).join('<br>')}
            </div>
          </td></tr>
        </table>
      `;
      resultDiv.style.display = 'block';
      statusEl.textContent = '';
      showToast('PDF信息读取完成', 'success');
    } catch (error) {
      statusEl.textContent = '❌ 读取PDF信息失败: ' + error.message;
      statusEl.className = 'status-text error';
      showToast('读取失败: ' + error.message, 'error');
    }
  }
})();

// ==================== 7. Edit PDF ====================
(function() {
  // Configure pdf.js worker
  pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';

  const uploadArea = document.getElementById('edit-upload');
  const editorDiv = document.getElementById('edit-editor');
  const pagesContainer = document.getElementById('edit-pages-container');
  const statusEl = document.getElementById('edit-status');
  const progressEl = document.getElementById('edit-progress');
  const zoomLabel = document.getElementById('edit-zoom-label');

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
    progressEl.style.display = 'block';
    statusEl.textContent = '加载PDF中...';
    statusEl.className = 'status-text';

    try {
      const arrayBuffer = await file.arrayBuffer();
      state.pdfBytes = arrayBuffer;
      state.annotations = [];
      state.selectedId = null;
      state.nextId = 1;

      // Load with pdf.js for rendering
      const loadingTask = pdfjsLib.getDocument({ data: arrayBuffer.slice(0) });
      state.pdfDoc = await loadingTask.promise;
      state.totalPages = state.pdfDoc.numPages;

      // Load with pdf-lib to get page dimensions
      const pdfLibDoc = await PDFLib.PDFDocument.load(arrayBuffer, { ignoreEncryption: true });
      state.pageDims = [];
      for (let i = 0; i < state.totalPages; i++) {
        const page = pdfLibDoc.getPage(i);
        const { width, height } = page.getSize();
        state.pageDims.push({ width, height });
      }

      await renderAllPages();

      uploadArea.style.display = 'none';
      editorDiv.style.display = 'block';
      statusEl.textContent = '';
      showToast(`已加载 ${state.totalPages} 页`, 'success');
    } catch (error) {
      statusEl.textContent = '❌ 加载PDF失败: ' + error.message;
      statusEl.className = 'status-text error';
      showToast('加载失败: ' + error.message, 'error');
    } finally {
      progressEl.style.display = 'none';
    }
  }

  async function renderAllPages() {
    pagesContainer.innerHTML = '';

    for (let i = 0; i < state.totalPages; i++) {
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
      await pdfPage.render({ canvasContext: ctx, viewport: viewport }).promise;
      card.appendChild(canvas);

      // Annotations layer
      const annLayer = document.createElement('div');
      annLayer.className = 'annotations-layer';
      annLayer.dataset.pageIndex = i;
      card.appendChild(annLayer);

      pagesContainer.appendChild(card);
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
    await renderAllPages();
  });

  document.getElementById('edit-zoom-out').addEventListener('click', async () => {
    if (state.scale <= 0.5) return;
    state.scale = Math.round((state.scale - 0.25) * 100) / 100;
    await renderAllPages();
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
  document.getElementById('edit-export').addEventListener('click', async () => {
    progressEl.style.display = 'block';
    statusEl.textContent = '生成PDF中...';
    statusEl.className = 'status-text';

    try {
      const pdfDoc = await PDFLib.PDFDocument.load(state.pdfBytes.slice(0), { ignoreEncryption: true });

      for (let i = 0; i < state.totalPages; i++) {
        const page = pdfDoc.getPage(i);
        const pageH = state.pageDims[i].height;
        const pageAnns = state.annotations.filter(a => a.pageIndex === i);

        for (const ann of pageAnns) {
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
      }

      const pdfBytes = await pdfDoc.save();
      downloadPdf(pdfBytes, 'edited.pdf');

      statusEl.textContent = '✅ 下载已开始';
      statusEl.className = 'status-text success';
      showToast('PDF导出完成!', 'success');
    } catch (error) {
      statusEl.textContent = '❌ 导出失败: ' + error.message;
      statusEl.className = 'status-text error';
      showToast('导出失败: ' + error.message, 'error');
    } finally {
      progressEl.style.display = 'none';
    }
  });
})();

// ==================== 8. Translate PDF ====================
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
  async function translateText(text, from, to) {
    if (!text || !text.trim()) return '';
    const langPair = from === 'auto' ? `en|${to}` : `${from}|${to}`;
    const url = `https://api.mymemory.translated.net/get?q=${encodeURIComponent(text)}&langpair=${langPair}`;
    const resp = await fetch(url);
    if (!resp.ok) throw new Error('翻译服务请求失败');
    const data = await resp.json();
    if (data.responseStatus !== 200) throw new Error('翻译服务返回错误');
    return data.responseData.translatedText;
  }

  async function translateChunked(text, from, to) {
    const maxLen = 500;
    if (text.length <= maxLen) return translateText(text, from, to);
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
    for (const chunk of chunks) {
      results.push(await translateText(chunk, from, to));
      await new Promise(r => setTimeout(r, 200));
    }
    return results.join(' ');
  }

  // ============ Upload & Render ============
  setupDragDrop('translate-dropzone', 'translate-input', (file) => {
    loadTranslatePDF(file);
  });

  async function loadTranslatePDF(file) {
    progressEl.style.display = 'block';
    statusEl.textContent = '加载PDF中...';
    statusEl.className = 'status-text';

    try {
      const arrayBuffer = await file.arrayBuffer();
      state.pdfBytes = arrayBuffer;

      const loadingTask = pdfjsLib.getDocument({ data: arrayBuffer.slice(0) });
      state.pdfDoc = await loadingTask.promise;
      state.totalPages = state.pdfDoc.numPages;

      const pdfLibDoc = await PDFLib.PDFDocument.load(arrayBuffer, { ignoreEncryption: true });
      state.pageDims = [];
      for (let i = 0; i < state.totalPages; i++) {
        const page = pdfLibDoc.getPage(i);
        state.pageDims.push(page.getSize());
      }

      // Render in select mode by default
      await renderPagesTo(pagesContainer, state.scale, true);
      pagesContainer.style.display = 'block';
      fullContainer.style.display = 'none';

      uploadArea.style.display = 'none';
      viewerDiv.style.display = 'block';
      fullTranslateBtn.style.display = (state.mode === 'full') ? 'inline-flex' : 'none';
      hintEl.style.display = (state.mode === 'select') ? 'inline' : 'none';
      statusEl.textContent = '';
      showToast(`已加载 ${state.totalPages} 页`, 'success');
    } catch (error) {
      statusEl.textContent = '❌ 加载失败: ' + error.message;
      statusEl.className = 'status-text error';
      showToast('加载失败: ' + error.message, 'error');
    } finally {
      progressEl.style.display = 'none';
    }
  }

  async function renderPagesTo(container, scale, withTextLayer) {
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
      card.appendChild(canvas);

      if (withTextLayer) {
        const textLayerDiv = document.createElement('div');
        textLayerDiv.className = 'textLayer';
        textLayerDiv.style.width = viewport.width + 'px';
        textLayerDiv.style.height = viewport.height + 'px';
        const textContent = await pdfPage.getTextContent();
        await pdfjsLib.renderTextLayer({
          textContentSource: textContent,
          container: textLayerDiv,
          viewport: viewport,
        });
        textLayerDiv.dataset.pageIndex = i;
        card.appendChild(textLayerDiv);
      }

      container.appendChild(card);
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

      try {
        const result = await translateChunked(selectedText, langFrom.value, langTo.value);
        popupResult.textContent = result;
      } catch (err) {
        popupResult.textContent = '翻译失败，请重试';
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
    btn.addEventListener('click', () => {
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
          renderPagesTo(pdfCol, state.fullScale, false);
          resultInner.innerHTML = '<div style="padding:40px;text-align:center;color:var(--text-muted);">点击「开始全文翻译」查看对照结果</div>';
        }
      }
    });
  });

  // ============ Full Translation ============
  fullTranslateBtn.addEventListener('click', async () => {
    if (state.totalPages === 0) return;

    progressEl.style.display = 'block';
    fullTranslateBtn.disabled = true;
    resultInner.innerHTML = '';

    // Show two-column layout
    pagesContainer.style.display = 'none';
    fullContainer.style.display = 'grid';
    await renderPagesTo(pdfCol, state.fullScale, false);

    statusEl.textContent = '提取文本并翻译中...';
    statusEl.className = 'status-text';

    try {
      // Extract paragraphs preserving format
      const paragraphs = [];
      for (let i = 0; i < state.totalPages; i++) {
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
      }

      // Translate paragraph by paragraph
      const from = langFrom.value;
      const to = langTo.value;
      for (let k = 0; k < paragraphs.length; k++) {
        statusEl.textContent = `翻译中 (${k + 1}/${paragraphs.length})...`;
        paragraphs[k].translated = await translateChunked(paragraphs[k].text, from, to);
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

      statusEl.textContent = '✅ 全文翻译完成 — 左侧PDF原文，右侧中英对照';
      statusEl.className = 'status-text success';
      showToast(`全文翻译完成! 共 ${paragraphs.length} 段`, 'success');
    } catch (error) {
      resultInner.innerHTML = `<div style="padding:24px;color:var(--danger);">翻译失败: ${escapeHtml(error.message)}</div>`;
      statusEl.textContent = '❌ 翻译失败: ' + error.message;
      statusEl.className = 'status-text error';
      showToast('翻译失败: ' + error.message, 'error');
    } finally {
      progressEl.style.display = 'none';
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
