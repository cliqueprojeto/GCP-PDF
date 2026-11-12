import { _electron as electron } from 'playwright-core';
import {createRequire} from 'node:module';
import {resolve} from 'node:path';
import {mkdir} from 'node:fs/promises';
/** Duplicar páginas: botão sobre a miniatura, menu do botão direito e barra do painel Páginas. */
const require=createRequire(import.meta.url);const file=resolve(process.argv[2]??'.cache/manual.pdf');
const env={...process.env,GCP_PDF_TEST_MODE:'1',GCP_PDF_DATA_DIR:resolve('.cache/e2e-profile')};delete env.ELECTRON_RUN_AS_NODE;
await mkdir('evidence/pages',{recursive:true});
const app=await electron.launch({executablePath:require('electron'),args:[resolve('.')],cwd:resolve('.'),env,timeout:90000});
const errors=[];let failed=0;const check=(label,ok,detail='')=>{if(!ok)failed++;console.log(ok?'✔':'✖',label,detail);};
try{
 const page=await app.firstWindow();page.on('pageerror',e=>errors.push(e.message));await page.waitForFunction(()=>!!window.gcp);
 await page.evaluate(p=>window.gcp.openFiles([p]),file);await page.waitForSelector('.thumbnail-item');await page.waitForTimeout(800);
 const doc=async()=>{const w=await page.evaluate(()=>window.gcp.getWorkspace());return w.documents.find(d=>d.id===w.activeDocumentId)??w.documents.at(-1);};
 const start=await doc();
 const second=page.locator('.thumbnail-item').nth(1);await second.hover();
 await second.locator('.thumbnail-hover-actions button[title="Duplicar esta página"]').click();await page.waitForTimeout(800);
 const a=await doc();
 check('botão sobre a miniatura duplica a página logo depois dela',a.pageCount===start.pageCount+1&&a.pages[2].base===a.pages[1].base&&a.pages[2].src===a.pages[1].src&&a.pages[2].id!==a.pages[1].id,`${start.pageCount}→${a.pageCount}`);
 await page.screenshot({path:'evidence/pages/01-duplicar-miniatura.png'});
 await page.locator('.thumbnail-item').nth(4).click({button:'right'});await page.waitForSelector('.context-menu');
 const items=await page.locator('.context-menu button').allTextContents();
 check('menu do botão direito tem Duplicar',items.some(t=>t.includes('Duplicar')),JSON.stringify(items.filter(t=>/Dupl|Copiar/.test(t))));
 await page.screenshot({path:'evidence/pages/02-duplicar-menu.png'});
 await page.locator('.context-menu button',{hasText:'Duplicar'}).click();await page.waitForTimeout(800);
 const b=await doc();
 check('menu duplica a página escolhida',b.pageCount===a.pageCount+1&&b.pages[5].src===b.pages[4].src&&b.pages[5].base===b.pages[4].base,`${a.pageCount}→${b.pageCount}`);
 check('a cópia fica selecionada',await page.locator('.thumbnail-item').nth(5).evaluate(el=>el.classList.contains('selected')));
 await page.locator('.thumbnail-item').nth(0).click();await page.locator('.thumbnail-item').nth(2).click({modifiers:['Shift']});
 await page.locator('.thumbnail-actions button[title="Duplicar páginas selecionadas"]').click();await page.waitForTimeout(800);
 const c=await doc();
 check('barra do painel duplica a seleção (3 páginas)',c.pageCount===b.pageCount+3&&[0,1,2].every(i=>c.pages[3+i].src===c.pages[i].src),`${b.pageCount}→${c.pageCount}`);
 await page.keyboard.press('Control+z');await page.waitForTimeout(600);
 check('Desfazer volta a duplicação',(await doc()).pageCount===b.pageCount);
}finally{if(errors.length)console.log('ERROS:',errors.join(' | '));await app.evaluate(()=>{for(const v of globalThis.__gcpTest.views.values())v.allowClose=true;}).catch(()=>{});await app.close().catch(()=>{});}
process.exitCode=failed||errors.length?1:0;
