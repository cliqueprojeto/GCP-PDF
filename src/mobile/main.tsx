import './globals';
import {hasNative, call, onNative, nativeInfo} from './native';
import {host, dialog} from './shims/electron';
import {createBridge} from './bridge';
import {startShell} from './shell';

/** Android entry: the desktop main process runs in this page (src/main/index.ts with the Android adapters),
 * then the same interface starts with the mobile shell around it. */
function unsupported(): string | null {
  const missing = [
    typeof (Promise as unknown as {withResolvers?: unknown}).withResolvers !== 'function',
    typeof structuredClone !== 'function',
    typeof (Array.prototype as unknown as {findLast?: unknown}).findLast !== 'function',
    typeof (globalThis as unknown as {OffscreenCanvas?: unknown}).OffscreenCanvas !== 'function',
  ].some(Boolean);
  return missing ? nativeInfo().webView || 'desconhecida' : null;
}

async function start() {
  const old = unsupported();
  if (old) {
    document.getElementById('root')!.innerHTML = `<main class="webview-update"><h1>Atualize o Android System WebView</h1><p>O GCP-PDF usa o motor do Chrome do Android para abrir e converter documentos. A versão instalada (${old}) é antiga demais.</p><p>Abra a Play Store e atualize <b>Android System WebView</b> e <b>Google Chrome</b>, depois abra o GCP-PDF de novo.</p></main>`;
    if (hasNative) call('ready');
    return;
  }
  await import('../main/index');
  const mainWindow = await host.mainWindow();
  // Automated checks over Chrome DevTools (debug builds only expose the WebView to them).
  (window as unknown as {__gcpMobile: unknown}).__gcpMobile = {host, dialog};
  (window as unknown as {gcp: unknown}).gcp = createBridge(mainWindow);
  startShell(mainWindow);
  await import('../renderer/main');
}
void start().catch(error => {
  document.getElementById('root')!.innerHTML = `<main class="webview-update"><h1>Não foi possível iniciar</h1><pre>${String(error?.stack ?? error).replace(/</g, '&lt;')}</pre></main>`;
  if (hasNative) call('ready');
});
void onNative;
