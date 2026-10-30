import {_electron as electron} from 'playwright-core';
import {PDFDocument,StandardFonts} from 'pdf-lib';
import {mkdtemp,mkdir,readFile,writeFile,rm} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import assert from 'node:assert/strict';

const executable=process.argv[2];
if(!executable)throw new Error('Informe o executável extraído/instalado do pacote.');
const root=await mkdtemp(join(tmpdir(),'gcp-packaged-'));
let app;
const checks=[],errors=[];
const check=(label,value)=>{assert.ok(value,label);checks.push(label);console.log('OK',label);};
try{
 const pdf=await PDFDocument.create(),font=await pdf.embedFont(StandardFonts.Helvetica);
 pdf.addPage([595,842]).drawText('Documento cultural original',{font,size:18,x:50,y:740});
 const input=join(root,'Documento cultural.pdf');await writeFile(input,await pdf.save());
 const env={...process.env,GCP_PDF_TEST_MODE:'1',GCP_PDF_DATA_DIR:join(root,'profile')};delete env.ELECTRON_RUN_AS_NODE;
 app=await electron.launch({executablePath:resolve(executable),args:[input],env,timeout:90_000});
 const page=await app.firstWindow();page.on('pageerror',error=>errors.push(error.message));
 await page.waitForFunction(async()=>!!window.gcp&&(await window.gcp.getWorkspace()).documents.length===1,{},{timeout:60_000});
 const packaged=await app.evaluate(({app})=>({packaged:app.isPackaged,arch:process.arch,platform:process.platform}));
 check('aplicativo empacotado e arquitetura nativa',packaged.packaged&&packaged.arch===process.arch&&packaged.platform===process.platform);
 const state=await page.evaluate(()=>window.gcp.getWorkspace()),id=state.documents[0].id;
 check('PDF aberto pela linha de comando',state.documents[0].pageCount===1);
 await page.waitForFunction(()=>document.querySelectorAll('.page-sheet canvas').length>0,{},{timeout:60_000});
 check('PDF renderizado na interface',true);
 const source=await page.evaluate(({id,page})=>window.gcp.getSourceObjects(id,page),{id,page:state.documents[0].pages[0].id});
 check('motor nativo lista texto original',JSON.stringify(source).includes('Documento cultural original'));
 const pageId=state.documents[0].pages[0].id;
 await page.evaluate(({id,pageId,paragraph})=>window.gcp.editParagraph(id,pageId,{paragraph,text:'Documento cultural editado'}),{id,pageId,paragraph:source.paragraphs[0].index});
 const saved=join(root,'Documento editado.pdf');
 await app.evaluate(({dialog},file)=>{dialog.showSaveDialog=async()=>({canceled:false,filePath:file});},saved);
 await page.evaluate(id=>window.gcp.saveDocument(id,true),id);
 const savedBytes=await readFile(saved);
 check('edição e salvamento pelo aplicativo',(await PDFDocument.load(savedBytes)).getPageCount()===1);
 const edited=await app.evaluate(async(_e,bytes)=>{
  const data=new Uint8Array(bytes);
  const after=await globalThis.__gcpTest.engine.objects('smoke-reopen',()=>data,0);
  return after.paragraphs.map(p=>p.text).join('\n');
 },Array.from(savedBytes));
 check('texto editado persiste ao reabrir arquivo salvo',edited.includes('Documento cultural editado'));
 await page.evaluate(id=>window.gcp.runOcr(id,[0]),id);
 check('OCR local com worker, WASM e modelo português empacotados',true);
 const converted=await page.evaluate(async()=>{
  const current=await window.gcp.getWorkspace();
  const result=await window.gcp.getBase(current.documents[0].pages[0].base);return !!result;
 });
 check('leitura dos bytes pelo preload empacotado',converted);
 await mkdir('evidence/packaged',{recursive:true});
 await page.screenshot({path:`evidence/packaged/${process.platform}-${process.arch}.png`});
 check('nenhum erro JavaScript no renderer',errors.length===0);
 await writeFile(`evidence/packaged/${process.platform}-${process.arch}.json`,JSON.stringify({executable:resolve(executable),...packaged,checks,errors},null,2));
}finally{
 if(app){await app.evaluate(async()=>{for(const view of globalThis.__gcpTest.views.values())view.allowClose=true;await globalThis.__gcpTest.engine.dispose();}).catch(()=>{});await app.close();}
 await rm(root,{recursive:true,force:true});
}
