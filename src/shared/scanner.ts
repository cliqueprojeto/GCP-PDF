export const PAPER_SIZES = {
  A4: [210, 297], A3: [297, 420], A5: [148, 210], Carta: [215.9, 279.4], Ofício: [215.9, 355.6],
} as const;
export type PaperSize = keyof typeof PAPER_SIZES;
export interface BlankOptions { paper: PaperSize; landscape: boolean; pages: number }
export interface ScannerDevice { id: string; name: string }
export interface ScannerCapabilities { sources: string[]; nativeUi: boolean; description: string }
export interface ScanOptions { device: string; source: string; dpi: number; color: 'color'|'gray'|'bw'; paper: PaperSize; nativeUi: boolean; ocr: boolean }
export interface ScanPage { id: string; preview: string; ocr: boolean; warning?: string }
export interface ScanSelection { id: string; rotation: number }
export function blankOptions(raw: unknown): BlankOptions {
  if (raw === undefined) return {paper:'A4',landscape:false,pages:1};
  const v = raw as BlankOptions;
  if (!v || !Object.hasOwn(PAPER_SIZES,v.paper) || typeof v.landscape !== 'boolean' || !Number.isInteger(v.pages) || v.pages < 1 || v.pages > 500) throw new Error('Escolha um papel e de 1 a 500 páginas.');
  return {paper:v.paper,landscape:v.landscape,pages:v.pages};
}
export function scanOptions(raw: unknown): ScanOptions {
  const v=raw as ScanOptions;
  if (!v || typeof v.device!=='string' || !v.device || typeof v.source!=='string' || ![75,150,200,300,600].includes(v.dpi) || !['color','gray','bw'].includes(v.color) || !Object.hasOwn(PAPER_SIZES,v.paper) || typeof v.nativeUi!=='boolean' || typeof v.ocr!=='boolean') throw new Error('Parâmetros de digitalização inválidos.');
  return {device:v.device,source:v.source,dpi:v.dpi,color:v.color,paper:v.paper,nativeUi:v.nativeUi,ocr:v.ocr};
}
