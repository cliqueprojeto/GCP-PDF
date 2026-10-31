import type { Run } from './word-layout';

/** A word recognized on a scanned page, in page points (top-left origin). */
export interface OcrWord { text: string; x: number; y: number; width: number; height: number; confidence: number; baseline: number }
/** A recognized line: its words, Tesseract's row height (close to the font size) and its box height, in points. */
export interface OcrLine { words: OcrWord[]; rowHeight: number; height: number }
export interface OcrMeasure {
  /** Mean stroke thickness inside a box of the page image (average run of dark pixels along each row):
   * bold strokes are thicker whatever the letters, capitals or not. */
  stroke(box: { x: number; y: number; width: number; height: number }): number;
  /** Width in points of `text` set in `family` at `size` points. */
  width(text: string, family: string, size: number, bold: boolean): number;
}

const MIN_CONFIDENCE = 60;
const median = (values: number[]) => { const sorted = [...values].sort((a, b) => a - b); return sorted.length ? sorted[Math.floor(sorted.length / 2)]! : 0; };
/** Words whose letters are all the same height class say little about the font; longer ones measure best. */
const measurable = (w: OcrWord) => w.text.length >= 4 && /^[\p{L}\p{N}]/u.test(w.text);

/** Turns OCR lines into the runs the Office exports lay out, recovering what a scan does not say:
 * - artwork read as text (logos: a line box far taller than its row) and unsure words stay in the picture;
 * - bold from stroke thickness: a bold word's strokes are clearly thicker than the page's typical word, and
 *   very short words follow their neighbours (a few strokes measure poorly);
 * - the font: each installed family is tried on the scanned words; the right one gives every word the same
 *   size (width ÷ width at 1 pt), and that size is the line's font size, snapped to the page's body size. */
export function ocrRuns(lines: OcrLine[], measure: OcrMeasure, families: string[]): { runs: Run[]; family: string } {
  const kept = lines
    .filter((line) => !(line.rowHeight > 0 && line.height > line.rowHeight * 1.8))
    // Vertical rules and frame edges come back as "|" or "I" pieces; they are drawing, not text.
    .map((line) => ({ ...line, words: line.words.filter((w) => w.confidence >= MIN_CONFIDENCE && w.text.trim() && !/^[|¦!]+$/.test(w.text.trim())) }))
    .filter((line) => line.words.length);
  const typical = median(kept.flatMap((line) => line.words.filter(measurable).map((w) => measure.stroke(w))));
  const heavy = kept.map((line) => line.words.map((w) => typical > 0 && w.text.length >= 3 && measure.stroke(w) > typical * 1.25));
  const bold = kept.map((line, i) => line.words.map((w, j) => (w.text.length >= 3 ? heavy[i]![j]! : (heavy[i]![j - 1] ?? true) && (heavy[i]![j + 1] ?? true) && (j > 0 || j < line.words.length - 1))));
  // Size implied by each family for each measurable word.
  const implied = (family: string, w: OcrWord, b: boolean) => w.width / Math.max(0.01, measure.width(w.text, family, 1, b));
  let family = families[0] ?? 'Arial', best = Infinity;
  for (const candidate of families) {
    const sizes = kept.flatMap((line, i) => line.words.flatMap((w, j) => (measurable(w) ? [implied(candidate, w, bold[i]![j]!) / (line.rowHeight || 1)] : []))).slice(0, 300);
    if (sizes.length < 3) continue;
    const centre = median(sizes), spread = median(sizes.map((s) => Math.abs(s - centre))) / centre;
    if (spread < best) { best = spread; family = candidate; }
  }
  const lineSize = kept.map((line, i) => {
    const sizes = line.words.flatMap((w, j) => (measurable(w) ? [implied(family, w, bold[i]![j]!)] : []));
    return sizes.length ? median(sizes) : null;
  });
  const body = median(lineSize.filter((s, i): s is number => s !== null && kept[i]!.words.length >= 4));
  // Lines without a word long enough to measure ("[X] Não") take the body size unless their row is clearly taller.
  const rowBody = median(kept.filter((line) => line.words.length >= 4).map((line) => line.rowHeight).filter((h) => h > 0));
  const size = lineSize.map((s, i) => Math.max(4, s === null ? (body && rowBody && kept[i]!.rowHeight > rowBody * 1.3 ? body * kept[i]!.rowHeight / rowBody : body || kept[i]!.rowHeight || kept[i]!.height * 0.8) : body && Math.abs(s / body - 1) < 0.12 ? body : s));
  const runs: Run[] = kept.flatMap((line, i) => line.words.map((w, j) => ({ text: w.text, x: w.x, baseline: w.baseline, width: w.width, size: Math.round(size[i]! * 2) / 2, font: family, bold: bold[i]![j]!, italic: false, color: '#000000', space: j > 0 })));
  return { runs, family };
}
