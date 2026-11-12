import {t as translateUi, getLocale} from "./i18n";
import React, { useEffect, useLayoutEffect, useRef, useState } from "react";
import { X, List, Type, Play, Pause, ChevronLeft, ChevronRight, LoaderCircle, BookOpen, Copy, BookA, Languages, Underline, MessageSquarePlus, BookmarkPlus, Bookmark as BookmarkIcon, NotebookPen, Trash2, Timer, ListTree, Highlighter, Search, Maximize2, Minimize2, Minus, Plus, AlignLeft, AlignJustify, AlignCenter, BookText, Columns2, FileText, ScrollText, Globe } from "lucide-react";
import type { BookContent } from "../shared/types";
import { LookupDialog, type LookupMode } from "./Lookup";
import { recordRecentFile } from "./Home";
import { readerSearchUrl } from "../shared/reader-search";

/** Exibição > Livro: reads EPUB books page by page or as one scroll. The book's sanitized HTML lives in a
 * sandboxed iframe without scripts; CSS columns make the pages, and the reader remembers where each book
 * was by a character position in its chapter, which survives any change of font, margins or window. */
type Theme = "claro" | "sepia" | "noturno";
type Effect = "deslizar" | "virar" | "desvanecer" | "nenhum";
type Align = "original" | "left" | "justify" | "center";
type Layout = "paginas" | "rolagem";
interface Prefs { font: "original" | "serif" | "sans" | "legivel"; size: number; leading: number; margin: number; theme: Theme; spread: 1 | 2; effect: Effect; align: Align; layout: Layout; duration: number; scrollSpeed: number }
const DEFAULTS: Prefs = { font: "original", size: 100, leading: 1.55, margin: 6, theme: "claro", spread: 1, effect: "deslizar", align: "original", layout: "paginas", duration: 300, scrollSpeed: 40 };
const FONTS: Record<Prefs["font"], string | null> = { original: null, serif: 'Georgia, "Iowan Old Style", "Times New Roman", serif', sans: '"Segoe UI", Inter, "Helvetica Neue", Arial, sans-serif', legivel: 'Verdana, "Atkinson Hyperlegible", Tahoma, sans-serif' };
const THEMES: Record<Theme, { bg: string; ink: string; link: string }> = { claro: { bg: "#ffffff", ink: "#1d1d1f", link: "#5b2bc0" }, sepia: { bg: "#f4ecd8", ink: "#433422", link: "#8a4b14" }, noturno: { bg: "#15151b", ink: "#d8d6e2", link: "#a99bff" } };
const COLORS = ["#ffd43b", "#69db7c", "#74c0fc", "#f783ac"];
const load = <T,>(key: string, fallback: T): T => { try { const raw = localStorage.getItem(key); return raw ? { ...fallback, ...JSON.parse(raw) } : fallback; } catch { return fallback; } };
const loadList = <T,>(key: string): T[] => { try { const raw = JSON.parse(localStorage.getItem(key) ?? "[]"); return Array.isArray(raw) ? raw : []; } catch { return []; } };
const save = (key: string, value: unknown) => { try { localStorage.setItem(key, JSON.stringify(value)); } catch {} };
const uid = () => (crypto.randomUUID ? crypto.randomUUID() : String(Date.now() + Math.random()));

/** A highlight, underline or bookmark: a character range in one chapter's text (end = start for a bookmark). */
interface BookMark { id: string; kind: "mark" | "bookmark"; chapter: number; start: number; end: number; text: string; color: string; style: "highlight" | "underline"; note?: string; fraction?: number; createdAt: string }
/** Where the reader was: the chapter and the first character of the page; the fraction is the fallback of older versions. */
interface Spot { chapter: number; fraction: number; start?: number }
type TocEntry = BookContent["toc"][number];

/** Generic navigation labels many books carry in English, shown in the interface language. */
const LABELS: Record<string, [string, string]> = {
  start: ["Início", "Inicio"], begin: ["Início", "Inicio"], cover: ["Capa", "Portada"], "title page": ["Folha de rosto", "Portadilla"], titlepage: ["Folha de rosto", "Portadilla"],
  contents: ["Sumário", "Índice"], "table of contents": ["Sumário", "Índice"], toc: ["Sumário", "Índice"], copyright: ["Direitos autorais", "Derechos de autor"], dedication: ["Dedicatória", "Dedicatoria"],
  acknowledgments: ["Agradecimentos", "Agradecimientos"], acknowledgements: ["Agradecimentos", "Agradecimientos"], foreword: ["Prefácio", "Prólogo"], preface: ["Prefácio", "Prefacio"], introduction: ["Introdução", "Introducción"],
  prologue: ["Prólogo", "Prólogo"], epilogue: ["Epílogo", "Epílogo"], afterword: ["Posfácio", "Epílogo"], "about the author": ["Sobre o autor", "Sobre el autor"], index: ["Índice remissivo", "Índice alfabético"],
  notes: ["Notas", "Notas"], footnotes: ["Notas", "Notas"], endnotes: ["Notas", "Notas"], bibliography: ["Bibliografia", "Bibliografía"], glossary: ["Glossário", "Glosario"], appendix: ["Apêndice", "Apéndice"], "also by": ["Do mesmo autor", "Del mismo autor"],
};
function label(title: string) {
  const locale = getLocale(); if (locale === "en") return title;
  const at = locale === "es" ? 1 : 0, key = title.trim().toLowerCase().replace(/\s+/g, " ");
  if (LABELS[key]) return LABELS[key]![at];
  const numbered = /^(chapter|part|book)\s+(.+)$/i.exec(title.trim());
  if (numbered) return `${({ chapter: ["Capítulo", "Capítulo"], part: ["Parte", "Parte"], book: ["Livro", "Libro"] } as Record<string, [string, string]>)[numbered[1]!.toLowerCase()]![at]} ${numbered[2]}`;
  return title;
}
function duration(ms: number) {
  const minutes = Math.round(ms / 60000);
  if (minutes < 1) return translateUi("menos de 1 min");
  const hours = Math.floor(minutes / 60), rest = minutes % 60;
  return hours ? `${hours} h${rest ? ` ${rest} min` : ""}` : `${minutes} min`;
}

// Text positions inside the book document: character offsets of a chapter's text, independent of layout.
function textNodes(root: Node) { const walker = root.ownerDocument!.createTreeWalker(root, NodeFilter.SHOW_TEXT), out: Text[] = []; for (let n = walker.nextNode(); n; n = walker.nextNode()) out.push(n as Text); return out; }
function sectionOf(node: Node | null) { const el = node && (node.nodeType === 1 ? node as Element : node.parentElement); return el?.closest<HTMLElement>(".gcp-chapter") ?? null; }
function offsetIn(section: HTMLElement, node: Node, offset: number) { const r = section.ownerDocument.createRange(); r.setStart(section, 0); r.setEnd(node, offset); return r.toString().length; }
function rangeAt(section: HTMLElement, start: number, end: number) {
  const r = section.ownerDocument.createRange(); let pos = 0, started = false;
  for (const t of textNodes(section)) {
    const length = t.data.length;
    if (!started && start < pos + length) { r.setStart(t, start - pos); started = true; }
    if (started && end <= pos + length) { r.setEnd(t, Math.max(r.startContainer === t ? r.startOffset : 0, end - pos)); return r; }
    pos += length;
  }
  return started ? (r.setEnd(section, section.childNodes.length), r) : null;
}
/** Wraps each saved highlight in <mark> elements; marks only split text nodes, so offsets stay valid. */
function paint(d: Document, marks: BookMark[]) {
  const parents = new Set<Node>();
  for (const old of [...d.querySelectorAll("mark.gcp-mark")]) { if (old.parentNode) parents.add(old.parentNode); old.replaceWith(...old.childNodes); }
  for (const parent of parents) parent.normalize();
  for (const m of marks) {
    if (m.kind !== "mark") continue;
    const section = d.getElementById(`c${m.chapter}`); if (!section) continue;
    let pos = 0;
    for (const t of textNodes(section)) {
      const length = t.data.length, a = Math.max(m.start, pos), b = Math.min(m.end, pos + length);
      if (b > a && t.data.slice(a - pos, b - pos).trim()) {
        let node = t; if (a > pos) node = node.splitText(a - pos); if (b < pos + length) node.splitText(b - a);
        const mark = d.createElement("mark"); mark.className = `gcp-mark ${m.style}${m.note ? " noted" : ""}`; mark.dataset.mark = m.id; mark.style.setProperty("--mark", m.color + (m.style === "highlight" ? "88" : ""));
        if (m.note) mark.title = m.note;
        node.replaceWith(mark); mark.append(node);
      }
      pos += length; if (pos >= m.end) break;
    }
  }
}
/** Builds a table of contents from the titles printed in the book when it has none: headings, and short
 * lines such as "Capítulo 3", "Parte II" or a lone Roman numeral. Same document, same ids every time. */
function mapChapters(d: Document): TocEntry[] {
  const found: TocEntry[] = [], WORD = /^(cap[ií]tulo|chapter|parte|part|livro|book|pr[oó]logo|prologue|ep[ií]logo|epilogue|introdu[cç][aã]o|introduction|pref[aá]cio|preface|apresenta[cç][aã]o|posf[aá]cio)\b/i;
  let k = 0, h3 = 0;
  const nodes = [...d.querySelectorAll<HTMLElement>(".gcp-chapter h1, .gcp-chapter h2, .gcp-chapter h3, .gcp-chapter p, .gcp-chapter div")];
  for (const el of nodes) {
    const text = (el.textContent ?? "").replace(/\s+/g, " ").trim(), tag = el.localName;
    if (!text || text.length > 120) continue;
    let level = 0;
    if (/^h[1-3]$/.test(tag)) level = Number(tag[1]);
    else if (!el.querySelector("p, div, h1, h2, h3, h4, li, table") && text.length <= 80 && (WORD.test(text) || /^[IVXLC]{1,7}\.?$/.test(text) || /^\d{1,3}\.?$/.test(text))) level = WORD.test(text) ? 1 : 2;
    if (!level) continue;
    if (level === 3) h3++;
    const chapter = Number(el.closest<HTMLElement>(".gcp-chapter")?.dataset.chapter ?? 0);
    if (found.at(-1)?.title === text && found.at(-1)?.chapter === chapter) continue;
    if (!el.id) el.id = `gcp-map-${k}`;
    k++;
    found.push({ title: text, chapter, anchor: el.id, level });
  }
  return h3 > 400 ? found.filter((t) => t.level < 3) : found;
}

function bookDocument(book: BookContent, prefs: Prefs, width: number) {
  const theme = THEMES[prefs.theme], font = FONTS[prefs.font], paged = prefs.layout === "paginas", spread = paged && width >= 900 ? prefs.spread : 1;
  const side = Math.round(width * prefs.margin / 100 / spread), gap = side * 2, column = (width - side * 2 - gap * (spread - 1)) / spread;
  const align = prefs.align === "original" ? "" : `body p,body div,body li,body dd,body blockquote,body section{text-align:${prefs.align}!important${prefs.align === "justify" ? ";hyphens:auto" : ""}}`;
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'; font-src data:; media-src 'none'">
<style>${book.css}</style>
<style>
${paged
  ? `html{height:100%;overflow:hidden;font-size:${prefs.size}%;background:${theme.bg}}
body{margin:0!important;box-sizing:border-box;height:100vh;padding:7vh ${side}px!important;column-width:${column}px;column-gap:${gap}px;column-fill:auto;background:${theme.bg}!important;color:${theme.ink}!important;overflow:visible;max-width:none!important;width:auto!important}
/* Each chapter opens a page. Chromium ignores a forced break on the chapter element itself after
   nested sections, so the break sits on a leading pseudo-element. */
.gcp-chapter+.gcp-chapter::before{content:"";display:block;break-before:column}`
  : `html{height:100%;overflow-x:hidden;overflow-y:auto;font-size:${prefs.size}%;background:${theme.bg};scrollbar-width:thin}
body{margin:0!important;box-sizing:border-box;min-height:100vh;padding:6vh ${side}px 40vh!important;background:${theme.bg}!important;color:${theme.ink}!important;max-width:none!important;width:auto!important}
.gcp-chapter+.gcp-chapter::before{content:"";display:block;width:30%;margin:3.5em auto;border-top:1px solid ${theme.ink}33}`}
body *{color:inherit!important;background-color:transparent!important;line-height:${prefs.leading}!important;max-width:100%}
${font ? `body,body *{font-family:${font}!important}` : ""}
${align}
a{color:${theme.link}!important}
img,svg{max-height:calc(86vh);height:auto;object-fit:contain;break-inside:avoid}
.gcp-chapter *{break-before:auto!important;page-break-before:auto!important}
p{orphans:2;widows:2}
::selection{background:${theme.link}44}
mark.gcp-mark{background-color:var(--mark)!important;color:inherit!important;border-radius:2px;padding:0;cursor:pointer}
mark.gcp-mark.underline{background-color:transparent!important;text-decoration:underline 2px var(--mark)!important;text-underline-offset:3px}
mark.gcp-mark.noted{box-shadow:inset 0 -2px 0 ${theme.link}}
mark.gcp-mark.flash{outline:2px solid ${theme.link};outline-offset:1px}
</style></head><body>${book.html}</body></html>`;
}

type Menu = { x: number; y: number; text: string; passage?: { chapter: number; start: number; end: number; rect: DOMRect }; markId?: string };

export function BookReader({ token, onClose, onError }: { token: string; onClose: () => void; onError: (error: unknown) => void }) {
  const [book, setBook] = useState<BookContent | null>(null), [prefs, setPrefsState] = useState<Prefs>(() => load("gcp.reader", DEFAULTS));
  const [page, setPage] = useState(0), [pages, setPages] = useState(1), [panel, setPanel] = useState<"toc" | "type" | "notes" | "search" | null>(null), [auto, setAuto] = useState(false), [note, setNote] = useState<string | null>(null);
  const [query, setQuery] = useState(""), [found, setFound] = useState<{ chapter: number; start: number; end: number; before: string; match: string; after: string }[] | null>(null), [fullscreen, setFullscreen] = useState(false);
  const [size, setSize] = useState({ width: 0, height: 0 }), [turn, setTurn] = useState<"" | "out-next" | "out-prev" | "in-next" | "in-prev">("");
  const [marks, setMarksState] = useState<BookMark[]>([]), [menu, setMenu] = useState<Menu | null>(null), [editing, setEditing] = useState<{ id: string; x: number; y: number } | null>(null);
  const [lookup, setLookup] = useState<{ text: string; mode: LookupMode } | null>(null), [mapped, setMapped] = useState<TocEntry[] | null>(null), [banner, setBanner] = useState(false);
  const [tocPages, setTocPages] = useState<number[]>([]), [speed, setSpeed] = useState(() => load("gcp.reading-speed", { msPerChar: 48 }).msPerChar), [charsPerPage, setCharsPerPage] = useState(0);
  const [documentRevision, setDocumentRevision] = useState(0);
  const loadedHtml = useRef<string | null>(null);
  const frame = useRef<HTMLIFrameElement>(null), stage = useRef<HTMLDivElement>(null), starts = useRef<number[]>([]), pageRef = useRef(0), restoring = useRef<Spot | null>(null), lastSpot = useRef<Spot | null>(null);
  const userMoved = useRef(false), anim = useRef(0), animating = useRef(false), saveTimer = useRef(0), pendingSave = useRef<(() => void) | null>(null), lastTurn = useRef(Date.now());
  const { width, height } = size, paged = prefs.layout === "paginas";
  const setPrefs = (patch: Partial<Prefs>) => { if (patch.layout === "paginas") setAuto(false); setPrefsState((p) => { const next = { ...p, ...patch }; save("gcp.reader", next); return next; }); };
  const setMarks = (next: BookMark[]) => { setMarksState(next); if (book) save(`gcp.book-notes:${book.id}`, next.slice(-5000)); const d = doc(); if (d) paint(d, next); };
  const toc = mapped ?? book?.toc ?? [];
  const dismissMenu = () => { setMenu(null); doc()?.getSelection()?.removeAllRanges(); };
  useEffect(() => {
    const outside = (e: PointerEvent) => { if (!(e.target as Element).closest(".book-panel,[data-reader-panel]")) setPanel(null); };
    document.addEventListener("pointerdown", outside);
    return () => document.removeEventListener("pointerdown", outside);
  }, []);
  useEffect(() => {
    void window.gcp.readBook(token).then((b) => {
      setBook(b); restoring.current = load<Spot>(`gcp.book:${b.id}`, { chapter: 0, fraction: 0 }); document.title = `${b.title} — GCP-PDF`;
      setMarksState(loadList<BookMark>(`gcp.book-notes:${b.id}`));
      setBanner(!!b.tocGenerated && !localStorage.getItem(`gcp.book-map:${b.id}`) && !sessionStorage.getItem(`gcp.book-map-dismissed:${b.id}`));
    }).catch((error) => { onError(error); onClose(); });
  }, [token]);
  useLayoutEffect(() => {
    const node = stage.current; if (!node) return;
    const observer = new ResizeObserver(() => setSize({ width: Math.round(node.clientWidth), height: Math.round(node.clientHeight) }));
    observer.observe(node); return () => observer.disconnect();
  }, [!!book]);
  const doc = () => frame.current?.contentDocument ?? null;
  const unit = () => (paged ? width : height) || 1;
  const scrollPos = () => { const root = doc()?.documentElement; return root ? (paged ? root.scrollLeft : root.scrollTop) : 0; };
  const pageOfRect = (r: DOMRect) => Math.max(0, Math.floor(((paged ? r.left : r.top) + scrollPos() + 2) / unit()));
  const pageOfElement = (el: Element) => pageOfRect(el.getBoundingClientRect());
  /** Page count, the page of each chapter start and of each contents entry, from where the layout put them. */
  const measure = () => {
    const d = doc(); if (!d || !width || !height) return;
    const root = d.documentElement, total = Math.max(1, paged ? Math.round(root.scrollWidth / width) : Math.ceil((root.scrollHeight - height * 0.4) / height));
    setPages(total);
    starts.current = [...d.querySelectorAll<HTMLElement>(".gcp-chapter")].map(pageOfElement);
    setTocPages(toc.map((t) => { const el = t.anchor ? d.getElementById(t.anchor) : null; return el ? pageOfElement(el) : starts.current[t.chapter] ?? 0; }));
    setCharsPerPage((d.body.textContent ?? "").length / total);
    return total;
  };
  const chapterAt = (p: number) => { let c = 0; starts.current.forEach((s, i) => { if (s <= p) c = i; }); return c; };
  const fractionSpot = (p: number): Spot => { const c = chapterAt(p), from = starts.current[c] ?? 0, to = starts.current[c + 1] ?? pages; return { chapter: c, fraction: to > from ? (p - from) / (to - from) : 0 }; };
  /** The first character shown on the current page, probing a few points in case of an image or blank area. */
  const spotNow = (): Spot | null => {
    const d = doc(); if (!d || !width) return null;
    for (const fy of [0.1, 0.2, 0.35, 0.5]) for (const fx of [0.12, 0.3, 0.5]) {
      const r = d.caretRangeFromPoint?.(width * (paged && width >= 900 && prefs.spread === 2 ? fx / 2 : fx), height * fy), section = r && sectionOf(r.startContainer);
      if (r && section) return { ...fractionSpot(pageRef.current), chapter: Number(section.dataset.chapter), start: offsetIn(section, r.startContainer, r.startOffset) };
    }
    return null;
  };
  const pageOfSpot = (spot: Spot, total: number) => {
    const d = doc(), section = d?.getElementById(`c${spot.chapter}`);
    if (section && spot.start !== undefined) { const r = rangeAt(section, spot.start, spot.start + 1); const rect = r?.getClientRects()[0] ?? r?.getBoundingClientRect(); if (rect && (rect.width || rect.height || rect.left || rect.top)) return Math.min(total - 1, pageOfRect(rect)); }
    const from = starts.current[spot.chapter] ?? 0, to = starts.current[spot.chapter + 1] ?? total;
    return Math.max(0, Math.min(total - 1, from + Math.round(spot.fraction * (to - from))));
  };
  const scrollTo = (target: number, ms: number) => {
    const root = doc()?.documentElement; if (!root) return;
    cancelAnimationFrame(anim.current);
    const key = paged ? "scrollLeft" : "scrollTop";
    if (ms <= 0) { animating.current = false; root[key] = target; return; }
    const from = root[key], begin = performance.now();
    animating.current = true;
    const step = (now: number) => { const k = Math.min(1, (now - begin) / ms), e = k < 0.5 ? 2 * k * k : 1 - (-2 * k + 2) ** 2 / 2; root[key] = from + (target - from) * e; if (k < 1) anim.current = requestAnimationFrame(step); else animating.current = false; };
    anim.current = requestAnimationFrame(step);
  };
  const place = (p: number, ms: number) => scrollTo(p * unit(), ms);
  /** Saves the place shortly after the page settles: the character position, and the progress in the recent files list. */
  const remember = () => {
    window.clearTimeout(saveTimer.current);
    // Kept as the pending save, so closing the book right after turning a page still records the place.
    pendingSave.current = () => {
      pendingSave.current = null;
      if (!book) return;
      const spot = spotNow() ?? fractionSpot(pageRef.current);
      lastSpot.current = spot; save(`gcp.book:${book.id}`, spot);
      if (book.path) recordRecentFile({ path: book.path, name: book.name, openedAt: Date.now(), pageCount: Math.max(1, pages), book: { percent: Math.round(((pageRef.current + 1) / pages) * 100) } });
    };
    saveTimer.current = window.setTimeout(() => pendingSave.current?.(), prefs.duration + 250);
  };
  /** Runs a pending save now (closing the book or the window): a turn still animating is finished first. */
  const flushSave = () => {
    if (!pendingSave.current) return;
    window.clearTimeout(saveTimer.current);
    if (animating.current) { cancelAnimationFrame(anim.current); animating.current = false; place(pageRef.current, 0); }
    try { pendingSave.current(); } catch {}
  };
  const go = (target: number, direction: 1 | -1 = 1) => {
    const p = Math.max(0, Math.min(pages - 1, target));
    if (p === pageRef.current) return;
    userMoved.current = true;
    // Reading speed: time on a page just read forwards, ignoring glances and pauses.
    const spent = Date.now() - lastTurn.current; lastTurn.current = Date.now();
    if (p === pageRef.current + 1 && charsPerPage > 100 && spent > 4000 && spent < 600000) { const next = Math.max(8, Math.min(400, speed * 0.85 + (spent / charsPerPage) * 0.15)); setSpeed(next); save("gcp.reading-speed", { msPerChar: next }); }
    pageRef.current = p; setPage(p); remember();
    if (!paged || prefs.effect === "deslizar") place(p, prefs.duration);
    else if (prefs.effect === "nenhum") place(p, 0);
    else {
      const half = Math.max(60, prefs.duration / 2);
      setTurn(direction > 0 ? "out-next" : "out-prev");
      window.setTimeout(() => { place(p, 0); setTurn(direction > 0 ? "in-next" : "in-prev"); window.setTimeout(() => setTurn(""), half); }, half);
    }
  };
  const next = () => go(pageRef.current + 1, 1), previous = () => go(pageRef.current - 1, -1);
  const spotOfMark = (m: BookMark): Spot => ({ chapter: m.chapter, ...(m.fraction === undefined ? { start: m.start } : {}), fraction: m.fraction ?? 0 });
  const goToMark = (m: BookMark) => {
    if (m.kind === "bookmark") { const p = pageOfSpot(spotOfMark(m), pages); go(p, p >= pageRef.current ? 1 : -1); return; }
    const d = doc(), section = d?.getElementById(`c${m.chapter}`); if (!d || !section) return;
    const r = rangeAt(section, m.start, Math.max(m.end, m.start + 1)), rect = r?.getClientRects()[0]; if (!rect) return;
    go(pageOfRect(rect), pageOfRect(rect) >= pageRef.current ? 1 : -1);
    const els = [...d.querySelectorAll(`mark[data-mark="${CSS.escape(m.id)}"]`)]; els.forEach((el) => el.classList.add("flash")); window.setTimeout(() => els.forEach((el) => el.classList.remove("flash")), 1600);
  };
  // Layout changes (window, font, margins, mode) move the text: keep the reading position across them.
  const html = book && width && height ? bookDocument(book, prefs, width) : "";
  const onLoad = () => {
    const d = doc(); if (!d || !book) return;
    if (localStorage.getItem(`gcp.book-map:${book.id}`)) { const entries = mapChapters(d); if (entries.length) setMapped(entries); }
    paint(d, marks);
    loadedHtml.current = html;
    setDocumentRevision((v) => v + 1);
    d.addEventListener("pointerdown", () => setPanel(null));
    const spot = restoring.current ?? lastSpot.current ?? fractionSpot(pageRef.current);
    restoring.current = null; userMoved.current = false;
    // Images and fonts may still move the text after the first frame: settle on the saved character a few
    // times, unless the reader has already turned the page.
    const settle = () => { if (userMoved.current || doc() !== d) return; const total = measure() ?? pages, p = pageOfSpot(spot, total); pageRef.current = p; setPage(p); place(p, 0); };
    requestAnimationFrame(settle); for (const delay of [120, 400, 1000, 2000]) window.setTimeout(settle, delay);
    void d.fonts?.ready.then(settle);
    if (book.path) recordRecentFile({ path: book.path, name: book.name, openedAt: Date.now(), pageCount: Math.max(1, pages), book: { percent: Math.round(((pageRef.current + 1) / pages) * 100) } });
    d.addEventListener("click", (e) => click.current(e));
    d.addEventListener("contextmenu", (e) => { e.preventDefault(); context.current(e); });
    d.addEventListener("keydown", (e) => keys.current(e));
    d.addEventListener("wheel", (e) => { if (layoutRef.current !== "paginas") { userMoved.current = true; return; } e.preventDefault(); wheel.current(e.deltaY || e.deltaX); }, { passive: false });
    d.addEventListener("scroll", () => scrolled.current());
    // As in Play Livros, finishing a selection opens its actions right away; a right click works too.
    d.addEventListener("mouseup", (e) => { if (e.button === 0) window.setTimeout(() => selected.current(), 0); });
  };
  useEffect(() => { if (book && !restoring.current) restoring.current = lastSpot.current ?? fractionSpot(pageRef.current); }, [html]);
  useEffect(() => { measure(); }, [mapped]);
  const layoutRef = useRef(prefs.layout); layoutRef.current = prefs.layout;
  const keys = useRef((_e: KeyboardEvent) => {}), wheel = useRef((_d: number) => {}), click = useRef((_e: MouseEvent) => {}), context = useRef((_e: MouseEvent) => {}), scrolled = useRef(() => {}), selected = useRef(() => {}), lastWheel = useRef(0);
  keys.current = (e) => {
    if (lookup) return;
    if (e.key === "Escape") { if (menu) setMenu(null); else if (editing) setEditing(null); else if (note) setNote(null); else if (panel) setPanel(null); else onClose(); return; }
    if (["ArrowRight", "PageDown", " ", "ArrowDown"].includes(e.key)) { e.preventDefault(); next(); }
    else if (["ArrowLeft", "PageUp", "ArrowUp"].includes(e.key)) { e.preventDefault(); previous(); }
    else if (e.key === "Home") go(0, -1); else if (e.key === "End") go(pages - 1);
  };
  wheel.current = (delta) => { const now = Date.now(); if (now - lastWheel.current < 350 || Math.abs(delta) < 8) return; lastWheel.current = now; if (delta > 0) next(); else previous(); };
  // In scroll mode the reader moves the text freely: follow it to keep the page, progress and place.
  // Pages move only by turning: Chromium scrolls the columns by itself while a selection is dragged
  // against the edge of the page, which looked like the page turning. Put the page back.
  scrolled.current = () => { if (paged) { const root = doc()?.documentElement; if (root && !animating.current && Math.abs(root.scrollLeft - pageRef.current * width) > 1) root.scrollLeft = pageRef.current * width; return; } const p = Math.max(0, Math.min(pages - 1, Math.floor((scrollPos() + 2) / unit()))); if (p !== pageRef.current) { pageRef.current = p; setPage(p); } remember(); };
  click.current = (e) => {
    const d = doc(); if (!d) return;
    setMenu(null);
    const target = e.target as HTMLElement, markEl = target.closest?.<HTMLElement>("mark.gcp-mark");
    if (markEl?.dataset.mark && !d.getSelection()?.toString()) { openNote(markEl.dataset.mark, e.clientX, e.clientY); return; }
    const a = target.closest?.("a");
    if (!a) { if (!paged || d.getSelection()?.toString()) return; const x = e.clientX / width; if (x < 0.25) previous(); else if (x > 0.75) next(); return; }
    e.preventDefault();
    const external = a.getAttribute("data-external");
    if (external) { void window.gcp.openExternal(external).catch(onError); return; }
    const id = a.getAttribute("href")?.slice(1); const el = id ? d.getElementById(id) : null; if (!el) return;
    // A note reference opens the note over the page instead of leaving the text.
    const aside = el.closest("aside, [epub\\:type~='footnote'], .footnote, li[id]");
    if (a.getAttribute("epub:type")?.includes("noteref") || a.classList.contains("noteref") || (aside && /foot|note|nota/i.test(aside.getAttribute("epub:type") ?? aside.className ?? ""))) { setNote((aside ?? el).textContent?.replace(/\s+/g, " ").trim() ?? ""); return; }
    go(pageOfElement(el));
  };
  /** The selected words with their place in the chapter, when the selection stays inside one chapter. */
  const passageNow = () => {
    const d = doc(), selection = d?.getSelection(), text = selection?.toString().replace(/\s+/g, " ").trim() ?? "";
    let passage: Menu["passage"];
    if (text && selection?.rangeCount) {
      const r = selection.getRangeAt(0), section = sectionOf(r.startContainer);
      if (section && section === sectionOf(r.endContainer)) passage = { chapter: Number(section.dataset.chapter), start: offsetIn(section, r.startContainer, r.startOffset), end: offsetIn(section, r.endContainer, r.endOffset), rect: r.getBoundingClientRect() };
    }
    return { text, passage };
  };
  context.current = (e) => {
    const box = stage.current?.getBoundingClientRect(), x = (box?.left ?? 0) + e.clientX, y = (box?.top ?? 0) + e.clientY;
    const { text, passage } = passageNow(), markEl = (e.target as HTMLElement).closest?.<HTMLElement>("mark.gcp-mark");
    setMenu({ x, y, text, ...(passage ? { passage } : {}), ...(!text && markEl?.dataset.mark ? { markId: markEl.dataset.mark } : {}) });
  };
  selected.current = () => {
    const { text, passage } = passageNow(); if (!text || !passage) return;
    // Beside the last selected line that is on screen (a selection may run on into the next, hidden, page).
    const box = stage.current?.getBoundingClientRect(), lines = [...(doc()?.getSelection()?.getRangeAt(0).getClientRects() ?? [])].filter((l) => l.width > 0 && l.right > 0 && l.left < width && l.bottom > 0 && l.top < height), r = lines.at(-1) ?? passage.rect;
    setMenu({ x: (box?.left ?? 0) + Math.max(0, Math.min(width - 240, r.left)), y: (box?.top ?? 0) + Math.min(height - 40, r.bottom + 8), text, passage });
  };
  /** Pesquisar no livro: every occurrence in the text, with a little context, up to 500. */
  function search(value: string) {
    const d = doc(), needle = value.trim().toLocaleLowerCase(); if (!d || !needle) { setFound(null); return; }
    const results: NonNullable<typeof found> = [];
    for (const section of d.querySelectorAll<HTMLElement>(".gcp-chapter")) {
      const text = section.textContent ?? "", lower = text.toLocaleLowerCase(), chapter = Number(section.dataset.chapter);
      for (let at = lower.indexOf(needle); at >= 0 && results.length < 500; at = lower.indexOf(needle, at + needle.length))
        results.push({ chapter, start: at, end: at + needle.length, before: text.slice(Math.max(0, at - 50), at).replace(/\s+/g, " "), match: text.slice(at, at + needle.length), after: text.slice(at + needle.length, at + needle.length + 70).replace(/\s+/g, " ") });
      if (results.length >= 500) break;
    }
    setFound(results);
  }
  function goToRange(chapter: number, start: number, end: number) {
    const d = doc(), section = d?.getElementById(`c${chapter}`); if (!d || !section) return;
    const r = rangeAt(section, start, end), rect = r?.getClientRects()[0]; if (!r || !rect) return;
    const p = pageOfRect(rect); go(p, p >= pageRef.current ? 1 : -1);
    window.setTimeout(() => { const s = d.getSelection(); s?.removeAllRanges(); s?.addRange(r); }, prefs.duration + 30);
  }
  useEffect(() => { const handler = (e: KeyboardEvent) => { if ((e.target as HTMLElement).closest("input,select,textarea,.modal-backdrop")) return; keys.current(e); }; window.addEventListener("keydown", handler); return () => window.removeEventListener("keydown", handler); }, []);
  // Wait for the scroll document to load before starting; the previous paged document has no vertical scroll.
  useEffect(() => {
    if (!auto || paged || loadedHtml.current !== html) return;
    let frameId = 0, last = performance.now(), carry = 0;
    const step = (now: number) => {
      const root = doc()?.documentElement; if (!root) return;
      userMoved.current = true;
      carry += (prefs.scrollSpeed * (now - last)) / 1000; last = now;
      if (carry >= 1) { const whole = Math.floor(carry); carry -= whole; root.scrollTop += whole; }
      if (root.scrollTop + root.clientHeight >= root.scrollHeight - 2) { setAuto(false); return; }
      frameId = requestAnimationFrame(step);
    };
    frameId = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frameId);
  }, [auto, prefs.scrollSpeed, paged, documentRevision, html]);
  // Layout cleanup runs while the book frame is still in the page, so the place can still be read.
  const flushRef = useRef(flushSave); flushRef.current = flushSave;
  useLayoutEffect(() => { const flush = () => flushRef.current(); window.addEventListener("beforeunload", flush); return () => { window.removeEventListener("beforeunload", flush); flush(); }; }, []);
  useEffect(() => () => { document.title = "GCP-PDF"; window.clearTimeout(saveTimer.current); cancelAnimationFrame(anim.current); }, []);

  function addMark(style: BookMark["style"], color: string, withNote = false) {
    const p = menu?.passage; if (!p || !menu) return;
    const m: BookMark = { id: uid(), kind: "mark", chapter: p.chapter, start: p.start, end: p.end, text: menu.text.slice(0, 2000), color, style, createdAt: new Date().toISOString() };
    doc()?.getSelection()?.removeAllRanges();
    setMarks([...marks, m]); setMenu(null);
    if (withNote) openNote(m.id, menu.x, menu.y, true);
  }
  function addBookmark() {
    const p = menu?.passage, spot = p ? null : spotNow();
    const chapter = p?.chapter ?? spot?.chapter ?? chapterAt(pageRef.current), start = p?.start ?? spot?.start ?? 0;
    let text = menu?.text ?? "";
    if (!text) { const section = doc()?.getElementById(`c${chapter}`); text = section ? (rangeAt(section, start, start + 160)?.toString() ?? "") : ""; }
    setMarks([...marks, { id: uid(), kind: "bookmark", chapter, start, end: start, ...(!p && spot?.start === undefined ? { fraction: fractionSpot(pageRef.current).fraction } : {}), text: text.replace(/\s+/g, " ").trim().slice(0, 300), color: "#dc2626", style: "highlight", createdAt: new Date().toISOString() }]);
    setMenu(null); doc()?.getSelection()?.removeAllRanges();
  }
  /** The note box of a highlight, beside where it was clicked (stage coordinates are the iframe's). */
  function openNote(id: string, x: number, y: number, screen = false) {
    const box = stage.current?.getBoundingClientRect();
    setEditing({ id, x: screen ? x : (box?.left ?? 0) + x, y: screen ? y : (box?.top ?? 0) + y });
  }
  const editingMark = editing ? marks.find((m) => m.id === editing.id) : undefined;
  const chapterIndex = tocPages.reduce((found, start, i) => (start <= page ? i : found), -1), chapter = chapterIndex >= 0 ? toc[chapterIndex] : undefined;
  const chapterEnd = tocPages.filter((s) => s > page).reduce((a, b) => Math.min(a, b), pages);
  const titleOf = (c: number) => { const entry = toc.filter((t) => t.chapter <= c).at(-1); return entry ? label(entry.title) : `${translateUi("Capítulo")} ${c + 1}`; };
  const theme = THEMES[prefs.theme];
  const touch = useRef<number | null>(null);
  const remainingBook = Math.max(0, pages - 1 - page) * charsPerPage * speed, remainingChapter = Math.max(0, chapterEnd - 1 - page) * charsPerPage * speed;
  function mapNow() {
    const d = doc(); if (!d || !book) return;
    const entries = mapChapters(d);
    if (!entries.length) { onError(new Error(translateUi("Não encontramos títulos de capítulos neste livro."))); return; }
    try { localStorage.setItem(`gcp.book-map:${book.id}`, "1"); } catch {}
    setMapped(entries); setBanner(false); setPanel("toc");
  }
  function unmap() { if (!book) return; try { localStorage.removeItem(`gcp.book-map:${book.id}`); } catch {} setMapped(null); }
  const markPage = (m: BookMark) => pageOfSpot(spotOfMark(m), pages);
  const bookmarked = marks.some((m) => m.kind === "bookmark" && markPage(m) === page);
  const sorted = [...marks].sort((a, b) => a.chapter - b.chapter || a.start - b.start);
  return (
    <div className={`book-reader theme-${prefs.theme}`} style={{ ["--book-bg" as string]: theme.bg, ["--book-ink" as string]: theme.ink }} role="dialog" aria-label={translateUi("Leitor de livros")}>
      <header className="book-bar">
        <button className="icon-button" title={translateUi("Sumário")} data-reader-panel aria-pressed={panel === "toc"} onClick={() => setPanel(panel === "toc" ? null : "toc")}><List size={18} /></button>
        <div className="book-title"><BookOpen size={15} /><strong>{book?.title ?? translateUi("Abrindo livro…")}</strong>{book?.author && <span>{book.author}</span>}</div>
        <button className="icon-button" title={fullscreen ? translateUi("Sair da tela cheia") : translateUi("Tela cheia")} onClick={() => { const next = !fullscreen; setFullscreen(next); void window.gcp.setFullscreen(next); }}>{fullscreen ? <Minimize2 size={17} /> : <Maximize2 size={17} />}</button>
        <button className="icon-button" title={translateUi("Pesquisar no livro")} data-reader-panel aria-pressed={panel === "search"} onClick={() => setPanel(panel === "search" ? null : "search")}><Search size={17} /></button>
        <button className="icon-button" title={translateUi("Opções de exibição")} data-reader-panel aria-pressed={panel === "type"} onClick={() => setPanel(panel === "type" ? null : "type")}><Type size={18} /></button>
        <button className="icon-button" title={translateUi("Destaques, notas e marcadores")} data-reader-panel aria-pressed={panel === "notes"} onClick={() => setPanel(panel === "notes" ? null : "notes")}><NotebookPen size={17} /></button>
        <button className={`icon-button ${bookmarked ? "book-bookmarked" : ""}`} aria-pressed={bookmarked} title={translateUi("Adicionar marcador nesta página")} onClick={addBookmark}><BookmarkPlus size={17} /></button>
        <button className={`icon-button ${auto ? "active" : ""}`} title={auto ? translateUi("Parar a leitura automática") : translateUi("Rolar automaticamente")} onClick={() => { if (!auto && paged) setPrefs({ layout: "rolagem" }); setAuto(!auto); }}>{auto ? <Pause size={17} /> : <Play size={17} />}</button>
        <button className="icon-button" title={translateUi("Fechar o livro (Esc)")} onClick={() => { if (fullscreen) void window.gcp.setFullscreen(false); onClose(); }}><X size={18} /></button>
      </header>
      <div className="book-body">
        {panel === "toc" && book && (
          <aside className="book-panel book-toc">
            <h3>{translateUi("Sumário")}</h3>
            <div className="book-toc-tools">
              {mapped ? <button onClick={unmap}>{translateUi("Usar o sumário original")}</button> : <button onClick={mapNow}><ListTree size={14} />{" "}{translateUi("Mapear capítulos pelos títulos")}</button>}
            </div>
            {toc.map((t, i) => <button key={i} className={`level-${Math.min(3, t.level)} ${chapterIndex === i ? "current" : ""}`} onClick={() => { go(tocPages[i] ?? 0, (tocPages[i] ?? 0) >= page ? 1 : -1); setPanel(null); }}>{label(t.title)}</button>)}
          </aside>
        )}
        {panel === "search" && book && (
          <aside className="book-panel book-type book-search">
            <h3>{translateUi("Pesquisar no livro")}</h3>
            <form onSubmit={(e) => { e.preventDefault(); search(query); }}><input aria-label={translateUi("Pesquisar no livro")} autoFocus value={query} placeholder={translateUi("Palavra ou trecho")} onChange={(e) => { setQuery(e.target.value); if (!e.target.value) setFound(null); }} />{query && <button type="button" className="icon-button" aria-label={translateUi("Limpar pesquisa")} title={translateUi("Limpar pesquisa")} onClick={(e) => { setQuery(""); setFound(null); doc()?.getSelection()?.removeAllRanges(); e.currentTarget.form?.querySelector("input")?.focus(); }}><X size={15} /></button>}<button className="icon-button" title={translateUi("Pesquisar")}><Search size={15} /></button></form>
            {found && <small>{found.length >= 500 ? translateUi("Mais de 500 resultados") : translateUi("{count} resultados", { count: found.length })}</small>}
            {found?.map((r, i) => <button key={i} className="book-search-result" onClick={() => goToRange(r.chapter, r.start, r.end)}><small>{titleOf(r.chapter)}</small><span>…{r.before}<mark>{r.match}</mark>{r.after}…</span></button>)}
          </aside>
        )}
        {panel === "notes" && book && (
          <aside className="book-panel book-toc book-notes">
            <h3>{translateUi("Destaques, notas e marcadores")} <small>{marks.length}</small></h3>
            {!marks.length && <div className="book-empty"><BookText size={46} /><strong>{translateUi("Adicione seus próprios destaques e notas")}</strong><p>{translateUi("Selecione o texto em que você quer adicionar o destaque ou a nota. Eles serão salvos aqui.")}</p></div>}
            {sorted.map((m, i) => (
              <div key={m.id} className="book-note-item">
                {(i === 0 || sorted[i - 1]!.chapter !== m.chapter) && <h4>{titleOf(m.chapter)}</h4>}
                <button className="book-note-open" onClick={() => { goToMark(m); setPanel(null); }}>
                  {m.kind === "bookmark" ? <BookmarkIcon size={14} className="book-note-icon book-bookmarked" /> : <span className={`book-note-swatch ${m.style}`} style={{ ["--mark" as string]: m.color }} />}
                  <span>{m.kind === "bookmark" && <small className="book-bookmark-page">{translateUi(paged ? "Página" : "Tela")} {markPage(m) + 1}</small>}<q>{m.text || translateUi("Marcador")}</q>{m.note && <em>{m.note}</em>}</span>
                </button>
                <span className="book-note-actions">
                  {m.kind === "mark" && <button className="icon-button" title={m.note ? translateUi("Editar nota") : translateUi("Adicionar nota")} onClick={(e) => { const r = e.currentTarget.getBoundingClientRect(); openNote(m.id, r.right + 8, r.top, true); }}><MessageSquarePlus size={13} /></button>}
                  <button className="icon-button" title={translateUi("Excluir")} onClick={() => setMarks(marks.filter((x) => x.id !== m.id))}><Trash2 size={13} /></button>
                </span>
              </div>
            ))}
          </aside>
        )}
        {panel === "type" && (
          <aside className="book-panel book-type">
            <h3>{translateUi("Opções de exibição")}</h3>
            <div className="field">{translateUi("Tema")}<div className="book-themes">{(Object.keys(THEMES) as Theme[]).map((t) => <button key={t} className={prefs.theme === t ? "selected" : ""} style={{ background: THEMES[t].bg, color: THEMES[t].ink }} onClick={() => setPrefs({ theme: t })}>{translateUi(t === "claro" ? "Claro" : t === "sepia" ? "Sépia" : "Noturno")}</button>)}</div></div>
            <label className="field">{translateUi("Fonte")}<select value={prefs.font} onChange={(e) => setPrefs({ font: e.target.value as Prefs["font"] })}><option value="original">{translateUi("Do livro")}</option><option value="serif">{translateUi("Serifada (Georgia)")}</option><option value="sans">{translateUi("Sem serifa")}</option><option value="legivel">{translateUi("Alta legibilidade")}</option></select></label>
            <div className="field">{translateUi("Tamanho da fonte")}<div className="book-stepper"><button title={translateUi("Diminuir fonte")} disabled={prefs.size <= 70} onClick={() => setPrefs({ size: Math.max(70, prefs.size - 10) })}><Type size={14} /><Minus size={10} /></button><span>{prefs.size}%</span><button title={translateUi("Aumentar fonte")} disabled={prefs.size >= 200} onClick={() => setPrefs({ size: Math.min(200, prefs.size + 10) })}><Type size={19} /><Plus size={11} /></button></div></div>
            <div className="field">{translateUi("Altura da linha")}<div className="book-stepper"><button title={translateUi("Diminuir altura da linha")} disabled={prefs.leading <= 1.1} onClick={() => setPrefs({ leading: Math.max(1.1, Math.round((prefs.leading - 0.1) * 100) / 100) })}><Minus size={14} /></button><span>{Math.round(prefs.leading / 1.55 * 100)}%</span><button title={translateUi("Aumentar altura da linha")} disabled={prefs.leading >= 2.4} onClick={() => setPrefs({ leading: Math.min(2.4, Math.round((prefs.leading + 0.1) * 100) / 100) })}><Plus size={14} /></button></div></div>
            <div className="field">{translateUi("Alinhamento do texto")}<div className="book-segments">{([["original", <BookText size={16} />, "Do livro"], ["left", <AlignLeft size={16} />, "Esquerda"], ["justify", <AlignJustify size={16} />, "Justificado"], ["center", <AlignCenter size={16} />, "Centralizado"]] as [Align, React.ReactNode, string][]).map(([a, icon, name]) => <button key={a} title={translateUi(name)} aria-label={translateUi(name)} className={prefs.align === a ? "selected" : ""} onClick={() => setPrefs({ align: a })}>{icon}</button>)}</div></div>
            <div className="field">{translateUi("Layout da página")}<div className="book-segments">
              <button title={translateUi("Uma página")} aria-label={translateUi("Uma página")} className={paged && prefs.spread === 1 ? "selected" : ""} onClick={() => setPrefs({ layout: "paginas", spread: 1 })}><FileText size={16} /></button>
              <button title={translateUi("Duas páginas (telas largas)")} aria-label={translateUi("Duas páginas (telas largas)")} className={paged && prefs.spread === 2 ? "selected" : ""} onClick={() => setPrefs({ layout: "paginas", spread: 2 })}><Columns2 size={16} /></button>
              <button title={translateUi("Rolagem contínua (para cima e para baixo)")} aria-label={translateUi("Rolagem contínua (para cima e para baixo)")} className={!paged ? "selected" : ""} onClick={() => setPrefs({ layout: "rolagem" })}><ScrollText size={16} /></button>
            </div></div>
            <label className="field">{translateUi("Margens")} · {prefs.margin}%<input type="range" min={2} max={20} step={1} value={prefs.margin} onChange={(e) => setPrefs({ margin: Number(e.target.value) })} /></label>
            {paged && <label className="field">{translateUi("Efeito ao passar a página")}<select value={prefs.effect} onChange={(e) => setPrefs({ effect: e.target.value as Effect })}><option value="deslizar">{translateUi("Deslizar")}</option><option value="virar">{translateUi("Virar página")}</option><option value="desvanecer">{translateUi("Desvanecer")}</option><option value="nenhum">{translateUi("Nenhum")}</option></select></label>}
            <label className="field">{translateUi("Velocidade da animação")} · {(prefs.duration / 1000).toFixed(2)} s<input type="range" min={80} max={1500} step={20} value={prefs.duration} onChange={(e) => setPrefs({ duration: Number(e.target.value) })} /></label>
            <label className="field">{translateUi("Velocidade da rolagem automática")} · {prefs.scrollSpeed} px/s<input type="range" min={5} max={200} step={5} value={prefs.scrollSpeed} onChange={(e) => setPrefs({ scrollSpeed: Number(e.target.value) })} /></label>
          </aside>
        )}
        {paged && <button className="book-turn previous" aria-label={translateUi("Página anterior")} disabled={page <= 0} onClick={previous}><ChevronLeft size={26} /></button>}
        <div ref={stage} className={`book-stage effect-${prefs.effect} ${turn}`} style={{ ["--turn" as string]: `${Math.max(60, prefs.duration / 2)}ms` }}
          onTouchStart={(e) => { touch.current = e.touches[0]!.clientX; }} onTouchEnd={(e) => { const start = touch.current; touch.current = null; if (start === null || !paged) return; const dx = e.changedTouches[0]!.clientX - start; if (dx < -40) next(); else if (dx > 40) previous(); }}>
          {!book && <p className="book-loading"><LoaderCircle size={18} className="spin" />{" "}{translateUi("Abrindo o livro…")}</p>}
          {book && width > 0 && height > 0 && <iframe ref={frame} title={book.title} sandbox="allow-same-origin" srcDoc={html} onLoad={onLoad} />}
          {banner && <div className="book-banner"><ListTree size={15} /><span>{translateUi("Este livro não tem sumário. Quer mapear os capítulos pelos títulos do texto?")}</span><button className="button primary small" onClick={mapNow}>{translateUi("Mapear capítulos")}</button><button className="icon-button" title={translateUi("Fechar")} onClick={() => { setBanner(false); try { sessionStorage.setItem(`gcp.book-map-dismissed:${book!.id}`, "1"); } catch {} }}><X size={14} /></button></div>}
          {note !== null && <div className="book-note" role="note"><button className="icon-button" title={translateUi("Fechar nota")} onClick={() => setNote(null)}><X size={14} /></button><p>{note}</p></div>}
        </div>
        {paged && <button className="book-turn next" aria-label={translateUi("Próxima página")} disabled={page >= pages - 1} onClick={next}><ChevronRight size={26} /></button>}
      </div>
      <footer className="book-progress">
        {auto && <span role="status">{translateUi("Rolagem automática ativada")}</span>}
        <span className="book-chapter" title={chapter ? `${label(chapter.title)} · ${translateUi("Capítulo")} ${chapterIndex + 1} ${translateUi("de")} ${toc.length}` : ""}>{chapter ? label(chapter.title) : ""}</span>
        <input type="range" min={0} max={Math.max(0, pages - 1)} value={page} aria-label={translateUi("Posição no livro")} onChange={(e) => go(Number(e.target.value), Number(e.target.value) >= page ? 1 : -1)} />
        {charsPerPage > 0 && <span className="book-stats" title={translateUi("Estimativa pelo seu ritmo de leitura")}><Timer size={13} />{" "}{translateUi("{time} no capítulo", { time: duration(remainingChapter) })} · {translateUi("{time} no livro", { time: duration(remainingBook) })}</span>}
        <span>{translateUi(paged ? "Página" : "Tela")} {page + 1} {translateUi("de")} {pages} · {Math.round(((page + 1) / pages) * 100)}%</span>
      </footer>
      {menu && (
        <div className="context-backdrop" onMouseDown={dismissMenu} onContextMenu={(e) => { e.preventDefault(); dismissMenu(); }}>
          <div className="context-menu book-menu" style={{ left: Math.max(8, Math.min(menu.x, window.innerWidth - 260)), top: Math.max(8, Math.min(menu.y, window.innerHeight - (menu.text ? 520 : 200))) }} onMouseDown={(e) => e.stopPropagation()}>
            <div className="book-menu-heading"><span>{translateUi(menu.text ? "Texto selecionado" : menu.markId ? "Destaque" : "Marcador")}</span><button className="icon-button" aria-label={translateUi("Fechar")} title={translateUi("Fechar")} onClick={dismissMenu}><X size={15} /></button></div>
            {menu.text && <>
              {menu.passage && <button onClick={() => addMark("highlight", COLORS[0]!, true)}><MessageSquarePlus size={14} />{" "}{translateUi("Adicionar comentário")}</button>}
              <button onClick={() => { void window.gcp.copyText(menu.text); setMenu(null); }}><Copy size={14} />{" "}{translateUi("Copiar texto")}</button>
              <button onClick={() => { setLookup({ text: menu.text, mode: "translate" }); setMenu(null); }}><Languages size={14} />{" "}{translateUi("Traduzir…")}</button>
              <button onClick={() => { setLookup({ text: menu.text, mode: "synonyms" }); setMenu(null); }}><BookA size={14} />{" "}{translateUi("Sinônimos…")}</button>
              <button onClick={() => { setQuery(menu.text.slice(0, 120)); search(menu.text.slice(0, 120)); setPanel("search"); setMenu(null); }}><Search size={14} />{" "}{translateUi("Pesquisar no livro")}</button>
              <button onClick={() => { void window.gcp.openExternal(readerSearchUrl(menu.text, "wikipedia", getLocale())).catch(onError); dismissMenu(); }}><BookOpen size={14} />{" "}{translateUi("Pesquisar na Wikipédia")}</button>
              <button onClick={() => { void window.gcp.openExternal(readerSearchUrl(menu.text, "internet", getLocale())).catch(onError); dismissMenu(); }}><Globe size={14} />{" "}{translateUi("Pesquisar na Internet")}</button>
              {menu.passage && <>
                <button onClick={() => addMark("underline", theme.link)}><Underline size={14} />{" "}{translateUi("Sublinhar")}</button>
                <button onClick={addBookmark}><BookmarkPlus size={14} />{" "}{translateUi("Adicionar marcador")}</button>
                <div className="book-menu-colors" title={translateUi("Destacar")}><Highlighter size={14} />{COLORS.map((c) => <button key={c} aria-label={translateUi("Destacar")} title={translateUi("Destacar")} style={{ background: c }} onClick={() => addMark("highlight", c)} />)}</div>
              </>}
            </>}
            {!menu.text && menu.markId && (() => { const m = marks.find((x) => x.id === menu.markId); if (!m) return null; return <>
              <div className="context-title">{translateUi("Destaque")}</div>
              <button onClick={() => { openNote(m.id, menu.x, menu.y, true); setMenu(null); }}><MessageSquarePlus size={14} />{" "}{m.note ? translateUi("Editar nota") : translateUi("Adicionar nota")}</button>
              <div className="book-menu-colors"><Highlighter size={14} /><span>{translateUi("Cor")}</span>{COLORS.map((c) => <button key={c} title={translateUi("Cor")} style={{ background: c }} onClick={() => { setMarks(marks.map((x) => (x.id === m.id ? { ...x, color: c, style: "highlight" } : x))); setMenu(null); }} />)}</div>
              <button onClick={() => { void window.gcp.copyText(m.text); setMenu(null); }}><Copy size={14} />{" "}{translateUi("Copiar texto")}</button>
              <hr />
              <button className="danger" onClick={() => { setMarks(marks.filter((x) => x.id !== m.id)); setMenu(null); }}><Trash2 size={14} />{" "}{translateUi("Remover destaque")}</button>
            </>; })()}
            {!menu.text && !menu.markId && <button onClick={addBookmark}><BookmarkPlus size={14} />{" "}{translateUi("Adicionar marcador nesta página")}</button>}
          </div>
        </div>
      )}
      {editing && editingMark && (
        <div className="book-annotation" style={{ left: Math.max(8, Math.min(editing.x, window.innerWidth - 320)), top: Math.max(8, Math.min(editing.y + 12, window.innerHeight - 260)) }} onKeyDown={(e) => e.stopPropagation()}>
          <button className="icon-button book-annotation-close" title={translateUi("Fechar (Esc)")} onClick={() => setEditing(null)}><X size={13} /></button>
          <blockquote className="note-quote">{editingMark.text}</blockquote>
          <NoteEditor key={editingMark.id} initial={editingMark.note ?? ""} onSave={(text) => { setMarks(marks.map((m) => (m.id === editingMark.id ? { ...m, note: text || undefined } : m))); setEditing(null); }} onCancel={() => setEditing(null)} />
        </div>
      )}
      {lookup && <LookupDialog text={lookup.text} mode={lookup.mode} onClose={() => setLookup(null)} onError={onError} onCopy={(text) => window.gcp.copyText(text)} />}
    </div>
  );
}

function NoteEditor({ initial, onSave, onCancel }: { initial: string; onSave: (text: string) => void; onCancel: () => void }) {
  const [value, setValue] = useState(initial);
  return <>
    <textarea autoFocus value={value} maxLength={20000} placeholder={translateUi("Escreva sua nota…")} onChange={(e) => setValue(e.target.value)} onKeyDown={(e) => { if (e.key === "Escape") onCancel(); if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) onSave(value.trim()); }} />
    <div className="note-composer-actions"><button className="text-button" onClick={onCancel}>{translateUi("Cancelar")}</button><button className="button primary small" onClick={() => onSave(value.trim())}>{translateUi("Salvar")}</button></div>
  </>;
}
