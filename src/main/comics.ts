import {createHash} from 'node:crypto';
import {ArchiveReader, libarchiveWasm} from 'libarchive-wasm';

/** Comic books (.cbz zip, .cbr rar, .cb7 7-Zip): the page images of the archive in reading order.
 * libarchive (BSD) compiled to WebAssembly reads all three; the archive is read once and its pages
 * are kept in memory while the reader is open, each handed to the window only when shown. */
export interface ParsedComic {id:string;title:string;names:string[];pages:{data:Uint8Array;type:string}[]}
const TYPES:Record<string,string>={jpg:'image/jpeg',jpeg:'image/jpeg',png:'image/png',webp:'image/webp',gif:'image/gif',avif:'image/avif',bmp:'image/bmp'};
export const COMIC_EXTENSIONS=['.cbz','.cbr','.cb7'];
let module:ReturnType<typeof libarchiveWasm>|undefined;
const collator=new Intl.Collator('pt-BR',{numeric:true,sensitivity:'base'});

export async function readComic(bytes:Uint8Array,name:string):Promise<ParsedComic>{
 module??=libarchiveWasm();
 const reader=new ArchiveReader(await module,new Int8Array(bytes.buffer,bytes.byteOffset,bytes.byteLength));
 const found:{name:string;data:Uint8Array;type:string}[]=[];
 try{
  for(const entry of reader.entries()){
   const path=entry.getPathname()??'',base=path.split(/[\\/]/).pop()??'';
   const type=TYPES[base.split('.').pop()?.toLowerCase()??''];
   // Skip folders, resource forks and hidden files that some archivers add next to the pages.
   if(!type||!base||base.startsWith('.')||/(^|[\\/])__MACOSX[\\/]/.test(path)||entry.getFiletype()!=='File')continue;
   const data=entry.readData();
   if(data?.length)found.push({name:path,data:new Uint8Array(data.buffer.slice(data.byteOffset,data.byteOffset+data.byteLength)),type});
  }
 }finally{reader.free();}
 if(!found.length)throw new Error('Este arquivo não tem páginas de imagem que o leitor reconheça.');
 found.sort((a,b)=>collator.compare(a.name,b.name));
 const title=name.replace(/\.(cbz|cbr|cb7)$/i,'').replace(/[_]+/g,' ').trim()||name;
 return {id:createHash('sha256').update(name).update(String(bytes.length)).update(found.map(p=>p.name).join('\n')).digest('hex').slice(0,24),title,names:found.map(p=>p.name),pages:found.map(({data,type})=>({data,type}))};
}
