import {t as translateUi} from "./i18n";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { X, List, Type, Play, Pause, ChevronLeft, ChevronRight, LoaderCircle, BookOpen } from "lucide-react";
import type { BookContent } from "../shared/types";

/** Exibição > Livro: reads EPUB books page by page. The book's sanitized HTML lives in a sandboxed
 * iframe without scripts; CSS columns make the pages, and the reader remembers where each book was. */
type Theme = "claro" | "sepia" | "noturno";
type Effect = "deslizar" | "virar" | "desvanecer" | "nenhum";
interface Prefs { font: "original" | "serif" | "sans" | "legivel"; size: number; leading: number; margin: number; theme: Theme; spread: 1 | 2; effect: Effect; seconds: number }
const DEFAULTS: Prefs = { font: "original", size: 100, leading: 1.55, margin: 6, theme: "claro", spread: 1, effect: "deslizar", seconds: 30 };
const FONTS: Record<Prefs["font"], string | null> = { original: null, serif: 'Georgia, "Iowan Old Style", "Times New Roman", serif', sans: '"Segoe UI", Inter, "Helvetica Neue", Arial, sans-serif', legivel: 'Verdana, "Atkinson Hyperlegible", Tahoma, sans-serif' };
const THEMES: Record<Theme, { bg: string; ink: string; link: string }> = { claro: { bg: "#ffffff", ink: "#1d1d1f", link: "#5b2bc0" }, sepia: { bg: "#f4ecd8", ink: "#433422", link: "#8a4b14" }, noturno: { bg: "#15151b", ink: "#d8d6e2", link: "#a99bff" } };
const load = <T,>(key: string, fallback: T): T => { try { const raw = localStorage.getItem(key); return raw ? { ...fallback, ...JSON.parse(raw) } : fallback; } catch { return fallback; } };
const save = (key: string, value: unknown) => { try { localStorage.setItem(key, JSON.stringify(value)); } catch {} };

function bookDocument(book: BookContent, prefs: Prefs, width: number) {
  const theme = THEMES[prefs.theme], font = FONTS[prefs.font], spread = width >= 900 ? prefs.spread : 1;
  const side = Math.round(width * prefs.margin / 100 / spread), gap = side * 2, column = (width - side * 2 - gap * (spread - 1)) / spread;
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'; font-src data:; media-src 'none'">
<style>${book.css}</style>
<style>
html{height:100%;overflow:hidden;font-size:${prefs.size}%;background:${theme.bg}}
body{margin:0!important;box-sizing:border-box;height:100vh;padding:7vh ${side}px!important;column-width:${column}px;column-gap:${gap}px;column-fill:auto;background:${theme.bg}!important;color:${theme.ink}!important;overflow:visible;max-width:none!important;width:auto!important}
body *{color:inherit!important;background-color:transparent!important;line-height:${prefs.leading}!important;max-width:100%}
${font ? `body,body *{font-family:${font}!important}` : ""}
a{color:${theme.link}!important}
img,svg{max-height:calc(86vh);height:auto;object-fit:contain;break-inside:avoid}
/* Each chapter opens a page. Chromium ignores a forced break on the chapter element itself after
   nested sections, so the break sits on a leading pseudo-element. */
.gcp-chapter+.gcp-chapter::before{content:"";display:block;break-before:column}
.gcp-chapter *{break-before:auto!important;page-break-before:auto!important}
p{orphans:2;widows:2}
::selection{background:${theme.link}44}
</style></head><body>${book.html}</body></html>`;
}

export function BookReader({ token, onClose, onError }: { token: string; onClose: () => void; onError: (error: unknown) => void }) {
  const [book, setBook] = useState<BookContent | null>(null), [prefs, setPrefsState] = useState<Prefs>(() => load("gcp.reader", DEFAULTS));
  const [page, setPage] = useState(0), [pages, setPages] = useState(1), [panel, setPanel] = useState<"toc" | "type" | null>(null), [auto, setAuto] = useState(false), [note, setNote] = useState<string | null>(null);
  const [width, setWidth] = useState(0), [turn, setTurn] = useState<"" | "out-next" | "out-prev" | "in-next" | "in-prev">("");
  const frame = useRef<HTMLIFrameElement>(null), stage = useRef<HTMLDivElement>(null), starts = useRef<number[]>([]), pageRef = useRef(0), restoring = useRef<{ chapter: number; fraction: number } | null>(null);
  const setPrefs = (patch: Partial<Prefs>) => setPrefsState((p) => { const next = { ...p, ...patch }; save("gcp.reader", next); return next; });
  useEffect(() => { void window.gcp.readBook(token).then((b) => { setBook(b); restoring.current = load(`gcp.book:${b.id}`, { chapter: 0, fraction: 0 }); document.title = `${b.title} — GCP-PDF`; }).catch((error) => { onError(error); onClose(); }); }, [token]);
  useLayoutEffect(() => {
    const node = stage.current; if (!node) return;
    const observer = new ResizeObserver(() => setWidth(Math.round(node.clientWidth)));
    observer.observe(node); return () => observer.disconnect();
  }, [!!book]);
  const doc = () => frame.current?.contentDocument ?? null;
  /** Page of each chapter start, from where the columns placed them. */
  const measure = useCallback(() => {
    const d = doc(); if (!d || !width) return;
    const root = d.documentElement, scroll = root.scrollLeft;
    setPages(Math.max(1, Math.round(root.scrollWidth / width)));
    starts.current = [...d.querySelectorAll<HTMLElement>(".gcp-chapter")].map((s) => Math.floor((s.getBoundingClientRect().left + scroll + 2) / width));
  }, [width]);
  const chapterAt = (p: number) => { let c = 0; starts.current.forEach((s, i) => { if (s <= p) c = i; }); return c; };
  const remember = (p: number) => {
    if (!book) return;
    const c = chapterAt(p), from = starts.current[c] ?? 0, to = starts.current[c + 1] ?? pages;
    save(`gcp.book:${book.id}`, { chapter: c, fraction: to > from ? (p - from) / (to - from) : 0 });
  };
  const place = (p: number, smooth: boolean) => { const d = doc(); if (!d) return; d.documentElement.scrollTo({ left: p * width, behavior: smooth ? "smooth" : "instant" as ScrollBehavior }); };
  const go = useCallback((target: number, direction: 1 | -1 = 1) => {
    const p = Math.max(0, Math.min(pages - 1, target));
    if (p === pageRef.current) return;
    pageRef.current = p; setPage(p); remember(p);
    if (prefs.effect === "deslizar") place(p, true);
    else if (prefs.effect === "nenhum") place(p, false);
    else {
      setTurn(direction > 0 ? "out-next" : "out-prev");
      window.setTimeout(() => { place(p, false); setTurn(direction > 0 ? "in-next" : "in-prev"); window.setTimeout(() => setTurn(""), prefs.effect === "virar" ? 260 : 180); }, prefs.effect === "virar" ? 260 : 160);
    }
  }, [pages, width, prefs.effect, book]);
  const next = () => go(pageRef.current + 1, 1), previous = () => go(pageRef.current - 1, -1);
  // Layout changes (window, font, margins) move the text: keep the reading position across them.
  const html = book && width ? bookDocument(book, prefs, width) : "";
  const onLoad = () => {
    const d = doc(); if (!d || !book) return;
    measure();
    const spot = restoring.current ?? (() => { const c = chapterAt(pageRef.current), from = starts.current[c] ?? 0, to = starts.current[c + 1] ?? pages; return { chapter: c, fraction: to > from ? (pageRef.current - from) / (to - from) : 0 }; })();
    restoring.current = null;
    requestAnimationFrame(() => {
      measure();
      const total = Math.max(1, Math.round(d.documentElement.scrollWidth / width)), from = starts.current[spot.chapter] ?? 0, to = starts.current[spot.chapter + 1] ?? total;
      const p = Math.max(0, Math.min(total - 1, from + Math.round(spot.fraction * (to - from))));
      pageRef.current = p; setPage(p); place(p, false);
    });
    d.addEventListener("click", (e) => {
      const a = (e.target as HTMLElement).closest("a");
      if (!a) { const x = e.clientX / width; if (x < 0.25) previous(); else if (x > 0.75) next(); return; }
      e.preventDefault();
      const external = a.getAttribute("data-external");
      if (external) { void window.gcp.openExternal(external).catch(onError); return; }
      const id = a.getAttribute("href")?.slice(1); const target = id ? d.getElementById(id) : null; if (!target) return;
      // A note reference opens the note over the page instead of leaving the text.
      const aside = target.closest("aside, [epub\\:type~='footnote'], .footnote, li[id]");
      if (a.getAttribute("epub:type")?.includes("noteref") || a.classList.contains("noteref") || (aside && /foot|note|nota/i.test(aside.getAttribute("epub:type") ?? aside.className ?? ""))) { setNote((aside ?? target).textContent?.replace(/\s+/g, " ").trim() ?? ""); return; }
      go(Math.floor((target.getBoundingClientRect().left + d.documentElement.scrollLeft + 2) / width));
    });
    d.addEventListener("keydown", (e) => keys.current(e));
    d.addEventListener("wheel", (e) => { e.preventDefault(); wheel.current(e.deltaY || e.deltaX); }, { passive: false });
  };
  useEffect(() => { if (book) restoring.current ??= (() => { const c = chapterAt(pageRef.current), from = starts.current[c] ?? 0, to = starts.current[c + 1] ?? pages; return { chapter: c, fraction: to > from ? (pageRef.current - from) / (to - from) : 0 }; })(); }, [html]);
  const keys = useRef((_e: KeyboardEvent) => {}), wheel = useRef((_d: number) => {}), lastWheel = useRef(0);
  keys.current = (e) => {
    if (e.key === "Escape") { if (note) setNote(null); else if (panel) setPanel(null); else onClose(); return; }
    if (["ArrowRight", "PageDown", " ", "ArrowDown"].includes(e.key)) { e.preventDefault(); next(); }
    else if (["ArrowLeft", "PageUp", "ArrowUp"].includes(e.key)) { e.preventDefault(); previous(); }
    else if (e.key === "Home") go(0, -1); else if (e.key === "End") go(pages - 1);
  };
  wheel.current = (delta) => { const now = Date.now(); if (now - lastWheel.current < 350 || Math.abs(delta) < 8) return; lastWheel.current = now; if (delta > 0) next(); else previous(); };
  useEffect(() => { const handler = (e: KeyboardEvent) => { if ((e.target as HTMLElement).closest("input,select,textarea")) return; keys.current(e); }; window.addEventListener("keydown", handler); return () => window.removeEventListener("keydown", handler); }, []);
  // Automatic page turning, at the chosen pace; it stops at the end of the book.
  useEffect(() => { if (!auto) return; const timer = window.setInterval(() => { if (pageRef.current >= pages - 1) setAuto(false); else next(); }, Math.max(3, prefs.seconds) * 1000); return () => window.clearInterval(timer); }, [auto, prefs.seconds, pages, go]);
  useEffect(() => () => { document.title = "GCP-PDF"; }, []);
  const chapter = book ? book.toc.filter((t) => (starts.current[t.chapter] ?? 0) <= page).at(-1) : undefined;
  const theme = THEMES[prefs.theme];
  const touch = useRef<number | null>(null);
  return (
    <div className={`book-reader theme-${prefs.theme}`} style={{ ["--book-bg" as string]: theme.bg, ["--book-ink" as string]: theme.ink }} role="dialog" aria-label={translateUi("Leitor de livros")}>
      <header className="book-bar">
        <button className="icon-button" title={translateUi("Sumário")} aria-pressed={panel === "toc"} onClick={() => setPanel(panel === "toc" ? null : "toc")}><List size={18} /></button>
        <div className="book-title"><BookOpen size={15} /><strong>{book?.title ?? translateUi("Abrindo livro…")}</strong>{book?.author && <span>{book.author}</span>}</div>
        <button className={`icon-button ${auto ? "active" : ""}`} title={auto ? translateUi("Parar de passar as páginas") : translateUi(`Passar páginas automaticamente (a cada ${prefs.seconds} s)`)} onClick={() => setAuto(!auto)}>{auto ? <Pause size={17} /> : <Play size={17} />}</button>
        <button className="icon-button" title={translateUi("Fonte, margens, tema e efeitos")} aria-pressed={panel === "type"} onClick={() => setPanel(panel === "type" ? null : "type")}><Type size={18} /></button>
        <button className="icon-button" title={translateUi("Fechar o livro (Esc)")} onClick={onClose}><X size={18} /></button>
      </header>
      <div className="book-body">
        {panel === "toc" && book && (
          <aside className="book-panel book-toc">
            <h3>{translateUi("Sumário")}</h3>
            {book.toc.map((t, i) => <button key={i} className={`level-${Math.min(3, t.level)} ${chapter === t ? "current" : ""}`} onClick={() => { const d = doc(); const el = t.anchor ? d?.getElementById(t.anchor) : d?.getElementById(`c${t.chapter}`); if (el && d) go(Math.floor((el.getBoundingClientRect().left + d.documentElement.scrollLeft + 2) / width)); setPanel(null); }}>{t.title}</button>)}
          </aside>
        )}
        {panel === "type" && (
          <aside className="book-panel book-type">
            <h3>{translateUi("Leitura")}</h3>
            <label className="field">{translateUi("Fonte")}<select value={prefs.font} onChange={(e) => setPrefs({ font: e.target.value as Prefs["font"] })}><option value="original">{translateUi("Do livro")}</option><option value="serif">{translateUi("Serifada (Georgia)")}</option><option value="sans">{translateUi("Sem serifa")}</option><option value="legivel">{translateUi("Alta legibilidade")}</option></select></label>
            <label className="field">{translateUi("Tamanho")} · {prefs.size}%<input type="range" min={70} max={200} step={5} value={prefs.size} onChange={(e) => setPrefs({ size: Number(e.target.value) })} /></label>
            <label className="field">{translateUi("Entrelinha")} · {prefs.leading.toFixed(2)}<input type="range" min={1.1} max={2.4} step={0.05} value={prefs.leading} onChange={(e) => setPrefs({ leading: Number(e.target.value) })} /></label>
            <label className="field">{translateUi("Margens")} · {prefs.margin}%<input type="range" min={2} max={20} step={1} value={prefs.margin} onChange={(e) => setPrefs({ margin: Number(e.target.value) })} /></label>
            <div className="field">{translateUi("Tema")}<div className="book-themes">{(Object.keys(THEMES) as Theme[]).map((t) => <button key={t} className={prefs.theme === t ? "selected" : ""} style={{ background: THEMES[t].bg, color: THEMES[t].ink }} onClick={() => setPrefs({ theme: t })}>{translateUi(t === "claro" ? "Claro" : t === "sepia" ? "Sépia" : "Noturno")}</button>)}</div></div>
            <label className="field">{translateUi("Páginas na tela")}<select value={prefs.spread} onChange={(e) => setPrefs({ spread: Number(e.target.value) as 1 | 2 })}><option value={1}>{translateUi("Uma página")}</option><option value={2}>{translateUi("Duas páginas (telas largas)")}</option></select></label>
            <label className="field">{translateUi("Efeito ao passar a página")}<select value={prefs.effect} onChange={(e) => setPrefs({ effect: e.target.value as Effect })}><option value="deslizar">{translateUi("Deslizar")}</option><option value="virar">{translateUi("Virar página")}</option><option value="desvanecer">{translateUi("Desvanecer")}</option><option value="nenhum">{translateUi("Nenhum")}</option></select></label>
            <label className="field">{translateUi("Passar automaticamente a cada")} · {prefs.seconds} s<input type="range" min={5} max={180} step={5} value={prefs.seconds} onChange={(e) => setPrefs({ seconds: Number(e.target.value) })} /></label>
          </aside>
        )}
        <button className="book-turn previous" aria-label={translateUi("Página anterior")} disabled={page <= 0} onClick={previous}><ChevronLeft size={26} /></button>
        <div ref={stage} className={`book-stage effect-${prefs.effect} ${turn}`}
          onTouchStart={(e) => { touch.current = e.touches[0]!.clientX; }} onTouchEnd={(e) => { const start = touch.current; touch.current = null; if (start === null) return; const dx = e.changedTouches[0]!.clientX - start; if (dx < -40) next(); else if (dx > 40) previous(); }}>
          {!book && <p className="book-loading"><LoaderCircle size={18} className="spin" />{" "}{translateUi("Abrindo o livro…")}</p>}
          {book && width > 0 && <iframe ref={frame} title={book.title} sandbox="allow-same-origin" srcDoc={html} onLoad={onLoad} />}
          {note !== null && <div className="book-note" role="note"><button className="icon-button" title={translateUi("Fechar nota")} onClick={() => setNote(null)}><X size={14} /></button><p>{note}</p></div>}
        </div>
        <button className="book-turn next" aria-label={translateUi("Próxima página")} disabled={page >= pages - 1} onClick={next}><ChevronRight size={26} /></button>
      </div>
      <footer className="book-progress">
        <span className="book-chapter">{chapter?.title ?? ""}</span>
        <input type="range" min={0} max={Math.max(0, pages - 1)} value={page} aria-label={translateUi("Posição no livro")} onChange={(e) => go(Number(e.target.value), Number(e.target.value) >= page ? 1 : -1)} />
        <span>{translateUi("Página")} {page + 1} {translateUi("de")} {pages} · {Math.round(((page + 1) / pages) * 100)}%</span>
      </footer>
    </div>
  );
}
