import { _electron as electron } from 'playwright-core';
import {createRequire} from 'node:module';import {resolve} from 'node:path';
/** Form fields: typing masks (CPF, data, moeda) and visible checkbox/radio state. Usage: node scripts/smoke-masks.mjs [form.pdf] */
const require=createRequire(import.meta.url);const file=resolve(process.argv[2]??'.cache/mcp/form-test.pdf');
const env={...process.env,GCP_PDF_TEST_MODE:'1',GCP_PDF_DATA_DIR:resolve('.cache/e2e-profile')};delete env.ELECTRON_RUN_AS_NODE;
const app=await electron.launch({executablePath:require('electron'),args:[resolve('.')],cwd:resolve('.'),env,timeout:90000});
const check=(label,ok,detail='')=>console.log(ok?'✔':'✖',label,detail);
try{const page=await app.firstWindow();await page.waitForFunction(()=>!!window.gcp);await page.evaluate(()=>localStorage.removeItem('gcp.last-page'));
 await page.evaluate(p=>window.gcp.openFiles([p]),file);await page.waitForSelector('.form-layer input[type=checkbox]',{timeout:30000});await page.waitForTimeout(600);
 const field=n=>page.locator(`.form-layer input[name="${n}"], .form-layer [data-element-id] input`).filter({has:page.locator('xpath=self::*')});
 const inputs=page.locator('.form-layer input[type=text]');
 const typeIn=async(i,text)=>{const el=inputs.nth(i);await el.click();await el.fill('');await el.pressSequentially(text,{delay:15});return el.inputValue();};
 const names=await page.evaluate(()=>[...document.querySelectorAll('.form-layer input[type=text]')].map(i=>i.closest('[data-annotation-id]')?.getAttribute('data-annotation-id')||i.name));
 const values=[];for(let i=0;i<3;i++)values.push(await typeIn(i,['12345678901','25122026','123456'][i]));
 check('máscaras ao digitar (CPF, data, moeda)',values.includes('123.456.789-01')&&values.includes('25/12/2026')&&values.some(v=>/R\$\s?1\.234,56/.test(v)),values.join(' | '));
 const cb=page.locator('.form-layer input[type=checkbox]').first();await cb.click();await page.waitForTimeout(700);
 const cbStyle=await page.locator('.form-layer input[type=checkbox]').first().evaluate(i=>[i.checked,getComputedStyle(i).backgroundColor]);
 check('caixa de seleção marca e mostra a marca',cbStyle[0]&&cbStyle[1]!=='rgba(255, 255, 255, 0.85)',cbStyle.join(' '));
 await page.locator('.form-layer input[type=radio]').nth(1).click();await page.waitForTimeout(700);
 const radios=await page.locator('.form-layer input[type=radio]').evaluateAll(l=>l.map(i=>i.checked));
 check('opção marca só a escolhida',radios[1]===true&&radios[0]===false,JSON.stringify(radios));
 await page.waitForTimeout(800);const fields=(await page.evaluate(()=>window.gcp.getWorkspace())).documents[0].fields;check('valores gravados no documento',fields.Aceito===true&&fields.Opcao==='Nao',JSON.stringify(fields));
 await page.locator('.form-layer').first().screenshot({path:'evidence/ui/61-formulario-mascaras.png'}).catch(()=>{});
}finally{await app.evaluate(()=>{for(const v of globalThis.__gcpTest.views.values())v.allowClose=true;}).catch(()=>{});await app.close();}
