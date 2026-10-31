import type {PDFPageProxy} from 'pdfjs-dist/types/src/display/api';
import {pdfjs} from './conversion';

/** Every visible character the page shows, in content order. `advance` is the glyph's own width in
 * ems and `spaceBefore` the width (ems) of real space glyphs drawn just before it. PDF.js text items
 * lose both: wide letter spacing comes back as invented spaces ("P R E S T A") and real word gaps
 * become indistinguishable from them. */
export interface PageGlyphs {chars:string[];colors:string[];advance:number[];spaceBefore:number[]}

export async function pageGlyphs(page:PDFPageProxy):Promise<PageGlyphs> {
 const OPS=(await pdfjs()).OPS,ops=await page.getOperatorList(),out:PageGlyphs={chars:[],colors:[],advance:[],spaceBefore:[]};
 let fill='#000000',space=0;
 const stack:string[]=[];
 for(let i=0;i<ops.fnArray.length;i++) {
  const fn=ops.fnArray[i],args=ops.argsArray[i] as any[];
  if(fn===OPS.save)stack.push(fill);
  else if(fn===OPS.restore)fill=stack.pop()??fill;
  else if(fn===OPS.setFillRGBColor&&typeof args?.[0]==='string')fill=args[0];
  else if(fn===OPS.setFillGray&&typeof args?.[0]==='string')fill=args[0];
  else if(fn===OPS.showText||fn===OPS.showSpacedText) {
   for(const glyph of args?.[0]??[]) {
    if(!glyph||typeof glyph!=='object'||typeof glyph.unicode!=='string')continue;
    const width=Number.isFinite(glyph.width)?glyph.width/1000:0;
    if(!glyph.unicode.trim()){space+=width;continue;}
    let first=true;
    for(const c of glyph.unicode)if(c.trim()){out.chars.push(c);out.colors.push(fill);out.advance.push(first?width:0);out.spaceBefore.push(space);space=0;first=false;}
   }
  }
 }
 return out;
}

/** Index of a character sequence in the glyph stream, searched forward from `cursor` first. */
export function locateGlyphs(glyphs:PageGlyphs,needle:string[],cursor:number) {
 const fits=(at:number)=>needle.every((c,i)=>glyphs.chars[at+i]===c);
 for(let at=cursor;at<=glyphs.chars.length-needle.length&&at<cursor+2000;at++)if(fits(at))return at;
 for(let at=0;at<=glyphs.chars.length-needle.length;at++)if(fits(at))return at;
 return -1;
}

/** Letter spacing (points) of one text item and its true text, measured as the item's printed width
 * minus the glyphs' own advances, spread over the gaps between glyphs. Word spacing of justified prose
 * also widens an item, so a run with real spaces counts as tracked only when PDF.js had to invent
 * spaces between its letters. `scale` is the horizontal text scale (1 = none). */
export function letterSpacing(glyphs:PageGlyphs,at:number,count:number,str:string,width:number,size:number,scale=1):{tracking:number;text:string}|undefined {
 if(at<0||count<2||!(size>0)||!(width>0))return;
 let natural=0,gaps=0,real=0,text='';
 for(let i=at;i<at+count;i++) {
  const space=i>at?glyphs.spaceBefore[i]??0:0;
  natural+=(glyphs.advance[i]??0)+space;
  if(i>at)gaps+=space>0?2:1;
  if(space>0){real++;text+=' ';}
  text+=glyphs.chars[i];
 }
 const invented=(str.match(/\s/g)?.length??0)-real;
 if(real>0&&invented<(count-real)*.5)return;
 const tracking=(width/(size*scale)-natural)/gaps;
 if(!Number.isFinite(tracking)||natural<=0||Math.abs(tracking)<.03||tracking<-.2||tracking>1.5)return;
 return {tracking:tracking*size*scale,text};
}

/** Text items with their letter spacing and horizontal scale, in unrotated top-left page points: the
 * coordinate space the editor's paragraphs use. */
export async function trackedItems(page:PDFPageProxy) {
 const engine=await pdfjs(),viewport=page.getViewport({scale:1,rotation:0}),glyphs=await pageGlyphs(page),content=await page.getTextContent();
 const items:{x:number;baseline:number;width:number;size:number;tracking:number;scale:number;text:string}[]=[];
 let cursor=0;
 for(const item of content.items) {
  if(!('str' in item)||!item.str.trim())continue;
  const t=engine.Util.transform(viewport.transform,item.transform),size=Math.hypot(t[2],t[3]),scale=Math.hypot(t[0],t[1])/size||1;
  const visible=[...item.str].filter(c=>c.trim()),at=locateGlyphs(glyphs,visible.slice(0,8),cursor);
  if(at<0)continue;
  cursor=at+visible.length;
  const spaced=letterSpacing(glyphs,at,visible.length,item.str,item.width,size,scale);
  items.push({x:t[4],baseline:t[5],width:item.width,size,tracking:spaced?.tracking??0,scale,text:spaced?.text??item.str});
 }
 return items;
}
