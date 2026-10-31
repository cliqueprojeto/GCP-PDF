import {t as translateUi} from "./i18n";
import React, { useEffect, useLayoutEffect, useRef, useState } from "react";
import { X, Play, Pause, ChevronLeft, ChevronRight, LoaderCircle, Image as ImageIcon, ZoomIn, ZoomOut, Hand, Settings2, Maximize2, Minimize2, ArrowLeftRight, MoveHorizontal, Expand, Scan } from "lucide-react";
import type { ComicContent } from "../shared/types";
import { recordRecentFile } from "./Home";

/** Exibição > Livro for comics (.cbz, .cbr, .cb7): one or two pages, or a vertical strip; manga order
 * (right to left); zoom by buttons, Ctrl+wheel or double click, and the hand to move a zoomed page. */
type Layout = "uma" | "duas" | "vertical";
type Fit = "pagina" | "largura" | "original";
type Background = "escuro" | "cinza" | "claro";
interface Prefs { layout: Layout; manga: boolean; cover: boolean; fit: Fit; background: Background; duration: number; seconds: number; scrollSpeed: number }
const DEFAULTS: Prefs = { layout: "uma", manga: false, cover: true, fit: "pagina", background: "escuro", duration: 220, seconds: 20, scrollSpeed: 60 };
const BACKGROUNDS: Record<Background, { bg: string; ink: string }> = { escuro: { bg: "#111114", ink: "#e4e2ee" }, cinza: { bg: "#3a3a40", ink: "#f1f0f6" }, claro: { bg: "#f3f2f7", ink: "#1d1d1f" } };
const load = <T,>(key: string, fallback: T): T => { try { const raw = localStorage.getItem(key); return raw ? { ...fallback, ...JSON.parse(raw) } : fallback; } catch { return fallback; } };
const save = (key: string, value: unknown) => { try { localStorage.setItem(key, JSON.stringify(value)); } catch {} };
const ZOOMS = [0.5, 0.75, 1, 1.25, 1.5, 2, 2.5, 3, 4];

/** Pages shown together: the cover alone when asked, then pairs. */
function spreads(count: number, layout: Layout, cover: boolean) {
  if (layout !== "duas") return Array.from({ length: count }, (_, i) => [i]);
  const out: number[][] = []; let i = 0;
  if (cover && count) { out.push([0]); i = 1; }
  for (; i < count; i += 2) out.push(i + 1 < count ? [i, i + 1] : [i]);
  return out;
}

export function ComicReader({ token, onClose, onError }: { token: string; onClose: () => void; onError: (error: unknown) => void }) {
  const [comic, setComic] = useState<ComicContent | null>(null), [prefs, setPrefsState] = useState<Prefs>(() => load("gcp.comic-reader", DEFAULTS));
  const [page, setPage] = useState(0), [zoom, setZoom] = useState(1), [hand, setHand] = useState(false), [panel, setPanel] = useState(false), [auto, setAuto] = useState(false), [fullscreen, setFullscreen] = useState(false);
  const [urls, setUrls] = useState<Map<number, string>>(new Map()), [sizes, setSizes] = useState<Map<number, { w: number; h: number }>>(new Map()), [box, setBox] = useState({ width: 0, height: 0 }), [turn, setTurn] = useState(0);
  const stage = useRef<HTMLDivElement>(null), requested = useRef(new Set<number>()), live = useRef(true), all = useRef(new Map<number, string>());
  const setPrefs = (patch: Partial<Prefs>) => setPrefsState((p) => { const next = { ...p, ...patch }; save("gcp.comic-reader", next); return next; });
  const count = comic?.names.length ?? 0, vertical = prefs.layout === "vertical";
  const groups = spreads(count, prefs.layout, prefs.cover), groupIndex = Math.max(0, groups.findIndex((g) => g.includes(page))), current = groups[groupIndex] ?? [0];
  useEffect(() => {
    live.current = true;
    void window.gcp.readComic(token).then((c) => {
      setComic(c); document.title = `${c.title} — GCP-PDF`;
      const saved = load(`gcp.comic:${c.id}`, { page: 0 }).page;
      setPage(Math.max(0, Math.min(c.names.length - 1, Number(saved) || 0)));
    }).catch((error) => { onError(error); onClose(); });
    return () => { live.current = false; for (const url of all.current.values()) URL.revokeObjectURL(url); document.title = "GCP-PDF"; };
  }, [token]);
  useLayoutEffect(() => {
    const node = stage.current; if (!node) return;
    const observer = new ResizeObserver(() => setBox({ width: node.clientWidth, height: node.clientHeight }));
    observer.observe(node); return () => observer.disconnect();
  }, [!!comic]);
  /** Fetches page images on demand, as blob URLs kept until the reader closes. */
  const want = (indexes: number[]) => {
    for (const i of indexes) {
      if (i < 0 || i >= count || requested.current.has(i)) continue;
      requested.current.add(i);
      void window.gcp.comicPage(token, i).then(({ type, data }) => {
        if (!live.current) return;
        const url = URL.createObjectURL(new Blob([data as BlobPart], { type }));
        all.current.set(i, url); setUrls(new Map(all.current));
      }).catch((error) => { requested.current.delete(i); onError(error); });
    }
  };
  useEffect(() => { if (comic && !vertical) want([...current, ...(groups[groupIndex + 1] ?? []), ...(groups[groupIndex + 2] ?? []), ...(groups[groupIndex - 1] ?? [])]); }, [comic, page, prefs.layout, prefs.cover]);
  // Remembers the page, and the progress in the recent files list.
  useEffect(() => {
    if (!comic) return;
    save(`gcp.comic:${comic.id}`, { page });
    const timer = window.setTimeout(() => recordRecentFile({ path: comic.path, name: comic.name, openedAt: Date.now(), pageCount: Math.max(1, count), book: { percent: Math.round(((page + 1) / Math.max(1, count)) * 100) } }), 400);
    return () => window.clearTimeout(timer);
  }, [comic, page]);
  const go = (group: number) => {
    const target = groups[Math.max(0, Math.min(groups.length - 1, group))]; if (!target || target[0] === current[0]) return;
    setPage(target[0]!); setTurn((t) => t + 1);
    const node = stage.current; if (node) { node.scrollTop = 0; node.scrollLeft = prefs.manga ? node.scrollWidth : 0; }
  };
  const next = () => (vertical ? scrollScreen(1) : go(groupIndex + 1)), previous = () => (vertical ? scrollScreen(-1) : go(groupIndex - 1));
  // Left and right follow the page order on screen: in manga the next page is on the left.
  const left = () => (prefs.manga ? next() : previous()), right = () => (prefs.manga ? previous() : next());
  function scrollScreen(direction: 1 | -1) { const node = stage.current; if (node) node.scrollBy({ top: direction * node.clientHeight * 0.9, behavior: prefs.duration > 0 ? "smooth" : "auto" }); }
  function goToPage(index: number) {
    if (!vertical) { const g = groups.findIndex((x) => x.includes(index)); go(g); return; }
    stage.current?.querySelector<HTMLElement>(`[data-comic-page="${index}"]`)?.scrollIntoView({ block: "start" });
  }
  /** Zoom keeping the point under the cursor (or the centre) in place. */
  function zoomTo(value: number, at?: { x: number; y: number }) {
    const node = stage.current, next = Math.max(0.25, Math.min(6, value)); if (!node) { setZoom(next); return; }
    const r = node.getBoundingClientRect(), px = at ? at.x - r.left : node.clientWidth / 2, py = at ? at.y - r.top : node.clientHeight / 2;
    const fx = (node.scrollLeft + px) / Math.max(1, node.scrollWidth), fy = (node.scrollTop + py) / Math.max(1, node.scrollHeight);
    setZoom(next); if (next > 1.01) setHand(true);
    requestAnimationFrame(() => { node.scrollLeft = fx * node.scrollWidth - px; node.scrollTop = fy * node.scrollHeight - py; });
  }
  const step = (direction: 1 | -1) => { const list = direction > 0 ? ZOOMS.filter((z) => z > zoom + 0.01) : ZOOMS.filter((z) => z < zoom - 0.01).reverse(); zoomTo(list[0] ?? zoom); };
  // Hand: drag to move a page larger than the screen; a short click turns the page at the sides.
  const dragging = useRef<{ x: number; y: number; left: number; top: number; moved: boolean } | null>(null);
  function onPointerDown(e: React.PointerEvent) {
    const node = stage.current; if (!node || e.button !== 0) return;
    dragging.current = { x: e.clientX, y: e.clientY, left: node.scrollLeft, top: node.scrollTop, moved: false };
    node.setPointerCapture(e.pointerId);
  }
  function onPointerMove(e: React.PointerEvent) {
    const d = dragging.current, node = stage.current; if (!d || !node) return;
    if (Math.hypot(e.clientX - d.x, e.clientY - d.y) > 4) d.moved = true;
    if (d.moved && (hand || vertical)) { node.scrollLeft = d.left - (e.clientX - d.x); node.scrollTop = d.top - (e.clientY - d.y); }
  }
  function onPointerUp(e: React.PointerEvent) {
    const d = dragging.current; dragging.current = null; if (!d || d.moved || vertical) return;
    const r = stage.current!.getBoundingClientRect(), x = (e.clientX - r.left) / r.width;
    if (x < 0.3) left(); else if (x > 0.7) right();
  }
  const keys = useRef((_e: KeyboardEvent) => {});
  keys.current = (e) => {
    if (e.key === "Escape") { if (panel) setPanel(false); else close(); return; }
    if (e.key === "ArrowRight") { e.preventDefault(); right(); }
    else if (e.key === "ArrowLeft") { e.preventDefault(); left(); }
    else if (["PageDown", " "].includes(e.key) || (e.key === "ArrowDown" && !vertical && zoom <= 1)) { e.preventDefault(); next(); }
    else if (e.key === "PageUp" || (e.key === "ArrowUp" && !vertical && zoom <= 1)) { e.preventDefault(); previous(); }
    else if (e.key === "Home") goToPage(0); else if (e.key === "End") goToPage(count - 1);
    else if (e.key === "+" || e.key === "=") step(1); else if (e.key === "-") step(-1); else if (e.key === "0") { setZoom(1); setHand(false); }
  };
  useEffect(() => { const handler = (e: KeyboardEvent) => { if ((e.target as HTMLElement).closest("input,select,textarea")) return; keys.current(e); }; window.addEventListener("keydown", handler); return () => window.removeEventListener("keydown", handler); }, []);
  useEffect(() => {
    const node = stage.current; if (!node) return;
    const wheel = (e: WheelEvent) => { if (!e.ctrlKey) return; e.preventDefault(); zoomTo(zoom * (e.deltaY < 0 ? 1.12 : 1 / 1.12), { x: e.clientX, y: e.clientY }); };
    node.addEventListener("wheel", wheel, { passive: false }); return () => node.removeEventListener("wheel", wheel);
  });
  // Vertical strip: load the pages near the screen, and follow which page is being read.
  useEffect(() => {
    const node = stage.current; if (!node || !vertical || !comic) return;
    const seen = new IntersectionObserver((entries) => { for (const entry of entries) if (entry.isIntersecting) { const i = Number((entry.target as HTMLElement).dataset.comicPage); want([i - 1, i, i + 1, i + 2]); } }, { root: node, rootMargin: "150% 0px" });
    node.querySelectorAll("[data-comic-page]").forEach((el) => seen.observe(el));
    const onScroll = () => { const items = [...node.querySelectorAll<HTMLElement>("[data-comic-page]")], top = node.getBoundingClientRect().top + 40, at = items.findIndex((el) => el.getBoundingClientRect().bottom > top); if (at >= 0) setPage(at); };
    node.addEventListener("scroll", onScroll);
    requestAnimationFrame(() => node.querySelector<HTMLElement>(`[data-comic-page="${page}"]`)?.scrollIntoView({ block: "start" }));
    return () => { seen.disconnect(); node.removeEventListener("scroll", onScroll); };
  }, [vertical, comic]);
  // Automatic reading: next page at a set pace, or a steady scroll of the strip.
  useEffect(() => {
    if (!auto) return;
    if (!vertical) { const timer = window.setInterval(() => { if (groupIndex >= groups.length - 1) setAuto(false); else next(); }, Math.max(3, prefs.seconds) * 1000); return () => window.clearInterval(timer); }
    let frame = 0, last = performance.now(), carry = 0;
    const tick = (now: number) => { const node = stage.current; if (!node) return; carry += (prefs.scrollSpeed * (now - last)) / 1000; last = now; if (carry >= 1) { node.scrollTop += Math.floor(carry); carry %= 1; } if (node.scrollTop + node.clientHeight >= node.scrollHeight - 2) { setAuto(false); return; } frame = requestAnimationFrame(tick); };
    frame = requestAnimationFrame(tick); return () => cancelAnimationFrame(frame);
  }, [auto, vertical, groupIndex, prefs.seconds, prefs.scrollSpeed]);
  function close() { if (fullscreen) void window.gcp.setFullscreen(false); onClose(); }
  /** Size of one page on screen for the chosen fit and zoom. */
  const pageStyle = (i: number, together: number): React.CSSProperties => {
    const natural = sizes.get(i), w = box.width - 16, h = box.height - 16;
    if (vertical) return { width: Math.min(w, prefs.fit === "original" && natural ? natural.w : prefs.fit === "pagina" ? Math.min(w, 900) : w) * zoom };
    if (prefs.fit === "original") return natural ? { width: natural.w * zoom } : {};
    if (prefs.fit === "largura") return { width: (w / together) * zoom };
    const ratio = natural ? natural.w / natural.h : 0.66;
    return { height: Math.min(h, (w / together) / ratio) * zoom, width: Math.min(h, (w / together) / ratio) * ratio * zoom };
  };
  const colors = BACKGROUNDS[prefs.background], shown = current.map((i) => i + 1);
  const img = (i: number, together: number) => urls.get(i)
    ? <img key={i} src={urls.get(i)} alt={`${translateUi("Página")} ${i + 1}`} draggable={false} style={pageStyle(i, together)} onLoad={(e) => { const t = e.currentTarget; if (!sizes.has(i)) setSizes((m) => new Map(m).set(i, { w: t.naturalWidth, h: t.naturalHeight })); }} />
    : <div key={i} className="comic-placeholder" style={{ ...pageStyle(i, together), minHeight: vertical ? box.height * 0.8 : undefined }}><LoaderCircle size={22} className="spin" /></div>;
  return (
    <div className="book-reader comic-reader" style={{ ["--book-bg" as string]: colors.bg, ["--book-ink" as string]: colors.ink, ["--turn" as string]: `${prefs.duration}ms` }} role="dialog" aria-label={translateUi("Leitor de quadrinhos")}>
      <header className="book-bar">
        <div className="book-title"><ImageIcon size={15} /><strong>{comic?.title ?? translateUi("Abrindo quadrinho…")}</strong>{prefs.manga && <span>{translateUi("Mangá · direita para a esquerda")}</span>}</div>
        <button className={`icon-button ${prefs.manga ? "active" : ""}`} aria-pressed={prefs.manga} title={translateUi("Leitura de mangá (direita para a esquerda)")} onClick={() => setPrefs({ manga: !prefs.manga })}><ArrowLeftRight size={17} /></button>
        <button className="icon-button" title={translateUi("Diminuir zoom")} onClick={() => step(-1)}><ZoomOut size={17} /></button>
        <button className="comic-zoom" title={translateUi("Voltar ao ajuste (0)")} onClick={() => { setZoom(1); setHand(false); }}>{Math.round(zoom * 100)}%</button>
        <button className="icon-button" title={translateUi("Aumentar zoom")} onClick={() => step(1)}><ZoomIn size={17} /></button>
        <button className="icon-button" title={prefs.fit === "pagina" ? translateUi("Ajustado à página — clique para ajustar à largura") : prefs.fit === "largura" ? translateUi("Ajustado à largura — clique para o tamanho original") : translateUi("Tamanho original — clique para ajustar à página")} onClick={() => { setPrefs({ fit: prefs.fit === "pagina" ? "largura" : prefs.fit === "largura" ? "original" : "pagina" }); setZoom(1); }}>{prefs.fit === "pagina" ? <Scan size={17} /> : prefs.fit === "largura" ? <MoveHorizontal size={17} /> : <Expand size={17} />}</button>
        <button className={`icon-button ${hand ? "active" : ""}`} aria-pressed={hand} title={translateUi("Mão: arraste para mover a página ampliada")} onClick={() => setHand(!hand)}><Hand size={17} /></button>
        <button className={`icon-button ${auto ? "active" : ""}`} title={auto ? translateUi("Parar a leitura automática") : vertical ? translateUi("Rolar automaticamente") : translateUi("Passar páginas automaticamente (a cada {seconds} s)", { seconds: prefs.seconds })} onClick={() => setAuto(!auto)}>{auto ? <Pause size={17} /> : <Play size={17} />}</button>
        <button className="icon-button" title={fullscreen ? translateUi("Sair da tela cheia") : translateUi("Tela cheia")} onClick={() => { const v = !fullscreen; setFullscreen(v); void window.gcp.setFullscreen(v); }}>{fullscreen ? <Minimize2 size={17} /> : <Maximize2 size={17} />}</button>
        <button className="icon-button" title={translateUi("Opções de exibição")} aria-pressed={panel} onClick={() => setPanel(!panel)}><Settings2 size={17} /></button>
        <button className="icon-button" title={translateUi("Fechar (Esc)")} onClick={close}><X size={18} /></button>
      </header>
      <div className="book-body">
        {panel && (
          <aside className="book-panel book-type">
            <h3>{translateUi("Opções de exibição")}</h3>
            <div className="field">{translateUi("Layout da página")}<div className="book-segments comic-segments">{(["uma", "duas", "vertical"] as Layout[]).map((l) => <button key={l} className={prefs.layout === l ? "selected" : ""} onClick={() => { setPrefs({ layout: l }); setZoom(1); }}>{translateUi(l === "uma" ? "Uma página" : l === "duas" ? "Duas páginas" : "Rolagem vertical")}</button>)}</div></div>
            <label className="check"><input type="checkbox" checked={prefs.manga} onChange={(e) => setPrefs({ manga: e.target.checked })} />{" "}{translateUi("Leitura de mangá (direita para a esquerda)")}</label>
            {prefs.layout === "duas" && <label className="check"><input type="checkbox" checked={prefs.cover} onChange={(e) => setPrefs({ cover: e.target.checked })} />{" "}{translateUi("Capa sozinha (páginas duplas alinhadas)")}</label>}
            <div className="field">{translateUi("Ajuste")}<div className="book-segments comic-segments">{(["pagina", "largura", "original"] as Fit[]).map((f) => <button key={f} className={prefs.fit === f ? "selected" : ""} onClick={() => { setPrefs({ fit: f }); setZoom(1); }}>{translateUi(f === "pagina" ? "Página inteira" : f === "largura" ? "Largura" : "Original")}</button>)}</div></div>
            <div className="field">{translateUi("Fundo")}<div className="book-themes">{(Object.keys(BACKGROUNDS) as Background[]).map((b) => <button key={b} className={prefs.background === b ? "selected" : ""} style={{ background: BACKGROUNDS[b].bg, color: BACKGROUNDS[b].ink }} onClick={() => setPrefs({ background: b })}>{translateUi(b === "escuro" ? "Escuro" : b === "cinza" ? "Cinza" : "Claro")}</button>)}</div></div>
            <label className="field">{translateUi("Velocidade da animação")} · {(prefs.duration / 1000).toFixed(2)} s<input type="range" min={0} max={1200} step={20} value={prefs.duration} onChange={(e) => setPrefs({ duration: Number(e.target.value) })} /></label>
            {vertical
              ? <label className="field">{translateUi("Velocidade da rolagem automática")} · {prefs.scrollSpeed} px/s<input type="range" min={10} max={400} step={10} value={prefs.scrollSpeed} onChange={(e) => setPrefs({ scrollSpeed: Number(e.target.value) })} /></label>
              : <label className="field">{translateUi("Passar automaticamente a cada")} · {prefs.seconds} s<input type="range" min={3} max={120} step={1} value={prefs.seconds} onChange={(e) => setPrefs({ seconds: Number(e.target.value) })} /></label>}
            <p className="comic-help">{translateUi("Dica: Ctrl + roda do mouse ou duplo clique ampliam; com a mão, arraste para mover a página.")}</p>
          </aside>
        )}
        {!vertical && <button className="book-turn previous" aria-label={prefs.manga ? translateUi("Próxima página") : translateUi("Página anterior")} onClick={left}><ChevronLeft size={26} /></button>}
        <div ref={stage} className={`comic-stage ${vertical ? "vertical" : ""} ${hand ? "hand" : ""}`} onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp}
          onDoubleClick={(e) => zoomTo(zoom > 1.01 ? 1 : 2, { x: e.clientX, y: e.clientY })}>
          {!comic && <p className="book-loading"><LoaderCircle size={18} className="spin" />{" "}{translateUi("Abrindo o quadrinho…")}</p>}
          {comic && box.width > 0 && (vertical
            ? <div className="comic-strip">{comic.names.map((_, i) => <div key={i} data-comic-page={i}>{img(i, 1)}</div>)}</div>
            : <div key={turn} className={`comic-spread ${prefs.manga ? "manga" : ""}`}>{current.map((i) => img(i, current.length))}</div>)}
        </div>
        {!vertical && <button className="book-turn next" aria-label={prefs.manga ? translateUi("Página anterior") : translateUi("Próxima página")} onClick={right}><ChevronRight size={26} /></button>}
      </div>
      <footer className="book-progress">
        <input type="range" className={prefs.manga ? "manga" : ""} min={0} max={Math.max(0, count - 1)} value={page} aria-label={translateUi("Posição no quadrinho")} onChange={(e) => goToPage(Number(e.target.value))} />
        <span>{translateUi("Página")} {shown.join("–")} {translateUi("de")} {count} · {count ? Math.round(((page + 1) / count) * 100) : 0}%</span>
      </footer>
    </div>
  );
}
