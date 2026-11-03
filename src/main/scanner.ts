import {execFile} from 'node:child_process';
import {mkdtemp,readdir,readFile,rm,stat} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {PDFDocument,degrees} from 'pdf-lib';
import {createCanvas,loadImage} from '@napi-rs/canvas';
import {PAPER_SIZES,scanOptions,type ScanOptions,type ScannerDevice,type ScannerCapabilities,type ScanPage,type ScanSelection} from '../shared/scanner';

type Runner=(file:string,args:string[],signal?:AbortSignal)=>Promise<string>;
const run:Runner=(file,args,signal)=>new Promise((resolve,reject)=>execFile(file,args,{encoding:'utf8',windowsHide:true,timeout:180_000,maxBuffer:2*1024*1024,signal},(error,stdout,stderr)=>error?reject(new Error(stderr.trim()||error.message,{cause:error})):resolve(stdout.trim())));
/** SANE's documented --formatted-device-list escapes are used instead of display-line parsing. */
export function saneDevices(text:string):ScannerDevice[]{return text.split(/\r?\n/).filter(Boolean).map(line=>{const [id,...name]=line.split('\t');if(!id||!name.length)throw new Error('Lista SANE inválida.');return {id,name:name.join(' ').trim()};});}
export function saneSources(help:string):string[]{const line=/^\s*--source\s+(.+)$/m.exec(help)?.[1]?.replace(/\s+\[[^\]]*\].*$/,'').trim();return line?line.split('|').map(s=>s.trim()).filter(Boolean):[];}
export function saneArguments(o:ScanOptions,folder:string):string[]{const [w,h]=PAPER_SIZES[o.paper];return ['--device-name',o.device,'--format=png',`--batch=${join(folder,'page-%04d.png')}`,'--batch-count=1','--resolution',String(o.dpi),'--mode',({color:'Color',gray:'Gray',bw:'Lineart'})[o.color],...(o.source?['--source',o.source]:[]),'-x',String(w),'-y',String(h)];}

/** Hardware adapters only write into a private acquisition folder. Renderer receives opaque page ids. */
export class Scanner {
 private pages=new Map<number,Map<string,{bytes:Uint8Array;page:ScanPage}>>();
 private active?:{owner:number;abort:AbortController;done:Promise<unknown>};
 private temporary=new Map<string,number>();
 constructor(private assets:string,private platform=process.platform,private execute:Runner=run){}
 private helper(action:string,args:string[],signal?:AbortSignal){
  if(this.platform==='win32')return this.execute('powershell.exe',['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',join(this.assets,'scanner','wia.ps1'),action,...args],signal);
  if(this.platform==='darwin')return this.execute(join(this.assets,'scanner','gcp-scanner'),[action,...args],signal);
  throw new Error('Serviço de scanner indisponível.');
 }
 async devices(signal?:AbortSignal):Promise<ScannerDevice[]>{
  try{if(this.platform==='linux')return saneDevices(await this.execute('scanimage',['--formatted-device-list','%d\t%v %m\n'],signal));
   const raw=JSON.parse(await this.helper('list',[],signal));if(!Array.isArray(raw)||raw.some(v=>!v||typeof v.id!=='string'||typeof v.name!=='string'))throw new Error('Lista de scanners inválida.');return raw;
  }catch(error){throw new Error(this.platform==='linux'?'Não foi possível consultar o SANE. Instale sane-utils (Debian/Ubuntu) ou sane-backends (Fedora/Arch) e o driver do scanner. '+String(error):'Não foi possível consultar os scanners. Confira a conexão e o driver. '+String(error));}
 }
 async capabilities(id:string,signal?:AbortSignal):Promise<ScannerCapabilities>{
  if(!(await this.devices(signal)).some(d=>d.id===id))throw new Error('O scanner selecionado não está mais disponível.');
  if(this.platform==='linux'){const help=await this.execute('scanimage',['--device-name',id,'--help'],signal);return {sources:saneSources(help),nativeUi:false,description:'SANE • uma aquisição por vez. Selecione uma origem duplex oferecida pelo driver para frente e verso.'};}
  const raw=JSON.parse(await this.helper('capabilities',[id],signal));
  if(!raw||!Array.isArray(raw.sources)||raw.sources.some((s:unknown)=>typeof s!=='string')||typeof raw.nativeUi!=='boolean')throw new Error('Capacidades do scanner inválidas.');return raw;
 }
 acquire(owner:number,raw:unknown,ocr:(bytes:Uint8Array)=>Promise<Uint8Array>):Promise<ScanPage[]>{
  if(this.active)throw new Error('Há uma digitalização em andamento. Aguarde ou cancele.');
  const abort=new AbortController();
  const done=this.capture(owner,scanOptions(raw),abort.signal,ocr).finally(()=>{this.active=undefined;});
  this.active={owner,abort,done};return done;
 }
 private async capture(owner:number,o:ScanOptions,signal:AbortSignal,ocr:(bytes:Uint8Array)=>Promise<Uint8Array>){
  const caps=await this.capabilities(o.device,signal);signal.throwIfAborted();
  if((caps.sources.length&&!caps.sources.includes(o.source))||(o.nativeUi&&!caps.nativeUi))throw new Error('Esta origem ou interface não é oferecida pelo scanner. Atualize a lista.');
  const pages=this.pages.get(owner)??new Map();this.pages.set(owner,pages);
  if(pages.size>=100)throw new Error('Conclua este PDF antes de digitalizar mais páginas (limite de 100 páginas por sessão).');
  const folder=await mkdtemp(join(tmpdir(),'gcp-scan-'));this.temporary.set(folder,owner);
  let failure='';
  try{
   try{if(this.platform==='linux'){
     // Duplex requires two output images. Source names come from the selected driver's capabilities.
     const args=saneArguments(o,folder);if(/duplex/i.test(o.source))args[args.indexOf('--batch-count=1')]='--batch-count=2';
     await this.execute('scanimage',args,signal);
    }else await this.helper('scan',[o.device,folder,JSON.stringify(o)],signal);
   }catch(error){failure=signal.aborted?'Digitalização cancelada.':String(error);}
   const files=(await readdir(folder)).filter(f=>/^page-\d+\.png$/i.test(f)).sort();
   if(!files.length)throw new Error(failure||'O scanner não retornou páginas. Verifique o papel e tente novamente.');
   const added:ScanPage[]=[];
   for(const file of files){
    if(pages.size>=100)break;
    const path=join(folder,file),size=(await stat(path)).size;
    if(size>80*1024*1024)throw new Error('Página digitalizada excede 80 MB. Diminua a resolução.');
    const imageBytes=await readFile(path),image=await loadImage(imageBytes);
    if(image.width*image.height>50_000_000)throw new Error('Página excede 50 megapixels. Diminua a resolução.');
    const pdf=await PDFDocument.create(),picture=await pdf.embedPng(imageBytes);
    const [w,h]=PAPER_SIZES[o.paper].map(mm=>mm*72/25.4) as [number,number];
    const page=pdf.addPage([w,h]),scale=Math.min(w/picture.width,h/picture.height);
    page.drawImage(picture,{x:(w-picture.width*scale)/2,y:(h-picture.height*scale)/2,width:picture.width*scale,height:picture.height*scale});
    let bytes:Uint8Array=await pdf.save(),recognized=false,warning=failure||undefined;
    if(o.ocr&&!signal.aborted){try{bytes=await ocr(bytes);recognized=true;}catch(error){warning=`OCR não concluído; imagem preservada. ${String(error)}`;}}
    const retained=[...pages.values()].reduce((n,p)=>n+p.bytes.byteLength,0);
    if(retained+bytes.byteLength>256*1024*1024)throw new Error('Sessão excede 256 MB. Finalize o PDF antes de continuar.');
    const canvas=createCanvas(Math.max(1,Math.round(image.width* Math.min(1,480/image.width))),Math.max(1,Math.round(image.height*Math.min(1,480/image.width))));canvas.getContext('2d').drawImage(image,0,0,canvas.width,canvas.height);
    const preview=`data:image/jpeg;base64,${canvas.toBuffer('image/jpeg',75).toString('base64')}`;
    const item:ScanPage={id:randomUUID(),preview,ocr:recognized,warning};pages.set(item.id,{bytes,page:item});added.push(item);
   }
   return added;
  }finally{await this.cleanup(owner);}
 }
 list(owner:number){return [...(this.pages.get(owner)?.values()??[])].map(v=>v.page);}
 remove(owner:number,id:string){if(this.active?.owner===owner)throw new Error('Aguarde a digitalização.');if(!this.pages.get(owner)?.delete(id))throw new Error('Página digitalizada não encontrada.');}
 async pdf(owner:number,selection:ScanSelection[]){
  const pages=this.pages.get(owner);
  if(!Array.isArray(selection)||!selection.length||selection.length>100||new Set(selection.map(p=>p?.id)).size!==selection.length)throw new Error('Seleção de digitalizações inválida.');
  const pdf=await PDFDocument.create();pdf.setCreator('GCP-PDF');
  for(const s of selection){const item=pages?.get(s?.id);if(!item||![0,90,180,270].includes(s.rotation))throw new Error('Página digitalizada inválida.');const input=await PDFDocument.load(item.bytes);const [p]=await pdf.copyPages(input,[0]);p!.setRotation(degrees(s.rotation));pdf.addPage(p!);}
  return pdf.save();
 }
 async clear(owner:number){if(this.active?.owner===owner){this.active.abort.abort();await this.active.done.catch(()=>{});}this.pages.delete(owner);await this.cleanup(owner);}
 async dispose(){if(this.active){this.active.abort.abort();await this.active.done.catch(()=>{});}for(const owner of new Set([...this.temporary.values(),...this.pages.keys()]))await this.clear(owner);}
 cancel(owner:number){if(this.active?.owner===owner)this.active.abort.abort();}
 private async cleanup(owner:number){for(const [folder,folderOwner] of this.temporary){if(folderOwner!==owner)continue;await rm(folder,{recursive:true,force:true});this.temporary.delete(folder);}}
}
