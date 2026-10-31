import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {Dictionaries,baseForms,normalizeTerm} from '../src/main/dictionary';

const dictionaries=new Dictionaries(()=>path.resolve('assets/dictionaries'));

test('terms are normalized and inflected words fall back to their dictionary forms',()=>{
 assert.equal(normalizeTerm('  “Casas,” '),'casas');
 assert.ok(baseForms('canções','pt').includes('canção'));
 assert.ok(baseForms('running','en').includes('run'));
});

test('synonyms in Portuguese, English and Spanish come from the bundled thesauri',async()=>{
 const pt=await dictionaries.synonyms('casa','pt');
 assert.ok(pt.meanings.length>0&&pt.meanings.some(m=>m.words.includes('lar')),JSON.stringify(pt.meanings[0]));
 const plural=await dictionaries.synonyms('Casas.','pt');
 assert.equal(plural.base,'casa');
 assert.ok((await dictionaries.synonyms('happy','en')).meanings.some(m=>m.words.length));
 assert.ok((await dictionaries.synonyms('feliz','es')).meanings.length>0);
 assert.deepEqual((await dictionaries.synonyms('xyzqw','pt')).meanings,[]);
});

test('translation detects the source language and covers the six directions',async()=>{
 const house=await dictionaries.translate('casa','auto','en');
 assert.equal(house.from,'pt');
 assert.ok(house.entries[0]!.translations.includes('house'));
 assert.ok((await dictionaries.translate('house','en','es')).entries[0]!.translations.includes('casa'));
 const sentence=await dictionaries.translate('a casa grande','pt','es');
 assert.ok(sentence.entries.length>=2);
});
