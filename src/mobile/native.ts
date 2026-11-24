/** The Android host (android/…/NativeBridge.kt): the only owner of files, processes, dialogs and devices. */
type Envelope = {ok: true; v: unknown} | {ok: false; e: string};
interface Raw {[method: string]: (...args: never[]) => unknown}
interface Message {type: 'resolve' | 'proc' | 'event'; id?: number; ok?: boolean; v?: unknown; e?: string; kind?: string; data?: string; name?: string; value?: unknown}
export interface NativeInfo {files: string; cache: string; version: string; sdk: number; abi: string; locales: string[]; model: string; webView: string; dark: boolean; tablet: boolean; engine: boolean}

const raw = (globalThis as unknown as {GcpNative?: Raw}).GcpNative;
export const hasNative = !!raw;

/** Errors carry Node's `code` (ENOENT, EEXIST, EACCES…) so the engine reacts to them as on the desktop. */
export function nativeError(message: string): Error & {code?: string} {
  const error = new Error(message.replace(/^(E[A-Z]+):\s*/, '')) as Error & {code?: string};
  const code = /^(E[A-Z]+):/.exec(message)?.[1];
  if (code) { error.code = code; error.message = `${code}: ${error.message}`; }
  return error;
}

export function call<T>(method: string, ...args: unknown[]): T {
  if (!raw) throw new Error('Recurso disponível apenas no aplicativo Android.');
  const reply = JSON.parse(String((raw[method] as (...a: unknown[]) => unknown)(...args))) as Envelope;
  if (!reply.ok) throw nativeError(reply.e);
  return reply.v as T;
}

let nextId = 1;
const pending = new Map<number, {resolve: (value: unknown) => void; reject: (error: Error) => void}>();
const processes = new Map<number, (kind: string, data: string) => void>();
const listeners = new Map<string, Set<(value: never) => void>>();

export function request<T>(method: string, payload: Record<string, unknown> = {}): Promise<T> {
  if (!raw) return Promise.reject(new Error('Recurso disponível apenas no aplicativo Android.'));
  const id = nextId++;
  return new Promise<T>((resolve, reject) => {
    pending.set(id, {resolve: resolve as (value: unknown) => void, reject});
    (raw.request as unknown as (id: number, method: string, payload: string) => void)(id, method, JSON.stringify(payload));
  });
}

export function onNative<T>(name: string, listener: (value: T) => void): () => void {
  let set = listeners.get(name);
  if (!set) listeners.set(name, set = new Set());
  set.add(listener as (value: never) => void);
  return () => set!.delete(listener as (value: never) => void);
}

export function startProcess(command: string, args: string[], cwd: string | undefined, listener: (kind: string, data: string) => void): number {
  const id = nextId++;
  processes.set(id, (kind, data) => { if (kind === 'exit') processes.delete(id); listener(kind, data); });
  try { call('procStart', id, command, JSON.stringify(args), cwd ?? ''); }
  catch (error) { processes.delete(id); throw error; }
  return id;
}

(globalThis as unknown as {__gcpNative: {receive(json: string): void}}).__gcpNative = {
  receive(json: string) {
    const message = JSON.parse(json) as Message;
    if (message.type === 'resolve') {
      const waiter = pending.get(message.id!);
      if (!waiter) return;
      pending.delete(message.id!);
      if (message.ok) waiter.resolve(message.v); else waiter.reject(nativeError(message.e ?? 'Falha no Android.'));
    } else if (message.type === 'proc') {
      processes.get(message.id!)?.(message.kind!, message.data ?? '');
    } else if (message.type === 'event') {
      for (const listener of listeners.get(message.name!) ?? []) (listener as (value: unknown) => void)(message.value);
    }
  },
};

let cached: NativeInfo | undefined;
export function nativeInfo(): NativeInfo {
  cached ??= hasNative ? call<NativeInfo>('info') : {files: '/gcp/files', cache: '/gcp/cache', version: '0.0.0', sdk: 0, abi: '', locales: [navigator.language], model: '', webView: "", dark: matchMedia('(prefers-color-scheme: dark)').matches, tablet: false, engine: false};
  return cached;
}

/** URL that streams an engine path's bytes (see MainActivity.FilePathHandler). */
export function fileUrl(path: string): string {
  return '/__fs' + path.split('/').map(encodeURIComponent).join('/');
}

/** Base64 without building one giant string from a spread (large PDFs). */
export function toBase64(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i += 0x8000) out += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000) as unknown as number[]);
  return btoa(out);
}
export function fromBase64(text: string): Uint8Array {
  const binary = atob(text), bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}
