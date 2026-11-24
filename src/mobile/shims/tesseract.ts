import Tesseract from 'tesseract.js/dist/tesseract.esm.min.js';
import {fileUrl} from '../native';

/** Tesseract in the WebView: the same recognizer and the bundled por/eng/spa models, read from the app, never
 * downloaded. The worker and the WebAssembly core ship with the interface (see vite.mobile.config.ts). */
type Options = {langPath?: string; gzip?: boolean; cachePath?: string; logger?: (m: unknown) => void};
const base = new URL('./tesseract/', document.baseURI).href;
export async function createWorker(langs: string | string[], oem?: number, options: Options = {}) {
  const worker = await (Tesseract as any).createWorker(langs, oem, {
    workerPath: base + 'worker.min.js',
    // One core: every supported WebView has WebAssembly SIMD (the check in main.tsx guarantees a recent engine).
    corePath: base + 'core/tesseract-core-simd-lstm.wasm.js',
    langPath: options.langPath ? location.origin + fileUrl(options.langPath) : undefined,
    gzip: options.gzip ?? false,
    cacheMethod: 'none',
    workerBlobURL: false,
    logger: options.logger ?? (() => {}),
  });
  const recognize = worker.recognize.bind(worker);
  // The desktop hands over PNG bytes (a Node Buffer); the browser recognizer takes a Blob.
  worker.recognize = (image: unknown, ...rest: unknown[]) => recognize(image instanceof Uint8Array ? new Blob([image as Uint8Array<ArrayBuffer>], {type: 'image/png'}) : image, ...rest);
  return worker;
}
export default {createWorker};
