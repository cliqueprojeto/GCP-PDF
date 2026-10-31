import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {existsSync} from 'node:fs';
import {PDFDocument,StandardFonts,degrees,rgb} from 'pdf-lib';
import {PdfCraftSession} from '../src/main/pdfcraft-session';
import {EditorBlockReader,groupEditorParagraphs} from '../src/main/editor-blocks';
import {extractDocumentText} from '../src/main/conversion';
import type {SourceParagraph} from '../src/shared/types';

const executable=path.resolve('assets/pdfcraft',process.platform==='win32'?'pdfcraft-cli.exe':'pdfcraft-cli');
const p=(index:number,x:number,y:number,text='Texto'):SourceParagraph=>({index,text,rect:{x,y,width:90,height:10},size:10,font:'Helvetica',bold:false,italic:false,color:'#000000'});
test('blocks preserve native identities, cell boundaries, columns and ruling lines',()=>{
 const source=[p(0,10,10),p(1,10,22),p(2,120,10),p(3,120,22)];
 const cells=[{x:0,y:0,width:110,height:50},{x:110,y:0,width:110,height:50}];
 const groups=groupEditorParagraphs(source,cells);
 assert.deepEqual(groups.map(g=>g.members?.map(p=>p.index)),[[0,1],[2,3]]);
 assert.deepEqual(groupEditorParagraphs(source,[]).map(g=>g.members?.map(p=>p.index)),[[0,1],[2,3]]);
 assert.equal(groupEditorParagraphs(source,[],[{horizontal:true,at:21,from:0,to:220}]).length,4);
 assert.equal(source[0]!.members,undefined,'grouping never mutates engine facts');
});

async function fixture(){const pdf=await PDFDocument.create(),font=await pdf.embedFont(StandardFonts.Helvetica),page=pdf.addPage([600,800]);
 page.drawText('Nome: Fulano',{x:40,y:700,size:10,font});page.drawText('CPF: 123',{x:40,y:660,size:10,font});page.drawText('Vizinho intacto',{x:300,y:700,size:10,font});return pdf.save();}
test('real engine saves a grouped edit once; failed drafts leave the session reusable',{skip:!existsSync(executable)},async()=>{
 const engine=new PdfCraftSession(()=>executable),bytes=await fixture();
 try{
  const listed=await engine.objects('original',()=>bytes,0),parts=listed.paragraphs.filter(p=>p.rect[0]<100);
  assert.equal(parts.length,2);
  const members=parts.map(p=>({paragraph:p.index,text:p.text.replace('Fulano','Bruno').replace('123','456')}));
  const changed=await engine.editParagraph('original',()=>bytes,0,{paragraph:parts[0]!.index,generation:listed.generation,members});
  assert.match(await extractDocumentText(changed),/Nome: Bruno/);assert.match(await extractDocumentText(changed),/CPF: 456/);assert.match(await extractDocumentText(changed),/Vizinho intacto/);
  engine.rekey('original','changed');
  const next=await engine.objects('changed',()=>changed,0);
  await assert.rejects(engine.editParagraph('changed',()=>changed,0,{paragraph:0,generation:next.generation+1,members}),/página mudou/);
  const nextParts=next.paragraphs.filter(p=>p.rect[0]<100);
  await assert.rejects(engine.editParagraph('changed',()=>changed,0,{paragraph:nextParts[0]!.index,generation:next.generation,members:nextParts.map(p=>({paragraph:p.index,text:'Longo '.repeat(1000),width:30}))}),/ultrapassaria/);
  const retry=await engine.editParagraph('changed',()=>changed,0,{paragraph:nextParts[0]!.index,generation:next.generation,members:nextParts.map(p=>({paragraph:p.index,text:p.text.replace('Bruno','Maria')}))});
  assert.match(await extractDocumentText(retry),/Nome: Maria/);assert.doesNotMatch(await extractDocumentText(retry),/Longo/);
 }finally{await engine.dispose();}
});

test('block reader reuses page analysis and invalidates on immutable source replacement',async()=>{
 const reader=new EditorBlockReader(),bytes=await fixture(),parts=[p(0,40,90),p(1,40,102)];
 try{assert.deepEqual(await reader.read(bytes,0,parts,0),await reader.read(bytes,0,parts,0));assert.equal((await reader.read(new Uint8Array(bytes),0,parts,0)).length,1);}finally{await reader.dispose();}
});

test('table-cell ownership uses unrotated crop coordinates on rotated source pages',async()=>{
 for(const angle of [0,90,180,270]){
  const doc=await PDFDocument.create(),page=doc.addPage([600,800]);page.setRotation(degrees(angle));
  for(const x of [20,140])page.drawRectangle({x,y:600,width:120,height:100,borderWidth:1,borderColor:rgb(0,0,0)});
  const reader=new EditorBlockReader(),parts=[p(0,30,110),p(1,30,150),p(2,150,110),p(3,150,150)];
  try{assert.deepEqual((await reader.read(await doc.save(),0,parts,angle)).map(g=>g.members?.map(m=>m.index)),[[0,1],[2,3]],`rotation ${angle}`);}finally{await reader.dispose();}
 }
});

test('a table region stops before a row that introduces an internal divider',async()=>{
 const doc=await PDFDocument.create(),page=doc.addPage([400,400]);
 page.drawRectangle({x:20,y:200,width:280,height:100,borderWidth:1,borderColor:rgb(0,0,0)});
 page.drawLine({start:{x:160,y:200},end:{x:160,y:250},thickness:1});
 page.drawLine({start:{x:160,y:250},end:{x:300,y:250},thickness:1});
 const reader=new EditorBlockReader(),parts=[p(0,30,115),p(1,180,115),p(2,30,170),p(3,180,170)];
 try{const groups=await reader.read(await doc.save(),0,parts,0);assert.deepEqual(groups.map(g=>g.members?.map(m=>m.index)??[g.index]),[[0,1],[2],[3]]);}finally{await reader.dispose();}
});
