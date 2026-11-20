import {unzipSync,strFromU8} from 'fflate';
import {DOMParser} from '@xmldom/xmldom';
import {SUBSTITUTES,lineFactor} from './docx-html';

/** A PowerPoint presentation (.pptx) laid out as print-ready HTML: one page per slide, at the slide's own
 * size, with its background, shapes, pictures, tables and text. Placeholders inherit position and text
 * styles from the slide layout and master, and colours come from the theme, as in PowerPoint. The PDF keeps
 * every word as selectable text. */

type El = Element;
const A = 'http://schemas.openxmlformats.org/drawingml/2006/main';
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const kids = (node: El | null | undefined): El[] => { const list: El[] = []; if (!node) return list; for (let c = node.firstChild; c; c = c.nextSibling) if (c.nodeType === 1) list.push(c as El); return list; };
const local = (e: El) => e.localName || e.nodeName.replace(/^.*:/, '');
const child = (node: El | null | undefined, name: string): El | null => kids(node).find(e => local(e) === name) ?? null;
const children = (node: El | null | undefined, name: string) => kids(node).filter(e => local(e) === name);
const path = (node: El | null | undefined, ...names: string[]) => names.reduce<El | null | undefined>((n, name) => child(n, name), node) ?? null;
const num = (value: string | null | undefined, fallback = 0) => { const n = parseFloat(value ?? ''); return Number.isFinite(n) ? n : fallback; };
const emu = (value: string | null | undefined) => num(value) / 12700;
const pt = (v: number) => `${Math.round(v * 100) / 100}pt`;
const escape = (text: string) => text.replace(/[&<>"]/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;'}[c]!));
const rid = (e: El | null | undefined) => e?.getAttributeNS(R, 'embed') || e?.getAttribute('r:embed') || e?.getAttributeNS(R, 'id') || e?.getAttribute('r:id') || '';
const MIME: Record<string, string> = {png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', bmp: 'image/bmp', svg: 'image/svg+xml', webp: 'image/webp'};

class Package {
 files: Record<string, Uint8Array>;
 constructor(bytes: Uint8Array) { this.files = unzipSync(bytes); }
 xml(name: string): El | null { const f = this.files[name]; return f ? (new DOMParser({onError: () => {}} as never).parseFromString(strFromU8(f), 'text/xml') as unknown as Document).documentElement as unknown as El : null; }
 rels(part: string) {
  const slash = part.lastIndexOf('/'), dir = part.slice(0, slash + 1), doc = this.xml(dir + '_rels/' + part.slice(slash + 1) + '.rels'), map = new Map<string, {target: string; type: string; external: boolean}>();
  for (const rel of children(doc, 'Relationship')) { const external = rel.getAttribute('TargetMode') === 'External', target = rel.getAttribute('Target') ?? ''; map.set(rel.getAttribute('Id') ?? '', {target: external ? target : resolve(dir, target), type: rel.getAttribute('Type') ?? '', external}); }
  return map;
 }
}
function resolve(dir: string, target: string) { const out: string[] = []; for (const p of (target.startsWith('/') ? target.slice(1) : dir + target).split('/')) { if (p === '..') out.pop(); else if (p && p !== '.') out.push(p); } return out.join('/'); }

/** A part (slide, layout or master) with its relationships. */
interface Part { name: string; root: El; rels: ReturnType<Package['rels']> }
interface Ctx { slide: Part; layout?: Part; master?: Part; number: number }
interface TextStyle { size?: number; bold?: boolean; italic?: boolean; underline?: boolean; strike?: boolean; color?: string; font?: string; caps?: string; spacing?: number; baseline?: number }
interface ParaStyle { align?: string; marL?: number; indent?: number; lineSpacing?: {pct?: number; pts?: number}; before?: {pct?: number; pts?: number}; after?: {pct?: number; pts?: number}; bullet?: {char?: string; auto?: string; start?: number; none?: boolean; font?: string; color?: string; size?: number}; run: TextStyle }

export function pptxToHtml(bytes: Uint8Array): string {
 let pkg: Package;
 try { pkg = new Package(bytes); } catch { throw new Error('A apresentação está danificada ou não é um arquivo .pptx válido.'); }
 return new Renderer(pkg).render();
}

class Renderer {
 theme = {colors: {} as Record<string, string>, major: 'Calibri', minor: 'Calibri'};
 width = 720; height = 540;
 constructor(public pkg: Package) {}
 part(name: string): Part | undefined { const root = this.pkg.xml(name); return root ? {name, root, rels: this.pkg.rels(name)} : undefined; }
 related(p: Part | undefined, type: string) { const rel = p && [...p.rels.values()].find(r => r.type.endsWith('/' + type)); return rel ? this.part(rel.target) : undefined; }

 render(): string {
  const main = [...this.pkg.rels('').values()].find(r => r.type.endsWith('/officeDocument'))?.target ?? 'ppt/presentation.xml';
  const pres = this.part(main);
  if (!pres) throw new Error('A apresentação está danificada ou não é um arquivo .pptx válido.');
  const size = child(pres.root, 'sldSz');
  if (size) { this.width = emu(size.getAttribute('cx')); this.height = emu(size.getAttribute('cy')); }
  const slides: string[] = [];
  let number = 0;
  for (const id of children(child(pres.root, 'sldIdLst'), 'sldId')) {
   const slide = this.part(pres.rels.get(rid(id))?.target ?? ''); if (!slide) continue;
   number++;
   if (slide.root.getAttribute('show') === '0') continue;
   const layout = this.related(slide, 'slideLayout'), master = this.related(layout, 'slideMaster');
   if (!slides.length) this.loadTheme(this.related(master, 'theme'));
   slides.push(this.slide({slide, layout, master, number}));
  }
  if (!slides.length) throw new Error('A apresentação não tem slides para converter.');
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><style>
@page{size:${pt(this.width)} ${pt(this.height)};margin:0}html,body{margin:0;padding:0;-webkit-print-color-adjust:exact;print-color-adjust:exact}
.slide{position:relative;width:${pt(this.width)};height:${pt(this.height)};overflow:hidden;break-after:page}.slide:last-child{break-after:auto}
.shape{position:absolute;box-sizing:border-box}.text{position:absolute;inset:0;display:flex;flex-direction:column;box-sizing:border-box}
p{margin:0;white-space:pre-wrap;overflow-wrap:break-word}table{border-collapse:collapse;table-layout:fixed}td{vertical-align:top;overflow:hidden}a{color:inherit}
</style></head><body>${slides.join('')}</body></html>`;
 }
 loadTheme(theme: Part | undefined) {
  const elements = path(theme?.root, 'themeElements');
  for (const c of kids(child(elements, 'clrScheme'))) { const v = child(c, 'srgbClr')?.getAttribute('val') ?? child(c, 'sysClr')?.getAttribute('lastClr'); if (v) this.theme.colors[local(c)] = v; }
  const fonts = child(elements, 'fontScheme');
  this.theme.major = path(fonts, 'majorFont', 'latin')?.getAttribute('typeface') || 'Calibri';
  this.theme.minor = path(fonts, 'minorFont', 'latin')?.getAttribute('typeface') || 'Calibri';
 }

 // ── Colours and fills ───────────────────────────────────────────────────────────────────────────
 color(holder: El | null | undefined, ctx: Ctx, placeholder?: string): string | undefined {
  const c = kids(holder).find(e => ['srgbClr', 'schemeClr', 'sysClr', 'prstClr', 'scrgbClr', 'hslClr'].includes(local(e))); if (!c) return undefined;
  let hex: string | undefined;
  const kind = local(c), val = c.getAttribute('val') ?? '';
  if (kind === 'srgbClr') hex = val;
  else if (kind === 'sysClr') hex = c.getAttribute('lastClr') ?? (val === 'window' ? 'FFFFFF' : '000000');
  else if (kind === 'prstClr') hex = ({black: '000000', white: 'FFFFFF', red: 'FF0000', green: '008000', blue: '0000FF', yellow: 'FFFF00', gray: '808080'} as Record<string, string>)[val];
  else if (kind === 'scrgbClr') hex = ['r', 'g', 'b'].map(k => Math.round(num(c.getAttribute(k)) / 1e5 * 255).toString(16).padStart(2, '0')).join('');
  else if (kind === 'schemeClr') {
   const name = val === 'phClr' ? placeholder ?? 'tx1' : val;
   // The master's colour map turns bg1/tx1/bg2/tx2 into theme slots (lt1/dk1/lt2/dk2).
   const map = child(ctx.master?.root, 'clrMap'), override = path(ctx.slide.root, 'clrMapOvr', 'overrideClrMapping');
   const mapped = override?.getAttribute(name) ?? map?.getAttribute(name) ?? ({bg1: 'lt1', tx1: 'dk1', bg2: 'lt2', tx2: 'dk2'} as Record<string, string>)[name] ?? name;
   hex = this.theme.colors[mapped];
  }
  if (!hex || !/^[0-9a-f]{6}$/i.test(hex)) return undefined;
  let [r, g, b] = [0, 2, 4].map(i => parseInt(hex!.slice(i, i + 2), 16)) as [number, number, number];
  let alpha = 1;
  for (const m of kids(c)) {
   const v = num(m.getAttribute('val')) / 1e5;
   switch (local(m)) {
    case 'lumMod': { const [h, s, l] = hsl(r, g, b); [r, g, b] = rgb(h, s, l * v); break; }
    case 'lumOff': { const [h, s, l] = hsl(r, g, b); [r, g, b] = rgb(h, s, Math.min(1, l + v)); break; }
    // DrawingML tints and shades work on linear light, not on the gamma-encoded sRGB values.
    case 'tint': [r, g, b] = [r, g, b].map(x => fromLinear(1 - (1 - toLinear(x)) * v)) as [number, number, number]; break;
    case 'shade': [r, g, b] = [r, g, b].map(x => fromLinear(toLinear(x) * v)) as [number, number, number]; break;
    case 'alpha': alpha = v; break;
   }
  }
  const clamp = (x: number) => Math.max(0, Math.min(255, Math.round(x)));
  return alpha < 1 ? `rgba(${clamp(r)},${clamp(g)},${clamp(b)},${Math.round(alpha * 1000) / 1000})` : '#' + [r, g, b].map(x => clamp(x).toString(16).padStart(2, '0')).join('');
 }
 /** CSS background of a fill (solid, gradient or picture); null for "no fill", undefined when none is set. */
 fill(holder: El | null | undefined, ctx: Ctx, part: Part, placeholder?: string): string | null | undefined {
  for (const f of kids(holder)) {
   switch (local(f)) {
    case 'noFill': return null;
    case 'solidFill': { const c = this.color(f, ctx, placeholder); return c ? `background:${c};` : undefined; }
    case 'gradFill': {
     const stops = children(child(f, 'gsLst'), 'gs').map(g => ({pos: num(g.getAttribute('pos')) / 1000, color: this.color(g, ctx, placeholder) ?? '#fff'})).sort((a, b) => a.pos - b.pos);
     if (!stops.length) return undefined;
     const path = child(f, 'path'), angle = num(child(f, 'lin')?.getAttribute('ang')) / 60000;
     const list = stops.map(s => `${s.color} ${s.pos}%`).join(',');
     return path ? `background:radial-gradient(circle,${list});` : `background:linear-gradient(${angle + 90}deg,${list});`;
    }
    case 'blipFill': { const src = this.image(part, child(f, 'blip')); return src ? `background:url(${src}) center/${child(f, 'tile') ? 'auto' : '100% 100%'} ${child(f, 'tile') ? 'repeat' : 'no-repeat'};` : undefined; }
    case 'pattFill': { const c = this.color(child(f, 'bgClr'), ctx, placeholder); return c ? `background:${c};` : undefined; }
   }
  }
  return undefined;
 }
 image(part: Part, blip: El | null | undefined): string | undefined {
  const rel = part.rels.get(rid(blip)); if (!rel || rel.external) return undefined;
  const data = this.pkg.files[rel.target], mime = MIME[rel.target.split('.').pop()!.toLowerCase()];
  return data && mime ? `data:${mime};base64,${Buffer.from(data).toString('base64')}` : undefined;
 }
 /** Fill or line of a shape, falling back to the theme style it references (style/fillRef, lnRef). */
 line(spPr: El | null | undefined, style: El | null | undefined, ctx: Ctx): {css: string; width: number} | null {
  const ln = child(spPr, 'ln');
  if (ln && child(ln, 'noFill')) return null;
  let color = ln ? this.color(child(ln, 'solidFill'), ctx) : undefined;
  const ref = child(style, 'lnRef');
  if (!color && !ln?.firstChild && ref && num(ref.getAttribute('idx')) > 0) color = this.color(ref, ctx);
  if (!color) return null;
  const width = Math.max(emu(ln?.getAttribute('w') ?? '9525'), .25);
  const dash = child(ln, 'prstDash')?.getAttribute('val') ?? 'solid';
  return {css: `${pt(width)} ${dash === 'solid' ? 'solid' : /dot/i.test(dash) && !/dash/i.test(dash) ? 'dotted' : 'dashed'} ${color}`, width};
 }

 // ── Slides and shapes ───────────────────────────────────────────────────────────────────────────
 slide(ctx: Ctx): string {
  const background = this.background(ctx);
  const showMaster = (p?: Part) => p?.root.getAttribute('showMasterSp') !== '0';
  const layers: string[] = [];
  // Master and layout artwork (logos, bars) appear behind the slide unless the slide or layout hides it.
  if (ctx.master && ctx.layout && showMaster(ctx.slide) && showMaster(ctx.layout)) layers.push(this.tree(path(ctx.master.root, 'cSld', 'spTree'), ctx, ctx.master, true));
  if (ctx.layout && showMaster(ctx.slide)) layers.push(this.tree(path(ctx.layout.root, 'cSld', 'spTree'), ctx, ctx.layout, true));
  layers.push(this.tree(path(ctx.slide.root, 'cSld', 'spTree'), ctx, ctx.slide, false));
  return `<div class="slide" style="${background}">${layers.join('')}</div>`;
 }
 background(ctx: Ctx): string {
  for (const p of [ctx.slide, ctx.layout, ctx.master]) {
   const bg = path(p?.root, 'cSld', 'bg'); if (!bg || !p) continue;
   const pr = child(bg, 'bgPr');
   if (pr) { const f = this.fill(pr, ctx, p); if (f) return f; if (f === null) return 'background:#fff;'; }
   const ref = child(bg, 'bgRef'); if (ref) { const c = this.color(ref, ctx); if (c) return `background:${c};`; }
  }
  return 'background:#fff;';
 }
 /** Shapes of a shape tree; artwork-only trees (master, layout) skip placeholders, which belong to slides. */
 tree(node: El | null, ctx: Ctx, part: Part, artworkOnly: boolean, offset = {x: 0, y: 0, sx: 1, sy: 1}): string {
  const out: string[] = [];
  for (const e of kids(node)) {
   const name = local(e);
   if (artworkOnly && path(e, name === 'sp' ? 'nvSpPr' : name === 'pic' ? 'nvPicPr' : 'nvGrpSpPr', 'nvPr', 'ph')) continue;
   if (name === 'sp' || name === 'cxnSp') out.push(this.shape(e, ctx, part, offset));
   else if (name === 'pic') out.push(this.picture(e, ctx, part, offset));
   else if (name === 'grpSp') {
    const x = path(e, 'grpSpPr', 'xfrm'), off = child(x, 'off'), ext = child(x, 'ext'), chOff = child(x, 'chOff'), chExt = child(x, 'chExt');
    const sx = (num(ext?.getAttribute('cx')) / (num(chExt?.getAttribute('cx')) || num(ext?.getAttribute('cx')) || 1)) * offset.sx, sy = (num(ext?.getAttribute('cy')) / (num(chExt?.getAttribute('cy')) || num(ext?.getAttribute('cy')) || 1)) * offset.sy;
    const inner = {x: offset.x + emu(off?.getAttribute('x')) * offset.sx - emu(chOff?.getAttribute('x')) * sx, y: offset.y + emu(off?.getAttribute('y')) * offset.sy - emu(chOff?.getAttribute('y')) * sy, sx, sy};
    out.push(this.tree(e, ctx, part, artworkOnly, inner));
   } else if (name === 'graphicFrame') out.push(this.frame(e, ctx, part, offset));
   else if (name === 'AlternateContent') out.push(this.tree(child(e, 'Choice')?.firstChild ? child(e, 'Choice') : child(e, 'Fallback'), ctx, part, artworkOnly, offset));
  }
  return out.join('');
 }
 /** The layout and master placeholders a slide placeholder inherits from (most specific first). */
 inherited(e: El, ctx: Ctx, part: Part): El[] {
  const ph = path(e, local(e) === 'pic' ? 'nvPicPr' : local(e) === 'graphicFrame' ? 'nvGraphicFramePr' : 'nvSpPr', 'nvPr', 'ph');
  if (!ph) return [];
  const type = ph.getAttribute('type') ?? 'body', idx = ph.getAttribute('idx');
  const find = (p: Part | undefined) => {
   const list = kids(path(p?.root, 'cSld', 'spTree')).filter(s => path(s, 'nvSpPr', 'nvPr', 'ph') || path(s, 'nvPicPr', 'nvPr', 'ph'));
   const phOf = (s: El) => path(s, 'nvSpPr', 'nvPr', 'ph') ?? path(s, 'nvPicPr', 'nvPr', 'ph');
   const sameType = (s: El) => { const t = phOf(s)?.getAttribute('type') ?? 'body'; return t === type || (['title', 'ctrTitle'].includes(t) && ['title', 'ctrTitle'].includes(type)) || (['body', 'subTitle', 'obj'].includes(t) && ['body', 'subTitle', 'obj'].includes(type)); };
   return (idx !== null ? list.find(s => phOf(s)?.getAttribute('idx') === idx) : undefined) ?? list.find(s => (phOf(s)?.getAttribute('type') ?? 'body') === type) ?? list.find(sameType);
  };
  const out: El[] = [];
  if (part !== ctx.layout && part !== ctx.master) { const l = find(ctx.layout); if (l) out.push(l); }
  if (part !== ctx.master) { const m = find(ctx.master); if (m) out.push(m); }
  return out;
 }
 placeholderType(e: El) { return (path(e, 'nvSpPr', 'nvPr', 'ph') ?? path(e, 'nvPicPr', 'nvPr', 'ph'))?.getAttribute('type') ?? (path(e, 'nvSpPr', 'nvPr', 'ph') ? 'body' : undefined); }
 box(e: El, chain: El[], offset: {x: number; y: number; sx: number; sy: number}, xfrmPath: string[] = ['spPr', 'xfrm']) {
  const x = [e, ...chain].map(s => path(s, ...xfrmPath) ?? path(s, 'spPr', 'xfrm') ?? child(s, 'xfrm')).find(Boolean) ?? null;
  const off = child(x, 'off'), ext = child(x, 'ext');
  const rot = num(x?.getAttribute('rot')) / 60000, flipH = x?.getAttribute('flipH') === '1', flipV = x?.getAttribute('flipV') === '1';
  return {left: offset.x + emu(off?.getAttribute('x')) * offset.sx, top: offset.y + emu(off?.getAttribute('y')) * offset.sy, width: emu(ext?.getAttribute('cx')) * offset.sx, height: emu(ext?.getAttribute('cy')) * offset.sy, transform: rot || flipH || flipV ? `transform:${rot ? `rotate(${rot}deg)` : ''}${flipH ? ' scaleX(-1)' : ''}${flipV ? ' scaleY(-1)' : ''};` : ''};
 }
 shape(e: El, ctx: Ctx, part: Part, offset: {x: number; y: number; sx: number; sy: number}): string {
  const chain = this.inherited(e, ctx, part), b = this.box(e, chain, offset);
  if (!b.width && !b.height) return '';
  const spPr = child(e, 'spPr'), style = child(e, 'style');
  const geom = [e, ...chain].map(s => path(s, 'spPr', 'prstGeom')?.getAttribute('prst')).find(Boolean) ?? (child(spPr, 'custGeom') ? 'rect' : 'rect');
  let fill = this.fill(spPr, ctx, part);
  if (fill === undefined) for (const s of chain) { const f = this.fill(child(s, 'spPr'), ctx, part); if (f !== undefined) { fill = f; break; } }
  if (fill === undefined) { const ref = child(style, 'fillRef'); if (ref && num(ref.getAttribute('idx')) > 0) { const c = this.color(ref, ctx); if (c) fill = `background:${c};`; } }
  const line = this.line(spPr, style, ctx) ?? chain.map(s => this.line(child(s, 'spPr'), null, ctx)).find(Boolean) ?? null;
  const isLine = local(e) === 'cxnSp' || ['line', 'straightConnector1', 'bentConnector2', 'bentConnector3', 'curvedConnector3'].includes(geom);
  if (isLine) {
   if (!line) return '';
   const tail = path(spPr, 'ln', 'tailEnd')?.getAttribute('type'), head = path(spPr, 'ln', 'headEnd')?.getAttribute('type');
   const flipH = /scaleX\(-1\)/.test(b.transform), flipV = /scaleY\(-1\)/.test(b.transform);
   const [x1, y1, x2, y2] = [flipH ? b.width : 0, flipV ? b.height : 0, flipH ? 0 : b.width, flipV ? 0 : b.height];
   const color = line.css.split(' ').slice(2).join(' '), w = Math.max(line.width, .5), marker = (t?: string | null) => t && t !== 'none';
   return `<svg class="shape" style="left:${pt(b.left)};top:${pt(b.top)};width:${pt(Math.max(b.width, w))};height:${pt(Math.max(b.height, w))};overflow:visible" viewBox="0 0 ${Math.max(b.width, w)} ${Math.max(b.height, w)}"><defs><marker id="m${b.left | 0}${b.top | 0}" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse"><path d="M0,0L10,5L0,10z" fill="${color}"/></marker></defs><line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${color}" stroke-width="${w}"${/dash/.test(line.css) ? ' stroke-dasharray="4 3"' : /dotted/.test(line.css) ? ' stroke-dasharray="1 2"' : ''}${marker(tail) ? ` marker-end="url(#m${b.left | 0}${b.top | 0})"` : ''}${marker(head) ? ` marker-start="url(#m${b.left | 0}${b.top | 0})"` : ''}/></svg>`;
  }
  const radius = geom === 'ellipse' ? 'border-radius:50%;' : geom === 'roundRect' ? `border-radius:${pt(Math.min(b.width, b.height) * .1667)};` : '';
  const clip = geom === 'triangle' ? 'clip-path:polygon(50% 0,100% 100%,0 100%);' : geom === 'rtTriangle' ? 'clip-path:polygon(0 0,100% 100%,0 100%);' : geom === 'diamond' ? 'clip-path:polygon(50% 0,100% 50%,50% 100%,0 50%);' : geom === 'chevron' ? 'clip-path:polygon(0 0,75% 0,100% 50%,75% 100%,0 100%,25% 50%);' : geom === 'homePlate' ? 'clip-path:polygon(0 0,80% 0,100% 50%,80% 100%,0 100%);' : geom === 'rightArrow' ? 'clip-path:polygon(0 25%,70% 25%,70% 0,100% 50%,70% 100%,70% 75%,0 75%);' : geom === 'leftArrow' ? 'clip-path:polygon(30% 0,30% 25%,100% 25%,100% 75%,30% 75%,30% 100%,0 50%);' : geom === 'hexagon' ? 'clip-path:polygon(25% 0,75% 0,100% 50%,75% 100%,25% 100%,0 50%);' : geom === 'parallelogram' ? 'clip-path:polygon(25% 0,100% 0,75% 100%,0 100%);' : '';
  const border = line && !clip ? `border:${line.css};` : '';
  const text = this.text(e, chain, ctx, part, b);
  return `<div class="shape" style="left:${pt(b.left)};top:${pt(b.top)};width:${pt(b.width)};height:${pt(b.height)};${fill ?? ''}${border}${radius}${clip}${b.transform}">${text}</div>`;
 }
 picture(e: El, ctx: Ctx, part: Part, offset: {x: number; y: number; sx: number; sy: number}): string {
  const chain = this.inherited(e, ctx, part), b = this.box(e, chain, offset);
  const blipFill = child(e, 'blipFill'), src = this.image(part, child(blipFill, 'blip'));
  if (!src) return '';
  const crop = child(blipFill, 'srcRect'), l = num(crop?.getAttribute('l')) / 1e5, t = num(crop?.getAttribute('t')) / 1e5, r = num(crop?.getAttribute('r')) / 1e5, bt = num(crop?.getAttribute('b')) / 1e5;
  const geom = path(e, 'spPr', 'prstGeom')?.getAttribute('prst'), radius = geom === 'ellipse' ? 'border-radius:50%;' : geom === 'roundRect' ? `border-radius:${pt(Math.min(b.width, b.height) * .1667)};` : '';
  const line = this.line(child(e, 'spPr'), child(e, 'style'), ctx);
  const img = l || t || r || bt
   ? `<img src="${src}" style="position:absolute;left:${pt(-b.width * l / (1 - l - r))};top:${pt(-b.height * t / (1 - t - bt))};width:${pt(b.width / (1 - l - r))};height:${pt(b.height / (1 - t - bt))}">`
   : `<img src="${src}" style="width:100%;height:100%;display:block">`;
  return `<div class="shape" style="left:${pt(b.left)};top:${pt(b.top)};width:${pt(b.width)};height:${pt(b.height)};overflow:hidden;${radius}${line ? `border:${line.css};` : ''}${b.transform}">${img}</div>`;
 }
 frame(e: El, ctx: Ctx, part: Part, offset: {x: number; y: number; sx: number; sy: number}): string {
  const data = path(e, 'graphic', 'graphicData'), tbl = child(data, 'tbl');
  const b = this.box(e, this.inherited(e, ctx, part), offset, ['xfrm']);
  if (tbl) return `<div class="shape" style="left:${pt(b.left)};top:${pt(b.top)};width:${pt(b.width)}">${this.table(tbl, ctx, part)}</div>`;
  // Charts and diagrams keep the picture PowerPoint saved with them, when there is one.
  const fallback = e.getElementsByTagNameNS(A, 'blip')[0] as El | undefined, src = fallback && this.image(part, fallback);
  return src ? `<img class="shape" src="${src}" style="left:${pt(b.left)};top:${pt(b.top)};width:${pt(b.width)};height:${pt(b.height)}">` : '';
 }
 table(tbl: El, ctx: Ctx, part: Part): string {
  const cols = children(child(tbl, 'tblGrid'), 'gridCol').map(c => emu(c.getAttribute('w')));
  const pr = child(tbl, 'tblPr'), styled = !!child(pr, 'tableStyleId') || !!pr;
  const firstRow = pr?.getAttribute('firstRow') === '1', bandRow = pr?.getAttribute('bandRow') === '1';
  // Without the table style part, PowerPoint's default look ("Medium Style 2"): accent header, banded rows.
  const accent = this.theme.colors.accent1 ? '#' + this.theme.colors.accent1.toLowerCase() : '#4472c4';
  const tint = (pctWhite: number) => { const h = accent.replace('#', ''); return '#' + [0, 2, 4].map(i => Math.round(parseInt(h.slice(i, i + 2), 16) + (255 - parseInt(h.slice(i, i + 2), 16)) * pctWhite).toString(16).padStart(2, '0')).join(''); };
  const rows = children(tbl, 'tr').map((tr, r) => {
   const cells = children(tr, 'tc').map((tc, c) => {
    if (tc.getAttribute('hMerge') === '1' || tc.getAttribute('vMerge') === '1') return '';
    const tcPr = child(tc, 'tcPr');
    let fill = this.fill(tcPr, ctx, part);
    let textColor: string | undefined, bold = false;
    if (fill === undefined && styled) {
     if (firstRow && r === 0) { fill = `background:${accent};`; textColor = '#ffffff'; bold = true; }
     else if (bandRow) fill = `background:${tint((r - (firstRow ? 1 : 0)) % 2 === 0 ? .8 : .9)};`;
    }
    const edges = ['L', 'R', 'T', 'B'].map(s => { const ln = child(tcPr, 'ln' + s); if (!ln || child(ln, 'noFill')) return ''; const color = this.color(child(ln, 'solidFill'), ctx); return color ? `border-${({L: 'left', R: 'right', T: 'top', B: 'bottom'} as Record<string, string>)[s]}:${pt(Math.max(emu(ln.getAttribute('w') ?? '12700'), .25))} solid ${color};` : ''; }).join('');
    const defaultEdges = styled && !edges ? 'border:1pt solid #fff;' : '';
    const pad = `padding:${pt(emu(tcPr?.getAttribute('marT') ?? '45720'))} ${pt(emu(tcPr?.getAttribute('marR') ?? '91440'))} ${pt(emu(tcPr?.getAttribute('marB') ?? '45720'))} ${pt(emu(tcPr?.getAttribute('marL') ?? '91440'))};`;
    const anchor = tcPr?.getAttribute('anchor'), valign = anchor === 'ctr' ? 'vertical-align:middle;' : anchor === 'b' ? 'vertical-align:bottom;' : '';
    const span = num(tc.getAttribute('gridSpan'), 1), rowSpan = num(tc.getAttribute('rowSpan'), 1);
    const body = this.paragraphs(child(tc, 'txBody'), [], ctx, part, 'other', {color: textColor, bold: bold || undefined}, 1, cols[c] ?? 100);
    return `<td${span > 1 ? ` colspan="${span}"` : ''}${rowSpan > 1 ? ` rowspan="${rowSpan}"` : ''} style="${fill ?? ''}${edges || defaultEdges}${pad}${valign}">${body}</td>`;
   });
   return `<tr style="height:${pt(emu(tr.getAttribute('h')))}">${cells.join('')}</tr>`;
  });
  return `<table style="width:${pt(cols.reduce((a, b) => a + b, 0))}"><colgroup>${cols.map(w => `<col style="width:${pt(w)}">`).join('')}</colgroup>${rows.join('')}</table>`;
 }

 // ── Text ────────────────────────────────────────────────────────────────────────────────────────
 text(e: El, chain: El[], ctx: Ctx, part: Part, b: {width: number; height: number}): string {
  const body = child(e, 'txBody'); if (!body || !body.textContent?.trim() && !body.getElementsByTagNameNS(A, 'fld').length) return '';
  const bodies = [body, ...chain.map(s => child(s, 'txBody'))];
  const bodyPr = (name: string) => bodies.map(x => child(x, 'bodyPr')?.getAttribute(name)).find(v => v !== null && v !== undefined);
  const inset = (name: string, d: number) => { const v = bodyPr(name); return v !== undefined && v !== null ? emu(v) : d; };
  // PowerPoint's default is the top; titles normally get their anchor from the layout or master.
  const anchor = bodyPr('anchor') ?? 't';
  const autofit = bodies.map(x => path(x, 'bodyPr', 'normAutofit')).find(Boolean);
  const scale = autofit ? num(autofit.getAttribute('fontScale'), 100000) / 100000 : 1;
  const vert = bodyPr('vert'), wrap = bodyPr('wrap') !== 'none';
  const type = this.placeholderType(e);
  const kind = type === 'title' || type === 'ctrTitle' ? 'title' : type && ['body', 'subTitle', 'obj'].includes(type) ? 'body' : type ? 'other' : 'shape';
  // Text in a plain shape takes its colour from the shape style's fontRef, like PowerPoint.
  const fontRef = child(child(e, 'style'), 'fontRef'), refColor = fontRef ? this.color(fontRef, ctx) : undefined;
  const content = this.paragraphs(body, chain.map(s => child(s, 'txBody')), ctx, part, kind, {color: refColor}, scale, b.width - inset('lIns', 7.2) - inset('rIns', 7.2));
  const justify = anchor === 'ctr' ? 'center' : anchor === 'b' ? 'flex-end' : 'flex-start';
  const rotate = vert === 'vert' || vert === 'eaVert' ? 'writing-mode:vertical-rl;' : vert === 'vert270' ? 'writing-mode:vertical-rl;transform:rotate(180deg);' : '';
  return `<div class="text" style="justify-content:${justify};padding:${pt(inset('tIns', 3.6))} ${pt(inset('rIns', 7.2))} ${pt(inset('bIns', 3.6))} ${pt(inset('lIns', 7.2))};${wrap ? '' : 'white-space:nowrap;'}${rotate}">${content}</div>`;
 }
 /** Paragraph and run properties at one list level, from the most general source to the most specific. */
 levelStyle(level: number, sources: (El | null | undefined)[], ctx: Ctx): ParaStyle {
  const style: ParaStyle = {run: {}};
  for (const src of sources) {
   if (!src) continue;
   const lvl = local(src).startsWith('lvl') || local(src) === 'pPr' || local(src) === 'defPPr' ? src : child(src, `lvl${level + 1}pPr`);
   if (!lvl) continue;
   const algn = lvl.getAttribute('algn'); if (algn) style.align = algn;
   if (lvl.getAttribute('marL') !== null) style.marL = emu(lvl.getAttribute('marL'));
   if (lvl.getAttribute('indent') !== null) style.indent = emu(lvl.getAttribute('indent'));
   const spacing = (name: string) => { const s = child(lvl, name); if (!s) return undefined; const pct = child(s, 'spcPct'), pts = child(s, 'spcPts'); return pct ? {pct: num(pct.getAttribute('val')) / 100000} : pts ? {pts: num(pts.getAttribute('val')) / 100} : undefined; };
   style.lineSpacing = spacing('lnSpc') ?? style.lineSpacing; style.before = spacing('spcBef') ?? style.before; style.after = spacing('spcAft') ?? style.after;
   if (child(lvl, 'buNone')) style.bullet = {none: true};
   const ch = child(lvl, 'buChar'), auto = child(lvl, 'buAutoNum');
   if (ch || auto) style.bullet = {...style.bullet, none: false, char: ch?.getAttribute('char') ?? undefined, auto: auto?.getAttribute('type') ?? undefined, start: num(auto?.getAttribute('startAt'), 1)};
   if (child(lvl, 'buFont') && style.bullet) style.bullet.font = child(lvl, 'buFont')!.getAttribute('typeface') ?? undefined;
   if (child(lvl, 'buClr') && style.bullet) style.bullet.color = this.color(child(lvl, 'buClr'), ctx);
   if (child(lvl, 'buSzPct') && style.bullet) style.bullet.size = num(child(lvl, 'buSzPct')!.getAttribute('val'), 100000) / 100000;
   style.run = this.runStyle(child(lvl, 'defRPr'), style.run, ctx);
  }
  return style;
 }
 runStyle(rPr: El | null | undefined, base: TextStyle, ctx: Ctx): TextStyle {
  if (!rPr) return base;
  const s = {...base};
  if (rPr.getAttribute('sz')) s.size = num(rPr.getAttribute('sz')) / 100;
  if (rPr.getAttribute('b') !== null) s.bold = rPr.getAttribute('b') === '1' || rPr.getAttribute('b') === 'true';
  if (rPr.getAttribute('i') !== null) s.italic = rPr.getAttribute('i') === '1' || rPr.getAttribute('i') === 'true';
  if (rPr.getAttribute('u') !== null) s.underline = rPr.getAttribute('u') !== 'none';
  if (rPr.getAttribute('strike') !== null) s.strike = rPr.getAttribute('strike') !== 'noStrike';
  if (rPr.getAttribute('cap') !== null) s.caps = rPr.getAttribute('cap')!;
  if (rPr.getAttribute('spc') !== null) s.spacing = num(rPr.getAttribute('spc')) / 100;
  if (rPr.getAttribute('baseline') !== null) s.baseline = num(rPr.getAttribute('baseline')) / 1000;
  const fill = child(rPr, 'solidFill'); if (fill) s.color = this.color(fill, ctx) ?? s.color;
  const font = child(rPr, 'latin')?.getAttribute('typeface'); if (font) s.font = font;
  return s;
 }
 fontStack(font: string | undefined) {
  const name = !font || font === '+mn-lt' ? this.theme.minor : font === '+mj-lt' ? this.theme.major : font;
  return [name, ...(SUBSTITUTES[name.toLowerCase()] ?? [])].map(f => `'${f.replace(/["'<>&]/g, '')}'`).join(',') + ',sans-serif';
 }
 paragraphs(body: El | null, inherited: (El | null)[], ctx: Ctx, part: Part, kind: 'title' | 'body' | 'other' | 'shape', extra: TextStyle, scale: number, width: number): string {
  if (!body) return '';
  const txStyles = child(ctx.master?.root, 'txStyles');
  const masterStyle = kind === 'title' ? child(txStyles, 'titleStyle') : kind === 'body' ? child(txStyles, 'bodyStyle') : kind === 'other' ? child(txStyles, 'otherStyle') : null;
  // Plain shapes use the presentation's default text style; placeholders the master's text styles.
  const presentation = kind === 'shape' ? this.defaultTextStyle() : null;
  const counters: number[] = [];
  const out: string[] = [];
  for (const p of children(body, 'p')) {
   const pPr = child(p, 'pPr'), level = num(pPr?.getAttribute('lvl'));
   const sources = [presentation, masterStyle, ...[...inherited].reverse().map(b => child(b, 'lstStyle')), child(body, 'lstStyle'), pPr];
   const st = this.levelStyle(level, sources, ctx);
   const runBase: TextStyle = {size: 18, ...st.run, ...Object.fromEntries(Object.entries(extra).filter(([, v]) => v !== undefined))};
   if (st.run.color && extra.color && kind !== 'shape') runBase.color = st.run.color;
   const runs: string[] = [];
   let firstSize: number | undefined;
   for (const r of kids(p)) {
    const name = local(r);
    if (name === 'r' || name === 'fld') {
     const rs = this.runStyle(child(r, 'rPr'), runBase, ctx);
     let text = child(r, 't')?.textContent ?? '';
     if (name === 'fld' && r.getAttribute('type') === 'slidenum') text = String(ctx.number);
     firstSize ??= rs.size;
     const link = path(r, 'rPr', 'hlinkClick'), href = link && part.rels.get(rid(link))?.target;
     const html = `<span style="${this.runCss(rs, scale)}">${escape(text)}</span>`;
     runs.push(href && /^(https?:|mailto:)/i.test(href) ? `<a href="${escape(href)}">${html}</a>` : html);
    } else if (name === 'br') runs.push('<br>');
   }
   const endSize = this.runStyle(child(p, 'endParaRPr'), runBase, ctx).size;
   const size = (firstSize ?? endSize ?? 18) * scale;
   const font = runBase.font;
   const factor = lineFactor(this.fontStack(font).split(',')[0]!.replace(/'/g, ''));
   const lh = st.lineSpacing?.pts ? `line-height:${pt(st.lineSpacing.pts)};` : `line-height:${Math.round((st.lineSpacing?.pct ?? 1) * factor * 1000) / 1000};`;
   const space = (s: {pct?: number; pts?: number} | undefined) => s ? (s.pts ?? (s.pct ?? 0) * size * 1.2) : 0;
   const align = st.align === 'ctr' ? 'center' : st.align === 'r' ? 'right' : st.align === 'just' || st.align === 'dist' ? 'justify' : 'left';
   let bullet = '';
   const hasText = runs.some(x => !/^<br>$/.test(x) && />[^<]+</.test(x));
   if (st.bullet && !st.bullet.none && hasText && kind !== 'title') {
    counters[level] = (counters[level] ?? (st.bullet.start ?? 1) - 1) + 1; counters.length = level + 1;
    const glyph = st.bullet.auto ? autoNumber(counters[level]!, st.bullet.auto) : symbol(st.bullet.char ?? '•', st.bullet.font);
    const indent = st.indent ?? 0;
    bullet = `<span style="display:inline-block;${indent < 0 ? `min-width:${pt(-indent)};` : 'margin-right:.4em;'}text-indent:0;${st.bullet.color ? `color:${st.bullet.color};` : ''}font-size:${pt(size * (st.bullet.size ?? 1))};${st.bullet.font && !/wingdings|symbol/i.test(st.bullet.font) ? `font-family:${this.fontStack(st.bullet.font)};` : ''}">${escape(glyph)}</span>`;
   } else if (!st.bullet || st.bullet.none) counters.length = level;
   const marL = st.marL ?? 0, indent = bullet ? st.indent ?? 0 : (st.indent ?? 0) > 0 ? st.indent! : 0;
   const filler = runs.length ? '' : `<span style="font-size:${pt(size)}">​</span>`;
   out.push(`<p style="text-align:${align};${lh}margin-left:${pt(marL)};text-indent:${pt(indent)};padding-top:${pt(space(st.before))};padding-bottom:${pt(space(st.after))};font-size:${pt(size)};font-family:${this.fontStack(font)}">${bullet}${runs.join('')}${filler}</p>`);
  }
  void width;
  return out.join('');
 }
 defaultTextStyle(): El | null {
  const main = [...this.pkg.rels('').values()].find(r => r.type.endsWith('/officeDocument'))?.target ?? 'ppt/presentation.xml';
  return child(this.pkg.xml(main), 'defaultTextStyle');
 }
 runCss(s: TextStyle, scale: number) {
  const size = (s.size ?? 18) * scale, css = [`font-family:${this.fontStack(s.font)}`, `font-size:${pt(s.baseline ? size * .67 : size)}`, `font-weight:${s.bold ? 700 : 400}`, `font-style:${s.italic ? 'italic' : 'normal'}`, `color:${s.color ?? '#000'}`];
  const lines = [s.underline ? 'underline' : '', s.strike ? 'line-through' : ''].filter(Boolean); if (lines.length) css.push(`text-decoration:${lines.join(' ')}`);
  if (s.caps === 'all') css.push('text-transform:uppercase'); else if (s.caps === 'small') css.push('font-variant:small-caps');
  if (s.spacing) css.push(`letter-spacing:${pt(s.spacing)}`);
  if (s.baseline) css.push(`vertical-align:${s.baseline > 0 ? 'super' : 'sub'}`);
  return css.join(';');
 }
}

const toLinear = (x: number) => { const c = x / 255; return c <= .04045 ? c / 12.92 : ((c + .055) / 1.055) ** 2.4; };
const fromLinear = (c: number) => 255 * (c <= .0031308 ? c * 12.92 : 1.055 * c ** (1 / 2.4) - .055);
function hsl(r: number, g: number, b: number): [number, number, number] {
 r /= 255; g /= 255; b /= 255; const max = Math.max(r, g, b), min = Math.min(r, g, b), l = (max + min) / 2;
 if (max === min) return [0, 0, l];
 const d = max - min, s = l > .5 ? d / (2 - max - min) : d / (max + min);
 const h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
 return [h / 6, s, l];
}
function rgb(h: number, s: number, l: number): [number, number, number] {
 if (!s) return [l * 255, l * 255, l * 255];
 const q = l < .5 ? l * (1 + s) : l + s - l * s, p = 2 * l - q, f = (t: number) => { t = (t + 1) % 1; return t < 1 / 6 ? p + (q - p) * 6 * t : t < .5 ? q : t < 2 / 3 ? p + (q - p) * (2 / 3 - t) * 6 : p; };
 return [f(h + 1 / 3) * 255, f(h) * 255, f(h - 1 / 3) * 255];
}
function roman(n: number) { const map: [number, string][] = [[1000, 'm'], [900, 'cm'], [500, 'd'], [400, 'cd'], [100, 'c'], [90, 'xc'], [50, 'l'], [40, 'xl'], [10, 'x'], [9, 'ix'], [5, 'v'], [4, 'iv'], [1, 'i']]; let out = ''; for (const [v, s] of map) while (n >= v) { out += s; n -= v; } return out; }
function autoNumber(n: number, type: string) {
 const letter = String.fromCharCode(96 + ((n - 1) % 26) + 1);
 const core = /^alphaLc/.test(type) ? letter : /^alphaUc/.test(type) ? letter.toUpperCase() : /^romanLc/.test(type) ? roman(n) : /^romanUc/.test(type) ? roman(n).toUpperCase() : String(n);
 return /ParenBoth$/.test(type) ? `(${core})` : /ParenR$/.test(type) ? `${core})` : /Plain$/.test(type) ? core : `${core}.`;
}
function symbol(char: string, font?: string) {
 const c = char.codePointAt(0) ?? 0x2022, code = c >= 0xf000 ? c - 0xf000 : c;
 if (font && /wingdings/i.test(font)) return ({0xa7: '▪', 0xa8: '◻', 0x6c: '●', 0x6e: '■', 0x71: '❑', 0x75: '◆', 0x76: '❖', 0xd8: '➢', 0xfc: '✓', 0xe0: '→', 0xe8: '➔', 0x9f: '•'} as Record<number, string>)[code] ?? '•';
 if (font && /symbol/i.test(font)) return ({0xb7: '•', 0xa8: '♦', 0xd7: '·'} as Record<number, string>)[code] ?? '•';
 return char;
}
