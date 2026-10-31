import { PDFDocument, PDFDict, PDFName, PDFRawStream, PDFArray, PDFNumber, ParseSpeeds, decodePDFRawStream } from 'pdf-lib';

/** What the font program embedded in the PDF says about itself. PDFs often hide the real name
 * (`CIDFont+F1`, `ABCDEF+F2`), but a TrueType/OpenType program keeps its `name` and `OS/2` tables:
 * the true family, weight, slant and the author's embedding permission. Reading them works the same
 * on every operating system, whatever fonts are installed. */
export interface EmbeddedFace {
  family: string;
  bold: boolean;
  italic: boolean;
  /** The program carries every glyph (not a subset), so a document may embed it for editing. */
  complete: boolean;
  /** OS/2 fsType allows installing or editing documents that embed it. */
  editable: boolean;
  /** The TrueType/OpenType program, when the PDF carries one. */
  data?: Buffer;
}

const SUBSET = /^[A-Z]{6}\+/;
function sfntTables(b: Buffer) {
  const tables = new Map<string, { offset: number; length: number }>();
  if (b.length < 12) return tables;
  const count = b.readUInt16BE(4);
  for (let i = 0; i < count && 12 + 16 * i + 16 <= b.length; i++) {
    const at = 12 + 16 * i, tag = b.toString('latin1', at, at + 4), offset = b.readUInt32BE(at + 8), length = b.readUInt32BE(at + 12);
    if (offset + length <= b.length) tables.set(tag, { offset, length });
  }
  return tables;
}
/** Family and subfamily from the `name` table: typographic names (16/17) first, Windows Unicode first. */
function sfntNames(b: Buffer, table: { offset: number; length: number }) {
  const base = table.offset, count = b.readUInt16BE(base + 2), strings = base + b.readUInt16BE(base + 4);
  const found = new Map<number, { rank: number; value: string }>();
  for (let i = 0; i < count; i++) {
    const at = base + 6 + 12 * i;
    if (at + 12 > base + table.length) break;
    const platform = b.readUInt16BE(at), encoding = b.readUInt16BE(at + 2), language = b.readUInt16BE(at + 4), id = b.readUInt16BE(at + 6), length = b.readUInt16BE(at + 8), offset = b.readUInt16BE(at + 10);
    if (![1, 2, 4, 16, 17].includes(id) || strings + offset + length > b.length) continue;
    const raw = b.subarray(strings + offset, strings + offset + length);
    let value: string, rank: number;
    if (platform === 3 || platform === 0) { value = Buffer.from(raw).swap16().toString('utf16le'); rank = platform === 3 && encoding === 1 && language === 0x409 ? 0 : 1; }
    else if (platform === 1 && encoding === 0) { value = raw.toString('latin1'); rank = 2; }
    else continue;
    value = value.replace(/\0/g, '').trim();
    if (value && (!found.has(id) || found.get(id)!.rank > rank)) found.set(id, { rank, value });
  }
  const get = (id: number) => found.get(id)?.value;
  return { family: get(16) ?? get(1), style: get(17) ?? get(2) ?? '', full: get(4) ?? '' };
}
/** Reads a TrueType/OpenType program; null when it is not one (Type 1, bare CFF). */
export function describeSfnt(data: Buffer): Omit<EmbeddedFace, 'complete'> | null {
  const tag = data.toString('latin1', 0, 4);
  if (!['\0\x01\0\0', 'OTTO', 'true'].includes(tag)) return null;
  const tables = sfntTables(data), name = tables.get('name'), os2 = tables.get('OS/2');
  if (!name) return null;
  const names = sfntNames(data, name);
  if (!names.family) return null;
  let weight = 400, selection = 0, fsType = 0;
  if (os2 && os2.length >= 64) { weight = data.readUInt16BE(os2.offset + 4); fsType = data.readUInt16BE(os2.offset + 8); selection = data.readUInt16BE(os2.offset + 62); }
  const style = `${names.style} ${names.full}`;
  // fsType 2 forbids embedding; bit 9 allows bitmaps only. 0 (installable) and 8 (editable) allow editing.
  const editable = (fsType & 0x0002) === 0 && (fsType & 0x0200) === 0 && (fsType & 0x0004) === 0;
  return { family: names.family, bold: weight >= 600 || (selection & 0x20) !== 0 || /\bbold\b/i.test(style), italic: (selection & 0x01) !== 0 || /italic|oblique/i.test(style), editable, data };
}

/** Every font of the PDF, by the name pdf.js reports for it (its BaseFont), described from its program. */
export async function embeddedFaces(bytes: Uint8Array): Promise<Map<string, EmbeddedFace>> {
  const faces = new Map<string, EmbeddedFace>();
  let doc: PDFDocument;
  try { doc = await PDFDocument.load(bytes, { updateMetadata: false, ignoreEncryption: true, parseSpeed: ParseSpeeds.Fastest }); } catch { return faces; }
  for (const [, object] of doc.context.enumerateIndirectObjects()) {
    if (!(object instanceof PDFDict) || object.get(PDFName.of('Type'))?.toString() !== '/Font') continue;
    const base = object.get(PDFName.of('BaseFont'))?.toString().slice(1);
    if (!base || faces.has(base)) continue;
    try {
      const descendant = object.lookupMaybe(PDFName.of('DescendantFonts'), PDFArray)?.lookup(0, PDFDict) ?? object;
      const descriptor = descendant.lookupMaybe(PDFName.of('FontDescriptor'), PDFDict);
      if (!descriptor) continue;
      const program = [descriptor.lookup(PDFName.of('FontFile2')), descriptor.lookup(PDFName.of('FontFile3'))].find((v): v is PDFRawStream => v instanceof PDFRawStream);
      const data = program ? Buffer.from(decodePDFRawStream(program).decode()) : null;
      const described = data ? describeSfnt(data) : null;
      if (described) {
        // A subset keeps only the glyphs the PDF shows; its tag prefix or a tiny glyph table gives it away.
        const glyphs = sfntTables(data!).get('maxp') ? data!.readUInt16BE(sfntTables(data!).get('maxp')!.offset + 4) : 0;
        faces.set(base, { ...described, complete: !SUBSET.test(base) && glyphs > 200 });
        continue;
      }
      // No readable program: the descriptor still tells weight (ForceBold flag, FontWeight, thick stems).
      const flags = descriptor.lookupMaybe(PDFName.of('Flags'), PDFNumber)?.asNumber() ?? 0;
      const weight = descriptor.lookupMaybe(PDFName.of('FontWeight'), PDFNumber)?.asNumber() ?? 0, stem = descriptor.lookupMaybe(PDFName.of('StemV'), PDFNumber)?.asNumber() ?? 0;
      const angle = descriptor.lookupMaybe(PDFName.of('ItalicAngle'), PDFNumber)?.asNumber() ?? 0;
      const family = descriptor.get(PDFName.of('FontFamily'))?.toString().replace(/^\(|\)$/g, '');
      if (family) faces.set(base, { family, bold: (flags & 0x40000) !== 0 || weight >= 600 || stem >= 120, italic: (flags & 0x40) !== 0 || angle !== 0, complete: false, editable: false });
    } catch { /* A damaged font dictionary keeps the name-based guess. */ }
  }
  return faces;
}
