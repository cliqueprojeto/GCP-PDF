import {randomUUID} from 'node:crypto';
import {basename,extname,join} from 'node:path';
import {readFile,stat,writeFile,rm} from 'node:fs/promises';
import type {Certificate} from '../shared/types';

/** One user-selected identity per window. References, never private-key paths,
 * cross IPC. Passwords are used only by the current signing request. */
export class CertificateFiles {
 private selected=new Map<number,{id:string;path:string}>();
 async select(owner:number,path:string):Promise<Certificate>{
  if(!['.pfx','.p12'].includes(extname(path).toLowerCase()))throw new Error('Escolha um certificado A1 em arquivo .pfx ou .p12.');
  const info=await stat(path);
  if(!info.isFile()||info.size===0||info.size>16*1024*1024)throw new Error('O arquivo de certificado deve ter até 16 MB e não pode estar vazio.');
  const id=`file:${randomUUID()}`;this.selected.set(owner,{id,path});
  return {id,name:basename(path),issuer:'Arquivo A1 (PKCS#12)',validTo:'',icp:false,kind:'A1'};
 }
 forget(owner:number){this.selected.delete(owner);}
 /** The engine reads inside its private root. Retain cleanup ownership until
  * the operation and removal complete; never log or persist the password. */
 async use<T>(owner:number,id:string,root:string,run:(file:string)=>Promise<T>):Promise<T>{
  const selected=this.selected.get(owner);
  if(!selected||selected.id!==id)throw new Error('Escolha novamente o arquivo do certificado nesta janela.');
  const info=await stat(selected.path);
  if(!info.isFile()||info.size===0||info.size>16*1024*1024)throw new Error('O arquivo do certificado está vazio ou excede 16 MB.');
  const file=`certificado-${randomUUID()}.p12`,path=join(root,file);
  const bytes=await readFile(selected.path);
  try{await writeFile(path,bytes,{flag:'wx',mode:0o600});return await run(file);}
  finally{bytes.fill(0);await rm(path,{force:true});}
 }
}
