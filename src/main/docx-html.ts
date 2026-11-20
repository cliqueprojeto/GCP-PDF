import {unzipSync,strFromU8} from 'fflate';
import {DOMParser} from '@xmldom/xmldom';

/** A Word document (.docx) laid out as print-ready HTML that keeps what the document defines: page
 * size and margins of every section, fonts, sizes, colours, alignment, indents, line and paragraph
 * spacing, borders and shading, lists, tables (widths, merged cells, borders, fills, cell margins),
 * images, text boxes, headers and footers with page numbers, columns and embedded fonts. Chromium then
 * prints it as a PDF whose text stays real, selectable text. */

export interface DocxHtml { html: string; headerTemplate?: string; footerTemplate?: string }
type El = Element;
const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const A = 'http://schemas.openxmlformats.org/drawingml/2006/main';
const WP = 'http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing';
const PIC_REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const V = 'urn:schemas-microsoft-com:vml';
/** Placeholder for a tab character, laid out once the whole paragraph is known. */
const TAB = '\u0001';

const kids = (node: El | null | undefined): El[] => { const list: El[] = []; if (!node) return list; for (let c = node.firstChild; c; c = c.nextSibling) if (c.nodeType === 1) list.push(c as El); return list; };
const local = (e: El) => e.localName || e.nodeName.replace(/^.*:/, '');
const child = (node: El | null | undefined, name: string): El | null => kids(node).find(e => local(e) === name) ?? null;
const children = (node: El | null | undefined, name: string) => kids(node).filter(e => local(e) === name);
/** Attribute in the w: namespace (or unprefixed). */
function attr(node: El | null | undefined, name: string): string | null {
 if (!node) return null;
 const value = node.getAttributeNS(W, name) || node.getAttribute('w:' + name) || node.getAttribute(name);
 return value === '' ? (node.hasAttribute('w:' + name) || node.hasAttribute(name) ? '' : null) : value;
}
const num = (value: string | null | undefined, fallback = 0) => { const n = parseFloat(value ?? ''); return Number.isFinite(n) ? n : fallback; };
/** On/off properties: <w:b/>, <w:b w:val="1"/>, <w:b w:val="false"/>. */
function onOff(node: El | null): boolean | undefined { if (!node) return undefined; const v = attr(node, 'val'); return v === null || !['0', 'false', 'off', 'none'].includes(v.toLowerCase()); }
const escape = (text: string) => text.replace(/[&<>"]/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;'}[c]!));
const pt = (value: number) => `${Math.round(value * 100) / 100}pt`;
const twip = (value: string | null | undefined) => num(value) / 20;
const emu = (value: string | null | undefined) => num(value) / 12700;
const hex = (value: string | null | undefined) => value && /^[0-9a-f]{6}$/i.test(value) ? '#' + value.toLowerCase() : undefined;
const HIGHLIGHT: Record<string, string> = {yellow: '#ffff00', green: '#00ff00', cyan: '#00ffff', magenta: '#ff00ff', blue: '#0000ff', red: '#ff0000', darkBlue: '#000080', darkCyan: '#008080', darkGreen: '#008000', darkMagenta: '#800080', darkRed: '#800000', darkYellow: '#808000', darkGray: '#808080', lightGray: '#c0c0c0', black: '#000000', white: '#ffffff'};
/** Metric-compatible fonts installed on Linux and macOS take the place of the Office fonts they mirror. */
export const SUBSTITUTES: Record<string, string[]> = {
 calibri: ['Carlito'], cambria: ['Caladea'], arial: ['Liberation Sans', 'Arimo', 'Helvetica'], helvetica: ['Arial', 'Liberation Sans', 'Arimo'],
 'times new roman': ['Liberation Serif', 'Tinos', 'Times'], 'courier new': ['Liberation Mono', 'Cousine', 'Courier'], 'arial narrow': ['Liberation Sans Narrow'],
 georgia: ['Gelasio'], 'segoe ui': ['Selawik', 'Noto Sans', 'Open Sans'], tahoma: ['DejaVu Sans', 'Verdana'], verdana: ['DejaVu Sans'], 'symbol': ['OpenSymbol'],
 'century gothic': ['URW Gothic', 'TeX Gyre Adventor'], 'book antiqua': ['TeX Gyre Pagella', 'Palatino'], 'palatino linotype': ['TeX Gyre Pagella', 'Palatino'], garamond: ['EB Garamond'],
};
/** Height of a single-spaced line, as a multiple of the font size (Word uses the font's own ascent + descent). */
const LINE: Record<string, number> = {calibri: 1.22, carlito: 1.22, cambria: 1.172, caladea: 1.172, arial: 1.149, 'liberation sans': 1.149, helvetica: 1.149, 'times new roman': 1.15, 'liberation serif': 1.15, 'courier new': 1.133, 'segoe ui': 1.33, georgia: 1.136, verdana: 1.215, tahoma: 1.207, 'century gothic': 1.225, lato: 1.2, 'open sans': 1.362, roboto: 1.172, inter: 1.21};
export const lineFactor = (font: string) => LINE[font.toLowerCase()] ?? 1.17;

interface RunProps { font?: string; size?: number; bold?: boolean; italic?: boolean; underline?: string; strike?: boolean; dstrike?: boolean; color?: string; highlight?: string; shading?: string; vertAlign?: string; caps?: boolean; smallCaps?: boolean; spacing?: number; hidden?: boolean; position?: number; scale?: number; outline?: boolean; shadow?: boolean; emboss?: boolean }
interface Border { style: string; width: number; color: string; space: number }
interface ParaProps { align?: string; before?: number; after?: number; beforeAuto?: boolean; afterAuto?: boolean; line?: number; lineRule?: string; left?: number; right?: number; firstLine?: number; hanging?: number; borders: Partial<Record<'top' | 'bottom' | 'left' | 'right' | 'between', Border>>; shading?: string; numId?: string; ilvl?: number; pageBreakBefore?: boolean; keepNext?: boolean; contextual?: boolean; tabs: {pos: number; align: string; leader?: string}[]; styleId?: string; outline?: number; widowControl?: boolean; bidi?: boolean }
interface Style { type: string; basedOn?: string; ppr?: El | null; rpr?: El | null; tblPr?: El | null; tcPr?: El | null; trPr?: El | null; conditional: Map<string, {ppr?: El | null; rpr?: El | null; tcPr?: El | null; tblPr?: El | null}>; link?: string }

class Package {
 files: Record<string, Uint8Array>;
 constructor(bytes: Uint8Array) { this.files = unzipSync(bytes); }
 text(path: string) { const f = this.files[path]; return f ? strFromU8(f) : null; }
 xml(path: string): Document | null { const t = this.text(path); if (!t) return null; return new DOMParser({onError: () => {}} as never).parseFromString(t, 'text/xml') as unknown as Document; }
 rels(part: string): Map<string, {target: string; external: boolean; type: string}> {
  const slash = part.lastIndexOf('/'), dir = part.slice(0, slash + 1), relPath = dir + '_rels/' + part.slice(slash + 1) + '.rels', doc = this.xml(relPath), map = new Map();
  if (!doc) return map;
  for (const rel of Array.from(doc.getElementsByTagName('Relationship'))) {
   const target = rel.getAttribute('Target') ?? '', external = rel.getAttribute('TargetMode') === 'External';
   map.set(rel.getAttribute('Id'), {target: external ? target : resolvePath(dir, target), external, type: rel.getAttribute('Type') ?? ''});
  }
  return map;
 }
}
function resolvePath(dir: string, target: string) {
 const parts = (target.startsWith('/') ? target.slice(1) : dir + target).split('/'), out: string[] = [];
 for (const p of parts) { if (p === '..') out.pop(); else if (p !== '.' && p !== '') out.push(p); }
 return out.join('/');
}
const MIME: Record<string, string> = {png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', bmp: 'image/bmp', svg: 'image/svg+xml', webp: 'image/webp', tif: 'image/tiff', tiff: 'image/tiff'};

export function docxToHtml(bytes: Uint8Array): DocxHtml {
 let pkg: Package;
 try { pkg = new Package(bytes); } catch { throw new Error('O arquivo Word está danificado ou não é um documento .docx válido.'); }
 return new Renderer(pkg).render();
}

class Renderer {
 doc: Document; styles = new Map<string, Style>(); defaultPara = 'Normal'; defaultTable?: string; defaultChar?: string;
 docRPr: El | null = null; docPPr: El | null = null; themeFonts: Record<string, string> = {}; themeColors: Record<string, string> = {};
 numbering = new Map<string, {abstract: El | null; overrides: Map<number, {start?: number; lvl?: El}>}>(); abstracts = new Map<string, El>();
 counters = new Map<string, number[]>(); defaultTab = 36; rels: Map<string, {target: string; external: boolean; type: string}>; part = 'word/document.xml';
 fontFaces: string[] = []; fontFamilies = new Map<string, string>(); footnotes = new Map<string, El>(); endnotes = new Map<string, El>(); notes: string[] = []; noteCount = 0;
 pageRules: string[] = []; page = this.geometry(null);
 /** Sizes of the text runs of the paragraph being laid out. */
 sizes: {size: number; font?: string}[] = [];
 /** Word version the document is laid out for (15 = Word 2013 and later). */
 compatMode = 15;
 /** List instances (numId) already used, for restarts. */
 listsSeen = new Set<string>();
 constructor(public pkg: Package) {
  const main = this.mainPart();
  this.part = main;
  const doc = pkg.xml(main);
  if (!doc) throw new Error('O arquivo Word está vazio ou danificado.');
  this.doc = doc; this.rels = pkg.rels(main);
  const dir = main.slice(0, main.lastIndexOf('/') + 1);
  const byType = (suffix: string) => [...this.rels.values()].find(r => r.type.endsWith('/' + suffix))?.target;
  this.loadTheme(byType('theme') ?? dir + 'theme/theme1.xml');
  this.loadStyles(byType('styles') ?? dir + 'styles.xml');
  this.loadNumbering(byType('numbering') ?? dir + 'numbering.xml');
  this.loadSettings(byType('settings') ?? dir + 'settings.xml');
  this.loadFonts(byType('fontTable') ?? dir + 'fontTable.xml');
  this.loadNotes(byType('footnotes'), this.footnotes, 'footnote');
  this.loadNotes(byType('endnotes'), this.endnotes, 'endnote');
 }
 mainPart() {
  const rels = this.pkg.xml('_rels/.rels');
  for (const rel of Array.from(rels?.getElementsByTagName('Relationship') ?? [])) if ((rel.getAttribute('Type') ?? '').endsWith('/officeDocument')) return resolvePath('', rel.getAttribute('Target') ?? '');
  return 'word/document.xml';
 }
 loadTheme(path: string) {
  const theme = this.pkg.xml(path); if (!theme) return;
  const scheme = theme.getElementsByTagNameNS(A, 'fontScheme')[0] as El | undefined;
  for (const [kind, key] of [['majorFont', 'major'], ['minorFont', 'minor']] as const) {
   const font = scheme && child(scheme, kind);
   if (font) { this.themeFonts[key + 'HAnsi'] = this.themeFonts[key + 'Ascii'] = child(font, 'latin')?.getAttribute('typeface') ?? ''; this.themeFonts[key + 'EastAsia'] = child(font, 'ea')?.getAttribute('typeface') || this.themeFonts[key + 'Ascii']!; this.themeFonts[key + 'Bidi'] = child(font, 'cs')?.getAttribute('typeface') || this.themeFonts[key + 'Ascii']!; }
  }
  const colors = theme.getElementsByTagNameNS(A, 'clrScheme')[0] as El | undefined;
  for (const c of kids(colors)) { const value = child(c, 'srgbClr')?.getAttribute('val') ?? child(c, 'sysClr')?.getAttribute('lastClr'); if (value) this.themeColors[local(c)] = value; }
 }
 loadStyles(path: string) {
  const doc = this.pkg.xml(path); if (!doc) return;
  const root = doc.documentElement as unknown as El, defaults = child(root, 'docDefaults');
  this.docRPr = child(child(defaults, 'rPrDefault'), 'rPr'); this.docPPr = child(child(defaults, 'pPrDefault'), 'pPr');
  for (const s of children(root, 'style')) {
   const id = attr(s, 'styleId') ?? '', type = attr(s, 'type') ?? 'paragraph', conditional = new Map();
   for (const c of children(s, 'tblStylePr')) conditional.set(attr(c, 'type') ?? '', {ppr: child(c, 'pPr'), rpr: child(c, 'rPr'), tcPr: child(c, 'tcPr'), tblPr: child(c, 'tblPr')});
   this.styles.set(id, {type, basedOn: attr(child(s, 'basedOn'), 'val') ?? undefined, ppr: child(s, 'pPr'), rpr: child(s, 'rPr'), tblPr: child(s, 'tblPr'), tcPr: child(s, 'tcPr'), trPr: child(s, 'trPr'), conditional, link: attr(child(s, 'link'), 'val') ?? undefined});
   if (['1', 'true', 'on'].includes((attr(s, 'default') ?? '').toLowerCase())) { if (type === 'paragraph') this.defaultPara = id; else if (type === 'table') this.defaultTable = id; else if (type === 'character') this.defaultChar = id; }
  }
 }
 loadNumbering(path: string) {
  const doc = this.pkg.xml(path); if (!doc) return;
  const root = doc.documentElement as unknown as El;
  for (const a of children(root, 'abstractNum')) this.abstracts.set(attr(a, 'abstractNumId') ?? '', a);
  for (const n of children(root, 'num')) {
   const overrides = new Map<number, {start?: number; lvl?: El}>();
   for (const o of children(n, 'lvlOverride')) overrides.set(num(attr(o, 'ilvl')), {start: child(o, 'startOverride') ? num(attr(child(o, 'startOverride'), 'val')) : undefined, lvl: child(o, 'lvl') ?? undefined});
   let abstract = this.abstracts.get(attr(child(n, 'abstractNumId'), 'val') ?? '') ?? null;
   const link = attr(child(abstract, 'numStyleLink'), 'val');
   if (link) { const styleNum = attr(child(child(this.styles.get(link)?.ppr, 'numPr'), 'numId'), 'val'); const target = [...children(root, 'num')].find(x => attr(x, 'numId') === styleNum); if (target) abstract = this.abstracts.get(attr(child(target, 'abstractNumId'), 'val') ?? '') ?? abstract; }
   this.numbering.set(attr(n, 'numId') ?? '', {abstract, overrides});
  }
 }
 loadSettings(path: string) {
  const doc = this.pkg.xml(path); if (!doc) return;
  const root = doc.documentElement as unknown as El, tab = child(root, 'defaultTabStop'); if (tab) this.defaultTab = twip(attr(tab, 'val')) || 36;
  const mode = children(child(root, 'compat'), 'compatSetting').find(c => attr(c, 'name') === 'compatibilityMode');
  this.compatMode = num(attr(mode, 'val'), child(root, 'compat') ? 12 : 15);
 }
 /** Fonts embedded in the document (obfuscated per ECMA-376 §17.8.1) become @font-face rules. */
 loadFonts(path: string) {
  const doc = this.pkg.xml(path); if (!doc) return;
  const rels = this.pkg.rels(path);
  for (const font of children(doc.documentElement as unknown as El, 'font')) {
   const name = attr(font, 'name') ?? ''; const family = attr(child(font, 'family'), 'val');
   if (family) this.fontFamilies.set(name.toLowerCase(), family);
   for (const [tag, weight, style] of [['embedRegular', 400, 'normal'], ['embedBold', 700, 'normal'], ['embedItalic', 400, 'italic'], ['embedBoldItalic', 700, 'italic']] as const) {
    const e = child(font, tag); if (!e) continue;
    const rel = rels.get(e.getAttributeNS(R, 'id') || e.getAttribute('r:id') || ''), data = rel && this.pkg.files[rel.target]; if (!data) continue;
    const key = (attr(e, 'fontKey') ?? '').replace(/[{}-]/g, ''); if (key.length !== 32) continue;
    const bytes = new Uint8Array(data), guid = Array.from({length: 16}, (_, i) => parseInt(key.slice(30 - i * 2, 32 - i * 2), 16));
    for (let i = 0; i < 32; i++) bytes[i]! ^= guid[i % 16]!;
    this.fontFaces.push(`@font-face{font-family:"${name.replace(/"/g, '')}";src:url(data:font/ttf;base64,${Buffer.from(bytes).toString('base64')});font-weight:${weight};font-style:${style}}`);
   }
  }
 }
 loadNotes(path: string | undefined, into: Map<string, El>, tag: string) {
  const doc = path && this.pkg.xml(path); if (!doc) return;
  for (const n of children(doc.documentElement as unknown as El, tag)) { const type = attr(n, 'type'); if (!type || type === 'normal') into.set(attr(n, 'id') ?? '', n); }
 }

 // ── Style resolution ────────────────────────────────────────────────────────────────────────────
 chain(id: string | undefined, seen = new Set<string>()): Style[] { if (!id || seen.has(id)) return []; seen.add(id); const s = this.styles.get(id); return s ? [...this.chain(s.basedOn, seen), s] : []; }
 runProps(base: RunProps, rpr: El | null | undefined): RunProps {
  if (!rpr) return base;
  const p = {...base};
  for (const e of kids(rpr)) {
   const name = local(e), val = attr(e, 'val');
   switch (name) {
    case 'rFonts': { const theme = attr(e, 'asciiTheme') ?? attr(e, 'hAnsiTheme'); const font = (theme && this.themeFonts[theme.replace(/^(major|minor)/, '$1')]) || attr(e, 'ascii') || attr(e, 'hAnsi') || attr(e, 'cs') || attr(e, 'eastAsia'); if (font) p.font = font; break; }
    case 'sz': p.size = num(val, 22) / 2; break;
    case 'b': p.bold = onOff(e); break;
    case 'i': p.italic = onOff(e); break;
    case 'u': p.underline = val ?? 'single'; break;
    case 'strike': p.strike = onOff(e); break;
    case 'dstrike': p.dstrike = onOff(e); break;
    case 'color': { const theme = attr(e, 'themeColor'); const c = val && val !== 'auto' ? hex(val) : theme && this.themeColors[theme.replace(/^text1$/, 'dk1').replace(/^text2$/, 'dk2').replace(/^background1$/, 'lt1').replace(/^background2$/, 'lt2')] ? hex(this.themeColors[theme.replace(/^text1$/, 'dk1').replace(/^text2$/, 'dk2').replace(/^background1$/, 'lt1').replace(/^background2$/, 'lt2')]) : undefined; p.color = val === 'auto' ? undefined : c ?? p.color; break; }
    case 'highlight': p.highlight = val && val !== 'none' ? HIGHLIGHT[val] : undefined; break;
    case 'shd': { const fill = attr(e, 'fill'); p.shading = fill && fill !== 'auto' ? hex(fill) : undefined; break; }
    case 'vertAlign': p.vertAlign = val ?? undefined; break;
    case 'caps': p.caps = onOff(e); break;
    case 'smallCaps': p.smallCaps = onOff(e); break;
    case 'spacing': p.spacing = twip(val); break;
    case 'vanish': p.hidden = onOff(e); break;
    case 'position': p.position = num(val) / 2; break;
    case 'w': p.scale = num(val, 100) / 100; break;
    case 'outline': p.outline = onOff(e); break;
    case 'shadow': p.shadow = onOff(e); break;
    case 'emboss': case 'imprint': p.emboss = onOff(e); break;
   }
  }
  return p;
 }
 paraProps(base: ParaProps, ppr: El | null | undefined): ParaProps {
  if (!ppr) return base;
  const p: ParaProps = {...base, borders: {...base.borders}, tabs: [...base.tabs]};
  for (const e of kids(ppr)) {
   const name = local(e), val = attr(e, 'val');
   switch (name) {
    case 'jc': p.align = val ?? undefined; break;
    case 'spacing':
     if (attr(e, 'before') !== null) p.before = twip(attr(e, 'before'));
     if (attr(e, 'after') !== null) p.after = twip(attr(e, 'after'));
     if (attr(e, 'beforeLines') !== null && attr(e, 'before') === null) p.before = num(attr(e, 'beforeLines')) / 100 * 12;
     if (attr(e, 'afterLines') !== null && attr(e, 'after') === null) p.after = num(attr(e, 'afterLines')) / 100 * 12;
     if (attr(e, 'beforeAutospacing') !== null) p.beforeAuto = !['0', 'false', 'off'].includes(attr(e, 'beforeAutospacing')!);
     if (attr(e, 'afterAutospacing') !== null) p.afterAuto = !['0', 'false', 'off'].includes(attr(e, 'afterAutospacing')!);
     if (attr(e, 'line') !== null) { p.line = num(attr(e, 'line')); p.lineRule = attr(e, 'lineRule') ?? 'auto'; }
     break;
    case 'ind': {
     const left = attr(e, 'left') ?? attr(e, 'start'), right = attr(e, 'right') ?? attr(e, 'end');
     if (left !== null) p.left = twip(left); if (right !== null) p.right = twip(right);
     if (attr(e, 'leftChars') !== null && left === null) p.left = num(attr(e, 'leftChars')) / 100 * 12;
     if (attr(e, 'hanging') !== null) { p.hanging = twip(attr(e, 'hanging')); p.firstLine = undefined; }
     if (attr(e, 'firstLine') !== null) { p.firstLine = twip(attr(e, 'firstLine')); p.hanging = undefined; }
     break;
    }
    case 'pBdr': for (const side of kids(e)) { const b = this.border(side); const key = local(side) === 'start' ? 'left' : local(side) === 'end' ? 'right' : local(side); if (['top', 'bottom', 'left', 'right', 'between'].includes(key)) p.borders[key as 'top'] = b ?? undefined; } break;
    case 'shd': { const fill = attr(e, 'fill'); p.shading = fill && fill !== 'auto' ? hex(fill) : undefined; break; }
    case 'numPr': { const id = attr(child(e, 'numId'), 'val'); if (id !== null) p.numId = id; const lvl = attr(child(e, 'ilvl'), 'val'); if (lvl !== null) p.ilvl = num(lvl); break; }
    case 'pageBreakBefore': p.pageBreakBefore = onOff(e); break;
    case 'keepNext': p.keepNext = onOff(e); break;
    case 'contextualSpacing': p.contextual = onOff(e); break;
    case 'widowControl': p.widowControl = onOff(e); break;
    case 'bidi': p.bidi = onOff(e); break;
    case 'outlineLvl': p.outline = num(val); break;
    case 'tabs': for (const t of children(e, 'tab')) { const pos = twip(attr(t, 'pos')), align = attr(t, 'val') ?? 'left'; p.tabs = p.tabs.filter(x => Math.abs(x.pos - pos) > .5); if (align !== 'clear') p.tabs.push({pos, align, leader: attr(t, 'leader') ?? undefined}); } p.tabs.sort((a, b) => a.pos - b.pos); break;
   }
  }
  return p;
 }
 border(e: El | null | undefined): Border | null {
  if (!e) return null;
  const style = attr(e, 'val') ?? 'single'; if (['nil', 'none'].includes(style)) return null;
  const color = attr(e, 'color'), theme = attr(e, 'themeColor');
  return {style, width: Math.max(num(attr(e, 'sz'), 4) / 8, .25), color: (color && color !== 'auto' ? hex(color) : theme && hex(this.themeColors[theme])) ?? '#000000', space: num(attr(e, 'space'))};
 }
 cssBorder(b: Border | null | undefined) {
  if (!b) return 'none';
  const style = /double|triple/i.test(b.style) ? 'double' : /dot/i.test(b.style) && !/dash/i.test(b.style) ? 'dotted' : /dash/i.test(b.style) ? 'dashed' : /inset/.test(b.style) ? 'inset' : /outset/.test(b.style) ? 'outset' : 'solid';
  const width = style === 'double' ? Math.max(b.width * 3, 1.5) : /thick/i.test(b.style) ? Math.max(b.width, 1.5) : b.width;
  return `${pt(width)} ${style} ${b.color}`;
 }
 /** Run properties of a paragraph style (with its base styles), on top of the document defaults. */
 styleRun(styleId: string | undefined, base?: RunProps): RunProps {
  let p = base ?? this.runProps({font: this.themeFonts.minorHAnsi || 'Calibri', size: 10}, this.docRPr);
  for (const s of this.chain(styleId)) p = this.runProps(p, s.rpr);
  return p;
 }
 stylePara(styleId: string | undefined): ParaProps {
  let p = this.paraProps({borders: {}, tabs: []}, this.docPPr);
  for (const s of this.chain(styleId)) p = this.paraProps(p, s.ppr);
  return p;
 }

 // ── Text ────────────────────────────────────────────────────────────────────────────────────────
 fontStack(font: string | undefined) {
  if (!font) return 'sans-serif';
  const subs = SUBSTITUTES[font.toLowerCase()] ?? [], family = this.fontFamilies.get(font.toLowerCase());
  const generic = family === 'roman' ? 'serif' : family === 'modern' ? 'monospace' : family === 'script' ? 'cursive' : /serif|times|roman|garamond|georgia|cambria|book|palatino|caladea/i.test(font) && !/sans/i.test(font) ? 'serif' : /mono|courier|consol/i.test(font) ? 'monospace' : 'sans-serif';
  // Single quotes: the list goes inside style="…" attributes.
  return [font, ...subs].map(f => `'${f.replace(/["'<>&]/g, '')}'`).join(',') + ',' + generic;
 }
 runCss(p: RunProps, paragraphRun?: RunProps) {
  const css: string[] = [];
  if (!paragraphRun || p.font !== paragraphRun.font) css.push(`font-family:${this.fontStack(p.font)}`);
  const size = p.size ?? 11, small = p.vertAlign === 'superscript' || p.vertAlign === 'subscript';
  if (!paragraphRun || size !== paragraphRun.size || small) css.push(`font-size:${pt(small ? size * .65 : size)}`);
  if (small) css.push(`vertical-align:${p.vertAlign === 'superscript' ? 'super' : 'sub'};line-height:0`);
  if (!!p.bold !== !!paragraphRun?.bold || !paragraphRun) css.push(`font-weight:${p.bold ? 700 : 400}`);
  if (!!p.italic !== !!paragraphRun?.italic || !paragraphRun) css.push(`font-style:${p.italic ? 'italic' : 'normal'}`);
  if ((p.color ?? '#000000') !== (paragraphRun?.color ?? '#000000') || !paragraphRun) css.push(`color:${p.color ?? '#000000'}`);
  const lines: string[] = [];
  if (p.underline && p.underline !== 'none') lines.push('underline');
  if (p.strike || p.dstrike) lines.push('line-through');
  if (lines.length) { css.push(`text-decoration:${lines.join(' ')}`); const u = p.underline ?? ''; if (/double/.test(u) || p.dstrike) css.push('text-decoration-style:double'); else if (/dot/.test(u)) css.push('text-decoration-style:dotted'); else if (/dash/.test(u)) css.push('text-decoration-style:dashed'); else if (/wave/.test(u)) css.push('text-decoration-style:wavy'); if (/thick|heavy/.test(u)) css.push('text-decoration-thickness:2px'); }
  if (p.highlight || p.shading) css.push(`background-color:${p.highlight ?? p.shading}`);
  if (p.caps) css.push('text-transform:uppercase');
  if (p.smallCaps) css.push('font-variant:small-caps');
  if (p.spacing) css.push(`letter-spacing:${pt(p.spacing)}`);
  if (p.position) css.push(`position:relative;top:${pt(-p.position)}`);
  if (p.scale && p.scale !== 1) css.push(`display:inline-block;transform:scaleX(${p.scale});transform-origin:left`);
  if (p.outline) css.push('-webkit-text-stroke:.5pt currentColor;color:transparent');
  if (p.shadow) css.push('text-shadow:1px 1px 0 rgba(0,0,0,.45)');
  if (p.emboss) css.push('text-shadow:-1px -1px 0 #fff,1px 1px 0 rgba(0,0,0,.4)');
  return css.join(';');
 }

 // ── Document ────────────────────────────────────────────────────────────────────────────────────
 render(): DocxHtml {
  const body = child(this.doc.documentElement as unknown as El, 'body');
  if (!body) throw new Error('O arquivo Word não tem conteúdo legível.');
  // Sections: each group of blocks ends with a paragraph carrying a sectPr, or with the body's sectPr.
  const sections: {blocks: El[]; sect: El | null}[] = [];
  let current: El[] = [];
  for (const block of kids(body)) {
   if (local(block) === 'sectPr') { sections.push({blocks: current, sect: block}); current = []; continue; }
   current.push(block);
   const inner = local(block) === 'p' ? child(child(block, 'pPr'), 'sectPr') : null;
   if (inner) { sections.push({blocks: current, sect: inner}); current = []; }
  }
  if (current.length) sections.push({blocks: current, sect: null});
  const last = sections.at(-1)?.sect ?? null;
  const parts: string[] = [];
  let header: string | undefined, footer: string | undefined, firstGeometry: ReturnType<Renderer['geometry']> | undefined;
  let headerSect: El | null = null, footerSect: El | null = null;
  sections.forEach((section, index) => {
   const sect = section.sect ?? last, g = this.geometry(sect), name = `s${index}`;
   this.page = g;
   // Like Word, a header or footer taller than its margin pushes the body text away from it.
   // A section without its own header or footer keeps the previous section's.
   if (children(sect, 'headerReference').length) headerSect = sect; if (children(sect, 'footerReference').length) footerSect = sect;
   g.top = Math.max(g.top, g.header + this.partHeight(headerSect, 'header')); g.bottom = Math.max(g.bottom, g.footer + this.partHeight(footerSect, 'footer'));
   firstGeometry ??= g;
   this.pageRules.push(`@page ${name}{size:${pt(g.width)} ${pt(g.height)};margin:${pt(g.top)} ${pt(g.right)} ${pt(g.bottom)} ${pt(g.left)}}`);
   const type = attr(child(sect, 'type'), 'val');
   const breakBefore = index > 0 && type !== 'continuous' ? 'break-before:page;' : '';
   const cols = child(sect, 'cols'), count = num(attr(cols, 'num'), 1);
   const columns = count > 1 ? `column-count:${count};column-gap:${pt(twip(attr(cols, 'space') ?? '720'))};${attr(cols, 'sep') && !['0', 'false', 'off'].includes(attr(cols, 'sep')!) ? 'column-rule:.5pt solid #000;' : ''}` : '';
   const content = this.blocks(section.blocks, g.width - g.left - g.right);
   // Notes close the section they belong to.
   const notes = this.notes.length ? `<div class="notes">${this.notes.join('')}</div>` : ''; this.notes = [];
   // "Different first page" with a header only for the first page (letterhead): drawn on page 1 alone, in
   // place of the page's top margin.
   let firstHeader = '';
   if (index === 0 && attr(child(sect, 'titlePg'), 'val') !== '0' && child(sect, 'titlePg') && !children(sect, 'headerReference').some(r => (attr(r, 'type') ?? 'default') === 'default')) {
    const block = this.partContent(sect, 'header', 'first', g);
    if (block) { firstHeader = `<div style="height:${pt(Math.max(g.top, g.header + this.partHeight(sect, 'header', 'first')))};box-sizing:border-box;padding-top:${pt(g.header)};overflow:visible">${block}</div>`; this.pageRules.push(`@page ${name}:first{margin-top:0}`); }
   }
   parts.push(`<section style="page:${name};${breakBefore}${columns}">${firstHeader}${content}${notes}</section>`);
   if (index === 0) { header = this.headerFooter(headerSect, 'header', g); footer = this.headerFooter(footerSect, 'footer', g); }
  });
  const background = hex(attr(child(this.doc.documentElement as unknown as El, 'background'), 'color'));
  const defaults = this.styleRun(this.defaultPara);
  const css = [
   ...this.fontFaces,
   ...this.pageRules,
   `@page{size:${pt(firstGeometry!.width)} ${pt(firstGeometry!.height)};margin:${pt(firstGeometry!.top)} ${pt(firstGeometry!.right)} ${pt(firstGeometry!.bottom)} ${pt(firstGeometry!.left)}}`,
   `html,body{margin:0;padding:0;${background ? `background:${background};` : ''}-webkit-print-color-adjust:exact;print-color-adjust:exact}`,
   `body{font-family:${this.fontStack(defaults.font)};font-size:${pt(defaults.size ?? 11)};color:#000;font-kerning:normal;text-rendering:geometricPrecision;orphans:2;widows:2}`,
   'p{margin:0;padding:0;overflow-wrap:break-word;white-space:pre-wrap;tab-size:36pt}',
   'table{border-collapse:collapse;border-spacing:0}td{padding:0;vertical-align:top;overflow-wrap:break-word}',
   '.tab{display:inline-block}.anchor{position:relative;height:0;width:0;display:inline}.anchored{position:absolute}',
   'img{display:inline-block}.notes{margin-top:12pt;border-top:.5pt solid #000;width:33%;padding-top:4pt}.notes p{font-size:9pt}',
   'a{color:inherit;text-decoration:inherit}tr{break-inside:avoid}',
   // Word lets a line end a hair past the margin (it lays out in twips); without this slack a justified
   // line that fits in Word would wrap one word earlier.
   'section{display:block;margin-right:-.75pt}',
  ].join('\n');
  return {html: `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><style>${css}</style></head><body>${parts.join('')}</body></html>`, headerTemplate: header, footerTemplate: footer};
 }
 geometry(sect: El | null) {
  const size = child(sect, 'pgSz'), margin = child(sect, 'pgMar');
  let width = twip(attr(size, 'w') ?? '11906'), height = twip(attr(size, 'h') ?? '16838');
  if (attr(size, 'orient') === 'landscape' && width < height) [width, height] = [height, width];
  const gutter = twip(attr(margin, 'gutter'));
  return {width, height, top: Math.abs(twip(attr(margin, 'top') ?? '1440')), bottom: Math.abs(twip(attr(margin, 'bottom') ?? '1440')), left: twip(attr(margin, 'left') ?? '1440') + gutter, right: twip(attr(margin, 'right') ?? '1440'), header: twip(attr(margin, 'header') ?? '720'), footer: twip(attr(margin, 'footer') ?? '720')};
 }
 /** Approximate height of a header or footer: its lines, pictures, spacing and borders. */
 partHeight(sect: El | null, kind: 'header' | 'footer', type?: 'first'): number {
  const refs = children(sect, kind + 'Reference'), ref = refs.find(r => attr(r, 'type') === (type ?? 'default')) ?? (type ? undefined : refs.find(r => !attr(r, 'type')));
  const rel = ref && this.rels.get(ref.getAttributeNS(R, 'id') || ref.getAttribute('r:id') || ''), doc = rel && this.pkg.xml(rel.target);
  if (!doc) return 0;
  const para = (p: El): number => {
   const ppr = child(p, 'pPr'), props = this.paraProps(this.stylePara(attr(child(ppr, 'pStyle'), 'val') ?? this.defaultPara), ppr), base = this.styleRun(attr(child(ppr, 'pStyle'), 'val') ?? this.defaultPara);
   let size = base.size ?? 11, picture = 0;
   for (const r of Array.from(p.getElementsByTagNameNS(W, 'r'))) { const sz = child(child(r as El, 'rPr'), 'sz'); if (sz) size = Math.max(size, num(attr(sz, 'val')) / 2); }
   for (const e of Array.from(p.getElementsByTagNameNS(WP, 'inline'))) picture = Math.max(picture, emu(child(e as El, 'extent')?.getAttribute('cy')));
   const line = props.line !== undefined && props.lineRule === 'exact' ? props.line / 20 : size * lineFactor(base.font ?? '') * (props.line !== undefined && props.lineRule !== 'atLeast' ? props.line / 240 : 1);
   const b = props.borders;
   return Math.max(line, picture) + (props.before ?? 0) + (props.after ?? 0) + (b.top ? b.top.space + b.top.width : 0) + (b.bottom ? b.bottom.space + b.bottom.width : 0);
  };
  const block = (e: El): number => local(e) === 'p' ? para(e) : local(e) === 'tbl' ? children(e, 'tr').reduce((t, tr) => t + Math.max(...children(tr, 'tc').map(tc => kids(tc).reduce((h, k) => h + block(k), 0)), 0), 0) : local(e) === 'sdt' ? kids(child(e, 'sdtContent')).reduce((h, k) => h + block(k), 0) : 0;
  return kids(doc.documentElement as unknown as El).reduce((h, e) => h + block(e), 0);
 }
 /** The content of one header or footer part (first, even or default), laid out as body HTML. */
 partContent(sect: El | null, kind: 'header' | 'footer', type: string, g: ReturnType<Renderer['geometry']>): string | undefined {
  const ref = children(sect, kind + 'Reference').find(r => attr(r, 'type') === type);
  const rel = ref && this.rels.get(ref.getAttributeNS(R, 'id') || ref.getAttribute('r:id') || ''), doc = rel && this.pkg.xml(rel.target);
  if (!rel || !doc) return undefined;
  const savedRels = this.rels, savedPart = this.part; this.rels = this.pkg.rels(rel.target); this.part = rel.target;
  const content = this.blocks(kids(doc.documentElement as unknown as El), g.width - g.left - g.right, true);
  this.rels = savedRels; this.part = savedPart;
  return content.replace(/<[^>]+>/g, '').trim() || /<img|<svg/.test(content) ? content : undefined;
 }
 /** Chromium prints header and footer templates inside the page margins; page fields become its counters. */
 headerFooter(sect: El | null, kind: 'header' | 'footer', g: ReturnType<Renderer['geometry']>) {
  // Only the header that repeats on every page: a first-page or even-page header must not repeat.
  const refs = children(sect, kind + 'Reference'), ref = refs.find(r => attr(r, 'type') === 'default') ?? refs.find(r => !attr(r, 'type'));
  if (!ref) return undefined;
  const rel = this.rels.get(ref.getAttributeNS(R, 'id') || ref.getAttribute('r:id') || ''), doc = rel && this.pkg.xml(rel.target);
  if (!doc) return undefined;
  const savedRels = this.rels, savedPart = this.part; this.rels = this.pkg.rels(rel.target); this.part = rel.target;
  const content = this.blocks(kids(doc.documentElement as unknown as El), g.width - g.left - g.right, true);
  this.rels = savedRels; this.part = savedPart;
  if (!content.replace(/<[^>]+>/g, '').trim() && !/<img|<svg|class="pageNumber"/.test(content)) return undefined;
  const defaults = this.styleRun(this.defaultPara);
  const position = kind === 'header' ? `top:${pt(g.header)}` : `bottom:${pt(g.footer)}`;
  return `<style>${this.fontFaces.join('')}p{margin:0;white-space:pre-wrap}table{border-collapse:collapse}td{padding:0;vertical-align:top}.tab{display:inline-block}img{display:inline-block}.anchor{position:relative;height:0;width:0;display:inline}.anchored{position:absolute}</style><div style="position:absolute;left:${pt(g.left)};right:${pt(g.right)};${position};font-family:${this.fontStack(defaults.font)};font-size:${pt(defaults.size ?? 11)};color:#000;-webkit-print-color-adjust:exact">${content}</div>`;
 }
 blocks(list: El[], width: number, inHeader = false): string {
  const out: string[] = [];
  let previous: {style?: string; contextual?: boolean; after: number} | undefined;
  for (const block of list) {
   const name = local(block);
   if (name === 'p') { const r = this.paragraph(block, width, previous, inHeader); out.push(r.html); previous = r.info; }
   else if (name === 'tbl') { out.push(this.table(block, width, inHeader)); previous = undefined; }
   else if (name === 'sdt') { out.push(this.blocks(kids(child(block, 'sdtContent')), width, inHeader)); }
   else if (['customXml', 'ins', 'moveTo'].includes(name)) out.push(this.blocks(kids(block), width, inHeader));
   else if (name === 'AlternateContent') out.push(this.blocks(kids(child(block, 'Choice') ?? child(block, 'Fallback')), width, inHeader));
  }
  return out.join('');
 }

 // ── Paragraphs ──────────────────────────────────────────────────────────────────────────────────
 paragraph(p: El, width: number, previous: {style?: string; contextual?: boolean; after: number} | undefined, inHeader: boolean, tableStyle?: {ppr?: El | null; rpr?: El | null}[]) {
  const ppr = child(p, 'pPr'), styleId = attr(child(ppr, 'pStyle'), 'val') ?? this.defaultPara;
  let props = this.stylePara(styleId);
  if (tableStyle) for (const t of tableStyle) props = this.paraProps(props, t.ppr);
  props = this.paraProps(props, ppr);
  let runBase = this.styleRun(undefined);
  if (tableStyle) for (const t of tableStyle) runBase = this.runProps(runBase, t.rpr);
  runBase = this.styleRun(styleId, runBase);
  const markRun = this.runProps(runBase, child(ppr, 'rPr'));
  // List marker and its indents.
  let marker = '', markerCss = '';
  const numId = props.numId, ilvl = props.ilvl ?? 0;
  if (numId && numId !== '0') {
   const lvl = this.level(numId, ilvl);
   if (lvl) {
    const lvlProps = this.paraProps({borders: {}, tabs: []}, child(lvl, 'pPr'));
    // Indents set directly on the paragraph win over the list level's.
    const direct = this.paraProps({borders: {}, tabs: []}, ppr), styleOnly = this.stylePara(styleId);
    if (direct.left === undefined) props.left = lvlProps.left ?? styleOnly.left;
    if (direct.hanging === undefined && direct.firstLine === undefined) { props.hanging = lvlProps.hanging; props.firstLine = lvlProps.firstLine; }
    const text = this.markerText(numId, ilvl, lvl), mrun = this.runProps(markRun, child(lvl, 'rPr'));
    const suffix = attr(child(lvl, 'suff'), 'val') ?? 'tab', align = attr(child(lvl, 'lvlJc'), 'val') ?? 'left';
    if (text !== null) {
     const hanging = props.hanging ?? 0;
     const boxWidth = suffix === 'tab' ? Math.max(hanging, 0) : 0;
     markerCss = this.runCss({...mrun, underline: undefined, highlight: undefined, shading: undefined});
     const content = escape(text) + (suffix === 'space' ? ' ' : '');
     marker = suffix === 'tab' && boxWidth > 0
      ? `<span style="display:inline-block;min-width:${pt(boxWidth)};${align === 'right' ? `margin-left:${pt(-boxWidth)};text-align:right;padding-right:${pt(Math.min(boxWidth, 7))};box-sizing:border-box;` : align === 'center' ? 'text-align:center;' : ''}text-indent:0;${markerCss}">${content}</span>`
      : `<span style="${markerCss}">${content}${suffix === 'tab' ? ' ' : ''}</span>`;
    }
   }
  }
  const left0 = props.left ?? 0, start = left0 + (props.hanging !== undefined ? -props.hanging : props.firstLine ?? 0) + (marker ? Math.max(props.hanging ?? 0, 0) : 0);
  const savedSizes = this.sizes; this.sizes = [];
  const pieces = this.tabs(this.inlines(kids(p), markRun, runBase, props, width, inHeader), props, start, width);
  // Like Word, a line is as tall as the text on it: the paragraph's own size (its strut) is that of its
  // smallest text, and only an empty paragraph takes the size of its paragraph mark.
  const smallest = this.sizes.reduce<{size: number; font?: string} | undefined>((a, b) => !a || b.size < a.size ? b : a, undefined);
  const blockSize = smallest?.size ?? markRun.size ?? 11, blockFont = smallest?.font ?? markRun.font; this.sizes = savedSizes;
  const empty = !pieces.trim() || /^(<span[^>]*><\/span>)*$/.test(pieces);
  const factor = lineFactor(blockFont ?? runBase.font ?? '');
  const css: string[] = [];
  const align = props.align === 'both' || props.align === 'distribute' || props.align === 'thaiDistribute' || props.align === 'lowKashida' || props.align === 'mediumKashida' || props.align === 'highKashida' ? 'justify' : props.align === 'center' ? 'center' : props.align === 'right' || props.align === 'end' ? 'right' : 'left';
  if (align !== 'left') css.push(`text-align:${align}`);
  if (props.align === 'distribute') css.push('text-align-last:justify');
  // Word 2013+ fits a justified line by shrinking its spaces by up to a fifth before wrapping a word;
  // narrower spaces give the same line breaks, and justification widens them back on full lines.
  if (align === 'justify' && this.compatMode >= 15) css.push('word-spacing:-.05em');
  if (props.bidi) css.push('direction:rtl');
  // Line height: "auto" is a multiple of the font's natural single spacing; exact/atLeast are points.
  if (props.line !== undefined) {
   if (props.lineRule === 'exact') css.push(`line-height:${pt(props.line / 20)};max-height:none`);
   else if (props.lineRule === 'atLeast') css.push(`line-height:${pt(Math.max(props.line / 20, blockSize * factor))}`);
   else css.push(`line-height:${Math.round(props.line / 240 * factor * 1000) / 1000}`);
  } else css.push(`line-height:${factor}`);
  let before = props.beforeAuto ? 14 : props.before ?? 0, after = props.afterAuto ? 14 : props.after ?? 0;
  if (previous && props.contextual && previous.contextual !== undefined && previous.style === styleId) before = 0;
  const left = props.left ?? 0, right = props.right ?? 0, indent = props.hanging !== undefined ? -props.hanging : props.firstLine ?? 0;
  const b = props.borders, shaded = !!props.shading;
  if (left || b.left) css.push(`margin-left:${pt(left - (b.left ? b.left.space + b.left.width : 0))}`);
  if (right || b.right) css.push(`margin-right:${pt(right - (b.right ? b.right.space + b.right.width : 0))}`);
  if (indent) css.push(`text-indent:${pt(indent)}`);
  // Word adds the space after one paragraph to the space before the next; CSS margins would collapse
  // to the larger one, so unbordered spacing goes into padding.
  if (b.top || shaded) { if (before) css.push(`margin-top:${pt(before)}`); css.push(`border-top:${this.cssBorder(b.top)};padding-top:${pt(b.top?.space ?? 0)}`); }
  else if (before) css.push(`padding-top:${pt(before)}`);
  if (b.bottom || shaded) { if (after) css.push(`margin-bottom:${pt(after)}`); css.push(`border-bottom:${this.cssBorder(b.bottom)};padding-bottom:${pt(b.bottom?.space ?? 0)}`); }
  else if (after) css.push(`padding-bottom:${pt(after)}`);
  if (b.left) css.push(`border-left:${this.cssBorder(b.left)};padding-left:${pt(b.left.space)}`);
  if (b.right) css.push(`border-right:${this.cssBorder(b.right)};padding-right:${pt(b.right.space)}`);
  if (shaded) css.push(`background-color:${props.shading}`);
  if (props.pageBreakBefore && !inHeader) css.push('break-before:page');
  if (props.keepNext) css.push('break-after:avoid');
  if (props.widowControl === false) css.push('orphans:1;widows:1');
  css.push(this.runCss({...markRun, size: blockSize, font: blockFont, vertAlign: undefined}));
  const filler = empty ? `<span style="font-size:${pt(markRun.size ?? 11)}">​</span>` : '';
  const tag = !inHeader && props.outline !== undefined && props.outline < 6 ? `h${props.outline + 1}` : 'p';
  const html = `<${tag} style="${css.filter(Boolean).join(';')}${tag !== 'p' ? ';margin-block:0;font-weight:inherit;white-space:pre-wrap' : ''}">${marker}${pieces}${filler}</${tag}>`;
  return {html, info: {style: styleId, contextual: props.contextual, after}};
 }
 level(numId: string, ilvl: number): El | null {
  const n = this.numbering.get(numId); if (!n) return null;
  const override = n.overrides.get(ilvl)?.lvl;
  return override ?? children(n.abstract, 'lvl').find(l => num(attr(l, 'ilvl')) === ilvl) ?? null;
 }
 markerText(numId: string, ilvl: number, lvl: El): string | null {
  const n = this.numbering.get(numId)!, abstractId = attr(n.abstract, 'abstractNumId') ?? numId;
  // Like Word, lists that share an abstract numbering continue each other's count; a list instance that
  // overrides a level's start restarts that level the first time it is used.
  const key = abstractId, counters = this.counters.get(key) ?? [];
  const startOf = (level: number) => { const o = n.overrides.get(level); if (o?.start !== undefined) return o.start; const l = this.level(numId, level); return num(attr(child(l, 'start'), 'val'), 1); };
  if (!this.listsSeen.has(numId)) {
   this.listsSeen.add(numId);
   for (const [level, o] of n.overrides) if (o.start !== undefined) for (let i = level; i < 9; i++) counters[i] = undefined as never;
  }
  counters[ilvl] = counters[ilvl] === undefined ? startOf(ilvl) : counters[ilvl]! + 1;
  for (let i = ilvl + 1; i < 9; i++) counters[i] = undefined as never;
  for (let i = 0; i < ilvl; i++) if (counters[i] === undefined) counters[i] = startOf(i);
  this.counters.set(key, counters);
  const format = attr(child(lvl, 'numFmt'), 'val') ?? 'decimal', text = attr(child(lvl, 'lvlText'), 'val');
  if (text === null) return null;
  if (format === 'none') return text.replace(/%\d/g, '');
  if (format === 'bullet') return bulletGlyph(text, attr(child(child(lvl, 'rPr'), 'rFonts'), 'ascii'));
  return text.replace(/%(\d)/g, (_, d) => { const i = Number(d) - 1, l = this.level(numId, i); const f = i === ilvl ? format : attr(child(l, 'numFmt'), 'val') ?? 'decimal'; const legal = onOff(child(lvl, 'isLgl')); return formatNumber(counters[i] ?? startOf(i), legal ? 'decimal' : f); });
 }
 /** Runs, links, fields, notes and drawings of one paragraph. */
 inlines(nodes: El[], paraRun: RunProps, runBase: RunProps, props: ParaProps, width: number, inHeader: boolean): string {
  const out: string[] = [];
  type Field = {instr: string; phase: 'instr' | 'result'; skip?: boolean};
  let field: Field | null = null; const stack: Field[] = [];
  const visit = (node: El, link?: string) => {
   const name = local(node);
   if (name === 'r') {
    const rpr = child(node, 'rPr'), charStyle = attr(child(rpr, 'rStyle'), 'val');
    let run = runBase;
    if (charStyle) for (const s of this.chain(charStyle)) run = this.runProps(run, s.rpr);
    run = this.runProps(run, rpr);
    for (const c of kids(node)) {
     const cn = local(c);
     if (cn === 'fldChar') {
      const type = attr(c, 'fldCharType');
      if (type === 'begin') { if (field) stack.push(field); field = {instr: '', phase: 'instr'}; }
      else if (type === 'separate' && field) { field.phase = 'result'; const page = pageField(field.instr); if (page && inHeader) { out.push(`<span style="${this.runCss(run, paraRun)}" class="${page}"></span>`); field.phase = 'instr'; field.skip = true; } }
      else if (type === 'end') { if (field && !field.skip && field.phase === 'instr') { const page = pageField(field.instr); if (page && inHeader) out.push(`<span style="${this.runCss(run, paraRun)}" class="${page}"></span>`); } field = stack.pop() ?? null; }
      continue;
     }
     if (cn === 'instrText') { if (field) field.instr += c.textContent ?? ''; continue; }
     if (field && field.phase === 'instr') continue;
     if (run.hidden) continue;
     if (cn === 't' && c.textContent) this.sizes.push({size: run.vertAlign === 'superscript' || run.vertAlign === 'subscript' ? (run.size ?? 11) * .65 : run.size ?? 11, font: run.font});
     out.push(this.runContent(c, run, undefined, props, width, link, inHeader));
    }
    return;
   }
   if (field && field.phase === 'instr' && name !== 'fldSimple') { if (['hyperlink', 'smartTag', 'ins', 'customXml', 'sdt', 'sdtContent'].includes(name)) for (const k of kids(node)) visit(k, link); return; }
   if (name === 'hyperlink') {
    const rel = this.rels.get(node.getAttributeNS(R, 'id') || node.getAttribute('r:id') || ''), anchor = attr(node, 'anchor');
    const href = rel?.external ? rel.target : anchor ? '#' + anchor : undefined;
    const inner: string[] = []; const saved = out.length;
    for (const k of kids(node)) visit(k, href);
    if (href && /^(https?:|mailto:|#)/i.test(href)) { inner.push(...out.splice(saved)); out.push(`<a href="${escape(href)}">${inner.join('')}</a>`); }
    return;
   }
   if (name === 'fldSimple') {
    const page = pageField(attr(node, 'instr') ?? '');
    if (page && inHeader) { const r = child(node, 'r'); const run = this.runProps(runBase, child(r, 'rPr')); out.push(`<span style="${this.runCss(run, paraRun)}" class="${page}"></span>`); return; }
    for (const k of kids(node)) visit(k, link); return;
   }
   if (['smartTag', 'ins', 'customXml', 'moveTo', 'dir', 'bdo'].includes(name)) { for (const k of kids(node)) visit(k, link); return; }
   if (name === 'sdt') { for (const k of kids(child(node, 'sdtContent'))) visit(k, link); return; }
   if (name === 'AlternateContent') { for (const k of kids(child(node, 'Choice') ?? child(node, 'Fallback'))) visit(k, link); return; }
   if (name === 'oMath' || name === 'oMathPara') { out.push(`<span style="font-family:'Cambria Math','STIX Two Math',serif;font-style:italic">${escape(node.textContent ?? '')}</span>`); return; }
  };
  for (const node of nodes) if (local(node) !== 'pPr') visit(node);
  return out.join('');
 }
 runContent(c: El, run: RunProps, paraRun: RunProps | undefined, props: ParaProps, width: number, link: string | undefined, inHeader: boolean): string {
  const cn = local(c), css = this.runCss(run, paraRun), wrap = (html: string) => css ? `<span style="${css}">${html}</span>` : html;
  switch (cn) {
   // A tab typed inside the text is a tab like <w:tab/>.
   case 't': return (c.textContent ?? '').split('\t').map(part => part ? wrap(escape(part)) : '').join(TAB);
   case 'tab': return TAB;
   case 'br': { const type = attr(c, 'type'); if (type === 'page' && !inHeader) return '<span style="display:block;break-after:page"></span>'; if (type === 'column') return '<span style="display:block;break-after:column"></span>'; return '<br>'; }
   case 'cr': return '<br>';
   case 'noBreakHyphen': return wrap('‑');
   case 'softHyphen': return '­';
   case 'sym': { const code = parseInt(attr(c, 'char') ?? '', 16); const font = attr(c, 'font') ?? ''; if (!Number.isFinite(code)) return ''; const ch = /symbol|wingdings/i.test(font) ? symbolGlyph(code, font) : String.fromCodePoint(code >= 0xf000 ? code - 0xf000 : code); return wrap(escape(ch)); }
   case 'footnoteReference': case 'endnoteReference': {
    const id = attr(c, 'id') ?? '', note = (cn === 'footnoteReference' ? this.footnotes : this.endnotes).get(id); const n = ++this.noteCount;
    if (note) { const saved = this.rels, savedPart = this.part; const part = [...this.rels.values()].find(r => r.type.endsWith(cn === 'footnoteReference' ? '/footnotes' : '/endnotes'))?.target; if (part) this.rels = this.pkg.rels(part); this.notes.push(`<div id="note${n}">${this.blocks(kids(note), width).replace(/<span[^>]*class="noteRef"[^>]*><\/span>/, `<sup>${n}</sup> `)}</div>`); this.rels = saved; this.part = savedPart; }
    return `<sup style="font-size:${pt((run.size ?? 11) * .65)}">${n}</sup>`;
   }
   case 'footnoteRef': case 'endnoteRef': return '<span class="noteRef"></span>';
   case 'drawing': return this.drawing(c, width);
   case 'pict': case 'object': return this.vml(c, width);
   case 'AlternateContent': { const choice = child(c, 'Choice') ?? child(c, 'Fallback'); return kids(choice).map(k => this.runContent(k, run, paraRun, props, width, link, inHeader)).join(''); }
   case 'ptab': return wrap(`<span class="tab" style="width:${pt(this.defaultTab)}"></span>`);
  }
  return '';
 }
 /** Tabs, laid out without measuring text: each tab closes a box that reaches its stop. A left stop
  * pads the text before it up to the stop; a right, centre or decimal stop shares one box with the text
  * after it, pushed against the stop; leaders fill the gap with dots, dashes or a line. */
 tabs(html: string, props: ParaProps, start: number, width: number): string {
  if (!html.includes(TAB)) return html;
  const segments = html.split(TAB);
  // Splitting must not cut through an element (a link that spans a tab, for instance).
  const balanced = segments.every(s => (s.match(/<(span|a|sup|sub)\b/g)?.length ?? 0) === (s.match(/<\/(span|a|sup|sub)>/g)?.length ?? 0));
  if (!balanced) return html.replaceAll(TAB, `<span class="tab" style="min-width:${pt(this.defaultTab / 2)}"></span>`);
  const stops = props.tabs.filter(t => t.align !== 'bar' && t.align !== 'num');
  const leaderCss = (leader?: string) => !leader || leader === 'none' ? ''
   : leader === 'dot' || leader === 'middleDot' ? `align-self:stretch;margin:0 1pt;background:radial-gradient(circle,currentColor .75pt,transparent .95pt) 0 ${leader === 'dot' ? '80%' : '55%'}/4pt 4pt repeat-x;`
   : `border-bottom:${leader === 'heavy' ? '1.5pt solid' : leader === 'underscore' ? '.75pt solid' : '.75pt dashed'} currentColor;margin:0 2pt .25em;`;
  let position = start, out = segments[0]!;
  for (let i = 1; i < segments.length; i++) {
   // The next stop after the current position: a custom one, the hanging indent, or a default stop.
   let stop = stops.find(t => t.pos > position + .5);
   if (!stop && props.hanging && (props.left ?? 0) > position + .5) stop = {pos: props.left!, align: 'left'};
   if (!stop) stop = {pos: (Math.floor(position / this.defaultTab + 1e-6) + 1) * this.defaultTab, align: 'left'};
   // The box holds everything since the start of the line, so it reaches from there to the stop.
   const pos = stop.pos, span = Math.max(pos - start, 0);
   if (stop.align === 'left' || stop.align === 'start') {
    out = `<span style="display:inline-flex;align-items:baseline;min-width:${pt(span)};text-indent:0;white-space:pre">${out}<span style="flex:1;${leaderCss(stop.leader)}"></span></span>`;
   } else {
    const text = segments[i]!; segments[i] = '';
    const justify = `<span style="flex:1;${leaderCss(stop.leader)}"></span><span style="white-space:pre">${text}</span>`;
    out = `<span style="display:inline-flex;align-items:baseline;min-width:${pt(span)};text-indent:0;white-space:pre">${out}${justify}</span>`;
   }
   position = pos;
   out += segments[i];
  }
  return out;
 }

 // ── Pictures and text boxes ─────────────────────────────────────────────────────────────────────
 image(id: string | null): string | null {
  if (!id) return null;
  const rel = this.rels.get(id); if (!rel || rel.external) return null;
  const data = this.pkg.files[rel.target]; if (!data) return null;
  const ext = rel.target.split('.').pop()!.toLowerCase(), mime = MIME[ext]; if (!mime) return null;
  return `data:${mime};base64,${Buffer.from(data).toString('base64')}`;
 }
 drawing(d: El, width: number): string {
  const holder = child(d, 'inline') ?? child(d, 'anchor'); if (!holder) return '';
  const inline = local(holder) === 'inline', extent = child(holder, 'extent');
  let w = emu(extent?.getAttribute('cx')), h = emu(extent?.getAttribute('cy'));
  const graphic = holder.getElementsByTagNameNS(A, 'graphicData')[0] as El | undefined;
  let inner = '';
  const blip = holder.getElementsByTagNameNS(A, 'blip')[0] as El | undefined;
  const xfrm = holder.getElementsByTagNameNS(A, 'xfrm')[0] as El | undefined, rot = num(xfrm?.getAttribute('rot')) / 60000, flipH = xfrm?.getAttribute('flipH') === '1', flipV = xfrm?.getAttribute('flipV') === '1';
  const transform = rot || flipH || flipV ? `transform:${rot ? `rotate(${rot}deg)` : ''}${flipH ? ' scaleX(-1)' : ''}${flipV ? ' scaleY(-1)' : ''};` : '';
  if (blip) {
   const src = this.image(blip.getAttributeNS(R, 'embed') || blip.getAttribute('r:embed'));
   const crop = holder.getElementsByTagNameNS(A, 'srcRect')[0] as El | undefined;
   if (src) {
    const l = num(crop?.getAttribute('l')) / 1e5, t = num(crop?.getAttribute('t')) / 1e5, r = num(crop?.getAttribute('r')) / 1e5, b = num(crop?.getAttribute('b')) / 1e5;
    inner = l || t || r || b
     ? `<span style="display:inline-block;overflow:hidden;width:${pt(w)};height:${pt(h)};position:relative;${transform}"><img src="${src}" style="position:absolute;left:${pt(-w * l / (1 - l - r))};top:${pt(-h * t / (1 - t - b))};width:${pt(w / (1 - l - r))};height:${pt(h / (1 - t - b))}"></span>`
     : `<img src="${src}" style="width:${pt(w)};height:${pt(h)};${transform}">`;
   }
  } else if (graphic) {
   const shape = graphic.getElementsByTagNameNS('http://schemas.microsoft.com/office/word/2010/wordprocessingShape', 'wsp')[0] as El | undefined;
   if (shape) inner = this.shape(shape, w, h, transform);
   else { const group = graphic.getElementsByTagNameNS('http://schemas.microsoft.com/office/word/2010/wordprocessingGroup', 'wgp')[0] as El | undefined; if (group) inner = this.group(group, w, h); }
  }
  if (!inner) return '';
  if (inline) return `<span style="display:inline-block;vertical-align:baseline;line-height:0">${inner}</span>`;
  // Floating: offsets from the margin/column or the paragraph, in front of or behind the text.
  const pos = (axis: 'positionH' | 'positionV') => { const e = child(holder, axis), offset = child(e, 'posOffset'), align = child(e, 'align'); return {from: e?.getAttribute('relativeFrom') ?? '', offset: offset ? emu(offset.textContent) : undefined, align: align?.textContent?.trim()}; };
  const ph = pos('positionH'), pv = pos('positionV');
  const behind = holder.getAttribute('behindDoc') === '1', wrapNone = !!child(holder, 'wrapNone'), topBottom = !!child(holder, 'wrapTopAndBottom'), square = child(holder, 'wrapSquare') ?? child(holder, 'wrapTight') ?? child(holder, 'wrapThrough');
  const page = this.page;
  let left = ph.offset ?? 0;
  if (ph.from === 'page' && ph.offset !== undefined) left -= page.left;
  if (ph.align) left = ph.align === 'center' ? (width - w) / 2 : ph.align === 'right' || ph.align === 'outside' ? width - w : 0;
  const top = pv.offset ?? 0;
  if (topBottom) return `<span style="display:block;margin-left:${pt(Math.max(left, 0))};line-height:0">${inner}</span>`;
  if (square && !wrapNone) { const side = ph.align === 'right' || left > width / 2 ? 'right' : 'left'; return `<span style="float:${side};margin:${pt(Math.max(top, 0))} ${side === 'left' ? '9pt' : '0'} 4pt ${side === 'right' ? '9pt' : pt(Math.max(left, 0))};line-height:0">${inner}</span>`; }
  const topCss = pv.from === 'paragraph' || pv.from === 'line' || pv.offset === undefined ? pt(top) : pt(top - (pv.from === 'page' ? page.top : 0));
  return `<span class="anchor"><span class="anchored" style="left:${pt(left)};top:${pv.from === 'paragraph' || pv.from === 'line' ? topCss : pt(0)};z-index:${behind ? -1 : 1};line-height:0">${inner}</span></span>`;
 }
 fill(spPr: El | null | undefined): string {
  if (!spPr) return '';
  const solid = child(spPr, 'solidFill'), grad = child(spPr, 'gradFill');
  if (child(spPr, 'noFill')) return 'background:transparent;';
  if (solid) return `background:${this.drawingColor(solid) ?? 'transparent'};`;
  if (grad) { const stops = children(child(grad, 'gsLst'), 'gs').map(g => `${this.drawingColor(g) ?? '#fff'} ${num(g.getAttribute('pos')) / 1000}%`); const angle = num(child(grad, 'lin')?.getAttribute('ang')) / 60000; return stops.length ? `background:linear-gradient(${angle + 90}deg,${stops.join(',')});` : ''; }
  return '';
 }
 drawingColor(holder: El | null): string | undefined {
  const c = kids(holder).find(e => ['srgbClr', 'schemeClr', 'sysClr', 'prstClr'].includes(local(e))); if (!c) return undefined;
  let value = local(c) === 'srgbClr' ? c.getAttribute('val') : local(c) === 'sysClr' ? c.getAttribute('lastClr') : local(c) === 'schemeClr' ? this.themeColors[{tx1: 'dk1', tx2: 'dk2', bg1: 'lt1', bg2: 'lt2'}[c.getAttribute('val') ?? ''] ?? c.getAttribute('val') ?? ''] : ({black: '000000', white: 'ffffff', red: 'ff0000', blue: '0000ff', green: '008000'} as Record<string, string>)[c.getAttribute('val') ?? ''];
  if (!value) return undefined;
  let [r, g, b] = [0, 2, 4].map(i => parseInt(value!.slice(i, i + 2), 16)) as [number, number, number];
  for (const m of kids(c)) { const v = num(m.getAttribute('val')) / 1e5; if (local(m) === 'lumMod') [r, g, b] = [r * v, g * v, b * v]; else if (local(m) === 'lumOff') [r, g, b] = [r + 255 * v, g + 255 * v, b + 255 * v]; else if (local(m) === 'tint') [r, g, b] = [255 - (255 - r) * v, 255 - (255 - g) * v, 255 - (255 - b) * v]; else if (local(m) === 'shade') [r, g, b] = [r * v, g * v, b * v]; }
  const alpha = child(c, 'alpha'), clamp = (x: number) => Math.max(0, Math.min(255, Math.round(x)));
  return alpha ? `rgba(${clamp(r)},${clamp(g)},${clamp(b)},${num(alpha.getAttribute('val')) / 1e5})` : '#' + [r, g, b].map(x => clamp(x).toString(16).padStart(2, '0')).join('');
 }
 shape(wsp: El, w: number, h: number, transform: string): string {
  const spPr = child(wsp, 'spPr'), ln = child(spPr, 'ln'), geom = child(spPr, 'prstGeom')?.getAttribute('prst') ?? 'rect';
  const line = ln && !child(ln, 'noFill') ? `border:${pt(Math.max(num(ln.getAttribute('w'), 9525) / 12700, .25))} solid ${this.drawingColor(child(ln, 'solidFill')) ?? '#000'};box-sizing:border-box;` : '';
  const radius = geom === 'ellipse' ? 'border-radius:50%;' : geom === 'roundRect' ? 'border-radius:12%;' : '';
  const body = child(wsp, 'bodyPr'), inset = (n: string, d: number) => pt(body?.getAttribute(n) ? emu(body.getAttribute(n)) : d);
  const anchor = body?.getAttribute('anchor'), box = child(child(wsp, 'txbx'), 'txbxContent');
  const text = box ? this.blocks(kids(box), w) : '';
  if (geom === 'line' || geom === 'straightConnector1') return `<span style="display:inline-block;width:${pt(w)};height:${pt(h)};border-top:${ln ? pt(Math.max(num(ln.getAttribute('w'), 9525) / 12700, .25)) : '.75pt'} solid ${this.drawingColor(child(ln, 'solidFill')) ?? '#000'};${transform}"></span>`;
  return `<span style="display:inline-flex;flex-direction:column;justify-content:${anchor === 'ctr' ? 'center' : anchor === 'b' ? 'flex-end' : 'flex-start'};width:${pt(w)};min-height:${pt(h)};padding:${inset('tIns', 3.6)} ${inset('rIns', 7.2)} ${inset('bIns', 3.6)} ${inset('lIns', 7.2)};box-sizing:border-box;line-height:normal;vertical-align:top;${this.fill(spPr)}${line}${radius}${transform}">${text}</span>`;
 }
 group(wgp: El, w: number, h: number): string {
  const xfrm = child(child(wgp, 'grpSpPr'), 'xfrm'), chOff = child(xfrm, 'chOff'), chExt = child(xfrm, 'chExt');
  const ox = num(chOff?.getAttribute('x')), oy = num(chOff?.getAttribute('y')), sx = w / (emu(chExt?.getAttribute('cx')) || w || 1), sy = h / (emu(chExt?.getAttribute('cy')) || h || 1);
  const items = kids(wgp).filter(e => ['wsp', 'pic', 'grpSp'].includes(local(e))).map(e => {
   const x = e.getElementsByTagNameNS(A, 'xfrm')[0] as El | undefined, off = child(x, 'off'), ext = child(x, 'ext');
   const iw = emu(ext?.getAttribute('cx')) * sx, ih = emu(ext?.getAttribute('cy')) * sy, il = (num(off?.getAttribute('x')) - ox) / 12700 * sx, it = (num(off?.getAttribute('y')) - oy) / 12700 * sy;
   let html = '';
   if (local(e) === 'wsp') html = this.shape(e, iw, ih, '');
   else { const blip = e.getElementsByTagNameNS(A, 'blip')[0] as El | undefined; const src = blip && this.image(blip.getAttributeNS(R, 'embed') || blip.getAttribute('r:embed')); if (src) html = `<img src="${src}" style="width:${pt(iw)};height:${pt(ih)}">`; }
   return `<span style="position:absolute;left:${pt(il)};top:${pt(it)}">${html}</span>`;
  });
  return `<span style="display:inline-block;position:relative;width:${pt(w)};height:${pt(h)}">${items.join('')}</span>`;
 }
 vml(node: El, width: number): string {
  const data = node.getElementsByTagNameNS(V, 'imagedata')[0] as El | undefined, shape = node.getElementsByTagNameNS(V, 'shape')[0] as El | undefined;
  const style = shape?.getAttribute('style') ?? '', dim = (k: string) => { const m = new RegExp(k + ':\\s*([\\d.]+)(pt|in|px|cm|mm)?').exec(style); if (!m) return undefined; const v = parseFloat(m[1]!); return m[2] === 'in' ? v * 72 : m[2] === 'cm' ? v * 72 / 2.54 : m[2] === 'mm' ? v * 72 / 25.4 : m[2] === 'px' ? v * .75 : v; };
  if (data) { const src = this.image(data.getAttributeNS(R, 'id') || data.getAttribute('r:id')); if (src) return `<img src="${src}" style="${dim('width') ? `width:${pt(dim('width')!)};` : ''}${dim('height') ? `height:${pt(dim('height')!)};` : ''}">`; }
  const box = node.getElementsByTagNameNS(W, 'txbxContent')[0] as El | undefined;
  if (box) return `<span style="display:inline-block;width:${pt(dim('width') ?? width)};vertical-align:top">${this.blocks(kids(box), dim('width') ?? width)}</span>`;
  const rule = node.getElementsByTagNameNS(V, 'rect')[0] as El | undefined;
  if (rule?.getAttribute('o:hr') === 't' || rule?.getAttributeNS('urn:schemas-microsoft-com:office:office', 'hr') === 't') return `<span style="display:block;border-top:1pt solid ${rule.getAttribute('fillcolor') ?? '#a0a0a0'};margin:2pt 0"></span>`;
  return '';
 }

 // ── Tables ──────────────────────────────────────────────────────────────────────────────────────
 table(tbl: El, available: number, inHeader: boolean): string {
  const tblPr = child(tbl, 'tblPr'), styleId = attr(child(tblPr, 'tblStyle'), 'val') ?? this.defaultTable;
  const chain = this.chain(styleId);
  const prop = (name: string): El | null => { const direct = child(tblPr, name); if (direct) return direct; for (const s of [...chain].reverse()) { const e = child(s.tblPr, name); if (e) return e; } return null; };
  const grid = children(child(tbl, 'tblGrid'), 'gridCol').map(c => twip(attr(c, 'w')));
  const tblW = child(tblPr, 'tblW'), wType = attr(tblW, 'type');
  let total = wType === 'dxa' ? twip(attr(tblW, 'w')) : wType === 'pct' ? (String(attr(tblW, 'w')).endsWith('%') ? parseFloat(attr(tblW, 'w')!) / 100 : num(attr(tblW, 'w')) / 5000) * available : 0;
  const gridTotal = grid.reduce((a, b) => a + b, 0);
  if (!total) total = gridTotal || available;
  const scale = gridTotal && Math.abs(gridTotal - total) > 1 && wType !== 'auto' ? total / gridTotal : 1;
  const cols = grid.length ? grid.map(g => g * scale) : [];
  const borders: Record<string, Border | null> = {};
  for (const side of ['top', 'left', 'bottom', 'right', 'insideH', 'insideV', 'start', 'end']) {
   let b: Border | null | undefined;
   for (const s of chain) { const e = child(child(s.tblPr, 'tblBorders'), side); if (e) b = this.border(e); }
   const e = child(child(tblPr, 'tblBorders'), side); if (e) b = this.border(e);
   borders[side === 'start' ? 'left' : side === 'end' ? 'right' : side] ??= b ?? null;
  }
  const marginOf = (holder: El | null | undefined, side: string) => { const e = child(holder, side) ?? child(holder, side === 'left' ? 'start' : side === 'right' ? 'end' : side); return e ? twip(attr(e, 'w')) : undefined; };
  const cellMargins = {top: 0, bottom: 0, left: 5.4, right: 5.4};
  for (const holder of [...chain.map(s => child(s.tblPr, 'tblCellMar')), child(tblPr, 'tblCellMar')]) for (const side of ['top', 'bottom', 'left', 'right'] as const) { const v = marginOf(holder, side); if (v !== undefined) cellMargins[side] = v; }
  const indent = twip(attr(prop('tblInd'), 'w')), jc = attr(prop('jc'), 'val'), layout = attr(prop('tblLayout'), 'type') === 'fixed';
  const look = child(tblPr, 'tblLook'), lookVal = parseInt(attr(look, 'val') ?? '0', 16) || 0;
  const flag = (name: string, bit: number) => { const v = attr(look, name); return v !== null ? v === '1' || v === 'true' : !!(lookVal & bit); };
  const lookFlags = {firstRow: flag('firstRow', 0x20), lastRow: flag('lastRow', 0x40), firstColumn: flag('firstColumn', 0x80), lastColumn: flag('lastColumn', 0x100), noHBand: flag('noHBand', 0x200), noVBand: flag('noVBand', 0x400)};
  const rows = children(tbl, 'tr').concat(...children(tbl, 'sdt').map(s => children(child(s, 'sdtContent'), 'tr')));
  // Grid positions of every cell, to turn vMerge runs into rowspans.
  type Cell = {tc: El; col: number; span: number; rowspan: number; skip: boolean};
  const layoutRows: Cell[][] = rows.map(tr => { let col = num(attr(child(child(tr, 'trPr'), 'gridBefore'), 'val')); return children(tr, 'tc').concat(...children(tr, 'sdt').map(s => children(child(s, 'sdtContent'), 'tc'))).map(tc => { const span = num(attr(child(child(tc, 'tcPr'), 'gridSpan'), 'val'), 1); const cell = {tc, col, span, rowspan: 1, skip: false}; col += span; return cell; }); });
  layoutRows.forEach((row, r) => row.forEach(cell => {
   const merge = child(child(cell.tc, 'tcPr'), 'vMerge'); if (!merge) return;
   if ((attr(merge, 'val') ?? 'continue') === 'continue') { cell.skip = true; for (let up = r - 1; up >= 0; up--) { const above = layoutRows[up]!.find(c => c.col === cell.col); if (!above) break; if (!above.skip) { above.rowspan++; break; } } }
  }));
  const tableCss: string[] = [`width:${pt(total)}`];
  if (layout || cols.length) tableCss.push('table-layout:fixed');
  if (jc === 'center') tableCss.push('margin-left:auto;margin-right:auto'); else if (jc === 'right' || jc === 'end') tableCss.push('margin-left:auto'); else if (indent) tableCss.push(`margin-left:${pt(indent)}`);
  const floating = child(tblPr, 'tblpPr');
  if (floating) tableCss.push(`margin-top:${pt(twip(attr(floating, 'topFromText')))};margin-bottom:${pt(twip(attr(floating, 'bottomFromText')))}`);
  const shd = child(prop('shd') ? tblPr : null, 'shd'); const tableFill = shd && attr(shd, 'fill') !== 'auto' ? hex(attr(shd, 'fill')) : undefined;
  if (tableFill) tableCss.push(`background-color:${tableFill}`);
  const banded = (index: number, size: number, noBand: boolean, name: string) => noBand ? undefined : Math.floor(index / Math.max(size, 1)) % 2 === 0 ? name + '1' : name + '2';
  const rowBand = num(attr(prop('tblStyleRowBandSize'), 'val'), 1), colBand = num(attr(prop('tblStyleColBandSize'), 'val'), 1);
  const headerRows = lookFlags.firstRow ? 1 : 0;
  const body: string[] = [];
  const colCount = Math.max(cols.length, ...layoutRows.map(r => r.reduce((a, c) => Math.max(a, c.col + c.span), 0)));
  layoutRows.forEach((row, r) => {
   const tr = rows[r]!, trPr = child(tr, 'trPr'), height = child(trPr, 'trHeight'), hRule = attr(height, 'hRule');
   const trCss: string[] = [];
   if (height) trCss.push(`${hRule === 'exact' ? 'height' : 'height'}:${pt(twip(attr(height, 'val')))}`);
   if (onOff(child(trPr, 'cantSplit')) === false) trCss.push('break-inside:auto');
   const cells: string[] = [];
   const before = num(attr(child(trPr, 'gridBefore'), 'val'));
   if (before) cells.push(`<td colspan="${before}" style="border:none"></td>`);
   const dataRows = rows.length - headerRows - (lookFlags.lastRow ? 1 : 0);
   row.forEach(cell => {
    if (cell.skip) return;
    const tcPr = child(cell.tc, 'tcPr');
    const kinds: string[] = ['wholeTable'];
    const hBand = r >= headerRows && (!lookFlags.lastRow || r < rows.length - 1) ? banded(r - headerRows, rowBand, lookFlags.noHBand, 'band') : undefined; if (hBand) kinds.push(hBand + 'Horz');
    const vBand = banded(cell.col - (lookFlags.firstColumn ? 1 : 0), colBand, lookFlags.noVBand, 'band'); if (vBand && !(lookFlags.firstColumn && cell.col === 0)) kinds.push(vBand + 'Vert');
    if (lookFlags.firstColumn && cell.col === 0) kinds.push('firstCol');
    if (lookFlags.lastColumn && cell.col + cell.span >= colCount) kinds.push('lastCol');
    if (lookFlags.firstRow && r < headerRows) kinds.push('firstRow');
    if (lookFlags.lastRow && r === rows.length - 1 && dataRows >= 0) kinds.push('lastRow');
    if (lookFlags.firstRow && r === 0 && lookFlags.firstColumn && cell.col === 0) kinds.push('nwCell');
    if (lookFlags.firstRow && r === 0 && lookFlags.lastColumn && cell.col + cell.span >= colCount) kinds.push('neCell');
    const conditional = chain.flatMap(s => kinds.map(k => s.conditional.get(k)).filter((x): x is NonNullable<typeof x> => !!x));
    const styleTc = [...chain.map(s => ({tcPr: s.tcPr})), ...conditional];
    const pick = (name: string) => { let found: El | null = null; for (const s of styleTc) { const e = child(s.tcPr, name); if (e) found = e; } return child(tcPr, name) ?? found; };
    const css: string[] = [];
    const lastCol = cell.col + cell.span >= colCount, lastRow = r + cell.rowspan >= rows.length;
    const edge = (side: 'top' | 'bottom' | 'left' | 'right') => {
     let b: Border | null | undefined;
     for (const s of styleTc) { const e = child(child(s.tcPr, 'tcBorders'), side) ?? child(child(s.tcPr, 'tcBorders'), side === 'left' ? 'start' : side === 'right' ? 'end' : side); if (e) b = this.border(e); }
     for (const s of conditional) { const e = child(child(s.tblPr, 'tblBorders'), side); if (e) b = this.border(e); }
     const direct = child(child(tcPr, 'tcBorders'), side) ?? child(child(tcPr, 'tcBorders'), side === 'left' ? 'start' : side === 'right' ? 'end' : side);
     if (direct) return this.border(direct);
     if (b !== undefined) return b;
     const outer = side === 'top' ? r === 0 : side === 'bottom' ? lastRow : side === 'left' ? cell.col === 0 : lastCol;
     return outer ? borders[side] : borders[side === 'top' || side === 'bottom' ? 'insideH' : 'insideV'];
    };
    for (const side of ['top', 'right', 'bottom', 'left'] as const) { const b = edge(side); if (b) css.push(`border-${side}:${this.cssBorder(b)}`); }
    const fillEl = pick('shd'), fill = fillEl && attr(fillEl, 'fill') !== 'auto' ? hex(attr(fillEl, 'fill')) : undefined;
    if (fill) css.push(`background-color:${fill}`);
    const mar = child(tcPr, 'tcMar'), margins = {...cellMargins};
    for (const side of ['top', 'bottom', 'left', 'right'] as const) { const v = marginOf(mar, side); if (v !== undefined) margins[side] = v; }
    css.push(`padding:${pt(margins.top)} ${pt(margins.right)} ${pt(margins.bottom)} ${pt(margins.left)}`);
    const valign = attr(pick('vAlign'), 'val'); if (valign === 'center') css.push('vertical-align:middle'); else if (valign === 'bottom') css.push('vertical-align:bottom');
    const dir = attr(pick('textDirection'), 'val'); if (dir === 'btLr') css.push('writing-mode:vertical-rl;transform:rotate(180deg)'); else if (dir === 'tbRl' || dir === 'tbRlV') css.push('writing-mode:vertical-rl');
    if (onOff(pick('noWrap'))) css.push('white-space:nowrap');
    const cellWidth = cols.length ? cols.slice(cell.col, cell.col + cell.span).reduce((a, b) => a + b, 0) : (() => { const w = child(tcPr, 'tcW'); return attr(w, 'type') === 'dxa' ? twip(attr(w, 'w')) : total / Math.max(row.length, 1); })();
    const inner = Math.max(cellWidth - margins.left - margins.right, 1);
    const content: string[] = []; let previous: {style?: string; contextual?: boolean; after: number} | undefined;
    const styleParts = [...chain.map(s => ({ppr: s.ppr, rpr: s.rpr})), ...conditional.map(c => ({ppr: c.ppr, rpr: c.rpr}))];
    for (const block of kids(cell.tc)) {
     const name = local(block);
     if (name === 'p') { const res = this.paragraph(block, inner, previous, inHeader, styleParts); content.push(res.html); previous = res.info; }
     else if (name === 'tbl') { content.push(this.table(block, inner, inHeader)); previous = undefined; }
     else if (name === 'sdt') content.push(this.blocks(kids(child(block, 'sdtContent')), inner, inHeader));
    }
    cells.push(`<td${cell.span > 1 ? ` colspan="${cell.span}"` : ''}${cell.rowspan > 1 ? ` rowspan="${cell.rowspan}"` : ''} style="${css.join(';')}">${content.join('')}</td>`);
   });
   const tag = onOff(child(trPr, 'tblHeader')) ? ' data-header="1"' : '';
   body.push(`<tr${tag}${trCss.length ? ` style="${trCss.join(';')}"` : ''}>${cells.join('')}</tr>`);
  });
  // Header rows repeat on every page, like Word's "repeat as header row".
  let headCount = 0; while (headCount < body.length && body[headCount]!.includes('data-header="1"')) headCount++;
  const colgroup = cols.length ? `<colgroup>${cols.map(c => `<col style="width:${pt(c)}">`).join('')}</colgroup>` : '';
  const head = headCount ? `<thead>${body.slice(0, headCount).join('')}</thead>` : '';
  return `<table style="${tableCss.join(';')}">${colgroup}${head}<tbody>${body.slice(headCount).join('')}</tbody></table>`;
 }
}

function pageField(instr: string): string | undefined {
 const word = instr.trim().split(/\s+/)[0]?.toUpperCase();
 return word === 'PAGE' ? 'pageNumber' : word === 'NUMPAGES' || word === 'SECTIONPAGES' ? 'totalPages' : undefined;
}
function roman(n: number) { const map: [number, string][] = [[1000, 'm'], [900, 'cm'], [500, 'd'], [400, 'cd'], [100, 'c'], [90, 'xc'], [50, 'l'], [40, 'xl'], [10, 'x'], [9, 'ix'], [5, 'v'], [4, 'iv'], [1, 'i']]; let out = ''; for (const [v, s] of map) while (n >= v) { out += s; n -= v; } return out; }
function letters(n: number) { const ch = String.fromCharCode(97 + ((n - 1) % 26)); return ch.repeat(Math.floor((n - 1) / 26) + 1); }
function formatNumber(n: number, format: string): string {
 switch (format) {
  case 'lowerLetter': return letters(n);
  case 'upperLetter': return letters(n).toUpperCase();
  case 'lowerRoman': return roman(n);
  case 'upperRoman': return roman(n).toUpperCase();
  case 'decimalZero': return String(n).padStart(2, '0');
  case 'ordinal': return n + 'º';
  case 'cardinalText': case 'ordinalText': return String(n);
  default: return String(n);
 }
}
/** Bullets drawn with Symbol/Wingdings private-use code points shown as their Unicode look-alikes. */
function bulletGlyph(text: string, font: string | null): string {
 const code = text.codePointAt(0) ?? 0x2022;
 if (font && /symbol|wingdings/i.test(font) || code >= 0xf000) return symbolGlyph(code, font ?? '');
 return text || '•';
}
function symbolGlyph(code: number, font: string): string {
 const c = code >= 0xf000 ? code - 0xf000 : code;
 if (/wingdings/i.test(font)) return ({0xa7: '▪', 0xa8: '◻', 0x6c: '●', 0x6e: '■', 0x71: '❑', 0x75: '◆', 0x76: '❖', 0xd8: '➢', 0xfc: '✓', 0xfb: '✗', 0xfe: '☑', 0xa1: '○', 0x9f: '•', 0xe0: '→', 0xe8: '➔', 0x4a: '☺', 0x6f: '□', 0x77: '⬥', 0xa2: '◯'} as Record<number, string>)[c] ?? '•';
 if (/symbol/i.test(font)) return ({0xb7: '•', 0xa8: '♦', 0xd7: '·', 0x2d: '−', 0xb0: '°', 0xae: '→', 0xde: '⇒', 0xb4: '×', 0xb8: '÷', 0xb1: '±', 0xa5: '∞', 0xd6: '√', 0x61: 'α', 0x62: 'β', 0x70: 'π', 0x53: 'Σ', 0x57: 'Ω', 0x6d: 'μ'} as Record<number, string>)[c] ?? String.fromCodePoint(c);
 return String.fromCodePoint(c);
}
