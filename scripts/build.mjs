import {build as bundle} from 'esbuild';
import {build as viteBuild} from 'vite';
import react from '@vitejs/plugin-react';
import {mkdir,readFile,writeFile,copyFile,cp} from 'node:fs/promises';
import {createCanvas,loadImage} from '@napi-rs/canvas';
import {svgToIco,contextIcons,installerArt} from './icons.mjs';
await mkdir('dist/main',{recursive:true});
const image=await loadImage(await readFile('assets/icon.svg'));
for(const size of [512,256]){const canvas=createCanvas(size,size);canvas.getContext('2d').drawImage(image,0,0,size,size);const png=canvas.toBuffer('image/png');await writeFile(size===512?'assets/icon.png':'assets/icon-256.png',png);if(size===256){const header=Buffer.alloc(22);header.writeUInt16LE(1,2);header.writeUInt16LE(1,4);header[6]=0;header[7]=0;header.writeUInt16LE(1,10);header.writeUInt16LE(32,12);header.writeUInt32LE(png.length,14);header.writeUInt32LE(22,18);await writeFile('assets/icon.ico',Buffer.concat([header,png]));}}
await svgToIco('assets/icon.svg','assets/icon.ico',undefined,'assets/icon-small.svg');await contextIcons();await installerArt();
await bundle({entryPoints:['src/main/index.ts'],outfile:'dist/main/index.cjs',platform:'node',format:'cjs',packages:'external',bundle:true,sourcemap:true,target:'node24'});
await bundle({entryPoints:['src/main/preload.ts'],outfile:'dist/main/preload.cjs',platform:'node',format:'cjs',external:['electron'],bundle:true,target:'node24'});
await viteBuild({root:'.',base:'./',plugins:[react()],build:{outDir:'dist/renderer',emptyOutDir:true},logLevel:'info'});
await copyFile('assets/icon.svg','dist/renderer/icon.svg');
console.log('GCP-PDF compilado.');

for(const folder of ['cmaps','standard_fonts','wasm'])await cp('node_modules/pdfjs-dist/'+folder,'dist/renderer/pdfjs/'+folder,{recursive:true});

const rendererIndex='dist/renderer/index.html';
let html=await readFile(rendererIndex,'utf8');
const csp="default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; worker-src 'self' blob:; connect-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; object-src 'none'; base-uri 'self'; form-action 'none'";
html=html.replace('<head>',`<head><meta http-equiv="Content-Security-Policy" content="${csp}">`);
await writeFile(rendererIndex,html);
