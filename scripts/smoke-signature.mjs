import { _electron as electron } from 'playwright-core';
import {createRequire} from 'node:module';import {resolve} from 'node:path';
import {readFile,rm} from 'node:fs/promises';
/** Signed PDFs stay byte-identical: verification uses the signed bytes, saving never rewrites them.
 * Usage: node scripts/smoke-signature.mjs signed.pdf */
const require=createRequire(import.meta.url);const file=resolve(process.argv[2]??'.cache/mcp/ped-assinado.pdf');
const expected=process.argv[3]??'valid';
const copy=resolve('.cache',`signature-smoke-copy-${process.pid}-${Date.now()}.pdf`);
const env={...process.env,GCP_PDF_TEST_MODE:'1',GCP_PDF_DATA_DIR:resolve(process.env.GCP_PDF_SMOKE_PROFILE??'.cache/e2e-signature-profile')};delete env.ELECTRON_RUN_AS_NODE;
const app=await electron.launch({executablePath:require('electron'),args:[resolve('.')],cwd:resolve('.'),env,timeout:90000});
const check=(label,ok,detail='')=>{console.log(ok?'✔':'✖',label,detail);if(!ok)throw new Error(label+': '+detail);};
try{const page=await app.firstWindow();await page.waitForFunction(()=>!!window.gcp);await page.evaluate(()=>localStorage.removeItem('gcp.last-page'));
 await page.evaluate(p=>window.gcp.openFiles([p]),file);await page.waitForSelector('.page-sheet:not(.loading)');
 const id=(await page.evaluate(()=>window.gcp.getWorkspace())).documents[0].id;
 const original=new Uint8Array(await readFile(file));
 const bytes=new Uint8Array(await app.evaluate(async(_e,id)=>Array.from(await globalThis.__gcpTest.store.materialize(id)),id));
 check('PDF assinado aberto continua idêntico ao arquivo',bytes.length===original.length&&bytes.every((b,i)=>b===original[i]),`${bytes.length} / ${original.length} bytes`);
 const sig=await page.evaluate(id=>window.gcp.checkSignatures(id),id);
 check('verificação corresponde ao estado esperado '+expected,sig.length>0&&sig.every(s=>s.status===expected),JSON.stringify(sig.map(s=>[s.status,s.explanation])));
 await page.evaluate(id=>window.gcp.saveDocument(id),id);
 check('salvar sem editar preserva cada byte',Buffer.from(await readFile(file)).equals(Buffer.from(original)));
 // A comment changes the displayed revision; never label that revision as the signed original.
 await page.evaluate(async id=>{const d=(await window.gcp.getWorkspace()).documents[0];await window.gcp.applyOperation(id,{type:'add-object',object:{id:'n1',page:d.pages[0].id,kind:'note',x:20,y:20,width:22,height:22,text:'oi',author:'T',createdAt:new Date().toISOString(),color:'#ffd43b',replies:[]}},d.revision);},id);
 const sig2=await page.evaluate(id=>window.gcp.checkSignatures(id),id);check('alteração não salva é explicitamente sinalizada',sig2.length>0&&sig2.every(s=>s.status==='modified'&&/não salvas/.test(s.explanation)),sig2.map(s=>s.status).join(','));
 const saving=page.evaluate(id=>window.gcp.saveDocument(id),id);await page.waitForSelector('.prompt-card',{timeout:15000}).catch(()=>{});
 const prompt=await page.locator('.prompt-card').textContent().catch(()=>'');check('salvar alteração em PDF assinado pede cópia',/invalida a assinatura/.test(prompt??''),(prompt??'').slice(0,80));
 await page.locator('.prompt-card button',{hasText:'Cancelar'}).click().catch(()=>{});await saving.catch(()=>{});
 // Even Save as must refuse choosing the signed original again after the warning.
 await app.evaluate(({dialog},path)=>{dialog.showSaveDialog=async()=>({canceled:false,filePath:path});},file);
 const exportError=await page.evaluate(id=>window.gcp.exportDocument(id,{format:'pdf'}).then(()=>'',e=>String(e)),id);
 check('exportar PDF editado recusa sobrescrever a origem assinada',/não pode ser sobrescrito/.test(exportError)&&Buffer.from(await readFile(file)).equals(Buffer.from(original)));
 const blocked=page.evaluate(id=>window.gcp.saveDocument(id,true).then(()=>'',e=>String(e)),id);
 await page.waitForSelector('.prompt-card');await page.locator('.prompt-card button',{hasText:'Salvar como cópia'}).click();
 check('Salvar como recusa o mesmo caminho assinado',/não pode ser sobrescrito/.test(await blocked));
 await app.evaluate(({dialog},path)=>{dialog.showSaveDialog=async()=>({canceled:false,filePath:path});},copy);
 const copying=page.evaluate(id=>window.gcp.saveDocument(id,true),id);
 await page.waitForSelector('.prompt-card');await page.locator('.prompt-card button',{hasText:'Salvar como cópia'}).click();
 check('cópia modificada recebe outro caminho',await copying===copy);
 await page.evaluate(async id=>{const d=(await window.gcp.getWorkspace()).documents.find(d=>d.id===id);await window.gcp.applyOperation(id,{type:'rotate',pages:[0],degrees:90},d.revision);},id);
 check('cópia pode ser salva normalmente após nova edição',await page.evaluate(id=>window.gcp.saveDocument(id),id)===copy);
 await app.evaluate(({dialog},path)=>{dialog.showSaveDialog=async()=>({canceled:false,filePath:path});},file);
 const returnError=await page.evaluate(id=>window.gcp.saveDocument(id,true).then(()=>'',e=>String(e)),id);
 check('cópia salva não pode sobrescrever a origem assinada',/não pode ser sobrescrito/.test(returnError));
 const after=new Uint8Array(await readFile(file));check('arquivo assinado no disco não foi alterado',after.length===original.length&&after.every((b,i)=>b===original[i]));
}finally{await app.evaluate(()=>{for(const v of globalThis.__gcpTest.views.values())v.allowClose=true;}).catch(()=>{});await app.close();await rm(copy,{force:true});}
