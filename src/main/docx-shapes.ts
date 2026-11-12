import type {VectorShape} from './word-layout';

/** Vector art of a PDF page as native Word drawing shapes (DrawingML, as Word itself writes them):
 * each line, box, fill and outline becomes an object the user can select, move, recolour or resize,
 * anchored to its place on the page behind the text. The docx library has no shape API, so the
 * document is written with a placeholder run per page and the placeholder is replaced afterwards. */
const EMU = 12700;
const emu = (pt: number) => Math.round(pt * EMU);
const color = (hex: string) => hex.replace('#', '').toUpperCase();
const alpha = (value: number) => (value < 0.999 ? `<a:alpha val="${Math.max(0, Math.round(value * 100000))}"/>` : '');

function geometry(shape: VectorShape, w: number, h: number) {
 const at = (x: number, y: number) => `<a:pt x="${emu(x - shape.box.x)}" y="${emu(y - shape.box.y)}"/>`;
 const parts = shape.segments.map((s) => s.op === 'M' ? `<a:moveTo>${at(s.x, s.y)}</a:moveTo>` : s.op === 'L' ? `<a:lnTo>${at(s.x, s.y)}</a:lnTo>` : s.op === 'C' ? `<a:cubicBezTo>${at(s.x1, s.y1)}${at(s.x2, s.y2)}${at(s.x, s.y)}</a:cubicBezTo>` : '<a:close/>').join('');
 return `<a:custGeom><a:avLst/><a:gdLst/><a:ahLst/><a:cxnLst/><a:rect l="0" t="0" r="r" b="b"/><a:pathLst><a:path w="${w}" h="${h}"${shape.fill ? '' : ' fill="none"'}>${parts}</a:path></a:pathLst></a:custGeom>`;
}

/** One shape as a Word run holding an anchored drawing; `order` keeps the PDF's painting order. */
export function shapeRun(shape: VectorShape, id: number, order: number): string {
 const pad = shape.stroke ? shape.stroke.width / 2 : 0, w = Math.max(1, emu(shape.box.width)), h = Math.max(1, emu(shape.box.height));
 const fill = shape.fill ? `<a:solidFill><a:srgbClr val="${color(shape.fill.color)}">${alpha(shape.fill.alpha)}</a:srgbClr></a:solidFill>` : '<a:noFill/>';
 const line = shape.stroke ? `<a:ln w="${Math.max(1, emu(shape.stroke.width))}"><a:solidFill><a:srgbClr val="${color(shape.stroke.color)}">${alpha(shape.stroke.alpha)}</a:srgbClr></a:solidFill>${shape.stroke.dash ? '<a:prstDash val="dash"/>' : ''}</a:ln>` : '<a:ln><a:noFill/></a:ln>';
 return `<w:r><w:rPr><w:noProof/></w:rPr><w:drawing><wp:anchor distT="0" distB="0" distL="0" distR="0" simplePos="0" relativeHeight="${1000 + order}" behindDoc="1" locked="0" layoutInCell="1" allowOverlap="1"><wp:simplePos x="0" y="0"/><wp:positionH relativeFrom="page"><wp:posOffset>${emu(shape.box.x)}</wp:posOffset></wp:positionH><wp:positionV relativeFrom="page"><wp:posOffset>${emu(shape.box.y)}</wp:posOffset></wp:positionV><wp:extent cx="${w}" cy="${h}"/><wp:effectExtent l="${emu(pad)}" t="${emu(pad)}" r="${emu(pad)}" b="${emu(pad)}"/><wp:wrapNone/><wp:docPr id="${id}" name="Forma ${id}"/><wp:cNvGraphicFramePr/><a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:graphicData uri="http://schemas.microsoft.com/office/word/2010/wordprocessingShape"><wps:wsp xmlns:wps="http://schemas.microsoft.com/office/word/2010/wordprocessingShape"><wps:cNvSpPr/><wps:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${w}" cy="${h}"/></a:xfrm>${geometry(shape, w, h)}${fill}${line}</wps:spPr><wps:bodyPr/></wps:wsp></a:graphicData></a:graphic></wp:anchor></w:drawing></w:r>`;
}

/** Placeholder text a page's shapes replace; it never reaches the finished document. */
export const shapeMarker = (key: number) => `⟦GCPVEC${key}⟧`;

/** Replaces each placeholder run with the drawing runs of its page. */
export async function injectShapes(docx: Uint8Array, runs: Map<number, string>): Promise<Uint8Array> {
 if (!runs.size) return docx;
 const JSZip = (await import('jszip')).default, zip = await JSZip.loadAsync(docx), file = zip.file('word/document.xml');
 if (!file) return docx;
 let xml = await file.async('string');
 for (const [key, content] of runs) {
  const marker = shapeMarker(key), at = xml.indexOf(marker);
  if (at < 0) continue;
  const start = Math.max(xml.lastIndexOf('<w:r>', at), xml.lastIndexOf('<w:r ', at)), end = xml.indexOf('</w:r>', at) + '</w:r>'.length;
  xml = xml.slice(0, start) + content + xml.slice(end);
 }
 zip.file('word/document.xml', xml);
 return new Uint8Array(await zip.generateAsync({type: 'nodebuffer', compression: 'DEFLATE'}));
}
