import test from 'node:test';
import assert from 'node:assert/strict';
import {detectLocale,resolveLocale,OCR_LANGUAGES} from '../src/shared/locale';
import {translations} from '../src/shared/translations';
test('language detection covers regional English, Spanish and Portuguese with PT-BR fallback',()=>{
 for(const [system,expected] of [['en-US','en'],['en_GB','en'],['es-AR','es'],['es-ES','es'],['pt-PT','pt-BR'],['pt-BR','pt-BR'],['de-DE','pt-BR']])assert.equal(detectLocale([system!]),expected);
 assert.equal(detectLocale([]),'pt-BR');assert.equal(resolveLocale('es',['en-US']),'es');assert.equal(resolveLocale('auto',['en-US']),'en');
 assert.deepEqual(OCR_LANGUAGES,{'pt-BR':'por',en:'eng',es:'spa'});
});
test('every catalog entry includes English and Spanish, including core workflows',()=>{
 for(const [source,values] of Object.entries(translations)){assert.ok(source);assert.doesNotMatch(source,/\r|\n/);for(const value of values)assert.doesNotMatch(value,/\r|\n/);assert.equal(values.length,2);assert.ok(values[0],source);assert.ok(values[1],source);}
 for(const source of ['Salvar como','Excluir anotação','Idioma do OCR','Proteger com senha','Impressão','Editar','Comentários'])assert.ok(translations[source],source);
});
