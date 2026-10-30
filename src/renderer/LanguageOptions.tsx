import React,{useEffect,useState} from 'react';
import type {LanguageSettings,LanguagePreference} from '../shared/locale';
import {setLocale,t} from './i18n';
export function LanguageOptions(){
 const [settings,setSettings]=useState<LanguageSettings|null>(null),[error,setError]=useState(''),[busy,setBusy]=useState(false);
 useEffect(()=>{window.gcp.getLanguage().then(setSettings).catch(e=>setError(String(e)));return window.gcp.onLanguage(setSettings);},[]);
 const save=async(language:LanguagePreference,ocr:LanguagePreference)=>{setBusy(true);setError('');try{const next=await window.gcp.setLanguage(language,ocr);setSettings(next);setLocale(next.locale);}catch(e){setError(String(e));}finally{setBusy(false);}};
 const options=<><option value="auto">{t('Automático (sistema; padrão PT-BR)')}</option><option value="pt-BR">Português (Brasil)</option><option value="en">English</option><option value="es">Español</option></>;
 return <section className="form-section"><h3>{t('Idioma')}</h3>{settings&&<div className="field-grid"><label className="field">{t('Idioma do aplicativo')}<select aria-label={t('Idioma do aplicativo')} disabled={busy} value={settings.language} onChange={e=>void save(e.target.value as LanguagePreference,settings.ocr)}>{options}</select></label><label className="field">{t('Idioma do OCR')}<select aria-label={t('Idioma do OCR')} disabled={busy} value={settings.ocr} onChange={e=>void save(settings.language,e.target.value as LanguagePreference)}>{options}</select></label></div>}<p className="muted">{t('O OCR funciona localmente em português, inglês ou espanhol. Escolha o idioma do documento quando ele for diferente do sistema.')}</p>{error&&<p role="alert">{error}</p>}</section>;
}
