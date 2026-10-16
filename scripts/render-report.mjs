import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { createCanvas, DOMMatrix, ImageData, Path2D } from '@napi-rs/canvas';
globalThis.DOMMatrix = DOMMatrix; globalThis.ImageData = ImageData; globalThis.Path2D = Path2D;
const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs');
const pdf = process.argv[2];
if (!pdf || !path.resolve(pdf).startsWith(path.resolve('.local') + path.sep)) throw new Error('Use um PDF de teste em .local.');
const loading = getDocument({ data: new Uint8Array(readFileSync(pdf)), useSystemFonts: true });
const doc = await loading.promise;
mkdirSync('.local/pdf-pages', { recursive: true });
for (let i = 1; i <= doc.numPages; i++) {
  const page = await doc.getPage(i); const viewport = page.getViewport({ scale: 1.5 }); const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
  await page.render({ canvas, canvasContext: canvas.getContext('2d'), viewport }).promise;
  writeFileSync(`.local/pdf-pages/${path.basename(pdf, '.pdf')}-${i}.png`, canvas.toBuffer('image/png'));
  const content = await page.getTextContent(); const text = content.items.filter(item => 'str' in item).map(item => item.str).join(' ');
  console.log(`Página ${i}/${doc.numPages}: ${text.slice(0, 80)}…`);
}
await loading.destroy();
