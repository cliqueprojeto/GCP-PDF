import {t as translateUi} from "./i18n";
import React, {useEffect, useLayoutEffect, useRef, useState} from 'react';
import {createPortal} from 'react-dom';
import {MessageSquare, Trash2, X} from 'lucide-react';
import type {PdfAnnotation, Point, Rect} from '../shared/types';
import {annotationLabel, useBubbleDrag} from './Comments';

/** Icon positions the user chose by dragging, per file page and annotation; shown only here, the PDF is not changed. */
const POSITIONS = 'gcp.note-positions';
function readPositions(): Record<string, Point> { try { return JSON.parse(localStorage.getItem(POSITIONS) || '{}'); } catch { return {}; } }
function savePosition(key: string, at: Point) {
 try { const all = readPositions(); delete all[key]; all[key] = at; const keys = Object.keys(all); for (const old of keys.slice(0, Math.max(0, keys.length - 2000))) delete all[old]; localStorage.setItem(POSITIONS, JSON.stringify(all)); } catch {}
}

export function NativeAnnotations({annotations, open, onOpen, onDelete, interactive, storageKey, pageWidth, pageHeight, scale, besideText}: {
 annotations:PdfAnnotation[]; open?:string|null; onOpen:(id:string|null)=>void; onDelete:(a:PdfAnnotation)=>void; interactive:boolean;
 storageKey:string; pageWidth:number; pageHeight:number; scale:number; besideText:(p:Point, span?:Rect)=>Point;
}) {
 const [moved, setMoved] = useState<Record<string, Point>>(() => readPositions()), [dragging, setDragging] = useState<{id:string; at:Point}|null>(null);
 // A sticky note (/Text) sits where its author put it; the icon of a commented highlight goes beside the text, not over it.
 const iconAt = (a: PdfAnnotation): Point => moved[`${storageKey}:${a.index}`] ?? (a.subtype === 'Text' ? {x: a.rect.x, y: a.rect.y} : besideText({x: a.rect.x, y: a.rect.y}, a.rect));
 function drag(e: React.PointerEvent, a: PdfAnnotation, id: string, active: boolean) {
  if (e.button !== 0) return;
  e.stopPropagation(); e.preventDefault();
  const start = {x: e.clientX, y: e.clientY}, from = iconAt(a);
  let to: Point | null = null;
  const move = (ev: PointerEvent) => {
   const dx = (ev.clientX - start.x) / scale, dy = (ev.clientY - start.y) / scale;
   if (!to && Math.hypot(ev.clientX - start.x, ev.clientY - start.y) < 4) return;
   to = {x: Math.max(0, Math.min(pageWidth - 22, from.x + dx)), y: Math.max(0, Math.min(pageHeight - 22, from.y + dy))};
   setDragging({id, at: to});
  };
  const up = () => {
   window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up);
   setDragging(null);
   if (!to) { onOpen(active ? null : id); return; }
   const key = `${storageKey}:${a.index}`, at = to;
   savePosition(key, at); setMoved(old => ({...old, [key]: at}));
  };
  window.addEventListener('pointermove', move); window.addEventListener('pointerup', up);
 }
 const selected = annotations.find(a => `native:${a.page}:${a.index}` === open);
 const anchor = useRef<HTMLButtonElement>(null), bubble=useRef<HTMLDivElement>(null);
 const [at,setAt]=useState({left:-9999,top:-9999}), {offset, grip}=useBubbleDrag(open ?? '');
 useLayoutEffect(()=>{
  if(!selected)return;
  const place=()=>{const r=anchor.current?.getBoundingClientRect();if(!r)return;const w=bubble.current?.offsetWidth??280,h=bubble.current?.offsetHeight??160;setAt({left:Math.max(8,Math.min(r.right+8,innerWidth-w-8)),top:Math.max(8,Math.min(r.top,innerHeight-h-8))});};
  place();window.addEventListener('scroll',place,true);window.addEventListener('resize',place);
  return()=>{window.removeEventListener('scroll',place,true);window.removeEventListener('resize',place);};
 },[selected]);
 useEffect(()=>{
  if(!selected)return;
  const close=(e:PointerEvent)=>{if(!(e.target as HTMLElement).closest('.native-annotation,.native-annotation-bubble,.comments-panel'))onOpen(null);};
  const key=(e:KeyboardEvent)=>{if(e.key==='Escape')onOpen(null);if((e.key==='Delete'||e.key==='Backspace')&&!(e.target as HTMLElement)?.closest('input,textarea,[contenteditable=true]')){e.preventDefault();onDelete(selected);}};
  window.addEventListener('pointerdown',close);window.addEventListener('keydown',key);
  return()=>{window.removeEventListener('pointerdown',close);window.removeEventListener('keydown',key);};
 },[selected,onOpen,onDelete]);
 return <>
  {annotations.map(a=>{const id=`native:${a.page}:${a.index}`,active=open===id;return <React.Fragment key={id}>
   {interactive&&<button className={`native-annotation native-annotation-hit ${active?'active':''}`} aria-label={`Selecionar ${annotationLabel(a.subtype)}`} style={{left:a.rect.x,top:a.rect.y,width:Math.max(12,a.rect.width),height:Math.max(12,a.rect.height)}} onPointerDown={e=>e.stopPropagation()} onClick={()=>onOpen(id)}/>}
   {(a.text||a.subtype==='Text'||active)&&(()=>{const at=dragging?.id===id?dragging.at:iconAt(a);return <button ref={active?anchor:undefined} className={`native-annotation native-annotation-icon ${dragging?.id===id?'dragging':''}`} title={`${a.author || annotationLabel(a.subtype)}: ${a.text}
${translateUi("Arraste para mover o comentário")}`} aria-label={`Abrir comentário: ${a.text || annotationLabel(a.subtype)}`} style={{left:at.x,top:at.y}} onPointerDown={e=>drag(e,a,id,active)} onKeyDown={e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();onOpen(active?null:id);}}}><MessageSquare size={16}/></button>;})()}
  </React.Fragment>;})}
  {selected&&createPortal(<div ref={bubble} className="note-bubble native-annotation-bubble" style={{left:at.left+offset.x,top:at.top+offset.y}} onPointerDown={e=>e.stopPropagation()}>
   {grip}
   <button className="icon-button note-bubble-close" title={translateUi("Fechar")} onClick={()=>onOpen(null)}><X size={13}/></button>
   <strong>{selected.author||annotationLabel(selected.subtype)}</strong><p className="note-text">{selected.text||annotationLabel(selected.subtype)}</p>
   <button className="text-button" onClick={()=>onDelete(selected)}><Trash2 size={14}/>{" "}{translateUi("Excluir anotação")}</button>
  </div>,document.body)}
 </>;
}
