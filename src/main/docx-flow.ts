import {TOL,strokes,frames,frameTable} from './table-geometry';
import { Paragraph, TextRun, ImageRun, AlignmentType, BorderStyle, LineRuleType, PageNumber, Header, Footer, TabStopType, type Table } from 'docx';
import type { PDFPageProxy } from 'pdfjs-dist/types/src/display/api';
import { buildBlocks, buildLines, hex6, lineRuns, pageRuns, vectorShapes, wordTable, type Block, type FontContext, type Line, type Run } from './word-layout';
import { cellText, type GridRegion, type GridTable } from './tables';

/** A flowing Word document, the way desktop converters rebuild text documents: real margins, paragraphs
 * that rewrap when edited, lists with hanging indents, tables in the text, and what repeats on every page
 * (logo, title, rule, page number) moved to the header and footer. Pages that are artwork rather than
 * text (posters, slides, scans) are not flowable; the caller keeps those as positioned layout. */

type Box = { x: number; y: number; width: number; height: number };
export interface PageImage { bytes: Buffer; x: number; y: number; width: number; height: number }
export type FlowItem =
  | { kind: 'paragraph'; top: number; bottom: number; block: Block; list?: { marker: string; textX: number } }
  | { kind: 'table'; top: number; bottom: number; table: GridTable; padding: number; paddingTop: number }
  | { kind: 'image'; top: number; bottom: number; image: PageImage }
  | { kind: 'rule'; top: number; bottom: number; x: number; width: number; color: string; thickness: number }
  /** Pieces of text side by side on one line ("Title | Subtitle", "site … Page 1"): one paragraph with tab stops. */
  | { kind: 'line'; top: number; bottom: number; blocks: Block[] }
  /** Side-by-side text columns: a borderless table keeps them next to each other. */
  | { kind: 'columns'; top: number; bottom: number; table: GridTable };
export interface FlowPage { width: number; height: number; items: FlowItem[]; runs: Run[]; /** 1-based page number in the PDF. */ number: number }

const white = (c: string) => /^#f[a-f0-9]f[a-f0-9]f[a-f0-9]$/i.test(c);
const MARKER = /^(\d{1,3}[.)]|[a-z][.)]|[ivx]{1,4}[.)]|[•▪●◦‣\-–—*✓✔])$/i;
/** A list item's marker is its first word; the text after it starts where the next lines are indented to. */
function listOf(block: Block) {
  const first = block.lines[0]!, runs = first.runs, head = runs[0]!.text.trim().split(/\s+/)[0]!;
  if (!MARKER.test(head)) return undefined;
  const rest = runs[0]!.text.trim().slice(head.length).trim() ? undefined : runs[1];
  const textX = rest ? rest.x : runs[0]!.x + runs[0]!.width * (head.length + 1) / Math.max(1, runs[0]!.text.trim().length);
  return { marker: head, textX };
}

/** Reads one page as flowing content, or null when it is artwork (large pictures, decorative shapes,
 * a page colour) that only positioned layout reproduces. */
export async function flowPage(page: PDFPageProxy, fonts: FontContext, images: PageImage[], number = page.pageNumber): Promise<FlowPage | null> {
  const viewport = page.getViewport({ scale: 1 }), width = viewport.width, height = viewport.height, area = width * height;
  const [{ shapes, painted, reason }, runs] = await Promise.all([vectorShapes(page), pageRuns(page, fonts)]);
  // Gradients and patterns over a real part of the page (a cover, a banner) are artwork; a small one (inside a
  // logo) is not. Soft masks and too many shapes mean designed artwork too.
  if (!runs.length || reason === 'máscara suave' || reason === 'formas demais' || painted.reduce((n, b) => n + Math.max(0, b.width) * Math.max(0, b.height), 0) > area * 0.08) return null;
  // Light text is made for a dark background: the page is designed artwork.
  const light = (c: string) => { const v = parseInt(c.slice(1), 16); return ((v >> 16) & 255) * 0.299 + ((v >> 8) & 255) * 0.587 + (v & 255) * 0.114 > 200; };
  if (runs.filter((r) => light(r.color)).reduce((n, r) => n + r.text.length, 0) > runs.reduce((n, r) => n + r.text.length, 0) * 0.05) return null;
  if (images.some((m) => m.width * m.height > area * 0.3)) return null;
  const { segments, shades, decorative } = strokes(shapes);
  const coloured = shades.filter((s) => s.box.width * s.box.height > area * 0.02);
  if (decorative > 6 || shades.some((s) => s.box.width * s.box.height > area * 0.6)) return null;
  const items: FlowItem[] = [];
  const tables: GridTable[] = [];
  for (const frame of frames(segments)) {
    const built = frameTable(frame, shades, runs);
    if (built) { tables.push(built.table); items.push({ kind: 'table', top: built.table.y, bottom: built.table.y + built.table.height, table: built.table, padding: built.padding, paddingTop: built.paddingTop }); continue; }
    // A lone long line (a rule under a title, above the footer).
    for (const s of frame) if (s.horizontal && !s.invisible && s.to - s.from > width * 0.2) items.push({ kind: 'rule', top: s.at - s.width / 2, bottom: s.at + s.width / 2, x: s.from, width: s.to - s.from, color: s.color, thickness: s.width });
  }
  const inTable = (b: Box) => tables.some((t) => b.x >= t.x - TOL && b.y >= t.y - TOL && b.x + b.width <= t.x + t.width + TOL && b.y + b.height <= t.y + t.height + TOL);
  // Coloured boxes outside tables are artwork Word paragraphs cannot carry.
  if (coloured.some((s) => !inTable(s.box))) return null;
  const free = runs.filter((r) => !inTable({ x: r.x, y: r.baseline - r.size * 0.7, width: Math.min(r.width, 1), height: r.size * 0.6 }));
  // Consecutive list items share a left edge, so they arrive as one block: each marker starts an item.
  const blocks = buildBlocks(buildLines(free)).flatMap((block) => {
    const parts: Block[] = [];
    for (const line of block.lines) {
      const head = line.runs[0]!.text.trim().split(/\s+/)[0]!;
      if (!parts.length || MARKER.test(head)) parts.push({ ...block, lines: [line], x: line.x, right: line.right });
      else { const p = parts.at(-1)!; p.lines.push(line); p.x = Math.min(p.x, line.x); p.right = Math.max(p.right, line.right); }
    }
    return parts.length > 1 ? parts : [block];
  });
  // A list item's wrapped lines start under its text, not under the marker: join them back to the item.
  const merged: Block[] = [];
  for (const block of blocks.sort((a, b) => a.lines[0]!.baseline - b.lines[0]!.baseline)) {
    const last = merged.at(-1), list = last && listOf(last);
    const pitch = last ? block.lines[0]!.baseline - last.lines.at(-1)!.baseline : 0;
    if (last && list && !listOf(block) && Math.abs(block.x - list.textX) < 3 && pitch > 0 && pitch < last.size * 1.6 && Math.abs(block.size - last.size) < 0.5) {
      last.lines.push(...block.lines); last.right = Math.max(last.right, block.right);
      continue;
    }
    merged.push(block);
  }
  for (const block of merged) {
    const first = block.lines[0]!, lastLine = block.lines.at(-1)!;
    const list = listOf(block);
    // A list item is justified when its full lines reach the same edge.
    if (list && block.lines.length >= 2 && block.align === 'left') { const body = block.lines.slice(0, -1); if (body.every((l) => block.right - l.right < Math.max(1.5, block.size * 0.15))) block.align = 'justify'; }
    items.push({ kind: 'paragraph', top: first.baseline - first.size * 0.95, bottom: lastLine.baseline + lastLine.size * 0.27, block, ...(list ? { list } : {}) });
  }
  for (const image of images) if (!inTable(image)) items.push({ kind: 'image', top: image.y, bottom: image.y + image.height, image });
  items.sort((a, b) => a.top - b.top);
  const laid = sideBySide(items);
  // Drawn forms (fill-in lines, checkbox grids) and side-by-side text columns keep their look only with
  // positioned layout; a text document has at most a few rules (under a title, above the footer).
  if (laid.filter((i) => i.kind === 'rule').length > 3 || laid.some((i) => i.kind === 'columns')) return null;
  return { width, height, items: laid, runs, number };
}
/** Paragraphs that share a vertical band and do not overlap horizontally sit side by side on the page. */
function sideBySide(items: FlowItem[]): FlowItem[] {
  const out: FlowItem[] = [];
  const overlaps = (a: FlowItem, b: FlowItem) => Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > Math.min(a.bottom - a.top, b.bottom - b.top) * 0.5;
  for (const item of items) {
    if (item.kind !== 'paragraph' || item.list) { out.push(item); continue; }
    const row = out.find((o): o is Extract<FlowItem, { kind: 'paragraph' | 'line' }> => (o.kind === 'paragraph' && !o.list || o.kind === 'line') && overlaps(o, item));
    if (!row) { out.push(item); continue; }
    const blocks = row.kind === 'line' ? row.blocks : [row.block];
    if (blocks.some((b) => item.block.x < b.right + 2 && item.block.right > b.x - 2)) { out.push(item); continue; }
    const next: Extract<FlowItem, { kind: 'line' }> = { kind: 'line', top: Math.min(row.top, item.top), bottom: Math.max(row.bottom, item.bottom), blocks: [...blocks, item.block].sort((a, b) => a.x - b.x) };
    out[out.indexOf(row)] = next;
  }
  // Several lines in any piece: columns, laid out as a borderless table.
  return out.map((item) => {
    if (item.kind !== 'line' || item.blocks.every((b) => b.lines.length === 1)) return item;
    const xs = [...item.blocks.map((b) => b.x), Math.max(...item.blocks.map((b) => b.right)) + 2];
    const box = (i: number) => ({ x: xs[i]!, y: item.top, width: xs[i + 1]! - xs[i]!, height: item.bottom - item.top });
    const cells: GridRegion[] = item.blocks.map((b, i) => ({ row: 0, col: i, rows: 1, cols: 1, text: cellText(b.lines.flatMap((l) => l.runs), box(i), true) }));
    return { kind: 'columns', top: item.top, bottom: item.bottom, table: { x: xs[0]!, y: item.top, width: xs.at(-1)! - xs[0]!, height: item.bottom - item.top, colW: xs.slice(1).map((x, i) => x - xs[i]!), rowH: [item.bottom - item.top], cells } };
  });
}

/** The font and size most of the text uses: the document's Normal style, as a word processor would have it.
 * Empty paragraphs and paragraph marks take this style, so lines in cells keep the PDF's height. */
export function bodyStyle(pages: FlowPage[]) {
  const weight = new Map<string, number>();
  for (const run of pages.flatMap((p) => p.runs)) { const k = `${run.font}|${Math.round(run.size * 2)}`; weight.set(k, (weight.get(k) ?? 0) + run.text.length); }
  const [font, half] = ([...weight].sort((a, b) => b[1] - a[1])[0]?.[0] ?? 'Calibri|22').split('|');
  return { font: font!, size: Number(half) };
}
const twip = (pt: number) => Math.max(0, Math.round(pt * 20));
/** What identifies an item across pages; numbers are ignored, so "Página 3 de 9" repeats like "Página 4 de 9". */
const textOf = (b: Block) => b.lines.map((l) => l.runs.map((r) => r.text).join(' ')).join('/').replace(/\d+/g, '#');
const key = (item: FlowItem) => item.kind === 'paragraph' ? `p:${textOf(item.block)}:${Math.round(item.block.x / 4)}`
  : item.kind === 'line' ? `l:${item.blocks.map((b) => textOf(b) + '@' + Math.round(b.x / 4)).join('|')}`
  : item.kind === 'image' ? `i:${Math.round(item.image.x / 4)}:${Math.round(item.image.width / 4)}x${Math.round(item.image.height / 4)}` : item.kind === 'rule' ? `r:${Math.round(item.x / 4)}:${Math.round(item.width / 4)}` : 't';
const numberOf = (item: FlowItem) => item.kind === 'paragraph' && item.block.lines.length === 1 ? /^\s*(?:p[áa]gina\s*)?(\d{1,4})(?:\s*(?:de|\/|of)\s*\d{1,4})?\s*$/i.exec(item.block.lines[0]!.runs.map((r) => r.text).join(' '))?.[1] : undefined;

/** What repeats at the top and the bottom of every page becomes the header and the footer; a number
 * that counts the pages becomes the page-number field. */
export function splitRepeats(pages: FlowPage[]) {
  const header = new Set<string>(), footer = new Set<string>();
  let pageNumber: FlowItem | undefined;
  if (pages.length >= 2) {
    const zone = (p: FlowPage, i: FlowItem) => (i.bottom < p.height * 0.18 ? 'top' : i.top > p.height * 0.82 ? 'bottom' : null);
    const counts = new Map<string, number>();
    for (const p of pages) for (const k of new Set(p.items.filter((i) => zone(p, i)).map((i) => zone(p, i) + key(i)))) counts.set(k, (counts.get(k) ?? 0) + 1);
    for (const [k, n] of counts) if (n === pages.length) (k.startsWith('top') ? header : footer).add(k.replace(/^(top|bottom)/, ''));
    // The page number: a lone number at the bottom that equals the page's position on every page.
    const numbers = pages.map((p) => p.items.find((item) => item.top > p.height * 0.82 && numberOf(item) === String(p.number)));
    if (numbers.every(Boolean)) pageNumber = numbers[0];
  }
  return {
    header: pages[0]?.items.filter((i) => i.bottom < pages[0]!.height * 0.18 && header.has(key(i))) ?? [],
    footer: pages[0]?.items.filter((i) => i.top > pages[0]!.height * 0.82 && footer.has(key(i))) ?? [],
    pageNumber,
    body: pages.map((p) => p.items.filter((i) => !(i.bottom < p.height * 0.18 && header.has(key(i))) && !(i.top > p.height * 0.82 && footer.has(key(i))) && !(pageNumber && i.top > p.height * 0.82 && numberOf(i) === String(p.number)))),
  };
}

/** Word content for a run of flowing pages sharing margins, header and footer. */
export function flowSection(pages: FlowPage[], totalPages = pages.length) {
  const { header, footer, pageNumber, body } = splitRepeats(pages);
  const all = body.flat(), width = pages[0]!.width, height = pages[0]!.height;
  const lefts = all.map((i) => (i.kind === 'paragraph' ? i.block.x : i.kind === 'line' ? i.blocks[0]!.x : i.kind === 'table' || i.kind === 'columns' ? i.table.x : i.kind === 'image' ? i.image.x : i.x));
  const left = Math.max(18, lefts.length ? Math.min(...lefts) : width * 0.1);
  const rightEdge = Math.max(...all.map((i) => (i.kind === 'paragraph' ? (i.block.align === 'justify' || i.block.flow ? i.block.right : 0) : i.kind === 'table' || i.kind === 'columns' ? i.table.x + i.table.width : i.kind === 'line' ? i.blocks.at(-1)!.right : 0)), width - left);
  const right = Math.max(18, width - rightEdge);
  const contentWidth = width - left - right;
  const firsts = body.map((items) => items[0]?.top).filter((t): t is number => t !== undefined);
  // The body starts below the header: Word pushes it there anyway, and spacing is measured from it.
  const headerBottom = header.length ? Math.max(...header.map((i) => i.bottom)) + 3 : 0;
  const top = Math.max(18, headerBottom, firsts.length ? Math.min(...firsts) : height * 0.1);
  const bottom = Math.max(18, height - Math.max(...body.map((items) => items.at(-1)?.bottom ?? 0)) - 2);
  const headerTop = header.length ? Math.max(0, Math.min(...header.map((i) => i.top))) : undefined;
  const footerItems = [...footer, ...(pageNumber ? [pageNumber] : [])];
  const footerTop = footerItems.length ? Math.min(...footerItems.map((i) => i.top)) : undefined, footerBottom = footerItems.length ? Math.max(...footerItems.map((i) => i.bottom)) : undefined;

  const paragraph = (item: Extract<FlowItem, { kind: 'paragraph' }>, before: number, pageBreak: boolean, fields?: { page: string; total: string }) => {
    const b = item.block, pitch = b.lines.length > 1 ? (b.lines.at(-1)!.baseline - b.lines[0]!.baseline) / (b.lines.length - 1) : b.size * 1.22;
    const centred = b.align === 'center' && Math.abs((b.x + b.right) / 2 - (left + contentWidth / 2)) < 8;
    const indentLeft = item.list ? item.list.textX - left : centred ? 0 : b.x - left;
    const children: TextRun[] = [];
    // Prose and list items rewrap; other multi-line blocks (addresses, signatures) keep their line breaks.
    const rewrap = b.flow || b.align === 'justify' || !!item.list;
    b.lines.forEach((line, i) => {
      if (i > 0 && !rewrap) children.push(new TextRun({ break: 1 }));
      let runs: Line = line;
      if (i === 0 && item.list) {
        // The marker, a tab to the text position, then the text: the item's own hanging indent.
        const [head, ...tail] = line.runs, words = head!.text.trim(), afterMarker = words.slice(item.list.marker.length).trim();
        children.push(new TextRun({ text: item.list.marker, font: { ascii: head!.font, hAnsi: head!.font, cs: head!.font }, size: Math.round(head!.size * 2), bold: head!.bold, color: hex6(head!.color) }), new TextRun({ text: '\t', size: Math.round(head!.size * 2) }));
        runs = { ...line, runs: afterMarker ? [{ ...head!, text: afterMarker }, ...tail] : tail };
      }
      children.push(...lineRuns(runs, i > 0 && rewrap, fields));
    });
    return new Paragraph({
      alignment: centred || b.align === 'center' ? AlignmentType.CENTER : b.align === 'right' ? AlignmentType.RIGHT : b.align === 'justify' ? AlignmentType.JUSTIFIED : AlignmentType.LEFT,
      indent: { left: twip(indentLeft), ...(item.list ? { hanging: twip(item.list.textX - b.x) } : {}) },
      ...(item.list ? { tabStops: [{ type: TabStopType.LEFT, position: twip(indentLeft) }] } : {}),
      spacing: { before: twip(before), after: 0, line: Math.round(pitch * 20), lineRule: LineRuleType.EXACT },
      pageBreakBefore: pageBreak,
      children,
    });
  };
  const picture = (item: Extract<FlowItem, { kind: 'image' }>, before: number, pageBreak: boolean) => {
    const m = item.image, centred = Math.abs(m.x + m.width / 2 - (left + contentWidth / 2)) < 8;
    return new Paragraph({ alignment: centred ? AlignmentType.CENTER : AlignmentType.LEFT, indent: centred ? undefined : { left: twip(m.x - left) }, spacing: { before: twip(before), after: 0 }, pageBreakBefore: pageBreak, children: [new ImageRun({ type: 'png', data: m.bytes, transformation: { width: m.width * 96 / 72, height: m.height * 96 / 72 } })] });
  };
  const rule = (item: Extract<FlowItem, { kind: 'rule' }>, before: number, pageBreak: boolean) => new Paragraph({
    indent: { left: twip(item.x - left), right: twip(left + contentWidth - (item.x + item.width)) }, pageBreakBefore: pageBreak,
    spacing: { before: twip(Math.max(0, before - 1)), after: 0, line: 20, lineRule: LineRuleType.EXACT },
    border: { bottom: { style: BorderStyle.SINGLE, size: Math.max(2, Math.min(96, Math.round(item.thickness * 8))), color: hex6(item.color), space: 0 } },
    children: [new TextRun({ text: '', size: 2 })],
  });
  /** Pieces on one line: the first at its indent, the others at tab stops where they start (a piece ending
   * at the right margin is right-aligned there, as page numbers and dates usually are). */
  const tabbed = (item: Extract<FlowItem, { kind: 'line' }>, before: number, pageBreak: boolean, fields?: { page: string; total: string }) => {
    const [first, ...rest] = item.blocks, size = Math.max(...item.blocks.map((b) => b.size));
    const atRight = (b: Block) => left + contentWidth - b.right < 6 && b.x > left + contentWidth / 2;
    const tabStops = rest.map((b) => (atRight(b) ? { type: TabStopType.RIGHT, position: twip(contentWidth) } : { type: TabStopType.LEFT, position: twip(b.x - left) }));
    const children: TextRun[] = [...lineRuns(first!.lines[0]!, false, fields)];
    for (const b of rest) children.push(new TextRun({ text: '\t', size: Math.round(b.size * 2) }), ...lineRuns(b.lines[0]!, false, fields));
    return new Paragraph({ indent: { left: twip(first!.x - left) }, tabStops, spacing: { before: twip(before), after: 0, line: Math.round(size * 1.22 * 20), lineRule: LineRuleType.EXACT }, pageBreakBefore: pageBreak, children });
  };
  /** Elements in reading order, each spaced from the one above as on the page. */
  const render = (items: FlowItem[], start: number, pageBreak: boolean, fields?: { page: string; total: string }) => {
    const out: (Paragraph | Table)[] = [];
    let previous = start, breakNext = pageBreak;
    for (const item of items) {
      const before = Math.max(0, item.top - previous);
      if (item.kind === 'paragraph') out.push(paragraph(item, before, breakNext, fields));
      else if (item.kind === 'image') out.push(picture(item, before, breakNext));
      else if (item.kind === 'rule') out.push(rule(item, before, breakNext));
      else if (item.kind === 'line') out.push(tabbed(item, before, breakNext, fields));
      else if (item.kind === 'columns') {
        if (breakNext || before > 1) out.push(new Paragraph({ pageBreakBefore: breakNext, spacing: { before: 0, after: 0, line: Math.max(20, twip(before)), lineRule: LineRuleType.EXACT }, children: [new TextRun({ text: '', size: 2 })] }));
        out.push(wordTable(item.table, { indent: item.table.x - left, padding: 0 }));
      }
      else {
        // A table cannot carry space before or a page break: a hairline paragraph does.
        if (breakNext || before > 1) out.push(new Paragraph({ pageBreakBefore: breakNext, spacing: { before: 0, after: 0, line: Math.max(20, twip(before)), lineRule: LineRuleType.EXACT }, children: [new TextRun({ text: '', size: 2 })] }));
        out.push(wordTable(item.table, { indent: item.table.x - left, padding: item.padding, paddingTop: item.paddingTop }));
      }
      breakNext = false;
      previous = Math.max(previous, item.bottom);
    }
    // Word ends a table with a paragraph of its own; a 1 pt one keeps it from spilling onto a new page.
    if (out.at(-1) && !(out.at(-1) instanceof Paragraph)) out.push(new Paragraph({ spacing: { before: 0, after: 0, line: 20, lineRule: LineRuleType.EXACT }, children: [new TextRun({ text: '', size: 2 })] }));
    return out;
  };
  const children = body.flatMap((items, i) => render(items, top, i > 0));
  // Header and footer come from the section's first page: its number and the page count become fields.
  const fields = { page: String(pages[0]!.number), total: String(totalPages) };
  const headerChildren = header.length ? render(header, headerTop!, false, fields) : [];
  const footerChildren = footerItems.length ? render(footerItems.filter((i) => i !== pageNumber), footerTop!, false, fields) : [];
  if (pageNumber && pageNumber.kind === 'paragraph') {
    const b = pageNumber.block, run = b.lines[0]!.runs[0]!, nearRight = b.right > width - right - 12;
    const previousBottom = footer.length ? Math.max(...footer.map((i) => i.bottom)) : footerTop!;
    footerChildren.push(new Paragraph({ alignment: nearRight ? AlignmentType.RIGHT : b.align === 'center' ? AlignmentType.CENTER : AlignmentType.LEFT, indent: nearRight ? { right: twip(width - right - b.right) } : { left: twip(b.x - left) }, spacing: { before: twip(Math.max(0, pageNumber.top - previousBottom)), after: 0 }, children: [new TextRun({ children: [PageNumber.CURRENT], font: { ascii: run.font, hAnsi: run.font, cs: run.font }, size: Math.round(run.size * 2), bold: run.bold, color: hex6(run.color) })] }));
  }
  return {
    properties: {
      page: {
        size: { width: twip(width), height: twip(height) },
        margin: { top: twip(top), // Word keeps the body clear of a taller footer by itself; the margin only needs the PDF's text area.
        bottom: twip(Math.max(18, bottom - 8)), left: twip(left), right: twip(right), header: twip(headerTop ?? 36), footer: twip(footerBottom !== undefined ? Math.max(0, height - footerBottom - 2) : 36) },
      },
    },
    ...(headerChildren.length ? { headers: { default: new Header({ children: headerChildren }) } } : {}),
    ...(footerChildren.length ? { footers: { default: new Footer({ children: footerChildren }) } } : {}),
    children,
  };
}
