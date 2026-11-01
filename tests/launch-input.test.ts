import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {resolve,join,dirname} from 'node:path';
import {tmpdir} from 'node:os';
import {pathToFileURL} from 'node:url';
import {PDFDocument} from 'pdf-lib';
import {launchPaths,hasPdfHeader} from '../src/main/launch-input';
import {readInputDocument,readInputPdf} from '../src/main/system';

test('launch input owns URL decoding, relative working directories and development arguments',()=>{
 const cwd=resolve('pasta de documentos'),file=join(cwd,'Prestação #100% d’água.pdf');
 assert.deepEqual(launchPaths(['app',pathToFileURL(file).href,file],cwd),[file]);
 assert.deepEqual(launchPaths(['electron',resolve('.'),'--no-sandbox','arquivo.pdf'],cwd,resolve('.')),[join(cwd,'arquivo.pdf')]);
 assert.deepEqual(launchPaths(['electron','--inspect=0','--remote-debugging-port=0',resolve('.'),'arquivo.pdf'],cwd,resolve('.')),[join(cwd,'arquivo.pdf')]);
 assert.deepEqual(launchPaths(['app','--','-assinatura.pdf'],cwd),[join(cwd,'-assinatura.pdf')]);
 assert.throws(()=>launchPaths(['app','https://example.com/file.pdf'],cwd),/drive montado/);
 assert.throws(()=>launchPaths(['app',pathToFileURL(file).href+'?download=1'],cwd),/parâmetros/);
 assert.throws(()=>launchPaths(['app','file:///%ZZ.pdf'],cwd));
});

test('a Drive-style filename without an extension opens as original PDF, never as Office conversion',async()=>{
 const root=await mkdtemp(join(tmpdir(),'gcp-drive-pdf-'));
 try{
  const pdf=await PDFDocument.create();pdf.addPage();const bytes=await pdf.save();
  const path=join(root,'1GVFS-file-id-without-extension');await writeFile(path,bytes);
  assert.ok(await hasPdfHeader(path));
  const loaded=await readInputDocument(path,async()=>{throw new Error('Must not convert an original PDF');});
  assert.equal(loaded.sourcePdf,true);assert.deepEqual(loaded.bytes,bytes);
  assert.equal((await PDFDocument.load(await readInputPdf(path))).getPageCount(),1);
  await writeFile(join(root,'other'),'not a PDF');assert.equal(await hasPdfHeader(join(root,'other')),false);await assert.rejects(readInputDocument(join(root,'other')),/formato suportado/);
  await assert.rejects(hasPdfHeader(join(root,'missing')),/ENOENT/);
 }finally{assert.equal(dirname(root),resolve(tmpdir()));await rm(root,{recursive:true,force:true});}
});
