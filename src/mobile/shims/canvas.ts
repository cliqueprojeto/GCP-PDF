import {Buffer} from 'buffer';

/** @napi-rs/canvas on Chromium's own canvas: the same Skia raster the desktop engine draws with. */
type Mime = 'image/png' | 'image/jpeg' | 'image/webp';
export interface Canvas extends HTMLCanvasElement {
  toBuffer(mime?: Mime | 'raw', quality?: number): Buffer;
  encode(format: 'png' | 'jpeg' | 'webp', quality?: number): Promise<Buffer>;
}
function decodeDataUrl(url: string): Buffer { return Buffer.from(url.slice(url.indexOf(',') + 1), 'base64'); }
export function createCanvas(width: number, height: number): Canvas {
  const canvas = document.createElement('canvas') as Canvas;
  canvas.width = Math.max(1, Math.floor(width)); canvas.height = Math.max(1, Math.floor(height));
  const getContext = canvas.getContext.bind(canvas) as HTMLCanvasElement['getContext'];
  // Pixels are read back often (OCR measures, image crops): ask for a CPU-backed canvas.
  canvas.getContext = ((type: string, options?: CanvasRenderingContext2DSettings) => getContext(type as '2d', type === '2d' ? {willReadFrequently: true, ...options} : options)) as HTMLCanvasElement['getContext'];
  canvas.toBuffer = (mime: Mime | 'raw' = 'image/png', quality?: number) => {
    if (mime === 'raw') { const c = canvas.getContext('2d')!; return Buffer.from(c.getImageData(0, 0, canvas.width, canvas.height).data.buffer); }
    return decodeDataUrl(canvas.toDataURL(mime, quality === undefined ? undefined : quality > 1 ? quality / 100 : quality));
  };
  canvas.encode = async (format, quality) => canvas.toBuffer(`image/${format}` as Mime, quality);
  return canvas;
}
export async function loadImage(source: string | Uint8Array | ArrayBuffer | URL): Promise<HTMLImageElement> {
  const image = new Image();
  let url: string, revoke = false;
  if (typeof source === 'string' || source instanceof URL) url = String(source);
  else { url = URL.createObjectURL(new Blob([source instanceof ArrayBuffer ? source : new Uint8Array(source)])); revoke = true; }
  try {
    image.decoding = 'async'; image.src = url;
    await image.decode();
    return image;
  } catch { throw new Error('Imagem inválida ou em formato não suportado.'); }
  finally { if (revoke) URL.revokeObjectURL(url); }
}
export const Image_ = Image;
export const GlobalFonts = {
  registerFromPath() { return true; },
  register() { return true; },
  has(name: string) { return document.fonts.check(`12px "${name}"`); },
  get families() { return []; },
};
const DOMMatrix_ = globalThis.DOMMatrix, ImageData_ = globalThis.ImageData, Path2D_ = globalThis.Path2D;
export {DOMMatrix_ as DOMMatrix, ImageData_ as ImageData, Path2D_ as Path2D};
export default {createCanvas, loadImage, GlobalFonts, DOMMatrix: DOMMatrix_, ImageData: ImageData_, Path2D: Path2D_};
