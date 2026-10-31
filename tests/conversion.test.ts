import test from 'node:test';
import assert from 'node:assert/strict';
import { PDFDocument, StandardFonts, degrees, rgb, pushGraphicsState,popGraphicsState,rectangle,clip,endPath,moveTo,lineTo,closePath,fill,setFillingRgbColor } from 'pdf-lib';
import ExcelJS from 'exceljs';
import JSZip from 'jszip';
import { createCanvas,loadImage } from '@napi-rs/canvas';
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
test('Word de página de texto sai corrido: margem, colunas por tabulação, negrito e imagem no texto',async()=>{
  const result=await convertPdf(await bytes,{format:'docx',mode:'editable'});assert.equal(result.extension,'docx');const zip=await JSZip.loadAsync(result.bytes),xml=await zip.file('word/document.xml')!.async('string');
  assert.match(xml,/Gestão Cultural/);assert.match(xml,/Oficina de música/);assert.match(xml,/<w:b\s*\/>|<w:b w:val="true"/);assert.match(await zip.file('word/styles.xml')!.async('string'),/w:lang[^>]*w:val="pt-BR"/);
  // The text starts at the PDF's 40 pt margin and the table columns become tab stops at 200 pt and 330 pt from it.
  assert.match(xml,/<w:pgMar[^>]*w:left="800"/);assert.match(xml,/<w:tab w:val="left" w:pos="4000"\/>/);assert.match(xml,/<w:tab w:val="left" w:pos="6600"\/>/);
  assert.doesNotMatch(xml.slice(0,xml.indexOf('</w:sectPr>')),/<w:framePr/,'a text page has no positioned frames');
  assert.ok(Object.keys(zip.files).some(name=>name.startsWith('word/media/')));assert.ok(result.warnings.some(w=>w.includes('texto corrido')));
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

test('compound border paths retain separate spreadsheet rows and columns',async()=>{
 const pdf=await PDFDocument.create(),font=await pdf.embedFont(StandardFonts.Helvetica),page=pdf.addPage([400,400]);
 // One PDF path contains all six cell frames. Its bounding rectangle is not a cell.
 page.pushOperators(setFillingRgbColor(0,0,0));
 for(const y of [300,260])for(const x of [40,180,280])page.pushOperators(rectangle(x,y,100,40));
 // A stroked compound path, as emitted by the user's source PDF.
 const {stroke}=await import('pdf-lib');page.pushOperators(stroke());
 for(const [text,x,y] of [['Item A',45,320],['2',185,320],['R$ 25,00',285,320],['Item B',45,280],['3',185,280],['R$ 50,00',285,280]] as const)page.drawText(text,{x,y,font,size:10});
 const result=await convertPdf(await pdf.save(),{format:'xlsx'}),wb=new ExcelJS.Workbook();await wb.xlsx.load(Buffer.from(result.bytes) as never);
 const found:{text:string;row:number;col:number}[]=[];wb.worksheets[0]!.eachRow(r=>r.eachCell(c=>{if(!c.isMerged||c.master===c)found.push({text:c.text,row:Number(c.row),col:Number(c.col)});}));
 const a=found.find(c=>c.text==='Item A')!,b=found.find(c=>c.text==='Item B')!,value=found.find(c=>c.text==='25')!;
 assert.ok(a&&b&&value);assert.notEqual(a.row,b.row);assert.notEqual(a.col,value.col);
});

test('mixed PowerPoint pages keep native shapes below and above a clipped bitmap without duplicate paths',async()=>{
 const pdf=await PDFDocument.create(),page=pdf.addPage([400,400]);
 page.drawRectangle({x:20,y:20,width:40,height:40,color:rgb(1,0,0)});
 page.pushOperators(pushGraphicsState(),rectangle(100,100,60,60),clip(),endPath(),setFillingRgbColor(0,0,1),moveTo(80,80),lineTo(200,80),lineTo(200,200),closePath(),fill(),popGraphicsState());
 page.drawRectangle({x:300,y:300,width:40,height:40,color:rgb(0,1,0)});
 const result=await convertPdf(await pdf.save(),{format:'pptx',mode:'editable',dpi:72}),zip=await JSZip.loadAsync(result.bytes),xml=await zip.file('ppt/slides/slide1.xml')!.async('string');
 assert.equal((xml.match(/<p:sp>/g)??[]).length,2,'compatible shapes survive on both sides of the effect');
 assert.ok(xml.indexOf('<p:sp>')<xml.indexOf('<p:pic>')&&xml.lastIndexOf('<p:sp>')>xml.indexOf('<p:pic>'),'bitmap retains its stacking order');
 const media=Object.keys(zip.files).find(n=>/^ppt\/media\/.*\.png$/.test(n));assert.ok(media);
 const image=await loadImage(await zip.file(media)!.async('nodebuffer')),canvas=createCanvas(image.width,image.height),ctx=canvas.getContext('2d');ctx.drawImage(image,0,0);
 assert.equal(ctx.getImageData(40,360,1,1).data[3],0,'deleting the red native shape cannot expose its duplicate in the bitmap');
});

