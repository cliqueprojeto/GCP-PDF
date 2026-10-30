import { _electron as electron } from 'playwright-core';
import {createRequire} from 'node:module';import {resolve} from 'node:path';
/** Form push buttons: link asks before opening, reset clears, print opens the dialog, image field picks a picture;
 * properties set a button's action. Usage: node scripts/smoke-buttons.mjs [form.pdf] */
const require=createRequire(import.meta.url);const file=resolve(process.argv[2]??'.cache/mcp/form-test2.pdf');
const env={...process.env,GCP_PDF_TEST_MODE:'1',GCP_PDF_DATA_DIR:resolve('.cache/e2e-profile')};delete env.ELECTRON_RUN_AS_NODE;
const app=await electron.launch({executablePath:require('electron'),args:[resolve('.')],cwd:resolve('.'),env,timeout:90000});
const check=(label,ok,detail='')=>console.log(ok?'✔':'✖',label,detail);
try{const page=await app.firstWindow();await page.waitForFunction(()=>!!window.gcp);await page.evaluate(()=>localStorage.removeItem('gcp.last-page'));
 await app.evaluate(({dialog},img)=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:[img]});},resolve('assets/icon.png'));
 await page.evaluate(p=>window.gcp.openFiles([p]),file);await page.waitForSelector('.button-layer .form-button',{timeout:30000});
 const ws=async()=>(await page.evaluate(()=>window.gcp.getWorkspace())).documents[0];
 check('botões e campo de imagem clicáveis',(await page.locator('.button-layer .form-button').count())===4);
 await page.locator('.form-layer input[type=checkbox]').first().click();await page.waitForTimeout(700);
 await page.locator('.form-button[title="Limpa o formulário"]').click();await page.waitForTimeout(700);
 check('botão Limpar limpa o formulário',(await ws()).fields.Aceito===false,JSON.stringify((await ws()).fields));
 await page.locator('.form-button[title^="Abre "]').click();await page.waitForSelector('.prompt-card');
 check('botão de link pede confirmação antes de abrir',/gestaoculturalpro/.test(await page.locator('.prompt-card').textContent()));
 await page.locator('.prompt-card button',{hasText:'Cancelar'}).click();
 await page.locator('.form-button[title="Imprime o documento"]').click();await page.waitForSelector('.print-dialog',{timeout:10000}).catch(()=>{});
 check('botão Imprimir abre a impressão',await page.locator('.print-dialog').count()===1);await page.keyboard.press('Escape');await page.locator('.modal-footer .button.secondary').click().catch(()=>{});
 const rev=(await ws()).revision;await page.locator('.form-button.image').click({timeout:5000}).catch(e=>console.log('CLICK',e.message.slice(0,200)));for(let i=0;i<40&&(await ws()).revision<=rev;i++)await page.waitForTimeout(300);
 check('campo de imagem recebe a imagem escolhida',(await ws()).revision>rev,await page.locator('.toast').textContent().catch(()=>''));
 // Properties: give the image field's neighbour a page action, then it navigates.
 const r2=(await ws()).revision;const err=await page.evaluate(async()=>{const d=(await window.gcp.getWorkspace()).documents[0];try{await window.gcp.setFormFieldProps(d.id,d.pages[0].id,'Site',{action:{type:'url',url:'https://exemplo.com.br/'},caption:'Novo link'});return '';}catch(e){return String(e);}});
 for(let i=0;i<30&&(await ws()).revision<=r2;i++)await page.waitForTimeout(300);await page.waitForTimeout(1500);
 check('propriedades definem a ação do botão',!err&&(await page.locator('.form-button[title="Abre https://exemplo.com.br/"]').count())===1,err);
 await page.screenshot({path:'evidence/ui/65-botoes-formulario.png'});
}finally{await app.evaluate(()=>{for(const v of globalThis.__gcpTest.views.values())v.allowClose=true;}).catch(()=>{});await app.close();}
