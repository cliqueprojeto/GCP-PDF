import { _electron as electron } from 'playwright-core';
import {createRequire} from 'node:module';import {resolve} from 'node:path';
/** Original PDF images in Editar: move, resize, right-click rotate, double-click editor. Usage: node scripts/smoke-images.mjs [file.pdf] */
const require=createRequire(import.meta.url);const file=resolve(process.argv[2]??'.cache/mcp/onepage.pdf');
const env={...process.env,GCP_PDF_TEST_MODE:'1',GCP_PDF_DATA_DIR:resolve('.cache/e2e-profile')};delete env.ELECTRON_RUN_AS_NODE;
const app=await electron.launch({executablePath:require('electron'),args:[resolve('.')],cwd:resolve('.'),env,timeout:90000});
const errors=[],check=(label,ok,detail='')=>console.log(ok?'✔':'✖',label,detail);
try{const page=await app.firstWindow();page.on('pageerror',e=>errors.push(e.message));await page.waitForFunction(()=>!!window.gcp);await page.evaluate(()=>localStorage.removeItem('gcp.last-page'));
 await page.evaluate(p=>window.gcp.openFiles([p]),file);await page.waitForSelector('.page-sheet:not(.loading)');
 const ws=async()=>(await page.evaluate(()=>window.gcp.getWorkspace())).documents[0];
 const notices=[];page.on('console',()=>{});
 await page.locator('.ribbon-tabs button',{hasText:'Editar'}).first().click();
 const img=page.locator('.page-sheet[data-page="1"] .source-box.image').last();await img.waitFor({timeout:60000});
 const idle=async()=>{for(let i=0;i<80;i++){if(!(await page.locator('.page-busy').count()))return;await page.waitForTimeout(300);}};
 let b=await img.boundingBox();let rev=(await ws()).revision;
 await page.mouse.move(b.x+b.width/2,b.y+b.height/2);await page.mouse.down();await page.mouse.move(b.x+b.width/2-60,b.y+b.height/2+40,{steps:6});await page.mouse.up();await idle();
 const toast=await page.locator('.toast').textContent().catch(()=>'');check('mover imagem original',(await ws()).revision>rev,toast);
 await page.waitForTimeout(800);const img2=page.locator('.page-sheet[data-page="1"] .source-box.image').last();await img2.click();await page.waitForTimeout(300);
 const h=page.locator('.page-sheet[data-page="1"] .source-box.image.picked .handle.se');check('alças aparecem na imagem selecionada',await h.count()===1);
 b=await h.boundingBox();rev=(await ws()).revision;await page.mouse.move(b.x+3,b.y+3);await page.mouse.down();await page.mouse.move(b.x+50,b.y+30,{steps:5});await page.mouse.up();await idle();
 check('redimensionar imagem original',(await ws()).revision>rev);
 await page.waitForTimeout(800);const img3=page.locator('.page-sheet[data-page="1"] .source-box.image').last();await img3.click({button:'right'});await page.waitForSelector('.image-menu');
 await page.screenshot({path:'evidence/ui/62-menu-imagem.png'});rev=(await ws()).revision;await page.locator('.image-menu button',{hasText:'Girar 90° à direita'}).click();await idle();
 check('girar pelo botão direito',(await ws()).revision>rev);
 await page.waitForTimeout(800);await page.locator('.page-sheet[data-page="1"] .source-box.image').last().dblclick();await page.waitForSelector('.image-editor',{timeout:30000}).catch(()=>{});
 check('duplo clique abre o editor de imagem',await page.locator('.image-editor canvas').count()===1);
 await page.screenshot({path:'evidence/ui/63-editor-imagem-original.png'});
}finally{if(errors.length)console.log('ERROS:',errors.join(' | '));await app.evaluate(()=>{for(const v of globalThis.__gcpTest.views.values())v.allowClose=true;}).catch(()=>{});await app.close();}
