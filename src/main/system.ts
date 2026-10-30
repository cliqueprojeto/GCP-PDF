import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {existsSync} from 'node:fs';
import {readFile,mkdtemp,rm} from 'node:fs/promises';
import {join,extname,basename} from 'node:path';
import {tmpdir} from 'node:os';
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
export async function readInputPdf(path:string,htmlToPdf?:HtmlToPdf):Promise<Uint8Array>{const extension=extname(path).toLowerCase();if(extension==='.pdf')return new Uint8Array(await readFile(path));
 // Fiscal XML (NF-e, NFC-e, NFS-e…) becomes its auxiliary document (DANFE, DANFSe…), rendered locally.
 if(extension==='.xml'){if(!htmlToPdf)throw new Error('Conversão interna indisponível neste contexto.');return (await fiscalXmlToPdf(new Uint8Array(await readFile(path)),htmlToPdf)).bytes;}if(['.png','.jpg','.jpeg','.webp','.bmp'].includes(extension)){const image=await loadImage(await readFile(path));if(image.width*image.height>100000000)throw new Error('A imagem ultrapassa 100 megapixels. Reduza-a antes de importar.');const canvas=createCanvas(image.width,image.height);canvas.getContext('2d').drawImage(image,0,0);const doc=await PDFDocument.create(),embedded=await doc.embedPng(canvas.toBuffer('image/png'));const landscape=image.width>image.height;const page=doc.addPage(landscape?[841.89,595.28]:[595.28,841.89]);const width=page.getWidth()-48,height=page.getHeight()-48,scale=Math.min(width/image.width,height/image.height);page.drawImage(embedded,{x:(page.getWidth()-image.width*scale)/2,y:(page.getHeight()-image.height*scale)/2,width:image.width*scale,height:image.height*scale});return doc.save();}
 return officeToPdf(path,htmlToPdf??(async()=>{throw new Error('Conversão interna indisponível neste contexto.');}),async()=>{const bytes=await libreOfficeToPdf(path);if(!bytes)throw new Error('Para converter este formato, instale o Microsoft Office ou o LibreOffice.');return bytes;});}
/** LibreOffice, when installed, as one more converter; null when it is not available. */
async function libreOfficeToPdf(path:string):Promise<Uint8Array|null>{const candidates=[process.env.GCP_PDF_LIBREOFFICE,...(process.platform==='win32'?[join(process.env.ProgramFiles||'C:\\Program Files','LibreOffice','program','soffice.exe'),join(process.env['ProgramFiles(x86)']||'C:\\Program Files (x86)','LibreOffice','program','soffice.exe')]:process.platform==='darwin'?['/Applications/LibreOffice.app/Contents/MacOS/soffice']:['/usr/bin/libreoffice','/usr/bin/soffice'])];const executable=candidates.find(p=>p&&existsSync(p));if(!executable)return null;const temp=await mkdtemp(join(tmpdir(),'gcp-pdf-convert-'));try{await exec(executable!,['-env:UserInstallation=file:///'+join(temp,'profile').replace(/\\/g,'/'),'--headless','--convert-to','pdf','--outdir',temp,path],{timeout:120000,windowsHide:true,maxBuffer:1024*1024});return new Uint8Array(await readFile(join(temp,basename(path,extname(path))+'.pdf')));}catch{throw new Error('Não foi possível converter este arquivo com o LibreOffice. Verifique se o formato é compatível e se o arquivo não está protegido.');}finally{await rm(temp,{recursive:true,force:true});}}
