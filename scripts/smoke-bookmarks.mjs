import { _electron as electron } from 'playwright-core';
import {createRequire} from 'node:module';import {resolve} from 'node:path';
/** Bookmarks: automatic, add at reading position, rename, go to, delete. Usage: node scripts/smoke-bookmarks.mjs [file.pdf] */
const require=createRequire(import.meta.url);const file=resolve(process.argv[2]??'.cache/pedido.pdf');
const env={...process.env,GCP_PDF_TEST_MODE:'1',GCP_PDF_DATA_DIR:resolve(process.env.GCP_PDF_SMOKE_PROFILE??'.cache/e2e-bookmarks-profile')};delete env.ELECTRON_RUN_AS_NODE;
const app=await electron.launch({executablePath:require('electron'),args:[resolve('.')],cwd:resolve('.'),env,timeout:90000});
const check=(label,ok,detail='')=>{console.log(ok?'✔':'✖',label,detail);if(!ok)throw new Error(label+' '+detail);};
try{const page=await app.firstWindow();await page.waitForFunction(()=>!!window.gcp);await page.evaluate(()=>localStorage.removeItem('gcp.last-page'));
 await page.evaluate(p=>window.gcp.openFiles([p]),file);await page.waitForSelector('.page-sheet:not(.loading)');
 await page.locator('.rail button[title="Marcadores"]').click();await page.waitForSelector('.bookmarks-empty, .bookmarks-tree');
 await page.locator('.bookmarks-empty .button.primary').click();await page.waitForSelector('.bookmark-row',{timeout:60000});
 const rows=await page.locator('.bookmark-row').allTextContents();check('marcadores automáticos criados dos títulos',rows.length>=2,rows.slice(0,5).join(' | '));
 await page.screenshot({path:'evidence/ui/66-marcadores.png'});
 await page.evaluate(()=>{const s=document.querySelector('.canvas-scroll');s.scrollTo({top:document.querySelector('.page-sheet[data-page="5"]').offsetTop+200});});await page.waitForTimeout(600);
 const before=await page.locator('.bookmark-row').count();await page.locator('.bookmarks-toolbar button[title^="Adicionar marcador"]').click();await page.waitForSelector('.bookmark-row input');
 await page.keyboard.type('Ponto de leitura');await page.keyboard.press('Enter');await page.waitForTimeout(1500);
 const titles=await page.locator('.bookmark-title').allTextContents();check('novo marcador na posição de leitura, renomeado',titles.includes('Ponto de leitura')&&(await page.locator('.bookmark-row').count())===before+1,titles.at(-1));
 await page.evaluate(()=>document.querySelector('.canvas-scroll').scrollTo({top:0}));await page.waitForTimeout(400);
 await page.locator('.bookmark-row',{hasText:'Ponto de leitura'}).click();await page.waitForTimeout(500);
 const at=await page.evaluate(()=>{const s=document.querySelector('.canvas-scroll'),p=document.querySelector('.page-sheet[data-page="5"]');return Math.round(s.scrollTop-p.offsetTop);});
 check('clicar no marcador volta ao ponto marcado',Math.abs(at-200)<40,`deslocamento ${at}px`);
 await page.locator('.bookmarks-toolbar button[title^="Excluir"]').click();await page.waitForTimeout(1500);
 check('excluir marcador',!(await page.locator('.bookmark-title').allTextContents()).includes('Ponto de leitura'));
 // Reopening continues where the reading stopped.
 await page.evaluate(()=>{const s=document.querySelector('.canvas-scroll');s.scrollTo({top:document.querySelector('.page-sheet[data-page="7"]').offsetTop+50});});await page.waitForTimeout(1500);
 await app.evaluate(()=>{for(const v of globalThis.__gcpTest.views.values())for(const id of v.ids){const d=globalThis.__gcpTest.store.get(id);d.savedRevision=d.revision;}});
 await page.evaluate(async()=>{const d=(await window.gcp.getWorkspace()).documents[0];await window.gcp.closeDocument(d.id);});await page.waitForTimeout(500);
 await page.evaluate(p=>window.gcp.openFiles([p]),file);await page.waitForSelector('.page-sheet:not(.loading)');await page.waitForTimeout(2500);
 const current=await page.locator('.statusbar').textContent();check('reabrir volta à última página vista',/Página 7 de/.test(current??''),(current??'').slice(0,40));
}finally{await app.evaluate(()=>{for(const v of globalThis.__gcpTest.views.values())v.allowClose=true;}).catch(()=>{});await app.close();}
