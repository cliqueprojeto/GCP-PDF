import { readFile } from 'node:fs/promises';
import path from 'node:path';
import fontkit from '@pdf-lib/fontkit';
import { PDFDocument, PDFName, PDFDict, PDFArray, PDFHexString, PDFString, PDFNumber, PDFTextField, PDFCheckBox, PDFRadioGroup, PDFDropdown, PDFOptionList, degrees, rgb, type PDFPage, type PDFFont, LineCapStyle, ParseSpeeds, StandardFonts, BlendMode } from 'pdf-lib';
import type { PageObject, PageRef } from '../shared/types';
import {measureLabel,  inkPath, shapePath } from '../shared/geometry';

/** Page-structure edits used by the engine tests and by materialization. */
export type PdfOperation =
 | {type:'rotate';pages:number[];degrees:number}
 | {type:'delete';pages:number[]}
 | {type:'blank';index:number}
 | {type:'reorder';order:number[]}
 | {type:'text';page:number;x:number;y:number;text:string;size:number;color:string}
 | {type:'image';page:number;x:number;y:number;width:number;height:number;dataUrl:string}
 | {type:'highlight';page:number;x:number;y:number;width:number;height:number;color:string}
 | {type:'draw';page:number;points:{x:number;y:number}[];color:string;width:number};

/** Page selections and insertion positions are zero based. Drawing units are PDF points,
 * measured from the top-left corner of the rotated, visible crop box. */
async function load(bytes: Uint8Array): Promise<PDFDocument> {
  if (!(bytes instanceof Uint8Array) || bytes.length === 0) throw new Error('O arquivo PDF está vazio.');
  try { return await PDFDocument.load(bytes, { updateMetadata: false, parseSpeed: ParseSpeeds.Fastest }); }
  catch (cause) { throw new Error('Não foi possível abrir o PDF. Verifique se o arquivo é válido e não está protegido por senha.', { cause }); }
}
function finite(value: number, name: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error(`${name} precisa ser um número válido.`);
  return value;
}
function positive(value: number, name: string): number {
  finite(value, name); if (value <= 0) throw new Error(`${name} precisa ser maior que zero.`); return value;
}
function position(value: number, count: number): number {
  if (!Number.isInteger(value) || value < 0 || value > count) throw new Error('A posição de inserção está fora do documento.');
  return value;
}
function selected(pages: number[], count: number): number[] {
  if (!Array.isArray(pages) || pages.length === 0) throw new Error('Selecione pelo menos uma página.');
  if (new Set(pages).size !== pages.length) throw new Error('A seleção contém páginas repetidas.');
  if (pages.some(page => !Number.isInteger(page) || page < 0 || page >= count)) throw new Error('A seleção contém uma página que não existe.');
  return [...pages];
}
function pageAt(doc: PDFDocument, index: number): PDFPage {
  selected([index], doc.getPageCount()); return doc.getPage(index);
}
function rotation(page: PDFPage): number {
  const value = ((page.getRotation().angle % 360) + 360) % 360;
  if (![0, 90, 180, 270].includes(value)) throw new Error('A rotação desta página não é suportada.');
  return value;
}
function point(page: PDFPage, x: number, y: number): {x: number; y: number} {
  finite(x, 'A posição horizontal'); finite(y, 'A posição vertical');
  const box = page.getCropBox();
  switch (rotation(page)) {
    case 90: return { x: box.x + y, y: box.y + x };
    case 180: return { x: box.x + box.width - x, y: box.y + y };
    case 270: return { x: box.x + box.width - y, y: box.y + box.height - x };
    default: return { x: box.x + x, y: box.y + box.height - y };
  }
}
function color(value: string) {
  if (typeof value !== 'string' || !/^#(?:[\da-f]{3}|[\da-f]{6})$/i.test(value)) throw new Error('Use uma cor hexadecimal válida, como #6941C6.');
  let hex = value.slice(1); if (hex.length === 3) hex = [...hex].map(character => character + character).join('');
  return rgb(parseInt(hex.slice(0, 2), 16) / 255, parseInt(hex.slice(2, 4), 16) / 255, parseInt(hex.slice(4, 6), 16) / 255);
}
let fontBytes: Promise<Buffer> | undefined;
async function inter(doc: PDFDocument): Promise<PDFFont> {
  doc.registerFontkit(fontkit);
  fontBytes ??= readFile(path.resolve(__dirname, '../../assets/Inter-Regular.ttf')).catch(cause => {
    fontBytes = undefined;
    throw new Error('A fonte Inter do aplicativo não foi encontrada. Reinstale o GCP-PDF para inserir textos em português.', { cause });
  });
  return doc.embedFont(await fontBytes, { subset: true });
}
async function save(doc: PDFDocument): Promise<Uint8Array> {
  return doc.save({ useObjectStreams: true, addDefaultPage: false, updateFieldAppearances: false, objectsPerTick: Infinity });
}
export async function createBlankPdf(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.setTitle('Documento sem título'); doc.setCreator('GCP-PDF'); doc.setProducer('GCP-PDF');
  doc.addPage([595.2756, 841.8898]);
  return save(doc);
}
export async function pageCount(bytes: Uint8Array): Promise<number> { return (await load(bytes)).getPageCount(); }
export async function applyPdfOperation(bytes: Uint8Array, op: PdfOperation): Promise<Uint8Array> {
  const doc = await load(bytes), count = doc.getPageCount();
  switch (op.type) {
    case 'rotate': {
      finite(op.degrees, 'A rotação');
      if (!Number.isInteger(op.degrees) || op.degrees % 90 !== 0) throw new Error('Gire as páginas em múltiplos de 90 graus.');
      for (const index of selected(op.pages, count)) {
        const page = doc.getPage(index);
        page.setRotation(degrees(((rotation(page) + op.degrees) % 360 + 360) % 360));
      }
      break;
    }
    case 'delete': {
      const pages = selected(op.pages, count);
      if (pages.length === count) throw new Error('O documento precisa manter pelo menos uma página.');
      for (const index of pages.sort((a, b) => b - a)) doc.removePage(index);
      break;
    }
    case 'blank': {
      const index = position(op.index, count), previous = count ? doc.getPage(Math.max(0, index - 1)) : undefined;
      const box = previous?.getCropBox();
      const turn = previous ? rotation(previous) : 0;
      const size: [number, number] = box ? turn % 180 ? [box.height, box.width] : [box.width, box.height] : [595.2756, 841.8898];
      doc.insertPage(index, size);
      break;
    }
    case 'reorder': {
      const order = selected(op.order, count);
      if (order.length !== count) throw new Error('A nova ordem precisa conter todas as páginas exatamente uma vez.');
      const pages = doc.getPages();
      for (let index = count - 1; index >= 0; index--) doc.removePage(index);
      for (const index of order) doc.addPage(pages[index]!);
      break;
    }
    case 'text': {
      const page = pageAt(doc, op.page), size = positive(op.size, 'O tamanho do texto');
      if (typeof op.text !== 'string' || !op.text.trim()) throw new Error('Digite o texto que deseja inserir.');
      const ink = color(op.color), font = await inter(doc);
      const anchor = point(page, op.x, finite(op.y, 'A posição vertical') + font.heightAtSize(size, { descender: false }));
      page.drawText(op.text, { ...anchor, size, font, color: ink, rotate: degrees(rotation(page)), lineHeight: size * 1.25 });
      break;
    }
    case 'image': {
      const page = pageAt(doc, op.page), width = positive(op.width, 'A largura da imagem'), height = positive(op.height, 'A altura da imagem');
      const parsed = /^data:image\/(png|jpe?g);base64,([A-Za-z0-9+/=\r\n]+)$/i.exec(op.dataUrl);
      if (!parsed) throw new Error('Escolha uma imagem PNG ou JPEG válida.');
      const data = Buffer.from(parsed[2]!, 'base64');
      let image;
      try { image = parsed[1]!.toLowerCase() === 'png' ? await doc.embedPng(data) : await doc.embedJpg(data); }
      catch (cause) { throw new Error('Não foi possível ler a imagem PNG ou JPEG.', { cause }); }
      page.drawImage(image, { ...point(page, op.x, finite(op.y, 'A posição vertical') + height), width, height, rotate: degrees(rotation(page)) });
      break;
    }
    case 'highlight': {
      const page = pageAt(doc, op.page), width = positive(op.width, 'A largura do destaque'), height = positive(op.height, 'A altura do destaque');
      page.drawRectangle({ ...point(page, op.x, finite(op.y, 'A posição vertical') + height), width, height, rotate: degrees(rotation(page)), color: color(op.color), opacity: 0.28, borderWidth: 0 });
      break;
    }
    case 'draw': {
      const page = pageAt(doc, op.page), thickness = positive(op.width, 'A espessura do traço'), ink = color(op.color);
      if (!Array.isArray(op.points) || op.points.length < 2) throw new Error('Desenhe um traço com pelo menos dois pontos.');
      const points = op.points.map(item => point(page, item.x, item.y));
      for (let index = 1; index < points.length; index++) page.drawLine({ start: points[index - 1]!, end: points[index]!, thickness, color: ink, lineCap: LineCapStyle.Round });
      break;
    }
    default: throw new Error('Esta operação de PDF não é reconhecida.');
  }
  return save(doc);
}
export async function transferPdfPages(source: Uint8Array, target: Uint8Array, pages: number[], index: number, move: boolean): Promise<{source: Uint8Array; target: Uint8Array}> {
  const [from, to] = await Promise.all([load(source), load(target)]);
  const selection = selected(pages, from.getPageCount()); position(index, to.getPageCount());
  if (move && selection.length === from.getPageCount()) throw new Error('A transferência precisa manter pelo menos uma página no documento de origem. Use copiar para transferir todas.');
  const copies = await to.copyPages(from, selection);
  for (const [offset, page] of copies.entries()) to.insertPage(index + offset, page);
  if (move) for (const page of [...selection].sort((a, b) => b - a)) from.removePage(page);
  const [sourceBytes, targetBytes] = await Promise.all([move ? save(from) : Promise.resolve(new Uint8Array(source)), save(to)]);
  return { source: sourceBytes, target: targetBytes };
}
export async function combinePdfs(inputs: Uint8Array[]): Promise<Uint8Array> {
  if (!Array.isArray(inputs) || inputs.length === 0) throw new Error('Escolha pelo menos um PDF para combinar.');
  const result = await PDFDocument.create(); result.setCreator('GCP-PDF'); result.setProducer('GCP-PDF');
  for (const bytes of inputs) {
    const input = await load(bytes);
    if (input.getPageCount() === 0) throw new Error('Um dos documentos não contém páginas.');
    const pages = await result.copyPages(input, input.getPageIndices());
    for (const page of pages) result.addPage(page);
  }
  return save(result);
}

/** Adds a searchable, invisible OCR layer while retaining the scanned page image. */
export async function addOcrTextLayer(bytes: Uint8Array, pages: {page: number; words: {text: string; x: number; y: number; width: number; height: number}[]}[]): Promise<Uint8Array> {
  const doc = await load(bytes);
  if (!Array.isArray(pages)) throw new Error('As páginas reconhecidas são inválidas.');
  if (pages.length === 0) return new Uint8Array(bytes);
  selected(pages.map(item => item.page), doc.getPageCount());
  const font = await inter(doc);
  for (const item of pages) {
    const page = doc.getPage(item.page);
    if (!Array.isArray(item.words)) throw new Error('As palavras reconhecidas são inválidas.');
    for (const word of item.words) {
      if (typeof word.text !== 'string') throw new Error('O texto reconhecido é inválido.');
      const text = word.text.trim(); if (!text) continue;
      const width = positive(word.width, 'A largura da palavra'), height = positive(word.height, 'A altura da palavra');
      const naturalHeight = font.heightAtSize(1, { descender: false }), naturalWidth = font.widthOfTextAtSize(text, 1);
      const size = Math.min(height / naturalHeight, width / Math.max(naturalWidth, 0.001));
      page.drawText(text, { ...point(page, word.x, finite(word.y, 'A posição vertical') + height), font, size, opacity: 0, color: rgb(0, 0, 0), rotate: degrees(rotation(page)) });
    }
  }
  return save(doc);
}

const FACES: Record<'sans' | 'serif' | 'mono', StandardFonts[]> = {
  sans: [StandardFonts.Helvetica, StandardFonts.HelveticaBold, StandardFonts.HelveticaOblique, StandardFonts.HelveticaBoldOblique],
  serif: [StandardFonts.TimesRoman, StandardFonts.TimesRomanBold, StandardFonts.TimesRomanItalic, StandardFonts.TimesRomanBoldItalic],
  mono: [StandardFonts.Courier, StandardFonts.CourierBold, StandardFonts.CourierOblique, StandardFonts.CourierBoldOblique],
};
type FontFile = (family: string, bold: boolean, italic: boolean) => Promise<Uint8Array | undefined>;
/** Installed fonts are embedded as subsets (only the glyphs used). The generic families use the
 * standard PDF faces, which cover Portuguese; text they cannot show falls back to the bundled Inter. */
async function objectFont(doc: PDFDocument, cache: Map<string, Promise<PDFFont>>, o: Extract<PageObject, {kind: 'text'}>, lines: string[], fontFile?: FontFile): Promise<PDFFont> {
  const generic = FACES[o.font as keyof typeof FACES];
  let font: Promise<PDFFont> | undefined;
  if (!generic && fontFile) {
    const key = `${o.font}|${o.bold}|${o.italic}`;
    font = cache.get(key) ?? fontFile(o.font, o.bold, o.italic).then(bytes => { if (!bytes) throw new Error('fonte ausente'); doc.registerFontkit(fontkit); return doc.embedFont(bytes, { subset: true }); });
    cache.set(key, font);
  }
  if (!font) { const name = (generic ?? FACES.sans)[(o.bold ? 1 : 0) + (o.italic ? 2 : 0)]!; font = cache.get(name) ?? doc.embedFont(name); cache.set(name, font); }
  try { const resolved = await font; for (const line of lines) resolved.encodeText(line); return resolved; }
  catch { const fallback = cache.get('inter') ?? inter(doc); cache.set('inter', fallback); return fallback; }
}
/** Rotates a local (y-down) offset clockwise by `angle` degrees around the object's top-left corner. */
function turn(x: number, y: number, lx: number, ly: number, angle: number) {
  const a = (angle * Math.PI) / 180;
  return { x: x + lx * Math.cos(a) - ly * Math.sin(a), y: y + lx * Math.sin(a) + ly * Math.cos(a) };
}
async function drawObjects(doc: PDFDocument, page: PDFPage, objects: PageObject[], asset: (id: string) => string, fonts: Map<string, Promise<PDFFont>>, fontFile?: FontFile) {
  const box = page.getCropBox(), at = (p: {x: number; y: number}) => ({ x: box.x + p.x, y: box.y + box.height - p.y }), origin = { x: box.x, y: box.y + box.height };
  for (const o of objects) {
    switch (o.kind) {
      case 'text': {
        const lines = o.text.split(/\r?\n/), font = await objectFont(doc, fonts, o, lines, fontFile), ascent = font.heightAtSize(o.size, { descender: false }), lineHeight = o.size * 1.2;
        lines.forEach((line, index) => {
          const width = font.widthOfTextAtSize(line, o.size), lx = o.align === 'center' ? (o.width - width) / 2 : o.align === 'right' ? o.width - width : 0;
          page.drawText(line, { ...at(turn(o.x, o.y, lx, ascent + index * lineHeight, o.rotation)), size: o.size, font, color: color(o.color), rotate: degrees(-o.rotation) });
        });
        break;
      }
      case 'image': {
        const parsed = /^data:image\/(png|jpe?g);base64,(.+)$/is.exec(asset(o.asset));
        if (!parsed) throw new Error('Uma imagem inserida não está mais disponível.');
        const data = Buffer.from(parsed[2]!, 'base64'), image = parsed[1]!.toLowerCase() === 'png' ? await doc.embedPng(data) : await doc.embedJpg(data);
        page.drawImage(image, { ...at(turn(o.x, o.y, 0, o.height, o.rotation)), width: o.width, height: o.height, rotate: degrees(-o.rotation) });
        break;
      }
      case 'note': {
        const anchor=at({x:o.x,y:o.y+o.height});
        const annotation=doc.context.obj({Type:'Annot',Subtype:'Text',Rect:[anchor.x,anchor.y,anchor.x+o.width,anchor.y+o.height],Contents:PDFHexString.fromText(o.text),T:PDFHexString.fromText(o.author),NM:PDFString.of('GCP-PDF:note:'+o.id),M:PDFString.of('D:'+o.createdAt.replace(/[^0-9]/g,'').slice(0,14)+'Z'),Name:'Comment',Open:false,C:[parseInt(o.color.slice(1,3),16)/255,parseInt(o.color.slice(3,5),16)/255,parseInt(o.color.slice(5,7),16)/255],F:28});
        const parent=doc.context.register(annotation);
        page.node.addAnnot(parent);
        // Replies are separate notes "in reply to" the first (IRT + RT /R), the structure Acrobat shows as a thread.
        for(const reply of o.replies??[]){const r=doc.context.obj({Type:'Annot',Subtype:'Text',Rect:[anchor.x,anchor.y,anchor.x+o.width,anchor.y+o.height],Contents:PDFHexString.fromText(reply.text),T:PDFHexString.fromText(reply.author),NM:PDFString.of('GCP-PDF:reply:'+reply.id),M:PDFString.of('D:'+reply.createdAt.replace(/[^0-9]/g,'').slice(0,14)+'Z'),IRT:parent,RT:'R',Name:'Comment',Open:false,F:28});page.node.addAnnot(doc.context.register(r));}
        break;
      }
      case 'shape': {
        const path = shapePath(o), stroke = { borderColor: color(o.stroke), borderWidth: o.strokeWidth, borderOpacity: o.opacity, borderLineCap: LineCapStyle.Round };
        page.drawSvgPath(path.outline, { ...origin, ...stroke, ...(path.closed && o.fill ? { color: color(o.fill), opacity: o.opacity } : {}) });
        if (path.head) page.drawSvgPath(path.head, { ...origin, ...stroke });
        const label = measureLabel(o);
        if (label) {
          const font = await doc.embedFont(StandardFonts.HelveticaBold), size = Math.max(7, o.strokeWidth * 4 + 5), width = font.widthOfTextAtSize(label.text, size), rad = (label.angle * Math.PI) / 180;
          const offset = o.measure === 'perimeter' ? 0 : -width / 2, start = { x: label.at.x + offset * Math.cos(rad), y: label.at.y + offset * Math.sin(rad) - size * 0.45 };
          const p = at(start);
          page.drawText(label.text, { x: p.x, y: p.y, size, font, color: color(o.stroke), opacity: o.opacity, rotate: degrees(-label.angle) });
        }
        break;
      }
      case 'ink':
        page.drawSvgPath(inkPath(o.points), { ...origin, borderColor: color(o.stroke), borderWidth: o.strokeWidth, borderOpacity: o.opacity, borderLineCap: LineCapStyle.Round });
        break;
      case 'markup':
        for (const r of o.rects) {
          if (o.style === 'highlight') page.drawRectangle({ ...at({ x: r.x, y: r.y + r.height }), width: r.width, height: r.height, color: color(o.color), opacity: o.opacity, blendMode: BlendMode.Multiply });
          else { const y = r.y + r.height * (o.style === 'underline' ? 0.94 : 0.55); page.drawLine({ start: at({ x: r.x, y }), end: at({ x: r.x + r.width, y }), thickness: Math.max(0.8, r.height * 0.07), color: color(o.color), opacity: Math.max(o.opacity, 0.8) }); }
        }
        break;
    }
  }
}
const nativeRotation = (page: PDFPage) => ((page.getRotation().angle % 360) + 360) % 360;
/** Writes the PDF an open document describes: its page references (from one or more immutable
 * source PDFs) plus the objects drawn over them. A single-source document keeps its catalog
 * (bookmarks, forms, metadata); pages gathered from several sources are copied into a new file. */
export async function materialize(input: {pages: PageRef[]; objects: PageObject[]; base: (id: string) => Uint8Array; basePages: (id: string) => number; asset: (id: string) => string; fontFile?: FontFile; fields?: Record<string, string | boolean | string[]>; withObjects?: boolean; syncNotes?: boolean; metadata?: Partial<Record<'title' | 'author' | 'subject' | 'keywords' | 'creator' | 'producer', string>>}): Promise<Uint8Array> {
  const { pages } = input, objects = input.withObjects === false ? [] : input.objects;
  if (!pages.length) throw new Error('O documento precisa ter pelo menos uma página.');
  const bases = [...new Set(pages.map(page => page.base))], single = bases.length === 1, sources = pages.map(page => page.src);
  const unique = new Set(sources).size === sources.length, identity = single && unique && sources.every((src, index) => src === index);
  const fields = input.withObjects === false ? {} : input.fields ?? {};
  const metadata = input.withObjects === false ? {} : input.metadata ?? {};
  if (!input.syncNotes && identity && !objects.length && !Object.keys(fields).length && !Object.keys(metadata).length && pages.every(page => page.rotate % 360 === 0)) {
    if (input.basePages(bases[0]!) === pages.length) return input.base(bases[0]!);
  }
  let doc: PDFDocument, output: PDFPage[];
  if (single && unique) {
    doc = await load(input.base(bases[0]!));
    const all = doc.getPages();
    output = sources.map(src => all[src]!);
    if (!identity || all.length !== pages.length) { for (let index = all.length - 1; index >= 0; index--) doc.removePage(index); for (const page of output) doc.addPage(page); }
  } else {
    doc = await PDFDocument.create(); doc.setCreator('GCP-PDF'); doc.setProducer('GCP-PDF');
    const loaded = new Map<string, PDFDocument>();
    for (const id of bases) loaded.set(id, await load(input.base(id)));
    output = [];
    for (const ref of pages) { const [copy] = await doc.copyPages(loaded.get(ref.base)!, [ref.src]); output.push(doc.addPage(copy!)); }
  }
  pages.forEach((ref, index) => { if (ref.rotate % 360) { const page = output[index]!; page.setRotation(degrees((nativeRotation(page) + ref.rotate) % 360)); } });
  if (input.syncNotes && input.withObjects !== false) for (const page of output) {
    const annots=page.node.Annots(); if(!annots)continue;
    for(let i=annots.size()-1;i>=0;i--){const entry=doc.context.lookup(annots.get(i));if(!(entry instanceof PDFDict))continue;const name=entry.get(PDFName.of('NM'));if((name instanceof PDFString||name instanceof PDFHexString)&&name.decodeText().startsWith('GCP-PDF:'))annots.remove(i);}
  }
  const fonts = new Map<string, Promise<PDFFont>>(), byPage = new Map(pages.map((ref, index) => [ref.id, output[index]!]));
  for (const ref of pages) { const own = objects.filter(o => o.page === ref.id); if (own.length) await drawObjects(doc, byPage.get(ref.id)!, own, input.asset, fonts, input.fontFile); }
  if (Object.keys(fields).length) fillForm(doc, fields);
  if (metadata.title !== undefined) doc.setTitle(metadata.title);
  if (metadata.author !== undefined) doc.setAuthor(metadata.author);
  if (metadata.subject !== undefined) doc.setSubject(metadata.subject);
  if (metadata.keywords !== undefined) doc.setKeywords(metadata.keywords.split(/[;,]/).map(k => k.trim()).filter(Boolean));
  if (metadata.creator !== undefined) doc.setCreator(metadata.creator);
  if (metadata.producer !== undefined) doc.setProducer(metadata.producer);
  if (Object.keys(metadata).length) doc.setModificationDate(new Date());
  return save(doc);
}
export async function blankPdf(width: number, height: number): Promise<Uint8Array> {
  const doc = await PDFDocument.create(); doc.setCreator('GCP-PDF'); doc.setProducer('GCP-PDF'); doc.addPage([positive(width, 'A largura'), positive(height, 'A altura')]); return save(doc);
}
/** Combines whole files or chosen pages (zero based, in the given order) into one new PDF. */
export async function combineSelections(parts: {bytes: Uint8Array; pages?: number[]}[]): Promise<Uint8Array> {
  if (!Array.isArray(parts) || !parts.length) throw new Error('Escolha pelo menos um arquivo para combinar.');
  const result = await PDFDocument.create(); result.setCreator('GCP-PDF'); result.setProducer('GCP-PDF');
  for (const part of parts) {
    const input = await load(part.bytes), indices = part.pages ?? input.getPageIndices();
    if (!indices.length) throw new Error('Um dos arquivos não contém páginas.');
    for (const page of await result.copyPages(input, indices)) result.addPage(page);
  }
  return save(result);
}
/** Writes typed form values into the document AcroForm and refreshes their appearances. */
function fillForm(doc: PDFDocument, values: Record<string, string | boolean | string[]>) {
  const form = doc.getForm();
  for (const [name, value] of Object.entries(values)) {
    try {
      const field = form.getField(name);
      if (field instanceof PDFTextField) field.setText(String(value));
      else if (field instanceof PDFCheckBox) { if (value) field.check(); else field.uncheck(); }
      else if (field instanceof PDFRadioGroup) { if (typeof value === 'string' && value) field.select(value); }
      else if (field instanceof PDFDropdown || field instanceof PDFOptionList) { if (Array.isArray(value) ? value.length : value) field.select(value as string | string[]); }
    } catch { /* A field missing from this file (pages taken from another PDF) is left as is. */ }
  }
  try { form.updateFieldAppearances(); } catch { /* Appearances stay as the viewer draws them. */ }
}


/** Reads only notes owned by GCP-PDF. Other applications' annotations stay untouched. */
export async function readPdfNotes(bytes:Uint8Array,existing?:PDFDocument):Promise<({page:number}&Omit<Extract<PageObject,{kind:'note'}>,'page'>)[]> {
 const doc=existing??await load(bytes),notes:({page:number}&Omit<Extract<PageObject,{kind:'note'}>,'page'>)[]=[];
 const text=(dict:PDFDict,key:string)=>{const value=dict.get(PDFName.of(key));return value instanceof PDFString||value instanceof PDFHexString?value.decodeText():'';};
 const refs=new Map<string,number>(),replies:{parent:string;reply:{id:string;author:string;text:string;createdAt:string}}[]=[];
 const when=(m:string)=>{const date=m.replace(/^D:/,'');return /^\d{14}/.test(date)?`${date.slice(0,4)}-${date.slice(4,6)}-${date.slice(6,8)}T${date.slice(8,10)}:${date.slice(10,12)}:${date.slice(12,14)}.000Z`:new Date(0).toISOString();};
 for(const [index,page] of doc.getPages().entries()){
  const annots=page.node.Annots();if(!annots)continue;const box=page.getCropBox();
  for(let i=0;i<annots.size();i++){const dict=doc.context.lookup(annots.get(i));if(!(dict instanceof PDFDict)||dict.get(PDFName.of('Subtype'))?.toString()!=='/Text')continue;const nm=text(dict,'NM');if(nm.startsWith('GCP-PDF:reply:')){const parent=dict.get(PDFName.of('IRT'));if(parent)replies.push({parent:parent.toString(),reply:{id:nm.slice('GCP-PDF:reply:'.length),author:text(dict,'T'),text:text(dict,'Contents'),createdAt:when(text(dict,'M'))}});continue;}if(!nm.startsWith('GCP-PDF:note:'))continue;const rect=dict.lookupMaybe(PDFName.of('Rect'),PDFArray);if(!rect||rect.size()!==4)continue;const coords=rect.asArray().map(v=>v instanceof PDFNumber?v.asNumber():NaN);if(!coords.every(Number.isFinite))continue;const [left,bottom,right,top]=coords as [number,number,number,number];const colors=dict.lookupMaybe(PDFName.of('C'),PDFArray)?.asArray().map(v=>v instanceof PDFNumber?v.asNumber():0)??[1,.8,0];const color='#'+colors.slice(0,3).map(v=>Math.round(Math.max(0,Math.min(1,v))*255).toString(16).padStart(2,'0')).join('');const date=text(dict,'M').replace(/^D:/,'');const createdAt=/^\d{14}/.test(date)?`${date.slice(0,4)}-${date.slice(4,6)}-${date.slice(6,8)}T${date.slice(8,10)}:${date.slice(10,12)}:${date.slice(12,14)}.000Z`:new Date(0).toISOString();refs.set(annots.get(i).toString(),notes.length);notes.push({kind:'note',id:nm.slice('GCP-PDF:note:'.length),page:index,x:left-box.x,y:box.y+box.height-top,width:right-left,height:top-bottom,text:text(dict,'Contents'),author:text(dict,'T'),createdAt,color});}
 }
 for(const {parent,reply} of replies){const at=refs.get(parent);if(at!==undefined)(notes[at]!.replies??=[]).push(reply);}
 return notes;
}

