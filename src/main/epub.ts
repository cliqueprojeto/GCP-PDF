import {createCanvas} from '@napi-rs/canvas';
import {zipSync,strToU8} from 'fflate';
import {createHash,randomUUID} from 'node:crypto';
import type {PDFPageProxy} from 'pdfjs-dist/types/src/display/api';
import {inspectPage,loadPdf} from './conversion';
import {FontContext,buildBlocks,buildLines,pageRuns,type Block,type Line,type Run} from './word-layout';
import {bodyStyle,flowPage,splitRepeats,type FlowItem,type FlowPage,type PageImage} from './docx-flow';
import type {EpubAnalysis,EpubChapter,EpubOptions} from '../shared/types';

/** PDF → EPUB 3 (with EPUB 2 NCX for older readers). The text is rebuilt as flowing paragraphs from the
 * same page reading used by the Word export: repeated headers, footers and page numbers are dropped,
 * hyphenated line ends are joined, and paragraphs continue across pages. Chapters come from the PDF's
 * bookmarks or, without them, from its largest repeated heading size. Footnotes become EPUB footnotes
 * (noteref ↔ footnote, both linked), which phone and e-reader apps show as pop-ups. */

type BookPage = {number:number;items:FlowItem[];art?:{jpeg:Buffer;width:number;height:number}};
interface Book {pages:BookPage[];body:number;outline:EpubChapter[];title:string;author:string}
type Note = {id:string;marker:string;html:string};

const esc=(text:string)=>text.replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'})[c]!);
const flat=(text:string)=>text.normalize('NFC').toLocaleLowerCase('pt-BR').replace(/[^\p{L}\p{N}]+/gu,' ').trim();
const blockText=(b:Block)=>b.lines.map(l=>l.runs.map(r=>r.text).join(' ')).join(' ').replace(/\s+/g,' ').trim();
const MARK=/^\s*(\d{1,3}|[*†‡§]{1,3})\s*$/;

/** A run printed smaller and above its line's baseline: a footnote reference. */
const superscript=(run:Run,line:Line)=>MARK.test(run.text)&&run.size<=line.size*0.82&&run.baseline<line.baseline-run.size*0.2;

let cached:{key:string;book:Promise<Book>}|null=null;
/** Reads the PDF once per document version: analysis and conversion share it. */
function readBook(bytes:Uint8Array,onProgress?:(message:string)=>void):Promise<Book> {
 // Analysis and conversion materialize the document separately: the same bytes reuse one reading.
 const key=createHash('sha256').update(bytes).digest('hex');
 if(cached?.key===key)return cached.book;
 const book=(async()=>{
  const pdf=await loadPdf(bytes),fonts=await FontContext.of(bytes,false);
  try {
   const flows:FlowPage[]=[],pages:BookPage[]=[];
   for(let i=1;i<=pdf.numPages;i++){
    onProgress?.(`Lendo página ${i} de ${pdf.numPages}…`);
    const page=await pdf.getPage(i),images=(await inspectPage(page,true)).images.filter(m=>m.width>24&&m.height>24);
    const flow=await flowPage(page,fonts,images)??await looseFlow(page,fonts,i,images);
    if(flow){flows.push(flow);pages.push({number:i,items:[]});}
    else pages.push({number:i,items:[],art:await renderArt(page)});
    page.cleanup();
   }
   const {body}=splitRepeats(flows);
   let k=0;for(const page of pages)if(!page.art)page.items=attachSuperscripts(body[k++]!);
   const info=await pdf.getMetadata().catch(()=>null) as {info?:{Title?:string;Author?:string}}|null;
   return {pages,body:bodyStyle(flows).size/2||11,outline:await outlineChapters(pdf),title:String(info?.info?.Title??'').trim(),author:String(info?.info?.Author??'').trim()};
  } finally { await pdf.loadingTask.destroy(); }
 })();
 cached={key,book};book.catch(()=>{if(cached?.book===book)cached=null;});
 return book;
}
/** A reference raised above its line is read as a line of its own (the baseline differs by a third of
 * the size). Put each lone small marker back into the text line it belongs to, at its place. */
function attachSuperscripts(items:FlowItem[]):FlowItem[] {
 const paragraphs=items.filter((i):i is Extract<FlowItem,{kind:'paragraph'}>=>i.kind==='paragraph');
 const lone=paragraphs.filter(p=>p.block.lines.length===1&&p.block.lines[0]!.runs.length===1&&MARK.test(p.block.lines[0]!.runs[0]!.text));
 const moved=new Set<FlowItem>();
 for(const marker of lone){
  const run=marker.block.lines[0]!.runs[0]!;
  for(const host of paragraphs){
   if(host===marker||moved.has(host))continue;
   const line=host.block.lines.find(l=>run.size<=l.size*0.82&&run.baseline<l.baseline-run.size*0.2&&run.baseline>l.baseline-l.size*1.05&&run.x>=l.x-1&&run.x<=l.right+l.size);
   if(!line)continue;
   line.runs=[...line.runs,run].sort((a,b)=>a.x-b.x);line.right=Math.max(line.right,run.x+run.width);
   moved.add(marker);break;
  }
 }
 return items.filter(i=>!moved.has(i));
}
/** Pages the Word reader keeps as artwork can still be text pages of a book (a coloured box, an ornament):
 * their paragraphs are read in order. Pages with almost no text stay pictures. */
async function looseFlow(page:PDFPageProxy,fonts:FontContext,number:number,images:PageImage[]):Promise<FlowPage|null> {
 const runs=await pageRuns(page,fonts),chars=runs.reduce((n,r)=>n+r.text.trim().length,0);
 if(chars<200)return null;
 const view=page.getViewport({scale:1});
 const items:FlowItem[]=buildBlocks(buildLines(runs)).map(block=>({kind:'paragraph',top:block.lines[0]!.baseline-block.size*.95,bottom:block.lines.at(-1)!.baseline+block.size*.27,block}));
 for(const image of images)items.push({kind:'image',top:image.y,bottom:image.y+image.height,image});
 return {width:view.width,height:view.height,items:items.sort((a,b)=>a.top-b.top),runs,number};
}
async function renderArt(page:PDFPageProxy) {
 const view=page.getViewport({scale:1}),scale=Math.min(2,1400/Math.max(view.width,view.height)),viewport=page.getViewport({scale});
 const canvas=createCanvas(Math.ceil(viewport.width),Math.ceil(viewport.height));
 await page.render({canvas:canvas as never,canvasContext:canvas.getContext('2d') as never,viewport,background:'white'}).promise;
 return {jpeg:canvas.toBuffer('image/jpeg',86),width:canvas.width,height:canvas.height};
}
async function outlineChapters(pdf:Awaited<ReturnType<typeof loadPdf>>):Promise<EpubChapter[]> {
 const outline=await pdf.getOutline().catch(()=>null);if(!outline?.length)return [];
 const out:EpubChapter[]=[];
 const visit=async(items:typeof outline,level:1|2)=>{for(const item of items){
  try{const dest=typeof item.dest==='string'?await pdf.getDestination(item.dest):item.dest;const ref=Array.isArray(dest)?dest[0]:null;
   const page=ref&&typeof ref==='object'?await pdf.getPageIndex(ref as never):typeof ref==='number'?ref:-1;
   if(page>=0&&item.title?.trim())out.push({title:item.title.trim(),page,level});}catch{}
  if(level===1&&item.items?.length)await visit(item.items,2);
 }};
 await visit(outline,1);
 return out.sort((a,b)=>a.page-b.page);
}
/** Headings are short blocks printed clearly larger than the body. The largest size used for at least
 * two headings marks chapters (a single larger one is usually the book's title); the next one sections. */
function headingChapters(book:Book):EpubChapter[] {
 const found:{size:number;title:string;page:number}[]=[];
 for(const page of book.pages)for(const item of page.items){
  if(item.kind!=='paragraph'||item.list)continue;
  const text=blockText(item.block);
  if(item.block.size>=book.body*1.25&&item.block.lines.length<=3&&text.length>1&&text.length<=120&&!/^\d+$/.test(text))found.push({size:Math.round(item.block.size*2)/2,title:text,page:page.number-1});
 }
 const sizes=[...new Set(found.map(h=>h.size))].sort((a,b)=>b-a),count=(s:number)=>found.filter(h=>h.size===s).length;
 const top=sizes.find(s=>count(s)>=2)??sizes[0];
 if(top===undefined)return [];
 const second=sizes.find(s=>s<top&&count(s)>=2);
 return found.filter(h=>h.size===top||h.size===second).map(h=>({title:h.title,page:h.page,level:h.size===top?1:2}));
}

export async function analyzeEpub(bytes:Uint8Array,onProgress?:(message:string)=>void):Promise<EpubAnalysis> {
 const book=await readBook(bytes,onProgress);
 const chapters=book.outline.length?book.outline:headingChapters(book);
 let footnotes=0;
 for(const page of book.pages)footnotes+=pageNotes(page,book.body).notes.size;
 const first=book.pages.find(p=>p.items.length)?.items.find((i):i is Extract<FlowItem,{kind:'paragraph'}>=>i.kind==='paragraph');
 return {pages:book.pages.length,chapters,source:book.outline.length?'outline':chapters.length?'headings':'none',title:book.title||(first?blockText(first.block).slice(0,120):''),author:book.author,footnotes};
}

/** Footnote paragraphs at the bottom of a page, by their marker, when the page's text references them. */
function pageNotes(page:BookPage,body:number) {
 const refs=new Set<string>();
 for(const item of page.items)if(item.kind==='paragraph')for(const line of item.block.lines)for(const run of line.runs)if(superscript(run,line))refs.add(run.text.trim());
 const notes=new Map<string,FlowItem[]>(),skip=new Set<FlowItem>();
 if(!refs.size)return {refs,notes,skip};
 const paragraphs=page.items.filter((i):i is Extract<FlowItem,{kind:'paragraph'}>=>i.kind==='paragraph');
 const bottom=Math.max(...page.items.map(i=>i.bottom));
 let current:string|null=null;
 for(const item of paragraphs){
  const head=item.block.lines[0]!.runs[0]!,marker=(/^\s*(\d{1,3}|[*†‡§]{1,3})(?=[\s.)]|$)/.exec(head.text)?.[1])??(item.block.lines[0]!.runs.length>1&&MARK.test(head.text)?head.text.trim():undefined);
  const small=item.block.size<=body*0.95,low=item.top>bottom-(bottom-Math.min(...page.items.map(i=>i.top)))*0.5;
  if(marker&&refs.has(marker)&&small&&low){current=marker;notes.set(marker,[item]);skip.add(item);continue;}
  if(current&&small&&low&&item.top>notes.get(current)!.at(-1)!.top){notes.get(current)!.push(item);skip.add(item);continue;}
  current=null;
 }
 return {refs,notes,skip};
}

/** Inline XHTML of a block's text: bold/italic spans, superscript references as links to their notes,
 * hyphenated line breaks joined. */
function inline(block:Block,link?:(marker:string)=>string|undefined,dropMarker?:string):string {
 let html='',plain='';
 block.lines.forEach((line,li)=>{
  line.runs.forEach((run,ri)=>{
   let text=run.text;
   if(li===0&&ri===0&&dropMarker)text=text.replace(new RegExp(`^\\s*${dropMarker.replace(/[*†‡§]/g,'\\$&')}[.)]?\\s*`),'');
   const previous=line.runs[ri-1],gap=previous?run.x-(previous.x+previous.width):0;
   const space=ri===0?(li>0&&!/-$/.test(plain)?' ':''):run.space||gap>run.size*0.15?' ':'';
   if(li>0&&ri===0&&/[\p{L}]-$/u.test(plain)&&/^\p{Ll}/u.test(text)){html=html.replace(/-(<\/(?:strong|em)>)*$/,'$1');plain=plain.slice(0,-1);}
   if(link&&superscript(run,line)){const href=link(run.text.trim());if(href){html+=`<a class="noteref" epub:type="noteref" ${href}><sup>${esc(run.text.trim())}</sup></a>`;plain+=run.text.trim();return;}}
   const body=esc((space&&!/^\s/.test(text)?' ':'')+text);
   html+=run.bold&&run.italic?`<strong><em>${body}</em></strong>`:run.bold?`<strong>${body}</strong>`:run.italic?`<em>${body}</em>`:body;
   plain+=(space?' ':'')+text;
  });
 });
 return html.replace(/<\/strong><strong>|<\/em><em>/g,'').replace(/\s+/g,' ').trim();
}

interface Built {xhtml:string;images:{name:string;bytes:Buffer;type:string}[]}
function chapterBody(book:Book,chapters:EpubChapter[],index:number,images:Built['images']):{html:string;notes:Note[]} {
 const chapter=chapters[index]!,next=chapters[index+1];
 const start=(c:EpubChapter)=>{const page=book.pages[c.page];const target=flat(c.title);const at=page?.items.findIndex(i=>i.kind==='paragraph'&&target&&flat(blockText(i.block)).startsWith(target.slice(0,40)))??-1;return {page:c.page,item:Math.max(0,at)};};
 const from=start(chapter),to=next?start(next):{page:book.pages.length,item:0};
 const parts:string[]=[],notes:Note[]=[];
 let open:string|null=null;
 const flush=()=>{if(open!==null){parts.push(`<p>${open}</p>`);open=null;}};
 for(let p=from.page;p<=Math.min(to.page,book.pages.length-1);p++){
  const page=book.pages[p]!;
  if(page.art){if(p===to.page)break;flush();const name=`images/pagina-${page.number}.jpg`;images.push({name,bytes:page.art.jpeg,type:'image/jpeg'});parts.push(`<figure class="page-art"><img src="../${name}" alt="Página ${page.number}"/></figure>`);continue;}
  const {notes:found,skip}=pageNotes(page,book.body),ids=new Map<string,string>();
  for(const marker of found.keys())ids.set(marker,`p${page.number}-n${marker.replace(/[^\w]/g,c=>c.charCodeAt(0).toString(16))}`);
  const link=(marker:string)=>{const id=ids.get(marker);return id?`href="#fn-${id}" id="ref-${id}"`:undefined;};
  page.items.forEach((item,i)=>{
   if((p===from.page&&i<from.item)||(p===to.page&&i>=to.item)||skip.has(item))return;
   if(item.kind==='paragraph'){
    const text=blockText(item.block),isTitle=chapter.title&&p===from.page&&i===from.item&&flat(text).startsWith(flat(chapter.title).slice(0,40));
    if(isTitle){flush();parts.push(`<h1>${esc(text)}</h1>`);return;}
    if(item.block.size>=book.body*1.25&&item.block.lines.length<=3&&text.length<=120){flush();parts.push(`<h2>${inline(item.block)}</h2>`);return;}
    if(item.list){flush();parts.push(`<p class="list-item">${inline(item.block,link)}</p>`);return;}
    const html=inline(item.block,link);
    // A paragraph cut by the page break continues on the next page in lowercase.
    if(open!==null&&i===page.items.findIndex(x=>!skip.has(x))&&/^\p{Ll}/u.test(text)){open=(/[\p{L}]-$/u.test(open)?open.slice(0,-1):open+' ')+html;}
    else {flush();open=html;}
    if(/[.!?:;»"”)]$/.test(text)||item.block.align==='center')flush();
    else if(i!==page.items.length-1)flush();
    if(item.block.align==='center'&&open===null&&parts.length)parts[parts.length-1]=parts.at(-1)!.replace(/^<p>/,'<p class="center">');
    return;
   }
   flush();
   if(item.kind==='image'){const name=`images/p${page.number}-${i}.png`;images.push({name,bytes:item.image.bytes,type:'image/png'});parts.push(`<figure><img src="../${name}" alt=""/></figure>`);}
   else if(item.kind==='rule')parts.push('<hr/>');
   else if(item.kind==='line')parts.push(`<p>${item.blocks.map(b=>inline(b,link)).join(' — ')}</p>`);
   else if(item.kind==='table'||item.kind==='columns'){
    const t=item.table,rows=new Map<number,string[]>();
    for(const cell of t.cells)rows.set(cell.row,[...(rows.get(cell.row)??[]),`<td${cell.cols>1?` colspan="${cell.cols}"`:''}${cell.rows>1?` rowspan="${cell.rows}"`:''}>${esc((cell.text?.text??'').replace(/\s+/g,' ').trim())}</td>`]);
    parts.push(`<table>${[...rows].sort((a,b)=>a[0]-b[0]).map(([,cells])=>`<tr>${cells.join('')}</tr>`).join('')}</table>`);
   }
  });
  for(const [marker,items] of found){const id=ids.get(marker)!;notes.push({id,marker,html:items.map((it,k)=>it.kind==='paragraph'?inline(it.block,undefined,k===0?marker:undefined):'').join(' ')});}
 }
 flush();
 return {html:parts.join('\n'),notes};
}

const CSS=`@namespace epub "http://www.idpf.org/2007/ops";
body{margin:0 4%;font-family:serif;line-height:1.5;text-align:justify;hyphens:auto;-webkit-hyphens:auto;widows:2;orphans:2}
h1{font-size:1.6em;line-height:1.25;margin:2.2em 0 1.2em;text-align:left}
h2{font-size:1.2em;margin:1.6em 0 .6em;text-align:left}
p{margin:0;text-indent:1.4em}
h1+p,h2+p,hr+p,figure+p,.list-item,.center{text-indent:0}
.list-item{margin:.25em 0 .25em 1.4em}
.center{text-align:center}
figure{margin:1em 0;text-align:center}
figure img{max-width:100%;max-height:95vh}
.page-art{page-break-before:always;break-before:page;margin:0}
table{border-collapse:collapse;margin:1em 0;width:100%;font-size:.9em}
td{border:1px solid #999;padding:.25em .4em;vertical-align:top;text-indent:0}
hr{border:0;border-top:1px solid #999;margin:1.2em 25%}
a.noteref{text-decoration:none;font-size:.75em;vertical-align:super;line-height:0}
a.noteref sup{vertical-align:baseline;font-size:1em}
section.footnotes{margin-top:2.5em;border-top:1px solid #999;padding-top:.6em;font-size:.88em}
section.footnotes h2{font-size:1em;margin-top:0}
aside.footnote p{text-indent:0;margin:.35em 0}
aside.footnote a.backlink{text-decoration:none;font-weight:bold;margin-right:.3em}
.cover{margin:0;padding:0;text-align:center}
.cover img{max-width:100%;max-height:100vh}
nav ol{list-style:none;padding-left:1em}`;
const page=(title:string,lang:string,body:string)=>`<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" xml:lang="${lang}" lang="${lang}">
<head><meta charset="UTF-8"/><title>${esc(title)}</title><link rel="stylesheet" type="text/css" href="../styles/livro.css"/></head>
<body>
${body}
</body>
</html>`;

export async function toEpub(bytes:Uint8Array,options:EpubOptions,onProgress?:(message:string)=>void):Promise<Uint8Array> {
 const book=await readBook(bytes,onProgress);
 const title=options.title.trim()||book.title||'Sem título',author=options.author.trim(),lang=options.language;
 let chapters=[...options.chapters].filter(c=>Number.isInteger(c.page)&&c.page>=0&&c.page<book.pages.length).sort((a,b)=>a.page-b.page);
 if(!chapters.length||chapters[0]!.page>0)chapters=[{title:chapters.length?'Início':title,page:0,level:1},...chapters];
 const images:Built['images']=[],files:Record<string,Uint8Array|[Uint8Array,{level:0}]>={},manifest:string[]=[],spine:string[]=[],nav:{title:string;href:string;level:1|2}[]=[];
 files['mimetype']=[strToU8('application/epub+zip'),{level:0}];
 files['META-INF/container.xml']=strToU8(`<?xml version="1.0" encoding="UTF-8"?>\n<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>`);
 files['OEBPS/styles/livro.css']=strToU8(CSS);
 manifest.push('<item id="css" href="styles/livro.css" media-type="text/css"/>');
 if(options.cover){
  const match=/^data:image\/(png|jpeg);base64,([A-Za-z0-9+/=]+)$/.exec(options.cover);
  if(!match)throw new Error('A capa precisa ser uma imagem PNG ou JPEG.');
  const ext=match[1]==='png'?'png':'jpg';
  files[`OEBPS/images/capa.${ext}`]=Buffer.from(match[2]!,'base64');
  manifest.push(`<item id="cover-image" href="images/capa.${ext}" media-type="image/${match[1]}" properties="cover-image"/>`);
  files['OEBPS/text/capa.xhtml']=strToU8(page('Capa',lang,`<section class="cover" epub:type="cover"><img src="../images/capa.${ext}" alt="${esc(title)}"/></section>`));
  manifest.push('<item id="capa" href="text/capa.xhtml" media-type="application/xhtml+xml"/>');spine.push('<itemref idref="capa" linear="yes"/>');
 }
 let notes=0;
 for(let i=0;i<chapters.length;i++){
  onProgress?.(`Montando capítulo ${i+1} de ${chapters.length}…`);
  const chapter=chapters[i]!,{html,notes:found}=chapterBody(book,chapters,i,images),name=`cap${String(i+1).padStart(3,'0')}.xhtml`;
  notes+=found.length;
  const hasTitle=html.startsWith('<h1>'),heading=hasTitle?'':`<h1>${esc(chapter.title)}</h1>\n`;
  const footnotes=found.length?`\n<section class="footnotes" epub:type="footnotes"><h2>Notas</h2>\n${found.map(n=>`<aside class="footnote" epub:type="footnote" id="fn-${n.id}"><p><a class="backlink" href="#ref-${n.id}" title="Voltar ao texto">${esc(n.marker)}</a> ${n.html}</p></aside>`).join('\n')}\n</section>`:'';
  files[`OEBPS/text/${name}`]=strToU8(page(chapter.title,lang,`<section epub:type="chapter">\n${heading}${html}${footnotes}\n</section>`));
  manifest.push(`<item id="c${i+1}" href="text/${name}" media-type="application/xhtml+xml"/>`);spine.push(`<itemref idref="c${i+1}"/>`);
  nav.push({title:chapter.title,href:`text/${name}`,level:chapter.level});
 }
 for(const [n,image] of images.entries()){files[`OEBPS/${image.name}`]=image.bytes;manifest.push(`<item id="img${n+1}" href="${image.name}" media-type="${image.type}"/>`);}
 // Table of contents: chapters with their sections nested (EPUB 3 nav and EPUB 2 NCX).
 const tree:string[]=[];let inner=false;
 for(const item of nav){
  const li=`<li><a href="${item.href.replace('text/','')}">${esc(item.title)}</a>`;
  if(item.level===2&&tree.length){if(!inner){tree[tree.length-1]=tree.at(-1)!.replace(/<\/li>$/,'')+'<ol>';inner=true;}tree.push(li+'</li>');}
  else{if(inner){tree.push('</ol></li>');inner=false;}tree.push(li+'</li>');}
 }
 if(inner)tree.push('</ol></li>');
 files['OEBPS/text/sumario.xhtml']=strToU8(page('Sumário',lang,`<nav epub:type="toc" id="toc"><h1>Sumário</h1><ol>${tree.join('')}</ol></nav>`));
 manifest.push('<item id="nav" href="text/sumario.xhtml" media-type="application/xhtml+xml" properties="nav"/>');
 spine.splice(options.cover?1:0,0,'<itemref idref="nav"/>');
 const id=`urn:uuid:${randomUUID()}`;
 files['OEBPS/toc.ncx']=strToU8(`<?xml version="1.0" encoding="UTF-8"?>\n<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1"><head><meta name="dtb:uid" content="${id}"/></head><docTitle><text>${esc(title)}</text></docTitle><navMap>${nav.map((n,k)=>`<navPoint id="n${k+1}" playOrder="${k+1}"><navLabel><text>${esc(n.title)}</text></navLabel><content src="${n.href}"/></navPoint>`).join('')}</navMap></ncx>`);
 manifest.push('<item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>');
 const year=options.year?.trim(),date=year&&/^\d{4}$/.test(year)?year:undefined;
 const meta=[
  `<dc:identifier id="bookid">${id}</dc:identifier>`,`<dc:title>${esc(title)}</dc:title>`,`<dc:language>${esc(lang)}</dc:language>`,
  author?`<dc:creator id="autor">${esc(author)}</dc:creator><meta refines="#autor" property="role" scheme="marc:relators">aut</meta><meta refines="#autor" property="file-as">${esc(fileAs(author))}</meta>`:'',
  date?`<dc:date>${date}</dc:date>`:'',
  ...(options.genre?.trim()?options.genre.split(/[,;]/).map(g=>g.trim()).filter(Boolean).map(g=>`<dc:subject>${esc(g)}</dc:subject>`):[]),
  options.publisher?.trim()?`<dc:publisher>${esc(options.publisher.trim())}</dc:publisher>`:'',
  options.description?.trim()?`<dc:description>${esc(options.description.trim())}</dc:description>`:'',
  `<meta property="dcterms:modified">${new Date().toISOString().replace(/\.\d+Z$/,'Z')}</meta>`,
  options.cover?'<meta name="cover" content="cover-image"/>':'',
  `<meta name="generator" content="GCP-PDF"/>`,
 ].filter(Boolean).join('\n    ');
 files['OEBPS/content.opf']=strToU8(`<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="bookid" xml:lang="${esc(lang)}">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    ${meta}
  </metadata>
  <manifest>
    ${manifest.join('\n    ')}
  </manifest>
  <spine toc="ncx">
    ${spine.join('\n    ')}
  </spine>
</package>`);
 onProgress?.(`EPUB pronto: ${chapters.length} capítulo${chapters.length>1?'s':''}${notes?`, ${notes} nota${notes>1?'s':''} de rodapé com links`:''}.`);
 return zipSync(files as never,{level:9});
}
/** "Machado de Assis" → "Assis, Machado de", the sort form library apps use. */
function fileAs(author:string){const parts=author.split(/\s+/);return parts.length>1?`${parts.at(-1)}, ${parts.slice(0,-1).join(' ')}`:author;}
