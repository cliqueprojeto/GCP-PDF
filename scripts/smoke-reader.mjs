import { _electron as electron } from 'playwright-core';
import {createRequire} from 'node:module';
import {resolve} from 'node:path';
import {mkdir} from 'node:fs/promises';
/** Leitor de livros: seleção sem virar a página, ações da seleção, destaque, nota, marcador, alinhamento,
 * mapear capítulos, retomada no mesmo trecho depois de fechar e reabrir, e arquivos recentes. */
const require=createRequire(import.meta.url);const file=resolve(process.argv[2]??'.cache/manual.epub');
const env={...process.env,GCP_PDF_TEST_MODE:'1',GCP_PDF_DATA_DIR:resolve('.cache/e2e-profile')};delete env.ELECTRON_RUN_AS_NODE;
await mkdir('evidence/reader',{recursive:true});
const app=await electron.launch({executablePath:require('electron'),args:[resolve('.')],cwd:resolve('.'),env,timeout:90000});
const errors=[];let failed=0;const check=(label,ok,detail='')=>{if(!ok)failed++;console.log(ok?'✔':'✖',label,detail);};
try{
 const page=await app.firstWindow();page.on('pageerror',e=>errors.push(e.message));await page.waitForFunction(()=>!!window.gcp);
 await page.evaluate(()=>{for(const k of Object.keys(localStorage))if(k.startsWith('gcp.book')||k==='gcp.recent-files'||k==='gcp.reader')localStorage.removeItem(k);});
 const open=async()=>{await page.evaluate(p=>window.gcp.openBookFile(p),file);await page.waitForSelector('.book-reader iframe');await page.waitForTimeout(2500);};
 await open();
 // Inside the sandboxed book frame, input goes through Electron's native events (as a real mouse does):
 // Playwright's CDP input crashes a sandboxed frame without scripts, which is not what users run into.
 const send=(e)=>app.evaluate(({BrowserWindow},e)=>BrowserWindow.getAllWindows()[0].webContents.sendInputEvent(e),e);
 const drag=async(x0,y0,x1,y1)=>{x0=Math.round(x0);y0=Math.round(y0);await send({type:'mouseMove',x:x0,y:y0});await page.waitForTimeout(80);await send({type:'mouseDown',x:x0,y:y0,button:'left',clickCount:1});for(let i=1;i<=16;i++){await send({type:'mouseMove',x:Math.round(x0+(x1-x0)*i/16),y:Math.round(y0+(y1-y0)*i/16),button:'left',modifiers:['leftButtonDown']});await page.waitForTimeout(40);}await page.waitForTimeout(600);await send({type:'mouseUp',x:Math.round(x1),y:Math.round(y1),button:'left',clickCount:1});await page.waitForTimeout(400);};
 const rightClick=async(x,y)=>{x=Math.round(x);y=Math.round(y);await send({type:'mouseDown',x,y,button:'right',clickCount:1});await send({type:'mouseUp',x,y,button:'right',clickCount:1});await page.waitForTimeout(300);};
 const inBook=(selector)=>page.evaluate(s=>document.querySelector('.book-reader iframe').contentDocument.querySelectorAll(s).length,selector);
 const state=()=>page.evaluate(()=>{const f=document.querySelector('.book-reader iframe');const r=f.contentDocument.documentElement;return {left:r.scrollLeft,width:f.clientWidth,label:document.querySelector('.book-progress span:last-child')?.textContent};});
 await page.locator('.book-turn.next').click();await page.waitForTimeout(450);
 for(let i=0;i<5;i++){await page.keyboard.press('ArrowRight');await page.waitForTimeout(450);}
 const before=await state();
 check('passa páginas com o teclado',before.left>=before.width*5,JSON.stringify(before));
 // Drag a selection from the middle of the page to beyond its right edge, as a reader would.
 const box=await page.locator('.book-stage').boundingBox();
 await drag(box.x+box.width*0.3,box.y+box.height*0.35,box.x+box.width-2,box.y+box.height*0.45);
 const after=await state();
 check('selecionar até a borda não vira a página',Math.abs(after.left-before.left)<2,JSON.stringify({before:before.left,after:after.left}));
 check('balão de ações aparece ao soltar a seleção',await page.locator('.book-menu').count()===1);
 await page.screenshot({path:'evidence/reader/01-acoes-da-selecao.png'});
 await page.locator('.book-menu-colors button').nth(1).click();await page.waitForTimeout(300);
 check('destaque verde aplicado no texto',await inBook('mark.gcp-mark')>0);
 // Right click inside the text: the full menu with note, synonyms and translation.
 await drag(box.x+box.width*0.35,box.y+box.height*0.6,box.x+box.width*0.55,box.y+box.height*0.62);
 if(await page.locator('.book-menu').count()){await page.keyboard.press('Escape');await page.waitForTimeout(150);}
 await rightClick(box.x+box.width*0.45,box.y+box.height*0.61);
 const items=await page.locator('.book-menu button').allTextContents();
 check('botão direito: nota, copiar, traduzir, sinônimos, marcador',['nota','Copiar','Traduzir','Sinônimos','marcador'].every(w=>items.some(t=>t.includes(w))),JSON.stringify(items));
 await page.locator('.book-menu button',{hasText:'nota ao texto'}).click();await page.waitForSelector('.book-annotation textarea');
 await page.keyboard.type('Rever este trecho');await page.locator('.book-annotation .button.primary').click();await page.waitForTimeout(300);
 check('nota salva no destaque',await inBook('mark.gcp-mark.noted')>0);
 await page.locator('.book-bar button[title^="Adicionar marcador"]').click();
 await page.locator('.book-bar button[title^="Destaques"]').click();await page.waitForTimeout(200);
 const listed=await page.locator('.book-note-item').count();
 check('painel lista 2 destaques e 1 marcador',listed===3,String(listed));
 await page.screenshot({path:'evidence/reader/02-anotacoes.png'});
 await page.locator('.book-bar button[title^="Destaques"]').click();
 await page.locator('.book-bar button[title="Opções de exibição"]').click();
 await page.locator('.book-segments button[aria-label="Justificado"]').click();await page.waitForTimeout(1500);
 const align=await page.evaluate(()=>{const d=document.querySelector('.book-reader iframe').contentDocument;return d.defaultView.getComputedStyle(d.querySelector('.gcp-chapter p')).textAlign;});
 check('alinhamento justificado aplicado',align==='justify',align);
 await page.screenshot({path:'evidence/reader/03-opcoes.png'});
 const kept=await state();
 check('posição mantida ao mudar o alinhamento',Math.abs(kept.left/kept.width-after.left/after.width)<=1,JSON.stringify(kept));
 await page.keyboard.press('Escape');await page.keyboard.press('Escape');await page.waitForTimeout(1200);
 const recent=await page.evaluate(()=>JSON.parse(localStorage.getItem('gcp.recent-files')||'[]'));
 check('livro aparece nos recentes com o progresso',recent.some(r=>r.path.toLowerCase().endsWith('.epub')&&r.book&&r.book.percent>0),JSON.stringify(recent.map(r=>[r.name,r.book])));
 const home=await page.locator('.home-recent-row',{hasText:'.epub'}).first().textContent().catch(()=>'');
 check('início mostra "Continuar em"',/Continuar em \d+%/.test(home??''),home);
 await open();
 const resumed=await state();
 check('reabre no mesmo ponto (não na capa)',resumed.left>=resumed.width*3&&Math.abs(resumed.left-kept.left)<=kept.width,JSON.stringify({resumed,kept}));
 check('destaques continuam ao reabrir',await inBook('mark.gcp-mark')>0);
 await page.locator('.book-bar button[title="Sumário"]').click();
 if(await page.locator('.book-toc-tools button',{hasText:'Mapear'}).count()){await page.locator('.book-toc-tools button',{hasText:'Mapear'}).click();await page.waitForTimeout(300);check('mapear capítulos gera um sumário',await page.locator('.book-toc > button').count()>1);}
 await page.screenshot({path:'evidence/reader/04-sumario.png'});
}finally{if(errors.length)console.log('ERROS:',errors.join(' | '));await app.evaluate(()=>{for(const v of globalThis.__gcpTest.views.values())v.allowClose=true;}).catch(()=>{});await app.close();}
process.exitCode=failed||errors.length?1:0;
