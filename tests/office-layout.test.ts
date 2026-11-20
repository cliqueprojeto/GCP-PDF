import test from 'node:test';
import assert from 'node:assert/strict';
import ExcelJS from 'exceljs';
import { Document, Packer, Paragraph, TextRun, AlignmentType, BorderStyle, Table, TableRow, TableCell, WidthType, ShadingType, Header, Footer, PageNumber, TabStopType, LevelFormat, PageOrientation, SectionType, LineRuleType } from 'docx';
import { docxToHtml } from '../src/main/docx-html';
import { xlsxToHtml, formatValue } from '../src/main/xlsx-html';

async function receipt() {
  const arial = (text: string, size: number, bold = false) => new TextRun({ text, size, bold, font: 'Arial' });
  const doc = new Document({
    numbering: { config: [{ reference: 'n', levels: [{ level: 0, format: LevelFormat.UPPER_ROMAN, text: '%1.', alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 720, hanging: 360 } } } }] }] },
    sections: [{
      properties: { page: { size: { width: 11906, height: 16838 }, margin: { top: 1134, bottom: 1134, left: 1440, right: 1440, header: 600, footer: 500 } } },
      headers: { default: new Header({ children: [new Paragraph({ children: [new TextRun('Cabeçalho do projeto')] })] }) },
      footers: { default: new Footer({ children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ children: ['Página ', PageNumber.CURRENT, ' de ', PageNumber.TOTAL_PAGES] })] })] }) },
      children: [
        new Paragraph({ alignment: AlignmentType.CENTER, children: [arial('INSTITUTO KAIRÓS', 26, true)] }),
        new Paragraph({ alignment: AlignmentType.CENTER, border: { bottom: { style: BorderStyle.SINGLE, size: 8, color: '7F7F7F', space: 6 } }, spacing: { after: 360 }, children: [arial('financeiro@exemplo.org', 20)] }),
        new Paragraph({ alignment: AlignmentType.JUSTIFIED, spacing: { line: 360, lineRule: LineRuleType.AUTO, after: 240 }, children: [arial('Recebemos a quantia de ', 24), arial('R$ 1.000,00', 24, true), arial(', como doação.', 24)] }),
        new Paragraph({ numbering: { reference: 'n', level: 0 }, children: [new TextRun('Primeiro')] }),
        new Paragraph({ numbering: { reference: 'n', level: 0 }, children: [new TextRun('Segundo')] }),
        new Paragraph({ tabStops: [{ type: TabStopType.RIGHT, position: 9000, leader: 'dot' }], children: [new TextRun('Capítulo\t3')] }),
        new Table({ width: { size: 9000, type: WidthType.DXA }, columnWidths: [2600, 6400], rows: [
          new TableRow({ children: [new TableCell({ shading: { fill: 'F2F2F2', type: ShadingType.CLEAR }, children: [new Paragraph('Banco')] }), new TableCell({ children: [new Paragraph('Banco do Brasil')] })] }),
          new TableRow({ children: [new TableCell({ columnSpan: 2, children: [new Paragraph('Linha mesclada')] })] }),
        ] }),
      ],
    }, {
      properties: { type: SectionType.NEXT_PAGE, page: { size: { orientation: PageOrientation.LANDSCAPE } } },
      children: [new Paragraph('Paisagem')],
    }],
  });
  return new Uint8Array(await Packer.toBuffer(doc));
}

test('Word para PDF mantém página, fontes, alinhamento, bordas e espaçamentos do documento', async () => {
  const { html, headerTemplate, footerTemplate } = docxToHtml(await receipt());
  // A4 with the document's own margins; the landscape section gets its own page box.
  assert.match(html, /@page s0\{size:595\.3pt 841\.9pt;margin:56\.7pt 72pt 56\.7pt 72pt\}/);
  assert.match(html, /@page s1\{size:841\.9pt 595\.3pt;/);
  assert.match(html, /section style="page:s1;break-before:page;/);
  // Centred Arial 13 pt bold title, with Linux's metric-compatible substitute.
  assert.match(html, /<p style="text-align:center;[^"]*"><span style="font-family:'Arial','Liberation Sans'[^"]*font-size:13pt;font-weight:700[^"]*">INSTITUTO KAIRÓS<\/span>/);
  // Rule under the contact line, 6 pt away from the text, then 18 pt of space.
  assert.match(html, /margin-bottom:18pt;border-bottom:1pt solid #7f7f7f;padding-bottom:6pt/);
  // Justified text at 1.5 lines of Arial.
  assert.match(html, /text-align:justify;word-spacing:-\.05em;line-height:1\.724/);
  // Roman list markers and a right tab with a dotted leader.
  assert.match(html, />I\.<\/span>[\s\S]*>II\.<\/span>/);
  assert.match(html, /radial-gradient[\s\S]*>3<\/span>/);
  // Table: fixed column widths, shaded cell and a merged row.
  assert.match(html, /<col style="width:130pt"><col style="width:320pt">/);
  assert.match(html, /background-color:#f2f2f2/);
  assert.match(html, /<td colspan="2"/);
  // Header text and page counters go to Chromium's header and footer.
  assert.match(headerTemplate ?? '', /Cabeçalho do projeto/);
  assert.match(footerTemplate ?? '', /class="pageNumber"[\s\S]*class="totalPages"/);
  // Nothing turns into an image: every word stays as text.
  assert.doesNotMatch(html, /<img/);
});

test('Word ou Excel danificado falha com mensagem em português', async () => {
  assert.throws(() => docxToHtml(new Uint8Array([80, 75, 3, 4, 0, 0])), /danificado/);
  await assert.rejects(() => xlsxToHtml(new Uint8Array([1, 2, 3])), /danificada/);
});

test('formatos numéricos do Excel em notação brasileira', () => {
  assert.equal(formatValue(1570.7, '"R$" #,##0.00').text, 'R$ 1.570,70');
  assert.equal(formatValue(0.875, '0.0%').text, '87,5%');
  assert.equal(formatValue(1234567, '#,##0').text, '1.234.567');
  assert.equal(formatValue(-5, '#,##0.00;[Red]-#,##0.00').color, '#ff0000');
  assert.equal(formatValue(46349, 'dd/mm/yyyy').text, '23/11/2026');
  assert.equal(formatValue(new Date(Date.UTC(2026, 10, 23)), 'd "de" mmmm "de" yyyy').text, '23 de novembro de 2026');
  assert.equal(formatValue(0.5, 'General').text, '0,5');
});

test('Excel para PDF mantém larguras, mesclas, cores, bordas e área usada da planilha', async () => {
  const workbook = new ExcelJS.Workbook(), sheet = workbook.addWorksheet('Orçamento');
  sheet.columns = [{ width: 10 }, { width: 20 }];
  sheet.mergeCells('A1:B1');
  sheet.getCell('A1').value = 'Título'; sheet.getCell('A1').font = { bold: true, size: 14, color: { argb: 'FFFFFFFF' } };
  sheet.getCell('A1').fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1F3864' } }; sheet.getCell('A1').alignment = { horizontal: 'center' };
  sheet.getCell('A2').value = 'Total'; sheet.getCell('B2').value = 1570.7; sheet.getCell('B2').numFmt = '"R$" #,##0.00';
  sheet.getCell('B2').border = { bottom: { style: 'medium', color: { argb: 'FFC00000' } } };
  sheet.pageSetup.orientation = 'landscape';
  const html = await xlsxToHtml(new Uint8Array(await workbook.xlsx.writeBuffer() as ArrayBuffer));
  assert.match(html, /@page x0\{size:841\.89pt 595\.28pt;/);
  assert.match(html, /<col style="width:56\.25pt"><col style="width:108\.75pt">/);
  assert.match(html, /<td colspan="2" style="[^"]*font-weight:700[^"]*background-color:#1f3864[^"]*text-align:center/);
  assert.match(html, /border-bottom:1\.5pt solid #c00000[^>]*>R\$ 1\.570,70</);
  // Excel prints no gridlines unless asked to.
  assert.doesNotMatch(html, /#d0d0d0/);
});

test('fórmula do Excel sem valor calculado salvo fica vazia, sem "[object Object]"', async () => {
  const workbook = new ExcelJS.Workbook(), sheet = workbook.addWorksheet('Contas');
  sheet.getCell('A1').value = 'Sem resultado'; sheet.getCell('B1').value = { formula: 'SUM(C1:C3)' } as never;
  sheet.getCell('A2').value = 'Com resultado'; sheet.getCell('B2').value = { formula: 'C1*2', result: 1570.7 } as never; sheet.getCell('B2').numFmt = '"R$" #,##0.00';
  sheet.getCell('A3').value = 'Texto calculado'; sheet.getCell('B3').value = { formula: 'C1&"x"', result: 'ok' } as never;
  sheet.getCell('A4').value = 'Erro'; sheet.getCell('B4').value = { formula: '1/0', result: { error: '#DIV/0!' } } as never;
  sheet.getCell('A5').value = 'Link'; sheet.getCell('B5').value = { text: { richText: [{ text: 'site ' }, { text: 'oficial', font: { bold: true } }] }, hyperlink: 'https://example.org' } as never;
  const html = await xlsxToHtml(new Uint8Array(await workbook.xlsx.writeBuffer() as ArrayBuffer));
  assert.doesNotMatch(html, /object Object/);
  // The formula cell without a result is an empty cell.
  assert.match(html, />Sem resultado<\/div><\/td><td style="[^"]*"><\/td>/);
  assert.match(html, />R\$ 1\.570,70</);
  assert.match(html, />ok</);
  assert.match(html, />#DIV\/0!</);
  assert.match(html, /site oficial|site <\/span>/);
});

test('planilha: linha oculta em célula mesclada e colunas que não cabem na página', async () => {
  const workbook = new ExcelJS.Workbook(), sheet = workbook.addWorksheet('Larga');
  sheet.mergeCells('A1:A3'); sheet.getCell('A1').value = 'Mesclada';
  sheet.getCell('B1').value = 'L1'; sheet.getCell('B2').value = 'L2'; sheet.getCell('B3').value = 'L3'; sheet.getRow(2).hidden = true;
  for (let c = 3; c <= 30; c++) sheet.getCell(1, c).value = 'Col' + c;
  const html = await xlsxToHtml(new Uint8Array(await workbook.xlsx.writeBuffer() as ArrayBuffer));
  // The merge spans only the two printed rows, and the hidden row's value is not printed.
  assert.match(html, /rowspan="2"[^>]*>Mesclada</);
  assert.doesNotMatch(html, />L2</);
  // Every column is printed: those beyond the page width go to the next pages.
  assert.match(html, />Col30</);
  assert.ok((html.match(/break-before:page;/g) ?? []).length >= 1);
});

test('Word: cabeçalho só da primeira página não se repete; listas continuam ou reiniciam como no Word', async () => {
  const { Header: H, PageBreak } = await import('docx');
  const first = new Document({ sections: [{ properties: { titlePage: true }, headers: { first: new H({ children: [new Paragraph('SÓ NA PRIMEIRA')] }) }, children: [new Paragraph('Página 1'), new Paragraph({ children: [new PageBreak(), new TextRun('Página 2')] })] }] });
  const result = docxToHtml(new Uint8Array(await Packer.toBuffer(first)));
  assert.equal(result.headerTemplate, undefined);
  assert.match(result.html, /@page s0:first\{margin-top:0\}/);
  assert.match(result.html, /SÓ NA PRIMEIRA/);
});

test('PowerPoint para PDF: um slide por página com fundo, textos, forma, imagem e tabela', async () => {
  const PptxGenJS = (await import('pptxgenjs')).default, pptx = new PptxGenJS();
  pptx.layout = 'LAYOUT_WIDE';
  const slide = pptx.addSlide(); slide.background = { color: '1F3864' };
  slide.addText('Relatório Natalino', { x: .5, y: .4, w: 12, h: 1, fontSize: 40, bold: true, color: 'FFFFFF', fontFace: 'Arial' });
  slide.addShape(pptx.ShapeType.roundRect, { x: .5, y: 1.7, w: 5, h: 2, fill: { color: '6C43D9' } });
  slide.addImage({ data: 'image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', x: 7, y: 1.7, w: 4, h: 2 });
  slide.addTable([['Item', 'Valor'], ['Brinquedos', 'R$ 1.000,00']].map(row => row.map(text => ({ text }))), { x: .5, y: 4.6, w: 8, colW: [5, 3] });
  pptx.addSlide().addText('Segundo slide', { x: 1, y: 1, w: 6, h: 1 });
  const { pptxToHtml } = await import('../src/main/pptx-html');
  const html = pptxToHtml(new Uint8Array(await pptx.write({ outputType: 'nodebuffer' }) as Buffer));
  assert.match(html, /@page\{size:960pt 540pt;margin:0\}/);
  assert.equal((html.match(/class="slide"/g) ?? []).length, 2);
  assert.match(html, /class="slide" style="background:#1f3864;"/);
  assert.match(html, /font-size:40pt;font-weight:700[^"]*color:#ffffff">Relatório Natalino</);
  assert.match(html, /background:#6c43d9;/);
  assert.match(html, /<img src="data:image\/png;base64,/);
  assert.match(html, /<table[\s\S]*>Brinquedos<[\s\S]*>R\$ 1\.000,00</);
  assert.match(html, />Segundo slide</);
});

test('texto .txt em UTF-8, UTF-16 ou ANSI do Windows mantém os acentos', async () => {
  const { decodeText } = await import('../src/main/office');
  assert.equal(decodeText(new TextEncoder().encode('﻿Ação')), 'Ação');
  assert.equal(decodeText(new Uint8Array([0x41, 0xe7, 0xe3, 0x6f])), 'Ação');
  assert.equal(decodeText(new Uint8Array([0xff, 0xfe, 0x41, 0, 0xe7, 0, 0xe3, 0, 0x6f, 0])), 'Ação');
});
