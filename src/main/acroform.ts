import {PDFArray, PDFDict, PDFDocument, PDFName} from 'pdf-lib';

/** Unlinks form fields that have no type (/FT, which the PDF format requires) anywhere up their chain,
 * such as the empty "Doc1" nodes some tools leave behind when combining files. Other readers skip
 * them; pdf-lib stops on them and the whole document would not open. A parent left without fields
 * and without a type goes too. Widgets on the pages are not touched. Returns how many were removed. */
export function pruneTypelessFields(doc: PDFDocument): number {
 const fields = doc.catalog.lookupMaybe(PDFName.of('AcroForm'), PDFDict)?.lookupMaybe(PDFName.of('Fields'), PDFArray);
 if (!fields) return 0;
 let removed = 0;
 const isField = (value: unknown) => value instanceof PDFDict && value.has(PDFName.of('T'));
 /** Cleans one Fields or Kids array, deepest fields first. */
 const clean = (list: PDFArray, inherited: boolean, seen: Set<PDFDict>): void => {
  for (let index = list.size() - 1; index >= 0; index--) {
   const dict = list.lookup(index);
   if (!(dict instanceof PDFDict)) { list.remove(index); removed++; continue; }
   if (seen.has(dict)) continue;
   seen.add(dict);
   const typed = inherited || dict.has(PDFName.of('FT')), kids = dict.lookupMaybe(PDFName.of('Kids'), PDFArray);
   if (kids && kids.asArray().some(kid => isField(doc.context.lookup(kid)))) clean(kids, typed, seen);
   // Terminal (no child fields) and untyped: pdf-lib cannot classify it.
   if (!typed && !(kids && kids.asArray().some(kid => isField(doc.context.lookup(kid))))) { list.remove(index); removed++; }
  }
 };
 clean(fields, false, new Set());
 return removed;
}

/** The form fields as pdf-lib reads them, after removing the untyped leftovers it cannot read. */
export function formFields(doc: PDFDocument) {
 pruneTypelessFields(doc);
 return doc.getForm().getFields();
}
