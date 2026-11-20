import {execFile} from 'node:child_process';
import {existsSync} from 'node:fs';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,extname,basename} from 'node:path';
import {privateDirectory} from './pdfcraft-sidecar';

/** Renders HTML with Chromium; header and footer templates are printed in the page margins. */
export interface HtmlPdfOptions { headerTemplate?: string; footerTemplate?: string }
export type HtmlToPdf = (html: string, options?: HtmlPdfOptions) => Promise<Uint8Array>;
const WORD = ['.docx', '.doc', '.rtf', '.odt', '.txt'], EXCEL = ['.xlsx', '.xls', '.ods'], POWERPOINT = ['.pptx', '.ppt', '.odp'];
// AutomationSecurity=3 (msoAutomationSecurityForceDisable): automation would otherwise run document
// macros; they stay off for every file, and links are never refreshed (Excel UpdateLinks=0).
const SCRIPTS: Record<string, string> = {
 word: "$a=New-Object -ComObject Word.Application;$a.AutomationSecurity=3;$a.Visible=$false;$a.DisplayAlerts=0;try{$d=$a.Documents.Open($env:GCP_IN,$false,$true,$false);$d.ExportAsFixedFormat($env:GCP_OUT,17);$d.Close(0)}finally{$a.Quit();[void][Runtime.InteropServices.Marshal]::ReleaseComObject($a)}",
 excel: "$a=New-Object -ComObject Excel.Application;$a.AutomationSecurity=3;$a.Visible=$false;$a.DisplayAlerts=$false;try{$w=$a.Workbooks.Open($env:GCP_IN,0,$true);$w.ExportAsFixedFormat(0,$env:GCP_OUT);$w.Close($false)}finally{$a.Quit();[void][Runtime.InteropServices.Marshal]::ReleaseComObject($a)}",
 powerpoint: "$a=New-Object -ComObject PowerPoint.Application;$a.AutomationSecurity=3;try{$p=$a.Presentations.Open($env:GCP_IN,-1,0,0);$p.SaveAs($env:GCP_OUT,32);$p.Close()}finally{$a.Quit();[void][Runtime.InteropServices.Marshal]::ReleaseComObject($a)}",
};
const PROGIDS: Record<string, string> = {word: 'Word.Application', excel: 'Excel.Application', powerpoint: 'PowerPoint.Application'};
function kind(path: string) { const e = extname(path).toLowerCase(); return WORD.includes(e) ? 'word' : EXCEL.includes(e) ? 'excel' : POWERPOINT.includes(e) ? 'powerpoint' : null; }
function run(file: string, args: string[], env: NodeJS.ProcessEnv, timeout: number) {
 return new Promise<{error: Error | null; stderr: string}>(resolve => execFile(file, args, {env, timeout, windowsHide: true, maxBuffer: 4 * 1024 * 1024}, (error, _out, stderr) => resolve({error, stderr: String(stderr)})));
}
const powershell = () => join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
/** Whether the Office application for this file is registered on this computer. */
async function officeAvailable(app: string) {
 if (process.platform !== 'win32') return false;
 const result = await run(join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'reg.exe'), ['query', `HKCR\\${PROGIDS[app]}\\CLSID`], process.env, 10_000);
 return !result.error;
}
async function viaOffice(path: string, app: string): Promise<Uint8Array> {
 const folder = await mkdtemp(join(tmpdir(), 'gcp-pdf-office-'));
 try {
  await privateDirectory(folder);
  const out = join(folder, basename(path, extname(path)) + '.pdf');
  // Paths travel in environment variables, never inside the script text.
  const result = await run(powershell(), ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', Buffer.from(SCRIPTS[app]!, 'utf16le').toString('base64')], {...process.env, GCP_IN: path, GCP_OUT: out}, 180_000);
  if (!existsSync(out)) throw new Error(result.error && 'killed' in result.error && result.error.killed ? 'O Microsoft Office demorou demais para converter o arquivo.' : 'O Microsoft Office não conseguiu converter este arquivo. Verifique se ele abre normalmente e não está protegido.');
  return new Uint8Array(await readFile(out));
 } finally { await rm(folder, {recursive: true, force: true}).catch(() => {}); }
}
const escape = (text: string) => text.replace(/[&<>"]/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;'}[c]!));
const PAGE_CSS = '@page{size:A4;margin:20mm 18mm}body{font-family:Calibri,Carlito,"Segoe UI",Arial,sans-serif;font-size:11pt;line-height:1.35;color:#111}';
/** Word through the built-in layout engine (see docx-html.ts): page geometry, fonts, spacing, tables,
 * pictures, headers and footers come from the document itself. */
async function wordToPdf(path: string, htmlToPdf: HtmlToPdf) {
 const {docxToHtml} = await import('./docx-html');
 const result = docxToHtml(new Uint8Array(await readFile(path)));
 return htmlToPdf(result.html, {headerTemplate: result.headerTemplate, footerTemplate: result.footerTemplate});
}
async function excelToPdf(path: string, htmlToPdf: HtmlToPdf) {
 const {xlsxToHtml} = await import('./xlsx-html');
 return htmlToPdf(await xlsxToHtml(new Uint8Array(await readFile(path))));
}
/** Office documents keep their original look: Microsoft Office when installed (Windows), otherwise
 * LibreOffice when installed (every system), otherwise the built-in Word, Excel and PowerPoint layout engines.
 * The PDF always carries real, selectable text. */
/** Plain text in UTF-8 (with or without BOM), UTF-16 with BOM, or the Windows ANSI code page (Windows-1252),
 * still common for .txt files saved on Brazilian computers. */
export function decodeText(bytes: Uint8Array): string {
 if (bytes[0] === 0xff && bytes[1] === 0xfe) return new TextDecoder('utf-16le').decode(bytes.subarray(2));
 if (bytes[0] === 0xfe && bytes[1] === 0xff) return new TextDecoder('utf-16be').decode(bytes.subarray(2));
 try { return new TextDecoder('utf-8', {fatal: true}).decode(bytes).replace(/^\uFEFF/, ''); }
 catch { return new TextDecoder('windows-1252').decode(bytes); }
}
async function presentationToPdf(path: string, htmlToPdf: HtmlToPdf) {
 const {pptxToHtml} = await import('./pptx-html');
 return htmlToPdf(pptxToHtml(new Uint8Array(await readFile(path))));
}
export async function officeToPdf(path: string, htmlToPdf: HtmlToPdf, libreOffice?: () => Promise<Uint8Array | null>): Promise<Uint8Array> {
 const app = kind(path);
 if (!app) throw new Error('Formato de documento não reconhecido.');
 const extension = extname(path).toLowerCase();
 const internal = extension === '.docx' || extension === '.xlsx' || extension === '.pptx';
 // When Microsoft Office is installed but fails, its message is kept: it explains the problem better than
 // "install Office" would.
 let officeError: unknown;
 if (await officeAvailable(app)) {
  try { return await viaOffice(path, app); }
  catch (error) { officeError = error; }
 }
 if (extension === '.txt') return htmlToPdf(`<!doctype html><meta charset="utf-8"><style>${PAGE_CSS}body{white-space:pre-wrap;font-family:Consolas,"Liberation Mono",monospace;font-size:10pt}</style><body>${escape(decodeText(new Uint8Array(await readFile(path))))}</body>`);
 if (libreOffice) {
  try { const bytes = await libreOffice(); if (bytes) return bytes; }
  catch (error) { if (!internal) throw officeError ?? error; }
 }
 if (extension === '.docx') return wordToPdf(path, htmlToPdf);
 if (extension === '.xlsx') return excelToPdf(path, htmlToPdf);
 if (extension === '.pptx') return presentationToPdf(path, htmlToPdf);
 if (officeError) throw officeError;
 throw new Error('Este formato antigo precisa do Microsoft Office ou do LibreOffice instalado. Arquivos .docx, .xlsx e .pptx são convertidos mesmo sem eles.');
}
