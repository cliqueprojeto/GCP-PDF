import type {DocumentTool,Rect} from '../shared/types';

/** Whole-document operations the editing engine performs on a copy: watermark, header and footer,
 * flattening, cropping and redaction. This module only turns a checked request into the engine's calls;
 * it knows nothing of windows or files. Pages are 0-based here and 1-based for the engine. */
export type EngineCall={tool:string;args:Record<string,unknown>};
const colour=(value:unknown)=>typeof value==='string'&&/^#[0-9a-f]{6}$/i.test(value);
const text=(value:unknown,limit:number)=>typeof value==='string'&&value.length<=limit&&!/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value);
const between=(value:unknown,low:number,high:number)=>typeof value==='number'&&Number.isFinite(value)&&value>=low&&value<=high;
function pageNumbers(pages:unknown,count:number):number[]|undefined {
 if(pages===undefined)return undefined;
 if(!Array.isArray(pages)||!pages.length||pages.length>count||pages.some(p=>!Number.isSafeInteger(p)||p<0||p>=count))throw new Error('Escolha páginas que existam no documento.');
 return [...new Set(pages as number[])].sort((a,b)=>a-b).map(p=>p+1);
}
/** An area to redact: a page (0-based position in the document) and boxes in the engine's coordinates
 * (points from the top-left of the page as displayed). */
export interface RedactArea {page:number;rects:[number,number,number,number][]}
/** The engine calls for one tool, in order. `areas` are the redaction boxes already converted by the caller,
 * which owns the page geometry. Throws a message in Portuguese when the request is not valid. */
export function planDocumentTool(tool:DocumentTool,pageCount:number,areas:RedactArea[]=[]):EngineCall[] {
 if(!tool||typeof tool!=='object')throw new Error('Operação inválida.');
 switch(tool.kind){
  case 'watermark': {
   if(!text(tool.text,200)||!tool.text.trim())throw new Error('Digite o texto da marca-d’água.');
   if(!between(tool.opacity,.05,1)||!between(tool.rotation,-180,180)||!colour(tool.color)||(tool.fontSize!==undefined&&!between(tool.fontSize,4,400)))throw new Error('Opções da marca-d’água inválidas.');
   const pages=pageNumbers(tool.pages,pageCount);
   return [{tool:'doc_watermark',args:{text:tool.text.trim(),opacity:tool.opacity,rotation:tool.rotation,color:tool.color,behind:!!tool.behind,...(tool.fontSize!==undefined?{font_size:tool.fontSize}:{}),...(pages?{pages}:{})}}];
  }
  case 'header-footer': {
   const boxes=[...(Array.isArray(tool.header)?tool.header:[]),...(Array.isArray(tool.footer)?tool.footer:[])];
   if(boxes.length!==6||boxes.some(b=>!text(b,300)))throw new Error('Textos de cabeçalho e rodapé inválidos.');
   if(!boxes.some(b=>b.trim()))throw new Error('Preencha ao menos um texto de cabeçalho ou rodapé.');
   if(!between(tool.fontSize,4,72)||!colour(tool.color)||!['Helvetica','Times','Courier'].includes(tool.font)||!Number.isSafeInteger(tool.startNumber)||tool.startNumber<0||tool.startNumber>999_999)throw new Error('Opções de cabeçalho e rodapé inválidas.');
   const pages=pageNumbers(tool.pages,pageCount),names=['header_left','header_center','header_right','footer_left','footer_center','footer_right'];
   return [{tool:'doc_header_footer',args:{...Object.fromEntries(names.flatMap((name,i)=>boxes[i]!.trim()?[[name,boxes[i]!.trim()]]:[])),font:tool.font,font_size:tool.fontSize,color:tool.color,start_number:tool.startNumber,shrink:!!tool.shrink,...(pages?{pages}:{})}}];
  }
  case 'flatten':
   if(!tool.comments&&!tool.fields)throw new Error('Escolha achatar os comentários, os campos ou ambos.');
   return [{tool:'doc_flatten',args:{comments:!!tool.comments,fields:!!tool.fields}}];
  case 'crop': {
   if(!Array.isArray(tool.margins)||tool.margins.length!==4||tool.margins.some(m=>!between(m,0,5000)))throw new Error('Margens de corte inválidas.');
   if(!tool.margins.some(m=>m>0))throw new Error('Informe ao menos uma margem a cortar.');
   const pages=pageNumbers(tool.pages,pageCount);
   return [{tool:'page_set_box',args:{box:'crop',margins:tool.margins,...(pages?{pages}:{})}}];
  }
  case 'redact': {
   const calls:EngineCall[]=[],fill=tool.fill===undefined?{}:colour(tool.fill)?{fill:tool.fill}:(()=>{throw new Error('Cor da tarja inválida.');})();
   const pages=pageNumbers(tool.pages,pageCount),match={case_sensitive:!!tool.caseSensitive,whole_words:!!tool.wholeWords,...(pages?{pages}:{}),...fill};
   if(tool.find!==undefined){if(!text(tool.find,500)||!tool.find.trim())throw new Error('Digite o texto a ocultar.');calls.push({tool:'redact_mark',args:{find:tool.find.trim(),...match}});}
   for(const pattern of tool.patterns??[]){if(!['phone','email','credit-card','date'].includes(pattern))throw new Error('Tipo de dado a ocultar desconhecido.');calls.push({tool:'redact_mark',args:{pattern,...(pages?{pages}:{}),...fill}});}
   for(const area of areas){
    if(!Number.isSafeInteger(area.page)||area.page<0||area.page>=pageCount||!area.rects.length||area.rects.length>500)throw new Error('Área de tarja inválida.');
    for(const rect of area.rects){if(rect.length!==4||rect.some(v=>!Number.isFinite(v))||rect[2]-rect[0]<.5||rect[3]-rect[1]<.5)throw new Error('Área de tarja inválida.');calls.push({tool:'redact_mark',args:{page:area.page+1,rect,...fill}});}
   }
   if(!calls.length)throw new Error('Escolha o que ocultar: um texto, um tipo de dado ou um trecho selecionado.');
   // Marks hide nothing by themselves; applying them removes what is under each one for good.
   return [...calls,{tool:'redact_apply',args:{}}];
  }
  default: throw new Error('Operação desconhecida.');
 }
}
/** Whether a PDF declares encryption: its trailer (or cross-reference stream) names an /Encrypt dictionary.
 * Only the end of the file and the first objects are read, where trailers and linearized dictionaries are. */
export function isEncryptedPdf(bytes:Uint8Array):boolean {
 const text=(from:number,to:number)=>Buffer.from(bytes.buffer,bytes.byteOffset+from,Math.max(0,to-from)).toString('latin1');
 const tail=text(Math.max(0,bytes.length-4096),bytes.length),head=text(0,Math.min(bytes.length,4096));
 return /\/Encrypt\s*(\d+\s+\d+\s+R|<<)/.test(tail)||/\/Encrypt\s*(\d+\s+\d+\s+R|<<)/.test(head);
}
/** Whether the engine refused a redaction search only because the text is not in the document. */
export const nothingMatched=(error:unknown)=>/nothing matched/i.test(String(error instanceof Error?`${error.cause??''} ${error.message}`:error));
/** The engine words its PDF/A findings in English; the usual ones are shown in Portuguese. */
const FINDINGS:[RegExp,string][]=[
 [/^The document has no XMP metadata$/i,'O documento não tem metadados XMP'],
 [/^Device colour is used, but there is no PDF\/A output intent$/i,'Há cores de dispositivo sem um perfil de saída PDF/A'],
 [/^The font (.+) isn't embedded$/i,'A fonte $1 não está incorporada ao arquivo'],
 [/^The document is encrypted$/i,'O documento está criptografado'],
 [/^JavaScript (is|actions are) (present|not allowed).*$/i,'O documento contém JavaScript, que o PDF/A não permite'],
 [/^Transparency is used.*$/i,'Há transparência sem o espaço de cor exigido'],
];
const finding=(message:string)=>{for(const [pattern,text] of FINDINGS)if(pattern.test(message))return message.replace(pattern,text);return message;};
/** How many marks a `redact_mark` answer reports, when it says; the engine words this differently by mode. */
export function markCount(result:unknown):number|undefined {
 if(!result||typeof result!=='object')return undefined;
 const r=result as Record<string,unknown>;
 for(const key of ['marked','marks','count','matches','added'])if(typeof r[key]==='number')return r[key] as number;else if(Array.isArray(r[key]))return (r[key] as unknown[]).length;
 return undefined;
}
/** Messages of a report (PDF/A problems, what a conversion left unfixed), wherever the engine nests them. */
export function reportLines(result:unknown,limit=60):string[] {
 const lines:string[]=[],seen=new Set<unknown>();
 const visit=(value:unknown,depth:number)=>{
  if(lines.length>=limit||depth>6||!value||typeof value!=='object'||seen.has(value))return;
  seen.add(value);
  if(Array.isArray(value)){for(const item of value)visit(item,depth+1);return;}
  const r=value as Record<string,unknown>,message=r.message??r.description;
  if(typeof message==='string'&&message.trim()){const clause=typeof r.clause==='string'?`${r.clause} — `:'',page=typeof r.page==='number'?` (página ${r.page})`:'';lines.push(`${clause}${finding(message.trim())}${page}`);return;}
  for(const item of Object.values(r))visit(item,depth+1);
 };
 visit(result,0);
 return [...new Set(lines)];
}
/** A box in the app's page coordinates as the engine's displayed box, given the page's own size and total rotation. */
export function displayedRect(rect:Rect,size:{width:number;height:number},rotation:number,fromPage:(x:number,y:number,size:{width:number;height:number},rotation:number,scale:number)=>{x:number;y:number}):[number,number,number,number] {
 const a=fromPage(rect.x,rect.y,size,rotation,1),b=fromPage(rect.x+rect.width,rect.y+rect.height,size,rotation,1);
 return [Math.min(a.x,b.x),Math.min(a.y,b.y),Math.max(a.x,b.x),Math.max(a.y,b.y)];
}
