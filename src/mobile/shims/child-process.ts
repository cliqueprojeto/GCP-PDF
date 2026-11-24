import {Buffer} from 'buffer';
import {startProcess, call, request} from '../native';
import {basename} from './path';

/** node:child_process for the two programs the engine starts on Android: the editing engine (streamed over
 * stdio, as on the desktop) and the scanner helper, answered here by the camera and the gallery. */
type Listener = (...args: any[]) => void;
class Emitter {
  private events = new Map<string, Listener[]>();
  on(name: string, listener: Listener) { (this.events.get(name) ?? this.events.set(name, []).get(name)!).push(listener); return this; }
  once(name: string, listener: Listener) { const wrapped: Listener = (...args) => { this.off(name, wrapped); listener(...args); }; return this.on(name, wrapped); }
  off(name: string, listener: Listener) { this.events.set(name, (this.events.get(name) ?? []).filter(l => l !== listener)); return this; }
  removeListener(name: string, listener: Listener) { return this.off(name, listener); }
  emit(name: string, ...args: unknown[]) { for (const listener of [...(this.events.get(name) ?? [])]) listener(...args); return true; }
}
class Readable extends Emitter {
  private encoding?: string;
  setEncoding(encoding: string) { this.encoding = encoding; return this; }
  resume() { return this; }
  push(text: string) { this.emit('data', this.encoding ? text : Buffer.from(text, 'utf8')); }
}
class ChildProcess extends Emitter {
  stdout = new Readable(); stderr = new Readable();
  stdin: {write(text: string | Uint8Array): boolean; end(): void};
  pid: number; exitCode: number | null = null; killed = false;
  constructor(command: string, args: string[], cwd?: string) {
    super();
    let id = 0;
    try {
      id = startProcess(command, args, cwd, (kind, data) => {
        const trace = (globalThis as {__gcpEngineTrace?: string[]}).__gcpEngineTrace;
        if (trace) { trace.push(`${kind}: ${data}`); if (trace.length > 400) trace.splice(0, trace.length - 400); }
        if (kind === 'stdout') this.stdout.push(data);
        else if (kind === 'stderr') this.stderr.push(data);
        else if (kind === 'exit') { this.exitCode = Number(data); this.emit('exit', this.exitCode, this.killed ? 'SIGTERM' : null); this.emit('close', this.exitCode); }
      });
    } catch (error) { queueMicrotask(() => this.emit('error', error)); }
    this.pid = id;
    this.stdin = {
      write: (text) => { if (!id) return false; (globalThis as {__gcpEngineTrace?: string[]}).__gcpEngineTrace?.push(`stdin: ${String(text).slice(0, 4000)}`); call('procWrite', id, typeof text === 'string' ? text : Buffer.from(text).toString('utf8')); return true; },
      end: () => { if (id) call('procEnd', id); },
    };
  }
  kill() { if (this.pid && this.exitCode === null) { this.killed = true; call('procKill', this.pid); } return true; }
}
export function spawn(command: string, args: string[] = [], options: {cwd?: string} = {}) { return new ChildProcess(command, args, options.cwd); }

type Callback = (error: (Error & {killed?: boolean; code?: number | string}) | null, stdout: string, stderr: string) => void;
/** Camera and gallery stand in for the scanner helper (list, capabilities, scan → page-NNNN.png). */
async function scannerHelper(args: string[]): Promise<string> {
  const [action, ...rest] = args;
  if (action === 'list') return JSON.stringify([{id: 'camera', name: 'Câmera do aparelho'}, {id: 'gallery', name: 'Fotos da galeria'}]);
  if (action === 'capabilities') return JSON.stringify({sources: [], nativeUi: false, description: rest[0] === 'gallery' ? 'Escolha uma ou várias fotos: cada imagem vira uma página.' : 'Fotografe a página com boa luz, de cima e sem sombras. Cada foto vira uma página.'});
  if (action === 'scan') {
    const [device, folder, raw] = rest, options = JSON.parse(raw ?? '{}') as {dpi?: number; color?: string; paper?: string};
    const longSide = {A3: 420, A4: 297, A5: 210, Carta: 279.4, Ofício: 355.6}[options.paper ?? 'A4'] ?? 297;
    const count = await request<number>('camera', {folder, source: device === 'gallery' ? 'gallery' : 'camera', color: options.color ?? 'color', maxSide: Math.round(longSide / 25.4 * Math.min(options.dpi ?? 200, 300))});
    if (!count) throw new Error('Nenhuma imagem foi capturada.');
    return '';
  }
  throw new Error('Ação de digitalização desconhecida.');
}
export function execFile(file: string, args: string[] = [], options: {timeout?: number; signal?: AbortSignal} | Callback = {}, callback?: Callback) {
  if (typeof options === 'function') { callback = options; options = {}; }
  const done = callback ?? (() => {});
  const name = basename(file);
  if (name === 'gcp-scanner' || name === 'wia.ps1') {
    scannerHelper(args).then(out => done(null, out, ''), error => done(error, '', String(error?.message ?? error)));
    return {kill() {}};
  }
  if (!/^pdfcraft-cli/.test(name)) {
    queueMicrotask(() => done(Object.assign(new Error(`O programa ${name} não está disponível no Android.`), {code: 'ENOENT'}), '', ''));
    return {kill() {}};
  }
  const child = spawn(file, args, {cwd: (options as {cwd?: string}).cwd});
  let stdout = '', stderr = '', finished = false;
  const finish = (error: (Error & {killed?: boolean}) | null) => { if (finished) return; finished = true; clearTimeout(timer); done(error, stdout, stderr); };
  child.stdout.setEncoding('utf8'); child.stderr.setEncoding('utf8');
  child.stdout.on('data', (d: string) => { stdout += d; });
  child.stderr.on('data', (d: string) => { stderr += d; });
  child.on('error', (error: Error) => finish(error));
  child.on('exit', (code: number) => finish(code === 0 ? null : Object.assign(new Error(`Processo terminou com código ${code}`), {code, killed: child.killed})));
  const timeout = (options as {timeout?: number}).timeout;
  const timer = timeout ? setTimeout(() => child.kill(), timeout) : undefined;
  (options as {signal?: AbortSignal}).signal?.addEventListener('abort', () => child.kill(), {once: true});
  return child;
}
export default {spawn, execFile};
