import {readAnnotations,deleteAnnotation} from './pdf-annotations';
import {randomUUID} from 'node:crypto';
import {PDFDocument, ParseSpeeds, PDFName, PDFDict} from 'pdf-lib';
import type {DocumentMetadata, DocumentInfo, FieldValue, PageObject, PageRef, PdfOperation} from '../shared/types';
import {blankPdf, createBlankPdf, materialize, readPdfNotes, noteOverlayBase} from './pdf-engine';

/** An immutable source PDF. Documents only reference its pages, so bases are shared freely
 * between documents and history entries and are dropped once nothing references them. */
interface Base {viewer?:Promise<Uint8Array>;annotations:ReturnType<typeof readAnnotations>;bytes: Uint8Array; pages: {width: number; height: number; rotation: number}[]; xfa?: boolean; signed?: boolean; notes?: Awaited<ReturnType<typeof readPdfNotes>>}
/** `fields` holds form values typed by the user, written into the PDF form when it is materialized. */
interface Model {pages: PageRef[]; objects: PageObject[]; fields?: Record<string, FieldValue>; metadata?: Partial<DocumentMetadata>}
type HistoryGroup = {id: string; documents: string[]};
type HistoryEntry = {before: Model; after: Model; group?: HistoryGroup};
interface Stored {id: string; name: string; path?: string; signedOriginPath?: string; notice?: string; revision: number; savedRevision: number; model: Model; past: HistoryEntry[]; future: HistoryEntry[]}
const MAX_HISTORY = 60;
const MAX_HISTORY_BYTES = 512 * 1024 * 1024;
const MAX_OBJECT_TEXT = 20_000;

async function inspect(bytes: Uint8Array): Promise<Base> {
 if (!(bytes instanceof Uint8Array) || !bytes.length) throw new Error('O arquivo PDF está vazio.');
 let doc: PDFDocument;
 try { doc = await PDFDocument.load(bytes, {updateMetadata: false, parseSpeed: ParseSpeeds.Fastest}); }
 catch (cause) { throw new Error('Não foi possível abrir o PDF. Verifique se o arquivo é válido e não está protegido por senha.', {cause}); }
 if (!doc.getPageCount()) throw new Error('O PDF não contém páginas.');
 const xfa = !!doc.catalog.lookupMaybe(PDFName.of('AcroForm'), PDFDict)?.get(PDFName.of('XFA'));
 // Signed: any /Sig field with a value. Such files must never be rewritten (the signature covers exact bytes).
 const signed = doc.getForm().getFields().some(field => { const v = field.acroField.dict.lookup(PDFName.of('V')); return field.acroField.dict.get(PDFName.of('FT'))?.toString() === '/Sig' && v instanceof PDFDict; });
 return {bytes, xfa, signed, annotations:readAnnotations(doc), notes:await readPdfNotes(bytes,doc), pages: doc.getPages().map(page => { const box = page.getCropBox(); return {width: box.width, height: box.height, rotation: ((page.getRotation().angle % 360) + 360) % 360}; })};
}
function finite(value: unknown): value is number { return typeof value === 'number' && Number.isFinite(value); }
const HEX = /^#[\da-f]{6}$/i;
/** Parses an object arriving from a renderer: every field is checked, nothing is trusted. */
function parseObject(raw: PageObject, pages: Set<string>, assets: Map<string, string>): PageObject {
 const fail = () => { throw new Error('O objeto enviado para a página é inválido.'); };
 if (!raw || typeof raw !== 'object' || typeof raw.id !== 'string' || !raw.id || raw.id.length > 80 || !pages.has(raw.page)) fail();
 const point = (p: unknown) => { const v = p as {x: unknown; y: unknown}; if (!v || !finite(v.x) || !finite(v.y)) fail(); return {x: v.x as number, y: v.y as number}; };
 const box = (o: {x: unknown; y: unknown; width: unknown; height: unknown}) => { if (![o.x, o.y, o.width, o.height].every(finite) || (o.width as number) < 0 || (o.height as number) < 0) fail(); };
 const opacity = (v: unknown) => { if (!finite(v) || v < 0.05 || v > 1) fail(); return v as number; };
 switch (raw.kind) {
  case 'note': box(raw); if(typeof raw.text!=='string'||raw.text.length>20000||typeof raw.author!=='string'||raw.author.length>120||typeof raw.createdAt!=='string'||!Number.isFinite(Date.parse(raw.createdAt))||!HEX.test(raw.color)) fail(); if(raw.replies!==undefined&&(!Array.isArray(raw.replies)||raw.replies.length>500||raw.replies.some((r:any)=>!r||typeof r.id!=='string'||typeof r.text!=='string'||r.text.length>20000||typeof r.author!=='string'||r.author.length>120||typeof r.createdAt!=='string'||!Number.isFinite(Date.parse(r.createdAt)))))fail(); return {...raw};
  case 'text': box(raw); if (typeof raw.text !== 'string' || raw.text.length > MAX_OBJECT_TEXT || !finite(raw.size) || raw.size < 4 || raw.size > 400 || !HEX.test(raw.color) || typeof raw.font !== 'string' || !raw.font.trim() || raw.font.length > 120 || !['left', 'center', 'right'].includes(raw.align) || !finite(raw.rotation)) fail();
   return {id: raw.id, page: raw.page, kind: 'text', x: raw.x, y: raw.y, width: raw.width, height: raw.height, text: raw.text, size: raw.size, color: raw.color, font: raw.font, bold: !!raw.bold, italic: !!raw.italic, align: raw.align, rotation: raw.rotation};
  case 'image': box(raw); if (!assets.has(raw.asset) || !finite(raw.rotation)) fail();
   return {id: raw.id, page: raw.page, kind: 'image', x: raw.x, y: raw.y, width: raw.width, height: raw.height, asset: raw.asset, rotation: raw.rotation};
  case 'shape': box(raw); if (!['rect', 'ellipse', 'line', 'arrow', 'dimension', 'polyline', 'polygon', 'cloud', 'check', 'cross'].includes(raw.shape) || (raw.measure !== undefined && !['distance', 'perimeter', 'area'].includes(raw.measure)) || !HEX.test(raw.stroke) || (raw.fill !== null && !HEX.test(raw.fill)) || !finite(raw.strokeWidth) || raw.strokeWidth <= 0 || raw.strokeWidth > 72 || (raw.points !== undefined && (!Array.isArray(raw.points) || raw.points.length > 5000))) fail();
   return {id: raw.id, page: raw.page, kind: 'shape', shape: raw.shape, x: raw.x, y: raw.y, width: raw.width, height: raw.height, points: raw.points?.map(point), stroke: raw.stroke, fill: raw.fill, strokeWidth: raw.strokeWidth, opacity: opacity(raw.opacity), ...(raw.measure ? {measure: raw.measure} : {})};
  case 'ink': if (!Array.isArray(raw.points) || raw.points.length < 2 || raw.points.length > 20_000 || !HEX.test(raw.stroke) || !finite(raw.strokeWidth) || raw.strokeWidth <= 0 || raw.strokeWidth > 72) fail();
   return {id: raw.id, page: raw.page, kind: 'ink', points: raw.points.map(point), stroke: raw.stroke, strokeWidth: raw.strokeWidth, opacity: opacity(raw.opacity)};
  case 'markup': if (!['highlight', 'underline', 'strike'].includes(raw.style) || !Array.isArray(raw.rects) || !raw.rects.length || raw.rects.length > 2000 || !HEX.test(raw.color)) fail();
   for (const r of raw.rects) box(r);
   return {id: raw.id, page: raw.page, kind: 'markup', style: raw.style, rects: raw.rects.map(r => ({x: r.x, y: r.y, width: r.width, height: r.height})), color: raw.color, opacity: opacity(raw.opacity)};
  default: return fail();
 }
}
function selected(pages: number[], count: number): number[] {
 if (!Array.isArray(pages) || !pages.length) throw new Error('Selecione pelo menos uma página.');
 if (new Set(pages).size !== pages.length) throw new Error('A seleção contém páginas repetidas.');
 if (pages.some(page => !Number.isInteger(page) || page < 0 || page >= count)) throw new Error('A seleção contém uma página que não existe.');
 return [...pages];
}
/** Copies pages (with their objects) under fresh ids, so a document never holds two equal ids. */
function clonePages(model: Model, refs: PageRef[]): Model {
 const ids = new Map(refs.map(ref => [ref.id, randomUUID()]));
 return {pages: refs.map(ref => ({...ref, id: ids.get(ref.id)!})), objects: model.objects.filter(o => ids.has(o.page)).map(o => ({...o, id: randomUUID(), page: ids.get(o.page)!}))};
}

export type FontFile = (family: string, bold: boolean, italic: boolean) => Promise<Uint8Array | undefined>;
export class DocumentStore {
 constructor(private fontFile?: FontFile) {}
 private docs = new Map<string, Stored>();
 private bases = new Map<string, Base>();
 private assets = new Map<string, string>();
 private blanks = new Map<string, string>();
 private pending: Promise<unknown> = Promise.resolve();
 get(id: string): Stored { const doc = this.docs.get(id); if (!doc) throw new Error('Este documento não está mais aberto.'); return doc; }
 all() { return [...this.docs.values()]; }
 base(id: string): Uint8Array { const base = this.bases.get(id); if (!base) throw new Error('Esta versão do documento não está mais disponível.'); return base.bytes; }
 viewerBase(id:string){const base=this.baseInfo(id);return base.notes?.length?(base.viewer??=noteOverlayBase(base.bytes)):Promise.resolve(base.bytes);}
 asset(id: string): string { const asset = this.assets.get(id); if (asset === undefined) throw new Error('Esta imagem não está mais disponível.'); return asset; }
 info(id: string): DocumentInfo {
  const {past, future, model, signedOriginPath, ...doc} = this.get(id);
  const {notice, ...visible} = doc;
  return {...visible, annotations:model.pages.flatMap(ref=>(this.bases.get(ref.base)?.annotations[ref.src]??[]).map(a=>({...a,page:ref.id}))), pageCount: model.pages.length, pages: model.pages, objects: model.objects, fields: model.fields ?? {}, canUndo: past.length > 0, canRedo: future.length > 0};
 }
 /** Size of a page as displayed (crop box, after native and extra rotation). */
 pageSize(ref: PageRef) { const page = this.bases.get(ref.base)!.pages[ref.src]!, turned = (page.rotation + ref.rotate) % 180 !== 0; return turned ? {width: page.height, height: page.width} : {width: page.width, height: page.height}; }
 baseInfo(id: string): Base { const base = this.bases.get(id); if (!base) throw new Error('Esta versão do documento não está mais disponível.'); return base; }
 async inspectPages(bytes: Uint8Array) { return (await inspect(bytes)).pages.length; }
 async addBase(bytes: Uint8Array): Promise<string> { const id = randomUUID(); this.bases.set(id, await inspect(new Uint8Array(bytes))); return id; }
 /** Opens a PDF. An XFA form is first laid out by `xfa` into an ordinary PDF form; the document then
  * has no file path, so saving never overwrites the original dynamic form. */
 async add(bytes: Uint8Array, name: string, path?: string, xfa?: (bytes: Uint8Array) => Promise<{bytes: Uint8Array; fields: number}>) {
  let base = await this.addBase(bytes), notice: string | undefined;
  if (this.bases.get(base)!.xfa && xfa) {
   const form = await xfa(bytes); this.bases.delete(base); base = await this.addBase(form.bytes); path = undefined;
   notice = `Formulário XFA (Adobe) convertido em formulário PDF padrão, com ${form.fields} campo(s) preenchível(is). Use Salvar como para manter o arquivo original intacto.`;
  }
  const count = this.bases.get(base)!.pages.length;
  const doc: Stored = {id: randomUUID(), name, path, signedOriginPath: path && this.bases.get(base)!.signed ? path : undefined, notice, revision: 0, savedRevision: path ? 0 : -1, model: {pages: Array.from({length: count}, (_, src) => ({id: randomUUID(), base, src, rotate: 0})), objects: []}, past: [], future: []};
  for(const note of this.bases.get(base)!.notes??[]){const ref=doc.model.pages[note.page];if(ref)doc.model.objects.push({...note,page:ref.id});}
  this.docs.set(doc.id, doc); return doc.id;
 }
 async blank() { return this.add(await createBlankPdf(), 'Sem título.pdf'); }
 check(id: string, revision: number) { const doc = this.get(id); if (doc.revision !== revision) throw new Error('O documento mudou em outra janela. A visualização foi atualizada; repita a ação.'); return doc; }
 private present(doc: Stored) { if (this.docs.get(doc.id) !== doc) throw new Error('Este documento foi fechado durante a operação. Os documentos abertos foram preservados.'); }
 serial<T>(action: () => Promise<T>): Promise<T> { const task = this.pending.then(action); this.pending = task.catch(() => {}); return task; }
 /** True when the document is exactly its single source file: same pages in order, no rotation, no added
  * objects (notes equal to the ones read from the file), no form values or properties. Its bytes are then the
  * file's bytes, untouched — which is what keeps digital signatures valid. */
 unchanged(id: string) {
  const model = this.get(id).model, bases = [...new Set(model.pages.map(p => p.base))];
  if (bases.length !== 1) return false;
  const base = this.bases.get(bases[0]!)!;
  if (model.pages.length !== base.pages.length || model.pages.some((p, i) => p.src !== i || p.rotate % 360)) return false;
  if (Object.keys(model.fields ?? {}).length || Object.keys(model.metadata ?? {}).length) return false;
  const original = new Map((base.notes ?? []).map(n => [n.id, n]));
  if (model.objects.length !== original.size) return false;
  return model.objects.every(o => { if (o.kind !== 'note') return false; const n = original.get(o.id); return !!n && model.pages[n.page]?.id === o.page && JSON.stringify({...n, page: 0, replies: n.replies ?? []}) === JSON.stringify({...o, page: 0, replies: o.replies ?? []}); });
 }
 /** Whether the document's source file carries a digital signature. */
 signed(id: string) { const doc=this.get(id); return !!doc.signedOriginPath || doc.model.pages.some(p => !!this.bases.get(p.base)?.signed); }
 signedSourcePath(id: string) { return this.get(id).signedOriginPath; }
 /** Builds the PDF bytes for the current model (used by save, export, print, OCR and AI). */
 materialize(id: string, withObjects = true) {
  const model = this.get(id).model;
  if (withObjects && this.unchanged(id)) return Promise.resolve(this.base(model.pages[0]!.base));
  return materialize({pages: model.pages, objects: model.objects, fields: model.fields, metadata: model.metadata, base: base => this.base(base), basePages: base => this.bases.get(base)!.pages.length, asset: asset => this.asset(asset), fontFile: this.fontFile, withObjects, syncNotes:withObjects&&(model.objects.some(o=>o.kind==='note')||model.pages.some(p=>!!this.bases.get(p.base)?.notes?.length))});
 }

 /** A new branch invalidates every redo that depends on a shared transfer. */
 private clearRedo(start: Stored) {
  const queue = [start], seen = new Set<string>();
  for (let at = 0; at < queue.length; at++) {
   const doc = queue[at]!; if (seen.has(doc.id)) continue; seen.add(doc.id);
   const removed = doc.future.splice(0);
   for (const entry of removed) for (const id of entry.group?.documents ?? []) {
    const peer = this.docs.get(id); if (peer && !seen.has(id)) queue.push(peer);
   }
  }
 }
 /** Evict a prefix, including its peer prefixes, so no history can cross a missing transfer. */
 private discardPastPrefix(start: Stored, count: number) {
  const queue = [{doc: start, count}];
  for (let at = 0; at < queue.length; at++) {
   const job = queue[at]!, removed = job.doc.past.splice(0, job.count);
   for (const entry of removed) for (const id of entry.group?.documents ?? []) {
    const peer = this.docs.get(id); if (!peer || peer === job.doc) continue;
    const index = peer.past.findIndex(item => item.group?.id === entry.group!.id);
    if (index >= 0) queue.push({doc: peer, count: index + 1});
    else if (peer.future.some(item => item.group?.id === entry.group!.id)) this.clearRedo(peer);
   }
  }
 }
 /** Bytes of sources kept alive only by this document's undo/redo history. */
 private historyBytes(doc: Stored): number {
  const live = new Set(doc.model.pages.map(page => page.base)), retained = new Set<string>();
  for (const entry of [...doc.past, ...doc.future]) for (const model of [entry.before, entry.after]) for (const page of model.pages) if (!live.has(page.base)) retained.add(page.base);
  return [...retained].reduce((sum, id) => sum + (this.bases.get(id)?.bytes.byteLength ?? 0), 0);
 }
 private collect() {
  for (const doc of this.docs.values()) {
   while (doc.past.length + doc.future.length > MAX_HISTORY || this.historyBytes(doc) > MAX_HISTORY_BYTES) {
    if (doc.past.length) this.discardPastPrefix(doc, 1);
    else { this.clearRedo(doc); break; }
   }
  }
  const bases = new Set<string>(), assets = new Set<string>();
  for (const doc of this.docs.values()) for (const model of [doc.model, ...doc.past.flatMap(e => [e.before, e.after]), ...doc.future.flatMap(e => [e.before, e.after])]) {
   for (const page of model.pages) bases.add(page.base);
   for (const o of model.objects) if (o.kind === 'image') assets.add(o.asset);
  }
  for (const id of this.bases.keys()) if (!bases.has(id)) this.bases.delete(id);
  for (const id of this.assets.keys()) if (!assets.has(id)) this.assets.delete(id);
  for (const [size, id] of this.blanks) if (!this.bases.has(id)) this.blanks.delete(size);
 }
 private commit(changes: {doc: Stored; model: Model}[]) {
  // Edited properties belong to the document, whatever operation produced the next model.
  for (const change of changes) if (change.model.metadata === undefined && change.doc.model.metadata) change.model = {...change.model, metadata: change.doc.model.metadata};
  for (const change of changes) this.present(change.doc);
  const group: HistoryGroup | undefined = changes.length > 1 ? {id: randomUUID(), documents: changes.map(change => change.doc.id)} : undefined;
  for (const {doc} of changes) this.clearRedo(doc);
  for (const {doc, model} of changes) { doc.past.push({before: doc.model, after: model, group}); doc.model = model; doc.revision++; }
  this.collect();
 }
 private async blankBase(width: number, height: number) {
  const key = `${width.toFixed(2)}x${height.toFixed(2)}`, known = this.blanks.get(key);
  if (known && this.bases.has(known)) return known;
  const id = await this.addBase(await blankPdf(width, height)); this.blanks.set(key, id); return id;
 }
 async apply(id: string, op: PdfOperation, revision: number, dataUrl?: string) {
  return this.serial(async () => {
   const doc = this.get(id), {pages, objects} = doc.model;
   if (!op || typeof op !== 'object') throw new Error('Esta operação não é reconhecida.');
   // Object edits address objects by id, so quick successive edits never conflict on revision.
   if (!['add-object', 'add-objects', 'update-object', 'delete-objects', 'set-fields', 'set-metadata'].includes(op.type)) this.check(id, revision);
   let model: Model;
   switch (op.type) {
    case 'rotate': {
     if (!Number.isInteger(op.degrees) || op.degrees % 90 !== 0) throw new Error('Gire as páginas em múltiplos de 90 graus.');
     const chosen = new Set(selected(op.pages, pages.length));
     model = {pages: pages.map((ref, index) => chosen.has(index) ? {...ref, rotate: (((ref.rotate + op.degrees) % 360) + 360) % 360} : ref), objects};
     break;
    }
    case 'delete': {
     const chosen = new Set(selected(op.pages, pages.length));
     if (chosen.size === pages.length) throw new Error('O documento precisa manter pelo menos uma página.');
     const kept = pages.filter((_, index) => !chosen.has(index)), ids = new Set(kept.map(ref => ref.id));
     model = {pages: kept, objects: objects.filter(o => ids.has(o.page))};
     break;
    }
    case 'blank': {
     if (!Number.isInteger(op.index) || op.index < 0 || op.index > pages.length) throw new Error('A posição de inserção está fora do documento.');
     const size = pages.length ? this.pageSize(pages[Math.max(0, op.index - 1)]!) : {width: 595.2756, height: 841.8898};
     const ref: PageRef = {id: randomUUID(), base: await this.blankBase(size.width, size.height), src: 0, rotate: 0};
     model = {pages: [...pages.slice(0, op.index), ref, ...pages.slice(op.index)], objects};
     break;
    }
    case 'delete-annotation': {
     const ref=pages.find(p=>p.id===op.page);
     if(!ref||!Number.isInteger(op.index))throw new Error('A anotação selecionada é inválida.');
     const base=await this.addBase(await deleteAnnotation(this.base(ref.base),ref.src,op.index));
     // Keep the source catalog for its other pages. A duplicate of the selected source page retains the old base.
     model={...doc.model,pages:pages.map(p=>p.base===ref.base&&(p.src!==ref.src||p.id===ref.id)?{...p,base}:p)};
     break;
    }
    case 'reorder': {
     const order = selected(op.order, pages.length);
     if (order.length !== pages.length) throw new Error('A nova ordem precisa conter todas as páginas exatamente uma vez.');
     model = {pages: order.map(index => pages[index]!), objects};
     break;
    }
    case 'add-object': {
     let raw = op.object;
     if (raw?.kind === 'image' && typeof dataUrl === 'string') {
      if (!/^data:image\/(png|jpe?g);base64,[A-Za-z0-9+/=\r\n]+$/i.test(dataUrl) || dataUrl.length > 40 * 1024 * 1024) throw new Error('Escolha uma imagem PNG ou JPEG válida.');
      const asset = randomUUID(); this.assets.set(asset, dataUrl); raw = {...raw, asset};
     }
     const object = parseObject(raw, new Set(pages.map(ref => ref.id)), this.assets);
     if (objects.some(o => o.id === object.id)) throw new Error('Este objeto já existe na página.');
     model = {pages, objects: [...objects, object]};
     break;
    }
    case 'update-object': {
     const object = parseObject(op.object, new Set(pages.map(ref => ref.id)), this.assets);
     if (!objects.some(o => o.id === object.id)) throw new Error('Este objeto não existe mais. A visualização foi atualizada.');
     model = {pages, objects: objects.map(o => o.id === object.id ? object : o)};
     break;
    }
    case 'add-objects': {
     if (!Array.isArray(op.objects) || !op.objects.length || op.objects.length > 20_000) throw new Error('Nenhum objeto para adicionar.');
     const known = new Set(pages.map(ref => ref.id)), ids = new Set(objects.map(o => o.id));
     const added = op.objects.map(raw => parseObject(raw, known, this.assets));
     if (added.some(o => ids.has(o.id)) || new Set(added.map(o => o.id)).size !== added.length) throw new Error('Objetos repetidos na página.');
     model = {pages, objects: [...objects, ...added]};
     break;
    }
    case 'set-fields': {
     if (!op.values || typeof op.values !== 'object' || Array.isArray(op.values)) throw new Error('Valores de formulário inválidos.');
     const fields = {...doc.model.fields};
     for (const [name, value] of Object.entries(op.values)) {
      const valid = typeof value === 'string' ? value.length <= 100_000 : typeof value === 'boolean' || (Array.isArray(value) && value.every(item => typeof item === 'string'));
      if (!valid || name.length > 500) throw new Error('Valor de formulário inválido.');
      fields[name] = value;
     }
     model = {pages, objects, fields};
     break;
    }
    case 'set-metadata': {
     if (!op.values || typeof op.values !== 'object' || Array.isArray(op.values)) throw new Error('Propriedades inválidas.');
     const metadata = {...doc.model.metadata};
     for (const key of ['title', 'author', 'subject', 'keywords', 'creator', 'producer'] as const) { const value = op.values[key]; if (value === undefined) continue; if (typeof value !== 'string' || value.length > 2000) throw new Error('Propriedade inválida.'); metadata[key] = value; }
     model = {pages, objects, fields: doc.model.fields, metadata};
     break;
    }
    case 'delete-objects': {
     if (!Array.isArray(op.ids) || !op.ids.length) return;
     const ids = new Set(op.ids);
     model = {pages, objects: objects.filter(o => !ids.has(o.id))};
     break;
    }
    default: throw new Error('Esta operação não é reconhecida.');
   }
   if (model.fields === undefined && doc.model.fields) model.fields = doc.model.fields;
   this.commit([{doc, model}]);
  });
 }
 /** Replaces every page that references `oldBase` with the same page of `bytes` (same page count),
  * keeping page ids, rotations and objects. Used after the text engine edits a source PDF. */
 async swapBase(id: string, oldBase: string, bytes: Uint8Array, revision: number) {
  // A text edit rewrites content streams only; page boxes and count are those of the source.
  const known = this.bases.get(oldBase), base = randomUUID();
  this.bases.set(base, await inspect(new Uint8Array(bytes)));
  if(known?.signed)this.bases.get(base)!.signed=true;
  return this.serial(async () => {
   const doc = this.check(id, revision);
   if (this.bases.get(base)!.pages.length !== this.bases.get(oldBase)?.pages.length) throw new Error('A edição alterou inesperadamente a quantidade de páginas. O original foi preservado.');
   this.commit([{doc, model: {pages: doc.model.pages.map(ref => ref.base === oldBase ? {...ref, base} : ref), objects: doc.model.objects}}]);
   return base;
  });
 }
 /** Replaces the page content with `bytes`, whose page i is the document's page i (OCR output). */
 /** Replaces pages and objects with `bytes`, a materialized copy of the whole document (compression). */
 async replaceDocument(id: string, bytes: Uint8Array, revision: number) {
  const base = await this.addBase(bytes);
  return this.serial(async () => {
   const doc = this.check(id, revision);
   if (this.bases.get(base)!.pages.length !== doc.model.pages.length) throw new Error('O resultado não corresponde às páginas do documento.');
   this.commit([{doc, model: {pages: doc.model.pages.map((ref, src) => ({...ref, base, src, rotate: 0})), objects: []}}]);
  });
 }
 async replacePages(id: string, bytes: Uint8Array, revision: number) {
  const base = await this.addBase(bytes);
  return this.serial(async () => {
   const doc = this.check(id, revision);
   if (this.bases.get(base)!.pages.length !== doc.model.pages.length) throw new Error('O resultado não corresponde às páginas do documento.');
   this.commit([{doc, model: {pages: doc.model.pages.map((ref, src) => ({...ref, base, src, rotate: 0})), objects: doc.model.objects}}]);
  });
 }
 async transfer(input: {sourceId: string; targetId: string; pages: number[]; index: number; move: boolean; sourceRevision: number; targetRevision: number}) {
  return this.serial(async () => {
   const source = this.check(input.sourceId, input.sourceRevision), target = this.check(input.targetId, input.targetRevision);
   const chosen = selected(input.pages, source.model.pages.length);
   if (!Number.isInteger(input.index) || input.index < 0 || input.index > target.model.pages.length) throw new Error('A posição de inserção está fora do documento.');
   if (source === target) {
    if (!input.move) throw new Error('Para copiar páginas no mesmo documento, use outra janela/documento.');
    const set = new Set(chosen), order = Array.from({length: source.model.pages.length}, (_, index) => index).filter(index => !set.has(index));
    order.splice(input.index - chosen.filter(page => page < input.index).length, 0, ...chosen);
    this.commit([{doc: source, model: {pages: order.map(index => source.model.pages[index]!), objects: source.model.objects}}]); return;
   }
   if (input.move && chosen.length === source.model.pages.length) throw new Error('A transferência precisa manter pelo menos uma página no documento de origem. Use copiar para transferir todas.');
   const refs = chosen.map(index => source.model.pages[index]!), copy = clonePages(source.model, refs);
   const tp = target.model.pages, targetModel: Model = {pages: [...tp.slice(0, input.index), ...copy.pages, ...tp.slice(input.index)], objects: [...target.model.objects, ...copy.objects]};
   if (!input.move) { this.commit([{doc: target, model: targetModel}]); return; }
   const removed = new Set(refs.map(ref => ref.id));
   this.commit([{doc: source, model: {pages: source.model.pages.filter(ref => !removed.has(ref.id)), objects: source.model.objects.filter(o => !removed.has(o.page))}}, {doc: target, model: targetModel}]);
  });
 }
 /** Inserts every page of another PDF at `index`. */
 async insertFile(id: string, bytes: Uint8Array, index: number, revision: number) {
  const base = await this.addBase(bytes);
  return this.serial(async () => {
   const doc = this.check(id, revision), {pages} = doc.model;
   if (!Number.isInteger(index) || index < 0 || index > pages.length) throw new Error('A posição de inserção está fora do documento.');
   const added = this.bases.get(base)!.pages.map((_, src) => ({id: randomUUID(), base, src, rotate: 0}));
   this.commit([{doc, model: {...doc.model, pages: [...pages.slice(0, index), ...added, ...pages.slice(index)]}}]);
   return added.length;
  });
 }
 /** Replaces the chosen pages, in order, with the first pages of another PDF; objects on them go too. */
 async replaceWith(id: string, chosen: number[], bytes: Uint8Array, revision: number) {
  const base = await this.addBase(bytes);
  return this.serial(async () => {
   const doc = this.check(id, revision), {pages, objects} = doc.model, list = selected(chosen, pages.length).sort((a, b) => a - b);
   const available = this.bases.get(base)!.pages.length, count = Math.min(list.length, available);
   const replaced = new Map(list.slice(0, count).map((index, n) => [index, {id: randomUUID(), base, src: n, rotate: 0}]));
   const gone = new Set([...replaced.keys()].map(index => pages[index]!.id));
   this.commit([{doc, model: {...doc.model, pages: pages.map((ref, index) => replaced.get(index) ?? ref), objects: objects.filter(o => !gone.has(o.page))}}]);
   return {count, available};
  });
 }
 /** A new document with copies of the chosen pages (and their objects). */
 extract(id: string, chosen: number[], name: string) {
  const source = this.get(id), list = selected(chosen, source.model.pages.length).sort((a, b) => a - b);
  const copy = clonePages(source.model, list.map(index => source.model.pages[index]!));
  const doc: Stored = {id: randomUUID(), name, revision: 0, savedRevision: -1, model: copy, past: [], future: []};
  this.docs.set(doc.id, doc); return doc.id;
 }
 async combine(ids: string[], name = 'Documentos combinados.pdf') {
  if (!Array.isArray(ids) || ids.length < 2) throw new Error('Abra pelo menos dois documentos para combinar.');
  const parts = ids.map(id => { const model = this.get(id).model; return clonePages(model, model.pages); });
  const doc: Stored = {id: randomUUID(), name, revision: 0, savedRevision: -1, model: {pages: parts.flatMap(part => part.pages), objects: parts.flatMap(part => part.objects)}, past: [], future: []};
  this.docs.set(doc.id, doc); return doc.id;
 }
 private restore(id: string, direction: 'undo' | 'redo') {
  const doc = this.get(id), stack = direction === 'undo' ? 'past' : 'future', destination = direction === 'undo' ? 'future' : 'past';
  const entry = doc[stack].at(-1); if (!entry) return;
  const members = entry.group ? entry.group.documents.map(member => {
   const peer = this.docs.get(member);
   if (!peer) throw new Error('Uma das partes da transferência foi fechada. Não é possível desfazer ou refazer apenas um dos documentos.');
   return peer;
  }) : [doc];
  const entries = members.map(member => {
   const top = member[stack].at(-1);
   if (!top || (entry.group ? top.group?.id !== entry.group.id : top !== entry)) {
    throw new Error(direction === 'undo'
     ? `Desfaça primeiro as alterações posteriores em “${member.name}” para desfazer esta transferência.`
     : `Refaça primeiro as alterações pendentes em “${member.name}” para refazer esta transferência.`);
   }
   return {doc: member, entry: top};
  });
  for (const item of entries) { item.doc[stack].pop(); item.doc[destination].push(item.entry); item.doc.model = direction === 'undo' ? item.entry.before : item.entry.after; item.doc.revision++; }
  this.collect();
 }
 async undo(id: string) { return this.serial(async () => this.restore(id, 'undo')); }
 async redo(id: string) { return this.serial(async () => this.restore(id, 'redo')); }
 remove(id: string) { this.docs.delete(id); this.collect(); }
}
