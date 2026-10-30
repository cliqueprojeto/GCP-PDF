import { open, readdir, readFile, stat, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';

/** Fonts installed on this computer. The app never ships or copies them (their licences forbid
 * redistribution); it uses them in place, like Word and desktop PDF editors do: for editing, for
 * embedding the used glyphs when saving a PDF, and for naming fonts in Word exports. */
export interface SystemFace { family: string; style: string; legacy: string; legacyStyle: string; postscript: string; weight: number; italic: boolean; embeddable: boolean; file: string; collection: boolean }
const EXTENSIONS = new Set(['.ttf', '.otf', '.ttc', '.otc']);
function fontFolders(): string[] {
  if (process.platform === 'win32') return [path.join(process.env.WINDIR ?? 'C:\\Windows', 'Fonts'), path.join(process.env.LOCALAPPDATA ?? path.join(homedir(), 'AppData', 'Local'), 'Microsoft', 'Windows', 'Fonts')];
  if (process.platform === 'darwin') return ['/System/Library/Fonts', '/System/Library/Fonts/Supplemental', '/Library/Fonts', path.join(homedir(), 'Library', 'Fonts')];
  return ['/usr/share/fonts', '/usr/local/share/fonts', path.join(homedir(), '.local', 'share', 'fonts'), path.join(homedir(), '.fonts')];
}
async function walk(folder: string, depth = 0): Promise<string[]> {
  const entries = await readdir(folder, { withFileTypes: true }).catch(() => []);
  const files: string[] = [];
  for (const entry of entries) {
    const full = path.join(folder, entry.name);
    if (entry.isDirectory() && depth < 4) files.push(...(await walk(full, depth + 1)));
    else if (entry.isFile() && EXTENSIONS.has(path.extname(entry.name).toLowerCase())) files.push(full);
  }
  return files;
}
function decodeName(bytes: Buffer, platform: number): string {
  if (platform === 0 || platform === 3) { let out = ''; for (let i = 0; i + 1 < bytes.length; i += 2) out += String.fromCharCode(bytes.readUInt16BE(i)); return out; }
  return bytes.toString('latin1');
}
/** Reads one sfnt (TrueType/OpenType) face: only its table directory, `name` and `OS/2` tables. */
async function readFace(handle: Awaited<ReturnType<typeof open>>, offset: number): Promise<Omit<SystemFace, 'file' | 'collection'> | null> {
  const head = Buffer.alloc(12);
  await handle.read(head, 0, 12, offset);
  const tables = head.readUInt16BE(4);
  if (tables > 200) return null;
  const directory = Buffer.alloc(16 * tables);
  await handle.read(directory, 0, directory.length, offset + 12);
  const find = (tag: string) => { for (let i = 0; i < tables; i++) if (directory.toString('latin1', i * 16, i * 16 + 4) === tag) return { at: directory.readUInt32BE(i * 16 + 8), length: directory.readUInt32BE(i * 16 + 12) }; return null; };
  const nameTable = find('name'), os2 = find('OS/2');
  if (!nameTable || nameTable.length > 2_000_000) return null;
  const names = Buffer.alloc(nameTable.length);
  await handle.read(names, 0, names.length, nameTable.at);
  const count = names.readUInt16BE(2), storage = names.readUInt16BE(4), found: Record<number, { text: string; rank: number }> = {};
  for (let i = 0; i < count; i++) {
    const record = 6 + i * 12, platform = names.readUInt16BE(record), language = names.readUInt16BE(record + 4), id = names.readUInt16BE(record + 6);
    if (![1, 2, 4, 6, 16, 17].includes(id)) continue;
    const length = names.readUInt16BE(record + 8), start = storage + names.readUInt16BE(record + 10);
    if (start + length > names.length) continue;
    // Prefer Windows English names, then any Windows name, then Mac Roman.
    const rank = platform === 3 && language === 0x409 ? 3 : platform === 3 ? 2 : platform === 1 && language === 0 ? 1 : 0;
    if (!found[id] || found[id]!.rank < rank) found[id] = { text: decodeName(names.subarray(start, start + length), platform), rank };
  }
  let weight = 400, italic = false, embeddable = true;
  if (os2 && os2.length >= 64) {
    const table = Buffer.alloc(64); await handle.read(table, 0, 64, os2.at);
    weight = table.readUInt16BE(4) || 400; italic = (table.readUInt16BE(62) & 1) === 1;
    // fsType: 0x0002 alone means "restricted licence embedding"; preview/print (4) and editable (8) allow it.
    const fsType = table.readUInt16BE(8); embeddable = !((fsType & 0x0002) && !(fsType & 0x000c));
  }
  const family = (found[16] ?? found[1])?.text.trim(), style = (found[17] ?? found[2])?.text.trim() ?? 'Regular';
  if (!family) return null;
  return { family, style, legacy: found[1]?.text.trim() || family, legacyStyle: found[2]?.text.trim() || style, postscript: found[6]?.text.trim() ?? family.replace(/\s/g, ''), weight, embeddable, italic: italic || /italic|oblique/i.test(style) };
}
async function readFile_(file: string): Promise<SystemFace[]> {
  const handle = await open(file, 'r');
  try {
    const tag = Buffer.alloc(16);
    await handle.read(tag, 0, 16, 0);
    if (tag.toString('latin1', 0, 4) === 'ttcf') {
      const count = Math.min(tag.readUInt32BE(8), 64), offsets = Buffer.alloc(4 * count);
      await handle.read(offsets, 0, offsets.length, 12);
      const faces: SystemFace[] = [];
      for (let i = 0; i < count; i++) { const face = await readFace(handle, offsets.readUInt32BE(i * 4)); if (face) faces.push({ ...face, file, collection: true }); }
      return faces;
    }
    const face = await readFace(handle, 0);
    return face ? [{ ...face, file, collection: false }] : [];
  } finally { await handle.close(); }
}
let catalog: Promise<SystemFace[]> | undefined;
/** Scans installed fonts once per run; results are cached on disk by file size and date. */
export function systemFonts(cacheFile?: string): Promise<SystemFace[]> {
  catalog ??= (async () => {
    const files = [...new Set((await Promise.all(fontFolders().map((folder) => walk(folder)))).flat())];
    let cache: Record<string, { key: string; faces: SystemFace[] }> = {};
    if (cacheFile) try { cache = JSON.parse(await readFile(cacheFile, 'utf8')); } catch {}
    const next: typeof cache = {}, faces: SystemFace[] = [];
    await Promise.all(files.map(async (file) => {
      try {
        const info = await stat(file), key = `${info.size}:${info.mtimeMs}`;
        const entry = cache[file]?.key === key && cache[file]!.faces.every((f) => f.legacy && f.embeddable !== undefined) ? cache[file]! : { key, faces: await readFile_(file) };
        next[file] = entry; faces.push(...entry.faces);
      } catch {}
    }));
    if (cacheFile) await writeFile(cacheFile, JSON.stringify(next)).catch(() => {});
    return faces.sort((a, b) => a.family.localeCompare(b.family, 'pt-BR') || a.weight - b.weight);
  })();
  catalog.catch(() => { catalog = undefined; });
  return catalog;
}
export async function fontFamilies(cacheFile?: string): Promise<string[]> {
  return [...new Set((await systemFonts(cacheFile)).filter((f) => !/^\./.test(f.family)).map((f) => f.family))];
}
const normal = (value: string) => value.replace(/^[A-Z]{6}\+/, '').replace(/[^a-z0-9]/gi, '').toLowerCase();
/** The installed face matching a PDF's embedded font name (e.g. "ABCDEF+SegoeUI-Semibold"). */
export async function faceForPostscript(raw: string, cacheFile?: string): Promise<SystemFace | undefined> {
  const wanted = normal(raw.split(',')[0]!.replace(/-/g, ''));
  if (!wanted) return undefined;
  const faces = await systemFonts(cacheFile);
  return faces.find((f) => normal(f.postscript) === wanted) ?? faces.find((f) => normal(f.family + f.style) === wanted || (normal(f.family) === wanted && /regular|normal|book/i.test(f.style)));
}
/** Best installed file for a family in the requested weight and slant (single-face files only). */
export async function faceFor(family: string, bold: boolean, italic: boolean, cacheFile?: string): Promise<SystemFace | undefined> {
  const options = (await systemFonts(cacheFile)).filter((f) => (f.family.toLowerCase() === family.toLowerCase() || f.legacy.toLowerCase() === family.toLowerCase()) && !f.collection && f.embeddable);
  if (!options.length) return undefined;
  const target = bold ? 700 : 400;
  return [...options].sort((a, b) => (a.italic === italic ? 0 : 1000) - (b.italic === italic ? 0 : 1000) + Math.abs(a.weight - target) - Math.abs(b.weight - target))[0];
}
