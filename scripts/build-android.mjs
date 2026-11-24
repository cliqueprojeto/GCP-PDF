// Builds the Android app: the shared interface and engine (Vite, vite.mobile.config.ts), the desktop assets the
// engine reads (dictionaries, OCR models, release notes), office-metric fonts, the editing engine for each ABI
// and the APK itself.
//
//   node scripts/build-android.mjs [--release] [--skip-gradle] [--split]
//
// Environment: JAVA_HOME (JDK 17+; defaults to ~/.cache/gcp-pdf-toolchains/jdk-21 when present), ANDROID_HOME
// (defaults to ~/Android/Sdk), GCP_ENGINE_DIR (folder with <abi>/libpdfcraft.so, see scripts/build-android-engine.sh).
import {build} from 'vite';
import {cp, mkdir, readFile, readdir, rm, stat, writeFile, copyFile} from 'node:fs/promises';
import {existsSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {homedir} from 'node:os';
import {join, resolve} from 'node:path';

const args = new Set(process.argv.slice(2));
const release = args.has('--release');
const root = resolve('.');
const android = join(root, 'android');
const main = join(android, 'app/src/main');
const www = join(main, 'assets/www');
const appAssets = join(main, 'assets/app');
const version = JSON.parse(await readFile('package.json', 'utf8')).version;
const toolchains = join(homedir(), '.cache/gcp-pdf-toolchains');

console.log(`GCP-PDF ${version} para Android (${release ? 'distribuição' : 'teste'})`);

// 1. Web layer.
await build({configFile: 'vite.mobile.config.ts', mode: 'production'});
for (const folder of ['cmaps', 'standard_fonts', 'wasm']) await cp(`node_modules/pdfjs-dist/${folder}`, join(www, 'pdfjs', folder), {recursive: true});
await mkdir(join(www, 'tesseract/core'), {recursive: true});
await copyFile('node_modules/tesseract.js/dist/worker.min.js', join(www, 'tesseract/worker.min.js'));
// libarchive (comics: CBZ, CBR, CB7) looks for its WebAssembly next to the page.
await copyFile('node_modules/libarchive-wasm/dist/libarchive.wasm', join(www, 'libarchive.wasm'));
for (const name of await readdir('node_modules/tesseract.js-core')) if (name === 'tesseract-core-simd-lstm.wasm.js') await copyFile(join('node_modules/tesseract.js-core', name), join(www, 'tesseract/core', name));
const csp = "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; worker-src 'self' blob:; connect-src 'self' blob: data:; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; media-src 'self' blob:; object-src 'none'; frame-src 'none'; base-uri 'self'; form-action 'none'";
const index = join(www, 'index.html');
await writeFile(index, (await readFile(index, 'utf8')).replace('<head>', `<head><meta http-equiv="Content-Security-Policy" content="${csp}">`));

// 2. What the engine reads from the desktop assets folder (same paths: /android_asset/app/assets/…).
await rm(appAssets, {recursive: true, force: true});
await mkdir(join(appAssets, 'assets'), {recursive: true});
for (const item of ['dictionaries', 'tessdata', 'icp-brasil', 'novidades.json', 'icon.png', 'Inter-Regular.ttf', 'OFL-Inter.txt']) await cp(join('assets', item), join(appAssets, 'assets', item), {recursive: true});
await mkdir(join(appAssets, 'assets/pdfcraft'), {recursive: true});
for (const name of await readdir('assets/pdfcraft')) if (/^(LICENSE|NOTICE|OFL)/.test(name)) await copyFile(join('assets/pdfcraft', name), join(appAssets, 'assets/pdfcraft', name));
await copyFile('THIRD_PARTY_NOTICES.md', join(appAssets, 'THIRD_PARTY_NOTICES.md'));
await copyFile('LICENSE', join(appAssets, 'LICENSE'));

// 3. Office-metric fonts: Calibri → Carlito, Cambria → Caladea, Arial/Times/Courier → Liberation.
const FONT_SOURCES = [process.env.GCP_FONTS_DIR, '/usr/share/fonts', '/usr/share/fonts/truetype'].filter(Boolean);
const FACES = {
  Carlito: ['Calibri'], Caladea: ['Cambria'],
  'Liberation Sans': ['Arial', 'Helvetica', 'Arial MT', 'Helvetica Neue'], 'Liberation Serif': ['Times New Roman', 'Times', 'Tinos'], 'Liberation Mono': ['Courier New', 'Courier', 'Consolas'],
};
const STYLES = [['Regular', 400, 'normal'], ['Bold', 700, 'normal'], ['Italic', 400, 'italic'], ['BoldItalic', 700, 'italic']];
async function findFont(file) {
  for (const base of FONT_SOURCES) for (const sub of ['', 'carlito', 'caladea', 'liberation', 'crosextra', 'liberation2']) { const path = join(base, sub, file); if (existsSync(path)) return path; }
  return null;
}
await mkdir(join(appAssets, 'fonts'), {recursive: true});
const css = [];
for (const [family, aliases] of Object.entries(FACES)) for (const [style, weight, slant] of STYLES) {
  const file = `${family.replace(/ /g, '')}-${style}.ttf`, source = await findFont(file);
  if (!source) throw new Error(`Fonte ${file} não encontrada. Instale Carlito, Caladea e Liberation (ou defina GCP_FONTS_DIR).`);
  await copyFile(source, join(appAssets, 'fonts', file));
  for (const name of [family, ...aliases]) css.push(`@font-face{font-family:"${name}";src:url("${file}") format("truetype");font-weight:${weight};font-style:${slant};font-display:block}`);
}
await writeFile(join(appAssets, 'fonts/fonts.css'), css.join('\n') + '\n');
await mkdir(join(appAssets, 'licenses'), {recursive: true});
for (const [from, to] of [['/usr/share/licenses/ttf-carlito/LICENSE', 'OFL-Carlito.txt'], ['/usr/share/licenses/ttf-caladea/OFL.txt', 'OFL-Caladea.txt'], ['/usr/share/licenses/ttf-liberation/LICENSE', 'OFL-Liberation.txt']])
  if (existsSync(from)) await copyFile(from, join(appAssets, 'licenses', to));

// 4. Editing engine (PdfCraft 0.15.0 CLI, built for Android by scripts/build-android-engine.sh).
const engineDir = process.env.GCP_ENGINE_DIR ?? join(toolchains, 'engine-0.15.0');
const jni = join(main, 'jniLibs');
await rm(jni, {recursive: true, force: true});
let abis = 0;
for (const abi of ['arm64-v8a', 'armeabi-v7a', 'x86_64']) {
  const source = join(engineDir, abi, 'libpdfcraft.so');
  if (!existsSync(source)) { console.warn(`Aviso: motor de edição ausente para ${abi} (${source}).`); continue; }
  await mkdir(join(jni, abi), {recursive: true}); await copyFile(source, join(jni, abi, 'libpdfcraft.so')); abis++;
}
if (!abis) console.warn('Aviso: o APK não terá o motor de edição: Editar tudo, formulários, compressão, proteção e assinatura com certificado ficarão indisponíveis.');

// 5. APK.
if (!args.has('--skip-gradle')) {
  const env = {...process.env};
  env.JAVA_HOME ??= existsSync(join(toolchains, 'jdk-21')) ? join(toolchains, 'jdk-21') : undefined;
  env.ANDROID_HOME ??= join(homedir(), 'Android/Sdk');
  if (!existsSync(join(android, 'local.properties'))) await writeFile(join(android, 'local.properties'), `sdk.dir=${env.ANDROID_HOME}\n`);
  const task = release ? ':app:assembleRelease' : ':app:assembleDebug';
  execFileSync(join(android, process.platform === 'win32' ? 'gradlew.bat' : 'gradlew'), ['-p', android, task, ...(args.has('--split') ? ['-Pgcp.splitAbi=true'] : [])], {stdio: 'inherit', env});
  const outputs = join(android, 'app/build/outputs/apk', release ? 'release' : 'debug');
  const target = join(root, 'release/android');
  await mkdir(target, {recursive: true});
  const sums = [];
  for (const name of await readdir(outputs)) {
    if (!name.endsWith('.apk')) continue;
    const abi = /-(arm64-v8a|armeabi-v7a|x86_64|universal)-/.exec(name)?.[1];
    const out = `GCP-PDF-${version}-android${abi && abi !== 'universal' ? '-' + abi : ''}${release ? '' : '-teste'}.apk`;
    await copyFile(join(outputs, name), join(target, out));
    const bytes = await readFile(join(target, out));
    sums.push(`${createHash('sha256').update(bytes).digest('hex')}  ${out}`);
    console.log(`${out}: ${((await stat(join(target, out))).size / 1048576).toFixed(1)} MB`);
  }
  await writeFile(join(target, 'SHA256SUMS-Android.txt'), sums.join('\n') + '\n');
}
console.log('Android pronto.');
