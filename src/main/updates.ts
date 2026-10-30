import {app} from 'electron';
import {createHash} from 'node:crypto';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {spawn} from 'node:child_process';
import type {UpdateInfo,UpdatePreferences} from '../shared/types';

/** Updates from the public GitHub releases of the project. No account or token is needed to check or download.
 * Each release carries the installer and MANIFEST (version, notes, installer name, size and SHA-256), read through
 * the github.com release links. The REST API is only the fallback for releases without a manifest (up to 0.3.6): its
 * anonymous limit (60 requests an hour) is per IP address, and Brazilian providers often share one IP among many
 * customers (CGNAT), so it can be exhausted by others. */
export const UPDATE_REPOSITORY='cliqueprojeto/GCP-PDF';
export const MANIFEST='atualizacao.json';
const API='https://api.github.com',WEB=`https://github.com/${UPDATE_REPOSITORY}`;
const INSTALLER=/^GCP-PDF-Instalador-[\w.-]+-x64\.exe$/i;
const INTERVAL:Record<UpdatePreferences['frequency'],number>={never:Infinity,startup:0,daily:86_400_000,weekly:7*86_400_000,biweekly:14*86_400_000,monthly:30*86_400_000};

export function due(prefs:UpdatePreferences){return prefs.frequency!=='never'&&Date.now()-(prefs.lastCheck??0)>=INTERVAL[prefs.frequency];}
const parts=(v:string)=>v.replace(/^v/i,'').split(/[.-]/).slice(0,3).map(n=>Number.parseInt(n,10)||0);
export function newer(candidate:string,current:string){const a=parts(candidate),b=parts(current);for(let i=0;i<3;i++){if(a[i]!==b[i])return a[i]!>b[i]!;}return false;}

function headers(accept='application/vnd.github+json'){return {Accept:accept,'User-Agent':`GCP-PDF/${app.getVersion()}`,'X-GitHub-Api-Version':'2022-11-28'};}
function explain(status:number){
 if(status===404)return 'O endereço de atualizações do GCP-PDF não foi encontrado no GitHub. Tente novamente mais tarde.';
 if(status===403||status===429)return 'O GitHub limitou as consultas por enquanto. Tente novamente mais tarde.';
 return `O GitHub respondeu com erro (${status}). Tente novamente mais tarde.`;
}
/** The latest release through github.com links: null when already up to date, undefined when the release has
 * no manifest (or the site could not be read), so the API is asked instead. */
async function fromManifest():Promise<UpdateInfo|null|undefined>{
 const options={headers:{'User-Agent':`GCP-PDF/${app.getVersion()}`},redirect:'follow' as const,signal:AbortSignal.timeout(20_000)};
 const latest=await fetch(`${WEB}/releases/latest`,{...options,method:'HEAD'});
 const tag=/\/releases\/tag\/([^/?#]+)$/.exec(new URL(latest.url).pathname)?.[1];
 if(!latest.ok||!tag)return undefined;
 if(!newer(decodeURIComponent(tag),app.getVersion()))return null;
 const response=await fetch(`${WEB}/releases/download/${tag}/${MANIFEST}`,options);
 if(!response.ok)return undefined;
 const m=await response.json() as Record<string,unknown>;
 if(typeof m.version!=='string'||typeof m.assetName!=='string'||!INSTALLER.test(m.assetName)||typeof m.sha256!=='string'||!/^[0-9a-f]{64}$/i.test(m.sha256)||!Number.isSafeInteger(m.size))throw new Error('As informações da nova versão publicadas no GitHub estão incompletas. Tente novamente mais tarde.');
 return {version:m.version.replace(/^v/i,''),current:app.getVersion(),notes:typeof m.notes==='string'?m.notes:'',published:typeof m.published==='string'?m.published:'',size:m.size as number,assetUrl:`${WEB}/releases/download/${tag}/${encodeURIComponent(m.assetName)}`,assetName:m.assetName,sha256:m.sha256.toLowerCase()};
}
/** Latest release, or null when the installed version is already the newest. */
export async function checkForUpdate():Promise<UpdateInfo|null>{
 const viaSite=await fromManifest().catch((error:unknown)=>{if(error instanceof Error&&error.message.startsWith('As informações'))throw error;return undefined;});
 if(viaSite!==undefined)return viaSite;
 let response:Response;
 try{response=await fetch(`${API}/repos/${UPDATE_REPOSITORY}/releases?per_page=20`,{headers:headers(),redirect:'follow',signal:AbortSignal.timeout(20_000)});}
 catch{throw new Error('Sem conexão com o GitHub para verificar atualizações. Verifique a internet.');}
 if(!response.ok)throw new Error(explain(response.status));
 const releases=(await response.json()) as any[];
 const best=releases.filter(r=>!r.draft&&!r.prerelease&&typeof r.tag_name==='string').sort((a,b)=>newer(a.tag_name,b.tag_name)?-1:newer(b.tag_name,a.tag_name)?1:0)[0];
 if(!best||!newer(best.tag_name,app.getVersion()))return null;
 const asset=(best.assets??[]).find((a:any)=>/Instalador.*x64\.exe$/i.test(a.name));
 if(!asset)throw new Error(`A versão ${best.tag_name} foi publicada sem o instalador do Windows.`);
 const notes=String(best.body??''),sha=new RegExp(`${asset.name.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')}\\s*[:=]?\\s*\`?([0-9a-f]{64})`,'i').exec(notes)?.[1]??/sha-?256\s*[:=]\s*`?([0-9a-f]{64})/i.exec(notes)?.[1];
 return {version:best.tag_name.replace(/^v/i,''),current:app.getVersion(),notes:notes.replace(/\n?SHA-?256[^\n]*/gi,'').trim(),published:best.published_at??'',size:Number(asset.size)||0,assetUrl:String(asset.url),assetName:String(asset.name),sha256:sha?.toLowerCase()};
}
/** Downloads the installer (checking its size and SHA-256), runs it silently and closes the app for it. */
export async function installUpdate(info:UpdateInfo,progress:(done:number,total:number)=>void){
 if(!info.sha256)throw new Error('Esta versão não informa a assinatura de integridade (SHA-256) do instalador; por segurança, baixe-a manualmente do GitHub.');
 const response=await fetch(info.assetUrl,{headers:headers('application/octet-stream'),redirect:'follow',signal:AbortSignal.timeout(30*60_000)}).catch(()=>{throw new Error('Não foi possível baixar a atualização. Verifique a internet.');});
 if(!response.ok||!response.body)throw new Error(explain(response.status));
 const total=Number(response.headers.get('content-length'))||info.size,chunks:Uint8Array[]=[],hash=createHash('sha256');let done=0;
 const reader=response.body.getReader();
 for(;;){const {value,done:end}=await reader.read();if(end)break;chunks.push(value);hash.update(value);done+=value.length;if(done>600*1024*1024)throw new Error('O arquivo de atualização é grande demais.');progress(done,total);}
 if(info.size&&done!==info.size)throw new Error('O download da atualização ficou incompleto. Tente de novo.');
 if(hash.digest('hex')!==info.sha256)throw new Error('O instalador baixado não confere com a assinatura publicada (SHA-256). A atualização foi cancelada.');
 const folder=await mkdtemp(join(tmpdir(),'gcp-pdf-update-')),file=join(folder,info.assetName);
 await writeFile(file,Buffer.concat(chunks),{mode:0o700});
 // NSIS: /S installs silently over the current installation; --force-run opens the app again when done.
 const child=spawn(file,['/S','--force-run'],{detached:true,stdio:'ignore',windowsHide:false});
 child.on('error',()=>void rm(folder,{recursive:true,force:true}).catch(()=>{}));
 child.unref();
 setTimeout(()=>app.quit(),800);
}
