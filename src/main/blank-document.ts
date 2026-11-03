import {PDFDocument} from 'pdf-lib';
import {PAPER_SIZES,blankOptions} from '../shared/scanner';
export async function createDocument(raw?:unknown){
 const o=blankOptions(raw),size=PAPER_SIZES[o.paper].map(mm=>mm*72/25.4) as [number,number];
 if(o.landscape)size.reverse();
 const pdf=await PDFDocument.create();pdf.setCreator('GCP-PDF');pdf.setProducer('GCP-PDF');
 for(let n=0;n<o.pages;n++)pdf.addPage(size);
 return pdf.save();
}
