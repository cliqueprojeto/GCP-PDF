/** POSIX path rules for the Android engine paths (see FileSystem.kt). */
function normalizeParts(parts: string[], absolute: boolean): string[] {
  const out: string[] = [];
  for (const part of parts) {
    if (!part || part === '.') continue;
    if (part === '..') { if (out.length && out.at(-1) !== '..') out.pop(); else if (!absolute) out.push('..'); continue; }
    out.push(part);
  }
  return out;
}
export const sep = '/', delimiter = ':';
export function normalize(path: string): string {
  const absolute = path.startsWith('/'), trailing = path.endsWith('/') && path.length > 1;
  const joined = normalizeParts(path.split('/'), absolute).join('/');
  return (absolute ? '/' : '') + (joined || (absolute ? '' : '.')) + (trailing && joined ? '/' : '');
}
export function join(...parts: string[]): string { const value = parts.filter(p => p !== '').join('/'); return value ? normalize(value) : '.'; }
export function resolve(...parts: string[]): string {
  let path = '';
  for (let i = parts.length - 1; i >= 0 && !path.startsWith('/'); i--) if (parts[i]) path = parts[i] + (path ? '/' + path : '');
  if (!path.startsWith('/')) path = '/' + path;
  const value = normalize(path);
  return value.length > 1 ? value.replace(/\/$/, '') : value;
}
export function isAbsolute(path: string): boolean { return path.startsWith('/'); }
export function dirname(path: string): string {
  if (!path) return '.';
  const trimmed = path.length > 1 ? path.replace(/\/+$/, '') : path, at = trimmed.lastIndexOf('/');
  if (at < 0) return '.';
  return at === 0 ? '/' : trimmed.slice(0, at);
}
export function basename(path: string, ext?: string): string {
  const trimmed = path.length > 1 ? path.replace(/\/+$/, '') : path, base = trimmed.slice(trimmed.lastIndexOf('/') + 1);
  return ext && base.endsWith(ext) && base !== ext ? base.slice(0, -ext.length) : base;
}
export function extname(path: string): string {
  const base = basename(path), at = base.lastIndexOf('.');
  return at <= 0 ? '' : base.slice(at);
}
export function relative(from: string, to: string): string {
  const a = resolve(from).split('/').filter(Boolean), b = resolve(to).split('/').filter(Boolean);
  let i = 0; while (i < a.length && i < b.length && a[i] === b[i]) i++;
  return [...Array(a.length - i).fill('..'), ...b.slice(i)].join('/');
}
export function parse(path: string) { const base = basename(path), ext = extname(path); return {root: path.startsWith('/') ? '/' : '', dir: dirname(path), base, ext, name: ext ? base.slice(0, -ext.length) : base}; }
export function format(p: {dir?: string; root?: string; base?: string; name?: string; ext?: string}) { const base = p.base ?? (p.name ?? '') + (p.ext ?? ''); return p.dir ? `${p.dir}/${base}` : (p.root ?? '') + base; }
export function toNamespacedPath(path: string) { return path; }
const path = {sep, delimiter, normalize, join, resolve, isAbsolute, dirname, basename, extname, relative, parse, format, toNamespacedPath} as Record<string, unknown>;
path.posix = path; path.win32 = path;
export const posix = path, win32 = path;
export default path;
