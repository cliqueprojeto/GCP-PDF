import {t as translateUi} from "./i18n";
import React, { useEffect, useMemo, useState } from "react";
import { Printer, ChevronLeft, ChevronRight } from "lucide-react";
import type { DocumentInfo } from "../shared/types";
import { Modal } from "./Dialogs";
import { PageThumb } from "./Viewer";

type Range = "all" | "current" | "selected" | "custom";
function parseRange(text: string, count: number): number[] | null {
  const pages: number[] = [];
  for (const part of text.split(/[,;]/).map((p) => p.trim()).filter(Boolean)) {
    const m = /^(\d+)\s*(?:-\s*(\d+))?$/.exec(part);
    if (!m) return null;
    const from = Number(m[1]), to = Number(m[2] ?? m[1]);
    if (from < 1 || to < from || to > count) return null;
    for (let p = from; p <= to; p++) pages.push(p - 1);
  }
  return pages.length ? pages : null;
}
/** Print with an on-screen preview of exactly the pages that will be printed. */
export function PrintDialog({ doc, current, selected, onClose, onPrint }: { doc: DocumentInfo; current: number; selected: number[]; onClose: () => void; onPrint: (input: Parameters<typeof window.gcp.printPages>[1]) => void }) {
  const [printers, setPrinters] = useState<{ name: string; displayName: string; isDefault: boolean }[]>([]), [printer, setPrinter] = useState("");
  const [range, setRange] = useState<Range>("all"), [custom, setCustom] = useState(`1-${doc.pageCount}`), [copies, setCopies] = useState(1);
  const [color, setColor] = useState(true), [duplex, setDuplex] = useState<"simplex" | "longEdge" | "shortEdge">("simplex"), [quality, setQuality] = useState<"normal" | "high">("normal"), [at, setAt] = useState(0);
  useEffect(() => { void window.gcp.listPrinters().then((list) => { setPrinters(list); setPrinter((list.find((p) => p.isDefault) ?? list[0])?.name ?? ""); }).catch(() => {}); }, []);
  const pages = useMemo(() => range === "all" ? doc.pages.map((_, i) => i) : range === "current" ? [current] : range === "selected" ? [...selected].sort((a, b) => a - b) : parseRange(custom, doc.pageCount) ?? [], [range, custom, current, selected, doc]);
  useEffect(() => setAt(0), [pages.length]);
  const shown = pages[Math.min(at, pages.length - 1)];
  return (
    <Modal title={translateUi("Imprimir")} description={`${doc.name} · ${pages.length} página${pages.length !== 1 ? "s" : ""}${copies > 1 ? ` × ${copies} cópias` : ""}`} onClose={onClose} wide>
      <div className="print-dialog">
        <aside className="print-options">
          <label className="field">{translateUi("Impressora")}{" "}<select value={printer} onChange={(e) => setPrinter(e.target.value)}>{printers.map((p) => <option key={p.name} value={p.name}>{p.displayName}{p.isDefault ? translateUi(" (padrão)") : ""}</option>)}</select>
          </label>
          <div className="field">{translateUi("Páginas")}{" "}<div className="radio-list">
              {([["all", `Todas (${doc.pageCount})`], ["current", `Página atual (${current + 1})`], ["selected", `Selecionadas (${selected.length})`], ["custom", "Intervalo"]] as const).map(([value, label]) => (
                <label key={value} className="check-row"><input type="radio" name="print-range" checked={range === value} disabled={value === "selected" && !selected.length} onChange={() => setRange(value)} /> {translateUi(label)}</label>
              ))}
              {range === "custom" && <input value={custom} onChange={(e) => setCustom(e.target.value)} placeholder={translateUi("Ex.: 1-3, 5, 8-10")} className={parseRange(custom, doc.pageCount) ? "" : "invalid"} />}
            </div>
          </div>
          <div className="field-row">
            <label className="field">{translateUi("Cópias")}<input type="number" min={1} max={99} value={copies} onChange={(e) => setCopies(Math.max(1, Math.min(99, Number(e.target.value) || 1)))} /></label>
            <label className="field">{translateUi("Cor")}<select value={color ? "color" : "mono"} onChange={(e) => setColor(e.target.value === "color")}><option value="color">{translateUi("Colorida")}</option><option value="mono">{translateUi("Preto e branco")}</option></select></label>
          </div>
          <label className="field">{translateUi("Frente e verso")}<select value={duplex} onChange={(e) => setDuplex(e.target.value as "simplex")}><option value="simplex">{translateUi("Só frente")}</option><option value="longEdge">{translateUi("Frente e verso (borda longa)")}</option><option value="shortEdge">{translateUi("Frente e verso (borda curta)")}</option></select></label>
          <label className="field">{translateUi("Qualidade")}<select value={quality} onChange={(e) => setQuality(e.target.value as "normal")}><option value="normal">{translateUi("Normal (200 dpi)")}</option><option value="high">{translateUi("Alta (300 dpi)")}</option></select></label>
        </aside>
        <div className={`print-preview ${color ? "" : "mono"}`}>
          {shown !== undefined && doc.pages[shown] ? (
            <>
              <div className="print-sheet"><PageThumb key={doc.pages[shown]!.id + doc.pages[shown]!.rotate} pageRef={doc.pages[shown]!} width={300} /></div>
              <div className="print-nav">
                <button className="icon-button" disabled={at <= 0} onClick={() => setAt(at - 1)} title={translateUi("Página anterior")}><ChevronLeft size={16} /></button>
                <span>{at + 1}{" "}{translateUi("de")}{" "}{pages.length}{" "}{translateUi("· página")}{" "}{shown + 1}{" "}{translateUi("do documento")}</span>
                <button className="icon-button" disabled={at >= pages.length - 1} onClick={() => setAt(at + 1)} title={translateUi("Próxima página")}><ChevronRight size={16} /></button>
              </div>
            </>
          ) : <p className="sidebar-description">{translateUi("Escolha pelo menos uma página válida.")}</p>}
        </div>
      </div>
      <div className="modal-footer">
        <button className="button secondary" onClick={onClose}>{translateUi("Cancelar")}</button>
        <button className="button primary" disabled={!pages.length || !printer} onClick={() => onPrint({ pages, printer, copies, color, duplex, quality })}><Printer size={15} />{" "}{translateUi("Imprimir")}</button>
      </div>
    </Modal>
  );
}
