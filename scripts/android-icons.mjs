// Android launcher, adaptive and splash icons drawn from assets/icon.svg (the desktop icon).
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {createCanvas,loadImage} from '@napi-rs/canvas';

const RES='android/app/src/main/res';
const DENSITIES={mdpi:1,hdpi:1.5,xhdpi:2,xxhdpi:3,xxxhdpi:4};
const svg=await readFile('assets/icon.svg','utf8');
const defs=svg.slice(svg.indexOf('<defs>'),svg.indexOf('</defs>')+7);
const body=svg.slice(svg.indexOf('</defs>')+7,svg.lastIndexOf('</svg>'));
// The rounded tile and its gloss become the background layer; the page, fold, tag and spark the foreground.
const lines=body.split('\n').map(l=>l.trim()).filter(Boolean);
const tile=lines.filter(l=>/^<rect x="(16|17\.5)"/.test(l)||l.startsWith('<path d="M96 470'));
const art=lines.filter(l=>!tile.includes(l));
const wrap=(content,view='0 0 512 512')=>Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="${view}">${defs}${content}</svg>`);
const background=wrap('<rect width="512" height="512" fill="url(#bg)"/><rect width="512" height="512" fill="url(#gloss)"/>');
// Adaptive icons show the middle 72 of 108 dp: the art is centred in a 1.5x larger canvas.
const foreground=wrap(art.join(''),'-100 -100 712 712');
const monochrome=wrap(art.join('').replace(/fill="url\(#[a-z]+\)"/g,'fill="#ffffff"').replace(/fill="#[0-9a-fA-F]{6}"/g,'fill="#ffffff"'),'-100 -100 712 712');
const splash=wrap(body,'-96 -96 704 704');
async function render(source,size){const image=await loadImage(source),canvas=createCanvas(size,size);canvas.getContext('2d').drawImage(image,0,0,size,size);return canvas.toBuffer('image/png');}
for(const [name,scale] of Object.entries(DENSITIES)){
 const folder=`${RES}/mipmap-${name}`;await mkdir(folder,{recursive:true});
 const adaptive=Math.round(108*scale);
 await writeFile(`${folder}/ic_launcher_background.png`,await render(background,adaptive));
 await writeFile(`${folder}/ic_launcher_foreground.png`,await render(foreground,adaptive));
 await writeFile(`${folder}/ic_launcher_monochrome.png`,await render(monochrome,adaptive));
 await writeFile(`${folder}/ic_launcher_foreground_splash.png`,await render(splash,Math.round(240*scale)));
}
console.log('Ícones Android gerados.');
