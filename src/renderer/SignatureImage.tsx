import {useEffect,useRef,useState} from 'react';
import {t} from './i18n';
import {analyzeSignatureImage,cleanSignatureImage,signatureInkBounds,type PixelImage,type PixelCrop,type SignatureImageAnalysis,type BackgroundColor} from '../shared/signature-image';

type Source={image:PixelImage;analysis:SignatureImageAnalysis;url:string};
const colorHex=(color:BackgroundColor)=>'#'+color.map(c=>c.toString(16).padStart(2,'0')).join('');
export function SignatureImage({src,onChange,onError}:{src:string;onChange:(data:string)=>void;onError:(error:string)=>void}) {
 const [source,setSource]=useState<Source|null>(null),[strength,setStrength]=useState(35),[remove,setRemove]=useState(true),[background,setBackground]=useState<BackgroundColor|null>(null),[crop,setCrop]=useState<PixelCrop|null>(null),[cropping,setCropping]=useState(false),[pending,setPending]=useState(true);
 const [drag,setDrag]=useState<{x0:number;y0:number;x1:number;y1:number}|null>(null),[paper,setPaper]=useState('checker');
 const canvas=useRef<HTMLCanvasElement>(null),processed=useRef<PixelImage|null>(null);
 useEffect(()=>{
  let live=true;setPending(true);setSource(null);onChange('');onError('');setCrop(null);setCropping(false);setRemove(true);setStrength(35);setBackground(null);
  const image=new Image();image.onload=()=>{if(!live)return;try{
   const width=image.naturalWidth,height=image.naturalHeight;
   if(width*height>16_000_000||width<1||height<1)throw new Error(t('Use uma imagem de assinatura de até 16 megapixels.'));
   const buffer=document.createElement('canvas');buffer.width=width;buffer.height=height;const ctx=buffer.getContext('2d',{willReadFrequently:true})!;ctx.drawImage(image,0,0);
   const pixels={width,height,data:ctx.getImageData(0,0,width,height).data};setSource({image:pixels,analysis:analyzeSignatureImage(pixels),url:src});
  }catch(error){onError(t(error instanceof Error?error.message:String(error)));setPending(false);}};
  image.onerror=()=>{if(live){onError(t('Não foi possível ler a imagem da assinatura.'));setPending(false);}};image.src=src;
  return ()=>{live=false;};
 },[src,onChange,onError]);
 useEffect(()=>{
  if(!source||!canvas.current)return;
  setPending(true);onChange('');
  const timer=setTimeout(()=>{try{
   const result=cleanSignatureImage(source.image,source.analysis,strength,remove,background??source.analysis.background);processed.current=result;
   const full=document.createElement('canvas');full.width=result.width;full.height=result.height;full.getContext('2d')!.putImageData(new ImageData(result.data,result.width,result.height),0,0);
   const area=(!cropping&&crop)||{x:0,y:0,width:result.width,height:result.height},preview=canvas.current!;
   const scale=Math.min(1,1200/Math.max(area.width,area.height));preview.width=Math.max(1,Math.round(area.width*scale));preview.height=Math.max(1,Math.round(area.height*scale));preview.getContext('2d')!.drawImage(full,area.x,area.y,area.width,area.height,0,0,preview.width,preview.height);
   if(cropping)return;
   if(!signatureInkBounds(result))throw new Error(t('A prévia ficou vazia. Reduza a intensidade ou preserve o fundo.'));
   if((source.analysis.transparent||!remove)&&!crop)onChange(source.url);
   else{const output=document.createElement('canvas');output.width=area.width;output.height=area.height;const context=output.getContext('2d')!;context.drawImage(full,area.x,area.y,area.width,area.height,0,0,area.width,area.height);if(crop&&!signatureInkBounds({width:area.width,height:area.height,data:context.getImageData(0,0,area.width,area.height).data}))throw new Error(t('A prévia ficou vazia. Reduza a intensidade ou preserve o fundo.'));onChange(output.toDataURL('image/png'));}
   onError('');
  }catch(error){onError(t(error instanceof Error?error.message:String(error)));}finally{setPending(false);}},80);
  return ()=>clearTimeout(timer);
 },[source,strength,remove,background,crop,cropping,onChange,onError]);
 const adjust=(run:()=>void)=>{setPending(true);onChange('');run();};
 const point=(event:React.PointerEvent)=>{const rect=canvas.current!.getBoundingClientRect();return {x:Math.max(0,Math.min(1,(event.clientX-rect.left)/rect.width)),y:Math.max(0,Math.min(1,(event.clientY-rect.top)/rect.height))};};
 const finish=(event:React.PointerEvent)=>{if(!source||!drag)return;const p=point(event),x=Math.floor(Math.min(drag.x0,p.x)*source.image.width),y=Math.floor(Math.min(drag.y0,p.y)*source.image.height),right=Math.ceil(Math.max(drag.x0,p.x)*source.image.width),bottom=Math.ceil(Math.max(drag.y0,p.y)*source.image.height);if(right-x>1&&bottom-y>1)adjust(()=>setCrop({x,y,width:right-x,height:bottom-y}));setDrag(null);setCropping(false);};
 return <div className="signature-image-editor" aria-busy={pending}>
  <p role="status" className="muted">{!source?t('Preparando prévia…'):source.analysis.transparent?t('Transparência detectada. O fundo original será preservado.'):t('Fundo opaco detectado. Ajuste a remoção e confira os traços na prévia.')}</p>
  <div className={`signature-image-stage ${paper==='checker'?'checker':''}`} style={{backgroundColor:paper==='white'?'#fff':paper==='dark'?'#202027':undefined}} aria-label={t('Prévia da assinatura')}>
   <div className="signature-image-frame" style={{cursor:cropping?'crosshair':'default'}} onPointerDown={event=>{if(!cropping||pending)return;event.currentTarget.setPointerCapture(event.pointerId);const p=point(event);setDrag({x0:p.x,y0:p.y,x1:p.x,y1:p.y});}} onPointerMove={event=>{if(drag){const p=point(event);setDrag({...drag,x1:p.x,y1:p.y});}}} onPointerUp={finish} onPointerCancel={()=>setDrag(null)}>
    <canvas ref={canvas}/>{drag&&<div className="crop-box" style={{left:`${Math.min(drag.x0,drag.x1)*100}%`,top:`${Math.min(drag.y0,drag.y1)*100}%`,width:`${Math.abs(drag.x1-drag.x0)*100}%`,height:`${Math.abs(drag.y1-drag.y0)*100}%`}}/>}
   </div>
  </div>
  <label className="field inline">{t('Fundo da prévia')}<select value={paper} onChange={e=>setPaper(e.target.value)}><option value="checker">{t('Quadriculado')}</option><option value="white">{t('Branco')}</option><option value="dark">{t('Escuro')}</option></select></label>
  {source&&!source.analysis.transparent&&<div className="signature-background-tools">
   <label><input type="checkbox" checked={remove} onChange={e=>adjust(()=>setRemove(e.target.checked))}/>{' '}{t('Remover fundo')}</label>
   <label className="field">{t('Intensidade')} · {strength}%<input type="range" min="0" max="100" value={strength} disabled={!remove} onChange={e=>adjust(()=>setStrength(Number(e.target.value)))}/></label>
   <label className="field inline">{t('Cor do fundo')}<input type="color" value={colorHex(background??source.analysis.background!)} disabled={!remove} onChange={e=>adjust(()=>setBackground([parseInt(e.target.value.slice(1,3),16),parseInt(e.target.value.slice(3,5),16),parseInt(e.target.value.slice(5,7),16)]))}/></label>
  </div>}
  <div className="signature-crop-actions"><button className="button secondary" disabled={!source||pending} aria-pressed={cropping} onClick={()=>adjust(()=>setCropping(!cropping))}>{t(cropping?'Cancelar recorte':'Recorte manual')}</button><button className="button secondary" disabled={!source||pending||cropping} onClick={()=>{if(processed.current){const next=signatureInkBounds(processed.current);if(next)adjust(()=>setCrop(next));else onError(t('A prévia ficou vazia. Reduza a intensidade ou preserve o fundo.'));}}}>{t('Recortar margens')}</button>{crop&&<button className="text-button" onClick={()=>adjust(()=>setCrop(null))}>{t('Desfazer recorte')}</button>}</div>
  {cropping&&<p className="muted">{t('Arraste sobre a imagem para escolher a área a manter.')}</p>}
  <p className="muted">{t('Processamento local. Os ajustes não alteram a imagem original. A assinatura ajustada é salva em PNG transparente.')}</p>
 </div>;
}
