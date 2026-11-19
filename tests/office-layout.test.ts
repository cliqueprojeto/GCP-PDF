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
