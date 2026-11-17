import test from 'node:test';
import assert from 'node:assert/strict';
import {PDFDocument,StandardFonts,setCharacterSpacing} from 'pdf-lib';
import {loadPdf} from '../src/main/conversion';
import {pageRuns,runSpacing} from '../src/main/word-layout';
import {trackedItems} from '../src/main/text-spacing';
import {withSpacing} from '../src/main/editor-blocks';

async function sample() {
 const pdf=await PDFDocument.create(),page=pdf.addPage([400,200]),font=await pdf.embedFont(StandardFonts.Helvetica);
 page.pushOperators(setCharacterSpacing(2.5));
 page.drawText('PRESTACAO DE CONTAS',{x:20,y:150,size:10,font});
 page.pushOperators(setCharacterSpacing(0));
 page.drawText('Texto comum de um paragrafo justificado.',{x:20,y:100,size:10,font});
 return pdf.save();
}

test('letter-spaced text keeps its real words and spacing for editing and Office exports',async()=>{
 const pdf=await loadPdf(await sample());
 try {
  const page=await pdf.getPage(1),runs=await pageRuns(page);
  const head=runs.filter(r=>Math.abs(r.baseline-runs.find(x=>x.text.startsWith('PRESTA'))!.baseline)<1),body=runs.filter(r=>!head.includes(r));
  // PDF.js may report the words as separate items; none may carry invented spaces.
  assert.equal(head.map(r=>r.text.trim()).join(' '),'PRESTACAO DE CONTAS');
  for(const run of head)assert.ok(Math.abs(run.tracking!-2.5)<.3,`tracking ${run.text}: ${run.tracking}`);
  assert.equal(runSpacing(head[0]!).characterSpacing,Math.round(head[0]!.tracking!*20));
  assert.ok(body.every(r=>r.tracking===undefined));
  const items=await trackedItems(page);
  const [title,prose]=withSpacing([
   {index:0,text:'PRESTACAO DE CONTAS',rect:{x:19,y:38,width:200,height:14},size:10,font:'Helvetica',bold:false,italic:false,color:'#000000'},
   {index:1,text:'Texto comum de um paragrafo justificado.',rect:{x:19,y:88,width:300,height:14},size:10,font:'Helvetica',bold:false,italic:false,color:'#000000'},
  ],items);
  assert.ok(Math.abs(title!.tracking!-2.5)<.3,`editor tracking ${title!.tracking}`);
  assert.equal(prose!.tracking,undefined);
 } finally { await pdf.loadingTask.destroy(); }
});

test('o editor recebe negrito, itálico e cor como a página imprime, mesmo sem pista no nome informado',async()=>{
  const {PDFDocument:Doc,StandardFonts:Fonts,rgb:ink}=await import('pdf-lib');
  const doc=await Doc.create(),bold=await doc.embedFont(Fonts.HelveticaBoldOblique),plain=await doc.embedFont(Fonts.Helvetica),sheet=doc.addPage([400,200]);
  sheet.drawText('Aviso importante em destaque',{x:40,y:150,font:bold,size:12,color:ink(.8,.1,.1)});
  sheet.drawText('Texto comum do documento',{x:40,y:100,font:plain,size:12});
  const {loadPdf:open}=await import('../src/main/conversion'),pdf=await open(await doc.save());
  try{
    const page=await pdf.getPage(1),items=await trackedItems(page);
    const base={size:12,font:'F1',bold:false,italic:false,color:'#000000'};
    const [warning,common]=withSpacing([{...base,index:0,text:'Aviso importante em destaque',rect:{x:38,y:38,width:200,height:16}},{...base,index:1,text:'Texto comum do documento',rect:{x:38,y:88,width:200,height:16}}],items);
    assert.deepEqual([warning!.bold,warning!.italic,warning!.ink],[true,true,'#cc1a1a']);
    assert.deepEqual([common!.bold,common!.italic,common!.ink],[false,false,'#000000']);
  }finally{await pdf.loadingTask.destroy();}
});
