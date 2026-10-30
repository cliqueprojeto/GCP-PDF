import {createHash,randomUUID} from 'node:crypto';
import {chmod,copyFile,mkdir,readFile,rename,rm,writeFile} from 'node:fs/promises';
import {dirname,join} from 'node:path';
import {constants} from 'node:fs';
import {DOMParser,XMLSerializer} from '@xmldom/xmldom';

const OWNER='Managed by GCP-PDF';
const ACTIONS=[{id:'combine',name:'Combinar em um PDF'},{id:'convert',name:'Converter para PDF'}] as const;
export const shellQuote=(value:string)=>`'${value.replaceAll("'", "'\\''")}'`;
// Desktop Entry escaping is separate from shell escaping (Exec is not a shell).
export const desktopQuote=(value:string)=>'"'+value.replaceAll('%','%%').replace(/[\\"`$]/g,c=>c==='\\'?'\\\\\\\\':'\\\\'+c)+'"';
const xml=(s:string)=>s.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[c]!));
function plistValue(value:unknown):string{
 if(Array.isArray(value))return `<array>${value.map(plistValue).join('')}</array>`;
 if(value&&typeof value==='object')return `<dict>${Object.entries(value).map(([key,v])=>`<key>${xml(key)}</key>${plistValue(v)}`).join('')}</dict>`;
 if(typeof value==='boolean')return value?'<true/>':'<false/>';
 if(typeof value==='number')return `<integer>${value}</integer>`;
 return `<string>${xml(String(value))}</string>`;
}
const plist=(value:unknown)=>`<?xml version="1.0" encoding="UTF-8"?>\n<!-- ${OWNER} -->\n<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">\n<plist version="1.0">${plistValue(value)}</plist>\n`;
export interface DesktopOptions {platform:'linux'|'darwin';home:string;data:string;config:string;launcher:string;appBundle?:string;appImage?:boolean;icon:string}
export interface DesktopFile {path:string;content:string;mode:number;launcher?:boolean}
export function desktopFiles(options:DesktopOptions):DesktopFile[]{
 const {home,data,launcher}=options,files:DesktopFile[]=[];
 if(options.platform==='linux'){
  const command=desktopQuote(launcher);
  files.push({path:join(data,'applications','gcp-pdf.desktop'),mode:0o755,launcher:true,content:`[Desktop Entry]\n# ${OWNER}\nType=Application\nName=GCP-PDF\nComment=Leitor e editor de PDF\nExec=${command} %F\nIcon=${join(data,'icons/hicolor/512x512/apps/gcp-pdf.png')}\nTerminal=false\nCategories=Office;\nMimeType=application/pdf;\nActions=combine;convert;\n${ACTIONS.map(a=>`\n[Desktop Action ${a.id}]\nName=${a.name}\nExec=${command} --quick-${a.id} %F\n`).join('')}`});
  for(const action of ACTIONS){
   const script=`#!/bin/sh\n# ${OWNER}\nexec ${shellQuote(launcher)} --quick-${action.id} "$@"\n`;
   for(const folder of [join(data,'nautilus/scripts/GCP-PDF'),join(options.config,'caja/scripts/GCP-PDF')])files.push({path:join(folder,action.name),content:script,mode:0o755});
   const wrapper=join(data,'gcp-pdf/actions',action.id);
   files.push({path:wrapper,content:script,mode:0o755});
   files.push({path:join(data,'nemo/actions',`gcp-pdf-${action.id}.nemo_action`),mode:0o644,content:`[Nemo Action]\n# ${OWNER}\nName=GCP-PDF — ${action.name}\nComment=${action.name}\nExec=${desktopQuote(wrapper)} %F\nIcon-Name=gcp-pdf\nSelection=any\nExtensions=any;\nQuote=double\n`});
  }
  files.push({path:join(data,'kio/servicemenus/gcp-pdf.desktop'),mode:0o755,content:`[Desktop Entry]\n# ${OWNER}\nType=Service\nMimeType=application/octet-stream;\nX-KDE-ServiceTypes=KonqPopupMenu/Plugin\nX-KDE-Submenu=GCP-PDF\nActions=combine;convert;\n${ACTIONS.map(a=>`\n[Desktop Action ${a.id}]\nName=${a.name}\nIcon=gcp-pdf\nExec=${command} --quick-${a.id} %F\n`).join('')}`});
 }else{
  if(!options.appBundle)throw new Error('O aplicativo macOS não está em um bundle .app.');
  for(const action of ACTIONS){
   const name=`GCP-PDF — ${action.name}`,root=join(home,'Library/Services',`${name}.workflow`,'Contents');
   const command=`${shellQuote(launcher)} --quick-${action.id} "$@" </dev/null >/dev/null 2>&1 &`;
   const accepts={Container:'List',Optional:true,Types:['com.apple.cocoa.string']};
   files.push({path:join(root,'Info.plist'),mode:0o644,content:plist({CFBundleIdentifier:`br.com.gestaoculturalpro.pdf.quick-${action.id}`,CFBundleName:name,NSServices:[{NSMenuItem:{default:name},NSMessage:'runWorkflowAsService',NSRequiredContext:{NSApplicationIdentifier:'com.apple.finder'},NSSendFileTypes:['public.item']}]})});
   files.push({path:join(root,'document.wflow'),mode:0o644,content:plist({AMDocumentVersion:'2',actions:[{action:{AMAccepts:accepts,AMActionVersion:'2.0.3',AMApplication:['Automator'],AMParameterProperties:{COMMAND_STRING:{},inputMethod:{},shell:{}},AMProvides:accepts,ActionBundlePath:'/System/Library/Automator/Run Shell Script.action',ActionName:'Run Shell Script',ActionParameters:{COMMAND_STRING:command,inputMethod:1,shell:'/bin/bash'},BundleIdentifier:'com.apple.RunShellScript',UUID:`A46353B0-0040-4000-8000-${action.id==='combine'?'000000000001':'000000000002'}`},isViewVisible:1}],workflowMetaData:{applicationBundleID:'com.apple.finder',applicationBundleIDsByPath:{'/System/Library/CoreServices/Finder.app':'com.apple.finder'},inputTypeIdentifier:'com.apple.Automator.fileSystemObject',outputTypeIdentifier:'com.apple.Automator.nothing',processesInput:0,serviceInputTypeIdentifier:'com.apple.Automator.fileSystemObject',serviceOutputTypeIdentifier:'com.apple.Automator.nothing',serviceProcessesInput:0,serviceApplicationBundleID:'com.apple.finder',workflowTypeIdentifier:'com.apple.Automator.servicesMenu'}})});
  }
 }
 return files;
}
async function existing(path:string){try{return await readFile(path,'utf8');}catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')return undefined;throw error;}}
async function writeAtomic(path:string,content:string,mode:number){
 const temporary=path+'.gcp-'+randomUUID()+'.tmp';
 try{await writeFile(temporary,content,{flag:'wx',mode});await chmod(temporary,mode);await rename(temporary,path);}
 finally{await rm(temporary,{force:true});}
}
async function backup(path:string,content:string,root:string){const digest=createHash('sha256').update(path+'\0'+content).digest('hex');await mkdir(root,{recursive:true});await writeFile(join(root,`${digest}.backup`),content,{flag:'wx',mode:0o600}).catch(error=>{if(error.code!=='EEXIST')throw error;});}
async function updateFile(file:DesktopFile,enabled:boolean,backupRoot:string){
 const old=await existing(file.path);
 if(old!==undefined&&!old.includes(OWNER))throw new Error(`O arquivo já existe e não pertence ao GCP-PDF: ${file.path}`);
 if(!enabled){if(old!==undefined){await backup(file.path,old,backupRoot);await rm(file.path);}return;}
 if(old===file.content){await chmod(file.path,file.mode);return;}
 if(old!==undefined)await backup(file.path,old,backupRoot);
 await mkdir(dirname(file.path),{recursive:true});
 await writeAtomic(file.path,file.content,file.mode);
}
/** Thunar owns a shared XML file. Parse once and replace only our two action IDs,
 * retaining every unrelated action; malformed input is never overwritten. */
export async function thunarActions(options:DesktopOptions,enabled:boolean){
 const file=join(options.config,'Thunar/uca.xml'),old=await existing(file);
 if(!old&&!enabled)return;
 const errors:string[]=[];
 let document;
 try{document=new DOMParser({onError:(level:string,message:string)=>{if(level!=='warning')errors.push(message);}} as never).parseFromString(old??'<actions/>','text/xml');}
 catch(cause){throw new Error('As ações do Thunar têm XML inválido; o arquivo foi preservado.',{cause});}
 const root=document.documentElement;
 if(errors.length||!root||root.tagName!=='actions')throw new Error('As ações do Thunar têm XML inválido; o arquivo foi preservado.');
 for(const action of Array.from(root.getElementsByTagName('action'))){const id=action.getElementsByTagName('unique-id')[0]?.textContent;if(id==='1730000000000001-1'||id==='1730000000000001-2'){if(action.getElementsByTagName('description')[0]?.textContent!==OWNER)throw new Error('Uma ação do Thunar usa o mesmo identificador; o arquivo foi preservado.');root.removeChild(action);}}
 if(enabled)for(const [i,action] of ACTIONS.entries()){
  const node=document.createElement('action');
  for(const [key,value] of Object.entries({name:`GCP-PDF — ${action.name}`,'unique-id':`1730000000000001-${i+1}`,command:`${shellQuote(options.launcher)} --quick-${action.id} %F`,description:OWNER,icon:'gcp-pdf',patterns:'*'})){const field=document.createElement(key);field.appendChild(document.createTextNode(value));node.appendChild(field);}
  for(const type of ['other-files','text-files','image-files','audio-files','video-files'])node.appendChild(document.createElement(type));
  root.appendChild(node);
 }
 const content=new XMLSerializer().serializeToString(document);
 if(old===content)return;
 const backupRoot=join(options.data,'gcp-pdf/integration-backups');
 if(old!==undefined)await backup(file,old,backupRoot);
 await mkdir(dirname(file),{recursive:true});await writeAtomic(file,content,0o600);
}
export async function installUnixIntegration(options:DesktopOptions,enabled:boolean){
 const files=desktopFiles(options),backupRoot=join(options.data,'gcp-pdf/integration-backups');
 for(const file of files)await updateFile(file,file.launcher||enabled,backupRoot);
 if(options.platform==='linux'){
  const target=join(options.data,'icons/hicolor/512x512/apps/gcp-pdf.png');await mkdir(dirname(target),{recursive:true});await copyFile(options.icon,target,constants.COPYFILE_EXCL).catch(error=>{if(error.code!=='EEXIST')throw error;});
  await thunarActions(options,enabled);
 }
 return files.map(file=>file.path);
}
