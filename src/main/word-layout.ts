import { createCanvas } from '@napi-rs/canvas';
import { PDFDocument, PDFName, PDFRawStream, PDFDict, PDFArray, PDFRef, ParseSpeeds, decodePDFRawStream, type PDFContext } from 'pdf-lib';
import { Document, Packer, Paragraph, TextRun, ImageRun, AlignmentType, FrameAnchorType, FrameWrap, HeightRule, HorizontalPositionRelativeFrom, VerticalPositionRelativeFrom, TextWrappingType, SectionType, LineRuleType, Table, TableRow, TableCell, WidthType, TableLayoutType, TableAnchorType, OverlapType, VerticalAlign, BorderStyle, ShadingType, PageNumber, type ISectionOptions } from 'docx';
import { pageGrid, tableOf, insideTable, type GridTable, type GridEdge } from './tables';
import type { PDFPageProxy } from 'pdfjs-dist/types/src/display/api';
import { inspectPage, loadPdf, pdfjs } from './conversion';
import { faceForPostscript, fontFamilies } from './fonts';
import { embeddedFaces, type EmbeddedFace } from './embedded-fonts';
import { bodyStyle, flowPage, flowSection, type FlowPage } from './docx-flow';

/** Word export that keeps the page layout, like "retain page layout" in desktop PDF converters:
 * each page gets its artwork (backgrounds, table fills and borders, icons, photos) rendered without
 * text and placed behind the page, and every text block is rebuilt on top as real, editable Word
 * text with its own font, size, weight, colour and alignment. */

export interface Run { text: string; x: number; baseline: number; width: number; size: number; font: string; bold: boolean; italic: boolean; color: string; space: boolean }
export interface Line { runs: Run[]; x: number; right: number; baseline: number; size: number }
export interface Block { lines: Line[]; x: number; right: number; size: number; align: 'left' | 'center' | 'right' | 'justify'; flow: boolean }

/** A painted path in top-left page points, ready to become a native PowerPoint shape. */
export interface VectorShape { segments: Segment[]; box: { x: number; y: number; width: number; height: number }; fill?: { color: string; alpha: number }; stroke?: { color: string; alpha: number; width: number; dash: boolean }; operation?:number }
type Segment = { op: 'M' | 'L'; x: number; y: number } | { op: 'C'; x1: number; y1: number; x2: number; y2: number; x: number; y: number } | { op: 'Z' };
type Matrix = [number, number, number, number, number, number];
const multiply = (c: Matrix, m: number[]): Matrix => [c[0] * m[0]! + c[2] * m[1]!, c[1] * m[0]! + c[3] * m[1]!, c[0] * m[2]! + c[2] * m[3]!, c[1] * m[2]! + c[3] * m[3]!, c[0] * m[4]! + c[2] * m[5]! + c[4], c[1] * m[4]! + c[3] * m[5]! + c[5]];
const apply = (c: Matrix, x: number, y: number) => ({ x: c[0] * x + c[2] * y + c[4], y: c[1] * x + c[3] * y + c[5] });
const hex = (value: unknown) => (typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value) ? value.toLowerCase() : null);
// PDF.js operator codes (OPS) used here; DrawOPS inside constructPath: 0 moveTo, 1 lineTo, 2 curveTo, 3 quadraticCurveTo, 4 closePath.
const OP = { setLineWidth: 2, setDash: 6, setGState: 9, save: 10, restore: 11, transform: 12, stroke: 20, closeStroke: 21, fill: 22, eoFill: 23, fillStroke: 24, eoFillStroke: 25, closeFillStroke: 26, closeEOFillStroke: 27, endPath: 28, clip: 29, eoClip: 30, setStrokeColorN: 53, setFillColorN: 55, setStrokeRGBColor: 58, setFillRGBColor: 59, shadingFill: 62, paintFormXObjectBegin: 74, paintFormXObjectEnd: 75, beginGroup: 76, endGroup:77, constructPath: 91 };
const MAX_SHAPES = 800;
type Box = { x: number; y: number; width: number; height: number };
const intersect = (a: Box, b: Box): Box => { const x = Math.max(a.x, b.x), y = Math.max(a.y, b.y); return { x, y, width: Math.min(a.x + a.width, b.x + b.width) - x, height: Math.min(a.y + a.height, b.y + b.height) - y }; };
const inside = (a: Box, b: Box) => a.x >= b.x - 0.5 && a.y >= b.y - 0.5 && a.x + a.width <= b.x + b.width + 0.5 && a.y + a.height <= b.y + b.height + 0.5;
/** An axis-aligned rectangle: straight segments whose points all sit on the box corners. */
function rectangle(path: { segments: Segment[]; box: Box }) {
  const near = (a: number, c: number) => Math.abs(a - c) < 0.6, points = path.segments.filter((s) => s.op !== 'Z'), b = path.box;
  return points.length >= 4 && points.length <= 5 && points.every((p) => p.op !== 'C' && (near(p.x, b.x) || near(p.x, b.x + b.width)) && (near(p.y, b.y) || near(p.y, b.y + b.height)));
}

/** Reads the page's vector art from the PDF.js operator list. `supported` is false when the page uses
 * something a PowerPoint shape cannot reproduce faithfully (gradients, patterns, clipped vectors,
 * soft masks or too many paths); such pages keep their vectors in the slide background. */
export async function vectorShapes(page: PDFPageProxy): Promise<{ supported: boolean; shapes: VectorShape[]; reason?: string; firstRaster?:number;lastRaster?:number; /** Areas painted with gradients or patterns. */ painted: Box[] }> {
  const list = await page.getOperatorList(), viewport = page.getViewport({ scale: 1 }), area = viewport.width * viewport.height;
  type State = { ctm: Matrix; fill: string; stroke: string; fillAlpha: number; strokeAlpha: number; width: number; dash: boolean; clip: Box | null; clipComplex:boolean; pattern: boolean; masked:boolean; blended:boolean };
  let state: State = { ctm: [...viewport.transform] as Matrix, fill: '#000000', stroke: '#000000', fillAlpha: 1, strokeAlpha: 1, width: 1, dash: false, clip: null, clipComplex:false,pattern: false, masked:false,blended:false };
  const stack: State[] = [], shapes: VectorShape[] = [], painted: Box[] = [];
  let unsupportedReason:string|undefined,firstRaster=Infinity,lastRaster=-1;
  let pending: { segments: Segment[]; box: VectorShape['box'] } | null = null, clipNext = false;
  for (let i = 0; i < list.fnArray.length; i++) {
    const fn = list.fnArray[i]!, args = list.argsArray[i] as any[];
    switch (fn) {
      case OP.save: stack.push({ ...state }); break;
      case OP.beginGroup: stack.push({...state});if(args[0]?.smask){state={...state,masked:true};unsupportedReason??='máscara suave';}break;
      case OP.restore: case OP.endGroup: state = stack.pop() ?? state; break;
      case OP.transform: state.ctm = multiply(state.ctm, args); break;
      case OP.paintFormXObjectBegin: stack.push({ ...state }); if (Array.isArray(args[0]) || ArrayBuffer.isView(args[0])) state.ctm = multiply(state.ctm, Array.from(args[0] as ArrayLike<number>)); break;
      case OP.paintFormXObjectEnd: state = stack.pop() ?? state; break;
      case OP.setLineWidth: state.width = Number(args[0]) || 0; break;
      case OP.setDash: state.dash = Array.isArray(args[0]) && args[0].length > 0; break;
      case OP.setFillRGBColor: state.fill = hex(args[0]) ?? state.fill; state.pattern = false; break;
      case OP.setStrokeRGBColor: state.stroke = hex(args[0]) ?? state.stroke; break;
      case OP.setFillColorN: case OP.setStrokeColorN: state.pattern = true; break;
      case OP.setGState:
        for (const [key, value] of (args[0] ?? []) as [string, unknown][]) {
          if (key === 'ca') state.fillAlpha = Number(value); else if (key === 'CA') state.strokeAlpha = Number(value);
          else if (key === 'SMask') {state.masked=!!value;if(value)unsupportedReason ??= 'máscara suave';}
          else if(key==='BM'){state.blended=value!=='source-over'&&value!=='Normal';if(state.blended)unsupportedReason??='mistura de cores';}
        }
        break;
      case OP.shadingFill: unsupportedReason ??= 'degradê';firstRaster=Math.min(firstRaster,i);lastRaster=i; painted.push(state.clip ?? { x: 0, y: 0, width: viewport.width, height: viewport.height }); break;
      case OP.constructPath: {
        const paint = args[0] as number, data = (Array.isArray(args[1]) ? args[1][0] : args[1]) as ArrayLike<number> | undefined;
        const segments: Segment[] = [];
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        const add = (x: number, y: number) => { const p = apply(state.ctm, x, y); minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x); minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y); return p; };
        for (let k = 0; data && k < data.length;) {
          const code = data[k++];
          if (code === 0 || code === 1) { const p = add(data[k++]!, data[k++]!); const previous=segments.at(-1); if(!(code===0&&previous?.op==='M'&&previous.x===p.x&&previous.y===p.y))segments.push({ op: code === 0 ? 'M' : 'L', ...p }); }
          else if (code === 2) { const a = add(data[k++]!, data[k++]!), b = add(data[k++]!, data[k++]!), p = add(data[k++]!, data[k++]!); segments.push({ op: 'C', x1: a.x, y1: a.y, x2: b.x, y2: b.y, x: p.x, y: p.y }); }
          else if (code === 3) { const a = add(data[k++]!, data[k++]!), p = add(data[k++]!, data[k++]!); segments.push({ op: 'C', x1: a.x, y1: a.y, x2: a.x, y2: a.y, x: p.x, y: p.y }); }
          else if (code === 4) segments.push({ op: 'Z' });
          else { unsupportedReason ??= 'caminho desconhecido';firstRaster=Math.min(firstRaster,i);lastRaster=i; segments.length = 0; break; }
        }
        pending = segments.length ? { segments, box: { x: minX, y: minY, width: maxX - minX, height: maxY - minY } } : null;
        // PDF.js emits the clip operator before the path it applies to. A clip that leaves (nearly) the
        // whole page visible changes nothing; anything smaller would cut the shapes painted inside it.
        if (clipNext) {
          clipNext = false;
          if(pending&&!rectangle(pending))state.clipComplex=true;
          if (pending && pending.box.width * pending.box.height < area * 0.97) state.clip = state.clip ? intersect(state.clip, pending.box) : pending.box;
        }
        const filled = [OP.fill, OP.eoFill, OP.fillStroke, OP.eoFillStroke, OP.closeFillStroke, OP.closeEOFillStroke].includes(paint);
        const stroked = [OP.stroke, OP.closeStroke, OP.fillStroke, OP.eoFillStroke, OP.closeFillStroke, OP.closeEOFillStroke].includes(paint);
        if ((filled || stroked) && pending) {
          if(state.masked||state.blended||state.clipComplex){if(state.clipComplex)unsupportedReason??='recorte';firstRaster=Math.min(firstRaster,i);lastRaster=i;pending=null;break;}
          if (state.pattern && filled) { unsupportedReason ??= 'padrão';firstRaster=Math.min(firstRaster,i);lastRaster=i; painted.push(state.clip ? intersect(pending.box, state.clip) : pending.box); pending=null; break; }
          if (state.clip && !inside(pending.box, state.clip)) {
            // Rectangles are cut to the clip exactly; other shapes would show what the clip hides.
            if (!rectangle(pending)||stroked) { unsupportedReason ??= 'recorte';firstRaster=Math.min(firstRaster,i);lastRaster=i; pending = null; break; }
            const b = intersect(pending.box, state.clip);
            if (b.width <= 0 || b.height <= 0) { pending = null; break; }
            pending = { box: b, segments: [{ op: 'M', x: b.x, y: b.y }, { op: 'L', x: b.x + b.width, y: b.y }, { op: 'L', x: b.x + b.width, y: b.y + b.height }, { op: 'L', x: b.x, y: b.y + b.height }, { op: 'Z' }] };
          }
          if ([OP.closeStroke, OP.closeFillStroke, OP.closeEOFillStroke].includes(paint)) pending.segments.push({ op: 'Z' });
          const scale = Math.sqrt(Math.abs(state.ctm[0] * state.ctm[3] - state.ctm[1] * state.ctm[2]));
          shapes.push({ ...pending, operation:i, ...(filled ? { fill: { color: state.fill, alpha: state.fillAlpha } } : {}), ...(stroked ? { stroke: { color: state.stroke, alpha: state.strokeAlpha, width: Math.max(0.25, state.width * scale), dash: state.dash } } : {}) });
          if (shapes.length > MAX_SHAPES) return { supported: false, shapes: shapes.slice(0,MAX_SHAPES), reason: 'formas demais', painted };
          pending = null;
        }
        break;
      }
      case OP.clip: case OP.eoClip: clipNext = true; break;
      case OP.endPath: pending = null; break;
    }
  }
  return { supported: !unsupportedReason, shapes, painted,firstRaster,lastRaster, ...(unsupportedReason?{reason:unsupportedReason}:{}) };
}

/** Replaces every path-painting operator with `n` (end path, paint nothing), outside strings and inline images. */
export function stripPaths(content: Uint8Array): Uint8Array {
  const text = Buffer.from(content).toString('latin1'), out: string[] = [];
  const PAINT = new Set(['f', 'F', 'f*', 'S', 's', 'B', 'B*', 'b', 'b*']), DELIM = /[\s()<>[\]{}/%]/;
  let i = 0, start = 0;
  while (i < text.length) {
    const c = text[i]!;
    if (c === '(') { let depth = 0; for (; i < text.length; i++) { const d = text[i]; if (d === '\\') { i++; continue; } if (d === '(') depth++; else if (d === ')' && --depth === 0) { i++; break; } } continue; }
    if (c === '%') { while (i < text.length && text[i] !== '\n' && text[i] !== '\r') i++; continue; }
    if (c === '<' && text[i + 1] !== '<') { const end = text.indexOf('>', i); i = end < 0 ? text.length : end + 1; continue; }
    if (DELIM.test(c)) { i++; continue; }
    let j = i; while (j < text.length && !DELIM.test(text[j]!)) j++;
    const token = text.slice(i, j);
    if (token === 'ID') { const end = text.indexOf('EI', j); i = end < 0 ? text.length : end + 2; continue; }
    if (PAINT.has(token)) { out.push(text.slice(start, i), 'n'); start = j; }
    i = j;
  }
  out.push(text.slice(start));
  return Buffer.from(out.join(''), 'latin1');
}

/** Image XObjects a content stream can paint, by resource name. */
function imageNames(context: PDFContext, resources: PDFDict | undefined): Set<string> {
  const names = new Set<string>(), objects = resources?.lookupMaybe(PDFName.of('XObject'), PDFDict);
  if (!objects) return names;
  for (const [name, value] of objects.entries()) {
    const target = value instanceof PDFRef ? context.lookup(value) : value;
    if (target instanceof PDFRawStream && target.dict.get(PDFName.of('Subtype'))?.toString() === '/Image') names.add(name.asString().slice(1));
  }
  return names;
}
/** Makes every text object invisible (text rendering mode 3) and, when asked, skips painting the
 * given images, so the page renders as artwork only. */
function hideContent(content: Uint8Array, images: Set<string>, paths = false): Uint8Array {
  const text = Buffer.from(paths ? stripPaths(content) : content).toString('latin1');
  let hidden = text.replace(/(^|[\s\]>)}])BT(?=[\s/[<(])/g, '$1BT 3 Tr').replace(/(^|[\s\]>)}])[0-7](?=\s+Tr(?=[\s/[<(]|$))/g, '$13');
  if (images.size) hidden = hidden.replace(/\/([^\s/[\]<>(){}%]+)\s+Do(?=[\s/[<(]|$)/g, (all, name: string) => (images.has(name) ? '' : all));
  return Buffer.from(hidden, 'latin1');
}
function rewriteStream(context: PDFContext, ref: PDFRef, seen: Set<string>, inherited: PDFDict | undefined, withImages: boolean, paths = false) {
  const key = ref.toString();
  if (seen.has(key)) return;
  seen.add(key);
  const stream = context.lookup(ref);
  if (!(stream instanceof PDFRawStream)) return;
  const decoded = decodePDFRawStream(stream).decode();
  const dict = stream.dict.clone(context), resources = dict.lookupMaybe(PDFName.of('Resources'), PDFDict) ?? inherited;
  dict.delete(PDFName.of('Filter'));
  dict.delete(PDFName.of('DecodeParms'));
  dict.delete(PDFName.of('Length'));
  context.assign(ref, context.flateStream(hideContent(decoded, withImages ? new Set() : imageNames(context, resources), paths), Object.fromEntries([...dict.entries()].map(([name, value]) => [name.asString().slice(1), value]))));
  if (resources) rewriteForms(context, resources, seen, withImages, paths);
}
function rewriteForms(context: PDFContext, resources: PDFDict, seen: Set<string>, withImages: boolean, paths = false) {
  const objects = resources.lookupMaybe(PDFName.of('XObject'), PDFDict);
  if (!objects) return;
  for (const [, value] of objects.entries()) {
    if (!(value instanceof PDFRef)) continue;
    const target = context.lookup(value);
    if (target instanceof PDFRawStream && target.dict.get(PDFName.of('Subtype'))?.toString() === '/Form') rewriteStream(context, value, seen, resources, withImages, paths);
  }
}
/** The PDF with text hidden (and, with `withImages: false`, photos too): the layer drawn behind
 * rebuilt Office content. */
export async function artworkOnly(bytes: Uint8Array, withImages = true, withoutPaths: Set<number> = new Set()): Promise<Uint8Array> {
  const doc = await PDFDocument.load(bytes, { updateMetadata: false, parseSpeed: ParseSpeeds.Fastest }), seen = new Set<string>();
  for (const [index, page] of doc.getPages().entries()) {
    const paths = withoutPaths.has(index);
    const contents = page.node.get(PDFName.of('Contents')), resources = page.node.Resources();
    const refs = contents instanceof PDFRef ? [contents] : contents instanceof PDFArray ? contents.asArray().filter((v): v is PDFRef => v instanceof PDFRef) : [];
    for (const ref of refs) rewriteStream(doc.context, ref, seen, resources, withImages, paths);
    if (resources) rewriteForms(doc.context, resources, seen, withImages, paths);
  }
  return doc.save({ useObjectStreams: false, objectsPerTick: Infinity });
}

const SEGOE = /^SegoeUI(Black|Semibold|Semilight|Light|Emoji|Symbol|Historic)?/i;
/** Maps embedded (often subset) font names to the family Word knows on the system. */
export function wordFont(raw: string): { family: string; bold: boolean; italic: boolean } {
  const name = raw.replace(/^[A-Z]{6}\+/, '').replace(/,/, '-');
  const italic = /italic|oblique/i.test(name);
  const segoe = SEGOE.exec(name.replace(/[-\s]/g, ''));
  if (segoe) {
    const variant = segoe[1] ? segoe[1][0]!.toUpperCase() + segoe[1].slice(1).toLowerCase() : '';
    return { family: variant ? `Segoe UI ${variant}` : 'Segoe UI', bold: /-?bold/i.test(name) && !variant, italic };
  }
  const bold = /bold|black|heavy|semibold|demibold|extrabold/i.test(name);
  const base = name.split('-')[0]!.replace(/(PSMT|PS|MT)$/, '');
  const known: Record<string, string> = { Arial: 'Arial', Helvetica: 'Arial', TimesNewRoman: 'Times New Roman', Times: 'Times New Roman', CourierNew: 'Courier New', Courier: 'Courier New', Calibri: 'Calibri', Cambria: 'Cambria', Verdana: 'Verdana', Tahoma: 'Tahoma', Georgia: 'Georgia', Consolas: 'Consolas' };
  const family = known[base] ?? base.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/(Bold|Regular|Medium|Light|Black|Semibold|Italic)$/i, '').trim();
  return { family: family || 'Arial', bold, italic };
}
/** The fill colour of every shown character, in content order, from the operator list. */
async function characterColors(page: PDFPageProxy): Promise<{ chars: string[]; colors: string[] }> {
  const engine = await pdfjs(), OPS = engine.OPS, ops = await page.getOperatorList(), chars: string[] = [], colors: string[] = [];
  let fill = '#000000';
  const stack: string[] = [];
  for (let i = 0; i < ops.fnArray.length; i++) {
    const fn = ops.fnArray[i], args = ops.argsArray[i] as any[];
    if (fn === OPS.save) stack.push(fill);
    else if (fn === OPS.restore) fill = stack.pop() ?? fill;
    else if (fn === OPS.setFillRGBColor && typeof args?.[0] === 'string') fill = args[0];
    else if (fn === OPS.setFillGray && typeof args?.[0] === 'string') fill = args[0];
    else if (fn === OPS.showText || fn === OPS.showSpacedText) {
      for (const glyph of args?.[0] ?? []) if (glyph && typeof glyph === 'object' && typeof glyph.unicode === 'string') for (const c of glyph.unicode) if (c.trim()) { chars.push(c); colors.push(fill); }
    }
  }
  return { chars, colors };
}
/** Families with the same character widths, so text keeps its line breaks where the original is absent
 * (Linux and macOS ship these instead of the Microsoft fonts). */
const METRIC_TWINS: Record<string, string[]> = {
  calibri: ['Carlito'], cambria: ['Caladea'], arial: ['Liberation Sans', 'Arimo', 'Helvetica'], helvetica: ['Arial', 'Liberation Sans', 'Arimo'],
  'times new roman': ['Liberation Serif', 'Tinos', 'Times'], times: ['Times New Roman', 'Liberation Serif', 'Tinos'], 'courier new': ['Liberation Mono', 'Cousine', 'Courier'], courier: ['Courier New', 'Liberation Mono'],
  carlito: ['Calibri'], caladea: ['Cambria'], 'liberation sans': ['Arial'], 'liberation serif': ['Times New Roman'], 'liberation mono': ['Courier New'],
};
/** How the fonts of one conversion resolve: the PDF's own font programs, what this computer has, and the
 * faces the output document embeds so it opens with the original fonts on any system. */
export class FontContext {
  readonly missing = new Map<string, string>();
  readonly embedded = new Map<string, { regular?: Buffer; bold?: Buffer; italic?: Buffer; boldItalic?: Buffer }>();
  constructor(readonly faces: Map<string, EmbeddedFace> = new Map(), readonly canEmbed = false) {}
  static async of(bytes: Uint8Array, canEmbed: boolean) { return new FontContext(await embeddedFaces(bytes).catch(() => new Map()), canEmbed); }
  /** Embedded faces in the shape the docx writer takes; a family with only a bold face uses it as regular too. */
  docxFonts() {
    return [...this.embedded].flatMap(([name, f]) => { const data = f.regular ?? f.bold ?? f.italic ?? f.boldItalic; return data ? [{ name, data, ...(f.bold ? { bold: f.bold } : {}), ...(f.italic ? { italic: f.italic } : {}), ...(f.boldItalic ? { boldItalic: f.boldItalic } : {}) }] : []; });
  }
  /** The family Office should use. Installed fonts are used as they are. A missing font the PDF carries
   * complete, whose licence allows editing, travels inside the document; otherwise a font with the same
   * widths is preferred, then a close family, so lines do not overflow. */
  async family(family: string, generic: string | undefined, face?: EmbeddedFace) {
    const installed = new Set((await fontFamilies().catch(() => [] as string[])).map((f) => f.toLowerCase()));
    if (!installed.size || installed.has(family.toLowerCase())) return family;
    if (this.canEmbed && face?.data && face.complete && face.editable) {
      const slot = face.bold ? (face.italic ? 'boldItalic' : 'bold') : face.italic ? 'italic' : 'regular', entry = this.embedded.get(family) ?? {};
      entry[slot] ??= face.data; this.embedded.set(family, entry);
      return family;
    }
    const twin = METRIC_TWINS[family.toLowerCase()]?.find((f) => installed.has(f.toLowerCase()));
    const serif = /serif/i.test(generic ?? '') && !/sans/i.test(generic ?? '') || /slab|serif|times|garamond|georgia|book|roman|minion|merriweather|lora|playfair|caslon|cambria|caladea/i.test(family);
    const mono = /mono/i.test(generic ?? '') || /mono|courier|code|consol/i.test(family);
    const substitute = twin ?? [mono ? 'Consolas' : serif ? 'Cambria' : 'Segoe UI', mono ? 'Liberation Mono' : serif ? 'Liberation Serif' : 'Liberation Sans', 'Arial'].find((f) => installed.has(f.toLowerCase())) ?? 'Arial';
    this.missing.set(family, substitute);
    return substitute;
  }
}
export async function pageRuns(page: PDFPageProxy, fonts: FontContext = new FontContext()): Promise<Run[]> {
  const engine = await pdfjs(), viewport = page.getViewport({ scale: 1 });
  // The operator list resolves the embedded fonts, so their real names are known for the text items.
  const palette = await characterColors(page), content = await page.getTextContent();
  const runs: Run[] = [];
  let cursor = 0, pendingSpace = false;
  // Index of a character sequence in the coloured stream, searched forward from the cursor first.
  const locate = (needle: string[]) => {
    const fits = (at: number) => needle.every((c, i) => palette.chars[at + i] === c);
    for (let at = cursor; at <= palette.chars.length - needle.length && at < cursor + 2000; at++) if (fits(at)) return at;
    for (let at = 0; at <= palette.chars.length - needle.length; at++) if (fits(at)) return at;
    return -1;
  };
  for (const item of content.items) {
    if (!('str' in item)) continue;
    // Spaces often arrive as separate items; remember them for the next word.
    if (!item.str.trim()) { if (item.str.length) pendingSpace = true; continue; }
    const t = engine.Util.transform(viewport.transform, item.transform), size = Math.hypot(t[2], t[3]);
    if (!Number.isFinite(size) || size < 1 || Math.abs(t[1]) > 0.01 * size) continue;
    let raw = '';
    try { const font = page.commonObjs.get(item.fontName) as { name?: string }; raw = font?.name ?? ''; } catch {}
    // An installed face with the same PostScript name gives Word the exact family and weight. Otherwise the
    // font program inside the PDF names itself, even when the PDF hides it (CIDFont+F1).
    const face = raw ? await faceForPostscript(raw) : undefined, own = raw ? fonts.faces.get(raw) : undefined;
    const style = face ? { family: face.legacy, bold: /bold/i.test(face.legacyStyle), italic: face.italic } : own ? { family: own.family, bold: own.bold, italic: own.italic } : wordFont(raw || content.styles[item.fontName]?.fontFamily || 'Arial');
    if (!face) style.family = await fonts.family(style.family, content.styles[item.fontName]?.fontFamily, own);
    // The item's colour is the fill colour of its own characters, matched as a whole sequence.
    const visible = [...item.str].filter((c) => c.trim()), at = locate(visible.slice(0, 8));
    const color = at >= 0 ? palette.colors[at]! : palette.colors[cursor] ?? '#000000';
    if (at >= 0) cursor = at + visible.length;
    runs.push({ text: item.str, x: t[4], baseline: t[5], width: Math.max(item.width, 0.5), size, font: style.family, bold: style.bold, italic: style.italic, color, space: pendingSpace });
    pendingSpace = false;
  }
  return runs;
}
export function buildLines(runs: Run[]): Line[] {
  const rows: Run[][] = [];
  for (const run of [...runs].sort((a, b) => a.baseline - b.baseline || a.x - b.x)) {
    const row = rows.find((r) => Math.abs(r[0]!.baseline - run.baseline) <= Math.max(1.5, Math.min(r[0]!.size, run.size) * 0.3));
    if (row) row.push(run); else rows.push([run]);
  }
  const lines: Line[] = [];
  for (const row of rows) {
    row.sort((a, b) => a.x - b.x);
    // Wide gaps separate columns and table cells: each becomes its own line segment.
    let current: Run[] = [];
    const flush = () => { if (current.length) lines.push({ runs: current, x: current[0]!.x, right: Math.max(...current.map((r) => r.x + r.width)), baseline: Math.max(...current.map((r) => r.baseline)), size: Math.max(...current.map((r) => r.size)) }); current = []; };
    for (const run of row) {
      const last = current.at(-1), gap = last ? run.x - (last.x + last.width) : 0;
      // A wide gap, or a clear gap where colour/size changes (badge then title, table cells), starts a new segment.
      const styleChange = last && (last.color !== run.color || Math.abs(last.size - run.size) > last.size * 0.15);
      if (last && (gap > Math.max(10, last.size * 1.6) || (styleChange && gap > last.size * 0.45))) flush();
      current.push(run);
    }
    flush();
  }
  return lines.sort((a, b) => a.baseline - b.baseline || a.x - b.x);
}
export function buildBlocks(lines: Line[]): Block[] {
  const blocks: Block[] = [];
  for (const line of lines) {
    const center = (line.x + line.right) / 2;
    const block = blocks.find((b) => {
      const last = b.lines.at(-1)!, gap = line.baseline - last.baseline;
      if (gap <= 0 || gap > Math.max(last.size, line.size) * 1.75 || Math.abs(line.size - last.size) > last.size * 0.12) return false;
      const sameLeft = Math.abs(line.x - last.x) < 2.5, sameCenter = Math.abs(center - (last.x + last.right) / 2) < 2.5 && b.align !== 'left';
      const overlaps = line.x < b.right + 2 && line.right > b.x - 2;
      return overlaps && (sameLeft || sameCenter);
    });
    if (!block) { blocks.push({ lines: [line], x: line.x, right: line.right, size: line.size, align: 'left', flow: false }); continue; }
    const last = block.lines.at(-1)!;
    if (block.lines.length === 1 && Math.abs(line.x - last.x) >= 2.5) block.align = 'center';
    block.lines.push(line); block.x = Math.min(block.x, line.x); block.right = Math.max(block.right, line.right);
  }
  // Paragraphs that follow each other without a blank line share a block: in prose whose lines reach the
  // right edge, a line that stops short ends its paragraph.
  const parts = blocks.flatMap((b) => {
    if (b.align !== 'left' || b.lines.length < 3) return [b];
    const tolerance = Math.max(1.5, b.size * 0.15), full = b.lines.filter((l) => b.right - l.right < tolerance).length;
    if (full < b.lines.length / 2) return [b];
    const out: Block[] = [];
    let current: Line[] = [];
    for (const [i, line] of b.lines.entries()) {
      current.push(line);
      if (i < b.lines.length - 1 && b.right - line.right > b.size * 2) { out.push({ ...b, lines: current }); current = []; }
    }
    if (current.length) out.push({ ...b, lines: current });
    return out.map((p) => ({ ...p, x: Math.min(...p.lines.map((l) => l.x)), right: b.right }));
  });
  const words = (l: Line) => l.runs.reduce((n, r) => n + r.text.trim().split(/\s+/).length, 0);
  for (const b of parts) {
    const width = b.right - b.x, body = b.lines.slice(0, -1);
    // Prose fills its column: let Word rewrap it. Lists, headings and cells keep their line breaks.
    b.flow = b.align === 'left' && b.lines.length > 2 && body.every((l) => l.right - l.x > width * 0.82) && !b.lines.some((l) => /^[•\-–·\d]+[.)]?\s/.test(l.runs[0]!.text));
    // Every line but the last ends at the same right edge: the text is justified. One full line proves
    // nothing (it defines the edge), so at least two are needed.
    if (b.align === 'left' && body.length >= 2 && body.every((l) => b.right - l.right < Math.max(1.2, b.size * 0.12)) && body.some((l) => words(l) > 3)) b.align = 'justify';
  }
  return parts;
}
/** How many spaces a gap between two pieces of text holds. The narrowest word gap of a long line is one
 * space (justified lines stretch every gap alike); a gap several times wider keeps that many spaces,
 * as in form blanks like "[    ]". */
export function spacesIn(gap: number, unit: number) { return gap > unit * 2.4 ? Math.min(60, Math.round(gap / unit)) : 1; }
/** Word runs for one line. In a header or footer, `fields` turns the page number (and the page count) the
 * PDF printed into Word's own page fields, so they count right after editing. */
export function lineRuns(line: Line, leadingSpace: boolean, fields?: { page: string; total?: string }): TextRun[] {
  const gaps = line.runs.slice(1).map((run, i) => run.x - (line.runs[i]!.x + line.runs[i]!.width)).filter((g) => g > 0.5);
  // With few gaps the narrowest may itself hold several spaces; a typical space (about a quarter em) is the unit then.
  const size = line.size, unit = Math.min(size * 0.4, Math.max(size * 0.2, gaps.length >= 4 ? Math.min(...gaps) : size * 0.25));
  return line.runs.flatMap((run, index) => {
    const previous = line.runs[index - 1], gap = previous ? run.x - (previous.x + previous.width) : 0;
    const space = (index === 0 && leadingSpace) || (index > 0 && run.space) || (gap > Math.max(0.8, run.size * 0.15) && !/^\s/.test(run.text) && !/\s$/.test(previous?.text ?? ''));
    const style = { font: { ascii: run.font, hAnsi: run.font, cs: run.font, eastAsia: run.font }, size: Math.max(2, Math.round(run.size * 2)), bold: run.bold, italics: run.italic, color: run.color.replace('#', '').toUpperCase() };
    const text = (space ? ' '.repeat(index > 0 ? spacesIn(gap, unit) : 1) : '') + run.text;
    if (!fields) return [new TextRun({ text, ...style })];
    return text.split(/(\d+)/).filter(Boolean).map((piece) => piece === fields.page ? new TextRun({ children: [PageNumber.CURRENT], ...style }) : piece === fields.total ? new TextRun({ children: [PageNumber.TOTAL_PAGES], ...style }) : new TextRun({ text: piece, ...style }));
  });
}
function blockParagraph(block: Block, pageWidth: number): Paragraph {
  const pitch = block.lines.length > 1 ? (block.lines.at(-1)!.baseline - block.lines[0]!.baseline) / (block.lines.length - 1) : block.size * 1.22;
  const lineHeight = Math.max(pitch, block.size * 1.05), top = block.lines[0]!.baseline - lineHeight * 0.8;
  // Single lines get generous room so a font with wider metrics (or letter spacing) never wraps them.
  // Justified text is stretched to the frame, so the frame is the original column width exactly.
  const slack = block.align === 'justify' ? 0.6 : block.flow ? block.size * 0.4 : block.lines.length === 1 ? block.size * 3 + (block.right - block.x) * 0.3 : block.size * 1.2 + (block.right - block.x) * 0.04;
  const width = Math.min(pageWidth - block.x, block.right - block.x + slack);
  const x = block.align === 'center' ? Math.max(0, (block.x + block.right) / 2 - width / 2) : block.x;
  const children: TextRun[] = [];
  block.lines.forEach((line, index) => {
    if (index > 0 && !block.flow) children.push(new TextRun({ break: 1 }));
    children.push(...lineRuns(line, index > 0 && block.flow));
  });
  return new Paragraph({
    frame: { type: 'absolute', position: { x: Math.round(x * 20), y: Math.max(0, Math.round(top * 20)) }, width: Math.max(40, Math.round(width * 20)), height: Math.round(lineHeight * block.lines.length * 20), anchor: { horizontal: FrameAnchorType.PAGE, vertical: FrameAnchorType.PAGE }, rule: HeightRule.ATLEAST, wrap: FrameWrap.NONE, space: { horizontal: 0, vertical: 0 } },
    alignment: block.align === 'center' ? AlignmentType.CENTER : block.align === 'right' ? AlignmentType.RIGHT : block.align === 'justify' ? AlignmentType.JUSTIFIED : AlignmentType.LEFT,
    spacing: { before: 0, after: 0, line: Math.round(lineHeight * 20), lineRule: LineRuleType.EXACT },
    children,
  });
}
/** Renders the artwork-only page; returns null when it is blank white. On a scanned page the words are
 * part of the picture: `erase` covers each recognized word with the paper colour around it, so only the
 * editable text shows. */
async function artwork(page: PDFPageProxy, dpi: number, erase: Run[] = [], omit:ReadonlySet<number>=new Set(),transparent=false): Promise<Buffer | null> {
  const viewport = page.getViewport({ scale: dpi / 72 }), canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height)), context = canvas.getContext('2d');
  await page.render({ canvas: canvas as never, canvasContext: context as never, viewport, background: transparent?'rgba(0,0,0,0)':'white',operationsFilter:index=>!omit.has(index) }).promise;
  const k = dpi / 72;
  for (const run of erase) {
    const x = Math.max(0, Math.floor((run.x - 1) * k)), y = Math.max(0, Math.floor((run.baseline - run.size * 0.95) * k));
    const w = Math.min(canvas.width - x, Math.ceil((run.width + 2) * k)), h = Math.min(canvas.height - y, Math.ceil(run.size * 1.25 * k));
    if (w <= 0 || h <= 0) continue;
    // The brightest pixels on the box border are the paper; ink is darker.
    const ring = [context.getImageData(x, Math.max(0, y - 2), w, 1).data, context.getImageData(x, Math.min(canvas.height - 1, y + h + 1), w, 1).data];
    const samples: number[][] = [];
    for (const row of ring) for (let i = 0; i < row.length; i += 4) samples.push([row[i]!, row[i + 1]!, row[i + 2]!]);
    samples.sort((a, b) => b[0]! + b[1]! + b[2]! - (a[0]! + a[1]! + a[2]!));
    const paper = samples[Math.floor(samples.length * 0.25)] ?? [255, 255, 255];
    context.fillStyle = `rgb(${paper[0]},${paper[1]},${paper[2]})`;
    context.fillRect(x, y, w, h);
  }
  const { data } = context.getImageData(0, 0, canvas.width, canvas.height);
  let ink = false;
  for (let i = 0; i < data.length && !ink; i += 4) if (transparent?data[i+3]!>0:data[i]! < 248 || data[i + 1]! < 248 || data[i + 2]! < 248) ink = true;
  return ink ? transparent?canvas.toBuffer('image/png'):canvas.toBuffer('image/jpeg', 88) : null;
}
/** Text recognized by OCR on scanned pages (by page index), used where the PDF has no text of its own. */
export type OcrRuns = Map<number, Run[]>;
export async function toDocxLayout(bytes: Uint8Array, dpi: number, warnings: string[], onProgress?: (message: string) => void, ocr: OcrRuns = new Map()) {
  onProgress?.('Preparando o fundo das páginas…');
  const [source, art, fonts] = await Promise.all([loadPdf(bytes), artworkOnly(bytes).then(loadPdf), FontContext.of(bytes, true)]), missing = fonts.missing;
  try {
    const sections: ISectionOptions[] = [];
    let tables = 0, flowed = 0, laidOut = 0, flowPages: FlowPage[] = [];
    const allFlow: FlowPage[] = [];
    // Consecutive text pages of one size become one flowing section with their margins, header and footer.
    const closeFlow = () => {
      if (!flowPages.length) return;
      const section = flowSection(flowPages, source.numPages);
      sections.push({ ...section, properties: { ...section.properties, type: SectionType.NEXT_PAGE } });
      flowed += flowPages.length; flowPages = [];
    };
    for (let i = 1; i <= source.numPages; i++) {
      onProgress?.(`Convertendo página ${i} de ${source.numPages}…`);
      const page = await source.getPage(i), viewport = page.getViewport({ scale: 1 });
      const scanned = ocr.get(i - 1);
      if (!scanned) {
        const flow = await flowPage(page, fonts, (await inspectPage(page, true)).images);
        if (flow) {
          if (flowPages.length && (Math.abs(flowPages[0]!.width - flow.width) > 1 || Math.abs(flowPages[0]!.height - flow.height) > 1)) closeFlow();
          flowPages.push(flow); allFlow.push(flow); tables += flow.items.filter((item) => item.kind === 'table').length;
          page.cleanup(); continue;
        }
      }
      closeFlow(); laidOut++;
      const artPage = await art.getPage(i);
      const [allRuns, background, grid] = await Promise.all([scanned ?? pageRuns(page, fonts), artwork(artPage, dpi, scanned), scanned ? null : pageGrid(page, fonts).catch(() => null)]);
      // A ruled/filled table becomes a real Word table at its place; its text is not repeated as frames.
      const table = grid ? tableOf(grid) : null;
      const runs = table ? allRuns.filter((r) => !insideTable(table, { x: r.x, y: r.baseline - r.size * 0.7, width: Math.min(r.width, 1), height: r.size * 0.6 })) : allRuns;
      const children: (Paragraph | Table)[] = [];
      if (table) { children.push(wordTable(table)); tables++; }
      if (background) children.push(new Paragraph({ spacing: { before: 0, after: 0 }, children: [new ImageRun({ type: 'jpg', data: background, transformation: { width: viewport.width * 96 / 72, height: viewport.height * 96 / 72 }, floating: { horizontalPosition: { relative: HorizontalPositionRelativeFrom.PAGE, offset: 0 }, verticalPosition: { relative: VerticalPositionRelativeFrom.PAGE, offset: 0 }, behindDocument: true, allowOverlap: true, lockAnchor: true, wrap: { type: TextWrappingType.NONE } } })] }));
      if (!runs.length) warnings.push(`A página ${i} não tem texto extraível; ela foi mantida como imagem. Execute o OCR para gerar texto editável.`);
      for (const block of buildBlocks(buildLines(runs))) children.push(blockParagraph(block, viewport.width));
      children.push(new Paragraph({ spacing: { before: 0, after: 0, line: 20, lineRule: LineRuleType.EXACT }, children: [new TextRun({ text: '', size: 2 })] }));
      sections.push({ properties: { type: SectionType.NEXT_PAGE, page: { size: { width: Math.round(viewport.width * 20), height: Math.round(viewport.height * 20) }, margin: { top: 0, bottom: 0, left: 0, right: 0, header: 0, footer: 0 } } }, children });
      page.cleanup(); artPage.cleanup();
    }
    closeFlow();
    if (missing.size) warnings.push(`Fontes do PDF não instaladas neste computador foram trocadas por equivalentes: ${[...missing].map(([a, b]) => `${a} → ${b}`).join(', ')}. Instale-as para fidelidade total.`);
    if (fonts.embedded.size) warnings.push(`Fontes incorporadas ao Word para abrir igual em qualquer computador: ${[...fonts.embedded.keys()].join(', ')}.`);
    if (tables) warnings.push(`${tables} tabela${tables > 1 ? 's' : ''} reconstruída${tables > 1 ? 's' : ''} como tabela real do Word (células mescladas, cores e bordas).`);
    if (flowed) warnings.push(`${flowed === source.numPages ? 'Documento convertido' : `${flowed} página${flowed > 1 ? 's convertidas' : ' convertida'}`} como texto corrido: margens, parágrafos, listas, tabelas, cabeçalho e rodapé editáveis, que se reorganizam ao editar.`);
    if (laidOut) warnings.push(`${flowed ? `${laidOut} página${laidOut > 1 ? 's' : ''} com arte (cartaz, slide ou digitalização) mantida${laidOut > 1 ? 's' : ''} com layout preservado: ` : 'Word com layout preservado: '}fundos, tabelas e imagens ficam atrás do texto, e os textos são editáveis com as fontes originais quando instaladas no computador.`);
    const document = new Document({ creator: 'Bruno Albertini | Gestão Cultural Pro', title: 'Documento convertido pelo GCP-PDF', description: 'Conversão local de PDF', sections, fonts: fonts.docxFonts(), styles: { default: { document: { run: allFlow.length ? { font: bodyStyle(allFlow).font, size: bodyStyle(allFlow).size, language: { value: 'pt-BR' } } : { font: 'Segoe UI', language: { value: 'pt-BR' } } } } } });
    return { bytes: await Packer.toBuffer(document), extension: 'docx', warnings: [...new Set(warnings)] };
  } finally {
    await source.loadingTask.destroy();
    await art.loadingTask.destroy();
  }
}


export const hex6 = (c: string) => c.replace('#', '').toUpperCase();
/** A grid table as a native PowerPoint table: merged cells, fills, white rules, rich text. */
function addSlideTable(slide: any, t: GridTable, sx: number, sy: number) {
  const inch = (pt: number) => pt / 72, rows: any[][] = t.rowH.map(() => []);
  const edge = (e?: GridEdge) => (e ? { type: 'solid', pt: e.width, color: hex6(e.color) } : { type: 'none' });
  for (const cell of [...t.cells].sort((a, b) => a.row - b.row || a.col - b.col)) {
    const text = cell.text, options: Record<string, unknown> = {
      colspan: cell.cols > 1 ? cell.cols : undefined, rowspan: cell.rows > 1 ? cell.rows : undefined,
      fill: cell.fill ? { color: hex6(cell.fill) } : undefined, margin: [1, 2, 1, 2],
      border: [edge(cell.borders?.top), edge(cell.borders?.right), edge(cell.borders?.bottom), edge(cell.borders?.left)],
      align: text?.align ?? 'left', valign: text?.valign ?? 'top', fontFace: text?.font, fontSize: text ? Math.max(1, text.size * sy) : 10, color: text ? hex6(text.color) : undefined,
    };
    const content = text ? text.parts.flatMap((part) => part.text.split('\n').map((piece, k, all) => ({ text: piece, options: { bold: part.bold, italic: part.italic, color: hex6(part.color), fontSize: Math.max(1, part.size * sy), fontFace: text.font, breakLine: k < all.length - 1 } }))) : '';
    rows[cell.row]!.push({ text: content, options });
  }
  slide.addTable(rows, { x: inch(t.x * sx), y: inch(t.y * sy), w: inch(t.width * sx), colW: t.colW.map((w) => inch(w * sx)), rowH: t.rowH.map((h) => inch(h * sy)), autoPage: false });
}
/** A grid table as a Word table floating at its place on the page. */
/** A Word table for a grid. Positioned exactly on the page by default; in a flowing document it sits in
 * the text (`inline`), indented from the margin, with the cell padding the PDF shows. */
export function wordTable(t: GridTable, inline?: { indent: number; padding: number; paddingTop?: number }) {
  const twip = (pt: number) => Math.round(pt * 20);
  const edge = (e?: GridEdge) => (e ? { style: BorderStyle.SINGLE, size: Math.max(2, Math.round(e.width * 8)), color: hex6(e.color) } : { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' });
  const rows = t.rowH.map((height, r) => new TableRow({
    height: { value: twip(height), rule: HeightRule.ATLEAST },
    children: t.cells.filter((c) => c.row === r).sort((a, b) => a.col - b.col).map((cell) => {
      const text = cell.text, align = text?.align === 'center' ? AlignmentType.CENTER : text?.align === 'right' ? AlignmentType.RIGHT : text?.align === 'justify' ? AlignmentType.JUSTIFIED : AlignmentType.LEFT;
      const paragraphs: Paragraph[] = [];
      let current: TextRun[] = [];
      // In a flowing table the space above the text is the first paragraph's, as word processors write it:
      // Word adds a top cell margin to the row height it was given.
      const before = () => (inline && !paragraphs.length ? twip(inline.paddingTop ?? 0) : 0);
      for (const part of text?.parts ?? []) part.text.split('\n').forEach((piece, k) => {
        if (k > 0) { paragraphs.push(new Paragraph({ alignment: align, spacing: { before: before(), after: 0 }, children: current })); current = []; }
        if (piece) current.push(new TextRun({ text: piece, bold: part.bold, italics: part.italic, color: hex6(part.color), size: Math.max(2, Math.round(part.size * 2)), font: text!.font }));
      });
      paragraphs.push(new Paragraph({ alignment: align, spacing: { before: before(), after: 0 }, children: current }));
      return new TableCell({
        columnSpan: cell.cols > 1 ? cell.cols : undefined, rowSpan: cell.rows > 1 ? cell.rows : undefined,
        width: { size: twip(t.colW.slice(cell.col, cell.col + cell.cols).reduce((a, b) => a + b, 0)), type: WidthType.DXA },
        shading: cell.fill ? { type: ShadingType.CLEAR, color: 'auto', fill: hex6(cell.fill) } : undefined,
        verticalAlign: text?.valign === 'middle' ? VerticalAlign.CENTER : text?.valign === 'bottom' ? VerticalAlign.BOTTOM : VerticalAlign.TOP,
        margins: inline ? { top: 0, bottom: 0, left: twip(inline.padding), right: twip(inline.padding) } : { top: 20, bottom: 20, left: 40, right: 40 },
        borders: { top: edge(cell.borders?.top), bottom: edge(cell.borders?.bottom), left: edge(cell.borders?.left), right: edge(cell.borders?.right) },
        children: paragraphs,
      });
    }),
  }));
  return new Table({
    rows, layout: TableLayoutType.FIXED, columnWidths: t.colW.map(twip), width: { size: twip(t.width), type: WidthType.DXA },
    ...(inline ? { indent: { size: twip(inline.indent), type: WidthType.DXA } } : {}),
    float: inline ? undefined : { horizontalAnchor: TableAnchorType.PAGE, verticalAnchor: TableAnchorType.PAGE, absoluteHorizontalPosition: twip(t.x), absoluteVerticalPosition: twip(t.y), overlap: OverlapType.OVERLAP },
  });
}
/** pptxgenjs 4.0.1 writes an <a:pPr> before every run of a paragraph; only the first is valid, and
 * PowerPoint "repairs" the rest by repeating words across lines. Keep one per paragraph. */
async function singleParagraphProperties(buffer: Buffer): Promise<Uint8Array> {
  const JSZip = (await import('jszip')).default, zip = await JSZip.loadAsync(buffer);
  for (const name of Object.keys(zip.files).filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n))) {
    const xml = await zip.file(name)!.async('string');
    zip.file(name, xml.replace(/<a:p>([\s\S]*?)<\/a:p>/g, (_all, body: string) => {
      let first = true;
      return '<a:p>' + body.replace(/<a:pPr\b[^>]*?(?:\/>|>[\s\S]*?<\/a:pPr>)/g, (pPr) => (first ? ((first = false), pPr) : '')) + '</a:p>';
    }));
  }
  return new Uint8Array(await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' }));
}
/** One vector path as a native shape: rectangles and straight lines as such, anything else as a freeform. */
function addVector(pptx: any, slide: any, shape: VectorShape, sx: number, sy: number) {
  const inch = (pt: number) => pt / 72, b = shape.box, x = b.x * sx, y = b.y * sy, w = Math.max(b.width * sx, 0.01), h = Math.max(b.height * sy, 0.01);
  const fill = shape.fill ? { color: shape.fill.color.slice(1).toUpperCase(), transparency: Math.round((1 - shape.fill.alpha) * 100) } : { type: 'none' };
  const line = shape.stroke ? { color: shape.stroke.color.slice(1).toUpperCase(), width: shape.stroke.width * Math.min(sx, sy), transparency: Math.round((1 - shape.stroke.alpha) * 100), dashType: shape.stroke.dash ? 'dash' : 'solid' } : { type: 'none' };
  const points = shape.segments.filter((s) => s.op !== 'Z'), closed = shape.segments.some((s) => s.op === 'Z');
  if (rectangle(shape) && points[0]!.op === 'M') { slide.addShape(pptx.ShapeType.rect, { x: inch(x), y: inch(y), w: inch(w), h: inch(h), fill, line }); return; }
  if (points.length === 2 && points[1]!.op === 'L' && !shape.fill) {
    const a = points[0] as { x: number; y: number }, c = points[1] as { x: number; y: number };
    slide.addShape(pptx.ShapeType.line, { x: inch(x), y: inch(y), w: inch(w), h: inch(h), line, ...((c.x - a.x) * (c.y - a.y) < 0 ? { flipV: true } : {}) });
    return;
  }
  const rel = (px: number, py: number) => ({ x: inch(px * sx - x), y: inch(py * sy - y) });
  const geometry = shape.segments.map((s, n) => s.op === 'Z' ? { close: true } : s.op === 'C' ? { ...rel(s.x, s.y), curve: { type: 'cubic', x1: inch(s.x1 * sx - x), y1: inch(s.y1 * sy - y), x2: inch(s.x2 * sx - x), y2: inch(s.y2 * sy - y) } } : { ...rel(s.x, s.y), ...(s.op === 'M' || n === 0 ? { moveTo: true } : {}) });
  slide.addShape(pptx.ShapeType.custGeom, { x: inch(x), y: inch(y), w: inch(w), h: inch(h), points: geometry, fill, line: closed || shape.stroke ? line : { type: 'none' } });
}
/** PowerPoint that looks like the PDF: artwork as the slide background, every photo/picture as its own
 * movable image and every text block as an editable text box with its font, size, colour and weight. */
export async function toPptxLayout(bytes: Uint8Array, dpi: number, warnings: string[], onProgress?: (message: string) => void, ocr: OcrRuns = new Map()) {
  onProgress?.('Preparando os slides…');
  const PptxGenJS = (await import('pptxgenjs')).default;
  const source = await loadPdf(bytes);
  // Vector art (bars, lines, boxes, icons) becomes native shapes on every page where it can be reproduced.
  const vectors: Awaited<ReturnType<typeof vectorShapes>>[] = [];
  for (let i = 1; i <= source.numPages; i++) { onProgress?.(`Lendo formas vetoriais ${i} de ${source.numPages}…`); const page = await source.getPage(i); vectors.push(await vectorShapes(page).catch(() => ({ supported: false, shapes: [], painted: [] }))); page.cleanup(); }
  const editable = new Set(vectors.flatMap((v, i) => (v.supported && v.shapes.length ? [i] : [])));
  const [art, pictures] = await Promise.all([artworkOnly(bytes, false, editable).then(loadPdf), artworkOnly(bytes, true).then(loadPdf)]);
  let shapeCount = 0;
  const fonts = await FontContext.of(bytes, false), missing = fonts.missing;
  try {
    const first = (await source.getPage(1)).getViewport({ scale: 1 }), pptx = new PptxGenJS();
    pptx.defineLayout({ name: 'PDF', width: first.width / 72, height: first.height / 72 });
    pptx.layout = 'PDF'; pptx.author = 'GCP-PDF'; pptx.company = 'Gestão Cultural Pro';
    const inch = (pt: number) => pt / 72;
    for (let i = 1; i <= source.numPages; i++) {
      onProgress?.(`Convertendo slide ${i} de ${source.numPages}…`);
      const page = await source.getPage(i), viewport = page.getViewport({ scale: 1 }), artPage = await art.getPage(i), slide = pptx.addSlide();
      const sx = first.width / viewport.width, sy = first.height / viewport.height;
      const scanned = ocr.get(i - 1);
      // On mixed pages, retain the complex middle composite as a transparent bitmap and promote
      // compatible vectors before and after it. Identities come from the page being rendered, so promoted
      // paths are removed from the bitmap and remain truly removable/editable in PowerPoint.
      const partial=!editable.has(i-1)&&!scanned?await vectorShapes(artPage):undefined;
      const promoted=partial&&partial.reason!=='formas demais'?partial.shapes.filter(s=>s.operation!==undefined&&(s.operation<(partial.firstRaster??Infinity)||s.operation>(partial.lastRaster??-1))):[];
      const omit=new Set(promoted.map(s=>s.operation!));
      const [allRuns, background, images, grid] = await Promise.all([scanned ?? pageRuns(page, fonts), artwork(artPage, dpi, scanned,omit,!!partial), scanned ? { images: [] } : inspectPage(page, true), scanned||partial ? null : pageGrid(page, fonts).catch(() => null)]);
      // A ruled/filled table becomes a native PowerPoint table; its cell shapes and text are not repeated.
      const table = grid ? tableOf(grid) : null;
      const runs = table ? allRuns.filter((r) => !insideTable(table, { x: r.x, y: r.baseline - r.size * 0.7, width: Math.min(r.width, 1), height: r.size * 0.6 })) : allRuns;
      const vector = (editable.has(i - 1) ? vectors[i - 1]!.shapes : promoted).filter((v) => !table || !insideTable(table, v.box));
      // A filled box covering the page is the page colour: it becomes the slide background, not a shape.
      // Opaque fills covering the page at the bottom of the stack: the last one is the visible page colour.
      let pageFills = 0;
      while (!partial&&pageFills < vector.length && vector[pageFills]!.fill && !vector[pageFills]!.stroke && vector[pageFills]!.fill!.alpha > 0.99 && vector[pageFills]!.box.width * vector[pageFills]!.box.height >= viewport.width * viewport.height * 0.95) pageFills++;
      if (background&&!partial) slide.background = { data: 'image/jpeg;base64,' + background.toString('base64') };
      else if (pageFills) slide.background = { color: vector[pageFills - 1]!.fill!.color.slice(1).toUpperCase() };
      if(partial){
        for(const shape of vector.filter(s=>s.operation!<(partial.firstRaster??Infinity))){addVector(pptx,slide,shape,sx,sy);shapeCount++;}
        if(background)slide.addImage({data:'image/png;base64,'+background.toString('base64'),x:0,y:0,w:inch(first.width),h:inch(first.height)});
        for(const shape of vector.filter(s=>s.operation!>=(partial.firstRaster??Infinity))){addVector(pptx,slide,shape,sx,sy);shapeCount++;}
      }else for (const shape of vector.slice(pageFills)) { addVector(pptx, slide, shape, sx, sy); shapeCount++; }
      if (table) { addSlideTable(slide, table, sx, sy); shapeCount++; }
      // Each picture is cut from the page as drawn (masks, transparency and effects included).
      if (images.images.length) {
        const picturePage = await pictures.getPage(i), scale = Math.min(dpi, 200) / 72, view = picturePage.getViewport({ scale }), canvas = createCanvas(Math.ceil(view.width), Math.ceil(view.height));
        await picturePage.render({ canvas: canvas as never, canvasContext: canvas.getContext('2d') as never, viewport: view, background: 'white' }).promise;
        for (const image of images.images) {
          const x = Math.max(0, image.x), y = Math.max(0, image.y), w = Math.min(viewport.width - x, image.width), h = Math.min(viewport.height - y, image.height);
          if (w < 2 || h < 2) continue;
          const crop = createCanvas(Math.ceil(w * scale), Math.ceil(h * scale));
          crop.getContext('2d').drawImage(canvas, x * scale, y * scale, w * scale, h * scale, 0, 0, crop.width, crop.height);
          slide.addImage({ data: 'image/jpeg;base64,' + crop.toBuffer('image/jpeg', 90).toString('base64'), x: inch(x * sx), y: inch(y * sy), w: inch(w * sx), h: inch(h * sy) });
        }
        picturePage.cleanup();
      }
      for (const block of buildBlocks(buildLines(runs))) {
        const pitch = block.lines.length > 1 ? (block.lines.at(-1)!.baseline - block.lines[0]!.baseline) / (block.lines.length - 1) : block.size * 1.2;
        const top = block.lines[0]!.baseline - block.size * 0.95, width = block.right - block.x + block.size * (block.flow ? 0.6 : 1.4), height = pitch * (block.lines.length - 1) + block.size * 1.35;
        const text = block.lines.flatMap((line, index) => line.runs.map((run, r) => {
          const previous = line.runs[r - 1], gap = previous ? run.x - (previous.x + previous.width) : 0, space = (r > 0 && run.space) || (gap > run.size * 0.15 && !/^\s/.test(run.text)) || (r === 0 && index > 0 && block.flow);
          return { text: (space ? ' ' : '') + run.text, options: { fontFace: run.font, fontSize: Math.max(1, run.size * sy), color: run.color.replace('#', '').toUpperCase(), bold: run.bold, italic: run.italic, breakLine: !block.flow && r === line.runs.length - 1 && index < block.lines.length - 1 } };
        }));
        slide.addText(text, { x: inch(Math.max(0, (block.align === 'center' ? (block.x + block.right) / 2 - width / 2 : block.x) * sx)), y: inch(Math.max(0, top * sy)), w: inch(width * sx), h: inch(height * sy), align: block.align, valign: 'top', margin: 0, lineSpacing: Math.max(1, pitch * sy), fit: 'none', wrap: true });
      }
      page.cleanup(); artPage.cleanup();
    }
    if (missing.size) warnings.push(`Fontes do PDF não instaladas neste computador foram trocadas por equivalentes: ${[...missing].map(([a, b]) => `${a} → ${b}`).join(', ')}. Instale-as para fidelidade total.`);
    warnings.push(shapeCount ? `PowerPoint com layout preservado: ${shapeCount} forma${shapeCount > 1 ? 's vetoriais viraram formas editáveis' : ' vetorial virou forma editável'}; imagens e textos também são objetos editáveis.` : 'PowerPoint com layout preservado: imagens e textos são objetos editáveis.');
    const flat = vectors.filter((v) => !v.supported).length;
    if (flat) warnings.push(`${flat} slide${flat > 1 ? 's têm' : ' tem'} efeitos que exigem imagem. As formas compatíveis antes e depois desses efeitos continuam editáveis; a composição intermediária permanece como imagem transparente para preservar a ordem das camadas.`);
    return { bytes: await singleParagraphProperties(await pptx.write({ outputType: 'nodebuffer' }) as Buffer), extension: 'pptx', warnings: [...new Set(warnings)] };
  } finally {
    await source.loadingTask.destroy();
    await art.loadingTask.destroy();
    await pictures.loadingTask.destroy();
  }
}



