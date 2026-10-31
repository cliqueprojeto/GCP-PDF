import test from 'node:test';
import assert from 'node:assert/strict';
import {PDFDocument,StandardFonts,rgb} from 'pdf-lib';
import JSZip from 'jszip';
import {convertPdf} from '../src/main/conversion';

/** A two-page form like the ones public notices publish: repeated title, numbered rules, a ruled table whose
 * borders are drawn piece by piece with a shaded header row, a rule and the page number at the bottom. */
async function form() {
  const doc=await PDFDocument.create(),font=await doc.embedFont(StandardFonts.Helvetica),bold=await doc.embedFont(StandardFonts.HelveticaBold);
  for(let n=1;n<=2;n++){
    const page=doc.addPage([595,842]),top=(y:number)=>842-y;
    page.drawText('ANEXO II - FORMULARIO DE INSCRICAO',{x:200,y:top(60),size:10,font:bold});
    if(n===1){
      const items=['Nao existe limite de paginas para apresentacao deste formulario, ficando sob criterio do proponente que pode','escrever quanto quiser;','O formulario devera ser digitado.'];
      page.drawText('1.',{x:72,y:top(100),size:10,font});page.drawText(items[0]!,{x:86,y:top(100),size:10,font});page.drawText(items[1]!,{x:86,y:top(112),size:10,font});
      page.drawText('2.',{x:72,y:top(124),size:10,font});page.drawText(items[2]!,{x:86,y:top(124),size:10,font});
    }
    // Table 72..523 × 160..260: shaded header, borders as thin bars, each side in two pieces.
    page.drawRectangle({x:72,y:top(180),width:451,height:20,color:rgb(0.65,0.65,0.65)});
    for(const [x,y,w,h] of [[72,180,451,0.8],[72,220,451,0.8],[72,260,451,0.8],[72,180,0.8,40],[72,220,0.8,40],[523,180,0.8,40],[523,220,0.8,40],[300,220,0.8,40]] as const)page.drawRectangle({x,y:top(y+h),width:w,height:h,color:rgb(0,0,0)});
    page.drawText('1 - DADOS DO BLOCO',{x:78,y:top(174),size:10,font:bold});
    page.drawText('Nome: Fulano',{x:78,y:top(196),size:10,font});page.drawText('CPF: 000',{x:78,y:top(208),size:10,font});
    page.drawText('E-mail: a@b.c',{x:78,y:top(236),size:10,font});page.drawText('Telefone',{x:306,y:top(236),size:10,font});
    page.drawRectangle({x:72,y:top(720),width:451,height:3,color:rgb(0.4,0.14,0.14)});
    page.drawText(String(n),{x:518,y:top(745),size:10,font});
  }
  return doc.save();
}

test('a text form becomes a flowing Word document with header, footer page field, list and real tables',async()=>{
  const result=await convertPdf(await form(),{format:'docx',mode:'editable'});
  const zip=await JSZip.loadAsync(result.bytes),files=Object.keys(zip.files);
  const xml=await zip.file('word/document.xml')!.async('string');
  const header=await zip.file(files.find(f=>/^word\/header\d*\.xml$/.test(f))!)!.async('string');
  const footer=await zip.file(files.find(f=>/^word\/footer\d*\.xml$/.test(f))!)!.async('string');
  assert.match(header,/ANEXO II/,'the title on every page is the header');
  assert.doesNotMatch(xml,/ANEXO II/,'and is not repeated in the body');
  assert.match(footer,/PAGE/,'the page number is a field');
  assert.match(footer,/<w:pBdr><w:bottom[^>]*w:color="662424"/,'the footer rule keeps its colour');
  assert.doesNotMatch(xml,/<w:framePr/,'no positioned frames');
  assert.equal((xml.match(/<w:tbl>/g)??[]).length,2,'one real table per page');
  assert.match(xml,/<w:gridSpan w:val="2"\/>/,'the header and the two-line cell span both columns');
  assert.match(xml,/<w:shd[^>]*w:fill="A6A6A6"/,'the shaded header row');
  assert.match(xml,/<w:ind w:left="\d+" w:hanging="\d+"\/>/,'list items hang under their text');
  assert.match(xml,/<w:t xml:space="preserve">1\.<\/w:t>/);
  const firstItem=xml.slice(xml.indexOf('Nao existe'),xml.indexOf('O formulario'));
  assert.match(firstItem,/escrever quanto quiser/,'a wrapped list line joins its item');
  assert.match(xml,/Nome: Fulano<\/w:t>[\s\S]*?<\/w:p><w:p>[\s\S]*?CPF: 000/,'form lines inside a cell stay separate paragraphs');
  assert.ok(result.warnings.some(w=>w.includes('texto corrido')));
});

test('a page made of artwork keeps the positioned layout',async()=>{
  const doc=await PDFDocument.create(),font=await doc.embedFont(StandardFonts.HelveticaBold),page=doc.addPage([595,842]);
  page.drawRectangle({x:0,y:0,width:595,height:842,color:rgb(0.2,0.1,0.5)});
  page.drawText('Cartaz',{x:200,y:400,size:40,font,color:rgb(1,1,1)});
  const result=await convertPdf(await doc.save(),{format:'docx',mode:'editable'});
  const xml=await (await JSZip.loadAsync(result.bytes)).file('word/document.xml')!.async('string');
  assert.match(xml,/<w:framePr/);assert.ok(result.warnings.some(w=>w.includes('layout preservado')));
});
