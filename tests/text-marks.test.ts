import test from 'node:test';
import assert from 'node:assert/strict';
import JSZip from 'jszip';
import ExcelJS from 'exceljs';
import { PDFDocument, PDFName, PDFString, StandardFonts, degrees, rgb } from 'pdf-lib';
import { convertPdf } from '../src/main/conversion';
import { markScripts, splitRun, type Run } from '../src/main/word-layout';
import { decorate, looseTables } from '../src/main/docx-flow';

const run = (text: string, x: number, baseline: number, width: number, size = 10, more: Partial<Run> = {}): Run => ({ text, x, baseline, width, size, font: 'Arial', bold: false, italic: false, color: '#000000', space: false, ...more });
const stroke = (at: number, from: number, to: number, horizontal = true) => ({ horizontal, at, from, to, color: '#000000', width: 0.5 });

test('sobrescrito e subscrito voltam para a linha do texto a que pertencem', () => {
  const [base, up, down, next] = markScripts([run('E=mc', 50, 100, 24), run('2', 74, 96, 3.5, 5.8), run('2', 110, 101.5, 3.5, 5.8), run('linha seguinte', 50, 114, 60)]);
  assert.equal(base!.script, undefined);
  assert.deepEqual([up!.script, up!.baseline, up!.size], ['super', 100, 10]);
  assert.equal(down!.script, undefined, 'a small run with no larger neighbour beside it stays as printed');
  assert.equal(next!.script, undefined);
  assert.equal(markScripts([run('H', 50, 100, 7), run('2', 57, 102, 3.5, 5.8)])[1]!.script, 'sub');
});

test('um trecho é cortado nas posições pedidas sem mudar a largura total', () => {
  const pieces = splitRun(run('texto sublinhado aqui', 100, 50, 105), [128, 181]);
  assert.equal(pieces.map((p) => p.text).join(''), 'texto sublinhado aqui');
  assert.equal(pieces.length, 3);
  assert.ok(Math.abs(pieces.reduce((n, p) => n + p.width, 0) - 105) < 0.001);
  assert.ok(Math.abs(pieces.at(-1)!.x + pieces.at(-1)!.width - 205) < 0.001);
  assert.deepEqual(splitRun(run('abc', 10, 50, 15), [5, 300]).length, 1, 'cuts outside the run do nothing');
});

test('linha sob as palavras vira sublinhado, linha no meio vira tachado, régua e borda continuam linhas', () => {
  const runs = [run('texto sublinhado aqui', 100, 50, 105), run('riscado', 100, 70, 35), run('Título', 100, 90, 30), run('célula', 104, 110, 28)];
  const rule = stroke(92, 60, 540), border = stroke(112, 100, 200), side = stroke(100, 104, 116, false);
  const result = decorate(runs, [stroke(51.2, 128, 181), stroke(66.6, 100, 135), rule, border, side]);
  assert.deepEqual(result.runs.filter((r) => r.underline).map((r) => r.text.trim()), ['sublinhado']);
  assert.deepEqual(result.runs.filter((r) => r.strike).map((r) => r.text), ['riscado']);
  assert.deepEqual(result.segments, [rule, border, side], 'a rule wider than its text line and a border touching a vertical line are kept');
});

test('tabela sem bordas: colunas pelos espaços comuns, célula quebrada em duas linhas e célula mesclada', () => {
  const rows: Run[] = [
    run('Rubrica', 83, 320, 35), run('Valores (R$)', 165, 313, 54), run('Previsto', 150, 327, 40), run('Executado', 195, 327, 41), run('Situação', 243, 320, 37),
    run('Recursos humanos', 58, 342, 75), run('45.000,00', 148, 342, 42), run('44.870,50', 194, 342, 42), run('Regular', 240, 342, 32),
    run('Material de consumo', 58, 356, 85), run('e divulgação', 58, 368, 51), run('12.300,00', 148, 362, 42), run('13.115,90', 194, 362, 42), run('Excedido', 240, 362, 37),
    run('Total', 58, 382, 23), run('57.300,00', 148, 382, 42), run('57.986,40', 194, 382, 42), run('101,2%', 240, 382, 31),
  ];
  const [table, ...others] = looseTables(rows, [{ box: { x: 238, y: 331, width: 45, height: 14 }, color: '#d7f5dd' }]);
  assert.equal(others.length, 0);
  assert.equal(table!.colW.length, 4); assert.equal(table!.rowH.length, 4);
  const cell = (r: number, c: number) => table!.cells.find((k) => k.row === r && k.col === c);
  assert.equal(cell(0, 1)!.cols, 2); assert.match(cell(0, 1)!.text!.text, /^Valores \(R\$\)\nPrevisto\s+Executado$/);
  assert.equal(cell(2, 0)!.text!.text, 'Material de consumo e divulgação');
  assert.equal(cell(2, 2)!.text!.text, '13.115,90');
  assert.equal(cell(1, 3)!.fill, '#d7f5dd');
  // Lists and a few aligned lines are not tables.
  assert.equal(looseTables([run('•', 60, 100, 4), run('Primeiro item', 78, 100, 60), run('•', 60, 114, 4), run('Segundo item', 78, 114, 60), run('•', 60, 128, 4), run('Terceiro', 78, 128, 40), run('•', 60, 142, 4), run('Quarto', 78, 142, 30)]).length, 0);
  assert.equal(looseTables([run('Nome', 40, 100, 30), run('Valor', 240, 100, 30), run('Oficina', 40, 114, 35), run('250,00', 240, 114, 32), run('Curso', 40, 128, 30), run('300,00', 240, 128, 32)]).length, 0);
});

async function marked() {
  const pdf = await PDFDocument.create(), font = await pdf.embedFont(StandardFonts.Helvetica), page = pdf.addPage([500, 400]);
  page.drawText('Consulte o edital completo no portal', { x: 50, y: 340, font, size: 12 });
  const before = font.widthOfTextAtSize('Consulte o ', 12), word = font.widthOfTextAtSize('edital completo', 12);
  page.drawLine({ start: { x: 50 + before, y: 338.4 }, end: { x: 50 + before + word, y: 338.4 }, thickness: 0.6, color: rgb(0, 0, 0) });
  page.node.set(PDFName.of('Annots'), pdf.context.obj([pdf.context.register(pdf.context.obj({ Type: 'Annot', Subtype: 'Link', Rect: [50 + before, 336, 50 + before + word, 352], Border: [0, 0, 0], A: { Type: 'Action', S: 'URI', URI: PDFString.of('https://exemplo.org/edital') } }))]));
  page.drawText('Segunda linha do documento, sem marcas.', { x: 50, y: 300, font, size: 12 });
  page.drawText('CONFIDENCIAL', { x: 30, y: 60, font, size: 10, rotate: degrees(90), color: rgb(0.7, 0.1, 0.1) });
  return pdf.save();
}
test('link, sublinhado e texto girado chegam ao Word, ao PowerPoint e ao Excel', async () => {
  const bytes = await marked();
  const docx = await JSZip.loadAsync((await convertPdf(bytes, { format: 'docx', mode: 'editable' })).bytes), xml = await docx.file('word/document.xml')!.async('string');
  const link = /<w:hyperlink [^>]*>(.*?)<\/w:hyperlink>/.exec(xml);
  assert.ok(link, 'the linked words are a Word hyperlink'); assert.match(link![1]!, /edital completo/); assert.match(link![1]!, /<w:u /);
  assert.match(await docx.file('word/_rels/document.xml.rels')!.async('string'), /https:\/\/exemplo\.org\/edital/);
  assert.doesNotMatch(xml.replace(/<w:hyperlink.*?<\/w:hyperlink>/g, ''), /edital completo/, 'the linked words are not repeated outside the link');
  assert.match(xml, /<wp:anchor/, 'turned text floats at its place as a picture');
  const pptx = await JSZip.loadAsync((await convertPdf(bytes, { format: 'pptx', mode: 'editable' })).bytes), slide = await pptx.file('ppt/slides/slide1.xml')!.async('string');
  assert.match(slide, /<a:xfrm rot="16200000">/); assert.match(slide, /CONFIDENCIAL/); assert.match(slide, /hlinkClick/);
});

test('Excel: texto fora da tabela desenhada ocupa uma linha por linha impressa', async () => {
  const pdf = await PDFDocument.create(), font = await pdf.embedFont(StandardFonts.Helvetica), page = pdf.addPage([500, 500]);
  page.drawText('Título do relatório', { x: 40, y: 460, font, size: 16 });
  page.drawText('Primeira linha do parágrafo de abertura', { x: 40, y: 430, font, size: 11 });
  page.drawText('segunda linha do mesmo parágrafo', { x: 40, y: 416, font, size: 11 });
  for (const [r, y] of [300, 270].entries()) for (const [c, x] of [40, 200].entries()) { page.drawRectangle({ x, y, width: 160, height: 30, borderColor: rgb(0, 0, 0), borderWidth: 0.7 }); page.drawText(`célula ${r + 1}.${c + 1}`, { x: x + 6, y: y + 10, font, size: 11 }); }
  const workbook = new ExcelJS.Workbook(); await workbook.xlsx.load(Buffer.from((await convertPdf(await pdf.save(), { format: 'xlsx' })).bytes) as never);
  const at = new Map<string, number>(); workbook.worksheets[0]!.eachRow((row, n) => row.eachCell((cell) => { if (typeof cell.value === 'string') at.set(cell.value, n); }));
  assert.ok(at.has('Título do relatório') && at.has('Primeira linha do parágrafo de abertura') && at.has('segunda linha do mesmo parágrafo'), [...at.keys()].join(' | '));
  assert.equal(new Set([at.get('Título do relatório'), at.get('Primeira linha do parágrafo de abertura'), at.get('segunda linha do mesmo parágrafo')]).size, 3);
  assert.equal(at.get('célula 1.1'), at.get('célula 1.2')); assert.notEqual(at.get('célula 1.1'), at.get('célula 2.1'));
});

test('Excel: texto girado vai para a célula sob ele, com a mesma inclinação', async () => {
  const pdf = await PDFDocument.create(), font = await pdf.embedFont(StandardFonts.Helvetica), page = pdf.addPage([400, 300]);
  for (const [c, x] of [40, 100, 240].entries()) for (const [r, y] of [200, 100].entries()) { page.drawRectangle({ x, y, width: c ? 140 : 60, height: 100, borderColor: rgb(0, 0, 0), borderWidth: 0.7 }); if (c) page.drawText(`valor ${r + 1}.${c}`, { x: x + 8, y: y + 45, font, size: 11 }); }
  page.drawText('Etapa 1', { x: 74, y: 228, font, size: 11, rotate: degrees(90) });
  const workbook = new ExcelJS.Workbook(); await workbook.xlsx.load(Buffer.from((await convertPdf(await pdf.save(), { format: 'xlsx' })).bytes) as never);
  const found: { text: unknown; rotation: unknown; row: number }[] = []; workbook.worksheets[0]!.eachRow((row, n) => row.eachCell((cell) => { if (String(cell.value).includes('Etapa 1')) found.push({ text: cell.value, rotation: cell.alignment?.textRotation, row: n }); }));
  assert.equal(found.length, 1, 'the turned heading is in one cell'); assert.equal(found[0]!.rotation, 90);
  const first: number[] = []; workbook.worksheets[0]!.eachRow((row, n) => row.eachCell((cell) => { if (String(cell.value).startsWith('valor 1.')) first.push(n); }));
  assert.equal(found[0]!.row, first[0], 'beside the values of its own row');
});
