import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,readdir,rm} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {execFileSync} from 'node:child_process';
import {DOMParser} from '@xmldom/xmldom';
import {desktopFiles,installUnixIntegration,thunarActions,shellQuote,type DesktopOptions} from '../src/main/desktop-integration';
test('desktop integration preserves unrelated Thunar actions, is idempotent, backs up changes and removes only owned entries',async()=>{
 const root=await mkdtemp(join(tmpdir(),'gcp-desktop-'));
 const options:DesktopOptions={platform:'linux',home:root,data:join(root,'data'),config:join(root,'config'),launcher:'/opt/GCP-PDF/gcp-pdf',icon:resolve('assets/icon.png')};
 try{
  await mkdir(join(root,'config/Thunar'),{recursive:true});const thunar=join(root,'config/Thunar/uca.xml');
  const original='<actions><action><unique-id>user-1</unique-id><name>Minha ação</name><command>custom %F</command></action></actions>';
  await writeFile(thunar,original);await installUnixIntegration(options,true);
  const first=await readFile(thunar,'utf8');await installUnixIntegration(options,true);assert.equal(await readFile(thunar,'utf8'),first);
  assert.equal(new DOMParser().parseFromString(first,'text/xml').getElementsByTagName('action').length,3);
  assert.ok((await readdir(join(root,'data/gcp-pdf/integration-backups'))).length>0);
  await installUnixIntegration(options,false);const remaining=await readFile(thunar,'utf8');assert.match(remaining,/Minha ação/);assert.doesNotMatch(remaining,/Managed by GCP-PDF/);
  assert.match(await readFile(join(root,'data/applications/gcp-pdf.desktop'),'utf8'),/Categories=Office;/);
  const broken='<actions><action>';await writeFile(thunar,broken);await assert.rejects(thunarActions(options,true),/XML inválido/);assert.equal(await readFile(thunar,'utf8'),broken);
 }finally{await rm(root,{recursive:true,force:true});}
});
test('Unix quick-action script passes selected paths literally, including spaces, apostrophes and shell metacharacters',{skip:process.platform==='win32'},async()=>{
 const root=await mkdtemp(join(tmpdir(),'gcp-action-'));
 try{
  const record=join(root,'arguments'),launcher=join(root,"GCP d'água $app");
  await writeFile(launcher,`#!/bin/sh\nprintf '%s\\0' "$GCP_PDF_DATA_DIR" "$@" > ${shellQuote(record)}\n`,{mode:0o755});
  const profile=join(root,"Perfil d'água $app");
  const options:DesktopOptions={platform:'linux',home:root,data:join(root,'data'),config:join(root,'config'),launcher,profile,icon:resolve('assets/icon.png')};
  await installUnixIntegration(options,true);
  const selected=[join(root,"Orçamento d'água.pdf"),join(root,'$(never-run); space.pdf')];
  execFileSync(join(root,'data/nautilus/scripts/GCP-PDF/Combinar em um PDF'),selected);
  assert.deepEqual((await readFile(record,'utf8')).split('\0').filter(Boolean),[profile,'--quick-combine',...selected]);
  assert.equal(desktopFiles(options).filter(file=>file.path.endsWith('.nemo_action')).length,2);
 }finally{await rm(root,{recursive:true,force:true});}
});
test('macOS Quick Actions are valid property lists scoped to Finder and invoke the installed app',()=>{
 const files=desktopFiles({platform:'darwin',home:'/Users/test',data:'/Users/test/data',config:'/Users/test/config',launcher:"/Applications/GCP d'água.app/Contents/MacOS/GCP-PDF",profile:"/Users/test/Perfil d'água",icon:'icon.png'});
 assert.equal(files.length,4);
 for(const file of files){const errors:string[]=[];const parsed=new DOMParser({onError:(level:string,text:string)=>{if(level!=='warning')errors.push(text);}} as never).parseFromString(file.content,'text/xml');assert.deepEqual(errors,[]);assert.equal(parsed.documentElement?.tagName,'plist');assert.match(file.content,/com.apple.finder/);}
});
