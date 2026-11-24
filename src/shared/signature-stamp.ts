/**
 * The visible stamp of a digital signature (certificate A1/A3/gov.br), laid out once for both the preview on
 * screen and the content written into the PDF, so what the user places is exactly what is signed: one compact
 * column with the signer, date, reason, place, issuing authority and the SHA-256 of the signed document.
 * Sizes are PDF points; `scale` is the small/medium/large choice.
 */
export interface StampInput { name: string; date: Date; reason?: string; location?: string; issuer?: string; hash?: string; image?: boolean; scale?: number }
export interface StampLine { text: string; size: number; bold: boolean; mono: boolean; color: string; y: number; x: number }
export interface StampLayout { width: number; height: number; lines: StampLine[]; image: { x: number; y: number; width: number; height: number } | null; border: string }

const PAD = 4.5, GAP = 1.25;
const two = (n: number) => String(n).padStart(2, '0');
/** dd/mm/aaaa hh:mm (UTC−03:00): the local time with its offset, as Brazilian validators print it. */
export function stampDate(date: Date): string {
  const offset = -date.getTimezoneOffset(), sign = offset >= 0 ? '+' : '-', hours = Math.floor(Math.abs(offset) / 60), minutes = Math.abs(offset) % 60;
  return `${two(date.getDate())}/${two(date.getMonth() + 1)}/${date.getFullYear()} ${two(date.getHours())}:${two(date.getMinutes())} (UTC${sign}${two(hours)}:${two(minutes)})`;
}
/** Certificate names carry the CPF/CNPJ after a colon ("NOME:12345678900"); the stamp shows the name. */
export function signerName(name: string): string { return name.split(':')[0]!.trim() || name; }

export function stampLayout(input: StampInput): StampLayout {
  const k = input.scale ?? 1;
  const rows: Omit<StampLine, 'y' | 'x'>[] = [
    { text: 'Assinado digitalmente por', size: 5.6, bold: false, mono: false, color: '#5b5470' },
    { text: signerName(input.name), size: 8.2, bold: true, mono: false, color: '#111111' },
    { text: `Data: ${stampDate(input.date)}`, size: 6, bold: false, mono: false, color: '#222222' },
    ...(input.reason?.trim() ? [{ text: `Motivo: ${input.reason.trim()}`, size: 6, bold: false, mono: false, color: '#222222' }] : []),
    ...(input.location?.trim() ? [{ text: `Local: ${input.location.trim()}`, size: 6, bold: false, mono: false, color: '#222222' }] : []),
    ...(input.issuer?.trim() ? [{ text: `Emissor: ${input.issuer.trim()}`, size: 5.4, bold: false, mono: false, color: '#5b5470' }] : []),
    { text: 'SHA-256 do PDF antes da assinatura:', size: 5, bold: false, mono: false, color: '#5b5470' },
    { text: input.hash ?? '— calculado ao assinar —', size: 4.6, bold: false, mono: true, color: '#222222' },
    { text: 'Verifique em validar.iti.gov.br', size: 5, bold: false, mono: false, color: '#6d35d5' },
  ];
  const imageWidth = input.image ? 62 * k : 0, textX = PAD * k + (imageWidth ? imageWidth + PAD * k : 0);
  let y = PAD * k;
  const lines = rows.map((row) => { const line = { ...row, size: row.size * k, x: textX, y }; y += row.size * k * GAP; return line; });
  // Width: the longest line (Helvetica ≈ 0.52 em per character, Courier 0.6), at least the hash.
  // The hash always takes its 64 characters, so the preview (hash not yet known) has the final width.
  const textWidth = Math.max(...lines.map((l) => (l.mono ? Math.max(64, l.text.length) : l.text.length) * l.size * (l.mono ? 0.6 : l.bold ? 0.6 : 0.52)));
  const width = Math.ceil(textX + textWidth + PAD * k), height = Math.ceil(y + PAD * k - 1);
  return { width, height, lines, image: imageWidth ? { x: PAD * k, y: PAD * k, width: imageWidth, height: height - 2 * PAD * k } : null, border: '#6d35d5' };
}
