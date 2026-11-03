import test from 'node:test';
import assert from 'node:assert/strict';
import {writeFile,access} from 'node:fs/promises';
import {join} from 'node:path';
import {PDFDocument} from 'pdf-lib';
import {createCanvas} from '@napi-rs/canvas';
import {Scanner,saneDevices,saneSources,saneArguments} from '../src/main/scanner';
import {createDocument} from '../src/main/blank-document';
import {scanOptions,blankOptions,type ScanOptions} from '../src/shared/scanner';
import {DocumentStore} from '../src/main/store';
const options:ScanOptions={device:'usb:001',source:'Flatbed',dpi:300,color:'color',paper:'A4',nativeUi:false,ocr:true};
function fixture(scan?:(args:string[],signal?:AbortSignal)=>Promise<string>){
 const canvas=createCanvas(100,150);canvas.getContext('2d').fillRect(10,10,20,20);const png=canvas.toBuffer('image/png');
 const folders:string[]=[];
 const scanner=new Scanner('', 'linux',async(_file,args,signal)=>{
  if(args.includes('--formatted-device-list'))return 'usb:001\tVendor scanner\n';
  if(args.includes('--help'))return '  --source Flatbed|ADF Duplex [Flatbed]\n';
  const folder=args.find(a=>a.startsWith('--batch='))!.slice(8).replace(/[/\\]page-%04d.png$/,'');folders.push(folder);
  if(scan)return scan(args,signal);
  await writeFile(join(folder,'page-0001.png'),png);if(args.includes('--batch-count=2'))await writeFile(join(folder,'page-0002.png'),png);return '';
 });return {scanner,folders,png};
}
test('blank PDF preserves requested size, orientation and count; rejects invalid boundaries',async()=>{
 const pdf=await PDFDocument.load(await createDocument({paper:'Carta',landscape:true,pages:3}));assert.equal(pdf.getPageCount(),3);assert.ok(Math.abs(pdf.getPage(0).getWidth()-792)<0.01);assert.ok(Math.abs(pdf.getPage(0).getHeight()-612)<0.01);
 for(const pages of [0,501,1.5,NaN])assert.throws(()=>blankOptions({paper:'A4',landscape:false,pages}));assert.throws(()=>scanOptions({...options,dpi:2400}));
 assert.equal((await PDFDocument.load(await createDocument())).getPageCount(),1);
});
test('SANE inventory and source parsing preserve USB device identity and source names',()=>{
 assert.deepEqual(saneDevices('escl:https://host:443/eSCL/\tHP Scan\n'),[{id:'escl:https://host:443/eSCL/',name:'HP Scan'}]);
 assert.deepEqual(saneSources('  --source Flatbed|Automatic Document Feeder(left aligned,Duplex) [Flatbed]\n'),['Flatbed','Automatic Document Feeder(left aligned,Duplex)']);
 assert.ok(saneArguments(options,'/tmp/test').includes('usb:001'));assert.ok(saneArguments(options,'/tmp/test').includes('--batch-count=1'));
});
test('real acquisition processing retains OCR failures, preview, ownership, ordering and insert undo',async()=>{
 const {scanner,folders}=fixture();
 try{
  const pages=await scanner.acquire(1,{...options,source:'ADF Duplex'},async()=>{throw new Error('OCR indisponível');});assert.equal(pages.length,2);assert.match(pages[0]!.warning!,/imagem preservada/);assert.match(pages[0]!.preview,/^data:image\/jpeg;base64,/);
  await assert.rejects(scanner.pdf(2,[{id:pages[0]!.id,rotation:0}]),/inválida/);
  const bytes=await scanner.pdf(1,[{id:pages[1]!.id,rotation:90},{id:pages[0]!.id,rotation:0}]);const pdf=await PDFDocument.load(bytes);assert.equal(pdf.getPage(0).getRotation().angle,90);
  const store=new DocumentStore(),id=await store.blank();await store.insertFile(id,bytes,1,0);assert.equal(store.info(id).pageCount,3);await store.undo(id);assert.equal(store.info(id).pageCount,1);
  scanner.remove(1,pages[0]!.id);assert.equal(scanner.list(1).length,1);
  await assert.rejects(scanner.pdf(1,[{id:pages[0]!.id,rotation:0}]),/inválida/);
  for(const folder of folders)await assert.rejects(access(folder));
 }finally{await scanner.clear(1);}
});
test('global scan exclusivity, cancellation, cross-window cleanup and finalization wait',async()=>{
 let entered!:()=>void,release!:()=>void;const started=new Promise<void>(r=>entered=r),gate=new Promise<void>(r=>release=r);
 const {scanner,folders,png}=fixture(async(args,signal)=>{entered();await gate;const folder=args.find(a=>a.startsWith('--batch='))!.slice(8).replace(/[/\\]page-%04d.png$/,'');await access(folder);await writeFile(join(folder,'page-0001.png'),png);if(signal?.aborted)throw new Error('canceled');return '';});
 const job=scanner.acquire(1,options,async bytes=>bytes);await started;
 assert.throws(()=>scanner.acquire(2,options,async bytes=>bytes),/andamento/);await scanner.clear(2);await access(folders[0]!);
 const clearing=scanner.clear(1);release();await job;await clearing;assert.deepEqual(scanner.list(1),[]);await assert.rejects(access(folders[0]!));
});
test('driver errors after a completed page keep the page with a partial-acquisition warning',async()=>{
 let png:Buffer;const f=fixture(async args=>{const folder=args.find(a=>a.startsWith('--batch='))!.slice(8).replace(/[/\\]page-%04d.png$/,'');await writeFile(join(folder,'page-0001.png'),png);throw new Error('paper jam');});png=f.png;
 try{const pages=await f.scanner.acquire(1,{...options,ocr:false},async bytes=>bytes);assert.equal(pages.length,1);assert.match(pages[0]!.warning!,/paper jam/);}finally{await f.scanner.clear(1);}
});
