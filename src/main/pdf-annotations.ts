import {PDFDocument, PDFDict, PDFName, PDFArray, PDFNumber, PDFString, PDFHexString} from 'pdf-lib';
import type {PdfAnnotation} from '../shared/types';

const text = (dict: PDFDict, key: string) => {
 const value = dict.lookup(PDFName.of(key));
 return value instanceof PDFString || value instanceof PDFHexString ? value.decodeText() : '';
};
const excluded = new Set(['Widget', 'Link', 'Popup']);
/** Line boxes of a text markup from its QuadPoints (groups of 8 numbers), so its words can be quoted. */
function quadsOf(dict: PDFDict, box: {x: number; y: number; height: number}): {quads?: PdfAnnotation['rect'][]} {
 const values = dict.lookupMaybe(PDFName.of('QuadPoints'), PDFArray)?.asArray().map(v => v instanceof PDFNumber ? v.asNumber() : NaN) ?? [];
 if (!values.length || values.length % 8 || !values.every(Number.isFinite)) return {};
 const quads: PdfAnnotation['rect'][] = [];
 for (let i = 0; i < values.length; i += 8) {
  const xs = [values[i]!, values[i + 2]!, values[i + 4]!, values[i + 6]!], ys = [values[i + 1]!, values[i + 3]!, values[i + 5]!, values[i + 7]!];
  quads.push({x: Math.min(...xs) - box.x, y: box.y + box.height - Math.max(...ys), width: Math.max(...xs) - Math.min(...xs), height: Math.max(...ys) - Math.min(...ys)});
 }
 return {quads};
}
/** Source array positions identify annotations even when /NM is absent or repeated. */
export function readAnnotations(doc: PDFDocument): Omit<PdfAnnotation, 'page'>[][] {
 return doc.getPages().map(page => {
  const result: Omit<PdfAnnotation, 'page'>[] = [], annots = page.node.Annots(), box = page.getCropBox();
  for (let index = 0; index < (annots?.size() ?? 0); index++) {
   const dict = doc.context.lookup(annots!.get(index));
   if (!(dict instanceof PDFDict)) continue;
   const subtype = dict.get(PDFName.of('Subtype'))?.toString().slice(1) ?? '';
   if ((!subtype || excluded.has(subtype)) || /^GCP-PDF:(note|reply):/.test(text(dict, 'NM'))) continue;
   const rect = dict.lookupMaybe(PDFName.of('Rect'), PDFArray);
   if (!rect || rect.size() !== 4) continue;
   const coords = rect.asArray().map(v => v instanceof PDFNumber ? v.asNumber() : NaN);
   if (!coords.every(Number.isFinite)) continue;
   const [x1, y1, x2, y2] = coords as [number, number, number, number];
   result.push({index, subtype, author: text(dict, 'T'), text: text(dict, 'Contents'), rect: {x: Math.min(x1, x2) - box.x, y: box.y + box.height - Math.max(y1, y2), width: Math.abs(x2 - x1), height: Math.abs(y2 - y1)}, ...quadsOf(dict, box)});
  }
  return result;
 });
}

/** Delete only the chosen annotation and its popup/reply descendants; preserve unrelated dictionaries. */
export async function deleteAnnotation(bytes: Uint8Array, pageIndex: number, index: number) {
 const doc = await PDFDocument.load(bytes, {updateMetadata: false});
 if (!readAnnotations(doc)[pageIndex]?.some(a => a.index === index)) throw new Error('Esta anotação não está mais disponível.');
 const annots = doc.getPage(pageIndex).node.Annots()!;
 const removed = new Set([annots.get(index)]);
 let changed = true;
 while (changed) {
  changed = false;
  for (const entry of annots.asArray()) {
   const dict = doc.context.lookup(entry);
   if (!(dict instanceof PDFDict)) continue;
   if (removed.has(entry)) {
    const popup = dict.get(PDFName.of('Popup'));
    if (popup && !removed.has(popup)) { removed.add(popup); changed = true; }
   } else if (['IRT', 'Parent'].some(key => { const parent = dict.get(PDFName.of(key)); return parent && removed.has(parent); })) {
    removed.add(entry); changed = true;
   }
  }
 }
 for (let i = annots.size() - 1; i >= 0; i--) if (removed.has(annots.get(i))) annots.remove(i);
 return doc.save();
}
