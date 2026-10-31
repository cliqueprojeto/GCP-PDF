import type {Run, VectorShape} from './word-layout';
import {cellText, type GridEdge, type GridRegion, type GridTable} from './tables';
type Box = {x:number;y:number;width:number;height:number};
interface Segment { horizontal:boolean;at:number;from:number;to:number;color:string;width:number;invisible?:boolean }
export const TOL = 2.5;
const white = (c: string) => /^#f[a-f0-9]f[a-f0-9]f[a-f0-9]$/i.test(c);
function cluster(values: number[]) {
  const out: number[] = [];
  for (const v of [...values].sort((a, b) => a - b)) if (!out.length || v - out.at(-1)! > TOL) out.push(v); else out[out.length - 1] = (out.at(-1)! + v) / 2;
  return out;
}
/** The rectangles a path is made of: generators often draw all borders of a table row as one path. */
function pieces(shape: VectorShape): Box[] {
  const boxes: Box[] = [];
  let xs: number[] = [], ys: number[] = [];
  const flush = () => { if (xs.length) boxes.push({ x: Math.min(...xs), y: Math.min(...ys), width: Math.max(...xs) - Math.min(...xs), height: Math.max(...ys) - Math.min(...ys) }); xs = []; ys = []; };
  for (const s of shape.segments) {
    if (s.op === 'M') flush();
    if (s.op === 'Z') continue;
    xs.push(s.x); ys.push(s.y);
    if (s.op === 'C') { xs.push(s.x1, s.x2); ys.push(s.y1, s.y2); }
  }
  flush();
  return boxes;
}
/** Border segments and cell shadings of a page's vector art. */
export function strokes(shapes: VectorShape[]) {
  const segments: Segment[] = [], shades: { box: Box; color: string }[] = [];
  let decorative = 0;
  for (const shape of shapes) {
    const curved = shape.segments.some((s) => s.op === 'C');
    for (const b of pieces(shape)) {
      const thin = Math.min(b.width, b.height), long = Math.max(b.width, b.height);
      if (shape.fill && shape.fill.alpha > 0.5) {
        if (white(shape.fill.color)) continue;
        // Thin bars are lines; so are long thick bars (a 3 pt rule above the footer).
        if ((thin <= TOL && long > 4) || (thin <= 3.5 && long >= thin * 30)) segments.push(b.height <= b.width ? { horizontal: true, at: b.y + b.height / 2, from: b.x, to: b.x + b.width, color: shape.fill.color, width: Math.max(0.25, b.height) } : { horizontal: false, at: b.x + b.width / 2, from: b.y, to: b.y + b.height, color: shape.fill.color, width: Math.max(0.25, b.width) });
        // Specks (corner joints of borders) are neither lines nor shading.
        else if (long > 4) { shades.push({ box: b, color: shape.fill.color }); if (curved) decorative++; }
      }
      if (shape.stroke && shape.stroke.alpha > 0.5 && !curved) {
        const { color, width } = shape.stroke;
        if (b.height <= TOL && b.width > 4) segments.push({ horizontal: true, at: b.y + b.height / 2, from: b.x, to: b.x + b.width, color, width });
        else if (b.width <= TOL && b.height > 4) segments.push({ horizontal: false, at: b.x + b.width / 2, from: b.y, to: b.y + b.height, color, width });
        else if (b.width > 4 && b.height > 4) segments.push({ horizontal: true, at: b.y, from: b.x, to: b.x + b.width, color, width }, { horizontal: true, at: b.y + b.height, from: b.x, to: b.x + b.width, color, width }, { horizontal: false, at: b.x, from: b.y, to: b.y + b.height, color, width }, { horizontal: false, at: b.x + b.width, from: b.y, to: b.y + b.height, color, width });
      } else if (shape.stroke && curved) decorative++;
    }
  }
  // A shaded header row often has no ruled top: its own sides bound the cells. Shading nested in another
  // (a highlight behind a title inside a shaded cell) adds no cell boundary.
  const contains = (o: Box, i: Box) => i !== o && i.x >= o.x - TOL && i.y >= o.y - TOL && i.x + i.width <= o.x + o.width + TOL && i.y + i.height <= o.y + o.height + TOL;
  const outer = shades.filter((s) => !shades.some((o) => o !== s && contains(o.box, s.box) && o.box.width * o.box.height > s.box.width * s.box.height));
  for (const { box: b } of outer) segments.push(
    { horizontal: true, at: b.y, from: b.x, to: b.x + b.width, color: '#000000', width: 0, invisible: true }, { horizontal: true, at: b.y + b.height, from: b.x, to: b.x + b.width, color: '#000000', width: 0, invisible: true },
    { horizontal: false, at: b.x, from: b.y, to: b.y + b.height, color: '#000000', width: 0, invisible: true }, { horizontal: false, at: b.x + b.width, from: b.y, to: b.y + b.height, color: '#000000', width: 0, invisible: true });
  // Drawn lines first, so a border found at a position is the visible one.
  segments.sort((a, b) => Number(!!a.invisible) - Number(!!b.invisible));
  return { segments, shades, decorative };
}
/** Groups of touching segments: each is a table frame, or a lone rule. */
export function frames(segments: Segment[]) {
  const parent = segments.map((_, i) => i), find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i]!)));
  const touch = (a: Segment, b: Segment) => a.horizontal === b.horizontal
    ? Math.abs(a.at - b.at) <= TOL && a.from <= b.to + TOL && b.from <= a.to + TOL
    : (() => { const h = a.horizontal ? a : b, v = a.horizontal ? b : a; return v.at >= h.from - TOL && v.at <= h.to + TOL && h.at >= v.from - TOL && h.at <= v.to + TOL; })();
  for (let i = 0; i < segments.length; i++) for (let j = i + 1; j < segments.length; j++) if (touch(segments[i]!, segments[j]!)) parent[find(i)] = find(j);
  const groups = new Map<number, Segment[]>();
  segments.forEach((s, i) => { const g = groups.get(find(i)) ?? []; g.push(s); groups.set(find(i), g); });
  return [...groups.values()];
}
/** Joins pieces of the same line (borders are often drawn cell by cell) into continuous segments. */
function joined(list: Segment[]) {
  const out: Segment[] = [];
  for (const s of [...list].sort((a, b) => Number(!!a.invisible) - Number(!!b.invisible) || a.at - b.at || a.from - b.from)) {
    const last = out.find((o) => !!o.invisible === !!s.invisible && Math.abs(o.at - s.at) <= TOL && s.from <= o.to + TOL && s.to >= o.from - TOL);
    if (last) { last.from = Math.min(last.from, s.from); last.to = Math.max(last.to, s.to); last.width = Math.max(last.width, s.width); }
    else out.push({ ...s });
  }
  return out;
}
/** A ruled table from one frame: rows and columns from its lines, merged where no line divides cells. */
export function frameTable(frame: Segment[], shades: { box: Box; color: string }[], runs: Run[], allowEmpty = false): { table: GridTable; padding: number; paddingTop: number } | null {
  const hs = joined(frame.filter((s) => s.horizontal)), vs = joined(frame.filter((s) => !s.horizontal));
  if (hs.length < 2 || vs.length < 2 || frame.filter((s) => !s.invisible).length < 3) return null;
  const xs = cluster(vs.map((s) => s.at)), ys = cluster(hs.map((s) => s.at));
  if (xs.length < 2 || ys.length < 2) return null;
  const R = ys.length - 1, C = xs.length - 1;
  const line = (list: Segment[], at: number, from: number, to: number) => list.find((s) => Math.abs(s.at - at) <= TOL && s.from <= from + TOL && s.to >= to - TOL);
  const wallRight = (r: number, c: number) => !!line(vs, xs[c + 1]!, ys[r]!, ys[r + 1]!), wallBelow = (r: number, c: number) => !!line(hs, ys[r + 1]!, xs[c]!, xs[c + 1]!);
  const taken = Array.from({ length: R }, () => Array<boolean>(C).fill(false)), cells: GridRegion[] = [];
  const inside = (run: Run, b: Box) => { const cx = run.x + Math.min(run.width, run.size) / 2, cy = run.baseline - run.size * 0.35; return cx >= b.x && cx <= b.x + b.width && cy >= b.y && cy <= b.y + b.height; };
  const insets: number[] = [], tops: number[] = [];
  for (let r = 0; r < R; r++) for (let c = 0; c < C; c++) {
    if (taken[r]![c]) continue;
    let cols = 1, rows = 1;
    while (c + cols < C && !taken[r]![c+cols] && !wallRight(r, c + cols - 1)) cols++;
    grow: while (r + rows < R) {
      for (let k = 0; k < cols; k++) if (taken[r + rows]![c + k] || wallBelow(r + rows - 1, c + k) || (k<cols-1&&wallRight(r+rows,c+k))) break grow;
      if(c+cols<C&&!wallRight(r+rows,c+cols-1))break;
      if(c>0&&!wallRight(r+rows,c-1))break;
      rows++;
    }
    for (let i = 0; i < rows; i++) for (let k = 0; k < cols; k++) taken[r + i]![c + k] = true;
    const box = { x: xs[c]!, y: ys[r]!, width: xs[c + cols]! - xs[c]!, height: ys[r + rows]! - ys[r]! };
    const edge = (s?: Segment): GridEdge | undefined => (s && !s.invisible ? { color: s.color, width: s.width } : undefined);
    const borders = { top: edge(line(hs, box.y, box.x, box.x + box.width)), bottom: edge(line(hs, box.y + box.height, box.x, box.x + box.width)), left: edge(line(vs, box.x, box.y, box.y + box.height)), right: edge(line(vs, box.x + box.width, box.y, box.y + box.height)) };
    const centre = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
    const shade = [...shades].reverse().find((s) => centre.x >= s.box.x && centre.x <= s.box.x + s.box.width && centre.y >= s.box.y && centre.y <= s.box.y + s.box.height && s.box.width * s.box.height < box.width * box.height * 4);
    const text = cellText(runs.filter((run) => inside(run, box)), box, true);
    if (text?.inset !== undefined && text.align !== 'center') insets.push(text.inset);
    const inCell = runs.filter((run) => inside(run, box));
    if (inCell.length && text?.valign === 'top') tops.push(Math.min(...inCell.map((run) => run.baseline - run.size * 0.95)) - box.y);
    cells.push({ row: r, col: c, rows, cols, borders, fill: shade?.color, text });
  }
  if (!allowEmpty && !cells.some((c) => c.text)) return null;
  insets.sort((a, b) => a - b);
  const padding = Math.max(0, Math.min(14, insets[Math.floor(insets.length / 2)] ?? 5.4));
  tops.sort((a, b) => a - b);
  const paddingTop = Math.max(0, Math.min(14, tops[Math.floor(tops.length / 2)] ?? 0));
  return { paddingTop, table: { x: xs[0]!, y: ys[0]!, width: xs.at(-1)! - xs[0]!, height: ys.at(-1)! - ys[0]!, colW: xs.slice(1).map((x, i) => x - xs[i]!), rowH: ys.slice(1).map((y, i) => y - ys[i]!), cells }, padding };
}

