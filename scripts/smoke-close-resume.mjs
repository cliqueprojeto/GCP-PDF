import { _electron as electron } from 'playwright-core';
import {createRequire} from 'node:module';
import {resolve} from 'node:path';
import {mkdir,copyFile} from 'node:fs/promises';
/** Fechar com confirmação (aba, janela e Sair), retomada da leitura na mesma página/posição e abertura de
 * um PDF com campos de formulário sem tipo (deixados ao combinar arquivos). */
const require=createRequire(import.meta.url);
const broken=process.argv[2]?resolve(process.argv[2]):undefined,manual=resolve('.cache/manual.pdf');
await mkdir('evidence/close',{recursive:true});
const reading=resolve('.cache/leitura-retomada.pdf');await copyFile(manual,reading);
const env={...process.env,GCP_PDF_TEST_MODE:'1',GCP_PDF_DATA_DIR:resolve('.cache/e2e-profile')};delete env.ELECTRON_RUN_AS_NODE;
const app=await electron.launch({executablePath:require('electron'),args:[resolve('.')],cwd:resolve('.'),env,timeout:90000});
const errors=[];let failed=0;const check=(label,ok,detail='')=>{if(!ok)failed++;console.log(ok?'✔':'✖',label,detail);};
const page=await app.firstWindow();page.on('pageerror',e=>errors.push(e.message));
const ws=()=>page.evaluate(()=>window.gcp.getWorkspace());
const prompt=async()=>{const t=Date.now();await page.waitForSelector('.prompt-card',{timeout:90000});if(Date.now()-t>2000)console.log('  (diálogo levou',Date.now()-t,'ms)');return {title:await page.locator('.prompt-card h2').textContent(),buttons:await page.locator('.prompt-card .prompt-buttons button').allTextContents()};};
const answer=(label)=>page.locator('.prompt-card .prompt-buttons button',{hasText:label}).click();
try{
 await page.waitForFunction(()=>!!window.gcp);
 const bounds=await app.evaluate(({BrowserWindow,screen})=>{const w=BrowserWindow.getAllWindows()[0];return {max:w.isMaximized(),b:w.getBounds(),area:screen.getDisplayMatching(w.getBounds()).workArea};});
 check('janela abre maximizada no tamanho da área útil',bounds.max||(bounds.b.width>=bounds.area.width-16&&bounds.b.height>=bounds.area.height-16),JSON.stringify(bounds));
 if(broken){
  const t0=Date.now();await page.evaluate(p=>window.gcp.openFiles([p]),broken);await page.waitForSelector('.page-sheet:not(.loading)',{timeout:180000});
  const doc=(await ws()).documents.at(-1);
  check('PDF com campos sem tipo abre (antes: erro em inglês)',doc?.pageCount>1,`${doc?.pageCount} páginas em ${Date.now()-t0} ms`);
  await page.locator('.tab-close').last().click();const p=await prompt();
  check('fechar aba sem alterações pede confirmação',p.title==='Fechar documento?'&&p.buttons.join('|')==='Fechar|Cancelar',JSON.stringify(p));
  await page.screenshot({path:'evidence/close/01-fechar-aba.png'});
  await answer('Cancelar');await page.waitForTimeout(300);
  check('Cancelar mantém a aba aberta',(await ws()).documents.length>=1);
  await page.locator('.tab-close').last().click();await prompt();await answer('Fechar');await page.waitForTimeout(500);
 }
 // Reading position: a page well inside a long file, part-way down the page.
 await page.evaluate(()=>{localStorage.removeItem('gcp.last-page');});
 await page.evaluate(p=>window.gcp.openFiles([p]),reading);await page.waitForSelector('.page-sheet:not(.loading)');await page.waitForTimeout(800);
 await page.evaluate(()=>{const s=document.querySelector('.canvas-scroll');const n=document.querySelector('.page-sheet[data-page="120"]');s.scrollTop=n.offsetTop+n.offsetHeight*0.4;});
 await page.waitForTimeout(1200);
 const before=await page.evaluate(()=>{const s=document.querySelector('.canvas-scroll'),n=document.querySelector('.page-sheet[data-page="120"]');return {page:document.querySelector('.status-page input,.page-input input,input[aria-label*="Página"]')?.value,offset:(s.scrollTop-n.offsetTop)/n.offsetHeight};});
 // Change something so closing asks to save.
 const id=(await ws()).documents.at(-1).id;
 await page.evaluate(async id=>{const d=(await window.gcp.getWorkspace()).documents.find(x=>x.id===id);await window.gcp.applyOperation(id,{type:'rotate',pages:[0],degrees:90},d.revision);},id);await page.waitForTimeout(300);
 await page.locator('.tab-close').last().click();const unsaved=await prompt();
 check('aba com alterações: Salvar agora / Fechar sem salvar / Cancelar',unsaved.title==='Salvar antes de fechar?'&&unsaved.buttons.join('|')==='Salvar agora|Fechar sem salvar|Cancelar',JSON.stringify(unsaved));
 check('“Fechar sem salvar” aparece em vermelho',await page.locator('.prompt-card .button.danger-outline',{hasText:'Fechar sem salvar'}).count()===1);
 await page.screenshot({path:'evidence/close/02-salvar-antes.png'});
 await answer('Fechar sem salvar');await page.waitForTimeout(600);
 check('fechar sem salvar remove a aba',!(await ws()).documents.some(d=>d.id===id));
 await page.evaluate(p=>window.gcp.openFiles([p]),reading);await page.waitForSelector('.page-sheet:not(.loading)');await page.waitForTimeout(4000);
 const after=await page.evaluate(()=>{const s=document.querySelector('.canvas-scroll'),n=document.querySelector('.page-sheet[data-page="120"]');return {offset:(s.scrollTop-n.offsetTop)/n.offsetHeight};});
 check('reabre na mesma página e posição',Math.abs(after.offset-before.offset)<0.05,JSON.stringify({before,after}));
 // Window close and Sair ask once; Cancel keeps everything.
 await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].close());const w=await prompt();
 check('fechar a janela pede confirmação',/Fechar o GCP-PDF\?|Fechar esta janela\?/.test(w.title)&&w.buttons.includes('Cancelar'),JSON.stringify(w));
 await page.screenshot({path:'evidence/close/03-fechar-janela.png'});
 await answer('Cancelar');await page.waitForTimeout(400);
 check('Cancelar mantém a janela',await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().length)===1);
 const id2=(await ws()).documents.at(-1).id;await page.evaluate(async id=>{const d=(await window.gcp.getWorkspace()).documents.find(x=>x.id===id);await window.gcp.applyOperation(id,{type:'rotate',pages:[0],degrees:90},d.revision);},id2);await page.waitForTimeout(300);
 await app.evaluate(({app})=>app.quit());const q=await prompt();
 check('Sair com alterações pergunta antes (antes fechava sem perguntar)',q.title==='Salvar antes de fechar?',JSON.stringify(q));
 await answer('Cancelar');await page.waitForTimeout(400);
 check('Cancelar em Sair mantém o programa aberto',await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().length)===1);
}finally{if(errors.length)console.log('ERROS:',errors.join(' | '));await app.evaluate(()=>{for(const v of globalThis.__gcpTest.views.values())v.allowClose=true;}).catch(()=>{});await app.close().catch(()=>{});}
process.exitCode=failed||errors.length?1:0;
