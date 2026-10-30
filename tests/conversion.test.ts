import test from 'node:test';
import assert from 'node:assert/strict';
import { PDFDocument, StandardFonts, degrees, rgb } from 'pdf-lib';
import ExcelJS from 'exceljs';
import JSZip from 'jszip';
import { createCanvas } from '@napi-rs/canvas';
import { convertPdf, extractDocumentText, renderPdfPage } from '../src/main/conversion';
async function fixture() {
  const pdf=await PDFDocument.create(),font=await pdf.embedFont(StandardFonts.Helvetica),bold=await pdf.embedFont(StandardFonts.HelveticaBold),page=pdf.addPage([500,600]);
  page.drawText('Gestão Cultural — prestação de contas',{x:40,y:555,font:bold,size:18});
  page.drawText('Descrição',{x:40,y:505,font:bold,size:12});page.drawText('Quantidade',{x:240,y:505,font:bold,size:12});page.drawText('Valor',{x:370,y:505,font:bold,size:12});
  page.drawText('Oficina de música',{x:40,y:475,font,size:12});page.drawText('2',{x:240,y:475,font,size:12});page.drawText('1.234,50',{x:370,y:475,font,size:12});
  page.drawText('Formação cultural',{x:40,y:445,font,size:12});page.drawText('3',{x:240,y:445,font,size:12});page.drawText('R$ 250,00',{x:370,y:445,font,size:12});
  const canvas=createCanvas(30,20),context=canvas.getContext('2d');context.fillStyle='#6c43d9';context.fillRect(0,0,30,20);const image=await pdf.embedPng(canvas.toBuffer('image/png'));page.drawImage(image,{x:40,y:340,width:90,height:60});
  page.drawLine({start:{x:40,y:495},end:{x:460,y:495},thickness:1,color:rgb(.3,.3,.3)});
  const second=pdf.addPage([400,200]);second.setRotation(degrees(90));second.drawText('Segunda página',{x:20,y:160,font,size:14});
  pdf.addPage([500,600]);return pdf.save();
}
const bytes=fixture();
test('extrai PT-BR, ordem de leitura e páginas sem executar o documento',async()=>{
  const text=await extractDocumentText(await bytes);assert.match(text,/Gestão Cultural/);assert.match(text,/Oficina de música/);assert.match(text,/Segunda página/);assert.match(text,/\[Página 3\]/);
});
test('Word com layout preservado: texto editável em quadros sobre o fundo da página',async()=>{
  const result=await convertPdf(await bytes,{format:'docx',mode:'editable'});assert.equal(result.extension,'docx');const zip=await JSZip.loadAsync(result.bytes),xml=await zip.file('word/document.xml')!.async('string');
  assert.match(xml,/Gestão Cultural/);assert.match(xml,/Oficina de música/);assert.match(xml,/<w:b\s*\/>|<w:b w:val="true"/);assert.match(xml,/<w:framePr[^>]*w:x="800"/);assert.match(await zip.file('word/styles.xml')!.async('string'),/w:lang[^>]*w:val="pt-BR"/);assert.match(xml,/<w:framePr[^>]*w:x="4800"/);assert.match(xml,/behindDoc="1"/);assert.ok(Object.keys(zip.files).some(name=>name.startsWith('word/media/')));assert.ok(result.warnings.some(w=>w.includes('editáveis')));
});
test('Excel cria uma planilha por página e infere colunas e números brasileiros',async()=>{
  const result=await convertPdf(await bytes,{format:'xlsx'}),workbook=new ExcelJS.Workbook();await workbook.xlsx.load(Buffer.from(result.bytes) as never);assert.equal(workbook.worksheets.length,3);
  const values:(string|number)[]=[];workbook.worksheets[0].eachRow(row=>row.eachCell(cell=>{if(typeof cell.value==='string'||typeof cell.value==='number')values.push(cell.value);}));assert.ok(values.includes('Oficina de música'));assert.ok(values.includes(1234.5));assert.ok(values.includes(250));assert.ok(values.includes(2));assert.ok(workbook.worksheets[2].getImages().length===1);assert.ok(result.warnings.some(w=>w.includes('página 3')));
});
test('PowerPoint com layout preservado: fundo vetorial, imagens e textos editáveis nas posições',async()=>{
  const result=await convertPdf(await bytes,{format:'pptx',mode:'editable'}),zip=await JSZip.loadAsync(result.bytes),xml=await zip.file('ppt/slides/slide1.xml')!.async('string');assert.match(xml,/Gestão Cultural/);assert.match(xml,/Oficina de música/);assert.match(xml,/x="508000"/);assert.ok(Object.keys(zip.files).some(name=>name.startsWith('ppt/media/')));assert.equal(Object.keys(zip.files).filter(name=>/^ppt\/slides\/slide\d+\.xml$/.test(name)).length,3);assert.ok(result.warnings.some(w=>w.includes('layout preservado')));
});
test('PDF baseado em imagem mantém todas as páginas, dimensões/rotação e remove texto extraível',async()=>{
  const result=await convertPdf(await bytes,{format:'image-pdf',dpi:150}),pdf=await PDFDocument.load(result.bytes);assert.equal(pdf.getPageCount(),3);assert.deepEqual(pdf.getPage(0).getSize(),{width:500,height:600});assert.deepEqual(pdf.getPage(1).getSize(),{width:200,height:400});const text=await extractDocumentText(result.bytes);assert.doesNotMatch(text,/Gestão|Oficina|Segunda/);assert.match(text,/Página 3/);assert.ok(result.warnings.some(w=>w.includes('assinaturas criptográficas')));
});
test('fidelidade visual é explicitamente descrita como não editável',async()=>{
  const result=await convertPdf(await bytes,{format:'pptx',mode:'fidelity',dpi:72}),zip=await JSZip.loadAsync(result.bytes),xml=await zip.file('ppt/slides/slide1.xml')!.async('string');assert.doesNotMatch(xml,/Gestão Cultural/);assert.ok(result.warnings.some(w=>w.includes('sem texto editável')));
});
test('PNG avisa primeira página; opções inválidas falham com mensagem em português',async()=>{
  const result=await convertPdf(await bytes,{format:'png',dpi:72});assert.equal(Buffer.from(result.bytes).subarray(1,4).toString(),'PNG');assert.ok(result.warnings.some(w=>w.includes('primeira página')));await assert.rejects(async()=>convertPdf(await bytes,{format:'image-pdf',dpi:0}),/72 e 600 DPI/);await assert.rejects(()=>convertPdf(new Uint8Array(),{format:'txt'}),/vazio/);
});




test('renderização para OCR usa pixels e escala reais da página rotacionada',async()=>{
 const result=await renderPdfPage(await bytes,1,144);assert.equal(result.width,400);assert.equal(result.height,800);assert.equal(result.scale,2);assert.equal(Buffer.from(result.bytes).readUInt32BE(16),400);assert.equal(Buffer.from(result.bytes).readUInt32BE(20),800);await assert.rejects(async()=>renderPdfPage(await bytes,4,144),/não existe/);
});

