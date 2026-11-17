import test from 'node:test';
import assert from 'node:assert/strict';
import { displayedRect, markCount, planDocumentTool, reportLines } from '../src/main/document-tools';
import { fromPage } from '../src/shared/geometry';

test('marca-d’água, cabeçalho/rodapé, achatar e cortar viram as chamadas do motor com páginas a partir de 1', () => {
  assert.deepEqual(planDocumentTool({ kind: 'watermark', text: ' CONFIDENCIAL ', opacity: 0.3, rotation: 45, color: '#cc0000', behind: true, pages: [2, 0, 2] }, 5),
    [{ tool: 'doc_watermark', args: { text: 'CONFIDENCIAL', opacity: 0.3, rotation: 45, color: '#cc0000', behind: true, pages: [1, 3] } }]);
  const [headers] = planDocumentTool({ kind: 'header-footer', header: ['Relatório', '', ''], footer: ['', 'Página <<1>> de <<n>>', ''], font: 'Helvetica', fontSize: 9, color: '#333333', startNumber: 1, shrink: false }, 3);
  assert.deepEqual(headers, { tool: 'doc_header_footer', args: { header_left: 'Relatório', footer_center: 'Página <<1>> de <<n>>', font: 'Helvetica', font_size: 9, color: '#333333', start_number: 1, shrink: false } });
  assert.deepEqual(planDocumentTool({ kind: 'flatten', comments: true, fields: false }, 1), [{ tool: 'doc_flatten', args: { comments: true, fields: false } }]);
  assert.deepEqual(planDocumentTool({ kind: 'crop', margins: [10, 20, 10, 0], pages: [0] }, 2), [{ tool: 'page_set_box', args: { box: 'crop', margins: [10, 20, 10, 0], pages: [1] } }]);
});

test('tarja: texto, tipo de dado e trechos marcados são aplicados ao final, numa só operação', () => {
  const calls = planDocumentTool({ kind: 'redact', find: 'Fulano de Tal', patterns: ['email'], wholeWords: true }, 4, [{ page: 1, rects: [[10, 20, 110, 34]] }]);
  assert.deepEqual(calls.map((c) => c.tool), ['redact_mark', 'redact_mark', 'redact_mark', 'redact_apply']);
  assert.deepEqual(calls[0]!.args, { find: 'Fulano de Tal', case_sensitive: false, whole_words: true });
  assert.deepEqual(calls[1]!.args, { pattern: 'email' });
  assert.deepEqual(calls[2]!.args, { page: 2, rect: [10, 20, 110, 34] });
});

test('pedidos inválidos são recusados com mensagem em português, antes de chegar ao motor', () => {
  const bad: [unknown, RegExp][] = [
    [{ kind: 'watermark', text: '  ', opacity: 0.5, rotation: 0, color: '#000000', behind: false }, /texto/],
    [{ kind: 'watermark', text: 'x', opacity: 2, rotation: 0, color: '#000000', behind: false }, /inválidas/],
    [{ kind: 'watermark', text: 'x', opacity: 0.5, rotation: 0, color: 'red; rm', behind: false }, /inválidas/],
    [{ kind: 'watermark', text: 'x', opacity: 0.5, rotation: 0, color: '#000000', behind: false, pages: [9] }, /existam/],
    [{ kind: 'header-footer', header: ['', '', ''], footer: ['', '', ''], font: 'Helvetica', fontSize: 9, color: '#000000', startNumber: 1, shrink: false }, /ao menos um/],
    [{ kind: 'header-footer', header: ['a', '', ''], footer: ['', '', ''], font: 'Comic', fontSize: 9, color: '#000000', startNumber: 1, shrink: false }, /inválidas/],
    [{ kind: 'flatten', comments: false, fields: false }, /Escolha/],
    [{ kind: 'crop', margins: [0, 0, 0, 0] }, /ao menos uma/],
    [{ kind: 'crop', margins: [1, 2, 3] }, /inválidas/],
    [{ kind: 'redact' }, /Escolha o que ocultar/],
    [{ kind: 'redact', patterns: ['ssn; drop'] }, /desconhecido/],
    [{ kind: 'apagar-tudo' }, /desconhecida/],
    [null, /inválida/],
  ];
  for (const [tool, message] of bad) assert.throws(() => planDocumentTool(tool as never, 3), message, JSON.stringify(tool));
  assert.throws(() => planDocumentTool({ kind: 'redact' }, 3, [{ page: 7, rects: [[0, 0, 10, 10]] }]), /Área/);
  assert.throws(() => planDocumentTool({ kind: 'redact' }, 3, [{ page: 0, rects: [[0, 0, 0.1, 10]] }]), /Área/);
});

test('caixa selecionada na página vira a caixa exibida, também em página girada', () => {
  const size = { width: 600, height: 800 }, rect = { x: 50, y: 100, width: 200, height: 20 };
  assert.deepEqual(displayedRect(rect, size, 0, fromPage), [50, 100, 250, 120]);
  const turned = displayedRect(rect, size, 90, fromPage);
  assert.equal(Math.round(turned[2] - turned[0]), 20); assert.equal(Math.round(turned[3] - turned[1]), 200);
  assert.ok(turned.every((v) => v >= 0 && v <= 800));
});

test('contagem de marcas e linhas de relatório são lidas sem depender de um único formato de resposta', () => {
  assert.equal(markCount({ marked: 3 }), 3); assert.equal(markCount({ matches: [{}, {}] }), 2); assert.equal(markCount({ ok: true }), undefined); assert.equal(markCount('texto'), undefined);
  assert.deepEqual(reportLines({ declares: 'PDF/A-2b', violations: [{ clause: '6.2.11.4', message: "The font Helvetica isn't embedded", page: 2, fixable: false }, { clause: '6.6.2', message: 'Metadados XMP ausentes' }, { clause: '6.6.2', message: 'Metadados XMP ausentes' }] }),
    ['6.2.11.4 — A fonte Helvetica não está incorporada ao arquivo (página 2)', '6.6.2 — Metadados XMP ausentes']);
  assert.deepEqual(reportLines({ ok: true, violations: [] }), []);
});

test('PDF criptografado é reconhecido pelo dicionário /Encrypt do trailer, não por texto solto na página', async () => {
  const { isEncryptedPdf } = await import('../src/main/document-tools');
  const { PDFDocument } = await import('pdf-lib');
  const doc = await PDFDocument.create(); doc.addPage([200, 200]).drawText('Sobre /Encrypt e senhas');
  const plain = await doc.save({ useObjectStreams: false });
  assert.equal(isEncryptedPdf(plain), false);
  const text = Buffer.from(plain).toString('latin1'), at = text.lastIndexOf('trailer');
  assert.ok(at > 0);
  const locked = Buffer.from(text.slice(0, at) + text.slice(at).replace('<<', '<< /Encrypt 99 0 R '), 'latin1');
  assert.equal(isEncryptedPdf(new Uint8Array(locked)), true);
  assert.equal(isEncryptedPdf(new Uint8Array()), false);
});
