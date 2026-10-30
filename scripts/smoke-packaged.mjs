import {_electron as electron} from 'playwright-core';
import {PDFDocument,StandardFonts} from 'pdf-lib';
import {mkdtemp,mkdir,readFile,writeFile,readdir,rm} from 'node:fs/promises';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {join,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import assert from 'node:assert/strict';

const executable=process.argv[2];
if(!executable)throw new Error('Informe o executável extraído/instalado do pacote.');
const root=await mkdtemp(join(tmpdir(),'gcp-packaged-'));
const exec=promisify(execFile),label=process.argv[3]??'app';
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
 // Generate an ephemeral identity with the shipped engine, then sign through
 // the real file-picker/preload/IPC flow. No real certificate is used in CI.
 const engineFolder=await app.evaluate(async(_e,id)=>{
  const {engine,store}=globalThis.__gcpTest;
  await engine.onCopy(await store.materialize(id),async({call})=>call('sign_id_create',{name:'GCP-PDF Teste A1',password:'senha-temporaria-123',path:'fixture.p12',key:'rsa2048',years:1}));
  return engine.folder;
 },id);
 const identityFile=join(root,"Certificado d'água.pfx");await writeFile(identityFile,await readFile(join(engineFolder,'fixture.p12')));await rm(join(engineFolder,'fixture.p12'));
 await app.evaluate(({dialog},file)=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:[file]});},identityFile);
 const identity=await page.evaluate(()=>window.gcp.chooseCertificate());
 check('seleção de certificado A1 por referência privada',identity?.id.startsWith('file:'));
 const signedFile=join(root,'Assinado A1.pdf');
 await app.evaluate(({dialog},file)=>{dialog.showSaveDialog=async()=>({canceled:false,filePath:file});},signedFile);
 const failure=await page.evaluate(async({id,certificate})=>{
  try{await window.gcp.signDocument(id,{certificate,password:'senha-incorreta',page:null,rect:null,reason:'Teste',location:'Brasil',showName:true});return '';}
  catch(error){return String(error);}
 },{id,certificate:identity.id});
 check('senha incorreta recusa assinatura',failure.length>0);
 assert.equal((await readdir(root)).includes('Assinado A1.pdf'),false);
 check('falha de senha remove a cópia privada do certificado',!(await readdir(engineFolder)).some(name=>name.startsWith('certificado-')));
 const signingState=await page.evaluate(()=>window.gcp.getWorkspace());
 await page.evaluate(({id,certificate,pageId})=>window.gcp.signDocument(id,{certificate,password:'senha-temporaria-123',page:pageId,rect:{x:50,y:150,width:210,height:90},reason:'Teste A1',location:'Brasil',showName:true}),{id,certificate:identity.id,pageId:signingState.documents[0].pages[0].id});
 check('arquivo PDF assinado com A1 RSA pelo aplicativo',(await PDFDocument.load(await readFile(signedFile))).getForm().getFields().length>0);
 await page.evaluate(file=>window.gcp.openFiles([file]),signedFile);
 const signedState=await page.evaluate(()=>window.gcp.getWorkspace());
 const signedId=signedState.documents.find(doc=>doc.path===signedFile)?.id;
 const signatures=await page.evaluate(id=>window.gcp.checkSignatures(id),signedId);
 check('assinatura A1 reaberta e verificada criptograficamente',signatures.some(signature=>/verificação criptográfica|passou nas verificações/.test(signature.explanation)));
 check('assinatura não deixa cópia privada do certificado',!(await readdir(engineFolder)).some(name=>name.startsWith('certificado-')));
 if(process.platform!=='win32'){
  await page.evaluate(()=>window.gcp.installContextMenu(true));
  const home=join(root,'profile/desktop-profile'),data=join(home,'.local/share');
  const second=join(root,"Prestação d'água.pdf");await writeFile(second,await pdf.save());
  for(const [action,name] of [['combine','Combinar em um PDF'],['convert','Converter para PDF']]){
   let command,args;
   if(process.platform==='linux'){command=join(data,'nautilus/scripts/GCP-PDF',name);args=[input,second];}
   else{command='/usr/bin/automator';args=['-i',input,join(home,'Library/Services',`GCP-PDF — ${name}.workflow`)];}
   const [quick]=await Promise.all([app.waitForEvent('window',{timeout:45_000}),exec(command,args,{env,timeout:45_000})]);
   await quick.waitForFunction(async action=>{const state=await window.gcp?.getQuickState();return state?.action===action&&state.files.length>0;},action,{timeout:30_000});
   const quickState=await quick.evaluate(()=>window.gcp.getQuickState());
   check(`ação rápida nativa ${action} recebe arquivos selecionados`,quickState.files.length===(process.platform==='linux'?2:1)&&quickState.files[0].path===input);
   await quick.close();
  }
  if(process.platform==='linux'){
   await exec('desktop-file-validate',[join(data,'applications/gcp-pdf.desktop')]);
   check('atalho validado na categoria Escritório',(await readFile(join(data,'applications/gcp-pdf.desktop'),'utf8')).includes('Categories=Office;'));
  }else{
   for(const name of ['Combinar em um PDF','Converter para PDF'])for(const file of ['Info.plist','document.wflow'])await exec('/usr/bin/plutil',['-lint',join(home,'Library/Services',`GCP-PDF — ${name}.workflow/Contents`,file)]);
   check('workflows e serviços do Finder validados pelo macOS',true);
  }
  await page.evaluate(()=>window.gcp.installContextMenu(false));
 }
 await mkdir('evidence/packaged',{recursive:true});
 await page.screenshot({path:`evidence/packaged/${process.platform}-${process.arch}-${label}.png`});
 check('nenhum erro JavaScript no renderer',errors.length===0);
 await writeFile(`evidence/packaged/${process.platform}-${process.arch}-${label}.json`,JSON.stringify({executable:resolve(executable),...packaged,checks,errors,certificateScope:'Certificado temporário autoassinado RSA2048 em PKCS#12; sem certificado ICP-Brasil real ou token A3.'},null,2));
}catch(error){
 await mkdir('evidence/packaged',{recursive:true});
 await writeFile(`evidence/packaged/${process.platform}-${process.arch}-${label}-failure.json`,JSON.stringify({checks,errors,error:String(error),stderr:error?.stderr},null,2));
 throw error;
}finally{
 if(app){await app.evaluate(async()=>{for(const view of globalThis.__gcpTest.views.values())view.allowClose=true;await globalThis.__gcpTest.engine.dispose();}).catch(()=>{});await app.close();}
 await rm(root,{recursive:true,force:true});
}
