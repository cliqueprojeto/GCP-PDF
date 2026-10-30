import { PDFDocument, PDFDict, PDFName, PDFString, PDFHexString, PDFRawStream, PDFArray, PDFRef, ParseSpeeds, decodePDFRawStream } from 'pdf-lib';
import type { FieldFormat } from '../shared/types';

/** Image fields are push buttons whose click imports an icon (Acrobat: buttonImportIcon) or that show only an icon. */
export async function imageFields(bytes: Uint8Array): Promise<string[]> {
  const doc = await PDFDocument.load(bytes, { updateMetadata: false, ignoreEncryption: true, parseSpeed: ParseSpeeds.Fastest });
  let fields: ReturnType<ReturnType<PDFDocument['getForm']>['getFields']>;
  try { fields = doc.getForm().getFields(); } catch { return []; }
  const text = (v: unknown): string => { const t = v instanceof PDFRef ? doc.context.lookup(v) : v; if (t instanceof PDFDict) return text(t.get(PDFName.of('JS'))) + text(t.get(PDFName.of('U'))); if (t instanceof PDFString || t instanceof PDFHexString) return t.decodeText(); if (t instanceof PDFRawStream) return Buffer.from(decodePDFRawStream(t).decode()).toString('latin1'); return ''; };
  return fields.filter((f) => { const d = f.acroField.dict; if (d.get(PDFName.of('FT'))?.toString() !== '/Btn') return false; const tp = d.lookupMaybe(PDFName.of('MK'), PDFDict)?.get(PDFName.of('TP'))?.toString(); return tp === '1' || /buttonImportIcon/.test(text(d.get(PDFName.of('A'))) + text(d.lookupMaybe(PDFName.of('AA'), PDFDict)?.get(PDFName.of('U')))); }).map((f) => f.getName());
}
/** Reads each form field's Acrobat keystroke/format script (AA /K or /F) and turns the standard
 * AF* calls into an input mask the editor applies while typing (scripts themselves never run). */
export async function fieldFormats(bytes: Uint8Array): Promise<Record<string, FieldFormat>> {
  const doc = await PDFDocument.load(bytes, { updateMetadata: false, ignoreEncryption: true, parseSpeed: ParseSpeeds.Fastest });
  const out: Record<string, FieldFormat> = {};
  let fields: ReturnType<ReturnType<PDFDocument['getForm']>['getFields']>;
  try { fields = doc.getForm().getFields(); } catch { return out; }
  const script = (value: unknown): string => {
    const target = value instanceof PDFRef ? doc.context.lookup(value) : value;
    if (target instanceof PDFDict) return script(target.get(PDFName.of('JS')));
    if (target instanceof PDFString || target instanceof PDFHexString) return target.decodeText();
    if (target instanceof PDFRawStream) return Buffer.from(decodePDFRawStream(target).decode()).toString('latin1');
    return '';
  };
  for (const field of fields) {
    const dicts = [field.acroField.dict, ...(field.acroField.dict.lookupMaybe(PDFName.of('Kids'), PDFArray)?.asArray().map((k) => doc.context.lookup(k)).filter((d): d is PDFDict => d instanceof PDFDict) ?? [])];
    const js = dicts.map((d) => { const aa = d.lookupMaybe(PDFName.of('AA'), PDFDict); return aa ? script(aa.get(PDFName.of('K'))) + '\n' + script(aa.get(PDFName.of('F'))) : ''; }).join('\n');
    const format = parse(js);
    if (format) out[field.getName()] = format;
  }
  return out;
}
function parse(js: string): FieldFormat | null {
  let m = /AFSpecial_KeystrokeEx\(\s*["']([^"']+)["']/.exec(js);
  if (m) return { kind: 'mask', mask: m[1]! };
  m = /AFDate_(?:Keystroke|Format)Ex\(\s*["']([^"']+)["']/.exec(js);
  if (m) return { kind: 'date', mask: m[1]! };
  m = /AFNumber_(?:Keystroke|Format)\(\s*(\d+)\s*,\s*(\d+)\s*,\s*\d+\s*,\s*\d+\s*,\s*["']([^"']*)["']/.exec(js);
  if (m) return { kind: 'number', decimals: Number(m[1]), separator: Number(m[2]), currency: m[3]! };
  m = /AFPercent_(?:Keystroke|Format)\(\s*(\d+)/.exec(js);
  if (m) return { kind: 'percent', decimals: Number(m[1]) };
  m = /AFSpecial_(?:Keystroke|Format)\(\s*(\d)/.exec(js);
  if (m) return { kind: 'mask', mask: ['99999', '99999-9999', '(99) 99999-9999', '999-99-9999'][Number(m[1])] ?? '' };
  return null;
}
