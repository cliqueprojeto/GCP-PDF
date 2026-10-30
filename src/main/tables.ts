import type { PDFPageProxy } from 'pdfjs-dist/types/src/display/api';
import { pageRuns, vectorShapes, type Run, type VectorShape } from './word-layout';

/** A page read as a grid, the way desktop converters rebuild tables: the edges of filled cells and
 * ruling lines become columns and rows; cells that one rectangle covers (and no line divides) are
 * merged; text and fill colour belong to the cell that contains them. Coordinates are page points
 * (top-left origin). */
export interface GridPart { text: string; bold: boolean; italic: boolean; color: string; size: number }
export interface GridText { parts: GridPart[]; text: string; font: string; size: number; bold: boolean; italic: boolean; color: string; align: 'left' | 'center' | 'right'; valign: 'top' | 'middle' | 'bottom' }
export interface GridEdge { color: string; width: number }
export interface GridRegion { row: number; col: number; rows: number; cols: number; fill?: string; page?: boolean; text?: GridText; borders?: { top?: GridEdge; right?: GridEdge; bottom?: GridEdge; left?: GridEdge } }
export interface PageGrid { xs: number[]; ys: number[]; regions: GridRegion[]; width: number; height: number; tables: { row: number; col: number; rows: number; cols: number }[] }

const TOLERANCE = 3;
function cluster(values: number[]) {
  const sorted = [...values].sort((a, b) => a - b), out: number[] = [];
  for (const v of sorted) if (!out.length || v - out[out.length - 1]! > TOLERANCE) out.push(v); else out[out.length - 1] = (out[out.length - 1]! + v) / 2;
  return out;
}
const snap = (edges: number[], v: number) => edges.reduce((best, e, i) => (Math.abs(e - v) < Math.abs(edges[best]! - v) ? i : best), 0);
const isRect = (s: VectorShape) => { const pts = s.segments.filter((g) => g.op !== 'Z'); return pts.length >= 4 && pts.length <= 5 && pts.every((p) => p.op !== 'C'); };

/** Text of one cell: lines by baseline, joined into paragraphs the way the cell wraps them. */
function cellText(runs: Run[], box: { x: number; y: number; width: number; height: number }): GridText | undefined {
  if (!runs.length) return undefined;
  const sorted = [...runs].sort((a, b) => a.baseline - b.baseline || a.x - b.x), lines: Run[][] = [];
  for (const run of sorted) { const line = lines.find((l) => Math.abs(l[0]!.baseline - run.baseline) < run.size * 0.4); if (line) line.push(run); else lines.push([run]); }
  // Formatted pieces in reading order, so partly bold or coloured cells keep their look (Excel rich text).
  const parts: GridPart[] = [], push = (text: string, run: Run) => { const last = parts.at(-1); if (last && last.bold === run.bold && last.italic === run.italic && last.color === run.color && last.size === run.size) last.text += text; else parts.push({ text, bold: run.bold, italic: run.italic, color: run.color, size: run.size }); };
  const texts: string[] = [];
  lines.forEach((line, li) => {
    line.sort((a, b) => a.x - b.x);
    if (li) {
      const gap = line[0]!.baseline - lines[li - 1]![0]!.baseline, size = lines[li - 1]![0]!.size, first = line.map((r) => r.text).join('').trim();
      // A bullet, a clearly larger gap or a line ending a sentence/label starts a new paragraph; wrapped lines join with a space.
      const breakLine = /^[✓✔•▪●◦‣\-–—*]/.test(first) || gap > size * 1.75 || /[:;]$/.test(texts[li - 1]!);
      push(breakLine ? '\n' : ' ', parts.at(-1) ? { ...line[0]!, bold: parts.at(-1)!.bold, italic: parts.at(-1)!.italic, color: parts.at(-1)!.color, size: parts.at(-1)!.size } : line[0]!);
    }
    let lineText = '';
    line.forEach((run, i) => { const prev = line[i - 1], gap = prev ? run.x - (prev.x + prev.width) : 0, piece = ((i && (run.space || gap > run.size * 0.15) && !/^\s/.test(run.text) ? ' ' : '') + run.text).replace(i ? /$^/ : /^\s+/, ''); lineText += piece; push(i === line.length - 1 ? piece.trimEnd() : piece, run); });
    texts.push(lineText.trim());
  });
  const text = parts.map((p) => p.text).join('');
  const left = Math.min(...runs.map((r) => r.x)), right = Math.max(...runs.map((r) => r.x + r.width));
  const top = Math.min(...runs.map((r) => r.baseline - r.size * 0.8)), bottom = Math.max(...runs.map((r) => r.baseline + r.size * 0.2));
  const gapL = left - box.x, gapR = box.x + box.width - right, gapT = top - box.y, gapB = box.y + box.height - bottom;
  // Wrapped paragraphs fill the width; only a clearly narrower block with equal margins is centred.
  const narrow = right - left < box.width * 0.75;
  const align = narrow && Math.abs(gapL - gapR) < Math.max(4, box.width * 0.08) && gapL > 6 ? 'center' : narrow && gapR < gapL * 0.5 && gapL > 12 ? 'right' : 'left';
  const valign = Math.abs(gapT - gapB) < Math.max(4, box.height * 0.15) ? 'middle' : gapB < gapT * 0.5 ? 'bottom' : 'top';
  // The cell's font is the one most of its characters use; bullets and ticks often come from symbol fonts.
  const weight = new Map<string, number>(), symbol = /wingdings|webdings|symbol|dingbat|zapf/i;
  for (const r of runs) if (!symbol.test(r.font) && r.text.trim().length > 1) weight.set(r.font, (weight.get(r.font) ?? 0) + r.text.length);
  const main = runs.find((r) => r.font === [...weight].sort((a, b) => b[1] - a[1])[0]?.[0]) ?? runs.find((r) => !symbol.test(r.font)) ?? sorted[0]!;
  const size = Math.max(...runs.filter((r) => r.font === main.font).map((r) => r.size));
  const chars = (pick: (r: Run) => boolean) => runs.filter(pick).reduce((n, r) => n + r.text.length, 0);
  return { parts, text, font: main.font, size, bold: chars((r) => r.bold) > chars(() => true) / 2, italic: main.italic, color: main.color, align, valign };
}

/** Reads the grid of a page; null when the page has no ruled or filled structure to build on. */
export async function pageGrid(page: PDFPageProxy, missing?: Map<string, string>): Promise<PageGrid | null> {
  const viewport = page.getViewport({ scale: 1 }), width = viewport.width, height = viewport.height, area = width * height;
  const [{ shapes }, runs] = await Promise.all([vectorShapes(page), pageRuns(page, missing)]);
  const fills = shapes.filter((s) => s.fill && s.fill.alpha > 0.5 && isRect(s) && s.box.width > 2 && s.box.height > 2).map((s) => ({ box: s.box, color: s.fill!.color, page: s.box.width * s.box.height > area * 0.9 }));
  const rules = shapes.filter((s) => s.stroke && !s.fill && s.segments.filter((g) => g.op !== 'Z').length === 2 && (s.box.width < 1.5 || s.box.height < 1.5));
  // Thin filled bars also act as ruling lines (many generators draw borders as 0.5 pt rectangles).
  for (const f of fills) if (!f.page && (f.box.width < 2.5 || f.box.height < 2.5)) rules.push({ segments: [], box: f.box, stroke: { color: f.color, alpha: 1, width: Math.min(f.box.width, f.box.height), dash: false } });
  const cells = fills.filter((f) => !f.page && f.box.width >= 2.5 && f.box.height >= 2.5);
  if (cells.length + rules.length < 3) return null;
  const xs = cluster([0, width, ...cells.flatMap((f) => [f.box.x, f.box.x + f.box.width]), ...rules.filter((r) => r.box.width < 1.5).map((r) => r.box.x)]).filter((x) => x >= -1 && x <= width + 1);
  const ys = cluster([0, height, ...cells.flatMap((f) => [f.box.y, f.box.y + f.box.height]), ...rules.filter((r) => r.box.height < 1.5).map((r) => r.box.y)]).filter((y) => y >= -1 && y <= height + 1);
  if (xs.length < 4 || ys.length < 4) return null;
  const R = ys.length - 1, C = xs.length - 1;
  // The fill painted last over each grid cell (page backgrounds count, so margins keep the page colour).
  const owner: number[][] = Array.from({ length: R }, () => Array(C).fill(-1));
  const all = fills;
  for (let r = 0; r < R; r++) for (let c = 0; c < C; c++) {
    const cx = (xs[c]! + xs[c + 1]!) / 2, cy = (ys[r]! + ys[r + 1]!) / 2;
    for (let i = all.length - 1; i >= 0; i--) { const b = all[i]!.box; if (cx >= b.x && cx <= b.x + b.width && cy >= b.y && cy <= b.y + b.height) { owner[r]![c] = i; break; } }
  }
  const covered = (r: { box: VectorShape['box'] }, along: 'x' | 'y', at: number, from: number, to: number) => along === 'x'
    ? Math.abs(r.box.x - at) <= TOLERANCE && r.box.y <= from + TOLERANCE && r.box.y + r.box.height >= to - TOLERANCE
    : Math.abs(r.box.y - at) <= TOLERANCE && r.box.x <= from + TOLERANCE && r.box.x + r.box.width >= to - TOLERANCE;
  // A wall separates two neighbouring grid cells when different fills own them or a rule runs between them.
  const wallRight = (r: number, c: number) => owner[r]![c] !== owner[r]![c + 1] || rules.some((x) => covered(x, 'x', xs[c + 1]!, ys[r]!, ys[r + 1]!));
  const wallBelow = (r: number, c: number) => owner[r]![c] !== owner[r + 1]![c] || rules.some((x) => covered(x, 'y', ys[r + 1]!, xs[c]!, xs[c + 1]!));
  // Text belongs to the grid cell holding the centre of each run.
  const textAt: Run[][][] = Array.from({ length: R }, () => Array.from({ length: C }, () => []));
  for (const run of runs) { if (!run.text.trim()) continue; const r = Math.min(R - 1, Math.max(0, snapCell(ys, run.baseline - run.size * 0.35))), c = Math.min(C - 1, Math.max(0, snapCell(xs, run.x + Math.min(run.width, run.size * 2) / 2))); textAt[r]![c]!.push(run); }
  const taken: boolean[][] = Array.from({ length: R }, () => Array(C).fill(false)), regions: GridRegion[] = [];
  for (let r = 0; r < R; r++) for (let c = 0; c < C; c++) {
    if (taken[r]![c]) continue;
    let cols = 1, rows = 1;
    while (c + cols < C && !taken[r]![c + cols] && !wallRight(r, c + cols - 1)) cols++;
    grow: while (r + rows < R) {
      for (let k = 0; k < cols; k++) { if (taken[r + rows]![c + k] || wallBelow(r + rows - 1, c + k) || (k < cols - 1 && wallRight(r + rows, c + k))) break grow; }
      if (c + cols < C && !wallRight(r + rows, c + cols - 1)) break;
      if (c > 0 && !wallRight(r + rows, c - 1)) break;
      rows++;
    }
    const runsIn = Array.from({ length: rows }, (_, i) => Array.from({ length: cols }, (_, k) => textAt[r + i]![c + k]!)).flat(2);
    // Empty stretches (page margins, gaps) are not merged: only cells that hold text or a cell fill.
    if (!runsIn.length && (owner[r]![c]! < 0 || all[owner[r]![c]!]!.page)) { cols = 1; rows = 1; }
    for (let i = 0; i < rows; i++) for (let k = 0; k < cols; k++) taken[r + i]![c + k] = true;
    const box = { x: xs[c]!, y: ys[r]!, width: xs[c + cols]! - xs[c]!, height: ys[r + rows]! - ys[r]! }, own = owner[r]![c]!;
    const fill = own >= 0 ? all[own]!.color : undefined;
    const edge = (along: 'x' | 'y', at: number, from: number, to: number): GridEdge | undefined => { const rule = rules.find((x) => covered(x, along, at, from, to)); return rule?.stroke ? { color: rule.stroke.color, width: rule.stroke.width } : undefined; };
    const borders = { top: edge('y', box.y, box.x, box.x + box.width), bottom: edge('y', box.y + box.height, box.x, box.x + box.width), left: edge('x', box.x, box.y, box.y + box.height), right: edge('x', box.x + box.width, box.y, box.y + box.height) };
    regions.push({ row: r, col: c, rows, cols, borders: Object.values(borders).some(Boolean) ? borders : undefined, fill: fill && fill !== '#ffffff' ? fill : undefined, page: own >= 0 && all[own]!.page, text: cellText(runsIn.length ? runsIn : [], box) });
  }
  // Tables: the bounding box of the non-page cells and rules, for formats that keep the rest as layout.
  const xsT = [...cells.flatMap((f) => [f.box.x, f.box.x + f.box.width]), ...rules.map((r) => r.box.x), ...rules.map((r) => r.box.x + r.box.width)];
  const ysT = [...cells.flatMap((f) => [f.box.y, f.box.y + f.box.height]), ...rules.map((r) => r.box.y), ...rules.map((r) => r.box.y + r.box.height)];
  const tables = xsT.length ? [{ col: snap(xs, Math.min(...xsT)), row: snap(ys, Math.min(...ysT)), cols: Math.max(1, snap(xs, Math.max(...xsT)) - snap(xs, Math.min(...xsT))), rows: Math.max(1, snap(ys, Math.max(...ysT)) - snap(ys, Math.min(...ysT))) }] : [];
  return { xs, ys, regions, width, height, tables };
}
/** Index of the grid track containing v. */
function snapCell(edges: number[], v: number) { let i = 0; while (i < edges.length - 2 && v > edges[i + 1]!) i++; return i; }

/** The ruled/filled table area of a grid as a self-contained table (for Word and PowerPoint, where the
 * rest of the page stays as positioned layout). Cell rows/cols are relative to the table. */
export interface GridTable { x: number; y: number; width: number; height: number; colW: number[]; rowH: number[]; cells: GridRegion[] }
export function tableOf(grid: PageGrid): GridTable | null {
  const t = grid.tables[0];
  if (!t || t.rows < 1 || t.cols < 1) return null;
  const cells = grid.regions.filter((r) => r.row >= t.row && r.col >= t.col && r.row + r.rows <= t.row + t.rows && r.col + r.cols <= t.col + t.cols).map((r) => ({ ...r, row: r.row - t.row, col: r.col - t.col }));
  // Every grid cell of the area must belong to exactly one region, or the table would not be rectangular.
  const count = cells.reduce((n, r) => n + r.rows * r.cols, 0);
  if (count !== t.rows * t.cols || !cells.some((c) => c.text)) return null;
  const xs = grid.xs.slice(t.col, t.col + t.cols + 1), ys = grid.ys.slice(t.row, t.row + t.rows + 1);
  return { x: xs[0]!, y: ys[0]!, width: xs.at(-1)! - xs[0]!, height: ys.at(-1)! - ys[0]!, colW: xs.slice(1).map((x, i) => x - xs[i]!), rowH: ys.slice(1).map((y, i) => y - ys[i]!), cells };
}
/** Whether a box lies within the table (with a small margin for strokes). */
export const insideTable = (t: GridTable, box: { x: number; y: number; width: number; height: number }) => box.x >= t.x - 3 && box.y >= t.y - 3 && box.x + box.width <= t.x + t.width + 3 && box.y + box.height <= t.y + t.height + 3;
