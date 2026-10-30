import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { existsSync } from 'node:fs';
import { readFile, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import fontkit from '@pdf-lib/fontkit';
import { PDFDocument, degrees } from 'pdf-lib';
import { listTextParagraphs, replaceParagraph } from '../src/main/pdfcraft-sidecar';

const executable = process.platform === 'win32' ? 'C:\\Program Files\\PdfCraft\\pdfcraft-cli.exe' : path.resolve('assets/pdfcraft/pdfcraft-cli');
const available = existsSync(executable);
async function fixture(rotation = 0): Promise<Uint8Array> {
  const doc = await PDFDocument.create(); doc.registerFontkit(fontkit);
  const font = await doc.embedFont(await readFile(path.resolve('assets/Inter-Regular.ttf')), {subset: true});
  const page = doc.addPage([320, 420]); page.setRotation(degrees(rotation));
  page.drawText('Gestão Cultural Pro', {x: 30, y: 340, font, size: 16});
  page.drawText('Rodapé preservado', {x: 30, y: 70, font, size: 11});
  return doc.save();
}
let pdfJs: Promise<typeof import('pdfjs-dist/legacy/build/pdf.mjs')> | undefined;
async function extract(bytes: Uint8Array): Promise<string> {
  pdfJs ??= (async () => { const canvas = await import('@napi-rs/canvas'); Object.assign(globalThis, {DOMMatrix: canvas.DOMMatrix, ImageData: canvas.ImageData, Path2D: canvas.Path2D}); return import('pdfjs-dist/legacy/build/pdf.mjs'); })();
  const {getDocument} = await pdfJs, task = getDocument({data: new Uint8Array(bytes), standardFontDataUrl: path.resolve('node_modules/pdfjs-dist/standard_fonts').replaceAll('\\', '/') + '/'});
  const doc = await task.promise;
  try {
    const parts: string[] = [];
    for (let page = 1; page <= doc.numPages; page++) {
      const content = await (await doc.getPage(page)).getTextContent();
      parts.push(content.items.map(item => 'str' in item ? item.str : '').join(' '));
    }
    return parts.join(' ').replace(/\s+/g, ' ').trim();
  } finally { await task.destroy(); }
}
async function workspaces() { return (await readdir(tmpdir())).filter(name => name.startsWith('gcp-pdf-edit-')).sort(); }

test('real PdfCraft CLI lists source paragraphs with displayed-page bounds and zero-based ids', {skip: !available}, async () => {
  const before = await workspaces(), bytes = await fixture();
  const list = await listTextParagraphs(bytes, 0, executable);
  const title = list.find(paragraph => paragraph.text === 'Gestão Cultural Pro');
  assert.ok(title); assert.equal(title.index, 0); assert.ok(Math.abs(title.x - 30) < 0.1);
  assert.ok(title.y > 50 && title.y < 90); assert.ok(title.width > 100 && title.width < 200); assert.ok(title.height > 10 && title.height < 25);
  assert.equal(list.length, 2); assert.ok(list.some(paragraph => paragraph.text === 'Rodapé preservado'));
  assert.deepEqual(await workspaces(), before);
});

test('real source-text replacement removes old extractable text and preserves other page content', {skip: !available}, async () => {
  const before = await workspaces(), original = await fixture(), snapshot = new Uint8Array(original);
  const list = await listTextParagraphs(original, 0, executable), title = list.find(paragraph => paragraph.text === 'Gestão Cultural Pro'); assert.ok(title);
  const replaced = await replaceParagraph(original, {page: 0, paragraph: title.index, text: 'Edição brasileira'}, executable);
  const result = await extract(replaced);
  assert.match(result, /Edição brasileira/); assert.match(result, /Rodapé preservado/);
  assert.doesNotMatch(result, /Gestão Cultural Pro/, 'the old source text must be removed, not hidden by an overlay');
  assert.equal((await PDFDocument.load(replaced)).getPageCount(), 1);
  assert.deepEqual(original, snapshot); assert.deepEqual(await workspaces(), before);
});

test('paragraph bounds follow an existing page rotation', {skip: !available}, async () => {
  const rotated = await listTextParagraphs(await fixture(90), 0, executable), title = rotated.find(paragraph => paragraph.text === 'Gestão Cultural Pro'); assert.ok(title);
  // Native PDF x=30/y=340 turns into displayed x≈340/y=30 with /Rotate=90.
  assert.ok(title.x > 320 && title.x < 370); assert.ok(Math.abs(title.y - 30) < 0.1);
  assert.ok(title.width < 25); assert.ok(title.height > 100);
});

test('failed source edits preserve input bytes and remove their private temporary workspace', {skip: !available}, async () => {
  const before = await workspaces(), original = await fixture(), snapshot = new Uint8Array(original);
  await assert.rejects(replaceParagraph(original, {page: 0, paragraph: 9999, text: 'Não aplicar'}, executable), /substituir este parágrafo/);
  await assert.rejects(listTextParagraphs(original, 9, executable), /texto desta página/);
  assert.deepEqual(original, snapshot); assert.deepEqual(await workspaces(), before);
});

test('invalid arguments and an unavailable sidecar fail clearly before editing', async () => {
  const bytes = await fixture();
  await assert.rejects(listTextParagraphs(bytes, -1, executable), /índice válido/);
  await assert.rejects(replaceParagraph(bytes, {page: 0, paragraph: -1, text: 'Erro'}, executable), /índice válido/);
  await assert.rejects(listTextParagraphs(bytes, 0, path.join(tmpdir(), 'gcp-pdf-missing-sidecar-5148072.exe')), /motor de edição de texto não está disponível/);
  await assert.rejects(listTextParagraphs(new Uint8Array(), 0, executable), /vazio/);
});
