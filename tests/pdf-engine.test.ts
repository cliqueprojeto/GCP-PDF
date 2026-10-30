import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { PDFDocument, StandardFonts, degrees } from 'pdf-lib';
import { addOcrTextLayer, applyPdfOperation, combinePdfs, createBlankPdf, pageCount, transferPdfPages } from '../src/main/pdf-engine';

async function fixture(labels: string[]): Promise<Uint8Array> {
  const doc = await PDFDocument.create(); const font = await doc.embedFont(StandardFonts.Helvetica);
  labels.forEach((label, index) => { const page = doc.addPage([200 + index * 20, 260]); page.drawText(label, { x: 20, y: 210, size: 16, font }); });
  return doc.save();
}
let pdfJs: Promise<typeof import('pdfjs-dist/legacy/build/pdf.mjs')> | undefined;
async function pdfjs() {
  pdfJs ??= (async () => {
    const canvas = await import('@napi-rs/canvas');
    Object.assign(globalThis, { DOMMatrix: canvas.DOMMatrix, ImageData: canvas.ImageData, Path2D: canvas.Path2D });
    return import('pdfjs-dist/legacy/build/pdf.mjs');
  })();
  return pdfJs;
}
async function text(bytes: Uint8Array): Promise<string[]> {
  const { getDocument } = await pdfjs(); const task = getDocument({ data: new Uint8Array(bytes), useSystemFonts: false, standardFontDataUrl: path.resolve('node_modules/pdfjs-dist/standard_fonts').replaceAll('\\', '/') + '/' }); const doc = await task.promise;
  try {
    const result: string[] = [];
    for (let index = 1; index <= doc.numPages; index++) {
      const page = await doc.getPage(index), content = await page.getTextContent();
      result.push(content.items.filter(item => 'str' in item).map(item => 'str' in item ? item.str : '').join(' ').replace(/\s+/g, ' ').trim());
    }
    return result;
  } finally { await task.destroy(); }
}
async function raster(bytes: Uint8Array) {
  const { getDocument } = await pdfjs(), { createCanvas } = await import('@napi-rs/canvas');
  const task = getDocument({ data: new Uint8Array(bytes), standardFontDataUrl: path.resolve('node_modules/pdfjs-dist/standard_fonts').replaceAll('\\', '/') + '/' }); const doc = await task.promise;
  try {
    const page = await doc.getPage(1), viewport = page.getViewport({ scale: 1 });
    const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
    const context = canvas.getContext('2d');
    await page.render({ canvas: canvas as never, canvasContext: context as never, viewport }).promise;
    return { width: canvas.width, height: canvas.height, pixels: new Uint8Array(context.getImageData(0, 0, canvas.width, canvas.height).data), pixel(x: number, y: number) { return Array.from(context.getImageData(x, y, 1, 1).data); } };
  } finally { await task.destroy(); }
}

test('creates a real one-page A4 PDF and rejects malformed input', async () => {
  const bytes = await createBlankPdf(); assert.equal(await pageCount(bytes), 1);
  const doc = await PDFDocument.load(bytes); assert.ok(Math.abs(doc.getPage(0).getWidth() - 595.2756) < 0.01);
  await assert.rejects(pageCount(new Uint8Array()), /vazio/);
  await assert.rejects(pageCount(new TextEncoder().encode('not a PDF')), /abrir o PDF/);
});

test('rotation composes with existing rotation and persists through reorder/save', async () => {
  let bytes = await fixture(['A', 'B', 'C']);
  bytes = await applyPdfOperation(bytes, { type: 'rotate', pages: [1], degrees: 90 });
  bytes = await applyPdfOperation(bytes, { type: 'rotate', pages: [1], degrees: 270 });
  assert.equal((await PDFDocument.load(bytes)).getPage(1).getRotation().angle, 0);
  bytes = await applyPdfOperation(bytes, { type: 'rotate', pages: [2], degrees: -90 });
  bytes = await applyPdfOperation(bytes, { type: 'reorder', order: [2, 0, 1] });
  const doc = await PDFDocument.load(bytes); assert.equal(doc.getPage(0).getRotation().angle, 270);
  assert.equal(doc.getPage(0).getWidth(), 240); assert.deepEqual(await text(bytes), ['C', 'A', 'B']);
});

test('copies and moves selected pages across documents with order and rotation intact', async () => {
  let source = await fixture(['S0', 'S1', 'S2']);
  source = await applyPdfOperation(source, { type: 'rotate', pages: [2], degrees: 90 });
  const target = await fixture(['T0', 'T1']);
  const copied = await transferPdfPages(source, target, [2, 0], 1, false);
  assert.deepEqual(copied.source, source); assert.deepEqual(await text(copied.target), ['T0', 'S2', 'S0', 'T1']);
  assert.equal((await PDFDocument.load(copied.target)).getPage(1).getRotation().angle, 90);
  const moved = await transferPdfPages(source, target, [1], 0, true);
  assert.deepEqual(await text(moved.source), ['S0', 'S2']); assert.deepEqual(await text(moved.target), ['S1', 'T0', 'T1']);
  assert.deepEqual(await text(source), ['S0', 'S1', 'S2']);
});

test('validates selections before making destructive edits', async () => {
  const bytes = await fixture(['A', 'B']);
  for (const pages of [[], [-1], [2], [0.5], [0, 0]]) {
    await assert.rejects(applyPdfOperation(bytes, { type: 'delete', pages }));
    await assert.rejects(transferPdfPages(bytes, bytes, pages, 0, false));
  }
  await assert.rejects(applyPdfOperation(bytes, { type: 'delete', pages: [0, 1] }), /pelo menos uma página/);
  await assert.rejects(transferPdfPages(bytes, bytes, [0, 1], 0, true), /origem/);
  await assert.rejects(transferPdfPages(bytes, bytes, [0], 3, false), /posição/);
  await assert.rejects(applyPdfOperation(bytes, { type: 'reorder', order: [0] }), /todas/);
  await assert.rejects(applyPdfOperation(bytes, { type: 'rotate', pages: [0], degrees: 45 }), /90/);
  assert.deepEqual(await text(bytes), ['A', 'B']);
});

test('blank insertion, page deletion and document combination preserve page contents', async () => {
  let bytes = await fixture(['A', 'B']);
  bytes = await applyPdfOperation(bytes, { type: 'blank', index: 1 });
  assert.equal(await pageCount(bytes), 3); assert.deepEqual(await text(bytes), ['A', '', 'B']);
  bytes = await applyPdfOperation(bytes, { type: 'delete', pages: [0] });
  const result = await combinePdfs([bytes, await fixture(['C'])]);
  assert.deepEqual(await text(result), ['', 'B', 'C']);
  await assert.rejects(combinePdfs([]), /pelo menos um/);
});

test('PT-BR text is embedded as editable Unicode text, not a page bitmap', async () => {
  const phrase = 'Gestão Cultural Pro — São João, ação e coração';
  const bytes = await applyPdfOperation(await createBlankPdf(), { type: 'text', page: 0, x: 25, y: 40, text: phrase, size: 14, color: '#6d28d9' });
  assert.deepEqual(await text(bytes), [phrase]);

});

test('top-left drawing positions respect crop boxes and all four page rotations', async () => {
  for (const angle of [0, 90, 180, 270]) {
    const doc = await PDFDocument.create(), page = doc.addPage([200, 220]);
    page.setCropBox(20, 30, 100, 140); page.setRotation(degrees(angle));
    const bytes = await applyPdfOperation(await doc.save(), { type: 'highlight', page: 0, x: 10, y: 20, width: 30, height: 16, color: '#ff0000' });
    const image = await raster(bytes), red = image.pixel(20, 25), white = image.pixel(70, 70);
    assert.equal(image.width, angle % 180 ? 140 : 100); assert.equal(image.height, angle % 180 ? 100 : 140);
    assert.ok(red[0]! > red[1]! + 30, `red highlight is at the top-left UI position for ${angle}°`);
    assert.ok(white[0]! > 245 && white[1]! > 245 && white[2]! > 245);
  }
});

test('image placement and drawn lines persist as PDF content on a rotated page', async () => {
  const { createCanvas } = await import('@napi-rs/canvas'); const stamp = createCanvas(2, 2), context = stamp.getContext('2d');
  context.fillStyle = '#ff0000'; context.fillRect(0, 0, 2, 2);
  let bytes = await createBlankPdf(); bytes = await applyPdfOperation(bytes, { type: 'rotate', pages: [0], degrees: 90 });
  bytes = await applyPdfOperation(bytes, { type: 'image', page: 0, x: 10, y: 12, width: 20, height: 18, dataUrl: stamp.toDataURL('image/png') });
  bytes = await applyPdfOperation(bytes, { type: 'draw', page: 0, points: [{x: 40, y: 20}, {x: 80, y: 20}], width: 4, color: '#0000ff' });
  const image = await raster(bytes); assert.ok(image.pixel(15, 18)[0]! > 240 && image.pixel(15, 18)[1]! < 20);
  assert.ok(image.pixel(60, 20)[2]! > 240 && image.pixel(60, 20)[0]! < 20);
  await assert.rejects(applyPdfOperation(bytes, {type:'draw',page:0,points:[],width:2,color:'#000'}), /dois pontos/);
  await assert.rejects(applyPdfOperation(bytes, {type:'text',page:0,x:Number.NaN,y:0,text:'Teste',size:12,color:'#000'}), /número válido/);
});




test('OCR adds searchable PT-BR words without changing the scanned image pixels', async () => {
  const { createCanvas } = await import('@napi-rs/canvas');
  const scan = createCanvas(100, 120), context = scan.getContext('2d');
  context.fillStyle = 'white'; context.fillRect(0, 0, 100, 120);
  context.fillStyle = '#6d28d9'; context.fillRect(10, 15, 50, 18);
  const doc = await PDFDocument.create(), page = doc.addPage([100, 120]), image = await doc.embedPng(scan.toBuffer('image/png'));
  page.drawImage(image, {x: 0, y: 0, width: 100, height: 120});
  const original = await doc.save(), originalSnapshot = new Uint8Array(original); assert.deepEqual(await text(original), ['']);
  const result = await addOcrTextLayer(original, [{page: 0, words: [
    {text: 'Ação', x: 10, y: 15, width: 25, height: 12},
    {text: 'São Paulo', x: 38, y: 15, width: 50, height: 12},
  ]}]);
  assert.deepEqual(await text(result), ['Ação São Paulo']);
  const before = await raster(original), after = await raster(result);
  assert.deepEqual(after.pixels, before.pixels);
  assert.equal(await pageCount(result), 1);
  await assert.rejects(addOcrTextLayer(original, [{page: 1, words: []}]), /não existe/);
  assert.deepEqual(original, originalSnapshot);
});

