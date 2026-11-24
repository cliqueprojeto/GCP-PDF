import {Buffer} from 'buffer';
import {fromBase64, hasNative, nativeInfo, request, toBase64} from './native';

/** Node globals the desktop engine expects (imported first, before any engine module evaluates). */
const info = nativeInfo();
const arch = ({'arm64-v8a': 'arm64', 'armeabi-v7a': 'arm', x86_64: 'x64', x86: 'ia32'} as Record<string, string>)[info.abi] ?? 'arm64';
const g = globalThis as unknown as Record<string, unknown>;
g.Buffer ??= Buffer;
g.global ??= globalThis;
g.process = {
  platform: 'android', arch, env: {GCP_PDF_PLATFORM: 'android'}, argv: ['/gcp-pdf'], execPath: '/gcp-pdf', pid: 1,
  cwd: () => info.files, version: 'v24.0.0', release: {name: 'android'},
  nextTick: (fn: (...args: unknown[]) => void, ...args: unknown[]) => queueMicrotask(() => fn(...args)),
  on() {}, once() {}, off() {}, emit() {}, emitWarning(message: unknown) { console.warn(message); },
  hrtime: Object.assign((previous?: [number, number]) => { const t = performance.now(), s = Math.floor(t / 1000), n = Math.floor((t % 1000) * 1e6); return previous ? [s - previous[0], n - previous[1]] : [s, n]; }, {bigint: () => BigInt(Math.floor(performance.now() * 1e6))}),
  memoryUsage: () => ({rss: 0, heapTotal: 0, heapUsed: 0, external: 0}),
  stdout: {write: (text: string) => { console.log(text); return true; }}, stderr: {write: (text: string) => { console.warn(text); return true; }},
};

/** Like the desktop (Node's fetch), calls to AI providers and GitHub are not bound by browser CORS rules: they go
 * through Android's HTTP client. Requests to the app's own origin stay in the WebView. */
const pageFetch = globalThis.fetch.bind(globalThis);
async function bodyBytes(body: BodyInit | null | undefined): Promise<Uint8Array | null> {
  if (body == null) return null;
  if (typeof body === 'string') return new TextEncoder().encode(body);
  if (body instanceof Uint8Array) return body;
  if (body instanceof ArrayBuffer) return new Uint8Array(body);
  if (ArrayBuffer.isView(body)) return new Uint8Array(body.buffer, body.byteOffset, body.byteLength);
  return new Uint8Array(await new Response(body).arrayBuffer());
}
if (hasNative) globalThis.fetch = async (input: RequestInfo | URL, init: RequestInit = {}) => {
  const url = new URL(input instanceof Request ? input.url : String(input), location.href);
  if (url.origin === location.origin || !/^https?:$/.test(url.protocol)) return pageFetch(input, init);
  const signal = init.signal ?? (input instanceof Request ? input.signal : undefined);
  signal?.throwIfAborted();
  const headers: Record<string, string> = {};
  new Headers(init.headers ?? (input instanceof Request ? input.headers : undefined)).forEach((value, key) => { headers[key] = value; });
  const body = await bodyBytes(init.body ?? (input instanceof Request && input.method !== 'GET' && input.method !== 'HEAD' ? await input.arrayBuffer() : null));
  const call = request<{status: number; statusText: string; url: string; headers: Record<string, string>; body: string}>('fetch', {
    url: url.href, method: init.method ?? (input instanceof Request ? input.method : 'GET'), headers, redirect: init.redirect ?? 'follow', body: body ? toBase64(body) : '',
  });
  const reply = await (signal ? Promise.race([call, new Promise<never>((_, reject) => signal.addEventListener('abort', () => reject(signal.reason ?? new DOMException('Aborted', 'AbortError')), {once: true}))]) : call);
  const empty = [101, 204, 205, 304].includes(reply.status);
  const response = new Response(empty ? null : fromBase64(reply.body) as Uint8Array<ArrayBuffer>, {status: reply.status, statusText: reply.statusText, headers: reply.headers});
  Object.defineProperty(response, 'url', {value: reply.url});
  Object.defineProperty(response, 'redirected', {value: reply.url !== url.href});
  return response;
};
