export type Locale='pt-BR'|'en'|'es';
export type LanguagePreference=Locale|'auto';
export interface LanguageSettings {language:LanguagePreference;ocr:LanguagePreference;locale:Locale;ocrLocale:Locale}
export function detectLocale(languages:readonly string[]):Locale {
 for(const language of languages){const primary=language.toLowerCase().split(/[-_]/)[0];if(primary==='pt')return 'pt-BR';if(primary==='en'||primary==='es')return primary;}
 return 'pt-BR';
}
export function resolveLocale(preference:LanguagePreference,system:readonly string[]):Locale {return preference==='auto'?detectLocale(system):preference;}
export const OCR_LANGUAGES:Record<Locale,string>={'pt-BR':'por',en:'eng',es:'spa'};
