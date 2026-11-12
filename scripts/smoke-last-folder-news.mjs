import { _electron as electron } from 'playwright-core';
import {createRequire} from 'node:module';
import {resolve,dirname} from 'node:path';
import {mkdir,copyFile} from 'node:fs/promises';
/** Abrir arquivos começa na última pasta usada (também depois de reiniciar) e a tela de novidades usa
 * marcas de checklist verdes. O diálogo nativo é substituído por um que registra a pasta inicial. */
const require=createRequire(import.meta.url);
const folderA=resolve('.cache/pasta-a'),folderB=resolve('.cache/pasta-b');
await mkdir(folderA,{recursive:true});await mkdir(folderB,{recursive:true});await mkdir('evidence/news',{recursive:true});
await copyFile(resolve('.cache/pedido.pdf'),resolve(folderA,'a.pdf'));await copyFile(resolve('.cache/pedido.pdf'),resolve(folderB,'b.pdf'));
const env={...process.env,GCP_PDF_TEST_MODE:'1',GCP_PDF_DATA_DIR:resolve('.cache/e2e-profile')};delete env.ELECTRON_RUN_AS_NODE;
let failed=0;const check=(label,ok,detail='')=>{if(!ok)failed++;console.log(ok?'✔':'✖',label,detail);};
const launch=async()=>{const app=await electron.launch({executablePath:require('electron'),args:[resolve('.')],cwd:resolve('.'),env,timeout:90000});const page=await app.firstWindow();await page.waitForFunction(()=>!!window.gcp);
 // Fake Open dialog: answers the queued file and records where the dialog would have started.
 await app.evaluate(({dialog})=>{globalThis.__answers=[];globalThis.__starts=[];dialog.showOpenDialog=async(_w,options)=>{globalThis.__starts.push(options.defaultPath??null);const next=globalThis.__answers.shift();return next?{canceled:false,filePaths:[next]}:{canceled:true,filePaths:[]};};});
 return {app,page};};
const pick=async(app,page,file)=>{await app.evaluate((_e,f)=>globalThis.__answers.push(f),file);await page.evaluate(()=>window.gcp.openFiles());await page.waitForTimeout(800);return app.evaluate(()=>globalThis.__starts.at(-1));};
let {app,page}=await launch();
try{
 await pick(app,page,resolve(folderA,'a.pdf'));
 const second=await pick(app,page,resolve(folderB,'b.pdf'));
 check('segunda abertura começa na pasta da primeira',second===folderA,String(second));
 const third=await pick(app,page,'');
 check('a pasta lembrada passa a ser a da última escolha',third===folderB,String(third));
 // News screen after an update: green checklist marks, no sparkles.
 await app.evaluate(async()=>{await globalThis.__gcpTest.settings.setSeenVersion('0.0.1');});
 await page.reload();await page.waitForSelector('.whats-new li',{timeout:30000});
 const marks=await page.evaluate(()=>[...document.querySelectorAll('.whats-new li svg')].map(s=>({cls:s.getAttribute('class'),color:getComputedStyle(s).color})));
 check('novidades com checklist verde em cada item',marks.length>0&&marks.every(m=>/circle-check|check-circle/.test(m.cls??'')&&/rgb\((33, 134, 100|109, 215, 177)\)/.test(m.color)),JSON.stringify(marks[0]));
 await page.screenshot({path:'evidence/news/novidades-checklist.png'});
}finally{await app.evaluate(()=>{for(const v of globalThis.__gcpTest.views.values())v.allowClose=true;}).catch(()=>{});await app.close().catch(()=>{});}
// After restarting, the dialog still starts in the last folder.
({app,page}=await launch());
try{const start=await pick(app,page,'');check('depois de reiniciar continua na última pasta',start===folderB,String(start));}
finally{await app.evaluate(()=>{for(const v of globalThis.__gcpTest.views.values())v.allowClose=true;}).catch(()=>{});await app.close().catch(()=>{});}
process.exitCode=failed?1:0;
