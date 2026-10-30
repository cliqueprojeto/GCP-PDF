import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {existsSync} from 'node:fs';
import {createCanvas,loadImage,GlobalFonts} from '@napi-rs/canvas';
/** Writes a multi-resolution .ico (PNG entries) so Explorer and the taskbar stay crisp at 16–256 px.
 * Sizes up to 48 px can come from a simplified drawing (`smallSvg`), legible where detail would blur. */
export async function svgToIco(svgPath,icoPath,sizes=[16,20,24,32,40,48,64,128,256],smallSvg){
 const image=await loadImage(await readFile(svgPath)),small=smallSvg?await loadImage(await readFile(smallSvg)):image;
 const pngs=sizes.map(size=>{const canvas=createCanvas(size,size);canvas.getContext('2d').drawImage(size<=48?small:image,0,0,size,size);return canvas.toBuffer('image/png');});
 const header=Buffer.alloc(6);header.writeUInt16LE(1,2);header.writeUInt16LE(sizes.length,4);
 const entries=[];let offset=6+16*sizes.length;
 sizes.forEach((size,i)=>{const entry=Buffer.alloc(16);entry[0]=size>=256?0:size;entry[1]=size>=256?0:size;entry.writeUInt16LE(1,4);entry.writeUInt16LE(32,6);entry.writeUInt32LE(pngs[i].length,8);entry.writeUInt32LE(offset,12);offset+=pngs[i].length;entries.push(entry);});
 await writeFile(icoPath,Buffer.concat([header,...entries,...pngs]));
}
export async function contextIcons(){for(const name of ['convert','combine'])await svgToIco(`assets/context/${name}.svg`,`assets/context/${name}.ico`,[16,20,24,32,48,64,256]);}

/** 24-bit bottom-up BMP, the format NSIS expects for installer artwork. */
function bmp(canvas){
 const {width,height}=canvas,data=canvas.getContext('2d').getImageData(0,0,width,height).data,row=Math.ceil(width*3/4)*4,size=54+row*height,out=Buffer.alloc(size);
 out.write('BM',0);out.writeUInt32LE(size,2);out.writeUInt32LE(54,10);out.writeUInt32LE(40,14);out.writeInt32LE(width,18);out.writeInt32LE(height,22);out.writeUInt16LE(1,26);out.writeUInt16LE(24,28);out.writeUInt32LE(row*height,34);out.writeInt32LE(2835,38);out.writeInt32LE(2835,42);
 for(let y=0;y<height;y++)for(let x=0;x<width;x++){const s=((height-1-y)*width+x)*4,d=54+y*row+x*3;out[d]=data[s+2];out[d+1]=data[s+1];out[d+2]=data[s];}
 return out;
}
function fonts(){
 const windows=process.env.SystemRoot?`${process.env.SystemRoot}\\Fonts`:'C:\\Windows\\Fonts';
 for(const [file,family] of [['segoeuib.ttf','GCP Bold'],['segoeui.ttf','GCP Regular'],['seguisb.ttf','GCP Semibold']])if(existsSync(`${windows}\\${file}`))GlobalFonts.registerFromPath(`${windows}\\${file}`,family);
 if(existsSync('assets/Inter-Regular.ttf'))GlobalFonts.registerFromPath('assets/Inter-Regular.ttf','GCP Fallback');
}
const face=(weight)=>`"GCP ${weight}", "GCP Fallback", sans-serif`;
function backdrop(ctx,width,height){
 const g=ctx.createLinearGradient(0,0,width,height);g.addColorStop(0,'#8f5cff');g.addColorStop(.5,'#5b27c9');g.addColorStop(1,'#2a0f6b');ctx.fillStyle=g;ctx.fillRect(0,0,width,height);
 const glow=ctx.createRadialGradient(width*.2,height*.08,0,width*.2,height*.08,width*1.1);glow.addColorStop(0,'rgba(255,255,255,.28)');glow.addColorStop(1,'rgba(255,255,255,0)');ctx.fillStyle=glow;ctx.fillRect(0,0,width,height);
 const pink=ctx.createRadialGradient(width*.95,height*.95,0,width*.95,height*.95,width*.9);pink.addColorStop(0,'rgba(255,106,168,.35)');pink.addColorStop(1,'rgba(255,106,168,0)');ctx.fillStyle=pink;ctx.fillRect(0,0,width,height);
 ctx.strokeStyle='rgba(255,255,255,.07)';ctx.lineWidth=1;for(let i=-height;i<width;i+=14){ctx.beginPath();ctx.moveTo(i,height);ctx.lineTo(i+height,0);ctx.stroke();}
}
/** Welcome/finish sidebar (164×314, drawn at 2× and reduced for smooth edges), header (150×57) and installer icon. */
export async function installerArt(){
 fonts();await mkdir('assets/installer',{recursive:true});
 const icon=await loadImage(await readFile('assets/icon.svg'));
 const side=createCanvas(328,628),s=side.getContext('2d');
 backdrop(s,328,628);
 s.shadowColor='rgba(20,5,60,.45)';s.shadowBlur=30;s.shadowOffsetY=12;s.drawImage(icon,84,88,160,160);s.shadowColor='transparent';
 s.textAlign='center';s.fillStyle='#ffffff';s.font=`44px ${face('Bold')}`;s.fillText('GCP / PDF',164,316);
 s.fillStyle='rgba(255,255,255,.85)';s.font=`22px ${face('Regular')}`;s.fillText('Editor de PDF profissional',164,356);s.fillText('100% local · em português',164,386);
 const pill=(y,text)=>{s.font=`19px ${face('Semibold')}`;const w=s.measureText(text).width+36;s.fillStyle='rgba(255,255,255,.14)';s.beginPath();s.roundRect(164-w/2,y-26,w,38,19);s.fill();s.fillStyle='#ffffff';s.fillText(text,164,y);};
 pill(452,'Editar · Converter · Assinar');pill(500,'Formulários · OCR · IA');
 s.fillStyle='rgba(255,255,255,.75)';s.font=`16px ${face('Regular')}`;s.fillText('Desenvolvido por',164,566);s.fillStyle='#ffffff';s.font=`19px ${face('Semibold')}`;s.fillText('Bruno Albertini',164,590);s.fillStyle='rgba(255,255,255,.7)';s.font=`15px ${face('Regular')}`;s.fillText('Gestão Cultural Pro',164,612);
 const sidebar=createCanvas(164,314);sidebar.getContext('2d').drawImage(side,0,0,164,314);
 await writeFile('assets/installer/sidebar.bmp',bmp(sidebar));
 const head2=createCanvas(300,114),h=head2.getContext('2d');
 const hg=h.createLinearGradient(0,0,300,0);hg.addColorStop(0,'#ffffff');hg.addColorStop(1,'#f1eaff');h.fillStyle=hg;h.fillRect(0,0,300,114);
 h.drawImage(icon,196,13,88,88);h.textAlign='right';h.fillStyle='#4c1d95';h.font=`26px ${face('Bold')}`;h.fillText('GCP / PDF',186,58);h.fillStyle='#7c6aa6';h.font=`15px ${face('Regular')}`;h.fillText('Gestão Cultural Pro',186,82);
 const header=createCanvas(150,57);header.getContext('2d').drawImage(head2,0,0,150,57);
 await writeFile('assets/installer/header.bmp',bmp(header));
 await svgToIco('assets/icon.svg','assets/installer/installer.ico',[16,24,32,48,64,128,256],'assets/icon-small.svg');
 // Preview PNGs for review; not packaged.
 await writeFile('assets/installer/sidebar-preview.png',side.toBuffer('image/png'));await writeFile('assets/installer/header-preview.png',head2.toBuffer('image/png'));
}
