import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {open} from 'node:fs/promises';

/** Decode file URLs once. Native paths (including literal %/#) are never URL-decoded. */
export function launchPaths(args:readonly string[],cwd:string,appPath?:string):string[] {
 const result:string[]=[];
 let literal=false;
 for(const arg of args.slice(1)) {
  if(arg==='--'&&!literal){literal=true;continue;}
  if(!literal&&arg.startsWith('-'))continue;
  let path:string;
  if(/^file:/i.test(arg)){
   const url=new URL(arg);
   if(url.search||url.hash)throw new Error('O endereço file:// contém parâmetros ou fragmentos. Use o endereço do arquivo.');
   path=fileURLToPath(url);
  }else{
   if(/^[a-z][a-z\d+.-]*:\/\//i.test(arg))throw new Error('Este endereço não é um caminho de arquivo local. Abra o arquivo pelo drive montado no gerenciador de arquivos.');
   path=resolve(cwd,arg);
  }
  if(appPath&&resolve(path)===resolve(appPath))continue;
  if(!result.includes(path))result.push(path);
 }
 return result;
}

/** GVFS can expose Drive IDs without .pdf. Probe only the PDF header, without loading the document. */
export async function hasPdfHeader(path:string):Promise<boolean> {
 const handle=await open(path,'r');
 try{const header=Buffer.alloc(1024);const {bytesRead}=await handle.read(header,0,header.length,0);return /%PDF-\d\.\d/.test(header.subarray(0,bytesRead).toString('latin1'));}
 finally{await handle.close();}
}
