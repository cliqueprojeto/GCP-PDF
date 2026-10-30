import { _electron as electron } from 'playwright-core';
import {createRequire} from 'node:module';
import {resolve} from 'node:path';
import {readFile} from 'node:fs/promises';
import {PDFDocument,PDFName,PDFDict} from 'pdf-lib';
/** Acrobat-style comments: drop a note on the page, type, reply, save and read the PDF annotations back. */
const require=createRequire(import.meta.url);const file=resolve(process.argv[2]??'.cache/pedido.pdf');
const env={...process.env,GCP_PDF_TEST_MODE:'1',GCP_PDF_DATA_DIR:resolve('.cache/e2e-profile')};delete env.ELECTRON_RUN_AS_NODE;
const app=await electron.launch({executablePath:require('electron'),args:[resolve('.')],cwd:resolve('.'),env,timeout:90000});
const errors=[],check=(label,ok,detail='')=>console.log(ok?'✔':'✖',label,detail);
try{
 const page=await app.firstWindow();page.on('pageerror',e=>errors.push(e.message));await page.waitForFunction(()=>!!window.gcp);await page.evaluate(()=>localStorage.removeItem('gcp.last-page'));
 await page.evaluate(()=>localStorage.setItem('gcp.author','Bruno'));
 await page.evaluate(p=>window.gcp.openFiles([p]),file);await page.waitForSelector('.page-sheet:not(.loading)');
 const ws=async()=>(await page.evaluate(()=>window.gcp.getWorkspace())).documents[0];
 await page.locator('.ribbon-tabs button',{hasText:'Comentário'}).first().click();
 await page.locator('.tool-button',{hasText:'Adicionar comentário'}).click();
 const sheet=await page.locator('.page-sheet[data-page="1"]').boundingBox();
 await page.mouse.click(sheet.x+sheet.width*0.6,sheet.y+140);await page.waitForSelector('.note-bubble textarea');
 check('clique na página cria a nota e abre o balão',await page.locator('.overlay-note').count()===1);
 await page.keyboard.type('Revisar este valor');await page.locator('.note-bubble .button.primary').click();await page.waitForTimeout(400);
 await page.locator('.note-bubble .note-reply-button').click();await page.keyboard.type('Conferido');await page.locator('.note-bubble .button.primary').click();await page.waitForTimeout(500);
 const note=(await ws()).objects.find(o=>o.kind==='note');
 check('texto e resposta gravados',note?.text==='Revisar este valor'&&note.author==='Bruno'&&note.replies?.[0]?.text==='Conferido',JSON.stringify({t:note?.text,a:note?.author,r:note?.replies}));
 check('painel lista a conversa',(await page.locator('.comments-panel .note-card').count())>=1);
 await page.screenshot({path:'evidence/ui/60-comentarios.png'});
 await page.keyboard.press('Escape');await page.waitForTimeout(200);check('Esc fecha o balão',await page.locator('.note-bubble').count()===0);
 const icon=async()=>{const b=await page.locator('.overlay-note').first().boundingBox();await page.mouse.click(b.x+b.width/2,b.y+b.height/2);};
 await icon();await page.waitForSelector('.note-bubble');
 await page.mouse.click(sheet.x+40,sheet.y+sheet.height*0.8);await page.waitForTimeout(200);check('clicar fora fecha o balão',await page.locator('.note-bubble').count()===0);
 await page.locator('.statusbar .zoom-box input').fill('250');await page.locator('.statusbar .zoom-box input').press('Enter');await page.waitForTimeout(800);
 await page.locator('.overlay-note').first().scrollIntoViewIfNeeded();await icon();await page.waitForSelector('.note-bubble');
 const r=await page.locator('.note-bubble').boundingBox(),vw=await page.evaluate(()=>[innerWidth,innerHeight]);
 const top=await page.evaluate(()=>{const b=document.querySelector('.note-bubble').getBoundingClientRect();return document.elementFromPoint(b.x+b.width/2,b.y+b.height/2)?.closest('.note-bubble')!==null;});
 check('balão inteiro visível e por cima no zoom 250%',r.x>=0&&r.y>=0&&r.x+r.width<=vw[0]&&r.y+r.height<=vw[1]&&top,JSON.stringify(r));
 const out=resolve('.cache/comentado.pdf');
 const bytes=await app.evaluate(async(_e,id)=>Array.from(await globalThis.__gcpTest.store.materialize(id)),note&&(await ws()).id);
 const doc=await PDFDocument.load(new Uint8Array(bytes));const annots=doc.getPages()[0].node.Annots();
 const list=[];for(let i=0;i<(annots?.size()??0);i++){const d=doc.context.lookup(annots.get(i));if(d instanceof PDFDict&&d.get(PDFName.of('Subtype'))?.toString()==='/Text')list.push({irt:!!d.get(PDFName.of('IRT')),text:d.get(PDFName.of('Contents'))?.decodeText?.()});}
 check('PDF salvo tem a nota e a resposta "em resposta a" (IRT)',list.length===2&&list.some(a=>a.irt&&a.text==='Conferido'),JSON.stringify(list));
}finally{if(errors.length)console.log('ERROS:',errors.join(' | '));await app.evaluate(()=>{for(const v of globalThis.__gcpTest.views.values())v.allowClose=true;}).catch(()=>{});await app.close();}
