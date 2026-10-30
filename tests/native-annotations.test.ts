import test from 'node:test';
import assert from 'node:assert/strict';
import {PDFDocument, PDFName, PDFDict, PDFHexString} from 'pdf-lib';
import {DocumentStore} from '../src/main/store';
import {readAnnotations} from '../src/main/pdf-annotations';
import {pdfjs,renderPdfPage} from '../src/main/conversion';

async function fixture() {
 const pdf=await PDFDocument.create();
 pdf.addPage([300,400]);const page=pdf.addPage([300,400]);page.setCropBox(10,20,250,350);
 const mark=pdf.context.register(pdf.context.obj({Type:'Annot',Subtype:'Highlight',Rect:[30,300,180,330],QuadPoints:[30,330,180,330,30,300,180,300],C:[1,1,0],NM:PDFHexString.fromText('repeated'),Contents:PDFHexString.fromText('Comentário externo'),T:PDFHexString.fromText('Revisor')}));
 const popup=pdf.context.register(pdf.context.obj({Type:'Annot',Subtype:'Popup',Rect:[180,200,260,330],Parent:mark}));
 pdf.context.lookup(mark,PDFDict).set(PDFName.of('Popup'),popup);
 page.node.addAnnot(mark);page.node.addAnnot(popup);
 page.node.addAnnot(pdf.context.register(pdf.context.obj({Type:'Annot',Subtype:'Text',Rect:[40,220,62,242],IRT:mark,Contents:PDFHexString.fromText('Resposta')})));
 page.node.addAnnot(pdf.context.register(pdf.context.obj({Type:'Annot',Subtype:'Highlight',Rect:[40,150,160,170],NM:PDFHexString.fromText('repeated'),C:[1,0,0]})));
 page.node.addAnnot(pdf.context.register(pdf.context.obj({Type:'Annot',Subtype:'Link',Rect:[0,0,20,20],A:{S:'URI',URI:PDFHexString.fromText('https://example.org')}})));
 return pdf.save();
}

test('external annotations have source identity and crop-relative geometry, including highlights without comments',async()=>{
 const store=new DocumentStore(),id=await store.add(await fixture(),'externo.pdf');
 const info=store.info(id);assert.equal(info.annotations.length,3);
 assert.deepEqual(info.annotations[0]?.rect,{x:20,y:40,width:150,height:30});
 assert.equal(info.annotations[0]?.page,info.pages[1]?.id);
 assert.equal(info.annotations[0]?.text,'Comentário externo');
 assert.equal(info.annotations[2]?.index,3);
});

test('deleting a highlight removes its popup and replies, survives save/reopen and supports undo/redo',async()=>{
 const original=await fixture(),store=new DocumentStore(),id=await store.add(original,'externo.pdf','externo.pdf');
 const initial=store.info(id),page=initial.pages[1]!.id;
 await store.apply(id,{type:'delete-annotation',page,index:0},initial.revision);
 const output=await store.materialize(id),pdf=await PDFDocument.load(output);
 assert.equal(pdf.getPage(1).node.Annots()?.size(),2);
 const remaining=readAnnotations(pdf)[1]!;assert.equal(remaining.length,1);assert.equal(remaining[0]?.text,'');
 const reopened=new DocumentStore(),next=await reopened.add(output,'copia.pdf');assert.equal(reopened.info(next).annotations.length,1);
 await store.undo(id);assert.deepEqual(await store.materialize(id),original);
 await store.redo(id);assert.equal(store.info(id).annotations.length,1);
});

test('deletion affects only the selected page instance and rejects non-annotation indices',async()=>{
 const store=new DocumentStore(),id=await store.add(await fixture(),'externo.pdf');
 const before=store.info(id);
 await assert.rejects(store.apply(id,{type:'delete-annotation',page:before.pages[1]!.id,index:4},before.revision),/disponível/);
 assert.equal(store.info(id).revision,before.revision);
 await store.insertFile(id,await fixture(),2,before.revision);
 const info=store.info(id);
 await store.apply(id,{type:'delete-annotation',page:info.pages[1]!.id,index:3},info.revision);
 assert.equal(store.info(id).annotations.filter(a=>a.page===info.pages[3]!.id).length,3);
 assert.equal(store.info(id).annotations.filter(a=>a.page===info.pages[1]!.id).length,2);
});

test('deleting an annotation preserves the single-source catalog, metadata, bookmarks and form fields',async()=>{
 const source=await PDFDocument.load(await fixture());source.setTitle('Projeto cultural — revisão');source.setAuthor('Equipe de revisão');
 const field=source.getForm().createTextField('Projeto');field.setText('Cultura');field.addToPage(source.getPage(0),{x:30,y:30,width:120,height:24});
 const outline=source.context.register(source.context.obj({Type:'Outlines',Count:1}));
 const item=source.context.register(source.context.obj({Title:PDFHexString.fromText('Segunda página'),Parent:outline,Dest:[source.getPage(1).ref,'Fit']}));
 source.context.lookup(outline,PDFDict).set(PDFName.of('First'),item);source.context.lookup(outline,PDFDict).set(PDFName.of('Last'),item);source.catalog.set(PDFName.of('Outlines'),outline);
 const original=await source.save(),store=new DocumentStore(),id=await store.add(original,'projeto.pdf'),before=store.info(id);
 await store.apply(id,{type:'delete-annotation',page:before.pages[1]!.id,index:0},before.revision);
 const saved=await PDFDocument.load(await store.materialize(id));
 assert.equal(saved.getTitle(),'Projeto cultural — revisão');assert.equal(saved.getAuthor(),'Equipe de revisão');
 assert.equal(saved.getForm().getTextField('Projeto').getText(),'Cultura');assert.ok(saved.catalog.get(PDFName.of('Outlines')));
 assert.equal(new Set(store.info(id).pages.map(p=>p.base)).size,1);
});

test('GCP markups and drawings remain native annotations in independent PDF.js after save/reopen',async()=>{
 const store=new DocumentStore(),id=await store.blank(),page=store.info(id).pages[0]!.id;
 const objects:any[]=[
  ...['highlight','underline','strike'].map((style,i)=>({id:style,page,kind:'markup',style,rects:[{x:30,y:40+i*35,width:180,height:20},{x:30,y:62+i*35,width:70,height:10}],color:'#ffcc00',opacity:.5})),
  {id:'ink',page,kind:'ink',points:[{x:30,y:180},{x:80,y:200},{x:130,y:180}],stroke:'#ff0000',strokeWidth:2,opacity:1},
  {id:'distance',page,kind:'shape',shape:'dimension',measure:'distance',x:40,y:450,width:180,height:0,points:[{x:40,y:450},{x:220,y:450}],stroke:'#0000ff',fill:null,strokeWidth:1,opacity:1},
  ...['rect','ellipse','line','arrow','polygon','polyline','cloud','check','cross'].map((shape,i)=>({id:shape,page,kind:'shape',shape,x:30+i*65,y:250,width:50,height:40,stroke:'#0000ff',fill:null,strokeWidth:2,opacity:1,...(['polygon','polyline'].includes(shape)?{points:[{x:30+i*65,y:250},{x:55+i*65,y:290},{x:80+i*65,y:250}]}:{})})),
 ];
 await store.apply(id,{type:'add-objects',objects},store.info(id).revision);
 const bytes=await store.materialize(id),engine=await pdfjs(),task=engine.getDocument({data:new Uint8Array(bytes)}),pdf=await task.promise;
 try{const annotations=await (await pdf.getPage(1)).getAnnotations();assert.deepEqual(annotations.map(a=>a.subtype),['Highlight','Underline','StrikeOut','Ink','Stamp','Square','Circle','Line','Line','Polygon','PolyLine','Stamp','Stamp','Stamp']);assert.equal(annotations[0].quadPoints.length,16);}finally{await task.destroy();}
 assert.ok((await renderPdfPage(bytes,0,72)).bytes.length>1000);
 const reopened=new DocumentStore(),next=await reopened.add(bytes,'anotado.pdf');assert.equal(reopened.info(next).annotations.length,14);
 // Saving an added comment must not strip native GCP markups from the source.
 const target=reopened.info(next).pages[0]!.id;
 await reopened.apply(next,{type:'add-object',object:{kind:'note',id:'note',page:target,x:300,y:30,width:22,height:22,text:'Persistente',author:'Teste',createdAt:new Date().toISOString(),color:'#ffff00'}},reopened.info(next).revision);
 assert.equal(readAnnotations(await PDFDocument.load(await reopened.materialize(next)))[0]!.length,14);
});
