import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync} from 'node:fs';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {PDFDocument,StandardFonts} from 'pdf-lib';
import {PdfCraftSession} from '../src/main/pdfcraft-session';
import {DocumentStore} from '../src/main/store';
import {signatureList,signatureSummary,validateNewSignature,refusesSignedOverwrite,sameFilePath} from '../src/main/signatures';

const executable=path.resolve('assets/pdfcraft',process.platform==='win32'?'pdfcraft-cli.exe':'pdfcraft-cli');
async function blank(){const pdf=await PDFDocument.create(),font=await pdf.embedFont(StandardFonts.Helvetica);pdf.addPage([600,800]).drawText('Texto original',{x:40,y:700,font,size:16});return pdf.save();}
test('unknown algorithms never imply cryptographic integrity and modified copies are explicit',()=>{
 assert.doesNotMatch(signatureSummary({status:'unknown',details:['Unsupported signature algorithm']}).explanation,/passou na verificação criptográfica/);
 const modified=signatureSummary({status:'valid'},true);assert.equal(modified.status,'modified');assert.match(modified.explanation,/cópia atual/);
 assert.match(signatureSummary({status:'invalid',details:['No valid byte range']}).explanation,/intervalos de bytes/);
});

test('new signature is checked from final bytes and source protection survives source edits and replacement',{skip:!existsSync(executable),timeout:60000},async()=>{
 const engine=new PdfCraftSession(()=>executable),folder=await mkdtemp(path.join(tmpdir(),'gcp-signature-test-'));
 try{
  const signed=await engine.onCopy(await blank(),async({doc,output,call})=>{
   await call('sign_id_create',{name:'GCP-PDF Teste temporário',password:'teste-local-12345',path:'teste.p12',years:1,key:'p256'});
   const before=await call('sign_list',{doc});
   return {before,produced:await call('sign_document',{doc,id:'teste.p12',password:'teste-local-12345',out:output})};
  });
  assert.ok(signed.bytes);const bytes=signed.bytes!,snapshot=new Uint8Array(bytes);
  const checked=await engine.onCopy(bytes,async({doc,call})=>call('sign_list',{doc}));
  const result=await validateNewSignature(bytes,signed.result.before,checked.result,signed.result.produced);
  assert.ok(result.field);assert.deepEqual(bytes,snapshot,'validation cannot rewrite signed output');
  const previous={field:'Assinatura anterior',status:'invalid'};
  assert.equal((await validateNewSignature(bytes,{signatures:[previous]},{signatures:[previous,...signatureList(checked.result)]},signed.result.produced)).field,result.field,'a pre-existing invalid signature cannot mask the new signature');
  await assert.rejects(validateNewSignature(bytes,signed.result.before,{signatures:[{field:result.field,status:'invalid'}]},signed.result.produced),/não passou/);
  await assert.rejects(validateNewSignature(bytes,signed.result.before,{signatures:[]},signed.result.produced),/identificar/);
  const tampered=new Uint8Array(bytes);tampered[7]=tampered[7]===0x37?0x36:0x37;
  const invalid=await engine.onCopy(tampered,async({doc,call})=>call('sign_list',{doc}));
  assert.equal(signatureList(invalid.result)[0]?.status,'invalid','altering a covered header byte breaks real cryptography');
  await assert.rejects(validateNewSignature(tampered,signed.result.before,invalid.result,signed.result.produced),/não passou/);
  const original=path.join(folder,'original.pdf'),copy=path.join(folder,'copia.pdf');await writeFile(original,bytes);
  const store=new DocumentStore(),id=await store.add(bytes,'original.pdf',original);
  assert.ok(store.signed(id));assert.deepEqual(await store.materialize(id),bytes);
  const base=store.info(id).pages[0]!.base,paragraphs=await engine.objects(base,()=>store.base(base),0);
  assert.equal(paragraphs.paragraphs[0]?.text,'Texto original');
  const edited=await engine.editParagraph(base,()=>store.base(base),0,{paragraph:paragraphs.paragraphs[0]!.index,text:'Texto editado'});
  await store.swapBase(id,base,edited,0);
  assert.ok(store.unchanged(id),'current base equality does not mean the original on disk is unchanged');
  assert.ok(store.signed(id));assert.equal(store.signedSourcePath(id),original);assert.notEqual(store.get(id).revision,store.get(id).savedRevision);
  await assert.rejects(refusesSignedOverwrite(store.signedSourcePath(id),original,true),/não pode ser sobrescrito/);
  assert.ok(await sameFilePath(original,path.join(folder,'.','original.pdf')));
  await refusesSignedOverwrite(original,copy,true);
  await store.apply(id,{type:'rotate',pages:[0],degrees:90},store.get(id).revision);
  assert.ok(store.signed(id));
  await store.replaceDocument(id,await blank(),store.get(id).revision);
  assert.ok(store.signed(id),'replacing every page cannot erase origin protection');
  assert.equal(store.signedSourcePath(id),original);
 }finally{await engine.dispose();await rm(folder,{recursive:true,force:true});}
});
