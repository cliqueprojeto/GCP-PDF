import {t as translateUi} from "./i18n";
import React, { useState } from "react";
import {
  RotateCcw, RotateCw, Trash2, FilePlus2, FileInput, Replace, Scissors, Hash, FileOutput, Plus, X, LoaderCircle, Check, Minimize2, Save, CheckSquare, Square,
} from "lucide-react";
import type { CompressLevel, CompressOptions, DocumentInfo, PageObject } from "../shared/types";
import { toPage } from "../shared/geometry";
import { PageThumb } from "./Viewer";
import { Modal } from "./Dialogs";
import { loadPage } from "./pdf";
import { uid } from "./editor";

export interface OrganizeActions {
  rotate(degrees: number, pages: number[]): void;
  remove(pages: number[]): void;
  blank(index: number): void;
  insertFile(index: number): void;
  move(pages: number[], index: number): void;
  extract(mode: "tab" | "file" | "files"): void;
  replace(): void;
  split(): void;
  numbering(): void;
  compress(): void;
  close(): void;
}
const PAGE_MIME = "application/x-gcp-pages";
/** Visual page organizer: a grid of large pages with per-page actions and drag-and-drop ordering. */
export function OrganizeView({ doc, selection, setSelection, actions, onContextMenu }: { doc: DocumentInfo; selection: Set<number>; setSelection: (s: Set<number>) => void; actions: OrganizeActions; onContextMenu: (e: React.MouseEvent, index: number) => void }) {
  const [size, setSize] = useState(170), [drop, setDrop] = useState<number | null>(null), [insertAt, setInsertAt] = useState<number | null>(null), [extractOpen, setExtractOpen] = useState(false);
  const chosen = [...selection].sort((a, b) => a - b), none = !chosen.length;
  const toggle = (index: number, e: React.MouseEvent) => {
    if (e.shiftKey && chosen.length) { const from = Math.min(chosen[0]!, index), to = Math.max(chosen.at(-1)!, index); setSelection(new Set(Array.from({ length: to - from + 1 }, (_, i) => from + i))); return; }
    const next = new Set(e.ctrlKey || e.metaKey || (e.target as HTMLElement).closest(".organize-check") ? selection : []);
    next.has(index) && (e.ctrlKey || e.metaKey || (e.target as HTMLElement).closest(".organize-check")) ? next.delete(index) : next.add(index);
    setSelection(next);
  };
  const dropAt = (e: React.DragEvent, index: number) => {
    e.preventDefault(); setDrop(null);
    try { const data = JSON.parse(e.dataTransfer.getData(PAGE_MIME)); if (data?.sourceId === doc.id && Array.isArray(data.pages)) actions.move(data.pages, index); } catch {}
  };
  const gap = (index: number) => (
    <div className={`organize-gap ${drop === index ? "active" : ""}`} onDragOver={(e) => { if (e.dataTransfer.types.includes(PAGE_MIME)) { e.preventDefault(); setDrop(index); } }} onDragLeave={() => setDrop(null)} onDrop={(e) => dropAt(e, index)}>
      <button title={translateUi("Inserir página aqui")} onClick={() => setInsertAt(insertAt === index ? null : index)}><Plus size={13} /></button>
      {insertAt === index && (
        <div className="organize-insert-menu">
          <button onClick={() => { actions.blank(index); setInsertAt(null); }}><FilePlus2 size={14} />{" "}{translateUi("Página em branco")}</button>
          <button onClick={() => { actions.insertFile(index); setInsertAt(null); }}><FileInput size={14} />{" "}{translateUi("De um arquivo…")}</button>
        </div>
      )}
    </div>
  );
  return (
    <div className="organize">
      <aside className="organize-tools">
        <div className="section-label">{translateUi("Opções de página")}</div>
        <div className="organize-quick">
          <button title={translateUi("Girar à esquerda")} disabled={none} onClick={() => actions.rotate(-90, chosen)}><RotateCcw size={17} /></button>
          <button title={translateUi("Girar à direita")} disabled={none} onClick={() => actions.rotate(90, chosen)}><RotateCw size={17} /></button>
          <button title={translateUi("Excluir")} disabled={none || chosen.length === doc.pageCount} onClick={() => actions.remove(chosen)}><Trash2 size={17} /></button>
        </div>
        <button className="organize-tool" onClick={() => actions.blank(chosen.length ? chosen.at(-1)! + 1 : doc.pageCount)}><FilePlus2 size={16} />{" "}{translateUi("Inserir página em branco")}</button>
        <button className="organize-tool" onClick={() => actions.insertFile(chosen.length ? chosen.at(-1)! + 1 : doc.pageCount)}><FileInput size={16} />{" "}{translateUi("Inserir de arquivo")}</button>
        <button className="organize-tool" disabled={none} onClick={actions.replace}><Replace size={16} />{" "}{translateUi("Substituir páginas")}</button>
        <div className="organize-tool-group">
          <button className="organize-tool" disabled={none} onClick={() => setExtractOpen(!extractOpen)}><FileOutput size={16} />{" "}{translateUi("Extrair páginas")}</button>
          {extractOpen && !none && (
            <div className="organize-submenu">
              <button onClick={() => { actions.extract("tab"); setExtractOpen(false); }}>{translateUi("Abrir em nova aba")}</button>
              <button onClick={() => { actions.extract("file"); setExtractOpen(false); }}>{translateUi("Salvar em um único PDF…")}</button>
              <button onClick={() => { actions.extract("files"); setExtractOpen(false); }}>{translateUi("Um PDF por página…")}</button>
            </div>
          )}
        </div>
        <button className="organize-tool" onClick={actions.split}><Scissors size={16} />{" "}{translateUi("Dividir documento")}</button>
        <button className="organize-tool" onClick={actions.numbering}><Hash size={16} />{" "}{translateUi("Numerar páginas")}</button>
        <button className="organize-tool" onClick={actions.compress}><Minimize2 size={16} />{" "}{translateUi("Comprimir PDF")}</button>
        <p className="organize-help">{translateUi("Clique para selecionar, Ctrl para várias, Shift para um intervalo. Arraste as páginas para reordenar ou para outra janela.")}</p>
      </aside>
      <section className="organize-main">
        <div className="organize-bar">
          <strong>{translateUi("Organizar páginas")}</strong>
          <span>{doc.pageCount}{" "}{translateUi("página")}{doc.pageCount > 1 ? translateUi("s") : ""}{chosen.length ? ` · ${chosen.length} selecionada${chosen.length > 1 ? "s" : ""}` : ""}</span>
          <button className="text-button" onClick={() => setSelection(chosen.length === doc.pageCount ? new Set() : new Set(doc.pages.map((_, i) => i)))}>{chosen.length === doc.pageCount ? <><Square size={14} />{" "}{translateUi("Limpar seleção")}</> : <><CheckSquare size={14} />{" "}{translateUi("Selecionar todas")}</>}</button>
          <label className="slider-row">{translateUi("Tamanho")}<input type="range" min={110} max={300} value={size} onChange={(e) => setSize(Number(e.target.value))} /></label>
          <button className="button secondary" onClick={actions.close}><X size={15} />{" "}{translateUi("Fechar")}</button>
        </div>
        <div className="organize-grid" style={{ ["--card" as string]: `${size + 28}px` }}>
          {doc.pages.map((ref, index) => (
            <React.Fragment key={ref.id}>
              {gap(index)}
              <div
                className={`organize-card ${selection.has(index) ? "selected" : ""}`}
                draggable
                tabIndex={0}
                onClick={(e) => toggle(index, e)}
                onContextMenu={(e) => { e.preventDefault(); if (!selection.has(index)) setSelection(new Set([index])); onContextMenu(e, index); }}
                onDragStart={(e) => { const pages = selection.has(index) ? chosen : [index]; const payload = JSON.stringify({ sourceId: doc.id, sourceRevision: doc.revision, pages }); e.dataTransfer.setData(PAGE_MIME, payload); e.dataTransfer.setData("text/plain", payload); e.dataTransfer.effectAllowed = "copyMove"; }}
                onDragOver={(e) => { if (e.dataTransfer.types.includes(PAGE_MIME)) { e.preventDefault(); const r = e.currentTarget.getBoundingClientRect(); setDrop(e.clientX < r.left + r.width / 2 ? index : index + 1); } }}
                onDrop={(e) => dropAt(e, drop ?? index)}
              >
                <span className="organize-check">{selection.has(index) ? <Check size={12} /> : null}</span>
                <div className="organize-thumb"><PageThumb pageRef={ref} width={size} /></div>
                <span className="organize-number">{index + 1}</span>
                <div className="organize-card-actions" onClick={(e) => e.stopPropagation()}>
                  <button title={translateUi("Girar à esquerda")} onClick={() => actions.rotate(-90, [index])}><RotateCcw size={14} /></button>
                  <button title={translateUi("Girar à direita")} onClick={() => actions.rotate(90, [index])}><RotateCw size={14} /></button>
                  <button title={translateUi("Excluir página")} disabled={doc.pageCount < 2} onClick={() => actions.remove([index])}><Trash2 size={14} /></button>
                </div>
              </div>
            </React.Fragment>
          ))}
          {gap(doc.pageCount)}
        </div>
      </section>
    </div>
  );
}

type Spot = "tl" | "tc" | "tr" | "bl" | "bc" | "br";
const FORMATS = [
  { id: "n", label: "1", make: (n: number) => `${n}` },
  { id: "page", label: "Página 1", make: (n: number) => `Página ${n}` },
  { id: "of", label: "Página 1 de 10", make: (n: number, t: number) => `Página ${n} de ${t}` },
  { id: "slash", label: "1 / 10", make: (n: number, t: number) => `${n} / ${t}` },
  { id: "bates", label: "Bates: PREFIXO000001", make: (n: number, _t: number, prefix: string, digits: number) => `${prefix}${String(n).padStart(digits, "0")}` },
];
/** Page numbers and Bates stamps added as editable text objects (one undo step). */
export function NumberingDialog({ doc, selection, onClose, onApply }: { doc: DocumentInfo; selection: number[]; onClose: () => void; onApply: (objects: PageObject[]) => Promise<void> }) {
  const [spot, setSpot] = useState<Spot>("bc"), [format, setFormat] = useState("of"), [start, setStart] = useState(1), [size, setSize] = useState(10), [color, setColor] = useState("#1f1a2e");
  const [margin, setMargin] = useState(28), [prefix, setPrefix] = useState("DOC-"), [digits, setDigits] = useState(6), [scope, setScope] = useState<"all" | "selected">("all"), [busy, setBusy] = useState(false);
  const pages = scope === "all" || !selection.length ? doc.pages.map((_, i) => i) : selection, make = FORMATS.find((f) => f.id === format)!.make;
  const preview = make(start, doc.pageCount + start - 1, prefix, digits);
  async function apply() {
    setBusy(true);
    try {
      const objects: PageObject[] = [];
      for (const [n, index] of pages.entries()) {
        const ref = doc.pages[index]!, page = await loadPage(ref), [x0, y0, x1, y1] = page.view, unrotated = { width: x1 - x0, height: y1 - y0 };
        const rotation = (page.rotate + ref.rotate) % 360, display = rotation % 180 ? { width: unrotated.height, height: unrotated.width } : unrotated;
        const text = make(start + n, start + pages.length - 1, prefix, digits), width = Math.min(display.width - margin * 2, Math.max(120, text.length * size * 0.62));
        const dx = spot[1] === "l" ? margin : spot[1] === "c" ? (display.width - width) / 2 : display.width - margin - width, dy = spot[0] === "t" ? margin : display.height - margin - size * 1.25;
        const at = toPage(dx, dy, unrotated, rotation, 1);
        objects.push({ id: uid(), page: ref.id, kind: "text", x: at.x, y: at.y, width, height: size * 1.25, text, size, color, font: "sans", bold: format === "bates", italic: false, align: spot[1] === "l" ? "left" : spot[1] === "c" ? "center" : "right", rotation: (360 - rotation) % 360 });
      }
      await onApply(objects);
      onClose();
    } finally { setBusy(false); }
  }
  return (
    <Modal title={translateUi("Numerar páginas")} description={translateUi("Os números entram como texto editável: você pode movê-los ou excluí-los depois.")} onClose={onClose} wide>
      <div className="numbering">
        <div className="numbering-spots">
          {(["tl", "tc", "tr", "bl", "bc", "br"] as Spot[]).map((s) => <button key={s} className={`spot ${s} ${spot === s ? "active" : ""}`} onClick={() => setSpot(s)} title={translateUi("Posição")}>{spot === s && <span>{preview}</span>}</button>)}
        </div>
        <div className="numbering-form">
          <label className="field">{translateUi("Formato")}<select value={format} onChange={(e) => setFormat(e.target.value)}>{FORMATS.map((f) => <option key={f.id} value={f.id}>{translateUi(f.label)}</option>)}</select></label>
          {format === "bates" && (
            <div className="field-row">
              <label className="field">{translateUi("Prefixo")}<input value={prefix} onChange={(e) => setPrefix(e.target.value.slice(0, 30))} /></label>
              <label className="field">{translateUi("Dígitos")}<input type="number" min={1} max={12} value={digits} onChange={(e) => setDigits(Math.max(1, Math.min(12, Number(e.target.value) || 6)))} /></label>
            </div>
          )}
          <div className="field-row">
            <label className="field">{translateUi("Começar em")}<input type="number" min={0} value={start} onChange={(e) => setStart(Math.max(0, Number(e.target.value) || 0))} /></label>
            <label className="field">{translateUi("Tamanho (pt)")}<input type="number" min={6} max={48} value={size} onChange={(e) => setSize(Math.max(6, Math.min(48, Number(e.target.value) || 10)))} /></label>
            <label className="field">{translateUi("Margem (pt)")}<input type="number" min={6} max={120} value={margin} onChange={(e) => setMargin(Math.max(6, Math.min(120, Number(e.target.value) || 28)))} /></label>
            <label className="field">{translateUi("Cor")}<input type="color" value={color} onChange={(e) => setColor(e.target.value)} /></label>
          </div>
          <div className="field-row">
            <label className="radio-inline"><input type="radio" checked={scope === "all"} onChange={() => setScope("all")} />{" "}{translateUi("Todas as páginas")}</label>
            <label className="radio-inline"><input type="radio" checked={scope === "selected"} disabled={!selection.length} onChange={() => setScope("selected")} />{" "}{translateUi("Páginas selecionadas (")}{selection.length})</label>
          </div>
          <div className="numbering-preview">{translateUi("Exemplo:")}{" "}<strong>{preview}</strong></div>
        </div>
      </div>
      <div className="modal-footer">
        <button className="button secondary" onClick={onClose}>{translateUi("Cancelar")}</button>
        <button className="button primary" disabled={busy} onClick={() => void apply()}>{busy ? <LoaderCircle size={15} className="spin" /> : <Hash size={15} />}{" "}{translateUi("Numerar")}{" "}{pages.length}{" "}{translateUi("página")}{pages.length > 1 ? translateUi("s") : ""}</button>
      </div>
    </Modal>
  );
}

const LEVELS: { id: CompressLevel; title: string; detail: string }[] = [
  { id: "lossless", title: "Sem perdas", detail: "Mesma qualidade; só reorganiza e compacta a estrutura" },
  { id: "high", title: "Alta qualidade", detail: "Imagens até 200 dpi · JPEG 85%" },
  { id: "medium", title: "Média", detail: "Imagens até 150 dpi · JPEG 60% · equilíbrio recomendado" },
  { id: "low", title: "Baixa", detail: "Imagens até 110 dpi · JPEG 45% · para e-mail" },
  { id: "extreme", title: "Extrema", detail: "Imagens até 72 dpi · JPEG 30% · menor arquivo possível" },
];
const megabytes = (n: number) => `${(n / 1024 / 1024).toLocaleString("pt-BR", { maximumFractionDigits: n < 10 * 1024 * 1024 ? 2 : 1 })} MB`;
export function CompressDialog({ doc, onClose, onDone, onError }: { doc: DocumentInfo; onClose: () => void; onDone: (message: string) => void; onError: (error: unknown) => void }) {
  const [level, setLevel] = useState<CompressLevel>("medium"), [extras, setExtras] = useState({ metadata: true, bookmarks: false, attachments: false, comments: false });
  const [sizes, setSizes] = useState<Record<string, { original: number; size: number } | "busy">>({}), [busy, setBusy] = useState("");
  const options = (id: CompressLevel): CompressOptions => ({ level: id, ...extras }), key = (id: CompressLevel) => `${id}:${JSON.stringify(extras)}`;
  async function measure(id: CompressLevel) {
    setSizes((s) => ({ ...s, [key(id)]: "busy" }));
    try { const result = await window.gcp.compressPreview(doc.id, options(id)); setSizes((s) => ({ ...s, [key(id)]: result })); }
    catch (error) { setSizes((s) => { const next = { ...s }; delete next[key(id)]; return next; }); onError(error); }
  }
  async function run(mode: "apply" | "save") {
    setBusy(mode === "apply" ? "Comprimindo o documento…" : "Gerando cópia comprimida…");
    try {
      const path = await window.gcp.compressApply(doc.id, options(level), mode);
      if (mode === "apply") { onDone("Documento comprimido. Salve para gravar o arquivo menor."); onClose(); }
      else if (path) { onDone("Cópia comprimida salva."); onClose(); }
    } catch (error) { onError(error); } finally { setBusy(""); }
  }
  const toggle = (name: keyof typeof extras, label: string) => <label className="check-row"><input type="checkbox" checked={extras[name]} onChange={(e) => setExtras((x) => ({ ...x, [name]: e.target.checked }))} /> {translateUi(label)}</label>;
  return (
    <Modal title={translateUi("Comprimir PDF")} description={doc.name} onClose={onClose} wide>
      <div className="compress">
        <div className="compress-levels">
          {LEVELS.map((item) => {
            const result = sizes[key(item.id)];
            return (
              <button key={item.id} className={`compress-level ${level === item.id ? "selected" : ""}`} onClick={() => setLevel(item.id)}>
                <span className={`compress-gauge g-${item.id}`} />
                <span className="compress-text"><strong>{item.title}</strong><small>{item.detail}</small></span>
                <span className="compress-size" onClick={(e) => { e.stopPropagation(); if (!result) void measure(item.id); }}>
                  {result === "busy" ? <LoaderCircle size={14} className="spin" /> : result ? <><b>{megabytes(result.size)}</b><em>{result.size >= result.original ? translateUi("já otimizado") : result.size > result.original * 0.99 ? translateUi("menos de 1% menor") : `${Math.round((1 - result.size / result.original) * 100)}% menor`}</em></> : <u>{translateUi("Calcular tamanho")}</u>}
                </span>
                {level === item.id && <Check size={15} className="compress-check" />}
              </button>
            );
          })}
        </div>
        <div className="compress-extras">
          <div className="section-label">{translateUi("Remover também")}</div>
          {toggle("metadata", "Informações e metadados do documento")}
          {toggle("bookmarks", "Marcadores (índice lateral)")}
          {toggle("attachments", "Anexos de arquivos")}
          {toggle("comments", "Comentários e campos de formulário")}
          <p className="compress-note">{translateUi("Sempre aplicado: fontes e imagens duplicadas unificadas, objetos sem uso removidos, miniaturas internas descartadas e estruturas compactadas.")}</p>
        </div>
      </div>
      <div className="modal-footer">
        <span className="compress-busy">{busy && <><LoaderCircle size={14} className="spin" /> {busy}</>}</span>
        <button className="button secondary" disabled={!!busy} onClick={() => void run("save")}><Save size={15} />{" "}{translateUi("Salvar cópia comprimida…")}</button>
        <button className="button primary" disabled={!!busy} onClick={() => void run("apply")}><Minimize2 size={15} />{" "}{translateUi("Comprimir este documento")}</button>
      </div>
    </Modal>
  );
}
