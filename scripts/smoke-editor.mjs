import { _electron as electron } from 'playwright-core';
import {createRequire} from 'node:module';
import {resolve} from 'node:path';
import {mkdir} from 'node:fs/promises';
/** Editor interactions with real mouse and keyboard. Usage: node scripts/smoke-editor.mjs [file.pdf] */
const require=createRequire(import.meta.url);await mkdir('evidence/ui',{recursive:true});
const file=resolve(process.argv[2]??'.cache/cmp/amostra.pdf');
const env={...process.env,GCP_PDF_TEST_MODE:'1',GCP_PDF_DATA_DIR:resolve('.cache/e2e-profile')};delete env.ELECTRON_RUN_AS_NODE;
const app=await electron.launch({executablePath:require('electron'),args:[resolve('.')],cwd:resolve('.'),env,timeout:90000});
const errors=[],check=(label,ok,detail='')=>console.log(ok?'✔':'✖',label,detail);
try{
 const page=await app.firstWindow();page.on('pageerror',e=>errors.push(e.message));
 await page.setViewportSize({width:1500,height:950}).catch(()=>{});
 await page.waitForFunction(()=>!!window.gcp);await page.evaluate(()=>localStorage.removeItem('gcp.last-page'));
 await page.evaluate(p=>window.gcp.openFiles([p]),file);await page.waitForSelector('.page-sheet:not(.loading)');
 const ws=async()=>(await page.evaluate(()=>window.gcp.getWorkspace())).documents[0];
 await page.screenshot({path:'evidence/ui/20-faixa-rotulos-abaixo.png'});
 // 1. Editar tudo: click a paragraph, type, Ctrl+Enter.
 await page.locator('.ribbon-tabs button',{hasText:'Editar'}).first().click();
 // The Editar tab itself turns direct editing on.
 const box=page.locator('.page-sheet[data-page="1"] .source-box.text').first();await box.waitFor({timeout:60000});
 await box.click();await page.waitForTimeout(300);
 const focused=await page.evaluate(()=>document.activeElement?.className??'');check('editor de parágrafo recebe o foco',focused.includes('source-editor'),focused);
 const before=(await ws()).revision;
 await page.keyboard.press('End');await page.keyboard.type(' 2026');await page.keyboard.press('Control+Enter');
 for(let i=0;i<60&&(await ws()).revision<=before;i++)await page.waitForTimeout(500);
 check('texto original alterado no PDF',(await ws()).revision>before);
 await page.screenshot({path:'evidence/ui/21-editar-tudo.png'});
 // 2. Text box: create, then double-click to edit again.
 await page.locator('.tool-button',{hasText:'Adicionar texto'}).first().click();
 const sheet=await page.locator('.page-sheet[data-page="1"]').boundingBox();
 await page.mouse.click(sheet.x+120,sheet.y+120);await page.waitForTimeout(400);await page.keyboard.type('Caixa nova');
 await page.mouse.click(sheet.x+sheet.width-40,sheet.y+sheet.height-40);await page.waitForTimeout(500);
 let text=(await ws()).objects.find(o=>o.kind==='text');check('caixa de texto criada',text?.text==='Caixa nova',text?.text);
 const tool=await page.evaluate(()=>document.querySelector('.page-sheet')?.className);check('voltou para Selecionar',tool.includes('tool-select'),tool);
 await page.mouse.dblclick(sheet.x+130,sheet.y+126);await page.waitForTimeout(300);
 await page.keyboard.press('End');await page.keyboard.type(' editada');await page.mouse.click(sheet.x+sheet.width-40,sheet.y+sheet.height-40);await page.waitForTimeout(500);
 text=(await ws()).objects.find(o=>o.kind==='text');check('duplo clique reabre a caixa para editar',text?.text==='Caixa nova editada',text?.text);
 // 3. Highlight by dragging quickly across one line.
 await page.locator('.ribbon-tabs button',{hasText:'Início'}).first().click();
 await page.locator('.tool-button',{hasText:'Destacar'}).first().click();
 await page.locator('.page-sheet[data-page="3"]').scrollIntoViewIfNeeded();const span=page.locator('.page-sheet[data-page="3"] .textLayer span').nth(3);await span.waitFor({timeout:30000});await span.scrollIntoViewIfNeeded();const sb=await span.boundingBox();
 await page.mouse.move(sb.x+1,sb.y+sb.height/2);await page.mouse.down();await page.mouse.move(sb.x+sb.width-1,sb.y+sb.height/2+40,{steps:3});await page.mouse.up();await page.waitForTimeout(500);
 const mark=(await ws()).objects.find(o=>o.kind==='markup');check('destaque rápido fica restrito ao trecho',!!mark&&mark.rects.length<=4,mark?`${mark.rects.length} linha(s)`:'nenhum');
 await page.screenshot({path:'evidence/ui/22-destaque.png'});
 await page.keyboard.press('Escape');
 // 4. Search with counter and navigation.
 await page.keyboard.press('Control+f');await page.locator('.search-box input').fill('Projeto');await page.keyboard.press('Enter');
 await page.waitForSelector('.search-nav');const counter=await page.locator('.search-nav strong').textContent();
 await page.keyboard.press('Enter');const next=await page.locator('.search-nav strong').textContent();
 check('busca mostra contagem e avança',/1 de \d+/.test(counter)&&/2 de/.test(next),`${counter} → ${next}`);
 await page.screenshot({path:'evidence/ui/23-busca.png'});
 // 5. Zoom typed.
 const zoomInput=page.locator('.toolbar .zoom-box input');await zoomInput.click();await zoomInput.fill('150');await zoomInput.press('Enter');await page.waitForTimeout(300);
 check('zoom digitado',(await page.locator('.statusbar .zoom-box input').inputValue())==='150');
 // 6. Command palette, stamps, page menu.
 await page.keyboard.press('Control+k');await page.locator('.palette input').fill('senha');await page.waitForTimeout(200);
 const top=await page.locator('.palette-item').allTextContents();check('localizador encontra Proteger',top.slice(0,3).some(t=>t.includes('Proteger')),top.slice(0,3).join(' | '));
 await page.screenshot({path:'evidence/ui/24-localizador.png'});await page.keyboard.press('Escape');
 await page.locator('.ribbon-tabs button',{hasText:'Comentário'}).click();await page.locator('.tool-button',{hasText:'Carimbos'}).click();await page.waitForSelector('.stamps');
 await page.locator('.stamp-item').nth(1).click();await page.screenshot({path:'evidence/ui/25-carimbos.png'});
 await page.locator('.modal-footer .button.primary').click();await page.mouse.click(sheet.x+300,sheet.y+300);await page.waitForTimeout(600);
 check('carimbo aplicado e selecionado',(await ws()).objects.some(o=>o.kind==='image')&&await page.locator('.selection-box').count()>0);
 await page.locator('.rail .icon-button').first().click();await page.locator('.thumbnail-item').first().click({button:'right'});await page.waitForSelector('.context-menu');
 await page.screenshot({path:'evidence/ui/26-menu-paginas.png'});
 await page.locator('.context-menu button',{hasText:'Copiar'}).click();await page.locator('.thumbnail-item').nth(1).click({button:'right'});await page.locator('.context-menu button',{hasText:'Colar depois'}).click();await page.waitForTimeout(600);
 check('copiar/colar páginas',(await ws()).pageCount===7,`${(await ws()).pageCount} páginas`);
}finally{
 if(errors.length)console.log('ERROS DE PÁGINA:',errors.join(' | '));
 await app.evaluate(()=>{for(const v of globalThis.__gcpTest.views.values())v.allowClose=true;}).catch(()=>{});await app.close();
}
