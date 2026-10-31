import {localize} from '../shared/localize';
import {resolveLocale,OCR_LANGUAGES} from '../shared/locale';
import {app,BrowserWindow,ipcMain,dialog,Menu,shell,clipboard,nativeTheme,screen,session} from 'electron';
import {join,basename,extname,resolve,dirname,isAbsolute} from 'node:path';
import {readFile,mkdir,stat,mkdtemp,rm,writeFile} from 'node:fs/promises';
import {existsSync} from 'node:fs';
import {execFile} from 'node:child_process';
import {pathToFileURL} from 'node:url';
import {randomUUID} from 'node:crypto';
import {DocumentStore} from './store';
import {Settings,atomicWrite} from './settings';
import {convertPdf,extractDocumentText,pagesWithoutText,renderPdfPage,renderPdfPages} from './conversion';
import type {OcrRuns} from './word-layout';
import {ocrRuns,type OcrLine} from './ocr-layout';
import {readMetadata,documentStats} from './review';
import {fieldFormats,imageFields} from './field-formats';
import {headings} from './review';
import {UPDATE_REPOSITORY,checkForUpdate,due,installUpdate} from './updates';
import {addOcrTextLayer,combineSelections} from './pdf-engine';
import {requestAnswer,listModels,probeModel,freeCandidates,paidCandidate} from './ai';
import {PdfCraftSession} from './pdfcraft-session';
import {EditorBlockReader} from './editor-blocks';
import {Dictionaries} from './dictionary';
import {analyzeEpub,toEpub} from './epub';
import {readBook,type ParsedBook} from './epub-reader';
import {CertificateFiles} from './certificate-files';
import {installUnixIntegration,type DesktopOptions} from './desktop-integration';
import {privateDirectory} from './pdfcraft-sidecar';
import {signatureList,signatureSummary,validateNewSignature,sameFilePath,refusesSignedOverwrite} from './signatures';
import {registerWindowsContextMenu,readInputPdf,INPUT_EXTENSIONS} from './system';
import {toPage,fromPage} from '../shared/geometry';
import {faceFor,faceForPostscript,fontFamilies} from './fonts';
import type {AiConfig,UpdatePreferences,UpdateStatus,Bookmark,BookmarkEdit,FieldProps,Certificate,FieldType,ProtectOptions,SignOptions,CompressOptions,WorkspaceState,PdfOperation,ExportOptions,ParagraphEdit,SourceObjects,QuickState,Rect,EpubOptions} from '../shared/types';
app.setName('GCP-PDF');
if(process.env.GCP_PDF_DATA_DIR)app.setPath('userData',resolve(process.env.GCP_PDF_DATA_DIR));
const fontCache=()=>join(app.getPath('userData'),'font-catalog.json');
const editorBlockReader=new EditorBlockReader();
const dictionaries=new Dictionaries(()=>join(assets(),'dictionaries'));
/** EPUB files the user opened, by an opaque token: the renderer never names paths to read. */
const books=new Map<string,{path:string;parsed?:ParsedBook}>();
const BOOK_EXTENSIONS=['.epub'];
const OPENABLE=[...INPUT_EXTENSIONS,...BOOK_EXTENSIONS];
function openBook(view:View,path:string){const token=randomUUID();books.set(token,{path});if(books.size>20)books.delete(books.keys().next().value!);action(view,'book:'+token);}
const store=new DocumentStore(async(family,bold,italic)=>{const face=await faceFor(family,bold,italic,fontCache());return face?new Uint8Array(await readFile(face.file)):undefined;}),settings=new Settings();
type View={window:BrowserWindow;ids:string[];active?:string;allowClose:boolean};
type Quick={window:BrowserWindow;state:QuickState};
const views=new Map<number,View>(),quicks=new Map<number,Quick>();let shuttingDown=false,pageClipboard:string|undefined;
const assets=()=>join(app.getAppPath(),'assets');
const unpacked=()=>app.isPackaged?app.getAppPath().replace(/app[.]asar$/,'app.asar.unpacked'):app.getAppPath();
const sidecar=()=>{const path=join(unpacked(),'assets','pdfcraft',process.platform==='win32'?'pdfcraft-cli.exe':'pdfcraft-cli');if(!existsSync(path))throw new Error('O motor de edição de texto não está disponível nesta instalação.');return path;};
const engine=new PdfCraftSession(sidecar);
const certificateFiles=new CertificateFiles();
const engineRoot=()=>engine.folder;
/** Renders HTML to PDF with Chromium in a hidden, script-free window (built-in Word/Excel conversion). */
async function htmlToPdf(html:string){
 const window=new BrowserWindow({show:false,webPreferences:{sandbox:true,contextIsolation:true,nodeIntegration:false,javascript:false}});
 try{await window.loadURL('data:text/html;charset=utf-8,'+encodeURIComponent(html));return new Uint8Array(await window.webContents.printToPDF({pageSize:'A4',printBackground:true,preferCSSPageSize:true}));}
 finally{window.destroy();}
}
const readPdf=(path:string)=>readInputPdf(path,htmlToPdf);
const rendererUrl=()=>pathToFileURL(join(app.getAppPath(),'dist','renderer')).href;
function trusted(event:Electron.IpcMainInvokeEvent){if(event.senderFrame!==event.sender.mainFrame)throw new Error('Origem de ação não autorizada.');const url=event.sender.getURL();if(!(url.startsWith(rendererUrl())||(!app.isPackaged&&url.startsWith('http://127.0.0.1:'))))throw new Error('Origem inválida.');}
function saveDialog(window:BrowserWindow,options:Electron.SaveDialogOptions){const locale=languages().locale;return dialog.showSaveDialog(window,{...options,title:options.title?localize(options.title,locale):undefined,filters:options.filters?.map(f=>({...f,name:localize(f.name,locale)}))});}
function openDialog(window:BrowserWindow,options:Electron.OpenDialogOptions){const locale=languages().locale;return dialog.showOpenDialog(window,{...options,title:options.title?localize(options.title,locale):undefined,filters:options.filters?.map(f=>({...f,name:localize(f.name,locale)}))});}
const OCR_FAMILIES=['Calibri','Arial','Times New Roman','Cambria','Segoe UI','Verdana','Georgia','Tahoma','Carlito','Liberation Sans','Liberation Serif','DejaVu Sans','Helvetica','Times'];
/** Families installed here that scanned text is compared against (the canvas measures only installed ones). */
async function ocrFamilies(){const installed=new Set((await fontFamilies(fontCache()).catch(()=>[] as string[])).map(f=>f.toLowerCase()));const found=OCR_FAMILIES.filter(f=>installed.has(f.toLowerCase()));return found.length?found:['Arial'];}
/** Stroke thickness and text widths measured on the page image the recognizer read (`image.scale` pixels per point). */
async function ocrMeasure(image:{bytes:Uint8Array;scale:number}){
 const {createCanvas,loadImage}=await import('@napi-rs/canvas');
 const picture=await loadImage(Buffer.from(image.bytes)),canvas=createCanvas(picture.width,picture.height),context=canvas.getContext('2d');
 context.drawImage(picture,0,0);
 const pixels=context.getImageData(0,0,canvas.width,canvas.height).data,k=image.scale,probe=createCanvas(8,8).getContext('2d');
 return {
  stroke(box:{x:number;y:number;width:number;height:number}){
   const x0=Math.max(0,Math.floor(box.x*k)),y0=Math.max(0,Math.floor(box.y*k)),x1=Math.min(canvas.width,Math.ceil((box.x+box.width)*k)),y1=Math.min(canvas.height,Math.ceil((box.y+box.height)*k));
   let dark=0,runs=0;
   for(let y=y0;y<y1;y++){let inside=false;for(let x=x0;x<x1;x++){const i=(y*canvas.width+x)*4,ink=pixels[i]!*0.299+pixels[i+1]!*0.587+pixels[i+2]!*0.114<128;if(ink){dark++;if(!inside)runs++;}inside=ink;}}
   return runs?dark/runs:0;
  },
  width(text:string,family:string,size:number,bold:boolean){probe.font=`${bold?'bold ':''}${size*10}px "${family}"`;return probe.measureText(text).width/10;},
 };
}
/** Local OCR of the given pages: invisible text layers for the PDF and, for Office exports, the text as
 * runs with one size and baseline per line, as the scan shows it. */
type Recognized={layers:{page:number;words:{text:string;x:number;y:number;width:number;height:number}[]}[];runs:OcrRuns};
/** Local OCR with Tesseract, bundled with the app: the searchable text layer and the runs Office exports lay out. */
async function recognizePages(view:View,source:Uint8Array,pages:number[]):Promise<Recognized>{
 const {createWorker}=await import('tesseract.js');await mkdir(join(app.getPath('userData'),'ocr-cache'),{recursive:true});
 const ocrLocale=languages().ocrLocale;
 const worker=await createWorker(OCR_LANGUAGES[ocrLocale],1,{langPath:join(assets(),'tessdata'),gzip:false,cachePath:join(app.getPath('userData'),'ocr-cache'),logger:()=>{}});
 try{
  const layers:{page:number;words:{text:string;x:number;y:number;width:number;height:number}[]}[]=[],runs:OcrRuns=new Map();
  for(let n=0;n<pages.length;n++){
   action(view,`progress:Reconhecendo ${({'pt-BR':'português',en:'inglês',es:'espanhol'})[ocrLocale]}: página ${n+1} de ${pages.length}…`);
   const page=pages[n]!,image=await renderPdfPage(source,page,200),k=image.scale;
   const result=await worker.recognize(Buffer.from(image.bytes),{},{blocks:true,text:true});
   const words:{text:string;x:number;y:number;width:number;height:number}[]=[],lines:OcrLine[]=[];
   for(const block of result.data.blocks||[])for(const paragraph of block.paragraphs||[])for(const line of paragraph.lines||[]){
    const base=line.baseline,slope=base&&base.x1!==base.x0?(base.y1-base.y0)/(base.x1-base.x0):0,found:OcrLine['words']=[];
    for(const word of line.words||[]){
     if(!word.text?.trim())continue;
     const box={x:word.bbox.x0/k,y:word.bbox.y0/k,width:(word.bbox.x1-word.bbox.x0)/k,height:(word.bbox.y1-word.bbox.y0)/k};
     words.push({text:word.text,...box});
     found.push({text:word.text,...box,confidence:word.confidence,baseline:base?(base.y0+slope*(word.bbox.x0-base.x0))/k:box.y+box.height*0.8});
    }
    if(found.length)lines.push({words:found,rowHeight:(line.rowAttributes?.rowHeight??0)/k,height:(line.bbox.y1-line.bbox.y0)/k});
   }
   const {runs:pageRuns}=ocrRuns(lines,await ocrMeasure(image),await ocrFamilies());
   layers.push({page,words});runs.set(page,pageRuns);
  }
  return {layers,runs};
 }finally{await worker.terminate();}
}
function languages(){const system=app.getPreferredSystemLanguages();return {language:settings.language,ocr:settings.ocrLanguage,locale:resolveLocale(settings.language,system),ocrLocale:resolveLocale(settings.ocrLanguage,system)};}
function state(view:View):WorkspaceState{return {windowId:view.window.webContents.id,documents:view.ids.map(id=>store.info(id)),activeDocumentId:view.active,theme:settings.theme,quickActions:settings.quickActions};}
function notify(){for(const view of views.values()){if(!view.window.isDestroyed()){view.window.webContents.send('gcp:workspace',state(view));view.window.setTitle((view.active?store.get(view.active).name+' — ':'')+'GCP-PDF');}}}
function action(view:{window:BrowserWindow},name:string){if(!view.window.isDestroyed())view.window.webContents.send('gcp:action',name);}
function own(view:View,id:string){if(!view.ids.includes(id))throw new Error('O documento não pertence a esta janela.');return store.get(id);}
function activate(view:View,id:string){if(!view.ids.includes(id))view.ids.push(id);view.active=id;notify();}
function pageRef(view:View,id:string,page:string){const ref=own(view,id).model.pages.find(item=>item.id===page);if(!ref)throw new Error('Esta página não existe mais. A visualização foi atualizada.');return ref;}
async function save(view:View,id:string,saveAs=false){
 const doc=own(view,id);let path=saveAs?undefined:doc.path;
 const protectedPath=store.signedSourcePath(id),changed=doc.revision!==doc.savedRevision;
 const editingOriginal=protectedPath&&doc.path?await sameFilePath(protectedPath,doc.path):!protectedPath&&store.signed(id)&&!store.unchanged(id);
 // A signed file is never overwritten with changes: the signature covers its exact bytes (Acrobat-style).
 if(changed&&editingOriginal){
  const answer=await ask(view,{title:'Documento assinado digitalmente',message:'Salvar estas alterações invalida a assinatura digital deste PDF.',detail:'O arquivo assinado não será alterado. As mudanças podem ser salvas em uma cópia (sem assinatura válida).',buttons:['Salvar como cópia','Cancelar'],defaultId:0,cancelId:1,tone:'question'});
  if(answer!==0)return null;
  path=undefined;
 }
 if(store.signed(id)&&!changed&&path&&!saveAs){doc.savedRevision=doc.revision;notify();return path;}
 if(!path){const result=await saveDialog(view.window,{title:saveAs?'Salvar como':'Salvar PDF',defaultPath:saveAs?join(dirname(doc.path??doc.name),basename(doc.name,extname(doc.name))+'_Copia.pdf'):doc.path??doc.name,filters:[{name:'Documento PDF',extensions:['pdf']}]});if(result.canceled||!result.filePath)return null;path=result.filePath;if(!path.toLowerCase().endsWith('.pdf'))path+='.pdf';}
 await refusesSignedOverwrite(protectedPath,path,changed||!!(protectedPath&&doc.path&&!await sameFilePath(protectedPath,doc.path)));
 const revision=doc.revision;
 try{await atomicWrite(path,await store.materialize(id));}catch(error){
  if(['EPERM','EACCES','EBUSY'].includes((error as NodeJS.ErrnoException).code??''))throw new Error('Não foi possível salvar neste arquivo. Ele pode estar aberto em outro programa ou a pasta não permite gravação. Feche o outro leitor ou use Salvar como para gravar uma cópia em outra pasta.',{cause:error});
  throw error;
 }
 doc.path=path;doc.name=basename(path);doc.savedRevision=revision;notify();return path;
}
type PromptRequest={title:string;message:string;detail?:string;buttons:string[];defaultId:number;cancelId:number;tone?:'question'|'danger'|'info'};
const prompts=new Map<string,{view:View;cancel:number;resolve:(index:number)=>void}>();
/** Asks inside the app's own styled dialog instead of a native Windows message box. */
function ask(view:View,request:PromptRequest):Promise<number>{
 if(view.window.isDestroyed())return Promise.resolve(request.cancelId);
 const locale=languages().locale;request={...request,title:localize(request.title,locale),message:localize(request.message,locale),detail:request.detail?localize(request.detail,locale):undefined,buttons:request.buttons.map(button=>localize(button,locale))};
 const id=randomUUID();view.window.show();view.window.focus();
 return new Promise(resolve=>{prompts.set(id,{view,cancel:request.cancelId,resolve});view.window.webContents.send('gcp:prompt',{id,...request});});
}
function settlePrompts(view:View){for(const [id,prompt] of prompts)if(prompt.view===view){prompts.delete(id);prompt.resolve(prompt.cancel);}}
async function confirmClose(view:View,id:string){const doc=store.get(id);if(doc.revision===doc.savedRevision)return true;const response=await ask(view,{title:'Alterações não salvas',message:`Deseja salvar as alterações em “${doc.name}”?`,detail:'Se descartar, as edições feitas desde o último salvamento serão perdidas.',buttons:['Salvar','Descartar alterações','Cancelar'],defaultId:0,cancelId:2,tone:'question'});if(response===2)return false;if(response===0)return !!(await save(view,id));return true;}
async function closeTab(view:View,id:string){own(view,id);if(!(await confirmClose(view,id)))return;view.ids=view.ids.filter(value=>value!==id);if(view.active===id)view.active=view.ids.at(-1);if(![...views.values()].some(v=>v.ids.includes(id)))store.remove(id);notify();}
function secureWindow(window:BrowserWindow,hash=''){
 window.webContents.setWindowOpenHandler(()=>({action:'deny'}));window.webContents.on('will-navigate',event=>event.preventDefault());window.webContents.on('will-attach-webview',event=>event.preventDefault());
 if(!app.isPackaged&&process.env.VITE_DEV_SERVER_URL)void window.loadURL(process.env.VITE_DEV_SERVER_URL+(hash?'#'+hash:''));else void window.loadFile(join(__dirname,'../renderer/index.html'),hash?{hash}:undefined);
}
const preferences={preload:join(__dirname,'preload.cjs'),contextIsolation:true,nodeIntegration:false,sandbox:true,spellcheck:false,webSecurity:true};
function createWindow(ids:string[]=[]){
 const window=new BrowserWindow({width:1420,height:940,minWidth:940,minHeight:660,show:false,title:'GCP-PDF',backgroundColor:settings.theme==='dark'?'#11121a':'#f6f5fa',icon:join(assets(),'icon.png'),autoHideMenuBar:true,webPreferences:preferences});
 // The ribbon is the menu; the native bar stays hidden (its accelerators keep working).
 window.setMenuBarVisibility(false);
 const windowId=window.webContents.id,view:View={window,ids,active:ids[0],allowClose:false};views.set(windowId,view);
 // A new main window opens maximized; detached tabs get their half-screen bounds from the caller.
 window.on('ready-to-show',()=>{if(!ids.length)window.maximize();window.show();notify();});
 window.on('close',event=>{if(view.allowClose||shuttingDown)return;if(view.ids.some(id=>store.get(id).revision!==store.get(id).savedRevision)){event.preventDefault();void(async()=>{for(const id of [...view.ids])if(!(await confirmClose(view,id)))return;view.allowClose=true;window.close();})().catch(error=>dialog.showErrorBox('Não foi possível fechar',String(error.message||error)));}});
 window.on('closed',()=>{settlePrompts(view);certificateFiles.forget(windowId);views.delete(windowId);for(const id of view.ids)if(![...views.values()].some(v=>v.ids.includes(id)))store.remove(id);});
 secureWindow(window);return view;
}
function mainView(){return [...views.values()].find(view=>!view.window.isDestroyed())??createWindow();}
async function openPaths(view:View,paths?:string[]){
 if(!paths){const result=await openDialog(view.window,{title:'Abrir arquivos',properties:['openFile','multiSelections'],filters:[{name:'Documentos, imagens e livros',extensions:OPENABLE.map(e=>e.slice(1))},{name:'Livro digital EPUB',extensions:['epub']},{name:'Todos os arquivos',extensions:['*']}]});if(result.canceled)return;paths=result.filePaths;}
 if(!Array.isArray(paths)||paths.length>200)throw new Error('Selecione até 200 arquivos por vez.');
 try{for(const [n,path] of paths.entries()){
  if(typeof path!=='string')throw new Error('Caminho de arquivo inválido.');
  if(BOOK_EXTENSIONS.includes(extname(path).toLowerCase())){openBook(view,path);continue;}
  const existing=store.all().find(d=>d.path===path);
  if(existing){const owner=[...views.values()].find(v=>v.ids.includes(existing.id));if(owner){owner.active=existing.id;owner.window.focus();continue;}}
  const info=await stat(path).catch((error:NodeJS.ErrnoException)=>{throw new Error(error.code==='ENOENT'?'O arquivo não foi encontrado. Ele pode ter sido movido ou removido. Use Abrir documentos para localizá-lo novamente.':error.code==='EACCES'||error.code==='EPERM'?'O sistema não permitiu abrir esse arquivo. Verifique as permissões de acesso.':'Não foi possível acessar esse arquivo. Verifique se ele está disponível e tente novamente.');});if(!info.isFile()||info.size>512*1024*1024)throw new Error('Abra um arquivo de até 512 MB.');
  const office=!['.pdf','.png','.jpg','.jpeg','.webp','.bmp'].includes(extname(path).toLowerCase());
  action(view,`progress:${office?'Convertendo':'Abrindo'} ${basename(path)}${paths.length>1?` (${n+1} de ${paths.length})`:''}…`);
  const bytes=await readPdf(path),isPdf=extname(path).toLowerCase()==='.pdf';
  const id=await store.add(bytes,isPdf?basename(path):basename(path,extname(path))+'.pdf',isPdf?path:undefined,source=>{action(view,'progress:Montando formulário XFA…');return engine.staticForm(source);});
  activate(view,id);const notice=store.get(id).notice;if(notice)action(view,'notice:'+notice);
 }
 }finally{action(view,'progress:');notify();}
}
/** Converts an engine rectangle (top-left points of the page as displayed with its own /Rotate) into
 * the document's unrotated page space. */
function engineRect(size:{width:number;height:number;rotation:number},[x0,y0,x1,y1]:[number,number,number,number]):Rect{const a=toPage(x0,y0,size,size.rotation,1),b=toPage(x1,y1,size,size.rotation,1);return {x:Math.min(a.x,b.x),y:Math.min(a.y,b.y),width:Math.abs(b.x-a.x),height:Math.abs(b.y-a.y)};}
/** Turns an unrotated page offset into the engine's displayed offset (right/down positive). */
function engineOffset(rotation:number,dx:number,dy:number){switch(rotation){case 90:return {dx:-dy,dy:dx};case 180:return {dx:-dx,dy:-dy};case 270:return {dx:dy,dy:-dx};default:return {dx,dy};}}
async function engineEdit(view:View,id:string,page:string,run:(base:string,bytes:()=>Uint8Array,src:number,rotation:number)=>Promise<Uint8Array>){
 const ref=pageRef(view,id,page),revision=store.get(id).revision,size=store.baseInfo(ref.base).pages[ref.src]!;
 const bytes=await run(ref.base,()=>store.base(ref.base),ref.src,size.rotation);
 try{const next=await store.swapBase(id,ref.base,bytes,revision);engine.rekey(ref.base,next);}
 catch(error){await engine.forget(ref.base);throw error;}
 finally{notify();}
}
const LEVELS:Record<string,Record<string,unknown>>={
 lossless:{color:{downsample:false,compression:'retain'},gray:{downsample:false,compression:'retain'}},
 high:{color:{downsample:true,ppi:200,above_ppi:300,compression:'jpeg',quality:85},gray:{downsample:true,ppi:200,above_ppi:300,compression:'jpeg',quality:85}},
 medium:{color:{downsample:true,ppi:150,above_ppi:225,compression:'jpeg',quality:60},gray:{downsample:true,ppi:150,above_ppi:225,compression:'jpeg',quality:60}},
 low:{color:{downsample:true,ppi:110,above_ppi:165,compression:'jpeg',quality:45},gray:{downsample:true,ppi:110,above_ppi:165,compression:'jpeg',quality:45}},
 extreme:{color:{downsample:true,ppi:72,above_ppi:100,compression:'jpeg',quality:30},gray:{downsample:true,ppi:72,above_ppi:100,compression:'jpeg',quality:30}},
};
/** Compressed copies by document revision and settings, so previewing then applying runs once. */
const compressed=new Map<string,{revision:number;bytes:Uint8Array;original:number}>();
async function compressDocument(id:string,options:CompressOptions){
 if(!options||!LEVELS[options.level])throw new Error('Escolha um nível de compressão.');
 const doc=store.get(id),key=`${id}:${JSON.stringify(options)}`,known=compressed.get(key);
 if(known&&known.revision===doc.revision)return known;
 const source=await store.materialize(id),discard=[options.metadata&&'metadata',options.bookmarks&&'bookmarks',options.attachments&&'attachments',options.comments&&'comments',options.comments&&'form-fields'].filter(Boolean);
 let bytes:Uint8Array=await engine.optimize(source,{preset:'standard',discard_thumbnails:true,object_streams:true,lzw_to_flate:true,flate_unencoded:true,merge_fragments:true,...LEVELS[options.level],...(discard.length?{discard}:{})});
 if(bytes.length>=source.length)bytes=source;
 const entry={revision:doc.revision,bytes,original:source.length};compressed.set(key,entry);return entry;
}
function quickState(window:BrowserWindow){const quick=quicks.get(window.webContents.id);if(!quick)throw new Error('Esta janela de ação rápida foi fechada.');return quick;}
function pageList(range:string,count:number){
 const text=(range??'').trim();if(!text||/^tudo$/i.test(text))return undefined;
 const pages:number[]=[];
 for(const part of text.split(/[,;]/)){const match=/^\s*(\d+)\s*(?:-\s*(\d+)\s*)?$/.exec(part);if(!match)throw new Error(`Intervalo inválido: “${part.trim()}”. Use, por exemplo, 1-3, 5.`);const from=Number(match[1]),to=Number(match[2]??match[1]);if(from<1||to<from||to>count)throw new Error(`O intervalo “${part.trim()}” está fora das ${count} páginas.`);for(let page=from;page<=to;page++)pages.push(page-1);}
 return pages;
}
async function uniquePath(folder:string,name:string){const ext=extname(name),stem=basename(name,ext);let path=join(folder,name);for(let n=2;existsSync(path);n++)path=join(folder,`${stem} (${n})${ext}`);return path;}
async function countPages(quick:Quick){
 for(const file of quick.state.files){if(file.pages!==undefined||file.error)continue;try{file.pages=extname(file.path).toLowerCase()==='.pdf'?(await store.inspectPages(new Uint8Array(await readFile(file.path)))):1;}catch(error){file.error=error instanceof Error?error.message:String(error);}if(!quick.window.isDestroyed())quick.window.webContents.send('gcp:quick',quick.state);}
}
function createQuickWindow(action:'combine'|'convert',paths:string[]){
 const window=new BrowserWindow({width:880,height:600,minWidth:640,minHeight:440,show:false,title:action==='combine'?'Combinar arquivos — GCP-PDF':'Converter para PDF — GCP-PDF',backgroundColor:settings.theme==='dark'?'#11121a':'#f6f5fa',icon:join(assets(),'icon.png'),autoHideMenuBar:true,webPreferences:preferences});
 window.setMenuBarVisibility(false);
 const quick:Quick={window,state:{action,files:[],theme:settings.theme}},contentsId=window.webContents.id;quicks.set(contentsId,quick);
 // webContents is already destroyed when 'closed' fires; keep the id captured at creation.
 window.on('closed',()=>quicks.delete(contentsId));
 window.on('ready-to-show',()=>{window.show();window.focus();});
 secureWindow(window,'quick');addQuickFiles(quick,paths);return quick;
}
function addQuickFiles(quick:Quick,paths:string[]){
 for(const path of paths)if(!quick.state.files.some(file=>file.path===path))quick.state.files.push({path,name:basename(path)});
 if(!quick.window.isDestroyed())quick.window.webContents.send('gcp:quick',quick.state);void countPages(quick);
}
function registerIpc(){
 const handlers:Record<string,(view:View,...args:any[])=>unknown>={
  moveDocumentTab:(view,id,beforeId)=>{own(view,id);if(beforeId!==undefined)own(view,beforeId);if(id===beforeId)return;const ids=view.ids.filter(item=>item!==id);ids.splice(beforeId===undefined?ids.length:ids.indexOf(beforeId),0,id);view.ids=ids;notify();},
  setLanguage:async(_view,language,ocr)=>{await settings.setLanguage(language,ocr);makeMenu();const next=languages();for(const item of [...views.values(),...quicks.values()])if(!item.window.isDestroyed())item.window.webContents.send('gcp:language',next);return next;},
  getWorkspace:view=>state(view),getComparisonPdf:async(view,id)=>{own(view,id);return store.materialize(id);},setFullscreen:(view,enabled?:boolean)=>{const next=enabled??!view.window.isFullScreen();view.window.setFullScreen(next);return next;},
  answerPrompt:(view,id:string,index:number)=>{const prompt=prompts.get(id);if(!prompt||prompt.view!==view)return;prompts.delete(id);prompt.resolve(Number.isInteger(index)?index:prompt.cancel);},
  editSourceImage:async(view,id,page:string,input:{image:number;action:string;from?:Rect;to?:Rect;quarters?:number;dataUrl?:string})=>{
   const actions=['move','resize','rotate','flip_horizontal','flip_vertical','replace','delete'];
   if(!input||!Number.isSafeInteger(input.image)||input.image<1||!actions.includes(input.action))throw new Error('Edição de imagem inválida.');
   let file:string|undefined;
   try{
    await engineEdit(view,id,page,async(base,bytes,src)=>{
     const size=store.baseInfo(base).pages[src]!,box=(r:Rect)=>{const a=fromPage(r.x,r.y,size,size.rotation,1),b=fromPage(r.x+r.width,r.y+r.height,size,size.rotation,1);return [Math.min(a.x,b.x),Math.min(a.y,b.y),Math.max(a.x,b.x),Math.max(a.y,b.y)];};
     const args:Record<string,unknown>&{image:number;action:string;from?:number[];to?:number[]}={image:input.image,action:input.action};
     if(input.action==='rotate')args.quarters=input.quarters===-1?3:1;
     if((input.action==='move'||input.action==='resize')&&input.from&&input.to){args.from=box(input.from);args.to=box(input.to);if(input.action==='move'){args.action='resize';}}
     if(input.action==='replace'){const m=/^data:image\/(png|jpe?g);base64,([A-Za-z0-9+/=]+)$/i.exec(input.dataUrl??'');if(!m)throw new Error('Imagem de substituição inválida.');file=join(engineRoot(),`substituta-${randomUUID()}.${m[1]!.toLowerCase().startsWith('png')?'png':'jpg'}`);await writeFile(file,Buffer.from(m[2]!,'base64'),{flag:'wx',mode:0o600});args.path=basename(file);}
     return engine.imageEdit(base,bytes,src,args);
    });
   }finally{if(file)await rm(file,{force:true}).catch(()=>{});}
  },
  exportSourceImage:async(view,id,page:string,image:number,save:boolean)=>{
   const ref=pageRef(view,id,page),name=`imagem-${randomUUID()}.png`;
   if(!Number.isSafeInteger(image)||image<1)throw new Error('Imagem inválida.');
   const result=await engine.imageSave(ref.base,()=>store.base(ref.base),ref.src,image,name);
   const written=String(result?.path??name).split(/[\\/]/).pop()!,path=join(engineRoot(),written);
   try{
    const data=await readFile(path),jpeg=/\.jpe?g$/i.test(written);
    if(save){const target=await saveDialog(view.window,{title:'Salvar imagem',defaultPath:`imagem.${jpeg?'jpg':'png'}`,filters:[{name:'Imagem',extensions:[jpeg?'jpg':'png']}]});if(target.canceled||!target.filePath)return null;await atomicWrite(target.filePath,new Uint8Array(data));return target.filePath;}
    return `data:image/${jpeg?'jpeg':'png'};base64,${data.toString('base64')}`;
   }finally{await rm(path,{force:true}).catch(()=>{});}
  },
  getUpdateStatus:()=>updateStatus(),
  whatsNew:async()=>{
   const version=app.getVersion(),seen=settings.seenVersion;
   if(seen===version)return null;
   await settings.setSeenVersion(version);
   if(!seen)return null; // first install: nothing "new" to announce
   try{const list=JSON.parse(await readFile(join(assets(),'novidades.json'),'utf8')) as {versao:string;data:string;itens:string[]}[];return list.find(v=>v.versao===version)??null;}catch{return null;}
  },
  saveUpdateSettings:async(_view,input:{frequency?:string})=>{
   const frequencies=['never','startup','daily','weekly','biweekly','monthly'];
   if(input?.frequency!==undefined&&!frequencies.includes(input.frequency))throw new Error('Frequência de verificação inválida.');
   const patch:Partial<UpdatePreferences>={};if(input.frequency)patch.frequency=input.frequency as UpdatePreferences['frequency'];
   await settings.setUpdates(patch);return updateStatus();
  },
  checkUpdates:async view=>{action(view,'progress:Verificando atualizações no GitHub…');try{pendingUpdate=await checkForUpdate();await settings.setUpdates({lastCheck:Date.now()});return pendingUpdate;}finally{action(view,'progress:');}},
  pendingUpdate:()=>pendingUpdate,
  installUpdate:async view=>{
   if(!pendingUpdate)throw new Error('Nenhuma atualização pendente. Verifique novamente.');
   if(!app.isPackaged)throw new Error('A atualização automática só funciona no aplicativo instalado.');
   for(const v of views.values())for(const id of v.ids){const d=store.get(id);if(d.revision!==d.savedRevision)throw new Error('Salve ou feche os documentos com alterações antes de atualizar.');}
   try{await installUpdate(pendingUpdate,(done,total)=>action(view,`progress:Baixando a versão ${pendingUpdate!.version}: ${Math.round(done/1048576)} de ${Math.max(1,Math.round(total/1048576))} MB…`));}
   finally{action(view,'progress:');}
   if(process.platform==='win32')for(const v of views.values())v.allowClose=true;
  },
  listBookmarks:async(view,id)=>{
   const doc=own(view,id),bases=new Set(doc.model.pages.map(p=>p.base));if(bases.size!==1)return [];
   const base=doc.model.pages[0]!.base,index=new Map(doc.model.pages.map((p,i)=>[p.src,i]));
   const map=(b:any):Bookmark=>({path:b.path,title:String(b.title??''),page:typeof b.page==='number'?index.get(b.page-1)??-1:-1,top:b.destination?.top??null,open:!!b.open,bold:!!b.bold,children:(b.children??[]).map(map)});
   return (await engine.bookmarks(base,()=>store.base(base))).map(map);
  },
  editBookmarks:async(view,id,edit:BookmarkEdit)=>{
   const doc=own(view,id),bases=new Set(doc.model.pages.map(p=>p.base));
   if(bases.size!==1)throw new Error('Salve o documento antes de editar os marcadores (ele foi montado a partir de vários arquivos).');
   const path=(p:unknown)=>{if(!Array.isArray(p)||!p.length||p.length>32||p.some(n=>!Number.isInteger(n)||n<1))throw new Error('Marcador inválido.');return p as number[];};
   const title=(t:unknown)=>{if(typeof t!=='string'||!t.trim()||t.length>500)throw new Error('Dê um nome ao marcador.');return t.trim();};
   const target=(page:unknown)=>{const ref=doc.model.pages[Number(page)];if(!ref)throw new Error('A página do marcador não existe.');return ref.src+1;};
   let steps:{tool:string;args:Record<string,unknown>}[]=[],count=1;
   switch(edit?.type){
    case 'add':steps=[{tool:'bookmark_add',args:{title:title(edit.title),page:target(edit.page),...(Number.isFinite(edit.top)?{top:Math.max(0,edit.top!)}:{}),...(edit.parent?{parent:path(edit.parent)}:{}),...(edit.position?{position:edit.position}:{})}}];break;
    case 'rename':steps=[{tool:'bookmark_rename',args:{path:path(edit.path),title:title(edit.title)}}];break;
    case 'delete':steps=[{tool:'bookmark_delete',args:{path:path(edit.path)}}];break;
    case 'move':steps=[{tool:'bookmark_move',args:{path:path(edit.path),...(edit.parent?{parent:path(edit.parent)}:{}),...(edit.position?{position:edit.position}:{})}}];break;
    case 'set-page':steps=[{tool:'bookmark_set_page',args:{path:path(edit.path),page:target(edit.page)}}];break;
    case 'style':steps=[{tool:'bookmark_set_style',args:{path:path(edit.path),bold:!!edit.bold}}];break;
    case 'auto':{
     // Headings by font size (titles are clearly larger than the body), nested by size, like "Marcadores automáticos".
     action(view,'progress:Procurando títulos para os marcadores…');
     try{
      const found=await headings(await store.materialize(id,false),(done,total)=>action(view,`progress:Lendo página ${done} de ${total}…`));
      if(!found.length)throw new Error('Não encontrei títulos destacados (texto maior que o corpo) para criar marcadores.');
      const sizes=[...new Set(found.map(h=>h.level))].sort((a,b)=>b-a),parents:number[][]=[],counters:number[]=[];
      const existing=(await engine.bookmarks(doc.model.pages[0]!.base,()=>store.base(doc.model.pages[0]!.base))).length;
      let top=existing;
      for(const h of found){
       const level=Math.min(2,sizes.indexOf(h.level));
       if(level===0){top++;parents[0]=[top];counters[1]=0;steps.push({tool:'bookmark_add',args:{title:h.title,page:doc.model.pages[h.page]!.src+1,top:h.top}});}
       else{const parent=parents[level-1]??parents[0];if(!parent){top++;parents[0]=[top];steps.push({tool:'bookmark_add',args:{title:h.title,page:doc.model.pages[h.page]!.src+1,top:h.top}});continue;}counters[level]=(counters[level]??0)+1;const me=[...parent,counters[level]!];parents[level]=me;for(let k=level+1;k<3;k++)counters[k]=0;steps.push({tool:'bookmark_add',args:{title:h.title,page:doc.model.pages[h.page]!.src+1,top:h.top,parent}});}
      }
      count=found.length;
     }finally{action(view,'progress:');}
     break;
    }
    default:throw new Error('Operação de marcador inválida.');
   }
   await engineEdit(view,id,doc.model.pages[0]!.id,(base,bytes)=>engine.bookmarkEdit(base,bytes,steps));
   return count;
  },
  getImageFields:(view,id:string)=>{if(!view.ids.some(doc=>store.get(doc).model.pages.some(page=>page.base===id)))throw new Error('Esta versão do documento não pertence a esta janela.');return imageFields(store.base(id));},
  /** Image field: the user picks a picture and it is shown in the field (Acrobat's "Importar ícone"). */
  setFieldImage:async(view,id,page:string,field:string)=>{
   if(typeof field!=='string'||!field)throw new Error('Campo inválido.');
   const result=await openDialog(view.window,{title:'Escolher imagem para o campo',properties:['openFile'],filters:[{name:'Imagem',extensions:['png','jpg','jpeg','gif','bmp','tif','tiff']}]});
   if(result.canceled||!result.filePaths[0])return;
   if((await stat(result.filePaths[0])).size>20*1024*1024)throw new Error('Use uma imagem de até 20 MB.');
   const image=new Uint8Array(await readFile(result.filePaths[0])),extension=extname(result.filePaths[0]).toLowerCase();
   await engineEdit(view,id,page,(base,bytes,src)=>engine.fieldImage(base,bytes,src,field,image,extension));
  },
  /** Links from form buttons open only after the user confirms, and only web or e-mail addresses. */
  openFormLink:async(view,url:string)=>{
   let target:URL;try{target=new URL(url);}catch{throw new Error('O botão aponta para um endereço inválido.');}
   if(!['https:','http:','mailto:'].includes(target.protocol))throw new Error('Por segurança, o GCP-PDF só abre links da web ou de e-mail.');
   const answer=await ask(view,{title:'Abrir link do formulário',message:`Este botão quer abrir: ${target.href.slice(0,200)}`,detail:'Abra apenas se confiar na origem deste PDF.',buttons:['Abrir','Cancelar'],defaultId:1,cancelId:1,tone:'question'});
   if(answer===0)await shell.openExternal(target.href);
  },
  getFieldFormats:(view,id:string)=>{if(!view.ids.some(doc=>store.get(doc).model.pages.some(page=>page.base===id)))throw new Error('Esta versão do documento não pertence a esta janela.');return fieldFormats(store.base(id));},
  getBase:(view,id:string)=>{if(!view.ids.some(doc=>store.get(doc).model.pages.some(page=>page.base===id)))throw new Error('Esta versão do documento não pertence a esta janela.');return store.viewerBase(id);},
  getAsset:(view,id:string)=>{if(!view.ids.some(doc=>store.get(doc).model.objects.some(o=>o.kind==='image'&&o.asset===id)))throw new Error('Esta imagem não pertence a esta janela.');return store.asset(id);},
  openFiles:(view,paths)=>openPaths(view,paths),
  openFiscalXml:async view=>{const result=await openDialog(view.window,{title:'Abrir XML de nota fiscal',properties:['openFile','multiSelections'],filters:[{name:'XML de nota fiscal (NF-e, NFC-e, NFS-e)',extensions:['xml']}]});if(result.canceled||!result.filePaths.length)return;await openPaths(view,result.filePaths);},
  newDocument:async view=>activate(view,await store.blank()),
  activateDocument:(view,id)=>{own(view,id);activate(view,id);},
  closeDocument:closeTab,
  newWindow:()=>{createWindow();},
  openQuick:(_view,kind)=>{if(kind!=='combine'&&kind!=='convert')throw new Error('Ação rápida inválida.');const existing=quickTarget(kind);if(existing)existing.window.focus();else createQuickWindow(kind,[]);},
  detachDocument:(view,id)=>{own(view,id);const bounds=view.window.getBounds(),display=screen.getDisplayMatching(bounds).workArea;const next=createWindow([id]);view.ids=view.ids.filter(value=>value!==id);view.active=view.ids.at(-1);const width=Math.floor(display.width/2);view.window.setBounds({x:display.x,y:display.y,width,height:display.height});next.window.setBounds({x:display.x+width,y:display.y,width:display.width-width,height:display.height});notify();},
  attachDocument:(view,id,sourceId)=>{const source=views.get(sourceId);if(!source||!source.ids.includes(id))throw new Error('A aba não está mais disponível na janela de origem.');if(source===view){activate(view,id);return;}source.ids=source.ids.filter(value=>value!==id);source.active=source.ids.at(-1);activate(view,id);if(!source.ids.length&&!source.window.isDestroyed()){source.allowClose=true;source.window.close();}notify();},
  applyOperation:async(view,id,operation:PdfOperation&{dataUrl?:string},revision:number)=>{own(view,id);try{await store.apply(id,operation,revision,operation?.type==='add-object'?operation.dataUrl:undefined);}finally{notify();}},
  transferPages:async(view,input)=>{own(view,input.targetId);if(![...views.values()].some(v=>v.ids.includes(input.sourceId)))throw new Error('A janela de origem foi fechada.');try{await store.transfer(input);}finally{notify();}},
  undo:async(view,id)=>{own(view,id);try{await store.undo(id);}finally{notify();}},
  redo:async(view,id)=>{own(view,id);try{await store.redo(id);}finally{notify();}},
  saveDocument:(view,id,saveAs)=>{action(view,'progress:Salvando…');return save(view,id,!!saveAs).finally(()=>action(view,'progress:'));},
  combineDocuments:async(view,ids:string[])=>{for(const id of ids)own(view,id);activate(view,await store.combine(ids));},
  analyzeEpub:async(view,id)=>{own(view,id);action(view,'progress:Procurando capítulos e notas de rodapé…');try{return await analyzeEpub(await store.materialize(id),message=>action(view,'progress:'+message));}finally{action(view,'progress:');}},
  epubPagePreview:async(view,id,page:number)=>{own(view,id);const image=await renderPdfPage(await store.materialize(id),page,110);return `data:image/png;base64,${Buffer.from(image.bytes).toString('base64')}`;},
  exportEpub:async(view,id,options:EpubOptions)=>{
   const doc=own(view,id);
   if(!options||typeof options.title!=='string'||typeof options.author!=='string'||!['pt-BR','en','es'].includes(options.language)||!Array.isArray(options.chapters)||options.chapters.length>5000||options.chapters.some(c=>typeof c?.title!=='string'||!Number.isInteger(c.page)||![1,2].includes(c.level))||(options.cover!==undefined&&(typeof options.cover!=='string'||options.cover.length>30*1024*1024)))throw new Error('Dados do livro inválidos.');
   const name=(options.title.trim()||basename(doc.name,extname(doc.name))).replace(/[\\/:*?"<>|]/g,'').slice(0,120);
   const result=await saveDialog(view.window,{title:'Salvar livro digital (EPUB)',defaultPath:join(doc.path?dirname(doc.path):app.getPath('documents'),`${name}.epub`),filters:[{name:'Livro digital EPUB',extensions:['epub']}]});
   if(result.canceled||!result.filePath)return null;
   let path=result.filePath;if(!path.toLowerCase().endsWith('.epub'))path+='.epub';
   action(view,'progress:Gerando o EPUB…');
   try{await atomicWrite(path,await toEpub(await store.materialize(id),options,message=>action(view,'progress:'+message)));return path;}finally{action(view,'progress:');}
  },
  openBookFile:async(view,path?:string)=>{
   if(path===undefined){const result=await openDialog(view.window,{title:'Abrir livro digital',properties:['openFile'],filters:[{name:'Livro digital EPUB',extensions:['epub']}]});if(result.canceled||!result.filePaths[0])return;path=result.filePaths[0];}
   if(typeof path!=='string'||extname(path).toLowerCase()!=='.epub')throw new Error('Escolha um arquivo EPUB.');
   openBook(view,path);
  },
  readBook:async(_view,token:string)=>{
   const entry=typeof token==='string'?books.get(token):undefined;if(!entry)throw new Error('O livro não está mais disponível. Abra o arquivo de novo.');
   if(!entry.parsed){const info=await stat(entry.path);if(info.size>300*1024*1024)throw new Error('Abra um livro de até 300 MB.');entry.parsed=readBook(new Uint8Array(await readFile(entry.path)));}
   return {...entry.parsed,token,name:basename(entry.path)};
  },
  exportDocument:async(view,id,options:ExportOptions)=>{
   const doc=own(view,id);
   if(!['pdf','image-pdf','docx','xlsx','pptx','png','txt'].includes(options?.format))throw new Error('Formato de exportação inválido.');
   const extension=options.format==='image-pdf'?'pdf':options.format;
   const result=await saveDialog(view.window,{title:'Exportar documento',defaultPath:basename(doc.name,extname(doc.name))+(options.format==='image-pdf'?' (imagem)':'')+'.'+extension,filters:[{name:extension.toUpperCase(),extensions:[extension]}]});
   if(result.canceled||!result.filePath)return null;
   action(view,'progress:Preparando a exportação local…');
   try{
    const bytes=await store.materialize(id);
    // Scanned pages have no text of their own: they are recognized locally first, as desktop converters do.
    const scanned=['docx','xlsx','pptx','txt'].includes(options.format)?await pagesWithoutText(bytes):[];
    const ocr=scanned.length?await recognizePages(view,bytes,scanned):null;
    const input=ocr?await addOcrTextLayer(bytes,ocr.layers):bytes;
    const output=options.format==='pdf'?{bytes,extension:'pdf',warnings:[] as string[]}:await convertPdf(input,options,message=>action(view,'progress:'+message),ocr?.runs);
    if(ocr)output.warnings.unshift(`${scanned.length===1?'A página '+(scanned[0]!+1)+' era uma imagem e foi reconhecida':'As páginas '+scanned.map(p=>p+1).join(', ')+' eram imagens e foram reconhecidas'} por OCR local. Confira o texto reconhecido.`);
    let path=result.filePath;if(!path.toLowerCase().endsWith('.'+output.extension))path+='.'+output.extension;
    if(output.extension==='pdf')await refusesSignedOverwrite(store.signedSourcePath(id),path,true);
    await atomicWrite(path,output.bytes);if(output.warnings.length)action(view,'notice:'+output.warnings.join('\n'));return path;
   }finally{action(view,'progress:');}
  },
  getSourceObjects:async(view,id,page:string):Promise<SourceObjects>=>{
   const ref=pageRef(view,id,page),size=store.baseInfo(ref.base).pages[ref.src]!;
   const found=await engine.objects(ref.base,()=>store.base(ref.base),ref.src);
   const faces=await Promise.all(found.paragraphs.map(p=>faceForPostscript(p.font,fontCache()).catch(()=>undefined)));
   const paragraphs=found.paragraphs.map((p,i)=>({index:p.index,text:p.text,rect:engineRect(size,p.rect),size:p.size,font:p.font.replace(/^[A-Z]{6}\+/,''),family:faces[i]?.legacy,bold:/bold|black|heavy|semibold|demi/i.test(p.font),italic:/italic|oblique/i.test(p.font),color:'#000000'}));
   const blocks=await editorBlockReader.read(store.base(ref.base),ref.src,paragraphs,size.rotation);
   return {generation:found.generation,images:found.images.map(image=>({index:image.index,rect:engineRect(size,image.rect)})),paragraphs:blocks,spacing:editorBlockReader.spacing(ref.src,size.rotation)};
  },
  editParagraph:(view,id,page:string,edit:ParagraphEdit)=>{
   if(!edit||!Number.isSafeInteger(edit.paragraph)||edit.paragraph<0)throw new Error('Escolha um parágrafo válido.');
   if(edit.text!==undefined&&(typeof edit.text!=='string'||edit.text.length>50_000))throw new Error('O texto do parágrafo é inválido.');
   if(edit.width!==undefined&&!(Number.isFinite(edit.width)&&edit.width>1&&edit.width<20_000))throw new Error('Largura de parágrafo inválida.');
   const spacing=(v:{charSpacing?:number;scale?:number})=>(v.charSpacing===undefined||(Number.isFinite(v.charSpacing)&&Math.abs(v.charSpacing)<200))&&(v.scale===undefined||(Number.isFinite(v.scale)&&v.scale>.1&&v.scale<10));
   if(edit.trackedLines!==undefined&&(!Array.isArray(edit.trackedLines)||edit.trackedLines.length>500||edit.trackedLines.some(l=>!Number.isSafeInteger(l?.line)||l.line<0||!(Number.isFinite(l.charSpacing)&&Math.abs(l.charSpacing)<200))))throw new Error('Espaçamento de linhas inválido.');
   if(!spacing(edit)||(edit.lineSpacing!==undefined&&!(Number.isFinite(edit.lineSpacing)&&edit.lineSpacing>=.5&&edit.lineSpacing<=5))||(Array.isArray(edit.members)&&edit.members.some(m=>!spacing(m))))throw new Error('Espaçamento de texto inválido.');
   if(edit.members!==undefined&&(!Array.isArray(edit.members)||edit.members.length<2||edit.members.length>1000||!Number.isSafeInteger(edit.generation)||new Set(edit.members.map(m=>m.paragraph)).size!==edit.members.length||edit.members.some(m=>!Number.isSafeInteger(m.paragraph)||m.paragraph<0||(m.text!==undefined&&(typeof m.text!=='string'||m.text.length>50_000))||(m.width!==undefined&&!(Number.isFinite(m.width)&&m.width>1&&m.width<20_000)))))throw new Error('Bloco de texto inválido.');
   return engineEdit(view,id,page,(base,bytes,src,rotation)=>{const offset=edit.dx!==undefined||edit.dy!==undefined?engineOffset(rotation,edit.dx??0,edit.dy??0):undefined;return engine.editParagraph(base,bytes,src,{...edit,...(offset?{dx:offset.dx,dy:-offset.dy}:{})});});
  },
  moveSourceObjects:(view,id,page:string,input)=>{
   if(!input||!Array.isArray(input.objects)||!input.objects.length||![input.dx,input.dy].every(Number.isFinite))throw new Error('Seleção inválida para mover.');
   return engineEdit(view,id,page,(base,bytes,src,rotation)=>{const offset=engineOffset(rotation,input.dx,input.dy);return engine.moveObjects(base,bytes,src,{generation:Number(input.generation),objects:input.objects,dx:offset.dx,dy:offset.dy});});
  },
  listFonts:()=>fontFamilies(fontCache()),
  copyPages:async(view,id,pages:number[],cut:boolean,revision:number)=>{
   own(view,id);
   // The clipboard holds its own copy of the pages, so it survives edits and closing the source; any window can paste.
   const previous=pageClipboard;pageClipboard=store.extract(id,pages,'Área de transferência.pdf');if(previous)store.remove(previous);
   if(cut){try{await store.apply(id,{type:'delete',pages},revision);}finally{notify();}}
   return pages.length;
  },
  pastePages:async(view,id,index:number,revision:number)=>{
   own(view,id);if(!pageClipboard)throw new Error('Nenhuma página copiada. Use Copiar ou Recortar nas miniaturas.');
   const count=store.info(pageClipboard).pageCount;
   try{await store.transfer({sourceId:pageClipboard,targetId:id,pages:Array.from({length:count},(_,i)=>i),index,move:false,sourceRevision:store.get(pageClipboard).revision,targetRevision:revision});}finally{notify();}
   return count;
  },
  addFormField:async(view,id,page:string,input:{type:FieldType;rect:Rect;options?:string[];name?:string})=>{
   if(!['text','date','checkbox','radio','combo','list','button','image','signature'].includes(input?.type)||!input.rect||![input.rect.x,input.rect.y,input.rect.width,input.rect.height].every(Number.isFinite))throw new Error('Campo de formulário inválido.');
   let name='';
   await engineEdit(view,id,page,async(base,bytes,src)=>{
    const size=store.baseInfo(base).pages[src]!,a=fromPage(input.rect.x,input.rect.y,size,size.rotation,1),b=fromPage(input.rect.x+input.rect.width,input.rect.y+input.rect.height,size,size.rotation,1);
    const args:Record<string,unknown>={type:input.type,rect:[Math.min(a.x,b.x),Math.min(a.y,b.y),Math.max(a.x,b.x),Math.max(a.y,b.y)]};
    if(input.name)args.name=String(input.name).slice(0,120);
    if((input.type==='combo'||input.type==='list')&&Array.isArray(input.options))args.options=input.options.map(String).filter(Boolean).slice(0,500);
    if(input.type==='text')args.multiline=input.rect.height>40;
    if(input.type==='button')args.caption='Botão';
    const result=await engine.addField(base,bytes,src,args);name=result.name;
    // Brazilian dates by default (the engine's default pattern is mm/dd/yyyy).
    if(input.type==='date'&&name)return engine.setFieldProps(base,()=>result.bytes,src,{field:name,format:FIELD_FORMATS.date});
    return result.bytes;
   });
   return name;
  },
  setFormFieldProps:async(view,id,page:string,field:string,props:FieldProps)=>{
   if(typeof field!=='string'||!field||!props||typeof props!=='object')throw new Error('Campo de formulário inválido.');
   const args:Record<string,unknown>={field};
   const color=(v:unknown)=>typeof v==='string'&&/^(#[0-9a-f]{6}|none)$/i.test(v)?v:undefined;
   if(typeof props.name==='string'&&props.name.trim()&&props.name.trim()!==field)args.name=props.name.trim().slice(0,120);
   if(typeof props.tooltip==='string')args.tooltip=props.tooltip.slice(0,500);
   for(const key of ['required','read_only','multiline'] as const)if(typeof props[key]==='boolean')args[key]=props[key];
   if(Number.isFinite(props.font_size)&&props.font_size!>=0&&props.font_size!<=96)args.font_size=props.font_size;
   if(['left','center','right'].includes(props.align as string))args.align=props.align;
   if(['check','circle','cross','diamond','square','star'].includes(props.check_style as string))args.check_style=props.check_style;
   if(props.appearance){const a=props.appearance,appearance:Record<string,unknown>={};for(const key of ['border','fill','text_color'] as const){const c=color(a[key]);if(c)appearance[key]=c;}if(Number.isFinite(a.width)&&a.width!>=0&&a.width!<=12)appearance.width=a.width;if(['solid','dashed','beveled','inset','underline'].includes(a.style as string))appearance.style=a.style;if(Object.keys(appearance).length)args.appearance=appearance;}
   if(typeof props.format==='string'&&Object.hasOwn(FIELD_FORMATS,props.format))args.format=FIELD_FORMATS[props.format];
   if(Array.isArray(props.options))args.options=props.options.map(String).filter(Boolean).slice(0,500);
   if(typeof props.caption==='string')args.caption=props.caption.slice(0,200);
   let actions:Record<string,unknown>[]|undefined;
   const act=props.action;
   if(act&&typeof act==='object'){
    const web=(u:unknown)=>{try{const t=new URL(String(u));return ['https:','http:','mailto:'].includes(t.protocol)?t.href:null;}catch{return null;}};
    if(act.type==='none')actions=[];
    else if(act.type==='url'){const u=web(act.url);if(!u)throw new Error('Informe um endereço que comece com https:// ou mailto:.');actions=[{trigger:'mouse_up',url:u}];}
    else if(act.type==='submit'){const u=web(act.url);if(!u)throw new Error('Informe o destino do envio (https:// ou mailto:).');actions=[{trigger:'mouse_up',submit:u}];}
    else if(act.type==='page'){if(!Number.isInteger(act.page)||act.page<1)throw new Error('Informe a página de destino.');actions=[{trigger:'mouse_up',page:act.page}];}
    else if(act.type==='reset')actions=[{trigger:'mouse_up',reset:[]}];
    else if(act.type==='print')actions=[{trigger:'mouse_up',menu:'Print'}];
   }
   await engineEdit(view,id,page,async(base,bytes,src)=>{const out=await engine.setFieldProps(base,bytes,src,args);return actions?engine.fieldActions(base,()=>out,src,args.name?String(args.name):field,actions):out;});
  },
  detectFormFields:async(view,id)=>{
   const doc=own(view,id);let total=0;
   for(const base of [...new Set(doc.model.pages.map(p=>p.base))]){
    const pages=doc.model.pages.filter(p=>p.base===base).map(p=>p.src),revision=store.get(id).revision;
    action(view,'progress:Procurando campos de formulário…');
    const found=await engine.detectFields(base,()=>store.base(base),pages);
    if(found.count){total+=found.count;try{const next=await store.swapBase(id,base,found.bytes,revision);engine.rekey(base,next);}catch(error){await engine.forget(base);throw error;}}
   }
   action(view,'progress:');notify();return total;
  },
  exportFormData:async(view,id,format:'csv'|'xml'|'xfdf'|'txt')=>{
   const doc=own(view,id);if(!['csv','xml','xfdf','txt'].includes(format))throw new Error('Formato de dados inválido.');
   const target=await saveDialog(view.window,{title:'Exportar dados do formulário',defaultPath:`${basename(doc.name,extname(doc.name))} - dados.${format}`,filters:[{name:format.toUpperCase(),extensions:[format]}]});
   if(target.canceled||!target.filePath)return null;
   const out=await engine.onCopy(await store.materialize(id),async({doc:copy,output,call})=>{await call('doc_export_data',{doc:copy,path:output.replace(/\.pdf$/,'.'+format),what:format==='xfdf'?'all':'fields'});return output.replace(/\.pdf$/,'.'+format);});
   const bytes=await readFile(join(engineRoot(),out.result)).catch(()=>null);if(!bytes)throw new Error('O documento não tem campos de formulário com dados.');
   await atomicWrite(target.filePath,bytes);await rm(join(engineRoot(),out.result),{force:true}).catch(()=>{});return target.filePath;
  },
  protectDocument:async(view,id,options:ProtectOptions)=>{
   const doc=own(view,id);
   if(!options?.openPassword&&!options?.permissionsPassword)throw new Error('Defina uma senha de abertura ou de permissões.');
   if(options.openPassword&&options.permissionsPassword&&options.openPassword===options.permissionsPassword)throw new Error('A senha de permissões precisa ser diferente da senha de abertura.');
   const target=await saveDialog(view.window,{title:'Salvar PDF protegido',defaultPath:join(doc.path?dirname(doc.path):app.getPath('documents'),`${basename(doc.name,extname(doc.name))} (protegido).pdf`),filters:[{name:'Documento PDF',extensions:['pdf']}]});
   if(target.canceled||!target.filePath)return null;
   await refusesSignedOverwrite(store.signedSourcePath(id),target.filePath,true);
   action(view,'progress:Criptografando…');
   try{
    const out=await engine.onCopy(await store.materialize(id),async({doc:copy,output,call})=>{
     const args:Record<string,unknown>={doc:copy,compatibility:options.encryption??'aes-256'};
     if(options.openPassword)args.open_password=options.openPassword;
     if(options.permissionsPassword){args.permissions_password=options.permissionsPassword;args.printing=options.printing;args.changes=options.changes;args.copy=!!options.copy;}
     await call('doc_protect',args);await call('doc_save',{doc:copy,path:output});
    });
    if(!out.bytes)throw new Error('Não foi possível gerar o PDF protegido.');
    await atomicWrite(target.filePath,out.bytes);return target.filePath;
   }finally{action(view,'progress:');}
  },
  removeHiddenData:async(view,id,categories:string[])=>{
   const doc=own(view,id),revision=doc.revision;
   const out=await engine.onCopy(await store.materialize(id),async({doc:copy,output,call})=>{await call('doc_remove_hidden',{doc:copy,...(categories?.length?{categories}:{})});await call('doc_save',{doc:copy,path:output});});
   if(!out.bytes)throw new Error('Não foi possível limpar o documento.');
   try{await store.replaceDocument(id,out.bytes,revision);}finally{notify();}
  },
  listCertificates:async():Promise<Certificate[]>=>{
   const found=await engine.certificates();
   return (found?.ids??[]).map((item:any)=>{const c=item.certificate??{};return {id:String(item.id),name:String(c.name??c.subject??'Certificado'),issuer:String(c.issuer??'').replace(/^.*CN=/,''),validTo:String(c.valid_to??''),icp:/ICP-Brasil/i.test(String(c.issuer??'')+String(c.subject??'')),kind:/\bA3\b/.test(String(c.subject??''))?'A3':/\bA1\b/.test(String(c.subject??''))?'A1':''};});
  },
  chooseCertificate:async(view):Promise<Certificate|null>=>{
   const result=await openDialog(view.window,{title:'Escolher certificado A1',properties:['openFile'],filters:[{name:'Certificado digital A1',extensions:['pfx','p12']}]});
   if(result.canceled||!result.filePaths[0])return null;
   return certificateFiles.select(view.window.webContents.id,result.filePaths[0]);
  },
  signDocument:async(view,id,options:SignOptions)=>{
   const doc=own(view,id);
   const certificate=options?.certificate;
   const fromFile=typeof certificate==='string'&&certificate.startsWith('file:');
   if(typeof certificate!=='string'||!(fromFile||process.platform==='win32'&&/^windows:[0-9a-f]{40,64}$/i.test(certificate)||process.platform==='darwin'&&/^keychain:.+/.test(certificate)))throw new Error('Escolha um certificado digital deste sistema ou um arquivo A1 (.pfx/.p12).');
   if(options.password!==undefined&&typeof options.password!=='string')throw new Error('A senha do certificado deve ser um texto.');
   const target=await saveDialog(view.window,{title:'Salvar PDF assinado digitalmente',defaultPath:join(doc.path?dirname(doc.path):app.getPath('documents'),`${basename(doc.name,extname(doc.name))} (assinado).pdf`),filters:[{name:'Documento PDF',extensions:['pdf']}]});
   if(target.canceled||!target.filePath)return null;
   const original=store.signedSourcePath(id),differentPath=!!(original&&doc.path&&!await sameFilePath(original,doc.path));
   await refusesSignedOverwrite(original,target.filePath,doc.revision!==doc.savedRevision||differentPath);
   action(view,'progress:Assinando com o certificado digital… o sistema pode pedir autorização.');
   let graphic:string|undefined;
   try{
    const bytes=await store.materialize(id);
    await trustWindowsRoots();
    const out=await engine.onCopy(bytes,async({doc:copy,output,call})=>{
     const before=await call('sign_list',{doc:copy});
     const args:Record<string,unknown>={doc:copy,id:certificate,out:output,reason:options.reason||undefined,location:options.location||undefined};
     if(options.page&&options.rect){
      args.labels={signed_by:'Assinado digitalmente por',date:'Data: ',reason:'Motivo: ',location:'Local: ',distinguished_name:'DN: '};
      args.appearance={name:options.showName!==false,date:true,labels:true,reason:!!options.reason,location:!!options.location};
      const index=doc.model.pages.findIndex(p=>p.id===options.page);if(index<0)throw new Error('A página escolhida não existe mais.');
      const ref=doc.model.pages[index]!,info=store.baseInfo(ref.base).pages[ref.src]!,rotation=(info.rotation+ref.rotate)%360;
      const a=fromPage(options.rect.x,options.rect.y,info,rotation,1),b=fromPage(options.rect.x+options.rect.width,options.rect.y+options.rect.height,info,rotation,1);
      args.page=index+1;args.rect=[Math.min(a.x,b.x),Math.min(a.y,b.y),Math.max(a.x,b.x),Math.max(a.y,b.y)];
      if(options.signatureImage&&/^data:image\/(png|jpe?g);base64,/i.test(options.signatureImage)){graphic=join(engineRoot(),`assinatura-${Date.now()}.png`);await writeFile(graphic,Buffer.from(options.signatureImage.split(',')[1]!,'base64'),{mode:0o600});args.graphic={image:basename(graphic)};}
     }
     const sign=async(file?:string)=>call('sign_document',{...args,...(file?{id:file,password:options.password??''}:{})});
     const produced=fromFile?await certificateFiles.use(view.window.webContents.id,certificate,engineRoot(),sign):await sign();
     return {before,produced};
    });
    if(!out.bytes)throw new Error('A assinatura não foi concluída.');
    const verified=await engine.onCopy(out.bytes,async({doc:copy,call})=>call('sign_list',{doc:copy}));
    const signature=await validateNewSignature(out.bytes,out.result?.before,verified.result,out.result?.produced);
    await atomicWrite(target.filePath,out.bytes);
    if(!signature.trusted)action(view,'notice:A assinatura foi verificada criptograficamente, mas a cadeia do certificado não é reconhecida neste computador. Confira o resultado no validador do ITI.');
    return target.filePath;
   }finally{if(graphic)await rm(graphic,{force:true}).catch(()=>{});action(view,'progress:');}
  },
  checkSignatures:async(view,id)=>{
   own(view,id);
   await trustWindowsRoots();
   // Verify the displayed revision; unchanged materialization returns the exact signed bytes.
   const doc=store.get(id),modified=doc.revision!==doc.savedRevision&&(doc.revision>0||!store.unchanged(id));
   const out=await engine.onCopy(await store.materialize(id),async({doc:copy,call})=>call('sign_list',{doc:copy}));
   return signatureList(out.result).map(signature=>signatureSummary(signature,modified));
  },
  compressPreview:async(view,id,options:CompressOptions)=>{own(view,id);const result=await compressDocument(id,options);return {original:result.original,size:result.bytes.length};},
  compressApply:async(view,id,options:CompressOptions,mode:'apply'|'save')=>{
   const doc=own(view,id),result=await compressDocument(id,options);
   if(mode==='apply'){try{await store.replaceDocument(id,result.bytes,doc.revision);}finally{notify();}return null;}
   const stem=basename(doc.name,extname(doc.name)),target=await saveDialog(view.window,{title:'Salvar PDF comprimido',defaultPath:join(doc.path?dirname(doc.path):app.getPath('documents'),`${stem} (comprimido).pdf`),filters:[{name:'Documento PDF',extensions:['pdf']}]});
   if(target.canceled||!target.filePath)return null;await refusesSignedOverwrite(store.signedSourcePath(id),target.filePath,true);await atomicWrite(target.filePath,result.bytes);return target.filePath;
  },
  extractPages:async(view,id,pages:number[],mode:'tab'|'file'|'files')=>{
   const doc=own(view,id),stem=basename(doc.name,extname(doc.name));
   const output=await (async()=>{
    if(mode==='tab'){activate(view,store.extract(id,pages,`${stem} (páginas extraídas).pdf`));return 'tab';}
    if(mode==='file'){
     const result=await saveDialog(view.window,{title:'Extrair páginas',defaultPath:`${stem} - páginas.pdf`,filters:[{name:'Documento PDF',extensions:['pdf']}]});if(result.canceled||!result.filePath)return null;
     await refusesSignedOverwrite(store.signedSourcePath(id),result.filePath,true);
     const temp=store.extract(id,pages,'extraido.pdf');try{await atomicWrite(result.filePath,await store.materialize(temp));}finally{store.remove(temp);}return result.filePath;
    }
    const result=await openDialog(view.window,{title:'Pasta para as páginas',properties:['openDirectory','createDirectory']});if(result.canceled||!result.filePaths[0])return null;
    try{for(const [n,page] of [...pages].sort((a,b)=>a-b).entries()){action(view,`progress:Extraindo página ${n+1} de ${pages.length}…`);const temp=store.extract(id,[page],'p.pdf');try{await atomicWrite(await uniquePath(result.filePaths[0],`${stem} - página ${page+1}.pdf`),await store.materialize(temp));}finally{store.remove(temp);}}}finally{action(view,'progress:');}
    return result.filePaths[0];
   })();
   if(!output)return null;
   // Like PDFelement: the pages can also leave the original; keeping them is the default.
   if(pages.length<store.get(id).model.pages.length){
    const remove=await ask(view,{title:'Páginas extraídas',message:`Deseja remover ${pages.length>1?`as ${pages.length} páginas extraídas`:'a página extraída'} do documento original?`,detail:'Você pode desfazer com Ctrl+Z.',buttons:['Manter no original','Remover do original'],defaultId:0,cancelId:0,tone:'question'});
    if(remove===1){try{await store.apply(id,{type:'delete',pages},store.get(id).revision);}finally{notify();}}
   }
   return output==='tab'?null:output;
  },
  insertFromFile:async(view,id,index:number,revision:number)=>{
   own(view,id);const result=await openDialog(view.window,{title:'Inserir páginas de outro arquivo',properties:['openFile'],filters:[{name:'Documentos e imagens',extensions:INPUT_EXTENSIONS.map(e=>e.slice(1))}]});if(result.canceled||!result.filePaths[0])return;
   try{const count=await store.insertFile(id,await readPdf(result.filePaths[0]),index,revision);action(view,`notice:${count} página${count>1?'s inseridas':' inserida'}.`);}finally{notify();}
  },
  insertPaths:async(view,id,index:number,paths:string[],revision:number)=>{
   own(view,id);if(!Array.isArray(paths)||!paths.length||paths.length>200||paths.some(p=>typeof p!=='string'||!INPUT_EXTENSIONS.includes(extname(p).toLowerCase())))throw new Error('Arraste arquivos PDF, imagens ou documentos do Office.');
   let at=index,current=revision,total=0;
   try{for(const [n,path] of paths.entries()){action(view,`progress:Inserindo ${basename(path)} (${n+1} de ${paths.length})…`);const count=await store.insertFile(id,await readPdf(path),at,current);at+=count;total+=count;current=store.get(id).revision;}}
   finally{action(view,'progress:');notify();}
   action(view,`notice:${total} página${total>1?'s inseridas':' inserida'}.`);
  },
  replacePages:async(view,id,pages:number[],revision:number)=>{
   own(view,id);const result=await openDialog(view.window,{title:'Substituir pelas páginas de…',properties:['openFile'],filters:[{name:'Documentos e imagens',extensions:INPUT_EXTENSIONS.map(e=>e.slice(1))}]});if(result.canceled||!result.filePaths[0])return;
   try{const done=await store.replaceWith(id,pages,await readPdf(result.filePaths[0]),revision);action(view,`notice:${done.count} página${done.count>1?'s substituídas':' substituída'}${done.count<pages.length?` (o arquivo escolhido tem só ${done.available})`:''}.`);}finally{notify();}
  },
  splitDocument:async(view,id,input:{every?:number;maxMb?:number}|number)=>{
   const doc=own(view,id),options=typeof input==='number'?{every:input}:input??{};
   if(options.maxMb!==undefined&&!(Number.isFinite(options.maxMb)&&options.maxMb>0.05))throw new Error('Informe o tamanho máximo em MB.');
   if(options.maxMb===undefined&&!(Number.isInteger(options.every)&&options.every!>=1))throw new Error('Informe a quantidade de páginas por parte.');
   const result=await openDialog(view.window,{title:'Pasta para os arquivos divididos',properties:['openDirectory','createDirectory']});if(result.canceled||!result.filePaths[0])return null;
   const count=doc.model.pages.length,stem=basename(doc.name,extname(doc.name)),folder=result.filePaths[0];
   const render=async(pages:number[])=>{const temp=store.extract(id,pages,'parte.pdf');try{return await store.materialize(temp);}finally{store.remove(temp);}};
   const write=async(part:number,bytes:Uint8Array)=>atomicWrite(await uniquePath(folder,`${stem} - parte ${part}.pdf`),bytes);
   try{
    if(options.maxMb===undefined){
     const parts=Math.ceil(count/options.every!);
     for(let part=0;part<parts;part++){action(view,`progress:Gerando parte ${part+1} de ${parts}…`);await write(part+1,await render(Array.from({length:Math.min(options.every!,count-part*options.every!)},(_,i)=>part*options.every!+i)));}
     return folder;
    }
    // By size: grow each part page by page while it stays under the limit (a single larger page still forms its own part).
    const limit=options.maxMb*1024*1024;let part=1,start=0;
    while(start<count){
     action(view,`progress:Gerando parte ${part} (página ${start+1} de ${count})…`);
     let end=start+1,best=await render([start]);
     while(end<count){const next=await render(Array.from({length:end+1-start},(_,i)=>start+i));if(next.length>limit)break;best=next;end++;action(view,`progress:Gerando parte ${part} (página ${end} de ${count})…`);}
     await write(part++,best);start=end;
    }
    return folder;
   }finally{action(view,'progress:');}
  },
  getSavedColors:()=>settings.savedColors(),setSavedColors:(_view,colors)=>settings.setSavedColors(colors),getDictionaryPreferences:()=>settings.dictionary(),
  lookupSynonyms:(_view,text,lang)=>{if(typeof text!=='string'||text.length>200||!['pt','en','es'].includes(lang))throw new Error('Selecione uma palavra ou expressão curta.');return dictionaries.synonyms(text,lang);},
  lookupTranslation:(_view,text,from,to)=>{if(typeof text!=='string'||text.length>2000||!['pt','en','es','auto'].includes(from)||!['pt','en','es'].includes(to))throw new Error('Selecione um texto de até 2.000 caracteres.');return dictionaries.translate(text,from,to);},
  translateWithAi:(_view,text,to)=>{if(typeof text!=='string'||!text.trim()||text.length>8000||!['pt','en','es'].includes(to))throw new Error('Selecione um texto de até 8.000 caracteres.');const name={pt:'português do Brasil',en:'inglês',es:'espanhol'}[to as 'pt'|'en'|'es'];return (async()=>requestAnswer(settings.config(),await settings.secret(),`Traduza para ${name} o trecho a seguir, mantendo o sentido e o tom. Responda somente com a tradução, sem comentários.`,text,(async(url:string,options:RequestInit)=>{let response:Response;try{response=await fetch(url,options);}catch(error){await settings.recordAiUsage(0).catch(()=>{});throw error;}await settings.recordAiUsage(response.status).catch(()=>{});return response;}) as typeof fetch))();},setDictionaryPreferences:(_view,input)=>settings.setDictionary(input),
  getSignatures:()=>settings.signatures(),saveSignature:(_view,input)=>settings.saveSignature(input),deleteSignature:(_view,id)=>settings.deleteSignature(id),
  chooseImage:async view=>{const result=await openDialog(view.window,{title:'Escolher imagem',properties:['openFile'],filters:[{name:'Imagem',extensions:['png','jpg','jpeg']}]});if(result.canceled)return null;const path=result.filePaths[0]!;if((await stat(path)).size>20*1024*1024)throw new Error('Use uma imagem de até 20 MB.');return {name:basename(path),dataUrl:`data:image/${extname(path).toLowerCase()==='.png'?'png':'jpeg'};base64,${(await readFile(path)).toString('base64')}`};},
  setTheme:async(_view,theme)=>{await settings.setTheme(theme);nativeTheme.themeSource=theme;notify();},
  listAiModels:async(_view,input)=>{const {config,key}=await aiTarget(input);return listModels(config,key);},
  probeAiModel:async(_view,input)=>{const {config,key}=await aiTarget(input);if(typeof input?.model!=='string'||!input.model.trim())throw new Error('Informe o modelo.');return probeModel({...config,model:input.model.trim()},key);},
  findFreeAiModel:async(view,input)=>{
   const {config,key}=await aiTarget(input),tried:{id:string;message:string}[]=[];
   const models=await listModels(config,key),best=paidCandidate(models),candidates=freeCandidates(models.filter(m=>m!==best)).slice(0,10);
   try{
    // A key with billing gets the most complete model; a free key gets the lightest one that answers.
    if(best){
     action(view,`progress:Verificando se a chave tem faturamento: ${best.id}…`);
     const result=await probeModel({...config,model:best.id},key);
     if(result.ok)return {model:best.id,paid:true,tried};
     tried.push({id:best.id,message:result.message});
    }
    for(const [n,m] of candidates.entries()){
     action(view,`progress:Testando modelos de IA ${n+1} de ${candidates.length}: ${m.id}…`);
     const result=await probeModel({...config,model:m.id},key);
     if(result.ok)return {model:m.id,paid:false,tried};
     tried.push({id:m.id,message:result.message});
    }
   }finally{action(view,'progress:');}
   return {model:null,paid:false,tried};
  },
  getAiConfig:()=>settings.config(),saveAiConfig:(_view,input)=>settings.saveAi(input),
  getAiUsage:()=>settings.aiUsage(),
  askAi:async(view,id,question)=>{own(view,id);const text=await extractDocumentText(await store.materialize(id,false));return requestAnswer(settings.config(),await settings.secret(),question,text,(async(url,options)=>{
   let response:Response;try{response=await fetch(url,options);}catch(error){await settings.recordAiUsage(0).catch(()=>{});throw error;}
   await settings.recordAiUsage(response.status).catch(()=>{});return response;
  }) as typeof fetch);},
  runOcr:async(view,id,pages?:number[])=>{
   const doc=own(view,id),revision=doc.revision,count=doc.model.pages.length;
   const selected=pages?.length?[...new Set(pages)]:Array.from({length:count},(_,i)=>i);
   if(selected.some(i=>!Number.isInteger(i)||i<0||i>=count))throw new Error('Seleção de páginas inválida.');
   const source=await store.materialize(id,false);
   try{const {layers}=await recognizePages(view,source,selected);await store.replacePages(id,await addOcrTextLayer(source,layers),revision);}
   finally{action(view,'progress:');notify();}
  },
  installContextMenu:async(_view,enabled)=>{await installQuickActions(!!enabled);await settings.setQuickActions(!!enabled);notify();},
  openExternal:async(_view,url)=>{const allowed=['https://validar.iti.gov.br/','https://gestaoculturalpro.com.br/','https://donate.stripe.com/fZu4gzeBSfhbd7451F6Ri00','https://aistudio.google.com/apikey','https://platform.openai.com/api-keys'];if(!allowed.includes(url))throw new Error('Este link externo não é permitido.');await shell.openExternal(url);},
  copyText:(_view,text)=>{if(typeof text!=='string'||text.length>200000)throw new Error('Texto inválido.');clipboard.writeText(text);},
  getProperties:async(view,id)=>{
   const doc=own(view,id),first=doc.model.pages[0]!,base=store.baseInfo(first.base).pages[first.src]!;
   const read=await readMetadata(store.base(first.base)),edited=doc.model.metadata??{};
   return {...read,...edited,path:doc.path,fileSize:doc.path?(await stat(doc.path).catch(()=>null))?.size:undefined,pageCount:doc.model.pages.length,pageSize:{width:base.width,height:base.height}};
  },
  documentStats:async(view,id)=>{own(view,id);action(view,'progress:Analisando o documento…');try{return await documentStats(await store.materialize(id),(done,total)=>action(view,`progress:Analisando página ${done} de ${total}…`));}finally{action(view,'progress:');}},
  listPrinters:async view=>(await view.window.webContents.getPrintersAsync()).map(p=>({name:p.name,displayName:p.displayName||p.name,isDefault:!!(p as {isDefault?:boolean}).isDefault})),
  /** Prints exactly what the preview showed: the chosen pages rendered at print resolution, sent to the chosen printer. */
  printPages:async(view,id,input:{pages:number[];printer?:string;copies?:number;color?:boolean;duplex?:'simplex'|'longEdge'|'shortEdge';quality?:'normal'|'high'})=>{
   const doc=own(view,id),count=doc.model.pages.length;
   if(!Array.isArray(input?.pages)||!input.pages.length||input.pages.some(p=>!Number.isInteger(p)||p<0||p>=count))throw new Error('Escolha as páginas a imprimir.');
   const printers=await view.window.webContents.getPrintersAsync();
   if(input.printer&&!printers.some(p=>p.name===input.printer))throw new Error('A impressora escolhida não está mais disponível.');
   const copies=Math.max(1,Math.min(99,Math.floor(Number(input.copies)||1)));
   const folder=await mkdtemp(join(app.getPath('temp'),'gcp-pdf-print-'));
   const cleanup=()=>rm(folder,{recursive:true,force:true,maxRetries:3,retryDelay:200}).catch(()=>{});
   try{
    await privateDirectory(folder);
    action(view,'progress:Preparando a impressão…');
    const pages=await renderPdfPages(await store.materialize(id),input.pages,input.quality==='high'?300:200,(done,total)=>action(view,`progress:Preparando página ${done} de ${total} para impressão…`));
    const css=pages.map((p,i)=>`@page p${i}{size:${p.width.toFixed(2)}pt ${p.height.toFixed(2)}pt;margin:0}.p${i}{page:p${i};width:${p.width.toFixed(2)}pt;height:${p.height.toFixed(2)}pt}`).join('');
    for(const [i,p] of pages.entries())await writeFile(join(folder,`p${i}.png`),p.bytes,{flag:'wx',mode:0o600});
    const html=`<!doctype html><meta charset="utf-8"><style>html,body{margin:0;padding:0}div{break-after:page;overflow:hidden}div:last-child{break-after:auto}img{display:block;width:100%;height:100%;object-fit:contain}${input.color===false?'img{filter:grayscale(1)}':''}${css}</style>${pages.map((_,i)=>`<div class="p${i}"><img src="p${i}.png"></div>`).join('')}`;
    await writeFile(join(folder,'impressao.html'),html,{flag:'wx',mode:0o600});
    const printWindow=new BrowserWindow({show:false,parent:view.window,webPreferences:{sandbox:true,contextIsolation:true,nodeIntegration:false,javascript:false}});
    printWindow.on('closed',()=>void cleanup());
    await printWindow.loadFile(join(folder,'impressao.html'));
    action(view,'progress:Enviando para a impressora…');
    await new Promise<void>((done,fail)=>printWindow.webContents.print({silent:true,printBackground:true,deviceName:input.printer||undefined,copies,color:input.color!==false,duplexMode:input.duplex??'simplex',margins:{marginType:'none'},preferCSSPageSize:true} as Electron.WebContentsPrintOptions,(ok,reason)=>{printWindow.close();if(ok||reason==='cancelled')done();else fail(new Error(`A impressora recusou o trabalho (${reason}).`));}));
   }catch(error){await cleanup();throw error;}finally{action(view,'progress:');}
  },
  printDocument:async(view,id)=>{
   own(view,id);
   // A private, single-use folder: the printed copy is never left in a shared temp path.
   const folder=await mkdtemp(join(app.getPath('temp'),'gcp-pdf-print-'));
   const cleanup=()=>rm(folder,{recursive:true,force:true,maxRetries:3,retryDelay:200}).catch(()=>{});
   try{
    await privateDirectory(folder);
    const path=join(folder,'impressao.pdf');await writeFile(path,await store.materialize(id),{flag:'wx',mode:0o600});
    const printWindow=new BrowserWindow({show:false,parent:view.window,webPreferences:{sandbox:true,contextIsolation:true,nodeIntegration:false}});
    printWindow.on('closed',()=>void cleanup());
    await printWindow.loadURL(pathToFileURL(path).href);printWindow.webContents.print({silent:false,printBackground:true},()=>printWindow.close());
   }catch(error){await cleanup();throw error;}
  },
 };
 const quickHandlers:Record<string,(quick:Quick,...args:any[])=>unknown>={
  getQuickState:quick=>quick.state,
  quickAddFiles:async quick=>{const result=await openDialog(quick.window,{title:'Adicionar arquivos',properties:['openFile','multiSelections'],filters:[{name:'Documentos e imagens',extensions:INPUT_EXTENSIONS.map(e=>e.slice(1))}]});if(!result.canceled)addQuickFiles(quick,result.filePaths);},
  quickChooseFolder:async quick=>{const result=await openDialog(quick.window,{title:'Pasta de destino',properties:['openDirectory','createDirectory']});return result.canceled?null:result.filePaths[0]??null;},
  quickReveal:(_quick,path:string)=>{if(typeof path!=='string'||!existsSync(path))throw new Error('O arquivo não foi encontrado.');shell.showItemInFolder(path);},
  quickOpen:async(_quick,paths:string[])=>{const view=mainView();view.window.show();view.window.focus();await openPaths(view,paths);},
  quickRun:async(quick,input:{files:{path:string;range:string}[];name:string;folder:string|null})=>{
   const known=new Set(quick.state.files.map(file=>file.path));
   if(!Array.isArray(input?.files)||!input.files.length||input.files.some(file=>!known.has(file.path)))throw new Error('Adicione pelo menos um arquivo.');
   const progress=(text:string)=>action(quick,'progress:'+text);
   try{
    if(quick.state.action==='combine'){
     if(input.files.length<2)throw new Error('Escolha pelo menos dois arquivos para combinar.');
     const parts=[];
     for(const [n,file] of input.files.entries()){progress(`Lendo ${basename(file.path)} (${n+1} de ${input.files.length})…`);const bytes=await readPdf(file.path);parts.push({bytes,pages:pageList(file.range,await store.inspectPages(bytes))});}
     progress('Combinando…');
     const folder=input.folder??dirname(input.files[0]!.path),name=(String(input.name||'Combinado').replace(/[\\/:*?"<>|]/g,'').trim()||'Combinado').replace(/\.pdf$/i,'')+'.pdf';
     const path=await uniquePath(folder,name);await atomicWrite(path,await combineSelections(parts));return [path];
    }
    const outputs=[];
    for(const [n,file] of input.files.entries()){progress(`Convertendo ${basename(file.path)} (${n+1} de ${input.files.length})…`);const bytes=await readPdf(file.path);const path=await uniquePath(input.folder??dirname(file.path),basename(file.path,extname(file.path))+'.pdf');if(path===file.path)continue;await atomicWrite(path,bytes);outputs.push(path);}
    return outputs;
   }finally{progress('');}
  },
 };
 ipcMain.handle('gcp:getLanguage',event=>{trusted(event);if(!views.has(event.sender.id)&&!quicks.has(event.sender.id))throw new Error('Origem inválida.');return languages();});
 for(const [method,handler] of Object.entries(handlers))ipcMain.handle('gcp:'+method,async(event,...args)=>{trusted(event);const view=views.get(event.sender.id);if(!view)throw new Error('Origem de ação não autorizada.');try{return await handler(view,...args);}catch(error){notify();throw new Error(error instanceof Error?error.message:'Não foi possível concluir a operação.');}});
 for(const [method,handler] of Object.entries(quickHandlers))ipcMain.handle('gcp:'+method,async(event,...args)=>{trusted(event);const quick=quicks.get(event.sender.id);if(!quick){if(method==='getQuickState')return null;throw new Error('Origem de ação não autorizada.');}try{return await handler(quick,...args);}catch(error){throw new Error(error instanceof Error?error.message:'Não foi possível concluir a operação.');}});
}
/** PT-BR field formats, in the engine's Acrobat-style Format tab terms. */
const FIELD_FORMATS:Record<string,unknown>={none:'none',date:{type:'date',pattern:'dd/mm/yyyy'},currency:{type:'number',decimals:2,currency:'R$ ',separator:2,negative:0},number:{type:'number',decimals:2,separator:2,negative:0},cpf:{type:'mask',mask:'999.999.999-99'},cnpj:{type:'mask',mask:'99.999.999/9999-99'},cep:{type:'mask',mask:'99999-999'},phone:{type:'mask',mask:'(99) 99999-9999'}};
/** The engine validates against its own trust list; like Acrobat with "Windows integration" and the ITI
 * validator, signatures are checked against the authorities this Windows trusts (ICP-Brasil roots included).
 * Done once per engine process; failure leaves validation as before (shown as "emissor não confiável"). */
let windowsRoots:Promise<Buffer|null>|null=null;
async function trustWindowsRoots(){
 if(process.platform!=='win32')return;
 // Exported once per run; handed to the engine on every check (it may have restarted). The engine only reads
 // files inside its own folder, so the bundle is written there.
 windowsRoots??=(async()=>{
  const folder=await mkdtemp(join(app.getPath('temp'),'gcp-pdf-trust-'));
  try{
   await privateDirectory(folder);
   const out=join(folder,'windows-roots.p7b');
   const script="$ErrorActionPreference='Stop';$c=[System.Security.Cryptography.X509Certificates.X509Certificate2Collection]::new();foreach($location in 'LocalMachine','CurrentUser'){foreach($name in 'Root','CertificateAuthority'){$s=[System.Security.Cryptography.X509Certificates.X509Store]::new([System.Security.Cryptography.X509Certificates.StoreName]$name,[System.Security.Cryptography.X509Certificates.StoreLocation]$location);try{$s.Open([System.Security.Cryptography.X509Certificates.OpenFlags]::ReadOnly);$c.AddRange($s.Certificates)}finally{$s.Close()}}};if($c.Count -eq 0){throw 'Nenhuma autoridade certificadora foi encontrada.'};[IO.File]::WriteAllBytes($env:GCP_OUT,$c.Export([System.Security.Cryptography.X509Certificates.X509ContentType]::Pkcs7))";
   await new Promise<void>((done,fail)=>execFile(join(process.env.SystemRoot??'C:\\Windows','System32','WindowsPowerShell','v1.0','powershell.exe'),['-NoProfile','-NonInteractive','-EncodedCommand',Buffer.from(script,'utf16le').toString('base64')],{env:{...process.env,GCP_OUT:out},windowsHide:true,timeout:60_000},error=>error?fail(error):done()));
   return await readFile(out);
  }finally{await rm(folder,{recursive:true,force:true}).catch(()=>{});}
 })().catch(()=>{windowsRoots=null;return null;});
 const bundle=await windowsRoots;if(!bundle)return;
 await engine.trustBundle(bundle);
}
let pendingUpdate:import('../shared/types').UpdateInfo|null=null;
function updateStatus():UpdateStatus{const u=settings.updates;return {frequency:u.frequency,lastCheck:u.lastCheck,repository:UPDATE_REPOSITORY,version:app.getVersion()};}
/** Background check on start when due; a found version is offered in the open window. */
async function backgroundUpdateCheck(){
 if(!app.isPackaged||!due(settings.updates))return;
 try{pendingUpdate=await checkForUpdate();await settings.setUpdates({lastCheck:Date.now()});if(pendingUpdate){const view=mainView();action(view,'update-available');}}catch{/* silent: a manual check reports the reason */}
}
/** Provider, endpoint and key for model listing/testing: the typed key, or the one saved for that endpoint. */
async function aiTarget(input:{provider?:string;baseUrl?:string;key?:string}){
 if(!input||!['gemini','openai','compatible'].includes(String(input.provider)))throw new Error('Escolha o provedor de IA.');
 const url=new URL(String(input.baseUrl));if(url.username||url.password||url.search||url.hash)throw new Error('Informe a URL base, sem chave, senha ou parâmetros.');
 if(url.protocol!=='https:'&&!(url.protocol==='http:'&&['127.0.0.1','localhost','[::1]'].includes(url.hostname)))throw new Error('Use HTTPS ou um servidor local.');
 const config={provider:input.provider as AiConfig['provider'],baseUrl:url.href.replace(/\/$/,''),model:''};
 const key=(typeof input.key==='string'&&input.key.trim())||await settings.secretFor(config);
 if(!key)throw new Error('Cole a chave de API primeiro (ou salve a configuração com a chave).');
 return {config,key};
}
function desktopOptions():DesktopOptions{
 const testing=process.env.GCP_PDF_TEST_MODE==='1';
 const home=testing?join(app.getPath('userData'),'desktop-profile'):app.getPath('home');
 const xdg=(name:string,fallback:string)=>!testing&&process.env[name]&&isAbsolute(process.env[name]!)?process.env[name]!:join(home,fallback);
 const launcher=process.platform==='linux'&&process.env.APPIMAGE?process.env.APPIMAGE:process.execPath;
 return {platform:process.platform as 'linux'|'darwin',home,data:xdg('XDG_DATA_HOME','.local/share'),config:xdg('XDG_CONFIG_HOME','.config'),launcher,profile:process.env.GCP_PDF_DATA_DIR?app.getPath('userData'):undefined,icon:join(assets(),'icon.png')};
}
const installQuickActions=(enabled:boolean)=>process.platform==='win32'?registerWindowsContextMenu(enabled,app.isPackaged?`"${process.execPath}"`:`"${process.execPath}" "${app.getAppPath()}"`,join(unpacked(),'assets','context')):installUnixIntegration(desktopOptions(),enabled);
function makeMenu(){
 const text=(source:string)=>localize(source,languages().locale);
 const current=()=>views.get(BrowserWindow.getFocusedWindow()?.webContents.id||-1);
 const command=(name:string)=>()=>{const view=current();if(view)action(view,name);};
 Menu.setApplicationMenu(Menu.buildFromTemplate([
  {label:text('Arquivo'),submenu:[{label:text('Novo documento'),accelerator:undefined,click:command('new')},{label:text('Nova janela'),accelerator:undefined,click:()=>{createWindow();}},{label:text('Abrir arquivos…'),accelerator:undefined,click:command('open')},{type:'separator'},{label:text('Salvar'),accelerator:undefined,click:command('save')},{label:text('Salvar como…'),accelerator:undefined,click:command('save-as')},{label:text('Exportar…'),accelerator:undefined,click:command('export')},{label:text('Imprimir…'),accelerator:undefined,click:command('print')},{type:'separator'},{label:text('Combinar arquivos…'),click:()=>createQuickWindow('combine',[])},{label:text('Converter arquivos para PDF…'),click:()=>createQuickWindow('convert',[])},{type:'separator'},{label:text('Fechar aba'),accelerator:undefined,click:command('close-tab')},{label:text('Sair'),accelerator:undefined,click:()=>app.quit()}]},
  {label:text('Editar'),submenu:[{label:text('Desfazer'),accelerator:undefined,click:command('undo')},{label:text('Refazer'),accelerator:undefined,click:command('redo')},{type:'separator'},{label:text('Recortar'),role:'cut'},{label:text('Copiar'),role:'copy'},{label:text('Colar'),role:'paste'},{label:text('Selecionar tudo'),role:'selectAll'}]},
  {label:text('Exibir'),submenu:[{label:text('Tela cheia'),role:'togglefullscreen'},{label:text('Recarregar interface'),role:'reload',visible:!app.isPackaged},{label:text('Ferramentas de desenvolvimento'),role:'toggleDevTools',visible:!app.isPackaged},{label:text('Tema claro'),click:async()=>{await settings.setTheme('light');notify();}},{label:text('Tema escuro'),click:async()=>{await settings.setTheme('dark');notify();}}]},
  {label:text('Ajuda'),submenu:[{label:text('Configurações'),click:command('settings')},{label:text('Apoie o projeto'),click:command('support')},{label:text('Gestão Cultural Pro'),click:()=>{void shell.openExternal('https://gestaoculturalpro.com.br/');}}]},
 ]));
}
/** Explorer starts one process per selected file ("%1"), so every launch is funnelled here and
 * files arriving within a short window are gathered into a single quick-action window. */
const batch:{action?:'combine'|'convert';paths:string[];timer?:NodeJS.Timeout}={paths:[]};
let ready=false;const early:string[][]=[];
// Finder sends open-file events, including before whenReady; retain those paths
// until settings, IPC and the first window have been initialized.
app.on('open-file',(event,path)=>{event.preventDefault();if(ready)handleLaunch([process.execPath,path]);else early.push([process.execPath,path]);});
function quickTarget(action:'combine'|'convert'){return [...quicks.values()].find(quick=>quick.state.action===action&&!quick.window.isDestroyed());}
function flushBatch(){const {action,paths}=batch;batch.action=undefined;batch.paths=[];batch.timer=undefined;if(!action)return;const target=quickTarget(action);if(target){addQuickFiles(target,paths);target.window.focus();}else createQuickWindow(action,paths);}
function handleLaunch(args:string[]){
 const quick=args.includes('--quick-combine')?'combine':args.includes('--quick-convert')?'convert':undefined;
 const paths=args.slice(1).filter(arg=>!arg.startsWith('-')&&existsSync(arg)&&OPENABLE.includes(extname(arg).toLowerCase())).map(arg=>resolve(arg));
 if(quick){if(batch.action&&batch.action!==quick)flushBatch();batch.action=quick;batch.paths.push(...paths.filter(path=>!batch.paths.includes(path)));if(batch.timer)clearTimeout(batch.timer);batch.timer=setTimeout(flushBatch,700);return;}
 const view=mainView();if(paths.length)void openPaths(view,paths).catch(error=>action(view,'error:'+(error instanceof Error?error.message:String(error))));view.window.show();view.window.focus();
}
if(!app.requestSingleInstanceLock())app.quit();
else{
 app.on('second-instance',(_event,args)=>{if(ready)handleLaunch(args);else early.push(args);});
 app.whenReady().then(async()=>{
  await settings.init();nativeTheme.themeSource=settings.theme;registerIpc();makeMenu();
  session.defaultSession.on('will-download',event=>event.preventDefault());
  session.defaultSession.setPermissionRequestHandler((_wc,_permission,callback)=>callback(false));
  if(!process.env.VITE_DEV_SERVER_URL)session.defaultSession.webRequest.onBeforeRequest((details,callback)=>{callback({cancel:!['file:','data:','blob:','devtools:'].some(protocol=>details.url.startsWith(protocol))});});
  // Quick actions are installed automatically (idempotent) so they also follow the app after an update or move.
  // Test profiles never change the real desktop or the Windows registry.
  if(app.isPackaged&&process.env.GCP_PDF_TEST_MODE!=='1')void installQuickActions(settings.quickActions).catch(error=>action(mainView(),'notice:Não foi possível configurar as ações rápidas: '+String(error.message||error)));
  setTimeout(()=>void backgroundUpdateCheck(),8000);
  ready=true;handleLaunch(process.argv);for(const args of early.splice(0))handleLaunch(args);
  if(process.env.GCP_PDF_TEST_MODE==='1')(globalThis as any).__gcpTest={store,views,quicks,createWindow,createQuickWindow,notify,settings,engine};
 }).catch(error=>dialog.showErrorBox('Não foi possível iniciar o GCP-PDF',String(error.message||error)));
}
app.on('window-all-closed',()=>{if(process.platform!=='darwin')app.quit();});
app.on('activate',()=>{if(!views.size)createWindow();});
app.on('before-quit',()=>{shuttingDown=true;void engine.dispose();void editorBlockReader.dispose();});
