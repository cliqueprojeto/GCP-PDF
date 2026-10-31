import {readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {gunzipSync} from 'node:zlib';
import type {DictionaryLanguage,SynonymResult,TranslationResult} from '../shared/types';

/** Offline synonym (MyThes) and translation (WikDict) dictionaries for Portuguese, English and Spanish.
 * Each file is read and indexed the first time it is used; lookups are then map reads. */
type Index = {text:string;offsets:Map<string,number>};
const LANGS:DictionaryLanguage[]=['pt','en','es'];

/** Lowercase, outer punctuation removed, inner spaces collapsed. Accents are kept: they change words. */
export function normalizeTerm(text:string) {
 return text.normalize('NFC').toLocaleLowerCase('pt-BR').replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu,'').replace(/\s+/g,' ');
}
/** Dictionary forms to try after the word itself: plural, verb and adverb endings of each language. */
export function baseForms(word:string,lang:DictionaryLanguage):string[] {
 const rules:Record<DictionaryLanguage,[RegExp,string][]>={
  pt:[[/ões$/,'ão'],[/ães$/,'ão'],[/ais$/,'al'],[/éis$/,'el'],[/óis$/,'ol'],[/is$/,'il'],[/ns$/,'m'],[/res$/,'r'],[/zes$/,'z'],[/ses$/,'s'],[/s$/,''],[/mente$/,''],[/as$/,'o'],[/a$/,'o'],[/ando$/,'ar'],[/endo$/,'er'],[/indo$/,'ir'],[/ado$/,'ar'],[/ido$/,'er'],[/ido$/,'ir']],
  en:[[/([bdgmnprt])\1(?:ing|ed)$/,'$1'],[/ies$/,'y'],[/ves$/,'f'],[/es$/,''],[/s$/,''],[/ied$/,'y'],[/ed$/,''],[/ed$/,'e'],[/ing$/,''],[/ing$/,'e'],[/ly$/,''],[/er$/,''],[/est$/,'']],
  es:[[/ces$/,'z'],[/es$/,''],[/s$/,''],[/mente$/,''],[/as$/,'o'],[/a$/,'o'],[/ando$/,'ar'],[/iendo$/,'er'],[/iendo$/,'ir'],[/ado$/,'ar'],[/ido$/,'er'],[/ido$/,'ir']],
 };
 const forms:string[]=[];
 for(const [pattern,replacement] of rules[lang])if(pattern.test(word)){const form=word.replace(pattern,replacement);if(form.length>1&&form!==word&&!forms.includes(form))forms.push(form);}
 return forms;
}

export class Dictionaries {
 private loaded=new Map<string,Promise<Index>>();
 constructor(private folder:()=>string) {}
 private index(file:string,separator:'|'|'\t'):Promise<Index> {
  let entry=this.loaded.get(file);
  if(!entry){
   entry=readFile(join(this.folder(),file)).then(bytes=>{
    const text=gunzipSync(bytes).toString('utf8'),offsets=new Map<string,number>();
    // MyThes: "word|count" header lines, each followed by `count` meaning lines starting with "(".
    // WikDict: "word<TAB>t1|t2". The first spelling of a word wins.
    for(let at=0;at<text.length;){
     let end=text.indexOf('\n',at);if(end<0)end=text.length;
     const cut=separator==='|'?text.lastIndexOf('|',end):text.indexOf('\t',at);
     if(cut>at&&cut<end&&(separator==='\t'||/^\d+$/.test(text.slice(cut+1,end)))){const key=normalizeTerm(text.slice(at,cut));if(key&&!offsets.has(key))offsets.set(key,at);}
     at=end+1;
    }
    return {text,offsets};
   });
   entry.catch(()=>this.loaded.delete(file));
   this.loaded.set(file,entry);
  }
  return entry;
 }
 private async find(file:string,separator:'|'|'\t',term:string,lang:DictionaryLanguage) {
  const index=await this.index(file,separator);
  for(const candidate of [term,...baseForms(term,lang)]){const at=index.offsets.get(candidate);if(at!==undefined)return {index,at,word:candidate};}
  return null;
 }
 async synonyms(text:string,lang:DictionaryLanguage):Promise<SynonymResult> {
  const term=normalizeTerm(text);
  if(!term)return {term,lang,meanings:[]};
  const found=await this.find(`synonyms-${lang}.dat.gz`,'|',term,lang);
  if(!found)return {term,lang,meanings:[]};
  const data=found.index.text,at=found.at;
  const header=data.slice(at,data.indexOf('\n',at)),count=Number(header.slice(header.lastIndexOf('|')+1))||0,meanings:SynonymResult['meanings']=[];
  let cursor=data.indexOf('\n',at)+1;
  for(let i=0;i<count&&cursor>0;i++){
   const end=data.indexOf('\n',cursor),line=data.slice(cursor,end<0?undefined:end);cursor=end+1;
   const parts=line.split('|'),label=/^\((.*?)\)/.exec(parts[0]??'')?.[1]??'',first=(parts[0]??'').replace(/^\(.*?\)/,'').replace(/^-$/,'').trim();
   const words=[...new Set([first,...parts.slice(1)].map(w=>w.replace(/\s*\((generic|similar|related|antonym) term\)$/,'').trim()).filter(w=>w&&normalizeTerm(w)!==found.word))];
   if(words.length)meanings.push({label:label.replace(/^Sinônimo$/i,''),words});
  }
  return {term,lang,...(found.word!==term?{base:found.word}:{}),meanings};
 }
 /** A phrase the dictionary knows is translated as a whole; otherwise word by word. */
 async translate(text:string,from:DictionaryLanguage|'auto',to:DictionaryLanguage):Promise<TranslationResult> {
  const term=normalizeTerm(text);
  const source=from==='auto'?await this.detect(term,to):from;
  if(!term||source===to)return {term,from:source,to,entries:[]};
  const file=`${source}-${to}.tsv.gz`,whole=await this.find(file,'\t',term,source);
  const read=(found:NonNullable<typeof whole>)=>{const data=found.index.text,end=data.indexOf('\n',found.at),line=data.slice(found.at,end<0?undefined:end);return line.slice(line.indexOf('\t')+1).split('|').filter(Boolean).slice(0,12);};
  if(whole)return {term,from:source,to,entries:[{word:whole.word,translations:read(whole)}]};
  const words=[...new Set(term.split(/[^\p{L}\p{N}'-]+/u).filter(w=>w.length>1))].slice(0,40),entries:TranslationResult['entries']=[];
  for(const word of words){const found=await this.find(file,'\t',word,source);entries.push({word,translations:found?read(found):[]});}
  return {term,from:source,to,entries};
 }
 /** The language whose dictionary knows most of the words, preferring the one that is not the target. */
 async detect(term:string,to:DictionaryLanguage):Promise<DictionaryLanguage> {
  const words=term.split(/[^\p{L}\p{N}'-]+/u).filter(w=>w.length>1).slice(0,30);
  let best:DictionaryLanguage=to==='pt'?'en':'pt',score=-1;
  for(const lang of LANGS.filter(l=>l!==to)){
   const target=LANGS.find(l=>l!==lang)!,index=await this.index(`${lang}-${target}.tsv.gz`,'\t');
   const known=words.filter(w=>index.offsets.has(w)).length+(lang==='pt'&&/[ãõç]/.test(term)?2:0)+(lang==='es'&&/[ñ¿¡]/.test(term)?2:0);
   if(known>score){score=known;best=lang;}
  }
  return best;
 }
}
