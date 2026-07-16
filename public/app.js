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
