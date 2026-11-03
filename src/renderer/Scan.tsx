import React,{useEffect,useRef,useState} from 'react';
import {ArrowDown,ArrowUp,FilePlus2,LoaderCircle,RefreshCw,RotateCw,ScanLine,Trash2} from 'lucide-react';
import {Modal} from './Dialogs';
import {PAPER_SIZES,type BlankOptions,type ScannerDevice,type ScannerCapabilities,type ScanOptions,type ScanPage} from '../shared/scanner';
import type {DocumentInfo} from '../shared/types';
import './Scan.css';
const message=(e:unknown)=>e instanceof Error?e.message:String(e);
export function NewPdfDialog({onClose}:{onClose:()=>void}){
 const [o,set]=useState<BlankOptions>({paper:'A4',landscape:false,pages:1}),[busy,setBusy]=useState(false),[error,setError]=useState('');
 return <Modal title="Criar um PDF" description="Comece com páginas em branco. Você poderá adicionar mais páginas em Organizar." onClose={()=>!busy&&onClose()}>
  <div className="scan-fields"><label className="field">Papel<select value={o.paper} onChange={e=>set({...o,paper:e.target.value as BlankOptions['paper']})}>{Object.entries(PAPER_SIZES).map(([key,size])=><option key={key} value={key}>{key} · {size.join(' × ')} mm</option>)}</select></label>
  <label className="field">Orientação<select value={String(o.landscape)} onChange={e=>set({...o,landscape:e.target.value==='true'})}><option value="false">Retrato</option><option value="true">Paisagem</option></select></label>
  <label className="field">Páginas<input type="number" min={1} max={500} value={o.pages} onChange={e=>set({...o,pages:Number(e.target.value)})}/></label></div>
  {error&&<p role="alert" className="scan-error">{error}</p>}
  <div className="modal-actions"><button className="button secondary" disabled={busy} onClick={onClose}>Cancelar</button><button className="button primary" disabled={busy||!Number.isInteger(o.pages)||o.pages<1||o.pages>500} onClick={async()=>{setBusy(true);try{await window.gcp.newDocument(o);onClose();}catch(e){setError(message(e));}finally{setBusy(false);}}}><FilePlus2 size={16}/> Criar PDF</button></div>
 </Modal>;
}
type Preview=ScanPage&{rotation:number};
export function ScanDialog({doc,index,onClose,onError}:{doc?:DocumentInfo;index:number;onClose:()=>void;onError:(error:unknown)=>void}){
 const [devices,setDevices]=useState<ScannerDevice[]>([]),[caps,setCaps]=useState<ScannerCapabilities|null>(null);
 const [o,set]=useState<ScanOptions>({device:'',source:'',dpi:300,color:'color',paper:'A4',nativeUi:false,ocr:true});
 const [pages,setPages]=useState<Preview[]>([]),[busy,setBusy]=useState(''),[error,setError]=useState(''),[status,setStatus]=useState(''),[closing,setClosing]=useState(false),[insert,setInsert]=useState(false);
 const mounted=useRef(true),request=useRef(0);
 async function refresh(){setBusy('Procurando scanners…');setError('');try{const list=await window.gcp.listScanners();if(mounted.current){setDevices(list);set(v=>({...v,device:list.some(d=>d.id===v.device)?v.device:list[0]?.id??''}));}}catch(e){if(mounted.current)setError(message(e));}finally{if(mounted.current)setBusy('');}}
 useEffect(()=>{mounted.current=true;void refresh();void window.gcp.scannedPages().then(list=>{if(mounted.current)setPages(list.map(p=>({...p,rotation:0})));});return()=>{mounted.current=false;};},[]);
 useEffect(()=>{const id=++request.current;setCaps(null);if(!o.device)return;setBusy('Consultando o driver…');void window.gcp.scannerCapabilities(o.device).then(c=>{if(mounted.current&&id===request.current){setCaps(c);set(v=>({...v,source:c.sources[0]??'',nativeUi:false}));}}).catch(e=>{if(mounted.current&&id===request.current)setError(message(e));}).finally(()=>{if(mounted.current&&id===request.current)setBusy('');});},[o.device]);
 useEffect(()=>window.gcp.onAction(action=>{if(action.startsWith('progress:'))setStatus(action.slice(9));}),[]);
 const close=()=>{if(busy)return;if(pages.length)setClosing(true);else onClose();};
 async function acquire(){setBusy('Digitalizando…');setError('');try{await window.gcp.scanPages(o);}catch(e){setError(message(e));}finally{
  try{const list=await window.gcp.scannedPages();setPages(old=>[...old.filter(p=>list.some(v=>v.id===p.id)),...list.filter(p=>!old.some(v=>v.id===p.id)).map(p=>({...p,rotation:0}))]);}catch(e){setError(message(e));}
  setBusy('');setStatus('');
 }}
 function move(at:number,delta:number){setPages(old=>{const copy=[...old];[copy[at],copy[at+delta]]=[copy[at+delta]!,copy[at]!];return copy;});}
 return <Modal title="Digitalizar para PDF" description="Digitalização local • revise as páginas antes de salvar" onClose={close} wide>
  <div className="scan-layout"><section className="scan-settings" aria-label="Configuração do scanner">
   <label className="field">Scanner USB ou multifuncional<div className="scan-device"><select disabled={!!busy} value={o.device} onChange={e=>set({...o,device:e.target.value})}><option value="">Selecione um scanner</option>{devices.map(d=><option key={d.id} value={d.id}>{d.name}</option>)}</select><button className="icon-button" title="Atualizar scanners" disabled={!!busy} onClick={()=>void refresh()}><RefreshCw size={16}/></button></div></label>
   {!devices.length&&!busy&&<p className="scan-hint">Conecte o scanner, ligue-o e instale o driver do fabricante. Depois atualize a lista.</p>}
   <fieldset disabled={!!busy||!caps}><legend>Preferências de aquisição</legend>
    <label className="field">Origem / frente e verso<select value={o.source} onChange={e=>set({...o,source:e.target.value})}>{caps?.sources.length?caps.sources.map(s=><option key={s}>{s}</option>):<option value="">Padrão do driver</option>}</select></label>
    <label className="scan-check"><input type="checkbox" disabled={!caps?.nativeUi} checked={o.nativeUi} onChange={e=>set({...o,nativeUi:e.target.checked})}/> Usar interface do scanner</label>
    <div className="scan-fields"><label className="field">Resolução<select disabled={o.nativeUi} value={o.dpi} onChange={e=>set({...o,dpi:Number(e.target.value)})}>{[75,150,200,300,600].map(d=><option key={d} value={d}>{d} dpi</option>)}</select></label>
    <label className="field">Cor<select disabled={o.nativeUi} value={o.color} onChange={e=>set({...o,color:e.target.value as ScanOptions['color']})}><option value="color">Colorido</option><option value="gray">Tons de cinza</option><option value="bw">Preto e branco</option></select></label></div>
    <label className="field">Tamanho do papel<select value={o.paper} onChange={e=>set({...o,paper:e.target.value as ScanOptions['paper']})}>{Object.entries(PAPER_SIZES).map(([p,size])=><option key={p} value={p}>{p} · {size.join(' × ')} mm</option>)}</select></label>
    <label className="scan-check"><input type="checkbox" checked={o.ocr} onChange={e=>set({...o,ocr:e.target.checked})}/> OCR automático em cada digitalização</label>
   </fieldset>
   <p className="scan-hint">{caps?.description} O OCR usa o idioma definido em Preferências. Confira o texto reconhecido.</p>
   <p className="scan-hint">Sem duplex automático? Digitalize a frente, vire a folha e digitalize o verso. Organize as páginas na prévia.</p>
   {doc&&<label className="scan-check"><input type="checkbox" disabled={!!busy} checked={insert} onChange={e=>setInsert(e.target.checked)}/> Inserir após a página {index+1} de “{doc.name}”</label>}
  </section><section className="scan-preview" aria-label="Prévia das páginas">
   <div className="scan-preview-heading"><strong>{pages.length} página(s)</strong><span>Gire, organize ou remova</span></div>
   {!pages.length?<div className="scan-empty"><ScanLine size={48}/><h3>Seu documento começa aqui</h3><p>Coloque o papel no scanner e clique em Digitalizar.</p></div>:<div className="scan-grid">{pages.map((p,i)=><article className="scan-card" key={p.id}><div className="scan-image"><img src={p.preview} style={{transform:`rotate(${p.rotation}deg)`}} alt={`Página digitalizada ${i+1}`}/></div><div className="scan-card-heading"><strong>Página {i+1}</strong><span>{p.ocr?'OCR ✓':'Imagem'}</span></div>{p.warning&&<p className="scan-error">{p.warning}</p>}<div className="scan-page-actions"><button title="Mover página para cima" disabled={!!busy||i===0} onClick={()=>move(i,-1)}><ArrowUp size={15}/></button><button title="Mover página para baixo" disabled={!!busy||i===pages.length-1} onClick={()=>move(i,1)}><ArrowDown size={15}/></button><button title="Girar página" disabled={!!busy} onClick={()=>setPages(v=>v.map(x=>x.id===p.id?{...x,rotation:(x.rotation+90)%360}:x))}><RotateCw size={15}/></button><button title="Remover página" disabled={!!busy} onClick={()=>void window.gcp.removeScannedPage(p.id).then(()=>setPages(v=>v.filter(x=>x.id!==p.id))).catch(e=>setError(message(e)))}><Trash2 size={15}/></button></div></article>)}</div>}
  </section></div>
  {error&&<p className="scan-error" role="alert">{error}</p>}
  <div className="scan-status" role="status">{busy?<><LoaderCircle size={16} className="spin"/> {status||busy}</>:pages.length?'Deseja inserir mais páginas? Digitalize novamente ou finalize para salvar.':'Pronto para digitalizar.'}</div>
  {closing?<div className="scan-discard"><p>Descartar as páginas digitalizadas desta sessão?</p><button className="button secondary" onClick={()=>setClosing(false)}>Continuar revisando</button><button className="button secondary" onClick={async()=>{try{await window.gcp.discardScans();onClose();}catch(e){setError(message(e));}}}>Descartar páginas</button></div>:<div className="modal-actions"><button className="button secondary" disabled={!!busy} onClick={close}>Fechar</button>{busy==='Digitalizando…'&&<button className="button secondary" onClick={()=>void window.gcp.cancelScan().catch(e=>setError(message(e)))}>Cancelar digitalização</button>}<button className="button secondary" disabled={!!busy||!caps||!o.device} onClick={()=>void acquire()}><ScanLine size={16}/>{pages.length?'Digitalizar mais páginas':'Digitalizar'}</button><button className="button primary" disabled={!!busy||!pages.length} onClick={async()=>{setBusy('Montando PDF…');setError('');try{const id=await window.gcp.finishScans(pages.map(p=>({id:p.id,rotation:p.rotation})),insert&&doc?{id:doc.id,revision:doc.revision,index:index+1}:undefined);onClose();void window.gcp.saveDocument(id).catch(onError);}catch(e){setError(message(e));}finally{setBusy('');}}}>{insert?'Inserir e salvar':'Finalizar e salvar PDF'}</button></div>}
 </Modal>;
}
