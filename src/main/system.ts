import {hasPdfHeader} from './launch-input';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {existsSync} from 'node:fs';
import {readFile,mkdtemp,rm} from 'node:fs/promises';
import {join,extname,basename} from 'node:path';
import {homedir,tmpdir} from 'node:os';
import {pathToFileURL} from 'node:url';
import {PDFDocument} from 'pdf-lib';
import {loadImage,createCanvas} from '@napi-rs/canvas';
import {officeToPdf,type HtmlToPdf} from './office';
import {fiscalXmlToPdf} from './fiscal';
const exec=promisify(execFile);
export const INPUT_EXTENSIONS=['.pdf','.png','.jpg','.jpeg','.webp','.bmp','.docx','.xlsx','.pptx','.odt','.ods','.odp','.doc','.xls','.ppt','.rtf','.txt','.xml'];
export async function registerWindowsContextMenu(enabled:boolean,launch:string,icons:string){if(process.platform!=='win32')throw new Error('A integração com o Explorador está disponível no Windows.');const root='HKCU\\Software\\Classes\\*\\shell\\GCPPDF';if(!enabled){await exec('reg.exe',['delete',root,'/f']).catch((error:any)=>{if(!/unable|encontrar|not find/i.test(String(error.stderr)))throw error;});return;}
 const set=async(key:string,name:string,value:string)=>{await exec('reg.exe',['add',key,...(name?['/v',name]:['/ve']),'/t','REG_SZ','/d',value,'/f']);};
 await set(root,'MUIVerb','GCP-PDF');await set(root,'SubCommands','');await set(root,'Icon',launch.split('"')[1]+',0');
 for(const [id,label,flag] of [['convert','Converter para PDF','--quick-convert'],['combine','Combinar em um PDF','--quick-combine']]){const key=root+'\\shell\\'+id;await set(key,'MUIVerb',label);await set(key,'Icon',join(icons,id+'.ico'));await set(key,'MultiSelectModel','Player');await set(key+'\\command','',`${launch} ${flag} "%1"`);}
}
export async function isPdfInput(path:string):Promise<boolean>{
 const extension=extname(path).toLowerCase();
 return extension==='.pdf'||(!INPUT_EXTENSIONS.includes(extension)&&await hasPdfHeader(path));
}
export async function readInputDocument(path:string,htmlToPdf?:HtmlToPdf):Promise<{bytes:Uint8Array;sourcePdf:boolean}>{
 const extension=extname(path).toLowerCase(),sourcePdf=await isPdfInput(path);
 if(!sourcePdf&&!INPUT_EXTENSIONS.includes(extension))throw new Error('O arquivo selecionado não é um PDF nem um formato suportado.');
 return {bytes:sourcePdf?new Uint8Array(await readFile(path)):await convertInputPdf(path,htmlToPdf),sourcePdf};
}
export async function readInputPdf(path:string,htmlToPdf?:HtmlToPdf):Promise<Uint8Array>{return (await readInputDocument(path,htmlToPdf)).bytes;}
async function convertInputPdf(path:string,htmlToPdf?:HtmlToPdf):Promise<Uint8Array>{const extension=extname(path).toLowerCase();
 // Fiscal XML (NF-e, NFC-e, NFS-e…) becomes its auxiliary document (DANFE, DANFSe…), rendered locally.
 if(extension==='.xml'){if(!htmlToPdf)throw new Error('Conversão interna indisponível neste contexto.');return (await fiscalXmlToPdf(new Uint8Array(await readFile(path)),htmlToPdf)).bytes;}if(['.png','.jpg','.jpeg','.webp','.bmp'].includes(extension)){const image=await loadImage(await readFile(path));if(image.width*image.height>100000000)throw new Error('A imagem ultrapassa 100 megapixels. Reduza-a antes de importar.');const canvas=createCanvas(image.width,image.height);canvas.getContext('2d').drawImage(image,0,0);const doc=await PDFDocument.create(),embedded=await doc.embedPng(canvas.toBuffer('image/png'));const landscape=image.width>image.height;const page=doc.addPage(landscape?[841.89,595.28]:[595.28,841.89]);const width=page.getWidth()-48,height=page.getHeight()-48,scale=Math.min(width/image.width,height/image.height);page.drawImage(embedded,{x:(page.getWidth()-image.width*scale)/2,y:(page.getHeight()-image.height*scale)/2,width:image.width*scale,height:image.height*scale});return doc.save();}
 return officeToPdf(path,htmlToPdf??(async()=>{throw new Error('Conversão interna indisponível neste contexto.');}),()=>libreOfficeToPdf(path));}
/** LibreOffice, when installed, as one more converter; null when it is not available. */
/** Where LibreOffice may be: the user's choice, the usual install folders of each system and every folder
 * of PATH (distribution packages, /opt builds, Snap and Homebrew put it in different places). */
export function libreOfficeCandidates(platform:NodeJS.Platform=process.platform,env:NodeJS.ProcessEnv=process.env,home=homedir()):string[]{
 const windows=platform==='win32',sep=windows?'\\':'/',at=(...parts:string[])=>parts.join(sep),names=windows?['soffice.exe']:['soffice','libreoffice'];
 const fixed=windows?[at(env.ProgramFiles||'C:\\Program Files','LibreOffice','program','soffice.exe'),at(env['ProgramFiles(x86)']||'C:\\Program Files (x86)','LibreOffice','program','soffice.exe')]
  :platform==='darwin'?['/Applications/LibreOffice.app/Contents/MacOS/soffice',at(home,'Applications','LibreOffice.app','Contents','MacOS','soffice'),'/opt/homebrew/bin/soffice','/usr/local/bin/soffice']
  :['/usr/bin/libreoffice','/usr/bin/soffice','/usr/local/bin/libreoffice','/usr/local/bin/soffice','/usr/lib/libreoffice/program/soffice','/usr/lib64/libreoffice/program/soffice','/opt/libreoffice/program/soffice','/snap/bin/libreoffice','/var/lib/flatpak/exports/bin/org.libreoffice.LibreOffice',at(home,'.local','share','flatpak','exports','bin','org.libreoffice.LibreOffice')];
 const onPath=(env.PATH??env.Path??'').split(windows?';':':').filter(Boolean).flatMap(folder=>names.map(name=>at(folder.replace(/[\\/]+$/,''),name)));
 return [...new Set([env.GCP_PDF_LIBREOFFICE,...fixed,...onPath].filter((p):p is string=>!!p))];
}
async function libreOfficeToPdf(path:string):Promise<Uint8Array|null>{const executable=libreOfficeCandidates().find(p=>existsSync(p));if(!executable)return null;const temp=await mkdtemp(join(tmpdir(),'gcp-pdf-convert-'));try{await exec(executable!,['-env:UserInstallation='+pathToFileURL(join(temp,'profile')).href,'--headless','--convert-to','pdf','--outdir',temp,path],{timeout:120000,windowsHide:true,maxBuffer:1024*1024});return new Uint8Array(await readFile(join(temp,basename(path,extname(path))+'.pdf')));}catch{throw new Error('Não foi possível converter este arquivo com o LibreOffice. Verifique se o formato é compatível e se o arquivo não está protegido.');}finally{await rm(temp,{recursive:true,force:true});}}
