import {defineConfig} from 'vite';
import react from '@vitejs/plugin-react';
import {fileURLToPath} from 'node:url';

/** The Android app's web layer: the desktop interface and main process in one page, with Node and Electron
 * replaced by the adapters in src/mobile/shims. Built into the Android project's assets. */
const shim = (name: string) => fileURLToPath(new URL(`./src/mobile/shims/${name}`, import.meta.url));
const exact = (names: string[]) => new RegExp(`^(?:${names.map(n => n.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')).join('|')})$`);
export default defineConfig({
  root: 'src/mobile',
  base: './',
  publicDir: false,
  plugins: [react()],
  define: {
    __dirname: JSON.stringify('/android_asset/app/dist/main'),
    'process.env.NODE_ENV': JSON.stringify('production'),
  },
  resolve: {
    alias: [
      {find: exact(['electron']), replacement: shim('electron.ts')},
      {find: exact(['node:path', 'path', 'node:path/posix', 'path/posix']), replacement: shim('path.ts')},
      {find: exact(['node:fs/promises', 'fs/promises']), replacement: shim('fs-promises.ts')},
      {find: exact(['node:fs', 'fs']), replacement: shim('fs.ts')},
      {find: exact(['node:os', 'os']), replacement: shim('os.ts')},
      {find: exact(['node:crypto', 'crypto']), replacement: shim('crypto.ts')},
      {find: exact(['node:child_process', 'child_process']), replacement: shim('child-process.ts')},
      {find: exact(['node:url', 'url']), replacement: shim('url.ts')},
      {find: exact(['node:module', 'module']), replacement: shim('module.ts')},
      {find: exact(['node:util', 'util']), replacement: shim('util.ts')},
      {find: exact(['node:zlib', 'zlib']), replacement: shim('zlib.ts')},
      {find: exact(['@napi-rs/canvas']), replacement: shim('canvas.ts')},
      {find: exact(['tesseract.js']), replacement: shim('tesseract.ts')},
      // One PDF.js for the interface and the engine (its worker is configured once).
      {find: exact(['pdfjs-dist/legacy/build/pdf.mjs']), replacement: 'pdfjs-dist/build/pdf.mjs'},
    ],
  },
  build: {
    outDir: fileURLToPath(new URL('./android/app/src/main/assets/www', import.meta.url)),
    emptyOutDir: true,
    target: 'es2022',
    chunkSizeWarningLimit: 20000,
    sourcemap: false,
    assetsInlineLimit: 0,
  },
  logLevel: 'info',
});
