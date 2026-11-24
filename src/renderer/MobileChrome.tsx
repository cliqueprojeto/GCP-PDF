import React, { useEffect, useRef, useState } from "react";
import {
  ArrowLeft, Undo2, Redo2, Search, MoreVertical, Save, FilePen, Share2, Printer, FileOutput, Files, Bookmark, MessageSquare, Signature, Sparkles,
  Info, Settings, Sun, Moon, HelpCircle, Heart, X, FolderOpen, FilePlus2, Layers3, FileInput, Maximize2, BookOpen,
  House, PenLine, LayoutGrid, FormInput, ArrowLeftRight, ShieldCheck, SpellCheck2, Eye, SlidersHorizontal,
} from "lucide-react";
import { t as translateUi } from "./i18n";

/** Phones and tablets: the Android build marks the page with `mobile`; compact layouts are the narrow ones. */
export function isMobileDevice() { return document.documentElement.classList.contains("mobile"); }
export function useCompact(): boolean {
  // Narrow windows and short ones (a phone held sideways) use the compact layout.
  const query = "(max-width: 899px), (max-height: 599px)";
  const [compact, setCompact] = useState(() => isMobileDevice() && matchMedia(query).matches);
  useEffect(() => {
    if (!isMobileDevice()) return;
    const media = matchMedia(query), update = () => setCompact(media.matches);
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);
  return compact;
}

/** Android-only services of the mobile shell (src/mobile/shell.tsx): sharing the document as it is now. */
export function mobileShell(): { share(id: string, name: string): Promise<void> } | undefined {
  return (window as unknown as { gcpMobile?: { share(id: string, name: string): Promise<void> } }).gcpMobile;
}

export interface MobileMenuItem { id: string; label: string; icon: React.ReactNode; run: () => void; disabled?: boolean; danger?: boolean; group: string }

/** Top app bar of the phone layout: back to the library, document, undo/redo, search and the overflow menu. */
export function MobileTopBar(props: {
  title: string; subtitle?: string; dirty: boolean; home: boolean; canUndo: boolean; canRedo: boolean;
  onBack: () => void; onUndo: () => void; onRedo: () => void; onSearch: () => void; onMenu: () => void; onTitle?: () => void;
}) {
  return (
    <header className="m-topbar">
      {!props.home && <button className="m-icon" aria-label={translateUi("Voltar para a página inicial")} onClick={props.onBack}><ArrowLeft size={22} /></button>}
      {props.home ? (
        <div className="m-brand"><span className="m-brand-mark" aria-hidden="true">PDF</span><strong>GCP<span>/</span>PDF</strong></div>
      ) : (
        <button className="m-title" onClick={props.onTitle}>
          <strong>{props.title}</strong>
          <small>{props.dirty ? <span className="m-dirty">{translateUi("Não salvo")}</span> : null}{props.subtitle}</small>
        </button>
      )}
      <div className="m-spacer" />
      {!props.home && <>
        <button className="m-icon" aria-label={translateUi("Desfazer")} disabled={!props.canUndo} onClick={props.onUndo}><Undo2 size={20} /></button>
        <button className="m-icon" aria-label={translateUi("Refazer")} disabled={!props.canRedo} onClick={props.onRedo}><Redo2 size={20} /></button>
        <button className="m-icon" aria-label={translateUi("Pesquisar no PDF")} onClick={props.onSearch}><Search size={20} /></button>
      </>}
      <button className="m-icon" aria-label={translateUi("Mais opções")} onClick={props.onMenu}><MoreVertical size={21} /></button>
    </header>
  );
}

/** Bottom sheet listing every document command that the desktop keeps in its title bar, side rail and menus. */
export function MobileMenu({ items, onClose, title }: { items: MobileMenuItem[]; onClose: () => void; title: string }) {
  const groups = [...new Set(items.map((i) => i.group))];
  return (
    <div className="m-sheet-backdrop" onClick={onClose}>
      <div className="m-sheet m-menu open" role="menu" onClick={(e) => e.stopPropagation()}>
        <div className="m-sheet-handle" />
        <div className="m-sheet-title"><strong>{title}</strong><button className="m-icon" aria-label={translateUi("Fechar")} onClick={onClose}><X size={20} /></button></div>
        <div className="m-menu-scroll">
          {groups.map((group) => (
            <section key={group}>
              <h3>{translateUi(group)}</h3>
              <div className="m-menu-grid">
                {items.filter((i) => i.group === group).map((item) => (
                  <button key={item.id} role="menuitem" className={item.danger ? "danger" : ""} disabled={item.disabled} onClick={() => { onClose(); item.run(); }}>
                    <span className="m-menu-icon">{item.icon}</span><span>{translateUi(item.label)}</span>
                  </button>
                ))}
              </div>
            </section>
          ))}
        </div>
      </div>
    </div>
  );
}

/** Icons of the tool categories in the bottom bar (the desktop shows only their names). */
export const TAB_ICONS: Record<string, React.ReactNode> = {
  "Início": <House size={20} />, "Editar": <PenLine size={20} />, "Comentário": <MessageSquare size={20} />, "Organizar": <LayoutGrid size={20} />,
  "Formulário": <FormInput size={20} />, "Converter": <ArrowLeftRight size={20} />, "Assinar": <Signature size={20} />, "Proteger": <ShieldCheck size={20} />,
  "Revisar": <SpellCheck2 size={20} />, "Exibição": <Eye size={20} />, "IA": <Sparkles size={20} />,
};
export const PROPERTIES_ICON = <SlidersHorizontal size={18} />;
export const MOBILE_ICONS = { Save, FilePen, Share2, Printer, FileOutput, Files, Bookmark, MessageSquare, Signature, Sparkles, Info, Settings, Sun, Moon, HelpCircle, Heart, FolderOpen, FilePlus2, Layers3, FileInput, Maximize2, BookOpen };

/**
 * Two-finger zoom on the document. The page scales live under the fingers (a CSS transform of the scroller's
 * content); on release the real zoom is applied once and the point between the fingers stays in place.
 */
export function usePinchZoom(_host: React.RefObject<HTMLElement | null>, zoom: number, setZoom: (value: number) => void, enabled: boolean) {
  const zoomRef = useRef(zoom);
  zoomRef.current = zoom;
  useEffect(() => {
    if (!enabled) return;
    // Listens on the document: the viewer is re-created when the tab or document changes.
    let start: { distance: number; x: number; y: number; scroller: HTMLElement; content: HTMLElement; left: number; top: number } | null = null, factor = 1;
    const distance = (t: TouchList) => Math.hypot(t[0]!.clientX - t[1]!.clientX, t[0]!.clientY - t[1]!.clientY);
    const middle = (t: TouchList) => ({ x: (t[0]!.clientX + t[1]!.clientX) / 2, y: (t[0]!.clientY + t[1]!.clientY) / 2 });
    const down = (e: TouchEvent) => {
      if (e.touches.length !== 2) return;
      const scroller = (e.target as HTMLElement).closest?.(".viewer-host")?.querySelector<HTMLElement>(".canvas-scroll"), content = scroller?.firstElementChild as HTMLElement | null;
      if (!scroller || !content) return;
      const m = middle(e.touches), box = scroller.getBoundingClientRect();
      start = { distance: distance(e.touches), x: m.x - box.left, y: m.y - box.top, scroller, content, left: scroller.scrollLeft, top: scroller.scrollTop };
      factor = 1;
      content.style.transformOrigin = `${start.left + start.x}px ${start.top + start.y}px`;
    };
    const move = (e: TouchEvent) => {
      if (!start || e.touches.length !== 2) return;
      e.preventDefault();
      const next = Math.max(0.25, Math.min(5, zoomRef.current * distance(e.touches) / start.distance));
      factor = next / zoomRef.current;
      start.content.style.transform = `scale(${factor})`;
    };
    const up = (e: TouchEvent) => {
      if (!start || e.touches.length >= 2) return;
      const { scroller, content, x, y, left, top } = start;
      start = null;
      content.style.transform = ""; content.style.transformOrigin = "";
      if (Math.abs(factor - 1) < 0.03) return;
      setZoom(Math.round(zoomRef.current * factor * 100) / 100);
      // Keep the point under the fingers where it was once the pages are laid out at the new size.
      requestAnimationFrame(() => requestAnimationFrame(() => {
        scroller.scrollLeft = (left + x) * factor - x;
        scroller.scrollTop = (top + y) * factor - y;
      }));
    };
    document.addEventListener("touchstart", down, { passive: true, capture: true });
    document.addEventListener("touchmove", move, { passive: false, capture: true });
    document.addEventListener("touchend", up, { capture: true });
    document.addEventListener("touchcancel", up, { capture: true });
    return () => {
      document.removeEventListener("touchstart", down, { capture: true });
      document.removeEventListener("touchmove", move, { capture: true });
      document.removeEventListener("touchend", up, { capture: true });
      document.removeEventListener("touchcancel", up, { capture: true });
    };
  }, [enabled, setZoom]);
}

/**
 * "Editar tudo" on a phone: the tapped block of the PDF opens in a sheet with large text fields (one per line
 * group or table cell of the block). Applying rewrites the original text in place with the same engine and
 * fonts as the desktop's on-page editor.
 */
const stop = (e: React.SyntheticEvent) => e.stopPropagation();
export function MobileTextSheet({ texts, busy, onCancel, onApply }: { texts: string[]; busy: boolean; onCancel: () => void; onApply: (texts: string[]) => void }) {
  const [values, setValues] = useState(texts);
  const changed = values.some((v, i) => v !== texts[i]);
  return (
    // Rendered in a portal from the page: React would still bubble its taps and keys to the page, whose
    // "tap outside the block" handling would close this editor while the user places the caret.
    <div className="m-sheet-backdrop" onPointerDown={(e) => { e.stopPropagation(); if (e.target === e.currentTarget && !busy) onCancel(); }}
      onPointerUp={stop} onPointerMove={stop} onClick={stop} onDoubleClick={stop} onMouseDown={stop} onMouseUp={stop} onTouchStart={stop} onTouchEnd={stop} onContextMenu={stop} onKeyDown={stop} onKeyUp={stop}>
      <div className="m-sheet m-text-sheet open" role="dialog" aria-label={translateUi("Editar texto do PDF")}>
        <div className="m-sheet-handle" />
        <div className="m-sheet-title"><strong>{translateUi("Editar texto do PDF")}</strong><button className="m-icon" aria-label={translateUi("Fechar")} disabled={busy} onClick={onCancel}><X size={20} /></button></div>
        <p className="m-text-hint">{translateUi("A fonte, o tamanho e a cor do PDF são mantidos. Se o texto não couber, a letra é reduzida um pouco.")}</p>
        <div className="m-text-fields">
          {values.map((value, i) => (
            <textarea key={i} value={value} rows={Math.min(8, Math.max(2, value.split("\n").length + 1))} autoFocus={i === 0} disabled={busy}
              onChange={(e) => setValues((all) => all.map((v, j) => (j === i ? e.target.value : v)))} />
          ))}
        </div>
        <div className="m-text-actions">
          <button className="button secondary" disabled={busy} onClick={onCancel}>{translateUi("Cancelar")}</button>
          <button className="button primary" disabled={busy || !changed} onClick={() => onApply(values)}>{busy ? translateUi("Aplicando no PDF…") : translateUi("Aplicar")}</button>
        </div>
      </div>
    </div>
  );
}
