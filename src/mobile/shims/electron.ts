import {Buffer} from 'buffer';
import {PDFDocument} from 'pdf-lib';
import {call, hasNative, nativeInfo, request} from '../native';
import {readFile, writeFile, rm} from './fs-promises';
import {basename, dirname, extname, join} from './path';
import {fileURLToPath, pathToFileURL} from './url';

/**
 * The parts of Electron the desktop main process uses, on Android. There is one real window (the interface
 * already on screen); hidden windows only load generated HTML to print it to PDF, and "quick" windows are
 * shown by the mobile shell as full-screen sheets. IPC keeps Electron's semantics: arguments and answers are
 * copied (structured clone), never shared.
 */
type Listener = (...args: any[]) => void;
class Emitter {
  private events = new Map<string, Listener[]>();
  on(name: string, listener: Listener) { (this.events.get(name) ?? this.events.set(name, []).get(name)!).push(listener); return this; }
  once(name: string, listener: Listener) { const wrapped: Listener = (...args) => { this.off(name, wrapped); listener(...args); }; return this.on(name, wrapped); }
  off(name: string, listener: Listener) { this.events.set(name, (this.events.get(name) ?? []).filter(l => l !== listener)); return this; }
  removeListener(name: string, listener: Listener) { return this.off(name, listener); }
  emit(name: string, ...args: unknown[]) { for (const listener of [...(this.events.get(name) ?? [])]) listener(...args); return true; }
}

// ---------------------------------------------------------------- host side (mobile shell)

type HostEvent = {type: 'window'; id: number; hash: string} | {type: 'closed'; id: number} | {type: 'error'; title: string; message: string} | {type: 'fullscreen'; value: boolean};
const hostListeners = new Set<(event: HostEvent) => void>();
const channelListeners = new Map<number, Map<string, Set<(value: unknown) => void>>>();
const handlers = new Map<string, (event: unknown, ...args: unknown[]) => unknown>();
let resolveMain: (id: number) => void;
const mainReady = new Promise<number>(resolve => { resolveMain = resolve; });
const clone = <T>(value: T): T => value === undefined ? value : structuredClone(value);

export const host = {
  mainWindow: () => mainReady,
  onEvent(listener: (event: HostEvent) => void) { hostListeners.add(listener); return () => hostListeners.delete(listener); },
  async invoke(windowId: number, channel: string, args: unknown[]) {
    const handler = handlers.get(channel);
    if (!handler) throw new Error(`Ação indisponível: ${channel}`);
    const contents = WebContents.all.get(windowId);
    if (!contents) throw new Error('Esta janela foi fechada.');
    return clone(await handler({sender: contents, senderFrame: contents.mainFrame}, ...clone(args)));
  },
  listen(windowId: number, channel: string, listener: (value: unknown) => void) {
    const byWindow = channelListeners.get(windowId) ?? channelListeners.set(windowId, new Map()).get(windowId)!;
    const set = byWindow.get(channel) ?? byWindow.set(channel, new Set()).get(channel)!;
    set.add(listener);
    return () => { set.delete(listener); };
  },
  close(windowId: number) { WebContents.all.get(windowId)?.owner.close(); },
};
function hostEvent(event: HostEvent) { for (const listener of hostListeners) listener(event); }

// ---------------------------------------------------------------- app

const appEvents = new Emitter();
const paths: Record<string, string> = {};
export const app = {
  isPackaged: true,
  setName(_name: string) {},
  getName: () => 'GCP-PDF',
  getVersion: () => nativeInfo().version,
  getAppPath: () => '/android_asset/app',
  setPath(name: string, value: string) { paths[name] = value; },
  getPath(name: string): string {
    if (paths[name]) return paths[name]!;
    const info = nativeInfo();
    switch (name) {
      case 'userData': case 'appData': return join(info.files, 'userData');
      case 'temp': return info.cache;
      case 'home': return info.files;
      case 'documents': case 'downloads': case 'desktop': return join(info.files, 'Documentos');
      case 'exe': return '/gcp-pdf';
      default: return join(info.files, name);
    }
  },
  getPreferredSystemLanguages: () => nativeInfo().locales,
  getLocale: () => nativeInfo().locales[0] ?? 'pt-BR',
  requestSingleInstanceLock: () => true,
  whenReady: () => Promise.resolve(),
  on(name: string, listener: Listener) { appEvents.on(name, listener); return app; },
  quit() { if (hasNative) call('exit'); },
  exit() { app.quit(); },
  focus() {},
};

// ---------------------------------------------------------------- windows

class WebContents extends Emitter {
  static all = new Map<number, WebContents>();
  static next = 1;
  id = WebContents.next++;
  mainFrame = {};
  url = '';
  destroyed = false;
  constructor(public owner: BrowserWindow) { super(); WebContents.all.set(this.id, this); }
  getURL() { return this.url; }
  isDestroyed() { return this.destroyed; }
  send(channel: string, value: unknown) {
    const set = channelListeners.get(this.id)?.get(channel);
    if (!set?.size) return;
    const copy = clone(value);
    queueMicrotask(() => { for (const listener of set) listener(copy); });
  }
  setWindowOpenHandler() {}
  focus() {}
  async getPrintersAsync() { return [] as {name: string; displayName: string; isDefault?: boolean}[]; }
  /** Generated HTML → PDF with the device's Chromium (see HtmlPdfRenderer.kt). */
  async printToPDF(options: {pageSize?: string; displayHeaderFooter?: boolean; headerTemplate?: string; footerTemplate?: string} = {}): Promise<Buffer> {
    if (!this.owner.file) throw new Error('Nada para converter.');
    return Buffer.from(await htmlFileToPdf(this.owner.file, options));
  }
  /** System print dialog: the PDF itself, or the prepared page images. */
  print(options: {silent?: boolean; color?: boolean} = {}, callback?: (ok: boolean, reason: string) => void) {
    const file = this.owner.file;
    if (!file) { callback?.(false, 'Nada para imprimir.'); return; }
    request('print', {path: file, kind: /\.pdf$/i.test(file) ? 'pdf' : 'html', name: 'GCP-PDF', color: options.color !== false})
      .then(() => callback?.(true, ''), error => callback?.(false, String(error?.message ?? error)));
  }
}

let focused: BrowserWindow | null = null;
export class BrowserWindow extends Emitter {
  static getFocusedWindow() { return focused; }
  static getAllWindows() { return [...WebContents.all.values()].filter(c => !c.destroyed).map(c => c.owner); }
  webContents: WebContents;
  file?: string;
  private destroyedFlag = false;
  private fullscreen = false;
  private hidden: boolean;
  constructor(options: {show?: boolean; webPreferences?: {javascript?: boolean}} = {}) {
    super();
    this.webContents = new WebContents(this);
    // Windows that will show the interface are the visible ones; print/convert windows never show.
    this.hidden = options.show === false && options.webPreferences?.javascript === false || !!(options as {parent?: unknown}).parent;
  }
  private announce(hash: string) {
    this.webContents.url = pathToFileURL('/android_asset/app/dist/renderer/index.html').href + (hash ? '#' + hash : '');
    if (!hash && !focused) { focused = this; resolveMain(this.webContents.id); }
    else hostEvent({type: 'window', id: this.webContents.id, hash});
    setTimeout(() => { this.emit('ready-to-show'); this.webContents.emit('did-finish-load'); }, 0);
  }
  async loadFile(file: string, options?: {hash?: string}) {
    if (!this.hidden && /dist\/renderer\/index\.html$/.test(file)) { this.announce(options?.hash ?? ''); return; }
    this.file = file; this.webContents.url = pathToFileURL(file).href;
  }
  async loadURL(url: string) {
    if (url.startsWith('file:')) { this.file = fileURLToPath(url); this.webContents.url = url; return; }
    throw new Error('Endereço não permitido.');
  }
  show() { if (!this.hidden) focused ??= this; }
  hide() {}
  focus() {}
  blur() {}
  maximize() {} unmaximize() {} minimize() {} restore() {}
  isMaximized() { return true; } isMinimized() { return false; } isVisible() { return !this.hidden; } isFocused() { return focused === this; }
  isFullScreen() { return this.fullscreen; }
  setFullScreen(value: boolean) { this.fullscreen = value; hostEvent({type: 'fullscreen', value}); }
  setTitle(_title: string) {} setMenuBarVisibility() {} setBounds() {}
  getBounds() { return {x: 0, y: 0, width: innerWidth, height: innerHeight}; }
  isDestroyed() { return this.destroyedFlag; }
  close() {
    if (this.destroyedFlag) return;
    let prevented = false;
    this.emit('close', {preventDefault() { prevented = true; }});
    if (!prevented) this.destroy();
  }
  destroy() {
    if (this.destroyedFlag) return;
    this.destroyedFlag = true; this.webContents.destroyed = true;
    this.emit('closed');
    WebContents.all.delete(this.webContents.id); channelListeners.delete(this.webContents.id);
    if (focused === this) focused = null;
    if (!this.hidden) hostEvent({type: 'closed', id: this.webContents.id});
  }
}

// ---------------------------------------------------------------- HTML → PDF

const MM = 1000 / 25.4, PT = 1000 / 72, IN = 1000, PX = 1000 / 96, CM = 10000 / 25.4;
const NAMED: Record<string, [number, number]> = {a3: [297, 420], a4: [210, 297], a5: [148, 210], b4: [250, 353], b5: [176, 250], letter: [215.9, 279.4], legal: [215.9, 355.6], ledger: [279.4, 431.8]};
function length(value: string): number | null {
  const m = /^(-?[\d.]+)(mm|cm|in|pt|px|pc)?$/.exec(value.trim());
  if (!m) return null;
  const n = Number(m[1]);
  return n * ({mm: MM, cm: CM, in: IN, pt: PT, px: PX, pc: PT * 12}[(m[2] ?? 'px') as 'mm'] ?? PX);
}
/** The first page box the document asks for (unnamed @page first, else the first named page), in mils. */
export function pageSize(html: string): {width: number; height: number} {
  const rules = [...html.matchAll(/@page\s*([\w-]*)\s*(?::[\w-]+)?\s*\{([^}]*)\}/g)].map(m => ({name: m[1], size: /(?:^|;)\s*size\s*:\s*([^;]+)/.exec(m[2]!)?.[1]?.trim()}))
    .filter(rule => rule.size);
  const size = (rules.find(r => !r.name) ?? rules[0])?.size;
  let width = 210 * MM, height = 297 * MM;
  if (size) {
    const words = size.toLowerCase().split(/\s+/), landscape = words.includes('landscape');
    const named = words.find(w => NAMED[w]);
    if (named) { [width, height] = NAMED[named]!.map(v => v * MM) as [number, number]; }
    else {
      const numbers = words.map(length).filter((v): v is number => v !== null);
      if (numbers.length >= 1) { width = numbers[0]!; height = numbers[1] ?? numbers[0]!; }
    }
    if (landscape && width < height) [width, height] = [height, width];
    if (words.includes('portrait') && width > height) [width, height] = [height, width];
  }
  return {width: Math.max(100, Math.round(width)), height: Math.max(100, Math.round(height))};
}
const FONTS = '<link rel="stylesheet" href="/__fs/android_asset/app/fonts/fonts.css">';
const withFonts = (html: string) => /<head[^>]*>/i.test(html) ? html.replace(/<head[^>]*>/i, m => m + FONTS) : FONTS + html;

async function printHtml(file: string, html: string): Promise<{bytes: Uint8Array; size: {width: number; height: number}}> {
  const size = pageSize(html), source = file.replace(/(\.html?)?$/i, '.android.html'), output = join(dirname(file), basename(file, extname(file)) + '.android.pdf');
  await writeFile(source, withFonts(html));
  try {
    await request('html-pdf', {path: source, output, widthMils: size.width, heightMils: size.height});
    return {bytes: new Uint8Array(await readFile(output)), size};
  } finally { await rm(source, {force: true}).catch(() => {}); await rm(output, {force: true}).catch(() => {}); }
}

/** Chromium's displayHeaderFooter on Android: the templates are printed as an overlay, one page per body page,
 * with the page number and total filled in, then stamped over the body pages (vector, still selectable). */
async function htmlFileToPdf(file: string, options: {displayHeaderFooter?: boolean; headerTemplate?: string; footerTemplate?: string}): Promise<Uint8Array> {
  const html = String(await readFile(file, 'utf8'));
  const body = await printHtml(file, html);
  if (!options.displayHeaderFooter || (!options.headerTemplate && !options.footerTemplate)) return body.bytes;
  const pdf = await PDFDocument.load(body.bytes, {updateMetadata: false}), pages = pdf.getPages(), total = pages.length;
  const title = (/<title>([^<]*)<\/title>/i.exec(html)?.[1] ?? '').trim(), date = new Date().toLocaleDateString(nativeInfo().locales[0] ?? 'pt-BR');
  const fill = (template: string, n: number) => template
    .replace(/(<span[^>]*class=["'][^"']*\bpageNumber\b[^"']*["'][^>]*>)\s*(<\/span>)/g, `$1${n}$2`)
    .replace(/(<span[^>]*class=["'][^"']*\btotalPages\b[^"']*["'][^>]*>)\s*(<\/span>)/g, `$1${total}$2`)
    .replace(/(<span[^>]*class=["'][^"']*\bdate\b[^"']*["'][^>]*>)\s*(<\/span>)/g, `$1${date}$2`)
    .replace(/(<span[^>]*class=["'][^"']*\btitle\b[^"']*["'][^>]*>)\s*(<\/span>)/g, `$1${title}$2`);
  const w = body.size.width / PT, h = body.size.height / PT;
  const overlay = `<!doctype html><html><head><meta charset="utf-8"><style>@page{size:${w}pt ${h}pt;margin:0}html,body{margin:0;padding:0;background:transparent}.page{position:relative;width:${w}pt;height:${h}pt;overflow:hidden;break-after:page}.page:last-child{break-after:auto}</style></head><body>${
    Array.from({length: total}, (_, i) => `<div class="page">${options.headerTemplate ? fill(options.headerTemplate, i + 1) : ''}${options.footerTemplate ? fill(options.footerTemplate, i + 1) : ''}</div>`).join('')}</body></html>`;
  const printed = await printHtml(file.replace(/(\.html?)?$/i, '.cabecalho.html'), overlay);
  const stamps = await pdf.embedPdf(printed.bytes, Array.from({length: Math.min(total, (await PDFDocument.load(printed.bytes)).getPageCount())}, (_, i) => i));
  stamps.forEach((stamp, i) => { const page = pages[i]!; page.drawPage(stamp, {x: 0, y: page.getHeight() - stamp.height, width: stamp.width, height: stamp.height}); });
  return pdf.save();
}

// ---------------------------------------------------------------- dialogs, shell, clipboard

type Filter = {name: string; extensions: string[]};
const MIME: Record<string, string> = {
  pdf: 'application/pdf', epub: 'application/epub+zip', cbz: 'application/vnd.comicbook+zip', cbr: 'application/vnd.comicbook-rar', cb7: 'application/x-cb7',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', doc: 'application/msword', rtf: 'application/rtf', odt: 'application/vnd.oasis.opendocument.text',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', xls: 'application/vnd.ms-excel', ods: 'application/vnd.oasis.opendocument.spreadsheet',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation', ppt: 'application/vnd.ms-powerpoint', odp: 'application/vnd.oasis.opendocument.presentation',
  txt: 'text/plain', csv: 'text/csv', xml: 'text/xml', xfdf: 'application/vnd.adobe.xfdf', fdf: 'application/vnd.fdf', html: 'text/html',
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', bmp: 'image/bmp', webp: 'image/webp', tif: 'image/tiff', tiff: 'image/tiff', heic: 'image/heic',
  pfx: 'application/x-pkcs12', p12: 'application/x-pkcs12', json: 'application/json',
};
export function mimeFor(extension: string) { return MIME[extension.toLowerCase().replace(/^\./, '')] ?? 'application/octet-stream'; }
function mimesFor(filters?: Filter[]): string[] {
  const extensions = (filters ?? []).flatMap(f => f.extensions);
  if (!extensions.length || extensions.includes('*')) return ['*/*'];
  const mimes = [...new Set(extensions.map(e => MIME[e.toLowerCase()] ?? 'application/octet-stream'))];
  // Some providers label XML, certificates and data files generically: offer those too.
  if (extensions.some(e => ['xml', 'xfdf', 'fdf', 'pfx', 'p12', 'cbz', 'cbr', 'cb7', 'epub', 'csv'].includes(e))) mimes.push('application/octet-stream', 'application/xml', 'text/xml', 'application/zip', 'application/x-zip-compressed');
  return [...new Set(mimes)];
}
export const dialog = {
  async showOpenDialog(_window: unknown, options: {properties?: string[]; filters?: Filter[]} = {}) {
    if (options.properties?.includes('openDirectory')) {
      const folder = await request<string | null>('folder');
      return {canceled: !folder, filePaths: folder ? [folder] : []};
    }
    const filePaths = await request<string[]>('open', {multiple: !!options.properties?.includes('multiSelections'), mimes: mimesFor(options.filters)});
    return {canceled: !filePaths.length, filePaths};
  },
  async showSaveDialog(_window: unknown, options: {defaultPath?: string; filters?: Filter[]} = {}) {
    const name = basename(options.defaultPath ?? 'documento.pdf'), extension = extname(name).slice(1) || options.filters?.[0]?.extensions[0] || 'pdf';
    const filePath = await request<string | null>('save', {name, mime: mimeFor(extension)});
    return {canceled: !filePath, filePath: filePath ?? undefined};
  },
  showErrorBox(title: string, message: string) { console.error(title, message); hostEvent({type: 'error', title, message}); },
  async showMessageBox() { return {response: 0}; },
};
export const shell = {
  async openExternal(url: string) { await request('external', {url}); },
  showItemInFolder(path: string) { void request('share', {paths: [path], mime: mimeFor(extname(path)), title: basename(path)}); },
  async openPath(path: string) { await request('share', {paths: [path], mime: mimeFor(extname(path)), title: basename(path)}); return ''; },
};
export const clipboard = { writeText(text: string) { call('copyText', text); }, readText: () => '' };
let themeSource = 'system';
export const nativeTheme = {
  get themeSource() { return themeSource; },
  set themeSource(value: string) { themeSource = value; if (hasNative) call('chrome', value === 'dark' || (value === 'system' && nativeInfo().dark)); },
  get shouldUseDarkColors() { return themeSource === 'dark' || (themeSource === 'system' && nativeInfo().dark); },
};
const display = () => ({workArea: {x: 0, y: 0, width: innerWidth, height: innerHeight}, bounds: {x: 0, y: 0, width: innerWidth, height: innerHeight}, scaleFactor: devicePixelRatio});
export const screen = {getDisplayNearestPoint: display, getDisplayMatching: display, getPrimaryDisplay: display, getCursorScreenPoint: () => ({x: 0, y: 0})};
export const Menu = {setApplicationMenu() {}, buildFromTemplate: () => ({})};
export const session = {defaultSession: {on() {}, setPermissionRequestHandler() {}, webRequest: {onBeforeRequest() {}}}};
export const ipcMain = {
  handle(channel: string, handler: (event: unknown, ...args: unknown[]) => unknown) { handlers.set(channel, handler); },
  removeHandler(channel: string) { handlers.delete(channel); },
  on() {},
};
/** Electron's safeStorage → Android Keystore (AES-GCM, non-exportable key). */
export const safeStorage = {
  isAsyncEncryptionAvailable: async () => hasNative,
  isEncryptionAvailable: () => hasNative,
  getSelectedStorageBackend: () => 'android_keystore',
  async encryptStringAsync(text: string) { return Buffer.from(call<string>('encrypt', text), 'utf8'); },
  async decryptStringAsync(data: Uint8Array) { return {result: call<string>('decrypt', Buffer.from(data).toString('utf8')), shouldReEncrypt: false}; },
  encryptString(text: string) { return Buffer.from(call<string>('encrypt', text), 'utf8'); },
  decryptString(data: Uint8Array) { return call<string>('decrypt', Buffer.from(data).toString('utf8')); },
};
export const webUtils = {getPathForFile: () => ''};
export const contextBridge = {exposeInMainWorld() {}};
export const ipcRenderer = {invoke() { throw new Error('Indisponível.'); }, on() {}, removeListener() {}};
export {appEvents};
export default {app, BrowserWindow, dialog, shell, clipboard, nativeTheme, screen, Menu, session, ipcMain, safeStorage, webUtils, contextBridge, ipcRenderer};
