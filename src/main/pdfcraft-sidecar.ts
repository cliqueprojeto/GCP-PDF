import { execFile } from 'node:child_process';
import { access, chmod, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { constants } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { PDFDocument } from 'pdf-lib';

type Step = {tool: string; args: Record<string, unknown>};
type ReportStep = {tool: string; status: string; result?: unknown[]; error?: string};
type Report = {ok: boolean; steps: ReportStep[]};
export interface TextParagraph {index: number; text: string; x: number; y: number; width: number; height: number}
const TIMEOUT = 60_000;
function record(value: unknown): value is Record<string, unknown> { return typeof value === 'object' && value !== null && !Array.isArray(value); }
function index(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error(`${label} precisa ser um índice válido, começando em zero.`);
}
function invoke(executable: string, args: string[], cwd: string, timeout = TIMEOUT): Promise<{stdout: string; stderr: string; error: Error | null}> {
  return new Promise(resolve => execFile(executable, args, {cwd, timeout, windowsHide: true, maxBuffer: 16 * 1024 * 1024, encoding: 'utf8'}, (error, stdout, stderr) => resolve({stdout, stderr, error})));
}
export async function privateDirectory(root: string): Promise<void> {
  if (process.platform !== 'win32') { await chmod(root, 0o700); return; }
  // Restrict the newly created, empty workspace before writing PDF or script bytes.
  // EncodedCommand keeps the generated path data, including apostrophes, out of shell syntax.
  const literal = `'${root.replaceAll("'", "''")}'`;
  const script = `$ErrorActionPreference='Stop';$sid=[System.Security.Principal.WindowsIdentity]::GetCurrent().User;$acl=[System.Security.AccessControl.DirectorySecurity]::new();$acl.SetAccessRuleProtection($true,$false);$acl.SetOwner($sid);$inherit=[System.Security.AccessControl.InheritanceFlags]'ContainerInherit,ObjectInherit';$prop=[System.Security.AccessControl.PropagationFlags]::None;$allow=[System.Security.AccessControl.AccessControlType]::Allow;$rights=[System.Security.AccessControl.FileSystemRights]::FullControl;$acl.AddAccessRule([System.Security.AccessControl.FileSystemAccessRule]::new($sid,$rights,$inherit,$prop,$allow));$system=[System.Security.Principal.SecurityIdentifier]::new('S-1-5-18');$acl.AddAccessRule([System.Security.AccessControl.FileSystemAccessRule]::new($system,$rights,$inherit,$prop,$allow));([System.IO.DirectoryInfo]::new(${literal})).SetAccessControl($acl)`;
  const result = await invoke(path.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32/WindowsPowerShell/v1.0/powershell.exe'), ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')], root, 15_000);
  if (result.error) throw new Error('Não foi possível criar uma área privada para editar o documento.', {cause: result.error});
}
async function workspace<T>(bytes: Uint8Array, executable: string, action: (root: string) => Promise<T>): Promise<T> {
  if (!(bytes instanceof Uint8Array) || bytes.length === 0) throw new Error('O arquivo PDF está vazio.');
  if (!path.isAbsolute(executable)) throw new Error('O caminho do motor de edição precisa ser absoluto.');
  try { if (!(await stat(executable)).isFile()) throw new Error('not a file'); await access(executable, process.platform === 'win32' ? constants.F_OK : constants.X_OK); }
  catch (cause) { throw new Error('O motor de edição de texto não está disponível. Reinstale o GCP-PDF.', {cause}); }
  const root = await mkdtemp(path.join(tmpdir(), 'gcp-pdf-edit-'));
  let operationError: unknown;
  try {
    await privateDirectory(root);
    await writeFile(path.join(root, 'input.pdf'), bytes, {flag: 'wx', mode: 0o600});
    return await action(root);
  } catch (cause) { operationError = cause; throw cause; } finally {
    // This literal root is returned by mkdtemp, never supplied by a PDF or caller.
    try { await rm(root, {recursive: true, force: true, maxRetries: 3, retryDelay: 100}); }
    catch (cause) { throw new AggregateError(operationError ? [operationError, cause] : [cause], `Não foi possível limpar a área temporária de edição: ${root}`); }
  }
}
async function script(root: string, executable: string, steps: Step[]): Promise<Report> {
  const file = path.join(root, 'steps.json');
  await writeFile(file, JSON.stringify(steps), {flag: 'wx', mode: 0o600});
  const result = await invoke(executable, ['run', '--script', file, '--root', root, '--report'], root);
  let report: unknown;
  try { report = JSON.parse(result.stdout); }
  catch (cause) {
    const timedOut = result.error && 'killed' in result.error && result.error.killed;
    throw new Error(timedOut ? 'A edição excedeu o prazo de 60 segundos. O documento original foi preservado.' : 'O motor de edição não retornou uma resposta válida. O documento original foi preservado.', {cause: result.error ?? cause});
  }
  if (!record(report) || typeof report.ok !== 'boolean' || !Array.isArray(report.steps)) throw new Error('A resposta do motor de edição é incompatível. Atualize o aplicativo.');
  const parsed = report as unknown as Report;
  if (parsed.steps.length !== steps.length || parsed.steps.some((step, at) => !record(step) || step.tool !== steps[at]?.tool || !['ok', 'error', 'skipped'].includes(step.status))) throw new Error('O relatório do motor de edição está incompleto.');
  const failure = parsed.steps.find(step => step.status === 'error');
  if (result.error || !parsed.ok || parsed.steps.some(step => step.status !== 'ok')) {
    const message = failure?.tool === 'doc_open'
      ? 'Não foi possível abrir este PDF para edição. Verifique se o arquivo está íntegro e não exige senha.'
      : failure?.tool === 'text_paragraphs'
        ? 'Não foi possível localizar o texto desta página. Atualize a visualização e tente novamente.'
        : failure?.tool === 'text_edit'
          ? 'Não foi possível substituir este parágrafo. Atualize a seleção; se o problema continuar, a fonte ou a estrutura do PDF pode ser incompatível.'
          : 'Não foi possível salvar a edição. O documento original foi preservado.';
    throw new Error(message, {cause: new Error(failure?.error ?? result.stderr.trim() ?? 'Falha na CLI PdfCraft')});
  }
  return parsed;
}
function paragraphs(report: Report, page: number): TextParagraph[] {
  const response = report.steps.find(step => step.tool === 'text_paragraphs')?.result?.[0];
  if (!record(response) || response.page !== page + 1 || !Array.isArray(response.paragraphs)) throw new Error('A lista de parágrafos retornada pelo motor é inválida.');
  return response.paragraphs.map(item => {
    if (!record(item) || !Number.isSafeInteger(item.paragraph) || (item.paragraph as number) < 1 || typeof item.text !== 'string' || !Array.isArray(item.rect) || item.rect.length !== 4 || item.rect.some(value => typeof value !== 'number' || !Number.isFinite(value))) throw new Error('Um parágrafo retornou informações de posição inválidas.');
    const [x, y, right, bottom] = item.rect as number[];
    if (right! < x! || bottom! < y!) throw new Error('Um parágrafo retornou limites inválidos.');
    return {index: (item.paragraph as number) - 1, text: typeof item.editor_text === 'string' ? item.editor_text : item.text, x: x!, y: y!, width: right! - x!, height: bottom! - y!};
  });
}
export async function listTextParagraphs(bytes: Uint8Array, page: number, executable: string): Promise<TextParagraph[]> {
  index(page, 'A página');
  return workspace(bytes, executable, async root => {
    // A fresh CLI script session assigns the first opened document id 1, as its contract documents.
    const report = await script(root, executable, [{tool: 'doc_open', args: {path: 'input.pdf'}}, {tool: 'text_paragraphs', args: {doc: 1, page: page + 1}}]);
    return paragraphs(report, page);
  });
}
export async function replaceParagraph(bytes: Uint8Array, input: {page: number; paragraph: number; text: string}, executable: string): Promise<Uint8Array> {
  index(input.page, 'A página'); index(input.paragraph, 'O parágrafo');
  if (typeof input.text !== 'string') throw new Error('O novo texto precisa ser uma sequência válida.');
  return workspace(bytes, executable, async root => {
    const report = await script(root, executable, [
      {tool: 'doc_open', args: {path: 'input.pdf'}},
      {tool: 'text_paragraphs', args: {doc: 1, page: input.page + 1}},
      {tool: 'text_edit', args: {doc: 1, page: input.page + 1, paragraph: input.paragraph + 1, text: input.text}},
      {tool: 'doc_save', args: {doc: 1, path: 'output.pdf', full: true}},
    ]);
    const output = new Uint8Array(await readFile(path.join(root, 'output.pdf')));
    const saved = await PDFDocument.load(output, {updateMetadata: false});
    const opened = report.steps[0]?.result?.[0];
    if (!record(opened) || saved.getPageCount() !== opened.pages) throw new Error('A edição alterou inesperadamente a quantidade de páginas. O original foi preservado.');
    return output;
  });
}


