import { _electron as electron } from 'playwright-core';
import {createRequire} from 'node:module';
import {resolve} from 'node:path';
import {existsSync} from 'node:fs';
import {mkdir,readFile,rm} from 'node:fs/promises';
/** Forms, organizer, numbering and compression on real files. Usage: node scripts/smoke-forms.mjs [form.pdf] */
const require=createRequire(import.meta.url);await mkdir('evidence/ui',{recursive:true});
const form=resolve(process.argv[2]??'.cache/xfa.pdf');if(!existsSync(form))throw new Error('Informe um PDF de formulário.');
const env={...process.env,GCP_PDF_TEST_MODE:'1',GCP_PDF_DATA_DIR:resolve('.cache/e2e-profile')};delete env.ELECTRON_RUN_AS_NODE;
const app=await electron.launch({executablePath:require('electron'),args:[resolve('.')],cwd:resolve('.'),env,timeout:90000});
const logs=[];app.process().stderr.on('data',d=>logs.push(String(d)));
try{
 const page=await app.firstWindow();page.on('pageerror',e=>logs.push('PAGE ERROR '+e.message));
 await page.setViewportSize({width:1500,height:950}).catch(()=>{});
 await page.waitForFunction(()=>!!window.gcp);await page.evaluate(()=>localStorage.removeItem('gcp.last-page'));
 await page.evaluate(p=>window.gcp.openFiles([p]),form);
 await page.waitForSelector('.form-layer input',{timeout:60000});
 const ws=()=>page.evaluate(()=>window.gcp.getWorkspace());let doc=(await ws()).documents[0];
 console.log('aberto:',doc.name,'caminho mantido?',!!doc.path,'campos na página:',await page.locator('.form-layer input, .form-layer textarea, .form-layer select').count());
 const toast=await page.locator('.toast').textContent().catch(()=>'');console.log('aviso:',toast?.trim());
 await page.screenshot({path:'evidence/ui/10-formulario-xfa.png'});
 const input=page.locator('.form-layer input[type="text"], .form-layer input:not([type])').first();
 await input.click();await input.fill('PREENCHIDO PELO GCP-PDF');await page.waitForTimeout(900);
 doc=(await ws()).documents[0];console.log('valores no modelo:',JSON.stringify(doc.fields));
 const out=resolve('.cache/form-saida.pdf');await rm(out,{force:true});
 const bytes=await app.evaluate(async(_e,id)=>Array.from(await globalThis.__gcpTest.store.materialize(id)),doc.id);
 const {PDFDocument}=await import('pdf-lib');const saved=await PDFDocument.load(new Uint8Array(bytes));
 const values=saved.getForm().getFields().map(f=>{try{return [f.getName(),f.getText?.()]}catch{return [f.getName(),'?']}}).filter(([,v])=>v);
 console.log('no PDF salvo:',JSON.stringify(values.slice(0,3)),'XFA restante?',!!saved.catalog.lookup((await import('pdf-lib')).PDFName.of('AcroForm'))?.get?.((await import('pdf-lib')).PDFName.of('XFA')));
 // Organizer, numbering and compression on a multi-page fixture.
 await page.evaluate(p=>window.gcp.openFiles([p]),resolve('evidence/fixtures/relatorio-cultural.pdf'));
 await page.waitForFunction(()=>document.querySelector('.document-tab.active')?.textContent?.includes('relatorio'));
 await page.locator('.ribbon-tabs button',{hasText:'Organizar'}).click();await page.waitForSelector('.organize-card');await page.waitForTimeout(800);
 await page.locator('.organize-card').first().click();
 await page.screenshot({path:'evidence/ui/11-organizar.png'});
 await page.locator('.organize-tool',{hasText:'Numerar páginas'}).click();await page.waitForSelector('.numbering');
 await page.screenshot({path:'evidence/ui/12-numerar.png'});
 await page.locator('.modal-footer .button.primary').click();await page.waitForSelector('.numbering',{state:'detached'});
 doc=(await ws()).documents.find(d=>d.name.includes('relatorio'));console.log('números adicionados:',doc.objects.filter(o=>o.kind==='text').map(o=>o.text).join(' | '));
 await page.locator('.organize-tool',{hasText:'Comprimir'}).click();await page.waitForSelector('.compress');
 await page.locator('.compress-level').nth(2).locator('u').click();await page.waitForSelector('.compress-size b',{timeout:60000});
 console.log('compressão média:',(await page.locator('.compress-size').nth(2).textContent()).trim());
 await page.screenshot({path:'evidence/ui/13-comprimir.png'});
}finally{
 if(logs.some(l=>/PAGE ERROR/.test(l)))console.log(logs.filter(l=>/PAGE ERROR/.test(l)).join('\n'));
 await app.evaluate(()=>{for(const v of globalThis.__gcpTest.views.values())v.allowClose=true;}).catch(()=>{});await app.close();
}
