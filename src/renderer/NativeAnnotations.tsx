import {t as translateUi} from "./i18n";
import React, {useEffect, useLayoutEffect, useRef, useState} from 'react';
import {createPortal} from 'react-dom';
import {MessageSquare, Trash2, X} from 'lucide-react';
import type {PdfAnnotation} from '../shared/types';
import {annotationLabel} from './Comments';

export function NativeAnnotations({annotations, open, onOpen, onDelete, interactive}: {
 annotations:PdfAnnotation[]; open?:string|null; onOpen:(id:string|null)=>void; onDelete:(a:PdfAnnotation)=>void; interactive:boolean;
}) {
 const selected = annotations.find(a => `native:${a.page}:${a.index}` === open);
 const anchor = useRef<HTMLButtonElement>(null), bubble=useRef<HTMLDivElement>(null);
 const [at,setAt]=useState({left:-9999,top:-9999});
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
   {(a.text||a.subtype==='Text'||active)&&<button ref={active?anchor:undefined} className="native-annotation native-annotation-icon" title={`${a.author || annotationLabel(a.subtype)}: ${a.text}`} aria-label={`Abrir comentário: ${a.text || annotationLabel(a.subtype)}`} style={{left:a.rect.x,top:a.rect.y}} onPointerDown={e=>e.stopPropagation()} onClick={()=>onOpen(active?null:id)}><MessageSquare size={16}/></button>}
  </React.Fragment>;})}
  {selected&&createPortal(<div ref={bubble} className="note-bubble native-annotation-bubble" style={at} onPointerDown={e=>e.stopPropagation()}>
   <button className="icon-button note-bubble-close" title={translateUi("Fechar")} onClick={()=>onOpen(null)}><X size={13}/></button>
   <strong>{selected.author||annotationLabel(selected.subtype)}</strong><p className="note-text">{selected.text||annotationLabel(selected.subtype)}</p>
   <button className="text-button" onClick={()=>onDelete(selected)}><Trash2 size={14}/>{" "}{translateUi("Excluir anotação")}</button>
  </div>,document.body)}
 </>;
}
