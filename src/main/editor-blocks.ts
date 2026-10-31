import type {SourceParagraph, Rect} from '../shared/types';
import {loadPdf} from './conversion';
import {vectorShapes} from './word-layout';
import {strokes, frames, frameTable} from './table-geometry';
import {toPage} from '../shared/geometry';
import {trackedItems} from './text-spacing';

const right = (r:Rect) => r.x+r.width;
const bottom = (r:Rect) => r.y+r.height;
const union = (a:Rect,b:Rect):Rect => ({x:Math.min(a.x,b.x),y:Math.min(a.y,b.y),width:Math.max(right(a),right(b))-Math.min(a.x,b.x),height:Math.max(bottom(a),bottom(b))-Math.min(a.y,b.y)});

/** Visual blocks retain their native paragraph identities. A table cell owns its text; the same
 * parsed borders used by Word prevent proximity from joining text across cells or ruling lines. */
export class EditorBlockReader {
 private source?:Uint8Array;
 private pdf?:Awaited<ReturnType<typeof loadPdf>>;
 private queue:Promise<unknown>=Promise.resolve();
 private pages=new Map<string,{cells:Rect[];segments:ReturnType<typeof strokes>['segments'];spacing:Awaited<ReturnType<typeof trackedItems>>}>();
 read(bytes:Uint8Array,pageNumber:number,paragraphs:SourceParagraph[],rotation:number):Promise<SourceParagraph[]> {
  const task=this.queue.then(async()=>{
    if(this.source!==bytes){await this.release();this.pdf=await loadPdf(bytes);this.source=bytes;}
    const key=`${pageNumber}:${rotation}`,known=this.pages.get(key);
    if(known)return groupEditorParagraphs(withSpacing(paragraphs,known.spacing),known.cells,known.segments);
    const page=await this.pdf!.getPage(pageNumber+1);
    const {shapes}=await vectorShapes(page);
    const parsed=strokes(shapes),{shades}=parsed;
    let segments=parsed.segments;
    const cells:Rect[]=[];
    for(const frame of frames(segments)) {
      const built=frameTable(frame,shades,[],true);if(!built)continue;
      const t=built.table;
      for(const c of t.cells)cells.push({x:t.x+t.colW.slice(0,c.col).reduce((a,b)=>a+b,0),y:t.y+t.rowH.slice(0,c.row).reduce((a,b)=>a+b,0),width:t.colW.slice(c.col,c.col+c.cols).reduce((a,b)=>a+b,0),height:t.rowH.slice(c.row,c.row+c.rows).reduce((a,b)=>a+b,0)});
    }
    // Vectors use displayed page coordinates; callers expose the engine paragraphs in unrotated
    // crop coordinates. Convert the parsed facts once at this owning boundary, including walls.
    if(rotation){
      const size=page.getViewport({scale:1,rotation:0}),point=(x:number,y:number)=>toPage(x,y,size,rotation,1);
      for(let i=0;i<cells.length;i++){const c=cells[i]!,a=point(c.x,c.y),b=point(right(c),bottom(c));cells[i]={x:Math.min(a.x,b.x),y:Math.min(a.y,b.y),width:Math.abs(b.x-a.x),height:Math.abs(b.y-a.y)};}
      segments=segments.map(s=>{const a=s.horizontal?point(s.from,s.at):point(s.at,s.from),b=s.horizontal?point(s.to,s.at):point(s.at,s.to),horizontal=Math.abs(a.y-b.y)<.01;return {...s,horizontal,at:horizontal?a.y:a.x,from:horizontal?Math.min(a.x,b.x):Math.min(a.y,b.y),to:horizontal?Math.max(a.x,b.x):Math.max(a.y,b.y)};});
    }
    const spacing=await trackedItems(page);
    page.cleanup();
    this.pages.set(key,{cells,segments,spacing});
    if(this.pages.size>32)this.pages.delete(this.pages.keys().next().value!);
    return groupEditorParagraphs(withSpacing(paragraphs,spacing),cells,segments);
  });
  this.queue=task.catch(()=>{});return task;
 }
 /** Letter-spaced runs of the page last read for `read` (same source and rotation). */
 spacing(pageNumber:number,rotation:number){return (this.pages.get(`${pageNumber}:${rotation}`)?.spacing??[]).filter(i=>i.tracking).map(({x,baseline,width,tracking,text})=>({x,baseline,width,tracking:Math.round(tracking*100)/100,text}));}
 private async release(){if(this.pdf)await this.pdf.loadingTask.destroy();this.pdf=undefined;this.source=undefined;this.pages.clear();}
 dispose(){const task=this.queue.then(()=>this.release());this.queue=task.catch(()=>{});return task;}
}

/** Letter spacing and horizontal scale the engine does not report: most of a paragraph's printed
 * characters must share them, so a single tracked word does not respace the whole paragraph. */
export function withSpacing(paragraphs:SourceParagraph[],items:{x:number;baseline:number;width:number;size:number;tracking:number;scale:number;text?:string}[]):SourceParagraph[] {
  return paragraphs.map(p=>{
    const inside=items.filter(i=>i.x>=p.rect.x-1&&i.x+i.width<=right(p.rect)+Math.max(2,i.size*.3)&&i.baseline>=p.rect.y&&i.baseline<=bottom(p.rect)+i.size*.3);
    const total=inside.reduce((n,i)=>n+i.width,0);if(!total)return p;
    const share=(pick:(i:typeof inside[number])=>boolean)=>inside.filter(pick).reduce((n,i)=>n+i.width,0)/total;
    const median=(values:number[])=>values.sort((a,b)=>a-b)[Math.floor(values.length/2)]!;
    const tracked=share(i=>i.tracking!==0)>.6?median(inside.filter(i=>i.tracking!==0).map(i=>i.tracking)):0;
    const scale=share(i=>Math.abs(i.scale-1)>.02)>.6?median(inside.map(i=>i.scale)):1;
    const baselines=[...new Set(inside.map(i=>Math.round(i.baseline*2)/2))].sort((a,b)=>a-b).filter((b,i,all)=>i===0||b-all[i-1]!>p.size*.5);
    const lineSpacing=baselines.length>1?(baselines.at(-1)!-baselines[0]!)/(baselines.length-1)/p.size:undefined;
    return {...p,...(tracked?{tracking:Math.round(tracked*100)/100}:{}),...(scale!==1?{scale:Math.round(scale*1000)/1000}:{}),...(lineSpacing?{lineSpacing:Math.round(lineSpacing*100)/100}:{})};
  });
}

export function groupEditorParagraphs(paragraphs:SourceParagraph[],cells:Rect[],walls:{horizontal:boolean;at:number;from:number;to:number}[]=[]):SourceParagraph[] {
  const owner=(p:SourceParagraph)=>cells.findIndex(c=>p.rect.x>=c.x-2&&right(p.rect)<=right(c)+2&&p.rect.y>=c.y-2&&bottom(p.rect)<=bottom(c)+2);
  const groups:{parts:SourceParagraph[];rect:Rect;cell:number}[]=[];
  for(const p of [...paragraphs].sort((a,b)=>a.rect.y-b.rect.y||a.rect.x-b.rect.x)) {
    const cell=owner(p);
    const group=groups.find(g=>{
      if(g.cell!==cell)return false;
      if(cell>=0)return true;
      const last=g.parts.at(-1)!,a=last.rect,b=p.rect,size=Math.max(last.size,p.size);
      const sameRow=Math.abs(a.y-b.y)<Math.min(a.height,b.height)*.45;
      const aligned=Math.abs(a.x-b.x)<3||Math.abs(right(a)-right(b))<3||Math.abs((a.x+right(a))-(b.x+right(b)))<5;
      const list=/^(?:\d+[.)]|[•▪●\-])\s/.test(last.text.trim());
      const joins=sameRow?b.x-right(a)>=-2&&b.x-right(a)<size*1.6:b.y>=a.y&&b.y-bottom(a)<size*.9&&b.x<right(g.rect)&&right(b)>g.rect.x&&(aligned||(list&&b.x>=a.x&&b.x<a.x+size*3));
      if(!joins||Math.abs(last.size-p.size)>size*.25)return false;
      const span=union(g.rect,b);
      return !walls.some(w=>w.horizontal?w.at>bottom(a)-1&&w.at<b.y+1&&w.from<right(span)&&w.to>span.x:w.at>g.rect.x&&w.at<right(span)&&w.from<bottom(span)&&w.to>span.y);
    });
    if(group){group.parts.push(p);group.rect=union(group.rect,p.rect);}else groups.push({parts:[p],rect:p.rect,cell});
  }
  return groups.map(g=>g.parts.length===1?g.parts[0]!:{...g.parts[0]!,rect:g.rect,text:g.parts.map(p=>p.text).join('\n'),members:g.parts});
}
