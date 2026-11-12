/** What the user reads when something fails. The app's own messages are Portuguese sentences; a message
 * that comes from a library or the system (pdf-lib, PDF.js, Node) is technical English and is replaced
 * by a plain explanation. The original stays with the caller for the log. */
const SYSTEM: [RegExp, string][] = [
 [/\bENOENT\b|no such file/i, 'O arquivo não foi encontrado. Ele pode ter sido movido, renomeado ou excluído.'],
 [/\bEACCES\b|\bEPERM\b|permission denied|operation not permitted/i, 'Sem permissão para acessar este arquivo ou pasta.'],
 [/\bEBUSY\b|resource busy|being used by another process/i, 'O arquivo está aberto em outro programa. Feche-o e tente de novo.'],
 [/\bENOSPC\b|no space left/i, 'Não há espaço livre suficiente no disco.'],
 [/password|encrypted/i, 'Este PDF está protegido por senha ou criptografia que não foi possível abrir.'],
];
const TECHNICAL = /\b(expected|instance|undefined|null|cannot|can't|failed|invalid|unexpected|is not|not a function|exception|unable|unknown|missing|out of memory|timeout|timed out|reading|properties)\b|\bE[A-Z]{3,}\b/i;
const PORTUGUESE = /[ãõçáéíóúâêôà]|\b(não|arquivo|página|documento|está|foi|para|com|uma?|do|da|dos|das|ao|seu|sua)\b/i;
export const GENERIC_ERROR = 'Não foi possível concluir esta ação com o arquivo. Ele pode estar danificado ou usar um recurso que o GCP-PDF ainda não reconhece.';

export function userMessage(message: string): string {
 const text = message.trim();
 if (!text) return GENERIC_ERROR;
 if (PORTUGUESE.test(text)) return text;
 for (const [pattern, replacement] of SYSTEM) if (pattern.test(text)) return replacement;
 return TECHNICAL.test(text) ? GENERIC_ERROR : text;
}
