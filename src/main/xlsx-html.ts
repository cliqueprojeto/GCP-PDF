import type ExcelJSType from 'exceljs';

/** An Excel workbook (.xlsx) laid out as print-ready HTML the way Excel prints it: each sheet with its
 * page size, orientation, margins, scaling ("fit to page width"), print area, column widths, row
 * heights, merged cells, fonts, fills, borders, alignment, wrapped and rotated text, number formats,
 * pictures and gridlines only when the sheet asks for them. */

type Workbook = ExcelJSType.Workbook; type Worksheet = ExcelJSType.Worksheet; type Cell = ExcelJSType.Cell;
const escape = (text: string) => text.replace(/[&<>"]/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;'}[c]!));
const pt = (v: number) => `${Math.round(v * 100) / 100}pt`;
/** Paper sizes (points) by Excel's paperSize code. */
const PAPER: Record<number, [number, number]> = {1: [612, 792], 5: [612, 1008], 8: [841.89, 1190.55], 9: [595.28, 841.89], 11: [419.53, 595.28], 13: [515.91, 728.5]};
const INDEXED = ['000000', 'FFFFFF', 'FF0000', '00FF00', '0000FF', 'FFFF00', 'FF00FF', '00FFFF', '000000', 'FFFFFF', 'FF0000', '00FF00', '0000FF', 'FFFF00', 'FF00FF', '00FFFF', '800000', '008000', '000080', '808000', '800080', '008080', 'C0C0C0', '808080', '9999FF', '993366', 'FFFFCC', 'CCFFFF', '660066', 'FF8080', '0066CC', 'CCCCFF', '000080', 'FF00FF', 'FFFF00', '00FFFF', '800080', '800000', '008080', '0000FF', '00CCFF', 'CCFFFF', 'CCFFCC', 'FFFF99', '99CCFF', 'FF99CC', 'CC99FF', 'FFCC99', '3366FF', '33CCCC', '99CC00', 'FFCC00', 'FF9900', 'FF6600', '666699', '969696', '003366', '339966', '003300', '333300', '993300', '993366', '333399', '333333'];
const THEME = ['FFFFFF', '000000', 'E7E6E6', '44546A', '4472C4', 'ED7D31', 'A5A5A5', 'FFC000', '5B9BD5', '70AD47'];
function color(c: Partial<ExcelJSType.Color> & {indexed?: number; tint?: number} | undefined): string | undefined {
 if (!c) return undefined;
 let hex = c.argb ? c.argb.slice(-6) : c.indexed !== undefined ? INDEXED[c.indexed] : c.theme !== undefined ? THEME[c.theme] : undefined;
 if (!hex) return undefined;
 if (c.argb && c.argb.length === 8 && c.argb.slice(0, 2) === '00' && c.argb !== '00000000') { /* fully transparent alpha is ignored by Excel */ }
 const tint = c.tint ?? 0;
 if (tint) { const ch = [0, 2, 4].map(i => parseInt(hex!.slice(i, i + 2), 16)).map(v => tint < 0 ? v * (1 + tint) : v + (255 - v) * tint); hex = ch.map(v => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, '0')).join(''); }
 return '#' + hex.toLowerCase();
}
const BORDER: Record<string, string> = {thin: '.75pt solid', hair: '.5pt solid', dotted: '.75pt dotted', dashDot: '.75pt dashed', dashDotDot: '.75pt dashed', dashed: '.75pt dashed', medium: '1.5pt solid', mediumDashed: '1.5pt dashed', mediumDashDot: '1.5pt dashed', mediumDashDotDot: '1.5pt dashed', slantDashDot: '1.5pt dashed', thick: '2.25pt solid', double: '2.25pt double'};
const border = (b: Partial<ExcelJSType.Border> | undefined) => b?.style ? `${BORDER[b.style] ?? '.75pt solid'} ${color(b.color as never) ?? '#000'}` : undefined;
const BUILTIN: Record<number, string> = {1: '0', 2: '0.00', 3: '#,##0', 4: '#,##0.00', 9: '0%', 10: '0.00%', 11: '0.00E+00', 14: 'dd/mm/yyyy', 15: 'd-mmm-yy', 16: 'd-mmm', 17: 'mmm-yy', 18: 'h:mm AM/PM', 19: 'h:mm:ss AM/PM', 20: 'hh:mm', 21: 'hh:mm:ss', 22: 'dd/mm/yyyy hh:mm', 37: '#,##0 ;(#,##0)', 38: '#,##0 ;[Red](#,##0)', 39: '#,##0.00;(#,##0.00)', 40: '#,##0.00;[Red](#,##0.00)', 44: '_-"R$" * #,##0.00_-;-"R$" * #,##0.00_-;_-"R$" * "-"??_-;_-@_-', 45: 'mm:ss', 46: '[h]:mm:ss', 47: 'mm:ss.0', 48: '##0.0E+0', 49: '@'};
const MONTHS = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
const MONTHS_LONG = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
const WEEKDAYS = ['domingo', 'segunda-feira', 'terça-feira', 'quarta-feira', 'quinta-feira', 'sexta-feira', 'sábado'];

/** A number shown with an Excel number format, in Brazilian notation (comma decimals, dot thousands). */
export function formatValue(value: number | Date, format: string | undefined): {text: string; color?: string} {
 const fmt = (format ?? 'General').trim();
 if (value instanceof Date) return {text: formatDate(value, /[dmyhs]/i.test(fmt) && fmt !== 'General' ? fmt : 'dd/mm/yyyy')};
 if (!fmt || /^general$/i.test(fmt)) return {text: general(value)};
 const sections = splitSections(fmt);
 let section = sections[0]!, v = value;
 if (sections.length > 1 && value < 0) { section = sections[1]!; v = -value; }
 else if (sections.length > 2 && value === 0) section = sections[2]!;
 const colorMatch = /\[(Red|Blue|Green|Black|White|Yellow|Magenta|Cyan|Vermelho|Azul|Verde|Preto)\]/i.exec(section);
 const named: Record<string, string> = {red: '#ff0000', vermelho: '#ff0000', blue: '#0000ff', azul: '#0000ff', green: '#008000', verde: '#008000', black: '#000000', preto: '#000000', white: '#ffffff', yellow: '#ffff00', magenta: '#ff00ff', cyan: '#00ffff'};
 section = section.replace(/\[[^\]]*\]/g, m => /^\[\$/.test(m) ? m.slice(2, -1).split('-')[0]! : '');
 if (/[dmyhs]/i.test(section.replace(/"[^"]*"/g, '')) && !/[0#]/.test(section)) return {text: formatDate(serialToDate(v), section)};
 if (section.trim() === '@') return {text: general(value)};
 const percent = section.includes('%'); if (percent) v *= 100;
 const exp = /E\+/i.test(section);
 // Literal text and padding: quoted text, escaped characters, _x (space of x's width), *x (fill).
 const parts: string[] = []; let pattern = '', i = 0;
 while (i < section.length) {
  const ch = section[i]!;
  if (ch === '"') { const end = section.indexOf('"', i + 1); parts.push(section.slice(i + 1, end < 0 ? undefined : end)); i = end < 0 ? section.length : end + 1; continue; }
  if (ch === '\\') { parts.push(section[i + 1] ?? ''); i += 2; continue; }
  if (ch === '_') { parts.push(' '); i += 2; continue; }
  if (ch === '*') { parts.push(' '); i += 2; continue; }
  if ('0#?,.'.includes(ch) || (ch === 'E' && exp) || ((ch === '+' || ch === '-') && exp && /E$/i.test(pattern))) { if (!pattern) parts.push('\u0000'); pattern += ch; i++; continue; }
  parts.push(ch === '%' ? '%' : ch); i++;
 }
 if (!pattern) return {text: parts.join('').replace('\u0000', ''), color: colorMatch ? named[colorMatch[1]!.toLowerCase()] : undefined};
 let text: string;
 if (exp) { const decimals = (pattern.split('.')[1] ?? '').replace(/E.*/i, '').length; text = v.toExponential(decimals).replace('.', ',').replace(/e([+-])(\d)$/, 'E$10$2').replace('e', 'E'); }
 else {
  const [intPattern, decPattern = ''] = pattern.split('.');
  let scaled = v; let trailingCommas = /,+$/.exec(intPattern!)?.[0].length ?? 0; while (trailingCommas-- > 0) scaled /= 1000;
  const decimals = decPattern.replace(/[^0#?]/g, '').length, minDecimals = decPattern.replace(/[^0]/g, '').length;
  let [whole, frac = ''] = Math.abs(scaled).toFixed(decimals).split('.');
  frac = frac.replace(/0+$/, ''); if (frac.length < minDecimals) frac = frac.padEnd(minDecimals, '0');
  const minInt = intPattern!.replace(/[^0]/g, '').length; if (whole === '0' && minInt === 0) whole = ''; whole = whole!.padStart(minInt, '0');
  if (/0,0|#,#|#,0/.test(intPattern!)) whole = whole.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  text = (scaled < 0 && sections.length < 2 ? '-' : '') + whole + (frac || decPattern.includes('0') ? ',' + frac : '');
 }
 return {text: parts.join('').replace('\u0000', text).replace(/^\s+$/, ''), color: colorMatch ? named[colorMatch[1]!.toLowerCase()] : undefined};
}
function splitSections(fmt: string) { const out: string[] = []; let cur = '', quoted = false; for (const ch of fmt) { if (ch === '"') quoted = !quoted; if (ch === ';' && !quoted) { out.push(cur); cur = ''; } else cur += ch; } out.push(cur); return out; }
function general(v: number) {
 if (Number.isInteger(v) && Math.abs(v) < 1e11) return String(v);
 const s = Math.abs(v) >= 1e11 || (Math.abs(v) < 1e-9 && v !== 0) ? v.toExponential(5).replace(/\.?0+e/, 'e').replace('e+', 'E+').replace('e-', 'E-') : String(Number(v.toPrecision(10)));
 return s.replace('.', ',');
}
const serialToDate = (n: number) => new Date(Math.round((n - 25569) * 86400000));
function formatDate(d: Date, fmt: string) {
 const f = fmt.replace(/"([^"]*)"/g, '\u0001$1\u0001').replace(/\\(.)/g, '$1');
 const y = d.getUTCFullYear(), mo = d.getUTCMonth(), day = d.getUTCDate(), h = d.getUTCHours(), mi = d.getUTCMinutes(), s = d.getUTCSeconds();
 const ampm = /AM\/PM|A\/P/i.test(f), hh = ampm ? (h % 12 || 12) : h;
 let out = ''; let i = 0; let lastWasHour = false;
 while (i < f.length) {
  const rest = f.slice(i), m = /^(yyyy|yy|mmmmm|mmmm|mmm|mm|m|dddd|ddd|dd|d|hh|h|ss|s|AM\/PM|A\/P|\u0001[^\u0001]*\u0001)/i.exec(rest);
  if (!m) { out += f[i]; i++; continue; }
  const t = m[1]!, k = t.toLowerCase();
  if (t.startsWith('\u0001')) out += t.slice(1, -1);
  else if (k === 'yyyy') out += y; else if (k === 'yy') out += String(y).slice(-2);
  else if (k.startsWith('m') && (lastWasHour || /^:?s/i.test(f.slice(i + t.length).replace(/^[^a-z]*/i, m => m.includes(':') ? ':' : '')) && k.length <= 2)) out += k === 'mm' ? String(mi).padStart(2, '0') : mi;
  else if (k === 'mmmmm') out += MONTHS_LONG[mo]![0]; else if (k === 'mmmm') out += MONTHS_LONG[mo]; else if (k === 'mmm') out += MONTHS[mo]; else if (k === 'mm') out += String(mo + 1).padStart(2, '0'); else if (k === 'm') out += mo + 1;
  else if (k === 'dddd') out += WEEKDAYS[d.getUTCDay()]; else if (k === 'ddd') out += WEEKDAYS[d.getUTCDay()]!.slice(0, 3); else if (k === 'dd') out += String(day).padStart(2, '0'); else if (k === 'd') out += day;
  else if (k === 'hh') out += String(hh).padStart(2, '0'); else if (k === 'h') out += hh;
  else if (k === 'ss') out += String(s).padStart(2, '0'); else if (k === 's') out += s;
  else if (k === 'am/pm') out += h < 12 ? 'AM' : 'PM'; else if (k === 'a/p') out += h < 12 ? 'A' : 'P';
  lastWasHour = k === 'hh' || k === 'h';
  i += t.length;
 }
 return out;
}

/** What a cell shows. A formula saved without its calculated value (files written by programs that do not
 * calculate, or with calculation left to Excel) shows nothing, as Excel would before recalculating; any other
 * value of an unexpected shape also shows nothing rather than "[object Object]". */
function cellText(cell: Cell): {text: string; color?: string; number: boolean; html?: string} {
 return valueText(cell.value as unknown, cell.numFmt);
}
function valueText(v: unknown, numFmt: string | undefined): {text: string; color?: string; number: boolean; html?: string} {
 if (v === null || v === undefined) return {text: '', number: false};
 if (typeof v === 'number') return {...formatValue(v, numFmt), number: true};
 if (v instanceof Date) return {text: formatValue(v, numFmt).text, number: true};
 if (typeof v === 'boolean') return {text: v ? 'VERDADEIRO' : 'FALSO', number: false};
 if (typeof v === 'string') return {text: v, number: false};
 if (typeof v !== 'object') return {text: String(v), number: false};
 const o = v as Record<string, unknown>;
 // Formulas (plain, shared or array): the saved result, or nothing when none was saved.
 if ('formula' in o || 'sharedFormula' in o || 'result' in o) return 'result' in o ? valueText(o.result, numFmt) : {text: '', number: false};
 if ('error' in o) return {text: String(o.error ?? ''), number: false};
 if (Array.isArray(o.richText)) { const runs = o.richText as {text?: unknown; font?: Partial<ExcelJSType.Font>}[]; const part = (r: {text?: unknown}) => typeof r.text === 'string' ? r.text : ''; return {text: runs.map(part).join(''), number: false, html: runs.map(r => `<span style="${fontCss(r.font)}">${escape(part(r))}</span>`).join('')}; }
 // Hyperlinks: their text may itself be plain or rich text.
 if ('text' in o) return valueText(o.text, numFmt);
 return {text: '', number: false};
}
function fontCss(font: Partial<ExcelJSType.Font> | undefined) {
 if (!font) return '';
 const css: string[] = [];
 if (font.name) css.push(`font-family:${fontStack(font.name)}`);
 if (font.size) css.push(`font-size:${pt(font.size)}`);
 if (font.bold) css.push('font-weight:700');
 if (font.italic) css.push('font-style:italic');
 const lines = [font.underline && font.underline !== 'none' ? 'underline' : '', font.strike ? 'line-through' : ''].filter(Boolean);
 if (lines.length) css.push(`text-decoration:${lines.join(' ')}${font.underline === 'double' || font.underline === 'doubleAccounting' ? ' double' : ''}`);
 const c = color(font.color as never); if (c) css.push(`color:${c}`);
 if (font.vertAlign === 'superscript') css.push('vertical-align:super;font-size:smaller'); else if (font.vertAlign === 'subscript') css.push('vertical-align:sub;font-size:smaller');
 return css.join(';');
}
const SUBS: Record<string, string> = {calibri: 'Carlito', cambria: 'Caladea', arial: 'Liberation Sans', 'times new roman': 'Liberation Serif', 'courier new': 'Liberation Mono'};
const fontStack = (name: string) => `'${name.replace(/['"<>&]/g, '')}'${SUBS[name.toLowerCase()] ? `,'${SUBS[name.toLowerCase()]}'` : ''},sans-serif`;

/** Cell range "A1:D20" → bounds (1-based). */
function range(ref: string | undefined): {top: number; left: number; bottom: number; right: number} | undefined {
 const m = /^\$?([A-Z]+)\$?(\d+)(?::\$?([A-Z]+)\$?(\d+))?$/i.exec((ref ?? '').replace(/^.*!/, '').replace(/'/g, '').split(',')[0]!.trim());
 if (!m) return undefined;
 const col = (s: string) => [...s.toUpperCase()].reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0);
 return {left: col(m[1]!), top: Number(m[2]), right: col(m[3] ?? m[1]!), bottom: Number(m[4] ?? m[2])};
}

function sheetHtml(sheet: Worksheet, workbook: Workbook, index: number): {css: string; html: string} | null {
 if (sheet.state === 'hidden' || sheet.state === 'veryHidden') return null;
 const setup = sheet.pageSetup ?? ({} as ExcelJSType.PageSetup);
 // Used range: cells with values or visible formatting, plus pictures.
 let maxRow = 0, maxCol = 0;
 sheet.eachRow({includeEmpty: false}, (row, r) => row.eachCell({includeEmpty: false}, (cell, c) => { const has = cell.value !== null && cell.value !== undefined && cell.value !== '' || !!(cell.fill as {fgColor?: unknown} | undefined)?.fgColor || !!cell.border?.top || !!cell.border?.bottom || !!cell.border?.left || !!cell.border?.right; if (has) { maxRow = Math.max(maxRow, r); maxCol = Math.max(maxCol, c); } }));
 const images = sheet.getImages();
 for (const img of images) { const br = img.range.br as unknown as {nativeRow: number; nativeCol: number} | undefined, tl = img.range.tl as unknown as {nativeRow: number; nativeCol: number}; maxRow = Math.max(maxRow, (br?.nativeRow ?? tl.nativeRow + 5) + 1); maxCol = Math.max(maxCol, (br?.nativeCol ?? tl.nativeCol + 3) + 1); }
 const area = range(setup.printArea);
 const top = area?.top ?? 1, left = area?.left ?? 1, bottom = area?.bottom ?? maxRow, right = area?.right ?? maxCol;
 if (bottom < top || right < left) return null;
 // Column widths in characters of the default font → points (Calibri 11: 7 px per character + 5 px padding).
 const defaultWidth = sheet.properties.defaultColWidth ?? 8.43, defaultHeight = sheet.properties.defaultRowHeight ?? 15;
 const widths: number[] = [];
 for (let c = left; c <= right; c++) { const col = sheet.getColumn(c); widths.push(col.hidden ? 0 : Math.round(((col.width ?? defaultWidth) * 7 + 5)) * .75); }
 // Merged cells: each range starts at its first visible row (a hidden first row must not take the cell
 // away) and spans only the rows that are printed.
 type Merge = {top: number; left: number; bottom: number; right: number; first: number; rows: number};
 const mergeAt = new Map<string, Merge>();
 const mergeList: string[] = ((sheet as unknown as {model: {merges?: string[]}}).model.merges) ?? [];
 for (const ref of mergeList) {
  const b = range(ref); if (!b) continue;
  const visible: number[] = []; for (let r = b.top; r <= b.bottom; r++) if (!sheet.getRow(r).hidden) visible.push(r);
  const merge = {...b, first: visible[0] ?? b.top, rows: Math.max(visible.length, 1)};
  for (let r = b.top; r <= b.bottom; r++) for (let c = b.left; c <= b.right; c++) mergeAt.set(`${r}:${c}`, merge);
 }
 const gridlines = !!(setup as {showGridLines?: boolean}).showGridLines || !!(sheet as unknown as {pageSetup: {printOptions?: {gridLines?: boolean}}}).pageSetup?.printOptions?.gridLines;
 const rowTops: number[] = []; let y = 0;
 for (let r = top; r <= bottom; r++) { rowTops[r] = y; const row = sheet.getRow(r); if (!row.hidden) y += row.height ?? defaultHeight; }
 rowTops[bottom + 1] = y;
 const cellHtml = (row: ExcelJSType.Row, c: number, colspan: number, rowspan: number, origin: Cell, lastCol: number) => {
  const cell = origin, info = cellText(cell), style = cell.style ?? {};
  const css: string[] = [];
  const font = fontCss(style.font); if (font) css.push(font);
  const fill = style.fill as {type?: string; pattern?: string; fgColor?: never; bgColor?: never; stops?: {color: never}[]} | undefined;
  const bg = fill?.type === 'pattern' && fill.pattern && fill.pattern !== 'none' ? color(fill.fgColor) ?? color(fill.bgColor) : fill?.type === 'gradient' ? color(fill.stops?.[0]?.color) : undefined;
  if (bg) css.push(`background-color:${bg}`);
  for (const side of ['top', 'right', 'bottom', 'left'] as const) { const b = border(style.border?.[side]); if (b) css.push(`border-${side}:${b}`); else if (gridlines) css.push(`border-${side}:.5pt solid #d0d0d0`); }
  const a = style.alignment ?? {};
  const h = a.horizontal ?? (info.number ? 'right' : typeof cell.value === 'boolean' ? 'center' : 'left');
  css.push(`text-align:${h === 'centerContinuous' ? 'center' : h === 'distributed' ? 'justify' : h === 'fill' ? 'left' : h}`);
  css.push(`vertical-align:${a.vertical === 'middle' ? 'middle' : a.vertical === 'top' ? 'top' : a.vertical === 'distributed' || a.vertical === 'justify' ? 'middle' : 'bottom'}`);
  if (a.wrapText || a.horizontal === 'justify' || a.vertical === 'justify') css.push('white-space:pre-wrap'); else css.push('white-space:pre');
  if (a.indent) css.push(`padding-${h === 'right' ? 'right' : 'left'}:${pt(a.indent * 9 + 2)}`);
  if (info.color) css.push(`color:${info.color}`);
  const rotation = typeof a.textRotation === 'number' ? (a.textRotation > 90 ? -(a.textRotation - 90) : a.textRotation) : a.textRotation === 'vertical' ? 'vertical' : 0;
  let content = info.html ?? escape(info.text);
  if (rotation === 'vertical') content = `<span style="writing-mode:vertical-rl;text-orientation:upright">${content}</span>`;
  else if (rotation) content = `<span style="display:inline-block;transform:rotate(${-rotation}deg);white-space:pre">${content}</span>`;
  // Text that does not wrap may spill into empty cells to its right, as in Excel.
  const nextEmpty = c < lastCol && !mergeAt.has(`${row.number}:${c + 1}`) && valueText(row.getCell(c + 1).value as unknown, undefined).text === '';
  const spill = !a.wrapText && colspan === 1 && rowspan === 1 && !info.number && info.text && h === 'left' && nextEmpty ? `<div class="spill">${content}</div>` : content;
  const link = (cell.value as {hyperlink?: string} | null)?.hyperlink;
  const body = link && /^(https?:|mailto:)/i.test(link) ? `<a href="${escape(link)}">${spill}</a>` : spill;
  return `<td${colspan > 1 ? ` colspan="${colspan}"` : ''}${rowspan > 1 ? ` rowspan="${rowspan}"` : ''} style="${css.join(';')}">${body}</td>`;
 };
 /** The printed rows for columns first..last (one page width). A merge cut by the page edge continues on
  * the next page as an empty cell with the same borders and fill. */
 const tableRows = (first: number, last: number) => {
  const out: string[] = [];
  for (let r = top; r <= bottom; r++) {
   const row = sheet.getRow(r);
   if (row.hidden) continue;
   const cells: string[] = [];
   for (let c = first; c <= last; c++) {
    const merge = mergeAt.get(`${r}:${c}`);
    if (!merge) { cells.push(cellHtml(row, c, 1, 1, row.getCell(c), last)); continue; }
    const startCol = Math.max(merge.left, first);
    if (r !== merge.first || c !== startCol) continue;
    const colspan = Math.min(merge.right, last) - startCol + 1, origin = sheet.getRow(merge.top).getCell(merge.left);
    const html = cellHtml(row, c, colspan, merge.rows, origin, last);
    // The value is printed once, on the page where the merge starts.
    cells.push(startCol === merge.left ? html : html.replace(/>[\s\S]*<\/td>$/, '></td>'));
   }
   out.push(`<tr style="height:${pt(row.height ?? defaultHeight)}">${cells.join('')}</tr>`);
  }
  return out.join('');
 };
 const tableWidth = widths.reduce((a, b) => a + b, 0);
 // Page: size, orientation, margins (inches) and scale.
 let [pw, ph] = PAPER[setup.paperSize as number] ?? PAPER[9]!;
 if (setup.orientation === 'landscape') [pw, ph] = [ph, pw];
 const m = setup.margins ?? {left: .7, right: .7, top: .75, bottom: .75, header: .3, footer: .3};
 const ml = (m.left ?? .7) * 72, mr = (m.right ?? .7) * 72, mt = (m.top ?? .75) * 72, mb = (m.bottom ?? .75) * 72;
 const usable = pw - ml - mr, usableH = ph - mt - mb;
 let zoom = (setup.scale && !setup.fitToPage ? setup.scale : 100) / 100;
 if (setup.fitToPage) {
  const wide = setup.fitToWidth ?? 1, tall = setup.fitToHeight ?? 1;
  const zw = wide ? usable * wide / tableWidth : Infinity, zh = tall ? usableH * tall / y : Infinity;
  zoom = Math.min(1, zw, zh);
 }
 // Columns that do not fit the page width go to the next pages, after all the rows ("down, then over"),
 // as Excel prints; nothing is cut off at the right edge.
 const groups: [number, number][] = [];
 for (let c = left, start = left, sum = 0; c <= right; c++) {
  const w = widths[c - left]! * zoom;
  if (sum + w > usable + .5 && c > start) { groups.push([start, c - 1]); start = c; sum = 0; }
  sum += w;
  if (c === right) groups.push([start, right]);
 }
 const xAt = (col: number, off = 0) => widths.slice(0, Math.max(col + 1 - left, 0)).reduce((a, b) => a + b, 0) + off / 12700;
 // Pictures, anchored to cells; each goes on the page holding the column it starts in.
 const pictures = images.map(img => {
  const data = workbook.getImage(Number(img.imageId)) as {buffer?: Buffer; base64?: string; extension?: string}; if (!data) return null;
  const base64 = data.base64?.replace(/^data:[^,]+,/, '') ?? (data.buffer ? Buffer.from(data.buffer).toString('base64') : ''); if (!base64) return null;
  const tl = img.range.tl as unknown as {nativeCol: number; nativeRow: number; nativeColOff?: number; nativeRowOff?: number}, br = img.range.br as unknown as {nativeCol: number; nativeRow: number; nativeColOff?: number; nativeRowOff?: number} | undefined;
  const ext = (img.range as unknown as {ext?: {width: number; height: number}}).ext;
  const yAt = (row: number, off = 0) => (rowTops[row + 1] ?? y) + off / 12700;
  const x0 = xAt(tl.nativeCol, tl.nativeColOff), y0 = yAt(tl.nativeRow, tl.nativeRowOff);
  const w = br ? xAt(br.nativeCol, br.nativeColOff) - x0 : (ext?.width ?? 96) * .75, hgt = br ? yAt(br.nativeRow, br.nativeRowOff) - y0 : (ext?.height ?? 96) * .75;
  return {col: tl.nativeCol + 1, x0, html: (x: number) => `<img src="data:image/${data.extension === 'jpg' ? 'jpeg' : data.extension ?? 'png'};base64,${base64}" style="position:absolute;left:${pt(x)};top:${pt(y0)};width:${pt(w)};height:${pt(hgt)}">`};
 }).filter((p): p is NonNullable<typeof p> => !!p);
 const name = `x${index}`;
 const css = `@page ${name}{size:${pt(pw)} ${pt(ph)};margin:${pt(mt)} ${pt(mr)} ${pt(mb)} ${pt(ml)}}`;
 const centered = (setup as {horizontalCentered?: boolean}).horizontalCentered ? 'margin-left:auto;margin-right:auto;' : '';
 const parts = groups.map(([first, last], g) => {
  const cols = widths.slice(first - left, last - left + 1), width = cols.reduce((a, b) => a + b, 0), offset = xAt(first - 1);
  const pics = pictures.filter(p => p.col >= first && p.col <= last || (g === 0 && p.col < first) || (g === groups.length - 1 && p.col > last)).map(p => p.html(p.x0 - offset)).join('');
  return `<div style="zoom:${Math.round(zoom * 1000) / 1000};width:${pt(width)};${centered}position:relative;${g ? 'break-before:page;' : ''}"><table style="width:${pt(width)}"><colgroup>${cols.map(w => `<col style="width:${pt(w)}">`).join('')}</colgroup>${tableRows(first, last)}</table>${pics}</div>`;
 });
 const html = `<section style="page:${name};break-before:${index ? 'page' : 'auto'}">${parts.join('')}</section>`;
 return {css, html};
}

export async function xlsxToHtml(bytes: Uint8Array): Promise<string> {
 const ExcelJS = (await import('exceljs')).default, workbook = new ExcelJS.Workbook();
 try { await workbook.xlsx.load(Buffer.from(bytes) as never); } catch { throw new Error('A planilha está danificada ou não é um arquivo .xlsx válido.'); }
 const sheets = workbook.worksheets.map((s, i) => sheetHtml(s, workbook, i)).filter((s): s is {css: string; html: string} => !!s);
 if (!sheets.length) throw new Error('A planilha está vazia: não há nada para converter.');
 // Excel's default font comes from the workbook's "Normal" style; Calibri 11 when unknown.
 return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><style>${sheets.map(s => s.css).join('')}
@page{margin:0}html,body{margin:0;padding:0;-webkit-print-color-adjust:exact;print-color-adjust:exact}
body{font-family:'Calibri','Carlito',sans-serif;font-size:11pt;color:#000}
table{border-collapse:collapse;table-layout:fixed;border-spacing:0}td{padding:0 2.25pt;overflow:hidden;line-height:1.2}
td:has(.spill){overflow:visible}.spill{width:0;overflow:visible;white-space:pre}tr{break-inside:avoid}a{color:inherit}</style></head><body>${sheets.map(s => s.html).join('')}</body></html>`;
}
