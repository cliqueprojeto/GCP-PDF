import {_electron as electron} from 'playwright-core';
import {createRequire} from 'node:module';
import {PDFDocument,StandardFonts} from 'pdf-lib';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import assert from 'node:assert/strict';
import {setTimeout as delay} from 'node:timers/promises';
const require=createRequire(import.meta.url),root=await mkdtemp(join(tmpdir(),'gcp-form-lifecycle-'));
let app;
try{
 const pdf=await PDFDocument.create(),page=pdf.addPage([595,842]),font=await pdf.embedFont(StandardFonts.Helvetica),form=pdf.getForm();
 form.createTextField('nome').addToPage(page,{x:50,y:700,width:240,height:30,font});
 form.createButton('acao').addToPage('Botao',page,{x:50,y:640,width:160,height:30,font});
 const bytes=await pdf.save(),first=join(root,'Formulario.pdf');await writeFile(first,bytes);
 const env={...process.env,GCP_PDF_TEST_MODE:'1',GCP_PDF_DATA_DIR:join(root,'profile')};delete env.ELECTRON_RUN_AS_NODE;
 app=await electron.launch({executablePath:require('electron'),args:[resolve('.'),first],env,timeout:90_000});
 const window=await app.firstWindow(),errors=[];window.on('pageerror',error=>errors.push(error.stack??error.message));
 await window.waitForSelector('.form-button');
 const button=await window.locator('.form-button').boundingBox();assert.ok(button&&button.width>100&&button.height>10);
 await window.locator('.form-layer input[type="text"]').first().fill('Ação cultural');
 const deadline=Date.now()+10_000;
 while(Date.now()<deadline){const state=await window.evaluate(()=>window.gcp.getWorkspace());if(state.documents[0]?.fields.nome==='Ação cultural')break;await delay(50);}
 assert.equal((await window.evaluate(()=>window.gcp.getWorkspace())).documents[0].fields.nome,'Ação cultural');
 const id=(await window.evaluate(()=>window.gcp.getWorkspace())).documents[0].id;
 const saved=await app.evaluate(async(_e,id)=>Array.from(await globalThis.__gcpTest.store.materialize(id)),id);
 assert.equal((await PDFDocument.load(new Uint8Array(saved))).getForm().getTextField('nome').getText(),'Ação cultural');
 // Close documents while their annotation/button geometry can still be loading.
 // A retired PDF transport must not leave an unhandled renderer promise.
 for(let n=0;n<16;n++){
  const file=join(root,`Troca ${n}.pdf`);await writeFile(file,bytes);
  await window.evaluate(async file=>{await window.gcp.openFiles([file]);const state=await window.gcp.getWorkspace();await window.gcp.closeDocument(state.activeDocumentId);},file);
 }
 await window.waitForSelector('.form-button');
 assert.deepEqual(errors,[]);
 console.log('OK formulário: botões posicionados, preenchimento salvo e 16 trocas/fechamentos sem rejeição de transporte');
}finally{
 if(app){await app.evaluate(()=>{for(const view of globalThis.__gcpTest.views.values())view.allowClose=true;}).catch(()=>{});await app.close();}
 await rm(root,{recursive:true,force:true});
}
