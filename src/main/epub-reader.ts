import {unzipSync,strFromU8} from 'fflate';
import {DOMParser,XMLSerializer} from '@xmldom/xmldom';
import {createHash} from 'node:crypto';
import {posix} from 'node:path';

/** Opens an EPUB for the reader. Book content is untrusted: scripts, frames, forms, event handlers and
 * outside resources are removed here, images and fonts are inlined as data URLs, and every id is
 * prefixed per chapter so the whole book can live in one sandboxed document. */
export interface ParsedBook {id:string;title:string;author:string;language:string;cover?:string;toc:{title:string;chapter:number;anchor?:string;level:number}[];chapters:number;html:string;css:string}

const MAX_TOTAL=400*1024*1024;
const MEDIA:Record<string,string>={jpg:'image/jpeg',jpeg:'image/jpeg',png:'image/png',gif:'image/gif',webp:'image/webp',svg:'image/svg+xml',ttf:'font/ttf',otf:'font/otf',woff:'font/woff',woff2:'font/woff2'};
const DROP=new Set(['script','iframe','frame','frameset','object','embed','applet','form','input','button','select','textarea','base','meta','link','audio','video','source','track','canvas','noscript','template','portal']);

export function readBook(bytes:Uint8Array):ParsedBook {
 let total=0;
 const files=unzipSync(bytes,{filter:file=>{total+=file.originalSize;if(total>MAX_TOTAL)throw new Error('O livro é grande demais para abrir (mais de 400 MB descompactado).');return true;}});
 const text=(path:string)=>{const f=files[path];if(!f)throw new Error(`O EPUB está incompleto: falta ${path}.`);return strFromU8(f);};
 const xml=(path:string)=>new DOMParser({onError:()=>{}}).parseFromString(text(path),'application/xml');
 const container=xml('META-INF/container.xml'),rootfile=container.getElementsByTagName('rootfile')[0]?.getAttribute('full-path');
 if(!rootfile)throw new Error('Este arquivo não é um EPUB válido (sem container).');
 const opf=xml(rootfile),base=posix.dirname(rootfile),resolve=(from:string,href:string)=>posix.normalize(posix.join(posix.dirname(from),decodeURIComponent(href.split('#')[0]!)));
 const first=(tag:string)=>opf.getElementsByTagName(tag)[0]?.textContent?.trim()??'';
 const manifest=new Map<string,{href:string;type:string;props:string}>();
 for(const item of Array.from(opf.getElementsByTagName('item')))manifest.set(item.getAttribute('id')??'',{href:posix.normalize(posix.join(base,decodeURIComponent(item.getAttribute('href')??''))),type:item.getAttribute('media-type')??'',props:item.getAttribute('properties')??''});
 const spine=Array.from(opf.getElementsByTagName('itemref')).map(r=>manifest.get(r.getAttribute('idref')??'')).filter((i):i is NonNullable<typeof i>=>!!i&&/html/.test(i.type)&&!!files[i.href]);
 if(!spine.length)throw new Error('O livro não tem capítulos legíveis.');
 const chapterOf=new Map(spine.map((s,i)=>[s.href,i]));
 const dataUrl=(path:string)=>{const f=files[path];if(!f)return undefined;const type=MEDIA[posix.extname(path).slice(1).toLowerCase()];return type?`data:${type};base64,${Buffer.from(f).toString('base64')}`:undefined;};
 const cssUrls=(css:string,from:string)=>css.replace(/@import[^;]+;/g,'').replace(/url\(\s*(['"]?)([^'")]+)\1\s*\)/g,(_m,_q,href:string)=>/^(data:|#)/.test(href)?`url(${href})`:/^[a-z]+:/i.test(href)?'none':`url(${dataUrl(resolve(from,href))??'none'})`);
 const anchor=(i:number,id:string)=>`c${i}-${id}`;
 const link=(from:string,href:string)=>{
  if(/^[a-z]+:/i.test(href))return undefined;
  const [path,hash]=href.split('#'),target=path?resolve(from,href):from,chapter=chapterOf.get(target);
  return chapter===undefined?undefined:'#'+(hash?anchor(chapter,decodeURIComponent(hash)):`c${chapter}`);
 };
 const css:string[]=[];
 const serializer=new XMLSerializer();
 const sections=spine.map((item,i)=>{
  const source=text(item.href);
  let doc=new DOMParser({onError:()=>{}}).parseFromString(source,'application/xhtml+xml');
  if(!doc.getElementsByTagName('body')[0])doc=new DOMParser({onError:()=>{}}).parseFromString(source,'text/html');
  for(const style of Array.from(doc.getElementsByTagName('style')))css.push(cssUrls(style.textContent??'',item.href));
  for(const l of Array.from(doc.getElementsByTagName('link')))if(/stylesheet/i.test(l.getAttribute('rel')??'')){const path=resolve(item.href,l.getAttribute('href')??'');if(files[path]&&!css.includes(path))css.push(`/*${path}*/`+cssUrls(strFromU8(files[path]!),path));}
  const body=doc.getElementsByTagName('body')[0];if(!body)return `<section class="gcp-chapter" id="c${i}" data-chapter="${i}"></section>`;
  const clean=(node:any)=>{
   for(const child of Array.from(node.childNodes as ArrayLike<any>)){
    if(child.nodeType===8||child.nodeType===7){node.removeChild(child);continue;}
    if(child.nodeType!==1)continue;
    const tag=String(child.localName??child.nodeName).toLowerCase();
    if(DROP.has(tag)||tag==='style'){node.removeChild(child);continue;}
    for(const attr of Array.from(child.attributes as ArrayLike<any>)){
     const name=String(attr.name).toLowerCase(),value=String(attr.value);
     if(name.startsWith('on')||name==='srcdoc'||name==='formaction'||name==='srcset'){child.removeAttribute(attr.name);continue;}
     if(name==='id'||name==='xml:id'){child.setAttribute('id',anchor(i,value));if(name!=='id')child.removeAttribute(attr.name);continue;}
     if(name==='style'){child.setAttribute('style',cssUrls(value,item.href));continue;}
     if(name==='src'||name==='xlink:href'||(name==='href'&&(tag==='image'||tag==='use'))){const url=/^data:image\//.test(value)?value:/^[a-z]+:/i.test(value)?undefined:dataUrl(resolve(item.href,value));if(url)child.setAttribute(attr.name,url);else child.removeAttribute(attr.name);continue;}
     if(name==='href'){const target=link(item.href,value);if(target)child.setAttribute('href',target);else{child.removeAttribute('href');if(/^https?:/i.test(value))child.setAttribute('data-external',value);}continue;}
     if(name==='poster'||name==='background'||name==='action')child.removeAttribute(attr.name);
    }
    clean(child);
   }
  };
  clean(body);
  const inner=Array.from(body.childNodes as ArrayLike<any>).map(n=>serializer.serializeToString(n)).join('');
  return `<section class="gcp-chapter" id="c${i}" data-chapter="${i}">${inner.replace(/\sxmlns(:\w+)?="[^"]*"/g,'')}</section>`;
 });
 // Table of contents: the EPUB 3 nav document, else the EPUB 2 NCX, else the spine order.
 const toc:ParsedBook['toc']=[];
 const navItem=[...manifest.values()].find(m=>/\bnav\b/.test(m.props));
 const target=(from:string,href:string)=>{const [path,hash]=href.split('#'),chapter=chapterOf.get(path?resolve(from,href):from);return chapter===undefined?undefined:{chapter,...(hash?{anchor:anchor(chapter,decodeURIComponent(hash))}:{})};};
 if(navItem&&files[navItem.href]){
  const nav=new DOMParser({onError:()=>{}}).parseFromString(text(navItem.href),'application/xhtml+xml');
  const tocNav=Array.from(nav.getElementsByTagName('nav')).find(n=>/toc/.test(n.getAttribute('epub:type')??n.getAttribute('type')??''))??nav.getElementsByTagName('nav')[0];
  const walk=(ol:any,level:number)=>{for(const li of Array.from(ol.childNodes as ArrayLike<any>).filter((n:any)=>n.localName==='li')){const a=Array.from(li.childNodes as ArrayLike<any>).find((n:any)=>n.localName==='a'||n.localName==='span');const href=a?.getAttribute?.('href');const where=href?target(navItem.href,href):undefined;if(a&&where)toc.push({title:(a.textContent??'').replace(/\s+/g,' ').trim(),level,...where});const sub=Array.from(li.childNodes as ArrayLike<any>).find((n:any)=>n.localName==='ol');if(sub)walk(sub,level+1);}};
  const ol=tocNav?Array.from(tocNav.childNodes as ArrayLike<any>).find((n:any)=>n.localName==='ol'):undefined;if(ol)walk(ol,1);
 }
 const ncx=[...manifest.values()].find(m=>/ncx/.test(m.type));
 if(!toc.length&&ncx&&files[ncx.href]){
  const doc=xml(ncx.href);
  const walk=(node:any,level:number)=>{for(const point of Array.from(node.childNodes as ArrayLike<any>).filter((n:any)=>n.localName==='navPoint')){const label=point.getElementsByTagName('text')[0]?.textContent?.trim()??'',src=point.getElementsByTagName('content')[0]?.getAttribute('src');const where=src?target(ncx.href,src):undefined;if(where&&label)toc.push({title:label,level,...where});walk(point,level+1);}};
  const map=doc.getElementsByTagName('navMap')[0];if(map)walk(map,1);
 }
 if(!toc.length)spine.forEach((s,i)=>toc.push({title:`Capítulo ${i+1}`,chapter:i,level:1}));
 const coverItem=[...manifest.values()].find(m=>/cover-image/.test(m.props))??manifest.get(Array.from(opf.getElementsByTagName('meta')).find(m=>m.getAttribute('name')==='cover')?.getAttribute('content')??'');
 const identifier=first('dc:identifier');
 return {
  id:createHash('sha256').update(identifier||'').update(first('dc:title')).update(String(bytes.length)).update(identifier?'':Buffer.from(bytes.subarray(0,65536))).digest('hex').slice(0,24),
  title:first('dc:title')||'Livro sem título',author:first('dc:creator'),language:first('dc:language'),
  ...(coverItem&&/^image\//.test(coverItem.type)&&dataUrl(coverItem.href)?{cover:dataUrl(coverItem.href)!}:{}),
  // The reader embeds this CSS in a <style> element: "<" never appears raw, so a stylesheet cannot
  // close the element and inject markup past the sanitizer. \3C is the same character for CSS.
  toc,chapters:spine.length,html:sections.join('\n'),css:css.join('\n').replace(/</g,'\\3C '),
 };
}
