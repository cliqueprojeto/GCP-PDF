import {t as translateUi} from "./i18n";
import React,{useEffect,useState} from 'react';
import {BarChart3} from 'lucide-react';
import type {AiUsage} from '../shared/ai-usage';
export function AiUsagePanel({busy}:{busy:boolean}){
 const [open,setOpen]=useState(false),[usage,setUsage]=useState<AiUsage>(),[error,setError]=useState('');
 useEffect(()=>{if(!open)return;let live=true;window.gcp.getAiUsage().then(value=>{if(live){setUsage(value);setError('');}},()=>{if(live)setError('Não foi possível consultar a contagem local.');});return()=>{live=false;};},[open,busy]);
 return <div style={{padding:'4px 16px',fontSize:12}}><button className="text-button" onClick={()=>setOpen(!open)} aria-expanded={open}><BarChart3 size={14}/>{" "}{translateUi("Estatísticas de IA")}</button>{open&&<div role="status" style={{padding:'8px 0',lineHeight:1.8}}><strong>{translateUi("Uso neste computador hoje")}</strong>{usage&&<p>{usage.requests}{" "}{translateUi("solicitações ·")}{" "}{usage.responses}{" "}{translateUi("aceitas pelo provedor")}<br/>{usage.limited}{" "}{translateUi("com limite atingido ·")}{" "}{usage.failures}{" "}{translateUi("com falha")}</p>}{error&&<p>{error}</p>}<p>{translateUi("Contagem local de todos os provedores. Reinicia a cada dia. Os limites e o saldo reais são definidos pelo provedor; esta contagem não informa a cota restante.")}</p></div>}</div>;
}
