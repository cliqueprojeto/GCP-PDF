import { _electron as electron } from 'playwright-core';
import {createRequire} from 'node:module';
import {resolve} from 'node:path';
import {mkdir} from 'node:fs/promises';
import {PDFDocument,PDFName,PDFDict,PDFHexString,PDFString} from 'pdf-lib';
/** Comentários presos ao texto: selecionar, botão direito, nota com o trecho, seta do balão,
 * destaques com resumo no painel, ir até o trecho pelo painel e gravação no PDF. */
const require=createRequire(import.meta.url);const file=resolve(process.argv[2]??'.cache/paraiso.pdf');
const env={...process.env,GCP_PDF_TEST_MODE:'1',GCP_PDF_DATA_DIR:resolve('.cache/e2e-profile')};delete env.ELECTRON_RUN_AS_NODE;
await mkdir('evidence/comments',{recursive:true});
const app=await electron.launch({executablePath:require('electron'),args:[resolve('.')],cwd:resolve('.'),env,timeout:90000});
const errors=[];let failed=0;const check=(label,ok,detail='')=>{if(!ok)failed++;console.log(ok?'✔':'✖',label,detail);};
try{
 const page=await app.firstWindow();page.on('pageerror',e=>errors.push(e.message));await page.waitForFunction(()=>!!window.gcp);
 await page.evaluate(()=>{localStorage.removeItem('gcp.last-page');localStorage.setItem('gcp.author','Bruno');});
 await page.evaluate(p=>window.gcp.openFiles([p]),file);await page.waitForSelector('.page-sheet:not(.loading)');await page.waitForTimeout(800);
 const ws=async()=>{const w=await page.evaluate(()=>window.gcp.getWorkspace());return w.documents.find(d=>d.id===w.activeDocumentId)??w.documents.at(-1);};
 /** Selects the words of text spans n..m of page 1 by dragging, as the reader does. */
 const select=async(n,m)=>{const spans=page.locator('.page-sheet[data-page="1"] .textLayer span');await spans.nth(m).waitFor({timeout:30000});const a=await spans.nth(n).boundingBox(),b=await spans.nth(m).boundingBox();await page.mouse.move(a.x+1,a.y+a.height/2);await page.mouse.down();await page.mouse.move(b.x+b.width-1,b.y+b.height/2,{steps:8});await page.mouse.up();await page.waitForTimeout(150);return {a,b,text:await page.evaluate(()=>getSelection().toString().replace(/\s+/g,' ').trim())};};
 const first=await select(0,1);
 await page.mouse.click(first.a.x+first.a.width/2,first.a.y+first.a.height/2,{button:'right'});await page.waitForSelector('.context-menu');
 const items=await page.locator('.context-menu button').allTextContents();
 check('botão direito no texto: copiar, destacar, sublinhar, tachar, ondulado, nota, marcador, sinônimos, traduzir',['Copiar','Destacar','Sublinhar','Tachar','ondulado','comentário','marcador','Sinônimos','Traduzir'].every(w=>items.some(t=>t.includes(w))),JSON.stringify(items));
 await page.screenshot({path:'evidence/comments/01-menu-texto.png'});
 await page.locator('.context-menu button',{hasText:'comentário'}).click();await page.waitForSelector('.note-bubble textarea');
 const quote=await page.locator('.note-bubble .note-quote').textContent();
 check('balão mostra o trecho comentado',!!quote&&quote.length>2&&first.text.startsWith(quote.slice(0,6)),JSON.stringify({quote,selected:first.text}));
 await page.keyboard.type('Conferir esta frase');await page.locator('.note-bubble .button.primary').click();await page.waitForTimeout(400);
 check('seta liga o balão ao ícone',await page.locator('svg.note-tail polygon').count()===1);
 check('trecho marcado na página',await page.locator('.page-sheet[data-page="1"] .note-anchor rect').count()>0);
 // Drag the bubble away: the pointer must follow.
 const grip=await page.locator('.note-bubble-grip').boundingBox();const tailBefore=await page.locator('svg.note-tail polygon').getAttribute('points');
 await page.mouse.move(grip.x+grip.width/2,grip.y+5);await page.mouse.down();await page.mouse.move(grip.x+grip.width/2+120,grip.y+160,{steps:6});await page.mouse.up();await page.waitForTimeout(200);
 const tailAfter=await page.locator('svg.note-tail polygon').getAttribute('points');
 check('arrastar o balão move a seta junto',tailBefore!==tailAfter,JSON.stringify({tailBefore,tailAfter}));
 await page.screenshot({path:'evidence/comments/02-balao-seta.png'});
 const note=(await ws()).objects.find(o=>o.kind==='note'&&o.text==='Conferir esta frase');
 check('nota gravada com trecho e posição no texto',note?.text==='Conferir esta frase'&&!!note.quote&&note.anchor?.length>0,JSON.stringify({quote:note?.quote,anchor:note?.anchor?.length}));
 await page.keyboard.press('Escape');await page.waitForTimeout(150);
 const second=await select(2,3);
 await page.mouse.click(second.a.x+second.a.width/2,second.a.y+second.a.height/2,{button:'right'});await page.waitForSelector('.context-menu');
 await page.locator('.context-menu button',{hasText:'Destacar'}).click();await page.waitForTimeout(400);
 const third=await select(4,4);
 await page.mouse.click(third.a.x+third.a.width/2,third.a.y+third.a.height/2,{button:'right'});await page.waitForSelector('.context-menu');
 await page.locator('.context-menu button',{hasText:'ondulado'}).click();await page.waitForTimeout(400);
 const marks=(await ws()).objects.filter(o=>o.kind==='markup');
 check('destaque e sublinhado ondulado com o texto selecionado',marks.length===2&&marks.every(m=>m.text)&&marks.some(m=>m.style==='squiggly'),JSON.stringify(marks.map(m=>[m.style,m.text])));
 await page.locator('.sidebar-rail button[title="Comentários"], .side-rail button[title="Comentários"], button[title="Comentários"]').first().click().catch(()=>{});
 await page.waitForSelector('.comments-panel');
 const panelText=await page.locator('.comments-panel').textContent();
 check('painel mostra a nota com o trecho e os destaques com resumo',panelText.includes('Conferir esta frase')&&marks.every(m=>panelText.includes(m.text.slice(0,10))),panelText.slice(0,300));
 await page.screenshot({path:'evidence/comments/03-painel.png'});
 // From the panel, go to the commented passage at its place on the page.
 await page.locator('.viewer, .document-viewer, [class*="scroller"]').first().evaluate(el=>el.scrollTop=el.scrollHeight).catch(()=>{});
 await page.waitForTimeout(300);
 await page.locator('.comments-panel .note-card').first().click();await page.waitForTimeout(500);
 const visible=await page.evaluate(()=>{const r=document.querySelector('.page-sheet[data-page="1"] .note-anchor rect')?.getBoundingClientRect();return !!r&&r.top>=0&&r.bottom<=innerHeight;});
 check('clicar no painel leva ao trecho na página',visible);
 const bytes=await app.evaluate(async(_e,id)=>Array.from(await globalThis.__gcpTest.store.materialize(id)),(await ws()).id);
 const doc=await PDFDocument.load(new Uint8Array(bytes));const annots=doc.getPages()[0].node.Annots();const found=[];
 for(let i=0;i<(annots?.size()??0);i++){const d=doc.context.lookup(annots.get(i));if(!(d instanceof PDFDict))continue;const q=d.get(PDFName.of('GCPQuote'));found.push({type:d.get(PDFName.of('Subtype'))?.toString(),quote:q instanceof PDFHexString||q instanceof PDFString?q.decodeText():undefined,anchor:!!d.get(PDFName.of('GCPAnchor'))});}
 check('PDF salvo: nota com trecho e posição; destaque e ondulado',found.some(a=>a.type==='/Text'&&a.quote===note.quote&&a.anchor)&&found.some(a=>a.type==='/Highlight')&&found.some(a=>a.type==='/Squiggly'),JSON.stringify(found));
}finally{if(errors.length)console.log('ERROS:',errors.join(' | '));await app.evaluate(()=>{for(const v of globalThis.__gcpTest.views.values())v.allowClose=true;}).catch(()=>{});await app.close();}
process.exitCode=failed||errors.length?1:0;
