import {_electron as electron} from 'playwright-core';
import {createRequire} from 'node:module';
import {mkdtemp,mkdir,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {PDFDocument} from 'pdf-lib';
import assert from 'node:assert/strict';
const require=createRequire(import.meta.url),root=await mkdtemp(join(tmpdir(),'gcp-scanner-ui-'));
let app;
try{
 const env={...process.env,GCP_PDF_TEST_MODE:'1',GCP_PDF_DATA_DIR:join(root,'profile')};delete env.ELECTRON_RUN_AS_NODE;
 app=await electron.launch({executablePath:process.argv[2]?resolve(process.argv[2]):require('electron'),args:process.argv[2]?[]:[resolve('.')],env,timeout:90000});
 const page=await app.firstWindow();page.setDefaultTimeout(30000);const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.waitForSelector('.theme-gallery');await page.keyboard.press('Escape');await page.locator('.theme-gallery').waitFor({state:'detached'});
 await page.getByRole('button',{name:'Criar um PDF em branco',exact:true}).click();
 const dialog=page.getByRole('dialog',{name:'Criar um PDF',exact:true});await dialog.locator('select').nth(0).selectOption('Carta');await dialog.locator('select').nth(1).selectOption('true');await dialog.locator('input[type=number]').fill('3');await dialog.getByRole('button',{name:'Criar PDF',exact:true}).click();
 await page.waitForFunction(async()=>{const s=await window.gcp.getWorkspace();return s.documents[0]?.pageCount===3;});
 const saved=join(root,'Novo.pdf');await app.evaluate(({dialog},file)=>{dialog.showSaveDialog=async()=>({canceled:false,filePath:file});},saved);
 await page.evaluate(async()=>{const s=await window.gcp.getWorkspace();await window.gcp.saveDocument(s.activeDocumentId);});
 const pdf=await PDFDocument.load(await readFile(saved));assert.equal(pdf.getPageCount(),3);assert.ok(Math.abs(pdf.getPage(0).getWidth()-792)<0.01);
 // Inject only the transport boundary. PDF assembly, preview, OCR and IPC remain production code.
 await app.evaluate(async()=>{
  const s=globalThis.__gcpTest.scanner,fs=await import('node:fs/promises'),path=await import('node:path'),{createCanvas}=await import('@napi-rs/canvas');
  const canvas=createCanvas(620,860),ctx=canvas.getContext('2d');ctx.fillStyle='white';ctx.fillRect(0,0,620,860);ctx.fillStyle='black';ctx.font='32px Arial';ctx.fillText('Documento digitalizado',45,100);ctx.fillText('GCP PDF teste local',45,155);const png=canvas.toBuffer('image/png');
  s.devices=async()=>[{id:'test-usb',name:'Scanner USB (simulado)'}];s.capabilities=async()=>({sources:['Mesa','Alimentador duplex'],nativeUi:false,description:'Transporte simulado para teste sem hardware.'});
  s.execute=async(_file,args)=>{let folder;if(process.platform==='linux')folder=path.dirname(args.find(a=>a.startsWith('--batch=')).slice(8));else folder=args[args.indexOf('scan')+2];await fs.writeFile(path.join(folder,'page-0001.png'),png);return '';};
 });
 await page.getByRole('button',{name:'Digitalizar para PDF',exact:true}).click();const scan=page.getByRole('dialog',{name:'Digitalizar para PDF',exact:true});
 await scan.getByRole('button',{name:'Digitalizar',exact:true}).click();await scan.locator('.scan-card').waitFor();await scan.getByRole('button',{name:'Digitalizar mais páginas',exact:true}).waitFor({state:'visible'});
 await scan.getByRole('button',{name:'Digitalizar mais páginas',exact:true}).click();await page.waitForFunction(()=>document.querySelectorAll('.scan-card').length===2);
 await scan.getByRole('button',{name:'Girar página',exact:true}).first().click();await scan.getByRole('button',{name:'Mover página para baixo',exact:true}).first().click();
 await scan.getByRole('button',{name:'Remover página',exact:true}).last().click();await page.waitForFunction(()=>document.querySelectorAll('.scan-card').length===1);
 await scan.getByRole('button',{name:'Digitalizar mais páginas',exact:true}).click();await page.waitForFunction(()=>document.querySelectorAll('.scan-card').length===2);
 // Removal stays removed on a subsequent acquisition; the second scan has searchable text.
 await scan.getByRole('button',{name:'Finalizar e salvar PDF',exact:true}).click();await scan.waitFor({state:'detached'});
 await page.waitForFunction(async()=>{const s=await window.gcp.getWorkspace();return s.documents.length===2&&s.documents.find(d=>d.id===s.activeDocumentId)?.pageCount===2;});
 const output=await PDFDocument.load(await readFile(saved));assert.equal(output.getPageCount(),2);
 assert.deepEqual(errors,[]);await mkdir('evidence/packaged',{recursive:true});
 await page.getByRole('button',{name:'Digitalizar para PDF',exact:true}).click();await page.screenshot({path:'evidence/packaged/scanner-ui.png'});
 console.log('OK: PDF Carta paisagem com 3 páginas, modal scanner, OCR local, continuar, girar, reordenar, excluir, combinar e salvar. Transporte simulado; hardware não validado.');
}finally{if(app){await app.evaluate(()=>{for(const v of globalThis.__gcpTest.views.values())v.allowClose=true;}).catch(()=>{});await app.close();}await rm(root,{recursive:true,force:true});}
