import {Buffer} from 'buffer';
import {call, fileUrl, fromBase64, nativeError, nativeInfo, toBase64} from '../native';
import {basename, dirname} from './path';

/** node:fs/promises over the Android file owner (FileSystem.kt). Reads stream through fetch, writes in chunks. */
interface NativeStat {exists: boolean; isFile?: boolean; isDirectory?: boolean; size?: number; mtimeMs?: number}
type Data = string | Uint8Array | ArrayBuffer | DataView;
type Options = BufferEncoding | {encoding?: BufferEncoding | null; flag?: string; mode?: number; recursive?: boolean; force?: boolean; withFileTypes?: boolean; maxRetries?: number; retryDelay?: number} | undefined;
const encodingOf = (options: Options) => typeof options === 'string' ? options : options?.encoding ?? undefined;

/** The engine binary lives with the native libraries; it is "present" when Android installed it for this ABI. */
const isEngine = (path: string) => /\/pdfcraft\/pdfcraft-cli(\.exe)?$/.test(path);

export class Stats {
  constructor(private value: NativeStat, private engine = false) {}
  get size() { return this.value.size ?? 0; }
  get mtimeMs() { return this.value.mtimeMs ?? 0; }
  get mtime() { return new Date(this.mtimeMs); }
  get ctime() { return this.mtime; }
  get birthtime() { return this.mtime; }
  get mode() { return this.engine ? 0o755 : this.value.isDirectory ? 0o40700 : 0o100600; }
  isFile() { return !!this.value.isFile; }
  isDirectory() { return !!this.value.isDirectory; }
  isSymbolicLink() { return false; }
}
export class Dirent {
  constructor(public name: string, private file: boolean, private directory: boolean, public parentPath = '') {}
  get path() { return this.parentPath; }
  isFile() { return this.file; }
  isDirectory() { return this.directory; }
  isSymbolicLink() { return false; }
}

export function statSync(path: string): Stats {
  if (isEngine(path)) {
    if (!nativeInfo().engine) throw Object.assign(nativeError(`ENOENT: ${path}`), {path});
    return new Stats({exists: true, isFile: true, isDirectory: false, size: 1}, true);
  }
  const value = call<NativeStat>('fsStat', path);
  if (!value.exists) throw Object.assign(nativeError(`ENOENT: no such file or directory, stat '${path}'`), {path});
  return new Stats(value);
}
export async function stat(path: string): Promise<Stats> { return statSync(path); }
export const lstat = stat;
export async function access(path: string, _mode?: number): Promise<void> { statSync(path); }

export async function readFile(path: string, options?: Options): Promise<any> {
  if (typeof path !== 'string') throw new TypeError('Caminho inválido.');
  const response = await fetch(fileUrl(path), {cache: 'no-store'});
  if (!response.ok) {
    const reason = await response.text().catch(() => '');
    throw Object.assign(nativeError(/^E[A-Z]+:/.test(reason) ? reason : `ENOENT: no such file or directory, open '${path}'`), {path});
  }
  const bytes = Buffer.from(await response.arrayBuffer());
  const encoding = encodingOf(options);
  return encoding ? bytes.toString(encoding) : bytes;
}

function bytesOf(data: Data, encoding?: BufferEncoding): Uint8Array {
  if (typeof data === 'string') return Buffer.from(data, encoding ?? 'utf8');
  if (data instanceof Uint8Array) return data;
  if (data instanceof ArrayBuffer) return new Uint8Array(data);
  return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
}
const CHUNK = 768 * 1024;
export async function writeFile(path: string, data: Data, options?: Options): Promise<void> {
  const flag = (typeof options === 'object' && options?.flag) || 'w';
  const bytes = bytesOf(data, encodingOf(options));
  const id = call<number>('fsBegin', path, flag === 'a' ? 'a' : flag === 'wx' ? 'wx' : 'w');
  let failed = true;
  try {
    for (let at = 0; at < bytes.length; at += CHUNK) {
      call('fsChunk', id, toBase64(bytes.subarray(at, at + CHUNK)));
      // Large documents: let the interface paint between chunks.
      if (bytes.length > 4 * CHUNK) await new Promise(resolve => setTimeout(resolve, 0));
    }
    failed = false;
  } finally { call('fsEnd', id, failed); }
}
export async function appendFile(path: string, data: Data, options?: Options) {
  return writeFile(path, data, typeof options === 'object' ? {...options, flag: 'a'} : {encoding: options, flag: 'a'});
}
export async function mkdir(path: string, options?: {recursive?: boolean; mode?: number} | number): Promise<string | undefined> {
  const recursive = typeof options === 'object' && !!options?.recursive;
  call('fsMkdir', path, recursive);
  return recursive ? path : undefined;
}
export async function mkdtemp(prefix: string): Promise<string> {
  for (let attempt = 0; attempt < 10; attempt++) {
    const path = prefix + Math.random().toString(36).slice(2, 8);
    try { call('fsMkdir', path, false); return path; } catch (error) { if ((error as {code?: string}).code !== 'EEXIST') throw error; }
  }
  throw nativeError(`EEXIST: ${prefix}`);
}
export async function rm(path: string, options?: {recursive?: boolean; force?: boolean}): Promise<void> {
  call('fsRm', path, !!options?.recursive, !!options?.force);
}
export async function rmdir(path: string, options?: {recursive?: boolean}) { return rm(path, {recursive: !!options?.recursive}); }
export async function unlink(path: string): Promise<void> { call('fsRm', path, false, false); }
export async function rename(from: string, to: string): Promise<void> { call('fsRename', from, to); }
export async function copyFile(from: string, to: string): Promise<void> { call('fsCopy', from, to); }
export async function cp(from: string, to: string): Promise<void> { call('fsCopy', from, to); }
export async function realpath(path: string): Promise<string> {
  if (isEngine(path)) return path;
  statSync(path);
  return call<string>('fsRealpath', path);
}
export async function chmod(_path: string, _mode: number): Promise<void> {}
export async function chown(): Promise<void> {}
export async function utimes(): Promise<void> {}
export async function readdir(path: string, options?: Options): Promise<any[]> {
  const entries = call<{name: string; isFile: boolean; isDirectory: boolean}[]>('fsReaddir', path);
  if (typeof options === 'object' && options?.withFileTypes) return entries.map(e => new Dirent(e.name, e.isFile, e.isDirectory, path));
  return entries.map(e => e.name);
}

/** Positional reads (font tables, PDF headers) without loading whole files. */
export class FileHandle {
  constructor(private path: string) {}
  async read(buffer: Uint8Array, offset = 0, length = buffer.length - offset, position: number | null = 0) {
    const bytes = fromBase64(call<string>('fsReadRange', this.path, position ?? 0, length));
    buffer.set(bytes, offset);
    return {bytesRead: bytes.length, buffer};
  }
  async readFile(options?: Options) { return readFile(this.path, options); }
  async stat() { return stat(this.path); }
  async close() {}
}
export async function open(path: string, flags: string = 'r'): Promise<FileHandle> {
  if (flags !== 'r') throw new Error('Somente leitura posicional é usada pelo aplicativo.');
  statSync(path);
  return new FileHandle(path);
}

export const constants = {F_OK: 0, R_OK: 4, W_OK: 2, X_OK: 1, O_RDONLY: 0, COPYFILE_EXCL: 1};
export {basename as _basename, dirname as _dirname};
export default {stat, lstat, access, readFile, writeFile, appendFile, mkdir, mkdtemp, rm, rmdir, unlink, rename, copyFile, cp, realpath, chmod, chown, utimes, readdir, open, constants};
