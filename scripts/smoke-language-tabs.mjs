import {_electron as electron} from 'playwright-core';
import {createRequire} from 'node:module';
import {resolve} from 'node:path';
import {mkdir,writeFile} from 'node:fs/promises';
import {PDFDocument} from 'pdf-lib';
import {createCanvas} from '@napi-rs/canvas';
import assert from 'node:assert/strict';
const require=createRequire(import.meta.url),root=resolve('.cache/language-tabs');
await mkdir(root,{recursive:true});await mkdir('evidence/language-tabs',{recursive:true});
const cases=[['pt-BR','Cultura brasileira e participação social.','participação'],['en','Cultural projects support public education.','education'],['es','La educación cultural necesita colaboración.','colaboración']];
const files=[];
for(const [lang,text] of cases){const c=createCanvas(1600,450),ctx=c.getContext('2d');ctx.fillStyle='white';ctx.fillRect(0,0,1600,450);ctx.fillStyle='black';ctx.font='48px Arial';ctx.fillText(text,50,180);const doc=await PDFDocument.create(),image=await doc.embedPng(c.toBuffer('image/png'));doc.addPage([800,225]).drawImage(image,{x:0,y:0,width:800,height:225});const file=resolve(root,`Documento com nome completo para verificar abas e OCR ${lang}.pdf`);await writeFile(file,await doc.save());files.push(file);}
const env={...process.env,GCP_PDF_TEST_MODE:'1',GCP_PDF_DATA_DIR:resolve(root,'profile')};delete env.ELECTRON_RUN_AS_NODE;
const app=await electron.launch({executablePath:process.argv[2]??require('electron'),args:process.argv[2]?[]:[resolve('.')],env}),errors=[];
try{
 const page=await app.firstWindow();page.on('pageerror',e=>errors.push(e.message));await page.waitForFunction(()=>!!window.gcp);
 // Isolated profile simulates an unsupported OS language to exercise the Brazilian Portuguese fallback.
 await app.evaluate(({app})=>{app.getPreferredSystemLanguages=()=>['de-DE'];});
 await page.evaluate(()=>window.gcp.setLanguage('auto','auto'));await page.reload();
 await page.waitForFunction(()=>document.documentElement.lang==='pt-BR');
 assert.equal((await page.evaluate(()=>window.gcp.getUpdateStatus())).frequency,'startup');
 await page.evaluate(files=>window.gcp.openFiles(files),files);await page.waitForSelector('.document-tab');
 let docs=(await page.evaluate(()=>window.gcp.getWorkspace())).documents;
 const ids=docs.map(d=>d.id);await page.locator('.document-tab').nth(2).dragTo(page.locator('.document-tab').nth(0),{targetPosition:{x:5,y:20}});
 await page.waitForFunction(id=>document.querySelector('.document-tab')?.getAttribute('title')?.includes(id),'es.pdf');
 docs=(await page.evaluate(()=>window.gcp.getWorkspace())).documents;assert.deepEqual(docs.map(d=>d.id),[ids[2],ids[0],ids[1]]);
 assert.match(await page.locator('.document-tab').first().getAttribute('title'),/Documento com nome completo/);
 assert.equal(await page.locator('.document-tab[aria-selected="true"]').count(),1);
 console.log('PASS: abas reordenadas por arraste, nome completo no tooltip e aba ativa');
 await page.locator('button[title="Configurações"]').click();
 for(const [lang] of cases){
  await page.locator('.form-section select').filter({has:page.locator('option[value="en"]')}).first().selectOption(lang);
  await page.waitForFunction(lang=>document.documentElement.lang===lang,lang);
  const heading=lang==='en'?'Settings':lang==='es'?'Configuración':'Configurações';assert.match(await page.locator('.modal-heading h2').innerText(),new RegExp(heading));
  await page.screenshot({path:`evidence/language-tabs/interface-${lang}.png`});
 }
 await page.keyboard.press('Escape');
 for(const [index,[lang,,word]] of cases.entries()){
  await page.evaluate(({language,id})=>window.gcp.setLanguage(language,language).then(()=>window.gcp.runOcr(id)),{language:lang,id:ids[index]});
  const text=await app.evaluate(async(_e,id)=>{const {store,engine}=globalThis.__gcpTest;const bytes=await store.materialize(id);const obj=await engine.objects(`ocr-${id}`,()=>bytes,0);return obj.paragraphs.map(p=>p.text).join(' ');},ids[index]);
  assert.match(text.toLowerCase(),new RegExp(word));console.log('PASS: OCR local',lang,text);
 }
 await page.locator('button[title="Página inicial"],button[title="Inicio"],button[title="Home"]').first().click();
 await app.evaluate(({BrowserWindow})=>{const w=BrowserWindow.getAllWindows()[0];w.unmaximize();w.setSize(1400,1000);});
 await page.waitForTimeout(300);
 const boxes=await page.evaluate(()=>{const a=document.querySelector('.home-side-card').getBoundingClientRect(),b=document.querySelector('.home-history').getBoundingClientRect();return {card:a.right,history:b.right};});assert.ok(Math.abs(boxes.card-boxes.history)<2,JSON.stringify(boxes));
 await page.screenshot({path:'evidence/language-tabs/home-alinhada.png'});assert.deepEqual(errors,[]);
 console.log('PASS: card inicial alinhado com Arquivos recentes; nenhuma exceção na interface');
}finally{await app.evaluate(()=>{for(const v of globalThis.__gcpTest.views.values())v.allowClose=true;}).catch(()=>{});await app.close();}
