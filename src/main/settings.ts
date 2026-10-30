import type {LanguagePreference} from '../shared/locale';
import {app,safeStorage} from 'electron';
import {readFile,mkdir,writeFile,rename,unlink} from 'node:fs/promises';
import {join,dirname} from 'node:path';
import {randomUUID} from 'node:crypto';
import type {Signature,AiConfig,UpdatePreferences} from '../shared/types';
import {usageToday,recordUsage,type AiUsage} from '../shared/ai-usage';
/** Works on a free Google AI Studio key; "Encontrar melhor modelo" upgrades it when the key has billing. */
export const DEFAULT_GEMINI_MODEL='gemini-3.5-flash-lite';
export async function atomicWrite(path:string,bytes:Uint8Array|string){const temp=path+'.gcp-'+randomUUID()+'.tmp';try{await writeFile(temp,bytes,{flag:'wx',mode:0o600});await rename(temp,path);}catch(error){await unlink(temp).catch(()=>{});throw error;}}
type Preferences={language?:LanguagePreference;ocrLanguage?:LanguagePreference;theme:'light'|'dark';signatures:Signature[];ai:Omit<AiConfig,'hasKey'>;keys:Record<string,string>;quickActions?:boolean;updates?:UpdatePreferences;seenVersion?:string;aiUsage?:AiUsage};
export class Settings {
 private value:Preferences={theme:'light',signatures:[],ai:{provider:'gemini',model:DEFAULT_GEMINI_MODEL,baseUrl:'https://generativelanguage.googleapis.com/v1beta'},keys:{}};
 private queue:Promise<unknown>=Promise.resolve();
 private file='';
 async init(){this.file=join(app.getPath('userData'),'preferences.json');await mkdir(dirname(this.file),{recursive:true});try{const parsed=JSON.parse(await readFile(this.file,'utf8'));if(parsed&&Array.isArray(parsed.signatures)&&parsed.ai&&parsed.keys)this.value={...this.value,...parsed};}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT'){await rename(this.file,this.file+'.invalid-'+Date.now()).catch(()=>{});}}}
 private persist(){const snapshot=JSON.stringify(this.value,null,2);const job=this.queue.then(()=>atomicWrite(this.file,snapshot));this.queue=job.catch(()=>{});return job;}
 get language():LanguagePreference{return ['pt-BR','en','es','auto'].includes(this.value.language??'')?this.value.language!:'auto';}
 get ocrLanguage():LanguagePreference{return ['pt-BR','en','es','auto'].includes(this.value.ocrLanguage??'')?this.value.ocrLanguage!:'auto';}
 async setLanguage(language:LanguagePreference,ocr:LanguagePreference){if(!['auto','pt-BR','en','es'].includes(language)||!['auto','pt-BR','en','es'].includes(ocr))throw new Error('Idioma inválido.');this.value.language=language;this.value.ocrLanguage=ocr;await this.persist();}
 get theme(){return this.value.theme;}
 aiUsage(){return usageToday(this.value.aiUsage);}
 async recordAiUsage(status:number){this.value.aiUsage=recordUsage(this.value.aiUsage,status);await this.persist();}
 get seenVersion(){return this.value.seenVersion;}
 async setSeenVersion(version:string){this.value.seenVersion=version;await this.persist();}
 // A token saved by versions up to 0.3.6 (private repository) is no longer used and is dropped on the next save.
 get updates():UpdatePreferences{const {frequency='startup',lastCheck}=(this.value.updates??{}) as UpdatePreferences;return lastCheck===undefined?{frequency}:{frequency,lastCheck};}
 async setUpdates(patch:Partial<UpdatePreferences>){this.value.updates={...this.updates,...patch};await this.persist();}
 /** Explorer quick actions are on unless the user removed them. */
 get quickActions(){return this.value.quickActions!==false;}
 async setQuickActions(enabled:boolean){this.value.quickActions=enabled;await this.persist();}
 async setTheme(theme:'light'|'dark'){if(theme!=='light'&&theme!=='dark')throw new Error('Tema inválido.');this.value.theme=theme;await this.persist();}
 signatures(){return structuredClone(this.value.signatures);}
 async saveSignature(input:{id?:string;name:string;dataUrl:string}){if(!input||typeof input.name!=='string'||!input.name.trim())throw new Error('Dê um nome à assinatura.');if(typeof input.dataUrl!=='string'||!/^data:image\/(png|jpeg);base64,[A-Za-z0-9+/=\r\n]+$/.test(input.dataUrl)||input.dataUrl.length>28*1024*1024)throw new Error('Use uma imagem PNG ou JPEG de até 20 MB.');const signature:Signature={id:input.id||randomUUID(),name:input.name.trim().slice(0,120),dataUrl:input.dataUrl,createdAt:new Date().toISOString()};const found=this.value.signatures.findIndex(s=>s.id===signature.id);if(found>=0)this.value.signatures[found]=signature;else this.value.signatures.push(signature);await this.persist();return this.signatures();}
 async deleteSignature(id:string){this.value.signatures=this.value.signatures.filter(s=>s.id!==id);await this.persist();return this.signatures();}
 private keyId(config:Omit<AiConfig,'hasKey'>){return config.provider+':'+new URL(config.baseUrl).origin;}
 config():AiConfig {return {...this.value.ai,hasKey:!!this.value.keys[this.keyId(this.value.ai)]};}
 async saveAi(input:Omit<AiConfig,'hasKey'>&{key?:string}){if(!['openai','gemini','compatible'].includes(input.provider))throw new Error('Provedor de IA inválido.');if(!input.model?.trim())throw new Error('Informe o identificador do modelo.');const url=new URL(input.baseUrl);if(url.username||url.password||url.search||url.hash)throw new Error('Informe a URL base, sem chave, senha ou parâmetros.');if(url.protocol!=='https:'&&!(url.protocol==='http:'&&['127.0.0.1','localhost','[::1]'].includes(url.hostname)))throw new Error('Use HTTPS ou um servidor local.');if(input.provider==='openai'&&url.origin!=='https://api.openai.com')throw new Error('Para um endpoint diferente da OpenAI, escolha Compatível com OpenAI.');if(input.provider==='gemini'&&url.origin!=='https://generativelanguage.googleapis.com')throw new Error('Use o endpoint oficial do Google para Gemini.');const config={provider:input.provider,model:input.model.trim(),baseUrl:url.href.replace(/\/$/,'')};const keyId=this.keyId(config);if(input.key?.trim()){if(!(await safeStorage.isAsyncEncryptionAvailable()))throw new Error('O cofre de credenciais do sistema está indisponível. A chave não foi salva.');if(process.platform==='linux'&&safeStorage.getSelectedStorageBackend()==='basic_text')throw new Error('Ative o cofre de senhas do sistema para salvar sua chave com segurança.');this.value.keys[keyId]=(await safeStorage.encryptStringAsync(input.key.trim())).toString('base64');}this.value.ai=config;await this.persist();return this.config();}
 /** The saved key for a provider/endpoint (not necessarily the active one), or undefined. */
 async secretFor(config:Pick<AiConfig,'provider'|'baseUrl'>){const encrypted=this.value.keys[this.keyId({provider:config.provider,baseUrl:config.baseUrl,model:''} as Omit<AiConfig,'hasKey'>)];if(!encrypted)return undefined;return (await safeStorage.decryptStringAsync(Buffer.from(encrypted,'base64'))).result;}
 async secret(){const encrypted=this.value.keys[this.keyId(this.value.ai)];if(!encrypted)throw new Error('Adicione uma chave de API em Configurações de IA.');const result=await safeStorage.decryptStringAsync(Buffer.from(encrypted,'base64'));return result.result;}
}
