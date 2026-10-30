import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {existsSync} from 'node:fs';
import {PDFDocument} from 'pdf-lib';
import {PdfCraftSession} from '../src/main/pdfcraft-session';
import {DocumentStore} from '../src/main/store';

const executable=path.resolve('assets/pdfcraft',process.platform==='win32'?'pdfcraft-cli.exe':'pdfcraft-cli');
async function fixture(){const doc=await PDFDocument.create();for(let n=0;n<3;n++)doc.addPage([600+n*10,800+n*10]);return doc.save();}
let pdfJs:Promise<typeof import('pdfjs-dist/legacy/build/pdf.mjs')>|undefined;
async function outline(bytes:Uint8Array){
 pdfJs??=(async()=>{const canvas=await import('@napi-rs/canvas');Object.assign(globalThis,{DOMMatrix:canvas.DOMMatrix,ImageData:canvas.ImageData,Path2D:canvas.Path2D});return import('pdfjs-dist/legacy/build/pdf.mjs');})();
 const {getDocument}=await pdfJs,task=getDocument({data:new Uint8Array(bytes)}),pdf=await task.promise;
 try{
  const read=async(item:any):Promise<any>=>{const dest=typeof item.dest==='string'?await pdf.getDestination(item.dest):item.dest;const page=Array.isArray(dest)?await pdf.getPageIndex(dest[0]):-1;let top:number|null=null;
   if(page>=0&&dest[1]?.name==='XYZ'&&typeof dest[3]==='number'){const view=(await pdf.getPage(page+1)).getViewport({scale:1});top=view.convertToViewportPoint(typeof dest[2]==='number'?dest[2]:0,dest[3])[1]??null;}
   return{title:item.title,page,top,bold:item.bold,children:await Promise.all((item.items??[]).map(read))};};
  return await Promise.all((await pdf.getOutline()??[]).map(read));
 }finally{await task.destroy();}
}

test('bookmarks keep names, child hierarchy and exact reading position after materialize/save/reopen',{skip:!existsSync(executable),timeout:60000},async()=>{
 const engine=new PdfCraftSession(()=>executable),store=new DocumentStore(),original=await fixture(),id=await store.add(original,'Marcadores.pdf');
 const edit=async(steps:{tool:string;args:Record<string,unknown>}[])=>{const old=store.info(id).pages[0]!.base,revision=store.get(id).revision;const bytes=await engine.bookmarkEdit(old,()=>store.base(old),steps);const next=await store.swapBase(id,old,bytes,revision);engine.rekey(old,next);};
 try{
  await edit([{tool:'bookmark_add',args:{title:'Ponto de leitura',page:2,top:123.5}}]);
  await edit([{tool:'bookmark_rename',args:{path:[1],title:'Prestação de contas — São João'}},{tool:'bookmark_set_style',args:{path:[1],bold:true}},{tool:'bookmark_add',args:{title:'Anexo comprobatório',page:1,top:42,parent:[1]}}]);
  const saved=await store.materialize(id),first=await outline(saved);
  assert.equal(first.length,1);assert.equal(first[0].title,'Prestação de contas — São João');assert.equal(first[0].page,1);assert.equal(first[0].bold,true);assert.ok(Math.abs(first[0].top-123.5)<0.01);
  assert.equal(first[0].children[0].title,'Anexo comprobatório');assert.equal(first[0].children[0].page,0);assert.ok(Math.abs(first[0].children[0].top-42)<0.01);
  // A different engine session reads the saved PDF, so this cannot pass from a stale UI cache.
  const reopened=new PdfCraftSession(()=>executable);try{const list=await reopened.bookmarks('reaberto',()=>saved);assert.equal(list[0].title,first[0].title);assert.equal(list[0].page,2);assert.equal(list[0].destination.top,123.5);assert.equal(list[0].children[0].title,'Anexo comprobatório');}finally{await reopened.dispose();}
  const pristine=await outline(original);assert.deepEqual(pristine,[],'the input source bytes remain untouched');
 }finally{await engine.dispose();}
});

test('changing a bookmark page and deleting a child preserve the rest of the saved outline',{skip:!existsSync(executable),timeout:60000},async()=>{
 const engine=new PdfCraftSession(()=>executable);let bytes=await fixture(),base='original';
 const edit=async(steps:{tool:string;args:Record<string,unknown>}[])=>{const next=base+'-next',saved=await engine.bookmarkEdit(base,()=>bytes,steps);engine.rekey(base,next);base=next;bytes=saved;};
 try{
  await edit([{tool:'bookmark_add',args:{title:'Principal',page:1,top:70}},{tool:'bookmark_add',args:{title:'Filho',page:2,top:30,parent:[1]}}]);
  await edit([{tool:'bookmark_set_page',args:{path:[1],page:3}}]);const moved=await outline(bytes);
  assert.equal(moved[0].page,2);assert.equal(moved[0].title,'Principal');assert.equal(moved[0].children[0].page,1);
  await edit([{tool:'bookmark_delete',args:{path:[1,1]}}]);const deleted=await outline(bytes);assert.equal(deleted[0].page,2);assert.deepEqual(deleted[0].children,[]);
 }finally{await engine.dispose();}
});

