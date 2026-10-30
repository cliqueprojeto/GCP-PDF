import {spawn, type ChildProcessWithoutNullStreams} from 'node:child_process';
import {mkdtemp, readFile, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {privateDirectory} from './pdfcraft-sidecar';
import type {ParagraphEdit} from '../shared/types';

/** Paragraph/object positions as the engine reports them: points from the top-left of the page as
 * displayed with its own /Rotate. */
export interface EngineParagraph {index: number; text: string; rect: [number, number, number, number]; size: number; font: string}
export interface EngineImage {index: number; rect: [number, number, number, number]}
type Open = {doc: number; file: string; used: number};
const CALL_TIMEOUT = 60_000;
const MAX_OPEN = 4;

/** One long-lived `pdfcraft-cli mcp` process. Source PDFs stay open between calls, so listing a
 * page or editing a paragraph costs milliseconds instead of a process start per action. */
export class PdfCraftSession {
 private child?: ChildProcessWithoutNullStreams;
 private root?: string;
 private starting?: Promise<void>;
 private buffer = '';
 private nextId = 0;
 private waiting = new Map<number, {resolve: (value: any) => void; reject: (error: Error) => void; timer: NodeJS.Timeout}>();
 private open = new Map<string, Open>();
 private queue: Promise<unknown> = Promise.resolve();
 private files = 0;
 constructor(private executable: () => string) {}

 private serial<T>(task: () => Promise<T>): Promise<T> { const run = this.queue.then(task); this.queue = run.catch(() => {}); return run; }
 private fail(error: Error) {
  for (const pending of this.waiting.values()) { clearTimeout(pending.timer); pending.reject(error); }
  this.waiting.clear(); this.open.clear(); this.child = undefined; this.starting = undefined;
 }
 private start(): Promise<void> {
  if (this.child) return Promise.resolve();
  this.starting ??= (async () => {
   this.root ??= await mkdtemp(path.join(tmpdir(), 'gcp-pdf-engine-'));
   await privateDirectory(this.root);
   const child = spawn(this.executable(), ['mcp', '--root', this.root], {cwd: this.root, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe']});
   this.child = child;
   child.stdout.setEncoding('utf8');
   child.stdout.on('data', (chunk: string) => {
    this.buffer += chunk;
    for (let at = this.buffer.indexOf('\n'); at >= 0; at = this.buffer.indexOf('\n')) {
     const line = this.buffer.slice(0, at).trim(); this.buffer = this.buffer.slice(at + 1);
     if (!line) continue;
     let message: any; try { message = JSON.parse(line); } catch { continue; }
     const pending = this.waiting.get(message.id); if (!pending) continue;
     this.waiting.delete(message.id); clearTimeout(pending.timer);
     if (message.error) pending.reject(new Error(String(message.error.message ?? 'Falha no motor de edição.'))); else pending.resolve(message.result);
    }
   });
   child.stderr.resume();
   child.on('exit', () => { if (this.child === child) this.fail(new Error('O motor de edição foi encerrado. Tente novamente.')); });
   child.on('error', error => { if (this.child === child) this.fail(new Error('Não foi possível iniciar o motor de edição de texto.', {cause: error})); });
   await this.rpc('initialize', {protocolVersion: '2025-06-18', capabilities: {}, clientInfo: {name: 'GCP-PDF', version: '0.2'}});
   child.stdin.write(JSON.stringify({jsonrpc: '2.0', method: 'notifications/initialized'}) + '\n');
  })().catch(error => { this.fail(error instanceof Error ? error : new Error(String(error))); throw error; });
  return this.starting;
 }
 private rpc(method: string, params: unknown): Promise<any> {
  const child = this.child; if (!child) return Promise.reject(new Error('O motor de edição não está ativo.'));
  const id = ++this.nextId;
  return new Promise((resolve, reject) => {
   const timer = setTimeout(() => { this.waiting.delete(id); child.kill(); reject(new Error('O motor de edição não respondeu a tempo. O documento foi preservado.')); }, CALL_TIMEOUT);
   this.waiting.set(id, {resolve, reject, timer});
   child.stdin.write(JSON.stringify({jsonrpc: '2.0', id, method, params}) + '\n');
  });
 }
 private async call(name: string, args: Record<string, unknown>): Promise<any> {
  const result = await this.rpc('tools/call', {name, arguments: args});
  const text = result?.content?.find((item: any) => item.type === 'text')?.text ?? '';
  if (result?.isError) throw new Error(portuguese(text,name));
  try { return JSON.parse(text); } catch { return text; }
 }
 /** Opens (or reuses) the engine document holding source `base`. */
 private async document(base: string, bytes: () => Uint8Array): Promise<Open> {
  await this.start();
  const known = this.open.get(base);
  if (known) { known.used = Date.now(); return known; }
  while (this.open.size >= MAX_OPEN) {
   const [oldest, entry] = [...this.open.entries()].sort((a, b) => a[1].used - b[1].used)[0]!;
   this.open.delete(oldest);
   await this.call('doc_close', {doc: entry.doc, discard_changes: true}).catch(() => {});
   await rm(path.join(this.root!, entry.file), {force: true}).catch(() => {});
  }
  const file = `fonte-${++this.files}.pdf`;
  await writeFile(path.join(this.root!, file), bytes(), {flag: 'wx', mode: 0o600});
  const opened = await this.call('doc_open', {path: file});
  if (!opened?.editable) throw new Error(opened?.read_only_reason ? `Este PDF não permite edição: ${opened.read_only_reason}` : 'Este PDF não permite edição de texto.');
  const entry = {doc: Number(opened.doc), file, used: Date.now()};
  this.open.set(base, entry); return entry;
 }
 /** Saves the engine document in place (incremental) and returns its new bytes. The engine copy now
  * represents `nextBase`; callers register the new base id with `rekey`. */
 private async commit(base: string, entry: Open): Promise<Uint8Array> {
  try { await this.call('doc_save', {doc: entry.doc}); }
  catch (error) { this.open.delete(base); await this.call('doc_close', {doc: entry.doc, discard_changes: true}).catch(() => {}); throw error; }
  return new Uint8Array(await readFile(path.join(this.root!, entry.file)));
 }
 /** Drops an engine copy whose saved bytes were not accepted, so it is never reused as `base`. */
 forget(base: string) { return this.serial(async () => { const entry = this.open.get(base); if (!entry) return; this.open.delete(base); await this.call('doc_close', {doc: entry.doc, discard_changes: true}).catch(() => {}); await rm(path.join(this.root!, entry.file), {force: true}).catch(() => {}); }); }
 get folder() { if (!this.root) throw new Error('O motor de edição não está ativo.'); return this.root; }
 rekey(from: string, to: string) { const entry = this.open.get(from); if (entry) { this.open.delete(from); this.open.set(to, entry); } }
 objects(base: string, bytes: () => Uint8Array, page: number): Promise<{generation: number; paragraphs: EngineParagraph[]; images: EngineImage[]}> {
  return this.serial(async () => {
   const entry = await this.document(base, bytes);
   const [paragraphs, objects] = await Promise.all([this.call('text_paragraphs', {doc: entry.doc, page: page + 1}), this.call('object_list', {doc: entry.doc, page: page + 1})]);
   const rect = (value: unknown): [number, number, number, number] => { if (!Array.isArray(value) || value.length !== 4 || value.some(n => typeof n !== 'number' || !Number.isFinite(n))) throw new Error('O motor retornou uma posição inválida.'); return value as [number, number, number, number]; };
   return {
    generation: Number(objects?.generation ?? 0),
    paragraphs: (paragraphs?.paragraphs ?? []).map((p: any): EngineParagraph => ({index: Number(p.paragraph) - 1, text: String(p.editor_text ?? p.text ?? ''), rect: rect(p.rect), size: Number(p.size) || 12, font: String(p.font ?? '')})),
    images: (objects?.objects ?? []).filter((o: any) => o.kind === 'image').map((o: any): EngineImage => ({index: Number(o.index), rect: rect(o.rect)})),
   };
  });
 }
 editParagraph(base: string, bytes: () => Uint8Array, page: number, edit: ParagraphEdit & {dy?: number}) {
  return this.serial(async () => {
   const entry = await this.document(base, bytes);
   const args: Record<string, unknown> = {doc: entry.doc, page: page + 1, paragraph: edit.paragraph + 1};
   for (const key of ['text', 'size', 'bold', 'italic', 'underline', 'color', 'align', 'font', 'dx', 'dy', 'width'] as const) if (edit[key] !== undefined) args[key] = edit[key];
   // Measure with the engine's font metrics before mutation. Refuse accidental reflow into
   // neighbouring content instead of committing a taller paragraph and losing the user's layout.
   if (edit.text !== undefined && edit.font === undefined) {
    const layout = await this.call('text_edit_layout', {doc: entry.doc, page: page + 1, paragraph: edit.paragraph + 1, text: edit.text, ...(edit.width !== undefined ? {width: edit.width} : {}), ...(edit.size !== undefined ? {size: edit.size} : {})});
    const source=layout?.source_rect,draft=layout?.draft_rect;
    if(Array.isArray(source)&&source.length===4&&Array.isArray(draft)&&draft.length===4&&[...source,...draft].every(Number.isFinite)){
     const sourceHeight=Math.abs(source[3]-source[1]),draftHeight=Math.abs(draft[3]-draft[1]);
     if(draftHeight>sourceHeight+Math.max(2,sourceHeight*.4))throw new Error('O texto criaria novas linhas fora da caixa original. Aumente a largura pela alça lateral ou reduza o texto antes de aplicar. O PDF foi preservado.');
    }
   }
   try { await this.call('text_edit', args); }
   catch (error) { throw new Error(`Não foi possível aplicar a edição: ${error instanceof Error ? error.message : error}`); }
   return this.commit(base, entry);
  });
 }
 moveObjects(base: string, bytes: () => Uint8Array, page: number, input: {generation: number; objects: {kind: 'text' | 'image'; index: number}[]; dx: number; dy: number}) {
  return this.serial(async () => {
   const entry = await this.document(base, bytes);
   try { await this.call('object_move', {doc: entry.doc, page: page + 1, generation: input.generation, objects: input.objects, offset: [input.dx, input.dy]}); }
   catch (error) { throw new Error(`Não foi possível mover: ${error instanceof Error ? error.message : error}`); }
   return this.commit(base, entry);
  });
 }
 /** Lays out an XFA form (as Acrobat would) and turns it into an ordinary PDF form with its values. */
 staticForm(bytes: Uint8Array) {
  return this.serial(async () => {
   await this.start();
   const input = `xfa-${++this.files}.pdf`, output = `xfa-${this.files}-padrao.pdf`;
   await writeFile(path.join(this.root!, input), bytes, {flag: 'wx', mode: 0o600});
   let doc: number | undefined;
   try {
    doc = Number((await this.call('doc_open', {path: input}))?.doc);
    const fields = await this.call('form_fields', {doc});
    await this.call('xfa_to_static', {doc});
    await this.call('doc_save', {doc, path: output});
    return {bytes: new Uint8Array(await readFile(path.join(this.root!, output))), fields: Number(fields?.count ?? 0)};
   } finally {
    if (doc) await this.call('doc_close', {doc, discard_changes: true}).catch(() => {});
    await rm(path.join(this.root!, input), {force: true}).catch(() => {});
    await rm(path.join(this.root!, output), {force: true}).catch(() => {});
   }
  });
 }
 /** Acrobat-style "PDF Optimizer": writes a smaller copy with the given image and discard settings. */
 optimize(bytes: Uint8Array, options: Record<string, unknown>) {
  return this.serial(async () => {
   await this.start();
   const input = `otimizar-${++this.files}.pdf`, output = `otimizar-${this.files}-saida.pdf`;
   await writeFile(path.join(this.root!, input), bytes, {flag: 'wx', mode: 0o600});
   let doc: number | undefined;
   try {
    doc = Number((await this.call('doc_open', {path: input}))?.doc);
    await this.call('doc_optimize', {doc, path: output, ...options});
    return new Uint8Array(await readFile(path.join(this.root!, output)).catch(() => Buffer.from(bytes)));
   } finally {
    if (doc) await this.call('doc_close', {doc, discard_changes: true}).catch(() => {});
    await rm(path.join(this.root!, input), {force: true}).catch(() => {});
    await rm(path.join(this.root!, output), {force: true}).catch(() => {});
   }
  });
 }
 /** Runs tools on a private copy of `bytes`; `output` is the copy's save path. The open documents are untouched. */
 onCopy<T>(bytes: Uint8Array, run: (ctx: {doc: number; output: string; call: (name: string, args: Record<string, unknown>) => Promise<any>}) => Promise<T>) {
  return this.serial(async () => {
   await this.start();
   const input = `copia-${++this.files}.pdf`, output = `copia-${this.files}-saida.pdf`;
   await writeFile(path.join(this.root!, input), bytes, {flag: 'wx', mode: 0o600});
   let doc: number | undefined;
   try {
    doc = Number((await this.call('doc_open', {path: input}))?.doc);
    const result = await run({doc, output, call: (name, args) => this.call(name, args)});
    const written = await readFile(path.join(this.root!, output)).then(b => new Uint8Array(b)).catch(() => undefined);
    return {result, bytes: written};
   } finally {
    if (doc) await this.call('doc_close', {doc, discard_changes: true}).catch(() => {});
    await rm(path.join(this.root!, input), {force: true}).catch(() => {});
    await rm(path.join(this.root!, output), {force: true}).catch(() => {});
   }
  });
 }
 /** Adds a form field to a source page (rect in the page's displayed top-left points). */
 /** Edits one original image (number from page_images/object_list): move, crop, rotate, flip, replace or delete.
  * `resize` maps the visible box to a new box and moves the full placement accordingly (clipped images keep their crop). */
 imageEdit(base: string, bytes: () => Uint8Array, page: number, args: Record<string, unknown> & {image: number; action: string; from?: number[]; to?: number[]}) {
  return this.serial(async () => {
   const entry = await this.document(base, bytes);
   const {from, to, ...rest} = args;
   if (rest.action === 'resize' && from && to) {
    const list = await this.call('page_images', {doc: entry.doc, page: page + 1});
    const found = (list?.images ?? []).find((i: any) => Number(i.image) === Number(args.image));
    if (!found) throw new Error('A imagem não foi encontrada nesta página.');
    const [fx0, fy0, fx1, fy1] = found.rect as number[], sx = (to[2]! - to[0]!) / ((from[2]! - from[0]!) || 1), sy = (to[3]! - to[1]!) / ((from[3]! - from[1]!) || 1);
    const map = (x: number, y: number) => [to[0]! + (x - from[0]!) * sx, to[1]! + (y - from[1]!) * sy];
    rest.action = 'move'; rest.rect = [...map(fx0!, fy0!), ...map(fx1!, fy1!)];
   }
   try { await this.call('image_edit', {doc: entry.doc, page: page + 1, ...rest}); }
   catch (error) { throw new Error(`Não foi possível editar a imagem: ${error instanceof Error ? error.message : error}`); }
   return this.commit(base, entry);
  });
 }
 /** Writes an original raster image to `file` (inside the engine folder) without changing the document. */
 imageSave(base: string, bytes: () => Uint8Array, page: number, image: number, file: string) {
  return this.serial(async () => { const entry = await this.document(base, bytes); return this.call('image_save', {doc: entry.doc, page: page + 1, image, path: file}); });
 }
 addField(base: string, bytes: () => Uint8Array, page: number, args: Record<string, unknown>) {
  return this.serial(async () => {
   const entry = await this.document(base, bytes);
   const added = await this.call('form_add_field', {doc: entry.doc, page: page + 1, ...args});
   return {name: String(added?.field ?? ''), bytes: await this.commit(base, entry)};
  });
 }
 setFieldProps(base: string, bytes: () => Uint8Array, page: number, args: Record<string, unknown>) {
  return this.serial(async () => {
   const entry = await this.document(base, bytes);
   try { await this.call('form_set_props', {doc: entry.doc, ...args}); }
   catch (error) { throw new Error(`Não foi possível alterar o campo: ${error instanceof Error ? error.message : error}`); }
   return this.commit(base, entry);
  });
 }
 fieldActions(base: string, bytes: () => Uint8Array, page: number, field: string, actions: Record<string, unknown>[]) {
  return this.serial(async () => {
   const entry = await this.document(base, bytes);
   try { await this.call('form_set_actions', {doc: entry.doc, field, actions}); }
   catch (error) { throw new Error(`Não foi possível definir a ação do botão: ${error instanceof Error ? error.message : error}`); }
   return this.commit(base, entry);
  });
 }
 fieldImage(base: string, bytes: () => Uint8Array, page: number, field: string, image: Uint8Array, extension: string) {
  return this.serial(async () => {
   const entry = await this.document(base, bytes), file = `campo-${++this.files}${extension}`;
   await writeFile(path.join(this.root!, file), image, {flag: 'wx', mode: 0o600});
   try { await this.call('form_set_image', {doc: entry.doc, field, path: file}); }
   catch (error) { throw new Error(`Não foi possível colocar a imagem no campo: ${error instanceof Error ? error.message : error}`); }
   finally { await rm(path.join(this.root!, file), {force: true}).catch(() => {}); }
   return this.commit(base, entry);
  });
 }
 /** Every bookmark of a source, as the engine's tree (pages are 1-based source pages). */
 bookmarks(base: string, bytes: () => Uint8Array) {
  return this.serial(async () => {
   const entry = await this.document(base, bytes), all: any[] = [];
   for (let offset: number | null = 0, guard = 0; offset !== null && guard < 50; guard++) { const page = await this.call('bookmark_list', {doc: entry.doc, offset, limit: 1000}); all.push(...(page?.bookmarks ?? [])); offset = typeof page?.next === 'number' ? page.next : null; }
   return all;
  });
 }
 /** One bookmark change (or a list of adds), saved as a new revision of the source. */
 bookmarkEdit(base: string, bytes: () => Uint8Array, steps: {tool: string; args: Record<string, unknown>}[]) {
  return this.serial(async () => {
   const entry = await this.document(base, bytes);
   for (const step of steps) await this.call(step.tool, {doc: entry.doc, ...step.args});
   return this.commit(base, entry);
  });
 }
 /** Finds and creates the blanks of a printed form on the given source pages. */
 detectFields(base: string, bytes: () => Uint8Array, pages: number[]) {
  return this.serial(async () => {
   const entry = await this.document(base, bytes);
   const found = await this.call('form_detect_fields', {doc: entry.doc, pages: pages.map(p => p + 1), add: true});
   const count = Array.isArray(found?.fields) ? found.fields.length : Number(found?.count ?? 0);
   return {count, bytes: count ? await this.commit(base, entry) : bytes()};
  });
 }
 /** Adds trusted certificates (a .p7b bundle or .cer files) to the validation trust list of the running engine. */
 trustBundle(bundle: Uint8Array) {
  return this.serial(async () => {
   await this.start();
   const name = `raizes-${++this.files}.p7b`, file = path.join(this.root!, name);
   try { await writeFile(file, bundle, {flag: 'wx', mode: 0o600}); return await this.call('sign_trust', {paths: [name]}); }
   finally { await rm(file, {force: true}).catch(() => {}); }
  });
 }
 certificates() { return this.serial(async () => { await this.start(); return process.platform==='win32'?this.call('sign_windows_ids', {}):process.platform==='darwin'?this.call('sign_keychain_ids', {}):{ids:[]}; }); }
 async dispose() {
  const child = this.child; this.fail(new Error('O motor de edição foi encerrado.'));
  if (child) { child.stdin.end(); setTimeout(() => child.kill(), 1500).unref(); }
  if (this.root) await rm(this.root, {recursive: true, force: true, maxRetries: 3, retryDelay: 200}).catch(() => {});
 }
}
/** The engine reports in English; the app shows Portuguese only. Known causes get a clear message; anything
 * else a generic one (the original text goes to the log for diagnosis). */
const ENGINE_MESSAGES: [RegExp, string][] = [
 [/password|encrypt/i, 'o documento está protegido por senha ou criptografado'],
 [/read[- ]?only|not editable|permission/i, 'o documento não permite esta alteração (somente leitura ou permissões restritas)'],
 [/stale|generation|changed since/i, 'a página mudou desde a última leitura; tente de novo'],
 [/no (such )?field|field .*not found|unknown field/i, 'o campo de formulário não foi encontrado'],
 [/no (such )?page|page .*out of range|invalid page/i, 'a página indicada não existe'],
 [/(image|picture).*not found|no (such )?image/i, 'a imagem não foi encontrada nesta página'],
 [/paragraph.*(not found|out of range)|no (such )?paragraph/i, 'o parágrafo não foi encontrado; a página pode ter mudado'],
 [/text.?outline clip|clipp?ed by text/i, 'a imagem está recortada pelo contorno de um texto e não pode ser alterada assim'],
 [/font|glyph/i, 'a fonte do texto não tem todos os caracteres necessários'],
 [/signature|signed|certificate|pkcs|private key/i, 'o certificado digital não pôde ser usado (verifique o token/cartão e o PIN)'],
 [/cancel/i, 'a operação foi cancelada'],
 [/not found|no such file|cannot open|could not open/i, 'o arquivo não foi encontrado ou não pôde ser aberto'],
 [/too large|too many|limit/i, 'o conteúdo excede o limite suportado'],
 [/invalid|malformed|corrupt|unexpected/i, 'o PDF ou o pedido tem dados inválidos'],
];
function portuguese(text: string,tool?:string) {
 if (!text) return 'O motor de edição recusou a operação.';
 if(tool==='sign_document'&&/password|pkcs|pfx|decrypt|certificate|private key/i.test(text))return 'Não foi possível usar o certificado digital. Confira o arquivo A1 e sua senha ou a autorização do certificado no sistema.';
 if (/[ãçéêíóõú]/i.test(text) && !/\b(the|is|not|cannot)\b/i.test(text)) return text;
 console.warn('[GCP-PDF] motor:', text);
 const hit = ENGINE_MESSAGES.find(([re]) => re.test(text));
 return hit ? `Não foi possível concluir: ${hit[1]}.` : 'O motor de edição não conseguiu concluir esta operação neste PDF.';
}

