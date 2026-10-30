import { _electron as electron } from 'playwright-core';
import {createRequire} from 'node:module';
import {resolve} from 'node:path';
import {readdir} from 'node:fs/promises';
/** Opens every fiscal XML in .cache/nf (or the folder given) at once and checks a PDF tab per file. */
const require=createRequire(import.meta.url);const folder=resolve(process.argv[2]??'.cache/nf');
const files=(await readdir(folder)).filter(f=>f.endsWith('.xml')).map(f=>resolve(folder,f));
const env={...process.env,GCP_PDF_TEST_MODE:'1',GCP_PDF_DATA_DIR:resolve('.cache/e2e-profile')};delete env.ELECTRON_RUN_AS_NODE;
const app=await electron.launch({executablePath:require('electron'),args:[resolve('.')],cwd:resolve('.'),env,timeout:90000});
const check=(label,ok,detail='')=>console.log(ok?'✔':'✖',label,detail);
try{
 const page=await app.firstWindow();await page.waitForFunction(()=>!!window.gcp);await page.evaluate(()=>localStorage.removeItem('gcp.last-page'));
 const t=Date.now();const error=await page.evaluate(p=>window.gcp.openFiles(p).then(()=>'',e=>String(e)),files);
 const docs=(await page.evaluate(()=>window.gcp.getWorkspace())).documents;
 check(`${files.length} XMLs abertos como PDF`,!error&&docs.length===files.length,error||`${docs.length} abas em ${Date.now()-t} ms`);
 await page.waitForSelector('.page-sheet:not(.loading)');await page.screenshot({path:'evidence/ui/50-xml-fiscal.png'});
 const counts=docs.map(d=>`${d.name.slice(0,18)}:${d.pageCount}p`).join(' | ');check('cada XML virou documento',docs.every(d=>d.pageCount>=1),counts);
}finally{await app.evaluate(()=>{for(const v of globalThis.__gcpTest.views.values())v.allowClose=true;}).catch(()=>{});await app.close();}
