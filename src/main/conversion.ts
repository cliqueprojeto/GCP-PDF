import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createCanvas, DOMMatrix, ImageData, Path2D } from '@napi-rs/canvas';
import { PDFDocument } from 'pdf-lib';
import { Document, Packer, Paragraph, TextRun, ImageRun, FrameAnchorType, FrameWrap, HeightRule, HorizontalPositionRelativeFrom, VerticalPositionRelativeFrom, TextWrappingType, SectionType, type ISectionOptions } from 'docx';
import ExcelJS from 'exceljs';
import { pageGrid, type PageGrid } from './tables';
import PptxGenJS from 'pptxgenjs';
import type { ExportOptions } from '../shared/types';
import { toDocxLayout, toPptxLayout } from './word-layout';
import type { PDFDocumentProxy, PDFPageProxy } from 'pdfjs-dist/types/src/display/api';

const localRequire = createRequire(typeof __filename === 'string' ? __filename : pathToFileURL(resolve('package.json')));
let pdfjsPromise: Promise<typeof import('pdfjs-dist/legacy/build/pdf.mjs')> | undefined;
export async function pdfjs() {
  // PDF.js' Node renderer needs these canvas primitives before module evaluation.
  Object.assign(globalThis, { DOMMatrix, ImageData, Path2D });
  return pdfjsPromise ??= import('pdfjs-dist/legacy/build/pdf.mjs');
}
class NodeCanvasFactory {
  create(width:number, height:number) {
    const canvas = createCanvas(Math.ceil(width), Math.ceil(height));
    return {canvas,context:canvas.getContext('2d')};
  }
  reset(target:ReturnType<NodeCanvasFactory['create']>,width:number,height:number) { target.canvas.width=Math.ceil(width); target.canvas.height=Math.ceil(height); }
  destroy(target:ReturnType<NodeCanvasFactory['create']>) { target.canvas.width=1; target.canvas.height=1; }
}
export async function loadPdf(bytes:Uint8Array) {
  if (!(bytes instanceof Uint8Array) || bytes.byteLength===0) throw new Error('O PDF está vazio ou não pôde ser lido.');
  const engine=await pdfjs();
  const root=dirname(localRequire.resolve('pdfjs-dist/package.json'));
  const task=engine.getDocument({data:new Uint8Array(bytes),useSystemFonts:true,disableFontFace:true,fontExtraProperties:true,
      standardFontDataUrl:join(root,'standard_fonts')+'/',
      cMapUrl:join(root,'cmaps')+'/',cMapPacked:true,
      wasmUrl:join(root,'wasm')+'/',CanvasFactory:NodeCanvasFactory as never});
  try { return await task.promise;
  } catch (error) {
    await task.destroy();
    throw new Error(`Não foi possível abrir o PDF para exportação: ${error instanceof Error?error.message:String(error)}`);
  }
}
interface Run {text:string;x:number;y:number;width:number;height:number;fontSize:number;font:string;bold:boolean;italic:boolean;angle:number}
interface Line {runs:Run[];x:number;y:number;width:number;height:number;fontSize:number;text:string}
interface PageImage {bytes:Buffer;x:number;y:number;width:number;height:number}
interface PageData {page:PDFPageProxy;width:number;height:number;lines:Line[];images:PageImage[];hasVectors:boolean;warnings:string[]}
function cleanFont(value:string) {
  const font=value.replace(/^[A-Z]{6}\+/,'').replace(/[-,](BoldItalic|BoldOblique|Regular|Italic|Oblique|Bold|Roman|MT).*$/i,'').replace(/PSMT$/,'');
  return /serif/i.test(font)&&!/sans/i.test(font)?'Times New Roman':/sans|helvetica|arial|inter/i.test(font)?'Arial':/mono|courier/i.test(font)?'Courier New':font||'Arial';
}
function joinRuns(runs:Run[]) {
  let text=''; let previous:Run|undefined;
  for(const run of runs) {if(previous && run.x-(previous.x+previous.width)>Math.max(1,run.fontSize*.17) && !/\s$/.test(text)&&!/^\s/.test(run.text)) text+=' ';text+=run.text;previous=run;}
  return text;
}
function groupLines(runs:Run[]):Line[] {
  const rows:Run[][]=[];
  for(const run of runs.sort((a,b)=>a.y-b.y||a.x-b.x)) {
    const row=rows.find(r=>Math.abs(r[0].y-run.y)<=Math.max(2,Math.min(r[0].fontSize,run.fontSize)*.28));
    if(row) row.push(run);else rows.push([run]);
  }
  return rows.map(row=>{row.sort((a,b)=>a.x-b.x);const x=Math.min(...row.map(r=>r.x)),y=Math.min(...row.map(r=>r.y));return {runs:row,x,y,width:Math.max(...row.map(r=>r.x+r.width))-x,height:Math.max(...row.map(r=>r.height)),fontSize:Math.max(...row.map(r=>r.fontSize)),text:joinRuns(row)};}).sort((a,b)=>a.y-b.y||a.x-b.x);
}
export async function inspectPage(page:PDFPageProxy,includeImages:boolean):Promise<PageData> {
  const engine=await pdfjs(),viewport=page.getViewport({scale:1});
  // Loading the display list also resolves the original font metadata.
  const operators=includeImages?await page.getOperatorList():undefined;
  const content=await page.getTextContent();
  const runs:Run[]=[];
  for(const item of content.items) {
    if(!('str' in item)||!item.str.trim()) continue;
    const t=engine.Util.transform(viewport.transform,item.transform),style=content.styles[item.fontName];
    let rawFont=style?.fontFamily||'Arial',isBold=false,isItalic=false;
    try {const font=page.commonObjs.get(item.fontName) as {name?:string;bold?:boolean;black?:boolean;italic?:boolean;systemFontInfo?:{baseFontName?:string};cssFontInfo?:{fontFamily?:string}};rawFont=font?.name||font?.systemFontInfo?.baseFontName||font?.cssFontInfo?.fontFamily||rawFont;isBold=Boolean(font?.bold||font?.black);isItalic=Boolean(font?.italic);}catch{}
    const fontSize=Math.max(1,Math.hypot(t[2],t[3])),ascent=style?.ascent??.85;
    const x=t[4],y=t[5]-fontSize*ascent;
    if([x,y,fontSize,item.width].every(Number.isFinite)) runs.push({text:item.str,x,y,width:Math.max(item.width,1),height:fontSize*1.25,fontSize,font:cleanFont(rawFont),bold:isBold||/bold|black|semibold|demi/i.test(rawFont),italic:isItalic||/italic|oblique/i.test(rawFont),angle:Math.atan2(t[1],t[0])*180/Math.PI});
  }
  const result:PageData={page,width:viewport.width,height:viewport.height,lines:groupLines(runs),images:[],hasVectors:false,warnings:[]};
  if(!includeImages)return result;
  try {
    if(!operators)return result;
    let matrix=[1,0,0,1,0,0];const stack:number[][]=[];
    const OPS=engine.OPS;
    for(let i=0;i<operators.fnArray.length;i++) {
      const fn=operators.fnArray[i],args=operators.argsArray[i] as unknown[];
      if(fn===OPS.save){stack.push([...matrix]);continue;}
      if(fn===OPS.restore){matrix=stack.pop()??[1,0,0,1,0,0];continue;}
      if(fn===OPS.transform){matrix=engine.Util.transform(matrix,args as number[]);continue;}
      if(fn===OPS.constructPath){result.hasVectors=true;continue;}
      if(fn===OPS.paintImageMaskXObject||fn===OPS.paintImageXObjectRepeat||fn===OPS.paintImageMaskXObjectRepeat){result.warnings.push('Máscaras ou imagens repetidas podem precisar do modo de fidelidade visual.');continue;}
      if(fn!==OPS.paintImageXObject&&fn!==OPS.paintInlineImageXObject)continue;
      let image:any;
      if(fn===OPS.paintInlineImageXObject)image=args[0];
      else {
        const id=String(args[0]);
        image=await new Promise<any>((resolveImage)=>{const store=id.startsWith('g_')?page.commonObjs:page.objs;try{store.get(id,resolveImage);}catch{resolveImage(null);}});
      }
      if(!image?.width||!image.height)continue;
      const source=createCanvas(image.width,image.height),sourceContext=source.getContext('2d');
      if(image.bitmap) sourceContext.drawImage(image.bitmap,0,0);
      else if(image.data) {
        const rgba=new Uint8ClampedArray(image.width*image.height*4),input=image.data as Uint8Array;
        if(input.length===rgba.length)rgba.set(input);
        else if(input.length===image.width*image.height*3)for(let p=0,q=0;p<input.length;p+=3,q+=4){rgba[q]=input[p];rgba[q+1]=input[p+1];rgba[q+2]=input[p+2];rgba[q+3]=255;}
        else {result.warnings.push('Uma imagem com codificação especial não pôde ser reconstruída no modo editável.');continue;}
        sourceContext.putImageData(new ImageData(rgba,image.width,image.height),0,0);
      } else continue;
      const t=engine.Util.transform(viewport.transform,matrix),points=[[t[4],t[5]],[t[4]+t[0],t[5]+t[1]],[t[4]+t[2],t[5]+t[3]],[t[4]+t[0]+t[2],t[5]+t[1]+t[3]]];
      const x=Math.min(...points.map(p=>p[0])),y=Math.min(...points.map(p=>p[1])),width=Math.max(...points.map(p=>p[0]))-x,height=Math.max(...points.map(p=>p[1]))-y;
      if(width<=0||height<=0||width*height>40_000_000)continue;
      const target=createCanvas(Math.max(1,Math.ceil(width*2)),Math.max(1,Math.ceil(height*2))),context=target.getContext('2d');
      context.setTransform(2*t[0]/image.width,2*t[1]/image.width,-2*t[2]/image.height,-2*t[3]/image.height,2*(t[4]+t[2]-x),2*(t[5]+t[3]-y));context.drawImage(source,0,0);
      result.images.push({bytes:target.toBuffer('image/png'),x,y,width,height});
    }
  } catch(error) {result.warnings.push(`Imagens não puderam ser totalmente extraídas: ${error instanceof Error?error.message:String(error)}`);}
  return result;
}
async function renderPage(page:PDFPageProxy,dpi:number,warnings:string[]) {
  const requested=page.getViewport({scale:dpi/72});
  const reduction=Math.min(1,Math.sqrt(40_000_000/(requested.width*requested.height)));
  if(reduction<1)warnings.push('Uma página muito grande teve a resolução ajustada para caber na memória de renderização.');
  const viewport=page.getViewport({scale:dpi/72*reduction});
  const canvas=createCanvas(Math.max(1,Math.ceil(viewport.width)),Math.max(1,Math.ceil(viewport.height)));
  await page.render({canvas:canvas as never,canvasContext:canvas.getContext('2d') as never,viewport,background:'white'}).promise;
  return canvas.toBuffer('image/png');
}
function progress(callback:((message:string)=>void)|undefined,page:number,total:number) {callback?.(`Convertendo página ${page} de ${total}…`);}
function uniqueWarnings(warnings:string[]){return [...new Set(warnings)];}
function validateOptions(options:ExportOptions) {
  const formats=['pdf','image-pdf','png','txt','docx','xlsx','pptx'];
  if(!options||!formats.includes(options.format))throw new Error('Formato de exportação não reconhecido.');
  if(options.mode!==undefined&&!['editable','fidelity'].includes(options.mode))throw new Error('Modo de exportação não reconhecido.');
  if(options.dpi!==undefined&&(!Number.isFinite(options.dpi)||options.dpi<72||options.dpi>600))throw new Error('Escolha uma resolução entre 72 e 600 DPI.');
}
export async function extractDocumentText(bytes:Uint8Array):Promise<string> {
  const pdf=await loadPdf(bytes);
  try {const pages:string[]=[];for(let i=1;i<=pdf.numPages;i++){const data=await inspectPage(await pdf.getPage(i),false);pages.push(`[Página ${i}]\n${data.lines.map(l=>l.text).join('\n')}`);}return pages.join('\n\n');}finally{await pdf.loadingTask.destroy();}
}
export async function convertPdf(bytes:Uint8Array,options:ExportOptions,onProgress?:(message:string)=>void):Promise<{bytes:Uint8Array;extension:string;warnings:string[]}> {
  validateOptions(options);
  if(options.format==='pdf')return {bytes:new Uint8Array(bytes),extension:'pdf',warnings:[]};
  const pdf=await loadPdf(bytes),warnings:string[]=[],dpi=options.dpi??(options.format==='image-pdf'?300:150);
  try {
    if(options.format==='txt') {
      const pages:string[]=[];for(let i=1;i<=pdf.numPages;i++){progress(onProgress,i,pdf.numPages);const data=await inspectPage(await pdf.getPage(i),false);pages.push(data.lines.map(l=>l.text).join('\n'));if(!data.lines.length)warnings.push(`A página ${i} não tem texto extraível; execute OCR para obter texto.`);}
      return {bytes:Buffer.from(pages.join('\n\f\n'),'utf8'),extension:'txt',warnings:uniqueWarnings(warnings)};
    }
    if(options.format==='png') {
      if(pdf.numPages>1)warnings.push('A exportação PNG contém somente a primeira página. Para todas as páginas em um arquivo, use PDF baseado em imagem.');
      return {bytes:await renderPage(await pdf.getPage(1),dpi,warnings),extension:'png',warnings};
    }
    if(options.format==='image-pdf') {
      const output=await PDFDocument.create();output.setProducer('GCP-PDF');output.setCreator('GCP-PDF — Gestão Cultural Pro');
      for(let i=1;i<=pdf.numPages;i++){progress(onProgress,i,pdf.numPages);const page=await pdf.getPage(i),viewport=page.getViewport({scale:1}),png=await output.embedPng(await renderPage(page,dpi,warnings));output.addPage([viewport.width,viewport.height]).drawImage(png,{x:0,y:0,width:viewport.width,height:viewport.height});}
      warnings.push('O PDF contém apenas imagens das páginas; ele não mantém texto pesquisável, formulários ou assinaturas criptográficas. Uma imagem ainda pode ser alterada por outros programas.');
      return {bytes:await output.save(),extension:'pdf',warnings:uniqueWarnings(warnings)};
    }
    if(options.format==='docx'&&options.mode!=='fidelity')return await toDocxLayout(bytes,options.dpi??150,warnings,onProgress);
    if(options.format==='docx')return await toDocx(pdf,options,dpi,warnings,onProgress);
    if(options.format==='xlsx')return await toXlsx(pdf,dpi,warnings,onProgress);
    if(options.mode!=='fidelity')return await toPptxLayout(bytes,options.dpi??150,warnings,onProgress);
    return await toPptx(pdf,options,dpi,warnings,onProgress);
  }finally{await pdf.loadingTask.destroy();}
}
function imageParagraph(image:PageImage) {
  return new Paragraph({spacing:{before:0,after:0},children:[new ImageRun({type:'png',data:image.bytes,transformation:{width:image.width*96/72,height:image.height*96/72},floating:{horizontalPosition:{relative:HorizontalPositionRelativeFrom.PAGE,offset:Math.round(image.x*12700)},verticalPosition:{relative:VerticalPositionRelativeFrom.PAGE,offset:Math.round(image.y*12700)},allowOverlap:true,lockAnchor:true,wrap:{type:TextWrappingType.NONE}}})]});
}
async function toDocx(pdf:PDFDocumentProxy,options:ExportOptions,dpi:number,warnings:string[],onProgress?:((message:string)=>void)) {
  const sections:ISectionOptions[]=[];
  for(let i=1;i<=pdf.numPages;i++) {
    progress(onProgress,i,pdf.numPages);const data=await inspectPage(await pdf.getPage(i),options.mode!=='fidelity'),children:Paragraph[]=[];
    warnings.push(...data.warnings);
    if(options.mode==='fidelity'||!data.lines.length) {
      if(options.mode!=='fidelity'&&!data.lines.length)warnings.push(`A página ${i} não tem texto extraível e foi preservada como imagem. Execute OCR para gerar texto editável.`);
      children.push(imageParagraph({bytes:await renderPage(data.page,dpi,warnings),x:0,y:0,width:data.width,height:data.height}));
    } else {
      for(const image of data.images)children.push(imageParagraph(image));
      for(const line of data.lines) {
        if(line.runs.some(r=>Math.abs(r.angle)>.5))warnings.push('Textos inclinados ou verticais podem mudar de orientação no Word editável.');
        // Independent columns must not be collapsed into one paragraph with spaces.
        for(const segment of splitLineRuns(line)) {
          const x=segment[0].x,width=Math.max(...segment.map(run=>run.x+run.width))-x,fontSize=Math.max(...segment.map(run=>run.fontSize));
          children.push(new Paragraph({frame:{type:'absolute',position:{x:Math.max(0,Math.round(x*20)),y:Math.max(0,Math.round(line.y*20))},width:Math.max(20,Math.round(Math.min(data.width-x,width+fontSize*1.3)*20)),height:Math.round(line.height*20),anchor:{horizontal:FrameAnchorType.PAGE,vertical:FrameAnchorType.PAGE},rule:HeightRule.ATLEAST,wrap:FrameWrap.NONE,space:{horizontal:0,vertical:0}},spacing:{before:0,after:0,line:Math.round(fontSize*24)},children:segment.map((run,index)=>{const previous=segment[index-1],gap=previous?run.x-(previous.x+previous.width):0;return new TextRun({text:(gap>Math.max(1,run.fontSize*.17)&&!/^\s/.test(run.text)?' ':'')+run.text,font:run.font,size:Math.round(run.fontSize*2),bold:run.bold,italics:run.italic});})}));
        }
      }
      if(data.hasVectors)warnings.push('O Word editável reconstrói texto e imagens; vetores, efeitos, recortes complexos e fontes indisponíveis podem diferir. Use fidelidade visual quando a aparência exata for prioritária.');
    }
    children.push(new Paragraph({spacing:{before:0,after:0,line:1},children:[new TextRun({text:'',size:1})]}));
    sections.push({properties:{type:SectionType.NEXT_PAGE,page:{size:{width:Math.round(data.width*20),height:Math.round(data.height*20)},margin:{top:0,bottom:0,left:0,right:0,header:0,footer:0}}},children});
    data.page.cleanup();
  }
  if(options.mode==='fidelity')warnings.push('O Word em fidelidade visual contém uma imagem de cada página; o conteúdo não é texto editável.');
  else warnings.push('O Word editável conserva posições em quadros de texto; revise quebras de linha e fontes no aplicativo de destino.');
  const document=new Document({creator:'Bruno Albertini | Gestão Cultural Pro',title:'Documento convertido pelo GCP-PDF',description:'Conversão local de PDF',sections,styles:{default:{document:{run:{font:'Arial',language:{value:'pt-BR'}}}}}});
  return {bytes:await Packer.toBuffer(document),extension:'docx',warnings:uniqueWarnings(warnings)};
}
function splitLineRuns(line:Line):Run[][] {
  const segments:Run[][]=[];
  for(const run of line.runs) {const last=segments[segments.length-1],previous=last?.[last.length-1];if(last&&previous&&run.x-(previous.x+previous.width)<=Math.max(8,run.fontSize*1.5))last.push(run);else segments.push([run]);}
  return segments;
}
interface CellData {x:number;right:number;text:string;fontSize:number;bold:boolean;font:string}
function lineCells(line:Line):CellData[] {
  return splitLineRuns(line).map(r=>({x:r[0].x,right:Math.max(...r.map(v=>v.x+v.width)),text:joinRuns(r).trim(),fontSize:Math.max(...r.map(v=>v.fontSize)),bold:r.some(v=>v.bold),font:r[0].font}));
}
function spreadsheetValue(text:string):{value:string|number;format?:string} {
  const trimmed=text.trim(),currency=/^R\$\s*/.test(trimmed),value=trimmed.replace(/^R\$\s*/,'').replace(/\u00a0/g,' ').trim();
  // Keep identifiers such as CEP/CPF and zero-prefixed account numbers as text.
  if(/^0\d/.test(value)||/\d[-/ ]\d/.test(value))return {value:trimmed};
  if(/^-?(?:\d{1,3}(?:\.\d{3})+|\d+)(?:,\d+)?$/.test(value)) {
    const number=Number(value.replace(/\./g,'').replace(',','.'));
    if(Number.isFinite(number)&&Number.isSafeInteger(Math.trunc(number)))return {value:number,format:currency?'"R$" #,##0.00':value.includes(',')?'#,##0.00':undefined};
  }
  if(/^-?\d+\.\d{1,2}$/.test(value)&&!currency)return {value:Number(value),format:'#,##0.00'};
  if(/^-?\d+(?:[.,]\d+)?\s*%$/.test(value)){const n=Number(value.replace(/\s*%$/,'').replace(',','.'));return {value:n/100,format:Number.isInteger(n)?'0%':'0.00%'};}
  return {value:trimmed};
}
/** Excel column width units per point, as desktop converters size them (≈ 4.24 pt per character). */
const PT_PER_CHAR=4.24;
const argb=(hex:string)=>'FF'+hex.replace('#','').toUpperCase();
/** Writes a page grid as a worksheet: one sheet column per grid column, merges, fills, fonts, wrap. */
function gridSheet(sheet:ExcelJS.Worksheet,grid:PageGrid,images:{x:number;y:number;width:number;height:number;id:number}[]) {
  // Rows after the last text or cell fill are page background only: not exported, as in Acrobat.
  const used=grid.regions.filter(r=>r.text||(r.fill&&!r.page)),lastRow=Math.max(0,...used.map(r=>r.row+r.rows)),rows=Math.max(1,lastRow);
  sheet.columns=grid.xs.slice(0,-1).map((x,c)=>({width:Math.max(1,(grid.xs[c+1]!-x)/PT_PER_CHAR)}));
  for(let r=0;r<rows;r++)sheet.getRow(r+1).height=Math.min(409,Math.max(4,grid.ys[r+1]!-grid.ys[r]!));
  for(const region of grid.regions) {
    if(region.row>=rows)continue;
    const cell=sheet.getCell(region.row+1,region.col+1);
    if(region.rows>1||region.cols>1)sheet.mergeCells(region.row+1,region.col+1,region.row+region.rows,region.col+region.cols);
    if(region.fill)cell.fill={type:'pattern',pattern:'solid',fgColor:{argb:argb(region.fill)}};
    if(region.borders){const side=(e?:{color:string;width:number})=>e?{style:(e.width>=2.5?'thick':e.width>=1.4?'medium':'thin') as ExcelJS.BorderStyle,color:{argb:argb(e.color)}}:undefined;cell.border={top:side(region.borders.top),bottom:side(region.borders.bottom),left:side(region.borders.left),right:side(region.borders.right)};}
    const t=region.text;if(!t)continue;
    const parsed=t.text.includes('\n')?{value:t.text}:spreadsheetValue(t.text);
    const mixed=t.parts.length>1&&t.parts.some(p=>p.bold!==t.parts[0]!.bold||p.color!==t.parts[0]!.color||p.italic!==t.parts[0]!.italic);
    cell.value=mixed&&typeof parsed.value==='string'?{richText:t.parts.map(p=>({text:p.text,font:{name:t.font,size:Math.round(p.size*10)/10,bold:p.bold,italic:p.italic,color:{argb:argb(p.color)}}}))}:parsed.value;if(parsed.format)cell.numFmt=parsed.format;
    cell.font={name:t.font,size:Math.round(t.size*10)/10,bold:t.bold,italic:t.italic,color:{argb:argb(t.color)}};
    cell.alignment={horizontal:typeof parsed.value==='number'&&t.align==='left'?'right':t.align,vertical:t.valign==='middle'?'middle':t.valign,wrapText:true};
  }
  // Pictures float over the cells at their place on the page.
  const at=(edges:number[],v:number)=>{let i=0;while(i<edges.length-2&&v>edges[i+1]!)i++;return i+Math.max(0,Math.min(1,(v-edges[i]!)/((edges[i+1]!-edges[i]!)||1)));};
  for(const image of images)sheet.addImage(image.id,{tl:{col:at(grid.xs,image.x),row:at(grid.ys,image.y)} as never,ext:{width:image.width*96/72,height:image.height*96/72}});
}
async function toXlsx(pdf:PDFDocumentProxy,dpi:number,warnings:string[],onProgress?:((message:string)=>void)) {
  const workbook=new ExcelJS.Workbook();workbook.creator='Bruno Albertini | Gestão Cultural Pro';workbook.company='Gestão Cultural Pro';
  let gridPages=0;
  for(let i=1;i<=pdf.numPages;i++) {
    progress(onProgress,i,pdf.numPages);const data=await inspectPage(await pdf.getPage(i),true),sheet=workbook.addWorksheet(`Página ${i}`,{pageSetup:{paperSize:9,orientation:data.width>data.height?'landscape':'portrait',fitToPage:true,fitToWidth:1,fitToHeight:0},properties:{defaultRowHeight:18},views:[{showGridLines:false}]});
    // Pages drawn as tables (filled cells, ruling lines) become real merged cells, like Acrobat's export.
    const grid=await pageGrid(data.page).catch(()=>null);
    if(grid&&grid.regions.some(r=>r.text)) {
      const images=data.images.filter(im=>im.width>8&&im.height>8).map(im=>({x:im.x,y:im.y,width:im.width,height:im.height,id:workbook.addImage({buffer:im.bytes as any,extension:"png"})}));
      gridSheet(sheet,grid,images);gridPages++;data.page.cleanup();continue;
    }
    sheet.views=[{showGridLines:true}];
    const rows=data.lines.map(line=>({line,cells:lineCells(line)})),anchors:number[]=[];
    for(const row of rows)for(const cell of row.cells){if(!anchors.some(x=>Math.abs(x-cell.x)<10))anchors.push(cell.x);}
    anchors.sort((a,b)=>a-b);
    if(!anchors.length) {
      const png=await renderPage(data.page,dpi,warnings),imageId=workbook.addImage({buffer:png as any,extension:'png'});sheet.addImage(imageId,{tl:{col:0,row:0},ext:{width:data.width*96/72,height:data.height*96/72}});
      warnings.push(`A página ${i} não tem texto extraível e foi incluída como imagem na planilha. Execute OCR para obter células editáveis.`);
    } else {
      sheet.columns=anchors.map((x,index)=>({width:Math.max(8,Math.min(80,((anchors[index+1]??data.width-18)-x)/7))}));
      let rowNumber=1,previousBottom=rows[0]?.line.y??0;
      for(const row of rows) {
        const gap=row.line.y-previousBottom;
        if(gap>row.line.fontSize*1.8){sheet.getRow(rowNumber).height=Math.min(90,gap);rowNumber++;}
        const excelRow=sheet.getRow(rowNumber++);excelRow.height=Math.max(14,row.line.height*1.1);
        for(const cell of row.cells) {
          const index=anchors.reduce((best,x,j)=>Math.abs(x-cell.x)<Math.abs(anchors[best]-cell.x)?j:best,0),excelCell=excelRow.getCell(index+1),parsed=spreadsheetValue(cell.text);
          if(excelCell.value){excelCell.value=String(excelCell.value)+' '+cell.text;continue;}
          excelCell.value=parsed.value;excelCell.font={name:cell.font,size:Math.max(8,Math.min(30,cell.fontSize)),bold:cell.bold};excelCell.alignment={vertical:'top',wrapText:true,horizontal:typeof parsed.value==='number'?'right':'left'};if(parsed.format)excelCell.numFmt=parsed.format;
        }
        previousBottom=row.line.y+row.line.height;
      }
    }
    data.page.cleanup();
  }
  if(gridPages<pdf.numPages)warnings.push('Nas páginas sem tabela desenhada, as colunas são inferidas pela posição do texto. Revise textos sobrepostos e páginas digitalizadas.');
  if(gridPages)warnings.push(`${gridPages} página${gridPages>1?'s':''} com tabelas reconstruídas como células reais (mesclagens, cores, larguras e alturas do PDF).`);
  return {bytes:new Uint8Array(await workbook.xlsx.writeBuffer()),extension:'xlsx',warnings:uniqueWarnings(warnings)};
}
async function toPptx(pdf:PDFDocumentProxy,options:ExportOptions,dpi:number,warnings:string[],onProgress?:((message:string)=>void)) {
  const presentation=new PptxGenJS();presentation.author='Bruno Albertini';presentation.company='Gestão Cultural Pro';presentation.subject='Conversão local de PDF';presentation.title='Documento convertido pelo GCP-PDF';
  const dimensions:{width:number;height:number}[]=[];
  for(let i=1;i<=pdf.numPages;i++){const p=await pdf.getPage(i),v=p.getViewport({scale:1});dimensions.push({width:v.width,height:v.height});}
  const width=Math.max(...dimensions.map(d=>d.width)),height=Math.max(...dimensions.map(d=>d.height));presentation.defineLayout({name:'PDF',width:width/72,height:height/72});presentation.layout='PDF';
  if(dimensions.some(d=>d.width!==width||d.height!==height))warnings.push('Páginas de tamanhos diferentes foram centralizadas em slides com o maior tamanho do PDF.');
  for(let i=1;i<=pdf.numPages;i++) {
    progress(onProgress,i,pdf.numPages);const data=await inspectPage(await pdf.getPage(i),options.mode!=='fidelity'),slide=presentation.addSlide(),dx=(width-data.width)/2,dy=(height-data.height)/2;slide.background={color:'FFFFFF'};warnings.push(...data.warnings);
    if(options.mode==='fidelity'||!data.lines.length) {
      slide.addImage({data:'data:image/png;base64,'+(await renderPage(data.page,dpi,warnings)).toString('base64'),x:dx/72,y:dy/72,w:data.width/72,h:data.height/72});
      if(options.mode!=='fidelity')warnings.push(`O slide ${i} não tem texto extraível e foi preservado como imagem; execute OCR para editar seu texto.`);
    } else {
      for(const image of data.images)slide.addImage({data:'data:image/png;base64,'+image.bytes.toString('base64'),x:(image.x+dx)/72,y:(image.y+dy)/72,w:image.width/72,h:image.height/72});
      for(const line of data.lines)for(const run of line.runs)slide.addText(run.text,{x:(run.x+dx)/72,y:(run.y+dy)/72,w:Math.max(.05,(run.width+run.fontSize*.5)/72),h:Math.max(.05,run.height/72),fontFace:run.font,fontSize:run.fontSize,bold:run.bold,italic:run.italic,color:'111111',margin:0,breakLine:false,valign:'top',lang:'pt-BR',paraSpaceAfter:0,rotate:Math.abs(run.angle)>.5?((run.angle%360)+360)%360:0,transparency:0});
      if(data.hasVectors)warnings.push('O PowerPoint editável reconstrói textos e imagens. Elementos vetoriais, efeitos e fontes indisponíveis podem diferir; o modo de fidelidade preserva a aparência como imagem.');
    }
    data.page.cleanup();
  }
  if(options.mode==='fidelity')warnings.push('O PowerPoint em fidelidade visual contém imagens das páginas, sem texto editável.');
  return {bytes:new Uint8Array(await presentation.write({outputType:'nodebuffer'}) as Buffer),extension:'pptx',warnings:uniqueWarnings(warnings)};
}



/** Render one displayed page for local OCR, with its real pixel-to-point scale. */
/** Renders several pages with one document load (printing, previews); reports each finished page. */
export async function renderPdfPages(bytes:Uint8Array,indices:number[],dpi:number,onPage:(done:number,total:number)=>void):Promise<{bytes:Uint8Array;width:number;height:number}[]> {
  validateOptions({format:'png',dpi});
  const pdf=await loadPdf(bytes),out:{bytes:Uint8Array;width:number;height:number}[]=[];
  try {
    for(const [n,index] of indices.entries()){
      if(!Number.isInteger(index)||index<0||index>=pdf.numPages)throw new Error('Uma das páginas escolhidas não existe.');
      const page=await pdf.getPage(index+1),view=page.getViewport({scale:1});
      out.push({bytes:await renderPage(page,dpi,[]),width:view.width,height:view.height});
      page.cleanup();onPage(n+1,indices.length);
    }
    return out;
  }finally{await pdf.loadingTask.destroy();}
}
export async function renderPdfPage(bytes:Uint8Array,pageIndex:number,dpi:number):Promise<{bytes:Uint8Array;width:number;height:number;scale:number}> {
  validateOptions({format:'png',dpi});
  const pdf=await loadPdf(bytes);
  try {
    if(!Number.isInteger(pageIndex)||pageIndex<0||pageIndex>=pdf.numPages)throw new Error('A página selecionada para OCR não existe.');
    const page=await pdf.getPage(pageIndex+1),requested=page.getViewport({scale:dpi/72}),scale=dpi/72*Math.min(1,Math.sqrt(40_000_000/(requested.width*requested.height))),viewport=page.getViewport({scale});
    return {bytes:await renderPage(page,dpi,[]),width:Math.ceil(viewport.width),height:Math.ceil(viewport.height),scale};
  }finally{await pdf.loadingTask.destroy();}
}


