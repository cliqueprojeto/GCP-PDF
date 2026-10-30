import type {Locale} from './locale';
import {translations} from './translations';
export function localize(source:string,locale:Locale,parameters:Record<string,string|number>={}):string {
 let result=locale==='pt-BR'?source:translations[source]?.[locale==='en'?0:1];
 if(result===undefined){const shortcut=source.match(/^(.*?) · (Ctrl\+.*|F\d+|Delete)$/);result=shortcut?localize(shortcut[1]!,locale)+' · '+shortcut[2]:source;}
 return result.replace(/\{([a-zA-Z]+)\}/g,(match,key)=>parameters[key]===undefined?match:String(parameters[key]));
}
