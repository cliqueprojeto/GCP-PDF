import { PDFDocument, PDFName, PDFDict, PDFArray, PDFRef, PDFRawStream, PDFStream, ParseSpeeds, type PDFContext, type PDFObject } from 'pdf-lib';
import { loadPdf } from './conversion';
import type { DocumentMetadata, DocumentStats } from '../shared/types';

/** Metadata as stored in the PDF's Info dictionary (the fields Acrobat shows under Properties > Description). */
export async function readMetadata(bytes: Uint8Array): Promise<DocumentMetadata & { version: string; encrypted: boolean }> {
  const doc = await PDFDocument.load(bytes, { updateMetadata: false, ignoreEncryption: true, parseSpeed: ParseSpeeds.Fastest });
  const date = (value: Date | undefined) => (value && !Number.isNaN(value.getTime()) ? value.toISOString() : undefined);
  const version = /%PDF-(\d\.\d)/.exec(Buffer.from(bytes.subarray(0, 1024)).toString('latin1'))?.[1] ?? '';
  return { title: doc.getTitle() ?? '', author: doc.getAuthor() ?? '', subject: doc.getSubject() ?? '', keywords: doc.getKeywords() ?? '', creator: doc.getCreator() ?? '', producer: doc.getProducer() ?? '', created: date(doc.getCreationDate()), modified: date(doc.getModificationDate()), version, encrypted: doc.isEncrypted };
}

/** Bytes of the objects a page needs, split by kind; shared objects count once per page that uses them. */
function pageWeight(context: PDFContext, page: PDFDict) {
  const seen = new Set<string>(), weight = { content: 0, images: 0, fonts: 0, imageCount: 0 };
  const size = (value: PDFObject | undefined) => { const target = value instanceof PDFRef ? context.lookup(value) : value; return target instanceof PDFRawStream ? target.contents.length : target instanceof PDFStream ? (target as unknown as { getContentsSize?: () => number }).getContentsSize?.() ?? 0 : 0; };
  const once = (value: PDFObject | undefined) => { if (!(value instanceof PDFRef)) return true; const key = value.toString(); if (seen.has(key)) return false; seen.add(key); return true; };
  const contents = page.get(PDFName.of('Contents'));
  for (const part of contents instanceof PDFArray ? contents.asArray() : [contents]) if (once(part)) weight.content += size(part);
  const walk = (resources: PDFDict | undefined, depth: number) => {
    if (!resources || depth > 8) return;
    const xobjects = resources.lookupMaybe(PDFName.of('XObject'), PDFDict);
    for (const [, ref] of xobjects?.entries() ?? []) {
      if (!once(ref)) continue;
      const target = ref instanceof PDFRef ? context.lookup(ref) : ref;
      if (!(target instanceof PDFRawStream)) continue;
      if (target.dict.get(PDFName.of('Subtype'))?.toString() === '/Image') { weight.images += target.contents.length; weight.imageCount++; const mask = target.dict.get(PDFName.of('SMask')); if (once(mask)) weight.images += size(mask); }
      else { weight.content += target.contents.length; walk(target.dict.lookupMaybe(PDFName.of('Resources'), PDFDict), depth + 1); }
    }
    const fonts = resources.lookupMaybe(PDFName.of('Font'), PDFDict);
    for (const [, ref] of fonts?.entries() ?? []) {
      if (!once(ref)) continue;
      const font = ref instanceof PDFRef ? context.lookup(ref) : ref;
      if (!(font instanceof PDFDict)) continue;
      const descendants = font.lookupMaybe(PDFName.of('DescendantFonts'), PDFArray)?.asArray() ?? [];
      for (const item of [font, ...descendants.map((d) => (d instanceof PDFRef ? context.lookup(d) : d))]) {
        const descriptor = item instanceof PDFDict ? item.lookupMaybe(PDFName.of('FontDescriptor'), PDFDict) : undefined;
        for (const key of ['FontFile', 'FontFile2', 'FontFile3']) { const file = descriptor?.get(PDFName.of(key)); if (file && once(file)) weight.fonts += size(file); }
      }
    }
  };
  walk(page.lookupMaybe(PDFName.of('Resources'), PDFDict), 0);
  return weight;
}

/** Counts (words, characters) and what weighs most in the file, page by page. */
export async function documentStats(bytes: Uint8Array, onProgress?: (done: number, total: number) => void): Promise<DocumentStats> {
  const [pdf, doc] = await Promise.all([loadPdf(bytes), PDFDocument.load(bytes, { updateMetadata: false, ignoreEncryption: true, parseSpeed: ParseSpeeds.Fastest })]);
  try {
    const pages: DocumentStats['pages'] = [];
    let words = 0, characters = 0, charactersNoSpaces = 0, lines = 0, annotations = 0;
    const nodes = doc.getPages();
    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i), content = await page.getTextContent();
      const text = content.items.map((item) => ('str' in item ? item.str + (item.hasEOL ? '\n' : '') : '')).join('');
      const pageWords = (text.match(/[\p{L}\p{N}][\p{L}\p{N}'’\-.,]*/gu) ?? []).length;
      words += pageWords; characters += text.replace(/\n/g, '').length; charactersNoSpaces += text.replace(/\s/g, '').length; lines += text.split('\n').filter((l) => l.trim()).length;
      annotations += (await page.getAnnotations()).length;
      const view = page.getViewport({ scale: 1 }), weight = nodes[i - 1] ? pageWeight(doc.context, nodes[i - 1]!.node) : { content: 0, images: 0, fonts: 0, imageCount: 0 };
      pages.push({ page: i, words: pageWords, width: view.width, height: view.height, ...weight, total: weight.content + weight.images + weight.fonts });
      page.cleanup(); onProgress?.(i, pdf.numPages);
    }
    const fontNames = new Set<string>();
    for (const page of nodes) {
      const dict = page.node.lookupMaybe(PDFName.of('Resources'), PDFDict)?.lookupMaybe(PDFName.of('Font'), PDFDict);
      for (const [, ref] of dict?.entries() ?? []) { const font = ref instanceof PDFRef ? doc.context.lookup(ref) : ref; const name = font instanceof PDFDict ? font.get(PDFName.of('BaseFont'))?.toString().replace(/^\/([A-Z]{6}\+)?/, '') : ''; if (name) fontNames.add(name.replace(/#20/g, ' ')); }
    }
    return { size: bytes.length, pageCount: pdf.numPages, words, characters, charactersNoSpaces, lines, annotations, images: pages.reduce((n, p) => n + p.imageCount, 0), fonts: [...fontNames].sort(), pages };
  } finally { await pdf.loadingTask.destroy(); }
}

/** Lines set clearly larger than the body text, as bookmark candidates: page index, top (points) and size level. */
export async function headings(bytes: Uint8Array, onProgress?: (done: number, total: number) => void) {
  const pdf = await loadPdf(bytes);
  try {
    const lines: { page: number; top: number; size: number; text: string; bold: boolean }[] = [], sizes = new Map<number, number>();
    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i), view = page.getViewport({ scale: 1 }), content = await page.getTextContent();
      const rows = new Map<number, { size: number; text: string; top: number; bold: boolean }>();
      for (const item of content.items) {
        if (!('str' in item) || !item.str.trim()) continue;
        const [, , c, d, , f] = item.transform as number[], size = Math.round(Math.hypot(c!, d!) * 2) / 2, top = view.height - f! - size;
        sizes.set(size, (sizes.get(size) ?? 0) + item.str.length);
        const key = Math.round(top / 3), row = rows.get(key), bold = /bold|black|heavy|semibold/i.test((content.styles[item.fontName] as { fontFamily?: string })?.fontFamily ?? '') || /bold|black|heavy/i.test(item.fontName);
        if (row && Math.abs(row.size - size) < 0.6) row.text += (row.text.endsWith(' ') ? '' : ' ') + item.str; else if (!row) rows.set(key, { size, text: item.str, top, bold });
      }
      for (const row of rows.values()) lines.push({ page: i - 1, ...row, text: row.text.replace(/\s+/g, ' ').trim() });
      page.cleanup(); onProgress?.(i, pdf.numPages);
    }
    const body = [...sizes].sort((a, b) => b[1] - a[1])[0]?.[0] ?? 10;
    // Titles: notably larger than the body, short, not page furniture repeated on most pages.
    // A title repeated on several pages (running header, section title on every page) is kept once, at its first page.
    const seen = new Set<string>();
    const picked = lines.filter((l) => { if (l.size < body * 1.3 || l.text.length < 3 || l.text.length > 90 || !/[\p{L}]/u.test(l.text)) return false; const key = l.text.toLowerCase(); if (seen.has(key)) return false; seen.add(key); return true; });
    const levels = [...new Set(picked.map((l) => l.size))].sort((a, b) => b - a).slice(0, 3);
    return picked.filter((l) => levels.includes(l.size)).sort((a, b) => a.page - b.page || a.top - b.top).slice(0, 2000).map((l) => ({ page: l.page, top: Math.max(0, Math.round(l.top - 6)), level: l.size, title: l.text.length > 80 ? l.text.slice(0, 77) + '…' : l.text }));
  } finally { await pdf.loadingTask.destroy(); }
}
