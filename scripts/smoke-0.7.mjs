import {_electron as electron} from 'playwright-core';
import {createRequire} from 'node:module';
import {resolve} from 'node:path';
import {mkdir,writeFile,readFile,rm} from 'node:fs/promises';
import {existsSync} from 'node:fs';
import {PDFDocument,StandardFonts,setCharacterSpacing} from 'pdf-lib';
/** Version 0.7 with real mouse and keyboard: letter spacing in the editor, saved colours, stamps with the
 * stamped effect, copy/paste/duplicate of shapes, the manual Properties panel, synonyms and translation,
 * direct highlighting, PDF → EPUB and the book reader. Usage: node scripts/smoke-0.7.mjs [tracked.pdf] */
const require=createRequire(import.meta.url),root=resolve('.cache/smoke-0.7');
await rm(root,{recursive:true,force:true});await mkdir(root,{recursive:true});await mkdir('evidence/0.7',{recursive:true});
const pdf=await PDFDocument.create(),font=await pdf.embedFont(StandardFonts.Helvetica),bold=await pdf.embedFont(StandardFonts.HelveticaBold);
const first=pdf.addPage([595,842]);
first.pushOperators(setCharacterSpacing(2.5));first.drawText('PRESTACAO DE CONTAS',{x:60,y:780,size:12,font:bold});first.pushOperators(setCharacterSpacing(0));
first.drawText('Capitulo Um',{x:60,y:720,size:26,font:bold});
for(let i=0;i<12;i++)first.drawText('A casa grande fica perto do rio e recebe visitas todos os dias da semana.',{x:60,y:680-i*16,size:11,font});
const second=pdf.addPage([595,842]);second.drawText('Capitulo Dois',{x:60,y:760,size:26,font:bold});
for(let i=0;i<12;i++)second.drawText('Outro texto corrido para o segundo capitulo do livro de teste.',{x:60,y:720-i*16,size:11,font});
const file=resolve(root,'teste.pdf');await writeFile(file,await pdf.save());
const tracked=process.argv[2]?resolve(process.argv[2]):undefined;
const env={...process.env,GCP_PDF_TEST_MODE:'1',GCP_PDF_DATA_DIR:resolve(root,'profile')};delete env.ELECTRON_RUN_AS_NODE;
const app=await electron.launch({executablePath:require('electron'),args:[resolve('.')],env,timeout:90000}),errors=[];
let failed=0;const check=(label,ok,detail='')=>{if(!ok)failed++;console.log(ok?'✔':'✖',label,detail);};
try{
 const page=await app.firstWindow();page.on('pageerror',e=>errors.push(e.message));
 await page.setViewportSize({width:1500,height:950}).catch(()=>{});
 await page.waitForFunction(()=>!!window.gcp);
 await page.evaluate(file=>window.gcp.openFiles([file]),file);await page.waitForSelector('.page-sheet:not(.loading)');
 // Evidence only: Playwright sometimes waits forever for a frame of the sandboxed book iframe, so fall
 // back to Electron's own capture.
 const shot=async path=>{try{await page.screenshot({path,timeout:10000});}catch{const png=await app.evaluate(async({BrowserWindow})=>(await BrowserWindow.getAllWindows()[0].webContents.capturePage()).toPNG().toString('base64'));await writeFile(path,Buffer.from(png,'base64'));}};
 const ws=async()=>(await page.evaluate(()=>window.gcp.getWorkspace())).documents.at(-1);
 const tab=async label=>page.locator('.ribbon-tabs button').filter({hasText:label}).first().click();
 const sheet=page.locator('.page-sheet').first();

 // 1. Letter spacing: the tracked line opens with its spacing and real words, and keeps it when applied.
 await tab('Editar');
 const head=sheet.locator('.source-box.text').first();await head.waitFor({timeout:60000});
 const hb=await head.boundingBox();await page.mouse.click(hb.x+40,hb.y+8);
 await page.waitForSelector('.source-editor');
 const firstLine=page.locator('.source-editor-content > div').first().locator('span').first();await firstLine.waitFor();
 const lb=await firstLine.boundingBox();await page.mouse.click(lb.x+lb.width-1,lb.y+lb.height/2);
 const spacing=await page.evaluate(()=>{const line=document.querySelector('.source-editor-content > div');const s=line?.querySelector('span');return {text:line?.textContent,ls:s?getComputedStyle(s).letterSpacing:'',data:line?.getAttribute('data-tracking')};});
 check('editor mostra o texto real com o espaçamento entre letras',spacing.text?.trim()==='PRESTACAO DE CONTAS'&&parseFloat(spacing.ls)>2,JSON.stringify(spacing));
 const before=(await ws()).revision;await page.keyboard.type(' II');await page.keyboard.press('Control+Enter');
 for(let i=0;i<60&&(await ws()).revision<=before;i++)await page.waitForTimeout(250);
 check('edição aplicada no PDF',(await ws()).revision>before);
 await page.waitForTimeout(800);await shot('evidence/0.7/01-espacamento.png');
 const reread=await page.evaluate(async()=>{const d=(await window.gcp.getWorkspace()).documents.at(-1);const o=await window.gcp.getSourceObjects(d.id,d.pages[0].id);const head=o.spacing?.find(t=>/PRESTA/.test(t.text));return head&&{tracking:head.tracking,text:o.spacing.filter(t=>Math.abs(t.baseline-head.baseline)<1).sort((a,b)=>a.x-b.x).map(t=>t.text).join(' ')};});
 check('o PDF editado continua com o espaçamento na linha editada',!!reread&&reread.tracking>2&&/PRESTACAO II DE CONTAS/.test(reread.text),JSON.stringify(reread));
 await tab('Início');

 // 5. Properties panel: closed by default, signals options, opens and closes only by hand.
 const panelOpen=()=>page.locator('.properties-panel.open').count();
 check('Propriedades não abre sozinho',await panelOpen()===0);
 await page.locator('.tool-button[title="Formas"]').click();
 check('botão sinaliza que há propriedades',await page.locator('.rail-right .properties-signal').count()===1);
 const box=await sheet.boundingBox();
 await page.mouse.move(box.x+150,box.y+420);await page.mouse.down();await page.mouse.move(box.x+300,box.y+520,{steps:6});await page.mouse.up();
 await page.waitForFunction(()=>document.querySelectorAll('.object-hit').length>=1);
 check('desenhar não abre o painel',await panelOpen()===0);
 const shapeBefore=await sheet.boundingBox();await page.locator('.rail-right .icon-button').click();await page.waitForTimeout(400);
 const shapeAfter=await sheet.boundingBox();
 check('abrir o painel não empurra a página',await panelOpen()===1&&Math.abs(shapeAfter.x-shapeBefore.x)<1,`${shapeBefore.x}→${shapeAfter.x}`);

 // 2. Saved colours.
 const save=page.locator('.properties-panel .save-color').first();
 await page.locator('.properties-panel .swatch[title="#ef4444"], .properties-panel .swatches .swatch').nth(3).click().catch(()=>{});
 await page.evaluate(()=>window.gcp.setSavedColors([]));await page.reload();await page.waitForSelector('.page-sheet:not(.loading)');
 await page.evaluate(()=>window.gcp.setSavedColors(['#123456']));
 const colors=await page.evaluate(()=>window.gcp.getSavedColors());
 check('cores salvas ficam no banco local',colors.includes('#123456'),colors.join());
 void save;

 // 4. Copy, paste and duplicate shapes (keyboard and right click).
 const count=async()=>(await ws()).objects.length;
 await page.locator('.rail-right .icon-button').click().catch(()=>{});
 await page.locator('.tool-button[title="Formas"]').click();
 await page.mouse.move(box.x+150,box.y+420);await page.mouse.down();await page.mouse.move(box.x+300,box.y+520,{steps:6});await page.mouse.up();
 await page.waitForFunction(()=>document.querySelectorAll('.object-hit').length>=1);
 const n0=await count();
 await page.locator('.object-hit').last().click({force:true});
 await page.keyboard.press('Control+d');for(let i=0;i<20&&await count()===n0;i++)await page.waitForTimeout(150);
 check('Ctrl+D duplica a forma',await count()===n0+1,`${n0}→${await count()}`);
 await page.keyboard.press('Control+c');await page.waitForTimeout(150);await page.keyboard.press('Control+v');for(let i=0;i<20&&await count()===n0+1;i++)await page.waitForTimeout(150);
 check('Ctrl+C / Ctrl+V cola a forma',await count()===n0+2,`${await count()}`);
 const hit=await page.locator('.object-hit.selected').last().boundingBox();await page.mouse.click(hit.x+hit.width/2,hit.y+hit.height/2,{button:'right'});
 const menu=await page.locator('.context-menu').innerText().catch(()=>'');
 check('botão direito oferece Copiar, Recortar, Duplicar, Colar',/Copiar/.test(menu)&&/Duplicar/.test(menu)&&/Colar/.test(menu),menu.replace(/\s+/g,' '));
 await page.locator('.context-menu button').filter({hasText:'Duplicar'}).click();for(let i=0;i<20&&await count()===n0+2;i++)await page.waitForTimeout(150);
 check('Duplicar pelo menu',await count()===n0+3);
 await shot('evidence/0.7/02-formas.png');

 // 7. Highlight acts on selection release and stays active.
 await page.keyboard.press('Escape');await tab('Comentário');
 await page.locator('.tool-button').filter({hasText:'Destacar'}).first().click();
 const span=sheet.locator('.textLayer span').filter({hasText:'casa grande'}).first();const sb=await span.boundingBox();
 const marks=async()=>(await ws()).objects.filter(o=>o.kind==='markup').length,m0=await marks();
 await page.mouse.move(sb.x+2,sb.y+sb.height/2);await page.mouse.down();await page.mouse.move(sb.x+sb.width*0.4,sb.y+sb.height/2,{steps:8});await page.mouse.up();
 for(let i=0;i<20&&await marks()===m0;i++)await page.waitForTimeout(150);
 check('destaque aplicado ao soltar a seleção',await marks()===m0+1);
 check('ferramenta Destacar continua ativa',await page.locator('.page-sheet.tool-markup').count()>0);
 await page.keyboard.press('Escape');await shot('evidence/0.7/03-destaque.png');

 // 6. Synonyms and translation from the right click on selected text.
 const sb2=await sheet.locator('.textLayer span').filter({hasText:'casa grande'}).nth(1).boundingBox();
 await page.mouse.dblclick(sb2.x+sb2.width*0.08,sb2.y+sb2.height/2);await page.waitForTimeout(150);
 const selected=await page.evaluate(()=>window.getSelection()?.toString());
 await page.mouse.click(sb2.x+sb2.width*0.08,sb2.y+sb2.height/2,{button:'right'});
 await page.locator('.context-menu button').filter({hasText:'Sinônimos'}).click();
 await page.waitForSelector('.lookup .chip',{timeout:20000}).catch(()=>{});
 const chips=await page.locator('.lookup .chip').count();
 check('sinônimos pelo botão direito',chips>0,`seleção "${selected}" → ${chips} sinônimos`);
 await shot('evidence/0.7/04-sinonimos.png');
 await page.locator('.lookup-modes button').filter({hasText:'Tradução'}).click();
 await page.waitForTimeout(800);const translated=await page.locator('.lookup-results').innerText();
 check('tradução no mesmo diálogo',/Inglês|Espanhol/.test(translated)&&(await page.locator('.lookup .chip').count())>0,translated.slice(0,80).replace(/\s+/g,' '));
 await page.keyboard.press('Escape');

 // 3. Stamps: solid at 100% and the stamped effect.
 await page.evaluate(()=>{});await tab('Comentário');await page.locator('.tool-button').filter({hasText:'Carimbos'}).first().click();
 await page.waitForSelector('.stamps');
 const solid=await page.evaluate(()=>{const img=document.querySelector('.stamp-stage img');return decodeURIComponent(img?.getAttribute('src')??'');});
 check('carimbo de Situação com fundo sólido',/fill="#[0-9a-f]{6}" stroke/.test(solid)&&!/fill="#[0-9a-f]{6}14"/.test(solid));
 await page.locator('.stamp-effect input[type=range]').fill('70');
 await page.waitForFunction(()=>document.querySelector('.stamp-stage img')?.getAttribute('src')?.startsWith('data:image/png'),null,{timeout:10000}).catch(()=>{});
 check('Efeito batido gera a prévia',await page.evaluate(()=>document.querySelector('.stamp-stage img')?.getAttribute('src')?.startsWith('data:image/png')));
 await shot('evidence/0.7/05-carimbo-batido.png');
 await page.keyboard.press('Escape');

 // 8. PDF → EPUB and the reader.
 await tab('Converter');await page.locator('.tool-button').filter({hasText:'Para EPUB'}).click();
 await page.waitForSelector('.epub-dialog',{timeout:60000});
 const chapters=await page.locator('.epub-chapter input[aria-label]').evaluateAll(n=>n.map(i=>i.value));
 check('capítulos automáticos',chapters.includes('Capitulo Um')&&chapters.includes('Capitulo Dois'),chapters.join(' | '));
 await page.locator('.epub-meta input').nth(1).fill('Ana Teste');
 await shot('evidence/0.7/06-epub-dialogo.png');
 const target=resolve(root,'livro.epub');
 await app.evaluate(({dialog},target)=>{dialog.showSaveDialog=async()=>({canceled:false,filePath:target});},target);
 await page.locator('.modal-footer button').filter({hasText:'Gerar EPUB'}).click();
 await page.waitForSelector('.book-reader iframe',{timeout:60000});
 check('EPUB salvo e aberto no modo Livro',existsSync(target)&&(await readFile(target)).subarray(30,38).toString()==='mimetype');
 await page.waitForTimeout(1200);
 const progress=async()=>page.locator('.book-progress').innerText();
 const p1=await progress();await page.keyboard.press('ArrowRight');await page.waitForTimeout(900);const p2=await progress();
 check('passar a página',p1!==p2,`${p1.replace(/\s+/g,' ')} → ${p2.replace(/\s+/g,' ')}`);
 await page.locator('.book-bar button[title^="Fonte"]').click();await page.locator('.book-type select').nth(2).selectOption('virar');
 await page.locator('.book-themes button').filter({hasText:'Sépia'}).click();
 await page.locator('.book-bar button[title^="Fonte"]').click();await page.waitForTimeout(600);
 await shot('evidence/0.7/07-leitor.png');
 await page.keyboard.press('Escape');
 await page.evaluate(path=>window.gcp.openBookFile(path),target);await page.waitForSelector('.book-reader iframe');await page.waitForTimeout(1200);
 check('retoma de onde parou',await progress()===p2,(await progress()).replace(/\s+/g,' '));
 await page.keyboard.press('Escape');

 if(tracked){
  await page.evaluate(file=>window.gcp.openFiles([file]),tracked);await page.waitForTimeout(2500);
  await tab('Editar');const h=page.locator('.page-sheet').first().locator('.source-box.text').first();await h.waitFor({timeout:60000});
  const b=await h.boundingBox();await page.mouse.click(b.x+b.width-4,b.y+b.height/2);await page.waitForSelector('.source-editor');
  await shot('evidence/0.7/08-pdf-do-usuario.png');
  const real=await page.evaluate(()=>({text:document.querySelector('.source-editor-content')?.textContent,ls:getComputedStyle(document.querySelector('.source-editor span')).letterSpacing}));
  check('PDF do usuário: título espaçado abre sem espaços inventados',!/P R E S/.test(real.text??'')&&parseFloat(real.ls)>1,JSON.stringify(real));
  await page.keyboard.press('Escape');
 }
 check('sem erros na interface',errors.length===0,errors.join(' | '));
}catch(error){failed++;console.log('✖ erro',error.message.split(String.fromCharCode(10))[0]);}finally{
 await app.evaluate(()=>{for(const view of globalThis.__gcpTest?.views?.values()??[])view.allowClose=true;}).catch(()=>{});await app.close();
}
console.log(failed?`FALHOU: ${failed}`:'PASS');process.exitCode=failed?1:0;
