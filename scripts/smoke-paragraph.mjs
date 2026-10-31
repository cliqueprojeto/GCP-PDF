import { _electron as electron } from 'playwright-core';
import {createRequire} from 'node:module';
import {resolve} from 'node:path';
import {mkdir} from 'node:fs/promises';
/** In-place paragraph editing with real mouse and keyboard. Usage: node scripts/smoke-paragraph.mjs file.pdf [page] */
const require=createRequire(import.meta.url);await mkdir('evidence/ui',{recursive:true});
const file=resolve(process.argv[2]),pageNo=process.argv[3]??'3';
const env={...process.env,GCP_PDF_TEST_MODE:'1',GCP_PDF_DATA_DIR:resolve('.cache/e2e-profile')};delete env.ELECTRON_RUN_AS_NODE;
const app=await electron.launch({executablePath:require('electron'),args:[resolve('.')],cwd:resolve('.'),env,timeout:90000});
const errors=[],check=(label,ok,detail='')=>console.log(ok?'✔':'✖',label,detail);
try{
 const page=await app.firstWindow();page.on('pageerror',e=>errors.push(e.message));
 await page.setViewportSize({width:1500,height:950}).catch(()=>{});
 await page.waitForFunction(()=>!!window.gcp);await page.evaluate(()=>localStorage.removeItem('gcp.last-page'));
 await page.evaluate(p=>window.gcp.openFiles([p]),file);await page.waitForSelector('.page-sheet:not(.loading)');
 const ws=async()=>(await page.evaluate(()=>window.gcp.getWorkspace())).documents[0];
 await page.locator('.ribbon-tabs button',{hasText:'Editar'}).first().click();
 const sheet=page.locator(`.page-sheet[data-page="${pageNo}"]`);await sheet.scrollIntoViewIfNeeded();
 const box=sheet.locator('.source-box.text').nth(2);await box.waitFor({timeout:60000});await box.scrollIntoViewIfNeeded();
 check('aba Editar abre o modo de edição',await page.locator('.page-sheet.tool-edit').count()>0);
 const b=await box.boundingBox();await page.mouse.click(b.x+b.width*0.45,b.y+8);await page.waitForTimeout(500);
 await page.screenshot({path:'evidence/ui/30-paragrafo-aberto.png'});
 const focused=await page.evaluate(()=>document.activeElement?.className??'');check('editor recebe o foco',focused.includes('source-editor'),focused);
 const fonts=await page.evaluate(()=>[...document.querySelectorAll('.source-editor span')].slice(0,3).map(s=>getComputedStyle(s).fontFamily));check('usa as fontes do próprio PDF',fonts.length>0&&fonts.every(f=>/g_d\d+_f\d+/.test(f)),fonts.join(' | '));
 const before=(await ws()).revision;
 await page.keyboard.type(' muito querida');await page.waitForTimeout(200);
 await page.screenshot({path:'evidence/ui/31-paragrafo-digitando.png'});
 await page.keyboard.press('Control+Enter');
 for(let i=0;i<60&&(await ws()).revision<=before;i++)await page.waitForTimeout(500);
 check('edição aplicada no PDF',(await ws()).revision>before);
 await page.waitForTimeout(1500);await page.screenshot({path:'evidence/ui/32-paragrafo-aplicado.png'});
 // Font change from the formatting bar while editing keeps the editor and applies text + font together.
 await page.waitForTimeout(1500);const box2=sheet.locator('.source-box.text').nth(1);await box2.click();await page.waitForTimeout(400);
 await page.keyboard.type(' teste');const rev2=(await ws()).revision;
 // The Properties panel opens only by hand (0.7).
 if(!await page.locator('.properties-panel.open').count())await page.locator('.rail-right .icon-button').click();
 await page.locator('.property-bar select').first().selectOption('times');
 for(let i=0;i<60&&(await ws()).revision<=rev2;i++)await page.waitForTimeout(500);
 const bar=await page.locator('.property-bar').textContent().catch(()=>'');
 check('trocar a fonte durante a edição aplica texto e fonte',(await ws()).revision>rev2,bar?.slice(0,40));
 await page.locator('.ribbon-tabs button',{hasText:'Início'}).first().click();
 check('sair da aba Editar encerra a edição',await page.locator('.page-sheet.tool-edit').count()===0);
}finally{
 if(errors.length)console.log('ERROS DE PÁGINA:',errors.join(' | '));
 await app.evaluate(()=>{for(const v of globalThis.__gcpTest.views.values())v.allowClose=true;}).catch(()=>{});await app.close();
}
