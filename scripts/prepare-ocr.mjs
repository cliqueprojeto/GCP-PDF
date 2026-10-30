import {readFile,writeFile,mkdir,rename,rm} from 'node:fs/promises';
import {createHash,randomUUID} from 'node:crypto';
const models={eng:'7d4322bd2a7749724879683fc3912cb542f19906c83bcc1a52132556427170b2',spa:'6f2e04d02774a18f01bed44b1111f2cd7f3ba7ac9dc4373cd3f898a40ea6b464'};
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
export async function prepareOcr(){
 await mkdir('assets/tessdata',{recursive:true});
 for(const [language,digest] of Object.entries(models)){
  const file=`assets/tessdata/${language}.traineddata`;
  const existing=await readFile(file).catch(error=>{if(error.code!=='ENOENT')throw error;return null;});
  if(existing&&hash(existing)===digest)continue;
  const response=await fetch(`https://raw.githubusercontent.com/tesseract-ocr/tessdata_fast/4.1.0/${language}.traineddata`,{signal:AbortSignal.timeout(60000)});
  if(!response.ok)throw new Error(`Falha ao baixar modelo OCR ${language}: ${response.status}`);
  const bytes=Buffer.from(await response.arrayBuffer());
  if(hash(bytes)!==digest)throw new Error(`SHA-256 inválido no modelo OCR ${language}.`);
  const temp=file+'.'+randomUUID()+'.tmp';
  try{await writeFile(temp,bytes,{flag:'wx'});await rename(temp,file);}finally{await rm(temp,{force:true});}
 }
}
