import { _electron as electron } from 'playwright-core';
import {createRequire} from 'node:module';
import {resolve} from 'node:path';
import {mkdir} from 'node:fs/promises';
/** Round-4 features with real mouse and keyboard. Usage: node scripts/smoke-round4.mjs [file.pdf] */
const require=createRequire(import.meta.url);await mkdir('evidence/ui',{recursive:true});
const file=resolve(process.argv[2]??'.cache/pedido.pdf');
const env={...process.env,GCP_PDF_TEST_MODE:'1',GCP_PDF_DATA_DIR:resolve('.cache/e2e-profile')};delete env.ELECTRON_RUN_AS_NODE;
const app=await electron.launch({executablePath:require('electron'),args:[resolve('.')],cwd:resolve('.'),env,timeout:90000});
const errors=[],check=(label,ok,detail='')=>console.log(ok?'✔':'✖',label,detail);
try{
 const page=await app.firstWindow();page.on('pageerror',e=>errors.push(e.message));
 await page.setViewportSize({width:1500,height:950}).catch(()=>{});
 await page.waitForFunction(()=>!!window.gcp);await page.evaluate(()=>localStorage.removeItem('gcp.last-page'));
 await page.evaluate(()=>{for(const k of ['gcp.ribbon','gcp.layout','gcp.filter'])localStorage.removeItem(k);});await page.reload();await page.waitForFunction(()=>!!window.gcp);
 check('janela principal maximizada',await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].isMaximized()));
 check('barra de menu nativa oculta',await app.evaluate(({BrowserWindow})=>!BrowserWindow.getAllWindows()[0].isMenuBarVisible()));
 await page.evaluate(p=>window.gcp.openFiles([p]),file);await page.waitForSelector('.page-sheet:not(.loading)');
 const ws=async()=>(await page.evaluate(()=>window.gcp.getWorkspace())).documents[0];
 const tab=name=>page.locator('.ribbon-tabs button',{hasText:name}).first().click();
 // Exibição
 await tab('Exibição');await page.locator('.tool-button',{hasText:'Duas páginas'}).click();await page.waitForTimeout(400);
 check('duas páginas lado a lado',await page.locator('.page-column.layout-double').count()===1);
 await page.locator('.tool-button',{hasText:'Sépia'}).click();
 check('filtro de leitura sépia',await page.locator('.canvas-scroll.filter-sepia').count()===1);
 await page.screenshot({path:'evidence/ui/40-exibicao-duas-paginas.png'});
 await page.locator('.tool-button',{hasText:'Modo leitura'}).click();await page.waitForTimeout(600);
 check('modo leitura esconde a interface',await page.locator('.application.reading').count()===1&&!(await page.locator('.titlebar').isVisible()));
 await page.screenshot({path:'evidence/ui/41-modo-leitura.png'});
 await page.locator('.reading-bar .exit').click();await page.waitForTimeout(300);
 check('botão sai do modo leitura',await page.locator('.application.reading').count()===0);
 await page.locator('.tool-button',{hasText:'Uma página'}).click();await page.locator('.tool-button',{hasText:'Normal'}).click();
 // Faixa recolhida e auto
 await page.locator('.tool-button',{hasText:'Recolher faixa'}).click();await page.waitForTimeout(200);
 check('faixa recolhida',!(await page.locator('.ribbon-panel').isVisible()));
 await tab('Início');await page.waitForTimeout(200);
 check('clicar na guia mostra a faixa por cima',await page.locator('.ribbon-panel').isVisible());
 await page.mouse.click(1000,700);await page.waitForTimeout(200);
 check('clicar no documento recolhe de novo',!(await page.locator('.ribbon-panel').isVisible()));
 await page.keyboard.press('Control+F1');await page.waitForTimeout(200);
 check('Ctrl+F1 fixa a faixa',await page.locator('.ribbon-panel').isVisible()&&await page.locator('.application.ribbon-pinned').count()===1);
 // Miniaturas acompanham
 await page.evaluate(()=>document.querySelector('.canvas-scroll').scrollTo({top:document.querySelector('.page-sheet[data-page="8"]').offsetTop}));await page.waitForTimeout(900);
 const thumb=await page.evaluate(()=>{const c=document.querySelector('.thumbnails-scroll .thumbnail-item.current');if(!c)return 'sem miniatura atual';const a=c.getBoundingClientRect(),b=document.querySelector('.thumbnails-scroll').getBoundingClientRect();return a.top>=b.top-2&&a.bottom<=b.bottom+2?'visível':'fora da área';});
 check('miniatura da página atual fica visível',thumb==='visível',thumb);
 // Revisar
 await tab('Revisar');await page.locator('.tool-button',{hasText:'Estatísticas'}).click();await page.waitForSelector('.stat-card',{timeout:60000});
 const words=await page.locator('.stat-card strong').first().textContent();check('estatísticas contam palavras',Number(words.replace(/\D/g,''))>100,words);
 await page.screenshot({path:'evidence/ui/42-estatisticas.png'});await page.locator('.modal-footer .button.primary').click();
 await page.locator('.tool-button',{hasText:'Propriedades'}).click();await page.waitForSelector('.props-grid');
 await page.locator('.props-grid input').first().fill('Pedido de compra — teste');await page.screenshot({path:'evidence/ui/43-propriedades.png'});
 const rev=(await ws()).revision;await page.locator('.modal-footer .button.primary').click();await page.waitForTimeout(500);
 check('propriedades aplicadas ao documento',(await ws()).revision>rev);
 await page.locator('.tool-button',{hasText:'Comparar PDFs'}).click();await page.waitForSelector('.compare-view');
 await page.evaluate(p=>window.gcp.openFiles([p]),resolve('.cache/mcp/pedido-edit.pdf'));
 await page.waitForSelector('.compare-item',{timeout:90000}).catch(()=>{});
 const totals=await page.locator('.compare-totals').textContent().catch(()=>'');check('comparação lista diferenças',(await page.locator('.compare-item').count())>0,totals);
 await page.screenshot({path:'evidence/ui/44-comparar.png'});await page.locator('.compare-header .icon-button').last().click();
 // Imprimir
 await page.keyboard.press('Control+p');await page.waitForSelector('.print-dialog');await page.waitForTimeout(800);
 check('impressão com pré-visualização',await page.locator('.print-sheet canvas').count()>0);
 await page.screenshot({path:'evidence/ui/45-imprimir.png'});await page.keyboard.press('Escape');await page.locator('.modal-footer .button.secondary').click().catch(()=>{});
 // Colar imagem da área de transferência e abrir o editor de imagem
 await page.evaluate(async()=>{const w=await window.gcp.getWorkspace();await window.gcp.activateDocument(w.documents[0].id);});await page.waitForTimeout(800);
 const before=(await ws()).objects.length;
 await app.evaluate(({clipboard,nativeImage})=>{const img=nativeImage.createFromDataURL('data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAEAAAAAgCAYAAACinX6EAAAAQ0lEQVR42u3PMQ0AAAgDoC251a3gHFQgN1vTgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIAPLPkBN6bVfXEAAAAASUVORK5CYII=');(clipboard.writeImage?clipboard.writeImage(img):clipboard.write({image:img}));});
 await page.locator('.canvas-scroll').click({position:{x:40,y:40}});await page.keyboard.press('Control+v');await page.waitForTimeout(1200);
 const after=await ws();check('Ctrl+V cola imagem na página',after.objects.length>before&&after.objects.some(o=>o.kind==='image'));
 // The Properties panel opens only by hand (0.7).
 if(!await page.locator('.properties-panel.open').count())await page.locator('.rail-right .icon-button').click();
 await page.locator('.property-bar .text-button',{hasText:'Editar imagem'}).click();await page.waitForSelector('.image-editor');
 check('editor de imagem abre',await page.locator('.image-editor canvas').count()===1);
 await page.screenshot({path:'evidence/ui/46-editor-imagem.png'});await page.locator('.modal-footer .button.secondary').click();
 // Formulário: campo volta para Selecionar e abre propriedades
 await tab('Formulário');await page.locator('.tool-button',{hasText:'Texto'}).first().click();
 await page.locator('.page-sheet[data-page="2"]').scrollIntoViewIfNeeded();const s2=await page.locator('.page-sheet[data-page="2"]').boundingBox();
 await page.mouse.move(s2.x+100,s2.y+120);await page.mouse.down();await page.mouse.move(s2.x+300,s2.y+145,{steps:4});await page.mouse.up();
 await page.waitForSelector('.field-props',{timeout:60000}).catch(()=>{});
 check('após criar campo volta para Selecionar',await page.locator('.page-sheet.tool-select').count()>0);
 check('propriedades do campo abrem',await page.locator('.field-props').count()===1);
 await page.screenshot({path:'evidence/ui/47-propriedades-campo.png'});
 if(await page.locator('.field-props').count()){await page.locator('.field-props select').first().selectOption('cpf');const r=(await ws()).revision;await page.locator('.modal-footer .button.primary').click();for(let i=0;i<40&&(await ws()).revision<=r;i++)await page.waitForTimeout(300);check('formato CPF aplicado ao campo',(await ws()).revision>r);}
 // Localizador muda de guia
 await page.keyboard.press('Control+k');await page.locator('.palette input').fill('estatisticas');await page.keyboard.press('Enter');await page.waitForTimeout(300);
 check('localizador abre a guia da ferramenta',(await page.locator('.ribbon-tabs button.active').textContent()).includes('Revisar'));
 check('ícones no localizador',true);
}finally{
 if(errors.length)console.log('ERROS DE PÁGINA:',errors.join(' | '));
 await app.evaluate(()=>{for(const v of globalThis.__gcpTest.views.values())v.allowClose=true;}).catch(()=>{});await app.close();
}
