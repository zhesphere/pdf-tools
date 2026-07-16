const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { PDFDocument } = require('pdf-lib');
const archiver = require('archiver');

const app = express();
const PORT = 3000;

// Ensure uploads directory exists
const uploadsDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

// Multer setup
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadsDir),
  filename: (req, file, cb) => {
    const uniqueName = Date.now() + '-' + Math.round(Math.random() * 1E9) + '-' + file.originalname;
    cb(null, uniqueName);
  }
});
const upload = multer({ storage, limits: { fileSize: 100 * 1024 * 1024 } }); // 100MB limit

app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());

// Cleanup old files periodically (every 30 minutes, remove files older than 1 hour)
setInterval(() => {
  fs.readdir(uploadsDir, (err, files) => {
    if (err) return;
    const now = Date.now();
    files.forEach(file => {
      const filePath = path.join(uploadsDir, file);
      fs.stat(filePath, (err, stats) => {
        if (err) return;
        if (now - stats.mtimeMs > 60 * 60 * 1000) {
          fs.unlink(filePath, () => {});
        }
      });
    });
  });
}, 30 * 60 * 1000);

// ==================== API Routes ====================

// 1. Merge PDFs
app.post('/api/merge', upload.array('pdfs', 50), async (req, res) => {
  try {
    if (!req.files || req.files.length < 2) {
      return res.status(400).json({ error: '请上传至少2个PDF文件' });
    }

    const mergedPdf = await PDFDocument.create();

    for (const file of req.files) {
      const pdfBytes = fs.readFileSync(file.path);
      const pdf = await PDFDocument.load(pdfBytes, { ignoreEncryption: true });
      const copiedPages = await mergedPdf.copyPages(pdf, pdf.getPageIndices());
      copiedPages.forEach(page => mergedPdf.addPage(page));
    }

    const mergedPdfBytes = await mergedPdf.save();
    const outputPath = path.join(uploadsDir, 'merged-' + Date.now() + '.pdf');
    fs.writeFileSync(outputPath, mergedPdfBytes);

    // Clean up uploaded files
    req.files.forEach(f => fs.unlink(f.path, () => {}));

    res.download(outputPath, 'merged.pdf', () => {
      fs.unlink(outputPath, () => {});
    });
  } catch (error) {
    res.status(500).json({ error: '合并PDF失败: ' + error.message });
  }
});

// 2. Split PDF - extract specific pages
app.post('/api/split', upload.single('pdf'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: '请上传一个PDF文件' });
    }

    const { pages, mode } = req.body;
    const pdfBytes = fs.readFileSync(req.file.path);
    const sourcePdf = await PDFDocument.load(pdfBytes, { ignoreEncryption: true });
    const totalPages = sourcePdf.getPageCount();

    if (mode === 'extract') {
      // Extract specific pages (comma-separated, e.g., "1,3,5-7")
      const pageNumbers = parsePageRange(pages, totalPages);
      if (pageNumbers.length === 0) {
        return res.status(400).json({ error: '无效的页码范围' });
      }

      const newPdf = await PDFDocument.create();
      for (const pageNum of pageNumbers) {
        const [copiedPage] = await newPdf.copyPages(sourcePdf, [pageNum - 1]);
        newPdf.addPage(copiedPage);
      }

      const outputBytes = await newPdf.save();
      const outputPath = path.join(uploadsDir, 'extracted-' + Date.now() + '.pdf');
      fs.writeFileSync(outputPath, outputBytes);

      fs.unlink(req.file.path, () => {});
      res.download(outputPath, 'extracted.pdf', () => {
        fs.unlink(outputPath, () => {});
      });
    } else if (mode === 'splitAll') {
      // Split every page into individual PDFs, return as ZIP
      const zipPath = path.join(uploadsDir, 'split-' + Date.now() + '.zip');
      const output = fs.createWriteStream(zipPath);
      const archive = archiver('zip', { zlib: { level: 9 } });

      output.on('close', () => {
        fs.unlink(req.file.path, () => {});
        res.download(zipPath, 'split_pages.zip', () => {
          fs.unlink(zipPath, () => {});
        });
      });

      archive.on('error', (err) => {
        res.status(500).json({ error: '创建ZIP失败: ' + err.message });
      });

      archive.pipe(output);

      for (let i = 0; i < totalPages; i++) {
        const newPdf = await PDFDocument.create();
        const [copiedPage] = await newPdf.copyPages(sourcePdf, [i]);
        newPdf.addPage(copiedPage);
        const pageBytes = await newPdf.save();
        archive.append(Buffer.from(pageBytes), { name: `page_${i + 1}.pdf` });
      }

      await archive.finalize();
    } else {
      res.status(400).json({ error: '无效的拆分模式' });
    }
  } catch (error) {
    res.status(500).json({ error: '拆分PDF失败: ' + error.message });
  }
});

// 3. Remove pages from PDF
app.post('/api/remove-pages', upload.single('pdf'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: '请上传一个PDF文件' });
    }

    const { pages } = req.body;
    const pdfBytes = fs.readFileSync(req.file.path);
    const sourcePdf = await PDFDocument.load(pdfBytes, { ignoreEncryption: true });
    const totalPages = sourcePdf.getPageCount();

    const pagesToRemove = new Set(parsePageRange(pages, totalPages));
    const newPdf = await PDFDocument.create();

    for (let i = 0; i < totalPages; i++) {
      if (!pagesToRemove.has(i + 1)) {
        const [copiedPage] = await newPdf.copyPages(sourcePdf, [i]);
        newPdf.addPage(copiedPage);
      }
    }

    if (newPdf.getPageCount() === 0) {
      return res.status(400).json({ error: '删除后PDF将没有页面' });
    }

    const outputBytes = await newPdf.save();
    const outputPath = path.join(uploadsDir, 'removed-' + Date.now() + '.pdf');
    fs.writeFileSync(outputPath, outputBytes);

    fs.unlink(req.file.path, () => {});
    res.download(outputPath, 'pages_removed.pdf', () => {
      fs.unlink(outputPath, () => {});
    });
  } catch (error) {
    res.status(500).json({ error: '删除页面失败: ' + error.message });
  }
});

// 4. Get PDF info (page count, file size, etc.)
app.post('/api/info', upload.single('pdf'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: '请上传一个PDF文件' });
    }

    const pdfBytes = fs.readFileSync(req.file.path);
    const pdf = await PDFDocument.load(pdfBytes, { ignoreEncryption: true });
    const totalPages = pdf.getPageCount();
    const fileSize = req.file.size;

    // Get page sizes
    const pages = [];
    for (let i = 0; i < totalPages; i++) {
      const page = pdf.getPage(i);
      const { width, height } = page.getSize();
      pages.push({ page: i + 1, width: Math.round(width), height: Math.round(height) });
    }

    fs.unlink(req.file.path, () => {});

    res.json({
      fileName: req.file.originalname,
      pageCount: totalPages,
      fileSize: fileSize,
      fileSizeFormatted: formatFileSize(fileSize),
      pages: pages,
      title: pdf.getTitle() || 'N/A',
      author: pdf.getAuthor() || 'N/A',
      creator: pdf.getCreator() || 'N/A',
      creationDate: pdf.getCreationDate() || null,
      modificationDate: pdf.getModificationDate() || null,
    });
  } catch (error) {
    res.status(500).json({ error: '读取PDF信息失败: ' + error.message });
  }
});

// 5. Rotate PDF pages
app.post('/api/rotate', upload.single('pdf'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: '请上传一个PDF文件' });
    }

    const { rotation, pages } = req.body; // rotation: 90, 180, 270
    const angle = parseInt(rotation) || 90;
    const pdfBytes = fs.readFileSync(req.file.path);
    const sourcePdf = await PDFDocument.load(pdfBytes, { ignoreEncryption: true });
    const totalPages = sourcePdf.getPageCount();

    const pagesToRotate = pages ? parsePageRange(pages, totalPages) : null;

    for (let i = 0; i < totalPages; i++) {
      if (!pagesToRotate || pagesToRotate.includes(i + 1)) {
        const page = sourcePdf.getPage(i);
        const currentRotation = page.getRotation().angle;
        page.setRotation({ angle: (currentRotation + angle) % 360 });
      }
    }

    const outputBytes = await sourcePdf.save();
    const outputPath = path.join(uploadsDir, 'rotated-' + Date.now() + '.pdf');
    fs.writeFileSync(outputPath, outputBytes);

    fs.unlink(req.file.path, () => {});
    res.download(outputPath, 'rotated.pdf', () => {
      fs.unlink(outputPath, () => {});
    });
  } catch (error) {
    res.status(500).json({ error: '旋转PDF失败: ' + error.message });
  }
});

// 6. Reorder/reverse pages
app.post('/api/reorder', upload.single('pdf'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: '请上传一个PDF文件' });
    }

    const { order } = req.body; // "reverse" or custom order like "3,1,2"
    const pdfBytes = fs.readFileSync(req.file.path);
    const sourcePdf = await PDFDocument.load(pdfBytes, { ignoreEncryption: true });
    const totalPages = sourcePdf.getPageCount();

    let newOrder;
    if (order === 'reverse') {
      newOrder = Array.from({ length: totalPages }, (_, i) => totalPages - 1 - i);
    } else {
      newOrder = order.split(',').map(n => parseInt(n.trim()) - 1);
      // Validate
      if (newOrder.length !== totalPages) {
        return res.status(400).json({ error: '新顺序的页数与原PDF不符' });
      }
    }

    const newPdf = await PDFDocument.create();
    for (const idx of newOrder) {
      const [copiedPage] = await newPdf.copyPages(sourcePdf, [idx]);
      newPdf.addPage(copiedPage);
    }

    const outputBytes = await newPdf.save();
    const outputPath = path.join(uploadsDir, 'reordered-' + Date.now() + '.pdf');
    fs.writeFileSync(outputPath, outputBytes);

    fs.unlink(req.file.path, () => {});
    res.download(outputPath, 'reordered.pdf', () => {
      fs.unlink(outputPath, () => {});
    });
  } catch (error) {
    res.status(500).json({ error: '重排PDF失败: ' + error.message });
  }
});

// ==================== Helper Functions ====================

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

function formatFileSize(bytes) {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(2) + ' MB';
}

app.listen(PORT, () => {
  console.log(`PDF Tools server running at http://localhost:${PORT}`);
  console.log('Available tools: Merge, Split, Remove Pages, Rotate, Reorder, View Info');
});
