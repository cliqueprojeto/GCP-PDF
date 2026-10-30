import type {PageObject,Point,Rect} from './types';
/** SVG path data shared by the on-screen overlay and the PDF writer, so both draw the same outline.
 * Coordinates are page points from the top-left corner of the unrotated page. */
const f=(n:number)=>Number(n.toFixed(2));
const K=0.5523;
function ellipse(r:Rect){const cx=r.x+r.width/2,cy=r.y+r.height/2,rx=r.width/2,ry=r.height/2,ox=rx*K,oy=ry*K;
 return `M${f(cx-rx)} ${f(cy)}C${f(cx-rx)} ${f(cy-oy)} ${f(cx-ox)} ${f(cy-ry)} ${f(cx)} ${f(cy-ry)}C${f(cx+ox)} ${f(cy-ry)} ${f(cx+rx)} ${f(cy-oy)} ${f(cx+rx)} ${f(cy)}C${f(cx+rx)} ${f(cy+oy)} ${f(cx+ox)} ${f(cy+ry)} ${f(cx)} ${f(cy+ry)}C${f(cx-ox)} ${f(cy+ry)} ${f(cx-rx)} ${f(cy+oy)} ${f(cx-rx)} ${f(cy)}Z`;}
function polyline(points:Point[],close:boolean){return points.map((p,i)=>`${i?'L':'M'}${f(p.x)} ${f(p.y)}`).join('')+(close?'Z':'');}
/** Scalloped outline: half-circle bumps along each edge of the rectangle. */
function cloud(r:Rect){const size=Math.max(8,Math.min(r.width,r.height)/5);const corners=[{x:r.x,y:r.y},{x:r.x+r.width,y:r.y},{x:r.x+r.width,y:r.y+r.height},{x:r.x,y:r.y+r.height}];let d=`M${f(r.x)} ${f(r.y)}`;
 for(let side=0;side<4;side++){const a=corners[side]!,b=corners[(side+1)%4]!,len=Math.hypot(b.x-a.x,b.y-a.y),n=Math.max(1,Math.round(len/size)),ux=(b.x-a.x)/n,uy=(b.y-a.y)/n,nx=uy,ny=-ux;
  for(let i=0;i<n;i++){const s={x:a.x+ux*i,y:a.y+uy*i},e={x:s.x+ux,y:s.y+uy};d+=`C${f(s.x+nx*0.7)} ${f(s.y+ny*0.7)} ${f(e.x+nx*0.7)} ${f(e.y+ny*0.7)} ${f(e.x)} ${f(e.y)}`;}}
 return d+'Z';}
export function arrowHead(from:Point,to:Point,width:number){const angle=Math.atan2(to.y-from.y,to.x-from.x),len=Math.max(8,width*4);const a={x:to.x-len*Math.cos(angle-0.45),y:to.y-len*Math.sin(angle-0.45)},b={x:to.x-len*Math.cos(angle+0.45),y:to.y-len*Math.sin(angle+0.45)};return `M${f(a.x)} ${f(a.y)}L${f(to.x)} ${f(to.y)}L${f(b.x)} ${f(b.y)}`;}
/** Smooths freehand points with quadratic curves through their midpoints. */
export function inkPath(points:Point[]){if(points.length<3)return polyline(points,false);let d=`M${f(points[0]!.x)} ${f(points[0]!.y)}`;for(let i=1;i<points.length-1;i++){const p=points[i]!,n=points[i+1]!;d+=`Q${f(p.x)} ${f(p.y)} ${f((p.x+n.x)/2)} ${f((p.y+n.y)/2)}`;}const last=points.at(-1)!;return d+`L${f(last.x)} ${f(last.y)}`;}
export function shapePath(o:Extract<PageObject,{kind:'shape'}>):{outline:string;head?:string;closed:boolean}{
 const r={x:o.x,y:o.y,width:o.width,height:o.height};
 switch(o.shape){
  case 'rect':return {outline:polyline([{x:r.x,y:r.y},{x:r.x+r.width,y:r.y},{x:r.x+r.width,y:r.y+r.height},{x:r.x,y:r.y+r.height}],true),closed:true};
  case 'ellipse':return {outline:ellipse(r),closed:true};
  case 'cloud':return {outline:cloud(r),closed:true};
  case 'line':case 'arrow':case 'dimension':{const [a,b]=o.points?.length===2?o.points:[{x:r.x,y:r.y},{x:r.x+r.width,y:r.y+r.height}];return {outline:polyline([a!,b!],false),head:o.shape==='arrow'?arrowHead(a!,b!,o.strokeWidth):o.shape==='dimension'?arrowHead(a!,b!,o.strokeWidth)+arrowHead(b!,a!,o.strokeWidth):undefined,closed:false};}
  case 'polyline':return {outline:polyline(o.points??[],false),closed:false};
  case 'polygon':return {outline:polyline(o.points??[],true),closed:true};
  case 'check':return {outline:polyline([{x:r.x,y:r.y+r.height*0.55},{x:r.x+r.width*0.38,y:r.y+r.height},{x:r.x+r.width,y:r.y}],false),closed:false};
  case 'cross':return {outline:`${polyline([{x:r.x,y:r.y},{x:r.x+r.width,y:r.y+r.height}],false)}${polyline([{x:r.x+r.width,y:r.y},{x:r.x,y:r.y+r.height}],false)}`,closed:false};
 }
}
/** Measurement label of a measuring shape, in centimetres (1 pt = 1/72 in = 0.0352778 cm), computed from its geometry. */
export const CM_PER_PT=2.54/72;
export function measureLabel(o:Extract<PageObject,{kind:'shape'}>):{text:string;at:Point;angle:number}|null{
 if(!o.measure)return null;
 const pts=o.points?.length?o.points:[{x:o.x,y:o.y},{x:o.x+o.width,y:o.y+o.height}];
 const fmt=(v:number,unit:string)=>`${v.toLocaleString('pt-BR',{minimumFractionDigits:2,maximumFractionDigits:2})} ${unit}`;
 const length=(list:Point[],closed:boolean)=>list.reduce((sum,p,i)=>{const q=list[i+1]??(closed?list[0]:undefined);return q?sum+Math.hypot(q.x-p.x,q.y-p.y):sum;},0);
 if(o.measure==='distance'){const [a,b]=[pts[0]!,pts.at(-1)!];let angle=Math.atan2(b.y-a.y,b.x-a.x)*180/Math.PI;if(angle>90)angle-=180;if(angle<-90)angle+=180;return {text:fmt(length([a,b],false)*CM_PER_PT,'cm'),at:{x:(a.x+b.x)/2,y:(a.y+b.y)/2},angle};}
 if(o.measure==='perimeter'){const last=pts.at(-1)!;return {text:fmt(length(pts,false)*CM_PER_PT,'cm'),at:{x:last.x+6,y:last.y},angle:0};}
 const area=Math.abs(pts.reduce((s,p,i)=>{const q=pts[(i+1)%pts.length]!;return s+p.x*q.y-q.x*p.y;},0))/2*CM_PER_PT*CM_PER_PT;
 const c=pts.reduce((acc,p)=>({x:acc.x+p.x/pts.length,y:acc.y+p.y/pts.length}),{x:0,y:0});
 return {text:fmt(area,'cm²'),at:c,angle:0};
}
export function objectBounds(o:PageObject):Rect{
 if(o.kind==='ink'||(o.kind==='shape'&&o.points?.length)){const pts=o.kind==='ink'?o.points:o.points!;const xs=pts.map(p=>p.x),ys=pts.map(p=>p.y),pad=o.strokeWidth/2;return {x:Math.min(...xs)-pad,y:Math.min(...ys)-pad,width:Math.max(...xs)-Math.min(...xs)+pad*2,height:Math.max(...ys)-Math.min(...ys)+pad*2};}
 if(o.kind==='markup'){const xs=o.rects.flatMap(r=>[r.x,r.x+r.width]),ys=o.rects.flatMap(r=>[r.y,r.y+r.height]);return {x:Math.min(...xs),y:Math.min(...ys),width:Math.max(...xs)-Math.min(...xs),height:Math.max(...ys)-Math.min(...ys)};}
 return {x:o.x,y:o.y,width:o.width,height:o.height};
}
/** Moves an object by a page-space offset, keeping every other property. */
export function translateObject(o:PageObject,dx:number,dy:number):PageObject{
 const move=(p:Point)=>({x:p.x+dx,y:p.y+dy});
 switch(o.kind){case 'ink':return {...o,points:o.points.map(move)};case 'markup':return {...o,rects:o.rects.map(r=>({...r,x:r.x+dx,y:r.y+dy}))};case 'shape':return {...o,x:o.x+dx,y:o.y+dy,points:o.points?.map(move)};default:return {...o,x:o.x+dx,y:o.y+dy};}
}
/** Scales an object from its old bounds into new bounds (used by resize handles). */
export function resizeObject(o:PageObject,from:Rect,to:Rect):PageObject{
 const sx=from.width?to.width/from.width:1,sy=from.height?to.height/from.height:1,map=(p:Point)=>({x:to.x+(p.x-from.x)*sx,y:to.y+(p.y-from.y)*sy});
 switch(o.kind){case 'ink':return {...o,points:o.points.map(map)};case 'markup':return o;case 'shape':{const a=map({x:o.x,y:o.y});return {...o,x:a.x,y:a.y,width:o.width*sx,height:o.height*sy,points:o.points?.map(map)};}
  default:{const a=map({x:o.x,y:o.y});return {...o,x:a.x,y:a.y,width:Math.max(4,o.width*sx),height:Math.max(4,o.height*sy)};}}
}
/** Maps between a displayed page (rotated clockwise by `rotation`, at `scale`) and unrotated page points. */
export function toPage(dx:number,dy:number,size:{width:number;height:number},rotation:number,scale:number):Point{
 const W=size.width*scale,H=size.height*scale;let x:number,y:number;
 switch(((rotation%360)+360)%360){case 90:x=dy;y=H-dx;break;case 180:x=W-dx;y=H-dy;break;case 270:x=W-dy;y=dx;break;default:x=dx;y=dy;}
 return {x:x/scale,y:y/scale};
}
export function pageTransform(size:{width:number;height:number},rotation:number,scale:number){
 const W=size.width*scale,H=size.height*scale,r=((rotation%360)+360)%360;
 const t=r===90?[H,0]:r===180?[W,H]:r===270?[0,W]:[0,0];
 return `translate(${t[0]}px,${t[1]}px) rotate(${r}deg) scale(${scale})`;
}
export function fromPage(x:number,y:number,size:{width:number;height:number},rotation:number,scale:number):Point{
 const W=size.width*scale,H=size.height*scale,px=x*scale,py=y*scale;
 switch(((rotation%360)+360)%360){case 90:return {x:H-py,y:px};case 180:return {x:W-px,y:H-py};case 270:return {x:py,y:W-px};default:return {x:px,y:py};}
}
