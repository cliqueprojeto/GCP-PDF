/** Builds assets/dictionaries from open, documented sources (run once; the output is versioned):
 *  - synonyms: LibreOffice MyThes thesauri (pt_BR: LGPLv3/MPL, es: LGPL 2.1, en_US: WordNet licence);
 *  - translations: WikDict (Wiktionary, CC BY-SA 3.0), the "simple_translation" table of each pair.
 * Usage: node scripts/prepare-dictionaries.mjs [cache-folder]   (downloads into .cache/dict-src) */
import {mkdir,readFile,writeFile,access} from 'node:fs/promises';
import {gzipSync} from 'node:zlib';
import {join,resolve} from 'node:path';
import {DatabaseSync} from 'node:sqlite';

const cache=resolve(process.argv[2]??'.cache/dict-src'),out=resolve('assets/dictionaries');
const LO='https://raw.githubusercontent.com/LibreOffice/dictionaries/master';
const THESAURI={pt:'pt_BR/th_pt_BR.dat',es:'es/th_es_v2.dat',en:'en/th_en_US_v2.dat'};
const PAIRS=['pt-en','pt-es','en-pt','en-es','es-pt','es-en'];
async function fetchOnce(url,file){
 try{await access(file);return;}catch{}
 const response=await fetch(url);if(!response.ok)throw new Error(`${url}: ${response.status}`);
 await writeFile(file,Buffer.from(await response.arrayBuffer()));
}
await mkdir(cache,{recursive:true});await mkdir(out,{recursive:true});
for(const [lang,path] of Object.entries(THESAURI)){
 const file=join(cache,path.replace('/','_'));await fetchOnce(`${LO}/${path}`,file);
 const raw=await readFile(file),header=raw.subarray(0,raw.indexOf(10)).toString('latin1').trim();
 const text=new TextDecoder(/8859|latin/i.test(header)?'latin1':'utf-8').decode(raw);
 // Same MyThes layout, re-encoded as UTF-8 so the app reads every thesaurus the same way.
 const body='UTF-8\n'+text.slice(text.indexOf('\n')+1).replace(/\r\n?/g,'\n');
 await writeFile(join(out,`synonyms-${lang}.dat.gz`),gzipSync(body,{level:9}));
 console.log('synonyms',lang,(body.length/1e6).toFixed(1),'MB');
}
for(const pair of PAIRS){
 const file=join(cache,`${pair}.sqlite3`);await fetchOnce(`https://download.wikdict.com/dictionaries/sqlite/2/${pair}.sqlite3`,file);
 const db=new DatabaseSync(file,{readOnly:true});
 const rows=db.prepare('SELECT written_rep AS word, trans_list AS list FROM simple_translation ORDER BY written_rep, rel_importance DESC').all();
 db.close();
 const seen=new Set(),lines=[];
 for(const {word,list} of rows){
  const key=String(word??'').trim();if(!key||seen.has(key)||/[\t\n]/.test(key))continue;seen.add(key);
  const targets=String(list??'').split(' | ').map(t=>t.trim()).filter(Boolean);
  if(targets.length)lines.push(`${key}\t${targets.join('|')}`);
 }
 await writeFile(join(out,`${pair}.tsv.gz`),gzipSync(lines.join('\n'),{level:9}));
 console.log('translation',pair,lines.length,'entries');
}
await writeFile(join(out,'LEIA-ME.txt'),`Dicionários do GCP-PDF (uso local, sem internet)

Sinônimos (formato MyThes, documentado em https://github.com/LibreOffice/dictionaries):
- Português (Brasil): th_pt_BR — Projeto VERO / Raimundo Moura e comunidade LibreOffice Brasil. LGPLv3 e MPL.
- Espanhol: th_es_v2 — OpenThesaurus Tesauro Español, Marcelo Garrone. LGPL 2.1.
- Inglês (EUA): th_en_US_v2 — baseado no WordNet 2.x, Princeton University. Licença WordNet (permissiva).
Convertidos para UTF-8, sem outras alterações de conteúdo.

Tradução (WikDict, https://www.wikdict.com, dados do Wiktionary):
- pares pt-en, pt-es, en-pt, en-es, es-pt, es-en (tabela simple_translation).
Licença: Creative Commons Atribuição-CompartilhaIgual 3.0 (CC BY-SA 3.0). Autores: colaboradores do Wiktionary.
Formato: uma entrada por linha, "palavra<TAB>tradução1|tradução2|…", em ordem de relevância.
`);
