import test from 'node:test';
import assert from 'node:assert/strict';
import {PDFDocument,PDFDict,PDFName,PDFArray,PDFString} from 'pdf-lib';
import {formFields,pruneTypelessFields} from '../src/main/acroform';
import {DocumentStore} from '../src/main/store';
import {userMessage,GENERIC_ERROR} from '../src/shared/errors';

/** A form as left by combining files: a real text field plus empty, untyped "Doc1" (with a child) and "Doc4". */
async function combinedForm() {
 const doc=await PDFDocument.create(),page=doc.addPage([300,300]);
 doc.getForm().createTextField('Nome').addToPage(page,{x:20,y:200,width:200,height:24});
 doc.getForm().getTextField('Nome').setText('Bruno');
 const fields=doc.catalog.lookup(PDFName.of('AcroForm'),PDFDict).lookup(PDFName.of('Fields'),PDFArray);
 const child=doc.context.obj({T:PDFString.of('Doc1'),Kids:[]}),childRef=doc.context.register(child);
 const parent=doc.context.register(doc.context.obj({T:PDFString.of('Doc1'),Kids:[childRef]}));child.set(PDFName.of('Parent'),parent);
 fields.push(parent);fields.push(doc.context.register(doc.context.obj({T:PDFString.of('Doc4'),Kids:[]})));
 return doc.save({updateFieldAppearances:false});
}

test('untyped empty fields left by combining files do not stop the document from opening',async()=>{
 const bytes=await combinedForm();
 const raw=await PDFDocument.load(bytes);
 assert.throws(()=>raw.getForm().getFields(),/Expected instance of PDFName/);
 const store=new DocumentStore(async()=>undefined);
 await store.addBase(bytes);
 const doc=await PDFDocument.load(bytes);
 assert.equal(pruneTypelessFields(doc),3);
 assert.deepEqual(formFields(doc).map(f=>f.getName()),['Nome']);
 const again=await PDFDocument.load(await doc.save());
 assert.equal(again.getForm().getTextField('Nome').getText(),'Bruno');
 assert.equal(pruneTypelessFields(again),0);
});

test('technical library and system messages reach the user in Portuguese',()=>{
 assert.equal(userMessage('Expected instance of PDFName, but got instance of undefined'),GENERIC_ERROR);
 assert.equal(userMessage("Cannot read properties of undefined (reading 'length')"),GENERIC_ERROR);
 assert.match(userMessage("ENOENT: no such file or directory, open 'C:\\x.pdf'"),/não foi encontrado/);
 assert.match(userMessage('EBUSY: resource busy or locked'),/outro programa/);
 assert.equal(userMessage('O PDF não contém páginas.'),'O PDF não contém páginas.');
 assert.equal(userMessage('Senha incorreta.'),'Senha incorreta.');
});
