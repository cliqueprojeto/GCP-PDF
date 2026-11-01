import {createCanvas,loadImage} from '@napi-rs/canvas';
import {writeFile,mkdir} from 'node:fs/promises';
import {join} from 'node:path';
import assert from 'node:assert/strict';

/** Shared real UI regression, used in the source and each installed package's smoke test. */
export async function signatureImportChecks(app,page,root,label='source') {
 const locale=await page.evaluate(()=>window.gcp.getLanguage());
 await page.evaluate(()=>window.gcp.setLanguage('pt-BR','pt-BR'));
 await page.locator('.ribbon-tabs button').filter({hasText:'Assinar'}).click();
 await page.locator('.tool-button').filter({hasText:'Minhas assinaturas'}).click();
 const fixture=(transparent)=>{const image=createCanvas(600,220),ctx=image.getContext('2d');if(!transparent){ctx.fillStyle='#f5ebd7';ctx.fillRect(0,0,600,220);ctx.fillStyle='#e6dcc8';ctx.fillRect(300,110,60,3);}ctx.strokeStyle='#142b8d';ctx.lineWidth=5;ctx.lineCap='round';ctx.beginPath();ctx.moveTo(90,140);ctx.bezierCurveTo(120,15,155,200,200,100);ctx.bezierCurveTo(250,20,280,180,325,100);ctx.bezierCurveTo(380,45,420,155,490,90);ctx.stroke();return image;};
 const opaque=join(root,'assinatura-papel.jpg'),clear=join(root,'assinatura-alpha.png'),transparent=fixture(true).toBuffer('image/png');
 await writeFile(opaque,fixture(false).toBuffer('image/jpeg'));await writeFile(clear,transparent);
 const open=async file=>{
  await page.getByRole('button',{name:'Nova assinatura',exact:true}).click();
  const dialog=page.getByRole('dialog',{name:'Nova assinatura',exact:true});
  await dialog.getByRole('button',{name:'Enviar imagem',exact:true}).click();
  await app.evaluate(({dialog},file)=>{globalThis.__signatureOpenDialog??=dialog.showOpenDialog;dialog.showOpenDialog=async()=>({canceled:false,filePaths:[file]});},file);
  await dialog.getByRole('button',{name:'Escolher imagem PNG ou JPEG',exact:true}).click();
  await dialog.getByRole('button',{name:'Salvar assinatura',exact:true}).waitFor();
  await page.waitForFunction(()=>!document.querySelector('.modal .modal-footer .button.primary')?.disabled);
  return dialog;
 };
 const pixels=()=>page.locator('.signature-image-frame canvas').evaluate(canvas=>{const bytes=canvas.getContext('2d').getImageData(0,0,canvas.width,canvas.height).data;let transparent=0,ink=0;for(let at=3;at<bytes.length;at+=4){if(bytes[at]===0)transparent++;if(bytes[at]===255&&bytes[at-3]<100)ink++;}return {transparent,ink,width:canvas.width,height:canvas.height};});
 try{
  let dialog=await open(opaque);
  assert.ok(await dialog.getByRole('checkbox',{name:'Remover fundo',exact:true}).isChecked());
  assert.ok((await pixels()).transparent>0);assert.ok((await pixels()).ink>0);
  await dialog.getByRole('slider',{name:/Intensidade/}).fill('0');await page.waitForFunction(()=>!document.querySelector('.modal-footer .button.primary')?.disabled);const low=await pixels();
  await dialog.getByRole('slider',{name:/Intensidade/}).fill('100');await page.waitForFunction(()=>!document.querySelector('.modal-footer .button.primary')?.disabled);assert.ok((await pixels()).transparent>=low.transparent);
  await dialog.getByRole('checkbox',{name:'Remover fundo',exact:true}).uncheck();await page.waitForFunction(()=>!document.querySelector('.modal-footer .button.primary')?.disabled);assert.equal((await pixels()).transparent,0);
  await dialog.getByRole('checkbox',{name:'Remover fundo',exact:true}).check();await dialog.getByRole('slider',{name:/Intensidade/}).fill('35');await page.waitForFunction(()=>!document.querySelector('.modal-footer .button.primary')?.disabled);
  await dialog.getByRole('button',{name:'Recortar margens',exact:true}).click();await page.waitForFunction(()=>!document.querySelector('.modal-footer .button.primary')?.disabled);
  const trimmed=await pixels();assert.ok(trimmed.width<600&&trimmed.height<220);
  await dialog.getByRole('textbox',{name:'Nome da assinatura',exact:true}).fill('Importada do papel');
  await mkdir('evidence/signature-import',{recursive:true});await page.screenshot({path:`evidence/signature-import/${label}-opaque.png`});
  await dialog.getByRole('button',{name:'Salvar assinatura',exact:true}).click();await dialog.waitFor({state:'detached'});
  let saved=(await page.evaluate(()=>window.gcp.getSignatures())).find(item=>item.name==='Importada do papel');assert.ok(saved?.dataUrl.startsWith('data:image/png;base64,'));
  const png=await loadImage(Buffer.from(saved.dataUrl.split(',')[1],'base64'));assert.ok(png.width<600&&png.height<220);
  dialog=await open(clear);assert.ok((await dialog.getByRole('status').innerText()).includes('Transparência detectada'));assert.equal(await dialog.getByRole('checkbox',{name:'Remover fundo',exact:true}).count(),0);
  await dialog.getByRole('textbox',{name:'Nome da assinatura',exact:true}).fill('Transparência preservada');
  await page.screenshot({path:`evidence/signature-import/${label}-alpha.png`});
  await dialog.getByRole('button',{name:'Salvar assinatura',exact:true}).click();await dialog.waitFor({state:'detached'});
  saved=(await page.evaluate(()=>window.gcp.getSignatures())).find(item=>item.name==='Transparência preservada');assert.equal(saved.dataUrl,'data:image/png;base64,'+transparent.toString('base64'));
  dialog=await open(clear);await dialog.getByRole('button',{name:'Recorte manual',exact:true}).click();
  const area=await dialog.locator('canvas').boundingBox();assert.ok(area);await page.waitForTimeout(120);
  await page.mouse.move(area.x+area.width*.1,area.y+area.height*.1);await page.mouse.down();await page.mouse.move(area.x+area.width*.9,area.y+area.height*.9,{steps:8});await page.mouse.up();
  await page.waitForFunction(()=>!document.querySelector('.modal-footer .button.primary')?.disabled);
  assert.ok((await pixels()).width<600);assert.ok((await pixels()).ink>0);
  await dialog.getByRole('button',{name:'Desfazer recorte',exact:true}).click();await page.waitForFunction(()=>!document.querySelector('.modal-footer .button.primary')?.disabled);assert.equal((await pixels()).width,600);
  await dialog.getByRole('button',{name:'Recorte manual',exact:true}).click();await page.waitForTimeout(120);
  const blank=await dialog.locator('canvas').boundingBox();await page.mouse.move(blank.x+1,blank.y+1);await page.mouse.down();await page.mouse.move(blank.x+blank.width*.05,blank.y+blank.height*.05,{steps:4});await page.mouse.up();
  await dialog.getByText('A prévia ficou vazia. Reduza a intensidade ou preserve o fundo.',{exact:true}).waitFor();assert.ok(await dialog.getByRole('button',{name:'Salvar assinatura',exact:true}).isDisabled());
  await dialog.getByRole('button',{name:'Desfazer recorte',exact:true}).click();await page.waitForFunction(()=>!document.querySelector('.modal-footer .button.primary')?.disabled);
  await page.keyboard.press('Escape');
  return 'JPEG opaco → PNG transparente; intensidade/fundo/prévia/recorte; PNG com alpha preservado byte a byte; biblioteca salva';
 }finally{
  await app.evaluate(({dialog})=>{if(globalThis.__signatureOpenDialog){dialog.showOpenDialog=globalThis.__signatureOpenDialog;delete globalThis.__signatureOpenDialog;}});
  await page.evaluate(({language,ocr})=>window.gcp.setLanguage(language,ocr),locale);
 }
}
