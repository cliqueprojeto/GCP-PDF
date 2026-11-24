import React, { useEffect, useRef, useState } from "react";
import {
  ArrowLeft, Undo2, Redo2, Search, MoreVertical, Save, FilePen, Share2, Printer, FileOutput, Files, Bookmark, MessageSquare, Signature, Sparkles,
  Info, Settings, Sun, Moon, HelpCircle, Heart, X, FolderOpen, FilePlus2, Layers3, FileInput, Maximize2, BookOpen,
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

export const MOBILE_ICONS = { Save, FilePen, Share2, Printer, FileOutput, Files, Bookmark, MessageSquare, Signature, Sparkles, Info, Settings, Sun, Moon, HelpCircle, Heart, FolderOpen, FilePlus2, Layers3, FileInput, Maximize2, BookOpen };

/**
 * Two-finger zoom on the document. The page scales live under the fingers (a CSS transform of the scroller's
 * content); on release the real zoom is applied once and the point between the fingers stays in place.
 */
export function usePinchZoom(host: React.RefObject<HTMLElement | null>, zoom: number, setZoom: (value: number) => void, enabled: boolean) {
  const zoomRef = useRef(zoom);
  zoomRef.current = zoom;
  useEffect(() => {
    const element = host.current;
    if (!element || !enabled) return;
    let start: { distance: number; x: number; y: number; scroller: HTMLElement; content: HTMLElement; left: number; top: number } | null = null, factor = 1;
    const distance = (t: TouchList) => Math.hypot(t[0]!.clientX - t[1]!.clientX, t[0]!.clientY - t[1]!.clientY);
    const middle = (t: TouchList) => ({ x: (t[0]!.clientX + t[1]!.clientX) / 2, y: (t[0]!.clientY + t[1]!.clientY) / 2 });
    const down = (e: TouchEvent) => {
      if (e.touches.length !== 2) return;
      const scroller = element.querySelector<HTMLElement>(".canvas-scroll"), content = scroller?.firstElementChild as HTMLElement | null;
      if (!scroller || !content) return;
      const m = middle(e.touches), box = scroller.getBoundingClientRect();
      start = { distance: distance(e.touches), x: m.x - box.left, y: m.y - box.top, scroller, content, left: scroller.scrollLeft, top: scroller.scrollTop };
      factor = 1;
      content.style.transformOrigin = `${start.left + start.x}px ${start.top + start.y}px`;
      content.style.willChange = "transform";
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
      const {scroller, content, x, y, left, top} = start;
      start = null;
      content.style.transform = ""; content.style.willChange = ""; content.style.transformOrigin = "";
      if (Math.abs(factor - 1) < 0.03) return;
      const target = Math.round(zoomRef.current * factor * 100) / 100;
      setZoom(target);
      // Keep the point under the fingers where it was once the pages are laid out at the new size.
      requestAnimationFrame(() => requestAnimationFrame(() => {
        scroller.scrollLeft = (left + x) * factor - x;
        scroller.scrollTop = (top + y) * factor - y;
      }));
    };
    element.addEventListener("touchstart", down, { passive: true });
    element.addEventListener("touchmove", move, { passive: false });
    element.addEventListener("touchend", up);
    element.addEventListener("touchcancel", up);
    return () => {
      element.removeEventListener("touchstart", down);
      element.removeEventListener("touchmove", move);
      element.removeEventListener("touchend", up);
      element.removeEventListener("touchcancel", up);
    };
  }, [host, enabled, setZoom]);
}
