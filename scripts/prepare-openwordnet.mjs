/** OpenWN-PT via the Open Multilingual Wordnet snapshot. Keep sense membership;
 * only lemma relations are used, never hypernyms or antonyms. Offline at runtime. */
import {mkdir, writeFile} from 'node:fs/promises';
import {gzipSync} from 'node:zlib';
import {createHash} from 'node:crypto';
const revision = '406bf83b3c507a3d1f26e88252d5d66893fd36bf';
const root = `https://raw.githubusercontent.com/omwn/omw-data/${revision}/wns/por/`;
const fetchText = async name => {const response = await fetch(root + name); if (!response.ok) throw Error(`${name}: ${response.status}`); return response.text();};
const [text, license] = await Promise.all(['wn-data-por.tab', 'LICENSE'].map(fetchText));
const senses = new Map();
for (const line of text.split('\n')) {
  if (!line || line.startsWith('#')) continue;
  const [id, relation, lemma] = line.split('\t');
  if (relation !== 'lemma' || !lemma?.trim()) continue;
  if (!/^\d{8}-[nvars]$/.test(id) || /[|\r]/.test(lemma)) throw Error('Invalid OpenWN-PT record');
  const words = senses.get(id) ?? new Set(); words.add(lemma.trim()); senses.set(id, words);
}
const entries = new Map(), names = {n:'substantivo', v:'verbo', a:'adjetivo', s:'adjetivo', r:'advérbio'};
for (const [id, words] of senses) {
  if (words.size < 2) continue;
  for (const word of words) {
    const groups = entries.get(word) ?? [];
    groups.push(`(${names[id.at(-1)]})|${[...words].join('|')}`);
    entries.set(word, groups);
  }
}
const body = 'UTF-8\n' + [...entries].sort(([a],[b]) => a.localeCompare(b, 'pt')).map(([word, groups]) => `${word}|${groups.length}\n${groups.join('\n')}`).join('\n') + '\n';
await mkdir('assets/dictionaries/licenses', {recursive:true});
await writeFile('assets/dictionaries/openwordnet-pt.dat.gz', gzipSync(body, {level:9}));
await writeFile('assets/dictionaries/licenses/OpenWN-PT.txt', license);
await writeFile('assets/dictionaries/openwordnet-source.json', JSON.stringify({name:'OpenWN-PT', authors:'Alexandre Rademaker, Valeria de Paiva e colaboradores do OpenWordnet-PT', source:root+'wn-data-por.tab', revision, sha256:createHash('sha256').update(text).digest('hex'), license:'CC-BY-SA-3.0', conversion:'Only lemma synsets with at least two members, converted to UTF-8 MyThes; sense boundaries preserved.', entries:entries.size}, null, 2)+'\n');
console.log(`OpenWN-PT: ${entries.size} headwords with synonyms`);
