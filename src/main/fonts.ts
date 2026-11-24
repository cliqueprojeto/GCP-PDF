import { open, readdir, readFile, realpath, stat, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';

/** Fonts installed on this computer. The app never ships or copies them (their licences forbid
 * redistribution); it uses them in place, like Word and desktop PDF editors do: for editing, for
 * embedding the used glyphs when saving a PDF, and for naming fonts in Word exports. */
export interface SystemFace { family: string; style: string; legacy: string; legacyStyle: string; postscript: string; weight: number; italic: boolean; embeddable: boolean; file: string; collection: boolean; /** Where the face starts inside a collection file (.ttc/.otc). */ offset?: number }
const EXTENSIONS = new Set(['.ttf', '.otf', '.ttc', '.otc']);
/** Where each system keeps fonts: the system's and the user's folders, the fonts Microsoft Office installs
 * for itself (Calibri and Cambria on a Mac, the cloud fonts on Windows) and, on Linux, every data folder
 * the desktop declares (XDG, Flatpak, Nix), not only /usr/share. */
export function fontFolders(platform: NodeJS.Platform = process.platform, env: NodeJS.ProcessEnv = process.env, home = homedir()): string[] {
  const join = platform === 'win32' ? path.win32.join : path.posix.join;
  if (platform === 'win32') {
    const local = env.LOCALAPPDATA ?? join(home, 'AppData', 'Local');
    return [join(env.WINDIR ?? 'C:\\Windows', 'Fonts'), join(local, 'Microsoft', 'Windows', 'Fonts'), join(local, 'Microsoft', 'FontCache', '4', 'CloudFonts')];
  }
  // Android: the metric-compatible fonts shipped with the app (Carlito, Caladea, Liberation…) and the system's.
  if ((platform as string) === 'android') return ['/android_asset/app/fonts', '/system/fonts', '/product/fonts'];
  if (platform === 'darwin') return ['/System/Library/Fonts', '/Library/Fonts', '/Network/Library/Fonts', join(home, 'Library', 'Fonts'),
    ...['Microsoft Word', 'Microsoft Excel', 'Microsoft PowerPoint'].map((app) => `/Applications/${app}.app/Contents/Resources/DFonts`),
    '/System/Library/AssetsV2/com_apple_MobileAsset_Font7', '/System/Library/AssetsV2/com_apple_MobileAsset_Font8'];
  const data = [env.XDG_DATA_HOME || join(home, '.local', 'share'), ...(env.XDG_DATA_DIRS || '/usr/local/share:/usr/share').split(':').filter(Boolean), '/usr/share', '/usr/local/share', '/var/lib/flatpak/exports/share', join(home, '.local', 'share', 'flatpak', 'exports', 'share'), join(home, '.nix-profile', 'share'), '/run/current-system/sw/share'];
  return [...new Set([...data.map((folder) => join(folder, 'fonts')), join(home, '.fonts')])];
}
/** Font files under a folder. Links are followed (distributions and users link font folders into place);
 * `seen` holds the real folders already read, so a link back up the tree cannot loop. */
async function walk(folder: string, depth = 0, seen = new Set<string>()): Promise<string[]> {
  const real = await realpath(folder).catch(() => null);
  if (!real || seen.has(real)) return [];
  seen.add(real);
  const entries = await readdir(folder, { withFileTypes: true }).catch(() => []);
  const files: string[] = [];
  for (const entry of entries) {
    const full = path.join(folder, entry.name);
    let directory = entry.isDirectory(), file = entry.isFile();
    if (entry.isSymbolicLink()) { const target = await stat(full).catch(() => null); directory = !!target?.isDirectory(); file = !!target?.isFile(); }
    if (directory && depth < 6) files.push(...(await walk(full, depth + 1, seen)));
    else if (file && EXTENSIONS.has(path.extname(entry.name).toLowerCase())) files.push(full);
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
      for (let i = 0; i < count; i++) { const offset = offsets.readUInt32BE(i * 4), face = await readFace(handle, offset); if (face) faces.push({ ...face, file, collection: true, offset }); }
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
        const entry = cache[file]?.key === key && cache[file]!.faces.every((f) => f.legacy && f.embeddable !== undefined && (!f.collection || f.offset !== undefined)) ? cache[file]! : { key, faces: await readFile_(file) };
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
/** One face of a collection file as a font file of its own: its tables, copied behind a new directory.
 * PDF writers embed single fonts; without this the families that systems ship as collections (Helvetica
 * and Menlo on a Mac, Cambria on Windows, Noto CJK on Linux) could be listed but never embedded. */
export function faceFromCollection(bytes: Uint8Array, offset: number): Uint8Array {
  const source = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (offset + 12 > source.length) throw new Error('Arquivo de fontes inválido.');
  const tables = source.readUInt16BE(offset + 4);
  if (tables > 200 || offset + 12 + tables * 16 > source.length) throw new Error('Arquivo de fontes inválido.');
  const records = Array.from({ length: tables }, (_, i) => { const at = offset + 12 + i * 16; return { tag: source.subarray(at, at + 4), checksum: source.readUInt32BE(at + 4), from: source.readUInt32BE(at + 8), length: source.readUInt32BE(at + 12) }; });
  if (records.some((r) => r.from + r.length > source.length)) throw new Error('Arquivo de fontes inválido.');
  const header = 12 + tables * 16, out = Buffer.alloc(header + records.reduce((n, r) => n + ((r.length + 3) & ~3), 0));
  source.copy(out, 0, offset, offset + 12);
  let at = header;
  records.forEach((r, i) => { const entry = 12 + i * 16; r.tag.copy(out, entry); out.writeUInt32BE(r.checksum, entry + 4); out.writeUInt32BE(at, entry + 8); out.writeUInt32BE(r.length, entry + 12); source.copy(out, at, r.from, r.from + r.length); at += (r.length + 3) & ~3; });
  return new Uint8Array(out.buffer, out.byteOffset, out.byteLength);
}
/** The font program of an installed face, ready to embed. */
export async function faceBytes(face: SystemFace): Promise<Uint8Array> {
  const bytes = new Uint8Array(await readFile(face.file));
  return face.collection ? faceFromCollection(bytes, face.offset ?? 0) : bytes;
}
/** Best installed face for a family in the requested weight and slant. */
export async function faceFor(family: string, bold: boolean, italic: boolean, cacheFile?: string): Promise<SystemFace | undefined> {
  const options = (await systemFonts(cacheFile)).filter((f) => (f.family.toLowerCase() === family.toLowerCase() || f.legacy.toLowerCase() === family.toLowerCase()) && (!f.collection || f.offset !== undefined) && f.embeddable);
  if (!options.length) return undefined;
  const target = bold ? 700 : 400;
  return [...options].sort((a, b) => (a.italic === italic ? 0 : 1000) - (b.italic === italic ? 0 : 1000) + Math.abs(a.weight - target) - Math.abs(b.weight - target))[0];
}
