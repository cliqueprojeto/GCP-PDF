import { _electron as electron } from 'playwright-core';
import {createRequire} from 'node:module';
import {resolve} from 'node:path';
import {existsSync} from 'node:fs';
import {mkdir,writeFile} from 'node:fs/promises';
/** Drives the real app: opens a PDF (default: the large fixture), edits it and records timings and
 * screenshots in evidence/ui. Usage: node scripts/smoke-ui.mjs [file.pdf] */
const require=createRequire(import.meta.url);await mkdir('evidence/ui',{recursive:true});
const file=resolve(process.argv[2]??(existsSync('.cache/manual.pdf')?'.cache/manual.pdf':'evidence/fixtures/relatorio-cultural.pdf'));
const env={...process.env,GCP_PDF_TEST_MODE:'1',GCP_PDF_DATA_DIR:resolve('.cache/e2e-profile')};delete env.ELECTRON_RUN_AS_NODE;
const app=await electron.launch({executablePath:require('electron'),args:[resolve('.')],cwd:resolve('.'),env,timeout:90000});
const logs=[],timings={};const time=async(label,task)=>{const t=performance.now();const r=await task();timings[label]=Math.round(performance.now()-t)+' ms';return r;};
app.process().stderr.on('data',data=>logs.push(String(data)));
try{
 const page=await app.firstWindow();page.on('pageerror',error=>logs.push('PAGE ERROR '+error.message));page.on('console',m=>{if(m.type()==='error')logs.push('CONSOLE '+m.text());});
 await page.setViewportSize({width:1500,height:950}).catch(()=>{});
 await page.waitForFunction(()=>!!window.gcp);await page.evaluate(()=>localStorage.removeItem('gcp.last-page'));await page.waitForSelector('.application');
 await time('abrir e mostrar 1ª página',async()=>{await page.evaluate(p=>window.gcp.openFiles([p]),file);await page.waitForSelector('.page-sheet:not(.loading)',{timeout:60000});});
 const ws=()=>page.evaluate(()=>window.gcp.getWorkspace());let doc=(await ws()).documents[0];
 console.log('documento',doc.name,doc.pageCount,'páginas');
 await page.screenshot({path:'evidence/ui/01-aberto.png'});
 await time('girar página 1 (modelo)',()=>page.evaluate(([id,r])=>window.gcp.applyOperation(id,{type:'rotate',pages:[0],degrees:90},r),[doc.id,doc.revision]));
 await time('desfazer giro',()=>page.evaluate(id=>window.gcp.undo(id),doc.id));
 doc=(await ws()).documents[0];const p0=doc.pages[0].id,p2=doc.pages[2].id;
 const add=(object,dataUrl)=>page.evaluate(([id,o,d])=>window.gcp.applyOperation(id,{type:'add-object',object:o,...(d?{dataUrl:d}:{})},0),[doc.id,object,dataUrl]);
 await time('adicionar 4 objetos',async()=>{
  await add({id:'s1',page:p0,kind:'shape',shape:'rect',x:60,y:60,width:200,height:90,stroke:'#e5484d',fill:null,strokeWidth:3,opacity:1});
  await add({id:'s2',page:p0,kind:'shape',shape:'arrow',x:300,y:80,width:120,height:60,points:[{x:300,y:80},{x:420,y:140}],stroke:'#4f8cff',fill:null,strokeWidth:4,opacity:1});
  await add({id:'s3',page:p0,kind:'shape',shape:'cloud',x:360,y:600,width:160,height:90,stroke:'#a855f7',fill:'#ffe066',strokeWidth:2,opacity:0.8});
  await add({id:'t1',page:p0,kind:'text',x:70,y:170,width:260,height:22,text:'Revisado — São Paulo, 29/10',size:16,color:'#7446e8',font:'sans',bold:true,italic:false,align:'left',rotation:0});
 });
 const png='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAIAAAABCAYAAAD0In+KAAAAEUlEQVR4nGNgYGD4z8DAwMAAAgYBAvd4yNkAAAAASUVORK5CYII=';
 await add({id:'sig',page:p0,kind:'image',x:380,y:700,width:120,height:60,asset:'',rotation:0},png);
 doc=(await ws()).documents[0];
 const sig=doc.objects.find(o=>o.id==='sig');
 await time('mover e redimensionar assinatura',()=>page.evaluate(([id,o])=>window.gcp.applyOperation(id,{type:'update-object',object:{...o,x:300,y:720,width:180,height:90}},0),[doc.id,sig]));
 await page.waitForTimeout(800);
 await page.screenshot({path:'evidence/ui/02-objetos.png'});
 // Highlight selected text by mouse on page 3, like a user would.
 await page.evaluate(()=>window.scrollTo(0,0));
 await page.locator('.page-sheet').nth(0).click({position:{x:5,y:5}});
 await time('editar tudo: listar textos da página 1',async()=>{await page.locator('.ribbon-tabs button',{hasText:'Editar'}).first().click();await page.locator('.tool-button',{hasText:'Editar tudo'}).first().click();await page.waitForSelector('.page-sheet[data-page="1"] .source-box.text',{timeout:60000});});
 await page.screenshot({path:'evidence/ui/03-editar-tudo.png'});
 const before=(await ws()).documents[0].revision;
 await time('editar parágrafo existente (motor persistente)',()=>page.evaluate(([id,pg])=>window.gcp.editParagraph(id,pg,{paragraph:0,text:'Gestão Cultural Pro — Editado'}),[doc.id,p0]));
 doc=(await ws()).documents[0];console.log('revisão',before,'→',doc.revision,'base nova',doc.pages[0].base!==doc.pages[1].base?'(erro: bases divergentes)':'ok');
 await page.waitForTimeout(1500);await page.screenshot({path:'evidence/ui/04-texto-editado.png'});
 await time('materializar (salvar) com objetos',()=>app.evaluate(async(_e,id)=>(await globalThis.__gcpTest.store.materialize(id)).length,doc.id));
 // Signature: select with the mouse, drag it and resize from a corner.
 await page.locator('.ribbon-tabs button',{hasText:'Início'}).first().click();await page.locator('.tool-button',{hasText:'Selecionar'}).first().click();
 const big='data:image/png;base64,'+(await app.evaluate(async()=>{const {nativeImage}=require('electron');return nativeImage.createFromDataURL('data:image/svg+xml;base64,'+Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="300" height="120"><path d="M10 90 C60 10 90 110 140 50 S220 20 290 80" stroke="#1a237e" stroke-width="6" fill="none"/></svg>').toString('base64')).toPNG().toString('base64');}).catch(()=>'iVBORw0KGgoAAAANSUhEUgAAAAIAAAABCAYAAAD0In+KAAAAEUlEQVR4nGNgYGD4z8DAwMAAAgYBAvd4yNkAAAAASUVORK5CYII='));
 doc=(await ws()).documents[0];
 await page.evaluate(([id,pg,d])=>window.gcp.applyOperation(id,{type:'add-object',object:{id:'sig2',page:pg,kind:'image',x:320,y:430,width:150,height:60,asset:'',rotation:0},dataUrl:d},0),[doc.id,doc.pages[0].id,big]);
 await page.waitForTimeout(500);
 const hit=page.locator('.page-sheet[data-page="1"] .object-hit[data-object-id="sig2"]');const box=await hit.boundingBox();
 await page.mouse.move(box.x+box.width/2,box.y+box.height/2);await page.mouse.down();await page.mouse.move(box.x+box.width/2-120,box.y+box.height/2+40,{steps:8});await page.mouse.up();
 await page.waitForTimeout(300);
 const handle=page.locator('.page-sheet[data-page="1"] .handle.se');const hb=await handle.boundingBox();
 await page.mouse.move(hb.x+hb.width/2,hb.y+hb.height/2);await page.mouse.down();await page.mouse.move(hb.x+80,hb.y+10,{steps:8});await page.mouse.up();
 await page.waitForTimeout(400);
 const moved=(await ws()).documents[0].objects.find(o=>o.id==='sig2');console.log('assinatura após arrastar/redimensionar',JSON.stringify({x:Math.round(moved.x),y:Math.round(moved.y),w:Math.round(moved.width),h:Math.round(moved.height),proporção:(moved.width/moved.height).toFixed(2)}));
 await page.screenshot({path:'evidence/ui/05-assinatura-movida.png'});
 // Closing a document with changes must use the app's own dialog.
 await page.locator('.document-tab .tab-close').first().click();
 await page.waitForSelector('.prompt-card',{timeout:10000});await page.screenshot({path:'evidence/ui/06-dialogo-salvar.png'});
 await page.locator('.prompt-card button',{hasText:'Cancelar'}).click();await page.waitForSelector('.prompt-card',{state:'detached'});
 console.log('diálogo próprio: ok, documento ainda aberto =',(await ws()).documents.length===1);
 await app.evaluate(({},)=>globalThis.__gcpTest.createQuickWindow('combine',[]));
 const quick=await app.waitForEvent('window',{timeout:20000});await quick.waitForSelector('.quick-app');await quick.screenshot({path:'evidence/ui/07-janela-rapida.png'});
 console.log('TEMPOS',timings);
}finally{
 await writeFile('evidence/ui/console.log',logs.join('\n'));
 await app.evaluate(()=>{for(const view of globalThis.__gcpTest.views.values())view.allowClose=true;}).catch(()=>{});
 await app.close();
}
