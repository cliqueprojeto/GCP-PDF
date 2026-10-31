/** Real Electron workflow: first-run palette, legacy preferences, review and selection lookup. */
import {_electron as electron} from 'playwright-core';
import {createRequire} from 'node:module';
import {mkdir, mkdtemp, readFile, writeFile} from 'node:fs/promises';
import {join, resolve} from 'node:path';
import {tmpdir} from 'node:os';
import assert from 'node:assert/strict';
import {PDFDocument, StandardFonts} from 'pdf-lib';
const require = createRequire(import.meta.url), root = await mkdtemp(join(tmpdir(), 'gcp-appearance-'));
await mkdir('evidence/appearance', {recursive:true});
const pdf = await PDFDocument.create(), font = await pdf.embedFont(StandardFonts.Helvetica);
pdf.addPage([595,842]).drawText('casa grande no territorio e cultura', {font, size:16, x:50, y:740});
const file = join(root,'consulta.pdf'); await writeFile(file, await pdf.save());
let app;
const errors = [];
async function launch(profile) {
  const env = {...process.env, GCP_PDF_TEST_MODE:'1', GCP_PDF_DATA_DIR:profile}; delete env.ELECTRON_RUN_AS_NODE;
  app = await electron.launch({executablePath:require('electron'), args:[resolve('.'),file], env, timeout:90000});
  const page = await app.firstWindow(); page.setDefaultTimeout(15000); page.on('pageerror', error => errors.push(error.message));
  await page.waitForSelector('.ribbon-tabs'); console.log('launched', profile);
  return page;
}
async function close() {await app.evaluate(() => {for(const view of globalThis.__gcpTest.views.values()) view.allowClose = true;}); await app.close(); app = undefined;}
const fit = async page => {
  const sizes = await page.locator('.modal:has(.lookup)').evaluate(el => {
    const nodes = [el, ...el.querySelectorAll('*')];
    return {horizontal:nodes.filter(n => n.clientWidth > 0 && n.scrollWidth > n.clientWidth + 2).map(n => n.className), scrolls:nodes.filter(n => n.scrollHeight > n.clientHeight + 2 && ['auto','scroll'].includes(getComputedStyle(n).overflowY)).map(n => n.className), bottom:el.getBoundingClientRect().bottom, height:innerHeight};
  });
  assert.deepEqual(sizes.horizontal, [], JSON.stringify(sizes)); assert.ok(sizes.scrolls.length <= 1, JSON.stringify(sizes)); assert.ok(sizes.bottom <= sizes.height, JSON.stringify(sizes));
};
try {
  const profile = join(root,'fresh');
  let page = await launch(profile);
  const welcome = page.getByRole('dialog', {name:'Seu espaço, suas cores'});
  await welcome.waitFor(); console.log('welcome'); assert.equal(await welcome.locator('.theme-options button').count(),6);
  await welcome.getByRole('button', {name:'Oceano'}).click();
  await page.waitForFunction(() => document.documentElement.dataset.palette === 'dark-ocean');
  assert.ok(await welcome.isVisible(), 'preview keeps the chooser open');
  await page.keyboard.press('Escape');
  await welcome.waitFor({state:'detached'});
  await page.waitForTimeout(300);
  assert.equal((await page.evaluate(()=>window.gcp.getWorkspace())).theme,'dark-ocean');
  await page.waitForSelector('.page-sheet:not(.loading)');
  console.log('settings'); await page.getByTitle('Configurações', {exact:true}).click();
  const settings = page.getByRole('dialog', {name:'Configurações',exact:true});
  for (const [name,id,mode] of [['Lavanda','light','light'],['Brisa','light-ocean','light'],['Areia','light-sand','light'],['Ametista','dark','dark'],['Floresta','dark-forest','dark'],['Oceano','dark-ocean','dark']]) {
    await settings.getByRole('button',{name,exact:true}).click();
    await page.waitForFunction(({id,mode}) => document.documentElement.dataset.palette === id && document.documentElement.dataset.theme === mode,{id,mode});
  }
  await page.keyboard.press('Escape');
  await page.locator('.ribbon-tabs button').filter({hasText:'Revisar'}).click();
  await page.locator('.tool-button').filter({hasText:'Sinônimos'}).click();
  console.log('lookup'); const input = page.getByRole('textbox',{name:'Palavra ou trecho'});
  await input.fill('circulação no território e'); await page.getByRole('button',{name:'Consultar',exact:true}).click();
  await page.getByLabel('Escolha a palavra do trecho').selectOption('território');
  await page.waitForSelector('.lookup .chip'); await fit(page);
  for (const [width,height] of [[1500,950],[940,660]]) {
    await page.setViewportSize({width,height}); await fit(page);
    await page.screenshot({path:`evidence/appearance/synonyms-${width}.png`});
  }
  await page.getByRole('tab',{name:'Tradução',exact:true}).click();
  await page.waitForFunction(() => !document.querySelector('.lookup-results[aria-busy="true"]'));
  await fit(page); assert.ok((await page.locator('.lookup .chip').count())>0);
  await page.screenshot({path:'evidence/appearance/translation-940.png'});
  console.log('empty query'); await input.fill(''); await page.getByRole('button',{name:'Consultar',exact:true}).click();
  await page.getByText('Digite uma palavra ou trecho para consultar.',{exact:true}).waitFor();
  assert.equal(await page.locator('.lookup .chip').count(),0);
  await page.keyboard.press('Escape');
  await page.setViewportSize({width:1500,height:950});
  console.log('context selection'); const span = page.locator('.page-sheet .textLayer span').filter({hasText:'casa grande'}).first(); const box = await span.boundingBox(); assert.ok(box);
  await page.mouse.dblclick(box.x+12,box.y+box.height/2);
  const selected = await page.evaluate(() => window.getSelection()?.toString()); assert.ok(selected?.trim());
  await page.mouse.click(box.x+12,box.y+box.height/2,{button:'right'});
  await page.locator('.context-menu button').filter({hasText:'Sinônimos'}).click();
  await page.waitForSelector('.lookup .chip'); await fit(page);
  await page.locator('.lookup .chip').first().click();
  await page.waitForFunction(() => !!document.querySelector('.lookup-footer [role="status"]')?.textContent?.includes('Copiado:'));
  console.log('restart'); await close();
  page = await launch(profile);
  await page.waitForFunction(() => document.documentElement.dataset.palette === 'dark-ocean');
  assert.equal(await page.getByRole('dialog',{name:'Seu espaço, suas cores'}).count(),0);
  await close();
  const legacy = join(root,'legacy'); await mkdir(legacy);
  const original = {theme:'dark',signatures:[],ai:{provider:'gemini',model:'kept-model',baseUrl:'https://generativelanguage.googleapis.com/v1beta'},keys:{},quickActions:false,updates:{frequency:'never'},seenVersion:'0.7.1'};
  await writeFile(join(legacy,'preferences.json'),JSON.stringify(original));
  page = await launch(legacy);
  await page.waitForFunction(() => document.documentElement.dataset.theme === 'dark');
  assert.equal(await page.getByRole('dialog',{name:'Seu espaço, suas cores'}).count(),0);
  await page.evaluate(() => window.gcp.setTheme('light-sand'));
  const saved = JSON.parse(await readFile(join(legacy,'preferences.json'),'utf8'));
  assert.equal(saved.theme,'light-sand'); assert.equal(saved.ai.model,'kept-model'); assert.equal(saved.quickActions,false); assert.equal(saved.updates.frequency,'never');
  const backup = JSON.parse(await readFile(join(legacy,'preferences.json.before-0.8.0'),'utf8')); assert.equal(backup.theme,'dark');
  await assert.rejects(page.evaluate(() => window.gcp.setTheme('invalid-theme')));
  assert.deepEqual(errors,[]);
  console.log('OK: six palettes, first run, persistence, legacy migration/backup, review + selected text, empty query, clipboard and responsive single-scroll lookup');
} finally {if(app) {await (await app.firstWindow()).screenshot({path:'evidence/appearance/last.png'}).catch(()=>{}); await close();}}
