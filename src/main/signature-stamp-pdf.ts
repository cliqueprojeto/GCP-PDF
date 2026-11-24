import { PDFDocument, StandardFonts, degrees, rgb, type PDFFont } from 'pdf-lib';
import { fromPage } from '../shared/geometry';
import type { Rect } from '../shared/types';
import type { StampLayout } from '../shared/signature-stamp';

const colour = (hex: string) => { const n = Number.parseInt(hex.slice(1), 16); return rgb(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255); };
/** Standard fonts write WinAnsi: anything else becomes "?" rather than failing the signature. */
function encodable(font: PDFFont, text: string) {
  return [...text].map((c) => { try { font.encodeText(c); return c; } catch { return '?'; } }).join('');
}

/**
 * Writes the visible stamp of a digital signature into page `index` as ordinary page content (text stays
 * selectable), at `rect` given as the page is displayed (top-left points, with its rotation). The signature
 * field placed over it afterwards covers these bytes, so changing the stamp invalidates the signature.
 */
export async function drawSignatureStamp(bytes: Uint8Array, index: number, rect: Rect, rotation: number, layout: StampLayout, image?: string): Promise<Uint8Array> {
  const pdf = await PDFDocument.load(bytes, { updateMetadata: false }), page = pdf.getPage(index), crop = page.getCropBox();
  const size = { width: crop.width, height: crop.height };
  // Displayed top-left point → PDF user space (y up, crop box origin).
  const user = (x: number, y: number) => { const p = fromPage(rect.x + x, rect.y + y, size, rotation, 1); return { x: crop.x + p.x, y: crop.y + crop.height - p.y }; };
  const right = user(1, 0), origin = user(0, 0), angle = Math.round(Math.atan2(right.y - origin.y, right.x - origin.x) * 180 / Math.PI);
  const corners = [user(0, 0), user(rect.width, 0), user(0, rect.height), user(rect.width, rect.height)];
  const x0 = Math.min(...corners.map((c) => c.x)), y0 = Math.min(...corners.map((c) => c.y)), x1 = Math.max(...corners.map((c) => c.x)), y1 = Math.max(...corners.map((c) => c.y));
  page.drawRectangle({ x: x0, y: y0, width: x1 - x0, height: y1 - y0, color: rgb(1, 1, 1), borderColor: colour(layout.border), borderWidth: 0.7 });
  const k = Math.min(rect.width / layout.width, rect.height / layout.height);
  if (image && layout.image && /^data:image\/(png|jpe?g);base64,/i.test(image)) {
    const data = Buffer.from(image.split(',')[1]!, 'base64'), picture = /png/i.test(image.slice(0, 20)) ? await pdf.embedPng(data) : await pdf.embedJpg(data);
    const box = layout.image, fit = Math.min(box.width * k / picture.width, box.height * k / picture.height), w = picture.width * fit, h = picture.height * fit;
    const at = user(box.x * k + (box.width * k - w) / 2, box.y * k + (box.height * k + h) / 2);
    page.drawImage(picture, { x: at.x, y: at.y, width: w, height: h, rotate: degrees(angle) });
  }
  const fonts = { regular: await pdf.embedFont(StandardFonts.Helvetica), bold: await pdf.embedFont(StandardFonts.HelveticaBold), mono: await pdf.embedFont(StandardFonts.Courier) };
  for (const line of layout.lines) {
    const font = line.mono ? fonts.mono : line.bold ? fonts.bold : fonts.regular, at = user(line.x * k, line.y * k + line.size * k * 0.82);
    page.drawText(encodable(font, line.text), { x: at.x, y: at.y, size: line.size * k, font, color: colour(line.color), rotate: degrees(angle) });
  }
  return pdf.save({ useObjectStreams: false });
}
