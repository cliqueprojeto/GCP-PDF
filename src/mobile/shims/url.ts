export function pathToFileURL(path: string): URL { return new URL('file://' + path.split('/').map(encodeURIComponent).join('/')); }
export function fileURLToPath(url: string | URL): string {
  const parsed = typeof url === 'string' ? new URL(url) : url;
  if (parsed.protocol !== 'file:') throw new TypeError('The URL must be of scheme file');
  return decodeURIComponent(parsed.pathname);
}
export const URL_ = URL;
export default {pathToFileURL, fileURLToPath};
