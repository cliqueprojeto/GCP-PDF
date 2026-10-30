import {_electron as electron} from 'playwright-core';
import {createRequire} from 'node:module';
import {resolve} from 'node:path';
import {mkdir,writeFile,readFile} from 'node:fs/promises';
import {DOMMatrix,ImageData,Path2D} from '@napi-rs/canvas';
Object.assign(globalThis,{DOMMatrix,ImageData,Path2D});
const {getDocument}=await import('pdfjs-dist/legacy/build/pdf.mjs');
const require=createRequire(import.meta.url),file=process.argv[2]?resolve(process.argv[2]):(console.error('Uso: node scripts/smoke-live-precision.mjs ARQUIVO.pdf'),process.exit(2));
await mkdir('evidence/ui',{recursive:true});const env={...process.env,GCP_PDF_TEST_MODE:'1',GCP_PDF_DATA_DIR:resolve('.cache/live-precision-profile')};delete env.ELECTRON_RUN_AS_NODE;
const app=await electron.launch({executablePath:require('electron'),args:[resolve('.')],cwd:resolve('.'),env,timeout:90000}),report={file,checks:[]};
const check=(name,value,detail)=>{report.checks.push({name,pass:!!value,detail});if(!value)throw new Error(name+': '+JSON.stringify(detail));};
try{
 const page=await app.firstWindow();await page.waitForFunction(()=>!!window.gcp);await page.evaluate(()=>localStorage.removeItem('gcp.last-page'));await page.evaluate(p=>window.gcp.openFiles([p]),file);await page.waitForSelector('.page-sheet:not(.loading)');
 const state=await page.evaluate(()=>window.gcp.getWorkspace()),doc=state.documents[0],first=doc.pages[0];
 const before=await page.evaluate(async({id,ref})=>window.gcp.getSourceObjects(id,ref),{id:doc.id,ref:first.id});
 const target=before.paragraphs.find(p=>p.text.includes('Gestão Cultural Pro')&&p.size>20)||before.paragraphs.find(p=>p.size>20&&!p.text.includes('\n'));
 if(!target)throw new Error('Título de uma linha não encontrado');
 await page.locator('.ribbon-tabs button',{hasText:'Editar'}).first().click();const box=page.locator(`.page-sheet[data-page="1"] [data-source="text:${target.index}"]`);await box.waitFor({timeout:60000});await box.click({position:{x:10,y:8}});
 const editor=page.locator('.source-editor-content');await editor.waitFor();
 const initial=await editor.innerText();check('Título abre sem quebra adicional',!initial.trim().includes('\n'),initial);
 await editor.press('Control+A');await editor.pressSequentially(target.text.trim()+' Pro');
 const handle=page.getByRole('slider',{name:'Largura da caixa de texto'});await handle.focus();for(let i=0;i<20;i++)await handle.press('ArrowRight');
 await editor.focus();await page.screenshot({path:'evidence/ui/precision-title-draft.png'});await editor.press('Control+Enter');
 await page.waitForFunction(async revision=>(await window.gcp.getWorkspace()).documents[0].revision>revision,doc.revision,{timeout:60000});await page.waitForTimeout(1200);
 const after=await page.evaluate(async({id,ref})=>window.gcp.getSourceObjects(id,ref),{id:doc.id,ref:first.id});
 const changed=after.paragraphs.find(p=>p.text.replace(/\s+/g,' ').trim()===target.text.replace(/\s+/g,' ').trim()+' Pro');check('Texto realmente persistido na base PDF',!!changed,after.paragraphs.map(p=>p.text));check('Título permanece numa linha após gravar',!!changed&&!changed.text.includes('\n'),changed?.text);
 const other=before.paragraphs.filter(p=>p.index!==target.index).map(p=>p.text.replace(/\s+/g,' ').trim());const remaining=after.paragraphs.map(p=>p.text.replace(/\s+/g,' ').trim());check('Textos vizinhos preservados',other.every(p=>remaining.includes(p)),other.filter(p=>!remaining.includes(p)));
 const encoded=await app.evaluate(async(_,{id})=>Buffer.from(await globalThis.__gcpTest.store.materialize(id)).toString('base64'),{id:doc.id});const output=Buffer.from(encoded,'base64');await writeFile('evidence/ui/precision-title-output.pdf',output);await page.screenshot({path:'evidence/ui/precision-title-saved.png'});
 async function outsideTitle(bytes){const task=getDocument({data:new Uint8Array(bytes)});try{const pdf=await task.promise,p=await pdf.getPage(1),text=await p.getTextContent(),view=p.view;return text.items.filter(item=>{if(!('str'in item))return false;const x=item.transform[4]-view[0],y=view[3]-item.transform[5];return !(x>=target.rect.x-2&&x<=target.rect.x+target.rect.width+150&&y>=target.rect.y&&y<=target.rect.y+target.rect.height+2);}).map(item=>item.str).join(' ').replace(/\s+/g,' ').trim();}finally{await task.destroy();}}
 const originalOutside=await outsideTitle(await readFile(file)),savedOutside=await outsideTitle(output);check('PDF.js confirma conteúdo fora do título intacto',originalOutside===savedOutside,{original:originalOutside,saved:savedOutside});

}finally{await writeFile('evidence/ui/live-precision.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report));await app.evaluate(()=>{for(const v of globalThis.__gcpTest.views.values())v.allowClose=true;}).catch(()=>{});await app.close();}
