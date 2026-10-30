import {realpath} from 'node:fs/promises';
import path from 'node:path';
import {PDFDocument,PDFArray,PDFDict,PDFName,PDFNumber} from 'pdf-lib';

type RawSignature={field?:unknown;name?:unknown;status?:unknown;signer?:unknown;date?:unknown;certificate?:{name?:unknown};details?:unknown;summary?:unknown;explanation?:unknown;modification?:unknown};
export function signatureList(result:unknown):RawSignature[]{const data=result as {signatures?:unknown;fields?:unknown}|null;const list=data?.signatures??data?.fields;return Array.isArray(list)?list.filter(item=>item&&typeof item==='object'):[];}
const nameOf=(signature:RawSignature)=>String(signature.field??signature.name??'');
const detailsOf=(signature:RawSignature)=>[...(Array.isArray(signature.details)?signature.details.filter(item=>typeof item==='string'):[]),signature.explanation,signature.summary].filter(item=>typeof item==='string').join(' ');
/** Resolves aliases before comparing, including different Windows casing and short path spellings. */
export async function sameFilePath(first:string,second:string):Promise<boolean>{
 const normalize=async(value:string)=>{const resolved=await realpath(value).catch(()=>path.resolve(value));return process.platform==='win32'?resolved.toLowerCase():resolved;};
 const [a,b]=await Promise.all([normalize(first),normalize(second)]);return a===b;
}
export async function refusesSignedOverwrite(protectedPath:string|undefined,target:string,changed:boolean):Promise<void>{
 if(protectedPath&&changed&&await sameFilePath(protectedPath,target))throw new Error('O arquivo original assinado não pode ser sobrescrito com alterações. Escolha outro nome ou outra pasta para salvar a cópia.');
}
/** Unknown is broader than an untrusted chain: unsupported algorithms must never be called intact. */
function onlyUntrustedChain(signature:RawSignature):boolean{
 const detail=detailsOf(signature);
 return /This document has not been modified since this signature was applied\./i.test(detail)&&/signer.s identity is unknown because.*trusted certificates/i.test(detail)&&!/(?:can.t check|unsupported|not supported|not valid at|revoked|incomplete|could not|cannot|does not match|no valid byte range|not permitted)/i.test(detail);
}
export function signatureSummary(signature:RawSignature,modified=false){
 const rawStatus=String(signature.status??'unknown'),detail=detailsOf(signature);let explanation:string;
 if(/byte range/i.test(detail)&&rawStatus==='invalid')explanation='Os intervalos de bytes da assinatura não correspondem ao arquivo. Esta cópia já está inválida e precisa ser assinada novamente a partir de um PDF íntegro.';
 else if(rawStatus==='invalid')explanation='O conteúdo, o certificado ou as alterações do PDF não passaram na verificação da assinatura digital.';
 else if(rawStatus==='valid')explanation=signature.modification==='allowed'?'A assinatura está íntegra. O motor identificou alterações posteriores permitidas pela política do documento.':'A assinatura passou nas verificações locais de integridade e certificado.';
 else if(rawStatus==='unsigned')explanation='Este campo ainda não recebeu uma assinatura digital.';
 else if(onlyUntrustedChain(signature))explanation='A assinatura passou na verificação criptográfica, mas a cadeia do certificado não foi reconhecida neste computador.';
 else explanation='Não foi possível confirmar a validade desta assinatura na verificação local. O formato, algoritmo ou certificado pode exigir outra ferramenta de validação.';
 if(modified&&rawStatus!=='unsigned')explanation='Há alterações não salvas nesta visualização. A verificação abaixo considera a cópia atual, não apenas o arquivo original. '+explanation+' O original assinado será preservado ao salvar uma cópia.';
 return{name:nameOf(signature),status:modified&&rawStatus!=='unsigned'?'modified':rawStatus,signer:String(signature.signer??signature.certificate?.name??''),date:String(signature.date??''),explanation};
}
/** Validates only the newly produced signature; pre-existing invalid signatures do not mask its outcome. */
export async function validateNewSignature(bytes:Uint8Array,before:unknown,after:unknown,produced:unknown):Promise<{field:string;trusted:boolean}>{
 const beforeList=signatureList(before),afterList=signatureList(after),result=produced as {signature?:RawSignature}|null;
 const expected=result?.signature?nameOf(result.signature):'';
 const signedBefore=new Set(beforeList.filter(item=>item.status!=='unsigned').map(nameOf));
 const candidates=expected?afterList.filter(item=>nameOf(item)===expected):afterList.filter(item=>item.status!=='unsigned'&&!signedBefore.has(nameOf(item)));
 if(candidates.length!==1)throw new Error('Não foi possível identificar uma nova assinatura verificável no arquivo gerado. Nenhum arquivo foi gravado.');
 const signature=candidates[0]!,field=nameOf(signature),trusted=signature.status==='valid';
 if(!trusted&&!(signature.status==='unknown'&&onlyUntrustedChain(signature)))throw new Error('A assinatura recém-criada não passou na verificação local. O arquivo não foi gravado; o documento original foi preservado.');
 const pdf=await PDFDocument.load(bytes,{updateMetadata:false}),formField=pdf.getForm().getFields().find(item=>item.getName()===field),value=formField?.acroField.dict.lookupMaybe(PDFName.of('V'),PDFDict),range=value?.lookupMaybe(PDFName.of('ByteRange'),PDFArray);
 if(!range||range.size()!==4)throw new Error('A nova assinatura não contém intervalos de bytes válidos. Nenhum arquivo foi gravado.');
 const numbers=Array.from({length:4},(_,index)=>range.lookup(index,PDFNumber).asNumber()),[start,length,next,rest]=numbers as [number,number,number,number];
 const gap=bytes.subarray(length,next);
 if(numbers.some(item=>!Number.isSafeInteger(item)||item<0)||start!==0||next<=length||next+rest!==bytes.length||gap[0]!==0x3c||gap.at(-1)!==0x3e)throw new Error('Os intervalos de bytes da nova assinatura não correspondem ao arquivo final. Nenhum arquivo foi gravado.');
 return{field,trusted};
}
