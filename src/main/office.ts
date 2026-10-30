import {execFile} from 'node:child_process';
import {existsSync} from 'node:fs';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,extname,basename} from 'node:path';
import {privateDirectory} from './pdfcraft-sidecar';

/** Office documents become PDF without LibreOffice: through the installed Microsoft Office (the same
 * engine as its "Save as PDF"), or, without Office, through the built-in Word/Excel readers that the
 * caller renders with Chromium. */
export type HtmlToPdf = (html: string) => Promise<Uint8Array>;
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
const PAGE_CSS = '@page{size:A4;margin:20mm 18mm}body{font-family:Calibri,"Segoe UI",Arial,sans-serif;font-size:11pt;line-height:1.35;color:#111}img{max-width:100%}table{border-collapse:collapse;width:100%;margin:8pt 0}td,th{border:1px solid #999;padding:3pt 5pt;vertical-align:top}h1{font-size:20pt}h2{font-size:16pt}h3{font-size:13pt}p{margin:0 0 6pt}';
async function wordToHtml(path: string) {
 const mammoth = await import('mammoth');
 const result = await mammoth.convertToHtml({path}, {styleMap: ['p[style-name=\'Title\'] => h1:fresh', 'p[style-name=\'Subtitle\'] => h2:fresh']});
 return `<!doctype html><html lang="pt-BR"><meta charset="utf-8"><style>${PAGE_CSS}</style><body>${result.value}</body></html>`;
}
async function excelToHtml(path: string) {
 const ExcelJS = (await import('exceljs')).default, workbook = new ExcelJS.Workbook();
 await workbook.xlsx.readFile(path);
 const sheets = workbook.worksheets.map(sheet => {
  const rows: string[] = [];
  sheet.eachRow({includeEmpty: false}, row => {
   const cells: string[] = [];
   for (let c = 1; c <= Math.max(sheet.columnCount, 1); c++) { const cell = row.getCell(c); const bold = cell.font?.bold ? 'font-weight:700;' : ''; cells.push(`<td style="${bold}${typeof cell.value === 'number' ? 'text-align:right' : ''}">${escape(cell.text ?? '')}</td>`); }
   rows.push(`<tr>${cells.join('')}</tr>`);
  });
  return `<h2>${escape(sheet.name)}</h2><table>${rows.join('')}</table>`;
 });
 return `<!doctype html><html lang="pt-BR"><meta charset="utf-8"><style>${PAGE_CSS}@page{size:A4 landscape}td{font-size:9pt}</style><body>${sheets.join('<div style="page-break-after:always"></div>')}</body></html>`;
}
export async function officeToPdf(path: string, htmlToPdf: HtmlToPdf, libreOffice?: () => Promise<Uint8Array>): Promise<Uint8Array> {
 const app = kind(path);
 if (!app) throw new Error('Formato de documento não reconhecido.');
 if (await officeAvailable(app)) return viaOffice(path, app);
 const extension = extname(path).toLowerCase();
 if (extension === '.docx') return htmlToPdf(await wordToHtml(path));
 if (extension === '.xlsx') return htmlToPdf(await excelToHtml(path));
 if (extension === '.txt') return htmlToPdf(`<!doctype html><meta charset="utf-8"><style>${PAGE_CSS}body{white-space:pre-wrap;font-family:Consolas,monospace;font-size:10pt}</style><body>${escape(await readFile(path, 'utf8'))}</body>`);
 if (libreOffice) return libreOffice();
 throw new Error(app === 'powerpoint' ? 'Para converter apresentações, instale o Microsoft PowerPoint (ou o LibreOffice).' : 'Este formato antigo precisa do Microsoft Office instalado. Arquivos .docx e .xlsx são convertidos mesmo sem ele.');
}
