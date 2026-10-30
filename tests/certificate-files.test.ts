import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,readFile,readdir,rm,mkdir} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {CertificateFiles} from '../src/main/certificate-files';
test('certificate references belong to their window; copies are removed on success and failure without modifying the source',async()=>{
 const root=await mkdtemp(join(tmpdir(),'gcp-cert-files-'));
 try{
  const source=join(root,"Titular d'água.pfx"),privateRoot=join(root,'engine');await mkdir(privateRoot);await writeFile(source,'encrypted-identity');
  const files=new CertificateFiles(),identity=await files.select(1,source);
  assert.match(identity.id,/^file:/);assert.ok(!identity.id.includes(source));
  await assert.rejects(files.use(2,identity.id,privateRoot,async()=>{}),/nesta janela/);
  assert.equal(await files.use(1,identity.id,privateRoot,async name=>String(await readFile(join(privateRoot,name)))),'encrypted-identity');
  assert.deepEqual(await readdir(privateRoot),[]);
  await assert.rejects(files.use(1,identity.id,privateRoot,async()=>{throw new Error('senha inválida');}),/senha inválida/);
  assert.deepEqual(await readdir(privateRoot),[]);assert.equal(String(await readFile(source)),'encrypted-identity');
  const next=await files.select(1,source);await assert.rejects(files.use(1,identity.id,privateRoot,async()=>{}),/novamente/);
  files.forget(1);await assert.rejects(files.use(1,next.id,privateRoot,async()=>{}),/novamente/);
  const invalid=join(root,'bad.pem');await writeFile(invalid,'x');await assert.rejects(files.select(1,invalid),/\.pfx/);
 }finally{await rm(root,{recursive:true,force:true});}
});
