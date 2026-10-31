import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {gzipSync} from 'node:zlib';
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

test('case-sensitive abbreviations do not shadow common words in lexical translation',async()=>{
 const lower=await dictionaries.translate('no','pt','en');
 assert.ok(lower.entries[0]!.translations.includes('on'));
 assert.ok(!lower.entries[0]!.translations.includes('NW'));
 assert.deepEqual((await dictionaries.translate('NO','pt','en')).entries[0]!.translations,['NW']);
 const sentence=await dictionaries.translate('circulação no território','pt','en');
 assert.ok(!sentence.entries.find(entry=>entry.word==='no')!.translations.includes('NW'));
});

test('MyThes excludes related/opposite terms and preserves separate synonym senses',async()=>{
 const folder=await mkdtemp(path.join(tmpdir(),'gcp-thesaurus-'));
 try{
  await writeFile(path.join(folder,'synonyms-en.dat.gz'),gzipSync('UTF-8\nbright|2\n(adj)|brilliant|dark (antonym)|dull (antonym term)|light (generic term)|idea (related term)|luminous (similar term)\n(adj)|clever|smart\n'));
  const result=await new Dictionaries(()=>folder).synonyms('bright','en');
  assert.deepEqual(result.meanings,[{label:'adj',words:['brilliant','luminous']},{label:'adj',words:['clever','smart']}]);
 }finally{assert.equal(path.dirname(folder),path.resolve(tmpdir()));await rm(folder,{recursive:true,force:true});}
});
