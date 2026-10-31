import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {PDFDocument,PDFName,PDFDict,PDFArray} from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import JSZip from 'jszip';
import {convertPdf} from '../src/main/conversion';
import {embeddedFaces} from '../src/main/embedded-fonts';
import {spacesIn} from '../src/main/word-layout';
import {ocrRuns,type OcrLine} from '../src/main/ocr-layout';
import {fontFamilies} from '../src/main/fonts';

/** A PDF whose font program is complete but whose name is hidden, as Word's "Microsoft Print to PDF" writes. */
async function anonymized() {
  const doc=await PDFDocument.create();doc.registerFontkit(fontkit);
  const font=await doc.embedFont(readFileSync('assets/Inter-Regular.ttf'),{subset:false});
  doc.addPage([300,200]).drawText('Texto com fonte escondida  [    ]  fim',{x:20,y:150,size:12,font});
  const bytes=await doc.save(),hidden=await PDFDocument.load(bytes);
  for(const [,object] of hidden.context.enumerateIndirectObjects())if(object instanceof PDFDict&&object.get(PDFName.of('Type'))?.toString()==='/Font'){
    object.set(PDFName.of('BaseFont'),PDFName.of('CIDFont+F1'));
    const descendant=object.lookupMaybe(PDFName.of('DescendantFonts'),PDFArray)?.lookup(0,PDFDict);descendant?.set(PDFName.of('BaseFont'),PDFName.of('CIDFont+F1'));
    descendant?.lookupMaybe(PDFName.of('FontDescriptor'),PDFDict)?.set(PDFName.of('FontName'),PDFName.of('CIDFont+F1'));
  }
  return hidden.save();
}

test('the real family of a font whose PDF name is hidden is read from its embedded program',async()=>{
  const faces=await embeddedFaces(await anonymized()),face=faces.get('CIDFont+F1');
  assert.ok(face,'the anonymized font is described');
  assert.equal(face.family,'Inter');assert.equal(face.bold,false);assert.equal(face.italic,false);assert.equal(face.complete,true);
});

test('Word export uses the recovered family and carries it when this computer lacks it',async()=>{
  const result=await convertPdf(await anonymized(),{format:'docx',mode:'editable'});
  const zip=await JSZip.loadAsync(result.bytes),xml=await zip.file('word/document.xml')!.async('string');
  assert.match(xml,/w:ascii="Inter"/,'runs name the recovered family, not a generic substitute');
  const installed=(await fontFamilies()).some(f=>f.toLowerCase()==='inter');
  if(!installed)assert.ok(Object.keys(zip.files).some(f=>/^word\/fonts\/.+\.odttf$/.test(f)),'the font travels inside the document');
  const text=[...xml.matchAll(/<w:t[^>]*>([^<]*)<\/w:t>/g)].map(m=>m[1]).join('');
  assert.match(text,/\[ {3,6}\]/,'blank form brackets keep (about) their spaces');
});

test('a gap several spaces wide keeps that many spaces; a stretched word gap stays one',()=>{
  assert.equal(spacesIn(7.2,2.1),3);
  assert.equal(spacesIn(2.9,2.1),1);
  assert.equal(spacesIn(4.0,2.1),1);
});

test('OCR text gets the family and size its widths imply, bold from stroke weight, and drops artwork',()=>{
  // Each family has its own letter widths (em): the scanned words were set in "Estreita" at 10 pt.
  const em:Record<string,Record<string,number>>={Estreita:{a:0.5,l:0.25,r:0.35,o:0.55,t:0.3,s:0.45},Larga:{a:0.6,l:0.6,r:0.6,o:0.6,t:0.6,s:0.6}};
  const width=(text:string,family:string,size:number,bold=false)=>[...text.toLowerCase()].reduce((w,c)=>w+(em[family]![c]??0.5),0)*size*(bold?1.05:1);
  const word=(text:string,x:number,confidence=95,heavy=false)=>({text,x,y:100,width:width(text,'Estreita',10,heavy),height:10,confidence,baseline:108,heavy});
  const body=(y:number):OcrLine=>({rowHeight:10,height:11,words:[word('rotas',20),word('altos',60),word('salta',100),word('lotas',140,95,y===1)]});
  const lines:OcrLine[]=[body(0),body(1),
    {rowHeight:10,height:40,words:[word('LOGOTIPO',20)]},
    {rowHeight:10,height:11,words:[word('|',5),word('incerta',20,20),word('Não',60)]}];
  const measure={stroke:(box:any)=>(box.heavy?3:2),width};
  const {runs,family}=ocrRuns(lines.map(l=>({...l,words:l.words})) as OcrLine[],measure,['Larga','Estreita']);
  assert.equal(family,'Estreita');
  assert.ok(runs.every(r=>r.size===10),'one size per line, the body size');
  assert.ok(!runs.some(r=>r.text==='LOGOTIPO'),'a line box far taller than its row is artwork');
  assert.ok(!runs.some(r=>r.text==='|'||r.text==='incerta'),'rules and unsure words stay in the picture');
  assert.deepEqual(runs.filter(r=>r.bold).map(r=>r.text),['lotas']);
});
