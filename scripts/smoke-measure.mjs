import { _electron as electron } from 'playwright-core';
import {createRequire} from 'node:module';import {resolve} from 'node:path';
/** Measuring tools: distance by drag, area by clicks + double click; labels in cm. */
const require=createRequire(import.meta.url);const file=resolve(process.argv[2]??'.cache/pedido.pdf');
const env={...process.env,GCP_PDF_TEST_MODE:'1',GCP_PDF_DATA_DIR:resolve('.cache/e2e-profile')};delete env.ELECTRON_RUN_AS_NODE;
const app=await electron.launch({executablePath:require('electron'),args:[resolve('.')],cwd:resolve('.'),env,timeout:90000});
const check=(label,ok,detail='')=>console.log(ok?'✔':'✖',label,detail);let PAGE;
try{const page=await app.firstWindow();await page.waitForFunction(()=>!!window.gcp);await page.evaluate(()=>localStorage.removeItem('gcp.last-page'));
 await page.evaluate(p=>window.gcp.openFiles([p]),file);await page.waitForSelector('.page-sheet:not(.loading)');
 const ws=async()=>(await page.evaluate(()=>window.gcp.getWorkspace())).documents[0];
 await page.evaluate(()=>window.dispatchEvent(new Event('resize')));
 await page.locator('.ribbon-tabs button',{hasText:'Comentário'}).first().click();await page.locator('.tool-button',{hasText:'Medir'}).click();
 const zoom=Number((await page.locator('.statusbar .zoom-box input').inputValue()))/100;
 const s=await page.locator('.page-sheet[data-page="1"]').boundingBox();const cm=72/2.54*zoom;
 await page.mouse.move(s.x+100,s.y+200);await page.mouse.down();await page.mouse.move(s.x+100+5*cm,s.y+200,{steps:5});await page.mouse.up();await page.waitForTimeout(500);
 const label=await page.locator('.page-sheet[data-page="1"] svg text').first().textContent();check('distância de 5 cm medida',/^5,0\d cm$|^4,9\d cm$/.test(label??''),label);
 await page.locator('.tool-button.split',{hasText:'Medir'}).locator('xpath=following-sibling::button').click();await page.locator('.dropdown-menu button',{hasText:'Área'}).click();
 const pts=[[0,0],[4,0],[4,3],[0,3]].map(([x,y])=>[s.x+150+x*cm,s.y+230+y*cm]);for(const [x,y] of pts){await page.mouse.click(x,y);await page.waitForTimeout(120);}await page.mouse.dblclick(pts[3][0],pts[3][1]);await page.waitForTimeout(600);
 const texts=await page.locator('.page-sheet[data-page="1"] svg text').allTextContents();check('área de 12 cm² medida',texts.some(t=>/^1[12],\d\d cm²$/.test(t)),texts.join(' | '));
 await page.screenshot({path:'evidence/ui/64-medidas.png'});
 const shapes=(await ws()).objects.filter(o=>o.kind==='shape'&&o.measure);check('medidas são objetos do documento',shapes.length===2,shapes.map(o=>o.measure).join(','));
}finally{await app.evaluate(()=>{for(const v of globalThis.__gcpTest.views.values())v.allowClose=true;}).catch(()=>{});await app.close();}
