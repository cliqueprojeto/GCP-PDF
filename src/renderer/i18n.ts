import {useSyncExternalStore} from 'react';
import type {Locale} from '../shared/locale';
import {localize} from '../shared/localize';
let locale:Locale='pt-BR';
const listeners=new Set<()=>void>();
export function setLocale(value:Locale){if(locale===value)return;locale=value;if(typeof document!=="undefined")document.documentElement.lang=value;for(const listener of listeners)listener();}
export function useLocale(){return useSyncExternalStore(listener=>{listeners.add(listener);return()=>{listeners.delete(listener);};},()=>locale);}
/** Only explicitly marked interface text passes here. PDF text and caller-selected names stay untouched. */
export function getLocale(){return locale;}
export function t(source:string,parameters:Record<string,string|number>={}):string {return localize(source,locale,parameters);}
