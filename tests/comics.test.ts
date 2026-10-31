import test from 'node:test';
import assert from 'node:assert/strict';
import {zipSync} from 'fflate';
import {ArchiveReader,libarchiveWasm} from 'libarchive-wasm';
import {readComic} from '../src/main/comics';

const PNG=Uint8Array.from(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==','base64'));
// RAR samples from the libarchive test suite (BSD-2-Clause): test_read_format_rar.rar (RAR 4) and
// test_read_format_rar5_stored.rar (RAR 5). They hold text files, not pages.
const RAR4='UmFyIRoHAM+QcwAADQAAAAAAAACEUnQgkDIAFAAAABQAAAADQqLIvrd22j4UMAgApIEAAHRlc3QudHh0gAi3dto+t3baPnRlc3QgdGV4dCBkb2N1bWVudA0KnS90IJAyAAgAAAAIAAAAA3tEybbRTNg+FDAIAP+hAAB0ZXN0bGlua8AI0UzYPlBf2j50ZXN0LnR4dM3gdCCQOgAUAAAAFAAAAANCosi+Y3faPhQwEACkgQAAdGVzdGRpclx0ZXN0LnR4dMDMY3faPmN32j50ZXN0IHRleHQgZG9jdW1lbnQNCqHIdOCQMQAAAAAAAAAAAAMAAAAAY3faPhQwBwDtQQAAdGVzdGRpcsDMY3faPmR32j7m53TgkDYAAAAAAAAAAAADAAAAAJ2r1T4UMAwA7UEAAHRlc3RlbXB0eWRpcoDMnavVPsVd2j7EPXsAQAcA';
const RAR5='UmFyIRoHAQAzkrXlCgEFBgAFAQGAgAA4MAZjLAIDC50ABJ0ApIMCtEOglYAAAQ5oZWxsb3dvcmxkLnR4dAoDE34Oq1tW6Q4aaGVsbG8gbGliYXJjaGl2ZSB0ZXN0IHN1aXRlIQodd1ZRAwUEAA==';

test('CBZ pages come in natural reading order, without hidden files or other formats',async()=>{
 const zip=zipSync({'Volume 1/pagina 10.png':PNG,'Volume 1/pagina 2.jpg':PNG,'Volume 1/pagina 1.png':PNG,'__MACOSX/Volume 1/._pagina 1.png':PNG,'Volume 1/.oculta.png':PNG,'Volume 1/info.txt':new TextEncoder().encode('créditos')});
 const comic=await readComic(zip,'Minha_HQ.cbz');
 assert.deepEqual(comic.names,['Volume 1/pagina 1.png','Volume 1/pagina 2.jpg','Volume 1/pagina 10.png']);
 assert.deepEqual(comic.pages.map(p=>p.type),['image/png','image/jpeg','image/png']);
 assert.deepEqual([...comic.pages[0]!.data],[...PNG]);
 assert.equal(comic.title,'Minha HQ');
 assert.equal((await readComic(zip,'Minha_HQ.cbz')).id,comic.id);
});

test('RAR 4 and RAR 5 archives are read by the same path; an archive without pages explains itself',async()=>{
 const mod=await libarchiveWasm();
 for(const [sample,file,text] of [[RAR4,'test.txt','test text document\r\n'],[RAR5,'helloworld.txt','hello libarchive test suite!\n']] as const){
  const reader=new ArchiveReader(mod,new Int8Array(Buffer.from(sample,'base64')));
  // Entries are valid only while iterating: read each one in turn.
  const entries:{name:string;data:string}[]=[];for(const e of reader.entries())entries.push({name:e.getPathname(),data:new TextDecoder().decode(e.readData()??new Int8Array())});reader.free();
  assert.equal(entries.find(e=>e.name===file)?.data,text);
  await assert.rejects(readComic(Uint8Array.from(Buffer.from(sample,'base64')),'texto.cbr'),/não tem páginas de imagem/);
 }
});
