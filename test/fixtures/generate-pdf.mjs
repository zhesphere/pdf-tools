import { writeFile } from 'node:fs/promises';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';

const outputPath = process.argv[2];
const pageCount = Math.max(1, Number.parseInt(process.argv[3] || '6', 10));

if (!outputPath) throw new Error('Usage: node test/fixtures/generate-pdf.mjs <output.pdf> [pages]');

const document = await PDFDocument.create();
const font = await document.embedFont(StandardFonts.Helvetica);

for (let index = 0; index < pageCount; index += 1) {
  const page = document.addPage([595, 842]);
  page.drawText(`Orbitvo PDF Tools test page ${index + 1}`, {
    x: 64,
    y: 760,
    size: 18,
    font,
    color: rgb(0.14, 0.18, 0.3),
  });
}

await writeFile(outputPath, await document.save());
