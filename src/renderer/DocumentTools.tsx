import {t as translateUi} from "./i18n";
import React, { useState } from "react";
import { Crop, Droplets, EyeOff, FileCheck2, Layers, LoaderCircle, PanelTop } from "lucide-react";
import type { DocumentInfo, DocumentTool } from "../shared/types";
import { Modal } from "./Dialogs";

export type DocumentToolKind = "watermark" | "header-footer" | "crop" | "flatten" | "redact" | "pdfa";
interface Props { doc: DocumentInfo; kind: DocumentToolKind; /** 0-based pages selected in the page list. */ selection: number[]; onClose: () => void; onDone: (message: string) => void; onError: (error: unknown) => void }
const TITLES: Record<DocumentToolKind, string> = { watermark: "Marca-d’água", "header-footer": "Cabeçalho e rodapé", crop: "Cortar páginas", flatten: "Achatar formulário e comentários", redact: "Tarja de redação", pdfa: "PDF/A para arquivamento" };
const number = (value: string, fallback: number) => { const n = Number(value.replace(",", ".")); return Number.isFinite(n) ? n : fallback; };

/** Whole-document tools the editing engine applies in one step that Desfazer takes back: watermark, header
 * and footer, page cropping, flattening and redaction, plus the PDF/A copy and its check. */
export function DocumentToolDialog({ doc, kind, selection, onClose, onDone, onError }: Props) {
  const [busy, setBusy] = useState(false), [scope, setScope] = useState<"all" | "selected">("all");
  const pages = scope === "selected" && selection.length ? { pages: selection } : {};
  // Watermark
  const [text, setText] = useState("CONFIDENCIAL"), [opacity, setOpacity] = useState(30), [rotation, setRotation] = useState(45), [color, setColor] = useState("#b3261e"), [behind, setBehind] = useState(false);
  // Header and footer
  const [boxes, setBoxes] = useState<string[]>(["", "", "", "", "Página <<1>> de <<n>>", ""]), [font, setFont] = useState<"Helvetica" | "Times" | "Courier">("Helvetica"), [fontSize, setFontSize] = useState(9), [start, setStart] = useState(1), [shrink, setShrink] = useState(false), [inkColor, setInkColor] = useState("#333333");
  // Crop (points)
  const [margins, setMargins] = useState<[number, number, number, number]>([0, 0, 0, 0]);
  // Flatten
  const [comments, setComments] = useState(true), [fields, setFields] = useState(true);
  // Redaction
  const [find, setFind] = useState(""), [patterns, setPatterns] = useState<Set<"phone" | "email" | "credit-card" | "date">>(new Set()), [wholeWords, setWholeWords] = useState(false), [caseSensitive, setCaseSensitive] = useState(false);
  // PDF/A
  const [level, setLevel] = useState<"2b" | "3b">("2b"), [issues, setIssues] = useState<string[] | null>(null), [saved, setSaved] = useState(false);

  const tool = (): DocumentTool | null => {
    switch (kind) {
      case "watermark": return { kind, text, opacity: opacity / 100, rotation, color, behind, ...pages };
      case "header-footer": return { kind, header: [boxes[0]!, boxes[1]!, boxes[2]!], footer: [boxes[3]!, boxes[4]!, boxes[5]!], font, fontSize, color: inkColor, startNumber: start, shrink, ...pages };
      case "crop": return { kind, margins, ...pages };
      case "flatten": return { kind, comments, fields };
      case "redact": return { kind, ...(find.trim() ? { find } : {}), ...(patterns.size ? { patterns: [...patterns] } : {}), wholeWords, caseSensitive, ...pages };
      default: return null;
    }
  };
  const valid = kind === "watermark" ? !!text.trim() : kind === "header-footer" ? boxes.some((b) => b.trim()) : kind === "crop" ? margins.some((m) => m > 0) : kind === "flatten" ? comments || fields : kind === "redact" ? !!find.trim() || patterns.size > 0 : true;
  async function apply() {
    const request = tool(); if (!request) return;
    setBusy(true);
    try {
      const marks = await window.gcp.applyDocumentTool(doc.id, request);
      onDone(kind === "redact" ? (marks ? `${marks} trecho${marks > 1 ? "s ocultados" : " ocultado"} de forma definitiva. Salve para gravar o documento.` : "Conteúdo ocultado de forma definitiva. Salve para gravar o documento.") : `${TITLES[kind]}: aplicado. Use Desfazer para voltar atrás.`);
      onClose();
    } catch (error) { onError(error); } finally { setBusy(false); }
  }
  async function pdfa(save: boolean) {
    setBusy(true);
    try {
      if (save) { const result = await window.gcp.savePdfA(doc.id, level); if (!result?.path) return; setSaved(true); setIssues(result.issues); if (!result.issues.length) { onDone("Cópia em PDF/A salva."); onClose(); } }
      else { setSaved(false); setIssues(await window.gcp.verifyPdfA(doc.id, level)); }
    } catch (error) { onError(error); } finally { setBusy(false); }
  }
  const scopeRow = selection.length > 0 && kind !== "flatten" && kind !== "pdfa" && (
    <div className="segmented">
      <button className={scope === "all" ? "selected" : ""} onClick={() => setScope("all")}>{translateUi("Todas as páginas")}</button>
      <button className={scope === "selected" ? "selected" : ""} onClick={() => setScope("selected")}>{translateUi("Páginas selecionadas")} ({selection.length})</button>
    </div>
  );
  const icon = kind === "watermark" ? <Droplets size={15} /> : kind === "header-footer" ? <PanelTop size={15} /> : kind === "crop" ? <Crop size={15} /> : kind === "flatten" ? <Layers size={15} /> : kind === "redact" ? <EyeOff size={15} /> : <FileCheck2 size={15} />;
  return (
    <Modal title={translateUi(TITLES[kind])} description={doc.name} onClose={onClose} wide={kind === "header-footer"}>
      <div className="protect document-tool">
        {kind === "watermark" && (
          <section className="protect-block">
            <label className="field">{translateUi("Texto")}<input value={text} maxLength={200} onChange={(e) => setText(e.target.value)} autoFocus /></label>
            <div className="field-row">
              <label className="field">{translateUi("Opacidade (%)")}<input type="number" min={5} max={100} value={opacity} onChange={(e) => setOpacity(Math.max(5, Math.min(100, number(e.target.value, 30))))} /></label>
              <label className="field">{translateUi("Inclinação (graus)")}<input type="number" min={-180} max={180} value={rotation} onChange={(e) => setRotation(Math.max(-180, Math.min(180, number(e.target.value, 45))))} /></label>
              <label className="field">{translateUi("Cor")}<input type="color" value={color} onChange={(e) => setColor(e.target.value)} /></label>
            </div>
            <label className="check-row"><input type="checkbox" checked={behind} onChange={(e) => setBehind(e.target.checked)} />{" "}{translateUi("Colocar atrás do conteúdo da página")}</label>
          </section>
        )}
        {kind === "header-footer" && (
          <section className="protect-block">
            {(["Cabeçalho", "Rodapé"] as const).map((label, row) => (
              <div key={label}>
                <div className="section-label">{translateUi(label)}</div>
                <div className="field-row">
                  {(["Esquerda", "Centro", "Direita"] as const).map((place, column) => (
                    <label key={place} className="field">{translateUi(place)}<input value={boxes[row * 3 + column]} maxLength={300} onChange={(e) => setBoxes(boxes.map((b, i) => (i === row * 3 + column ? e.target.value : b)))} /></label>
                  ))}
                </div>
              </div>
            ))}
            <p className="compress-note">{translateUi("Use <<1>> para o número da página e <<n>> para o total de páginas.")}</p>
            <div className="field-row">
              <label className="field">{translateUi("Fonte")}<select value={font} onChange={(e) => setFont(e.target.value as typeof font)}><option value="Helvetica">Helvetica</option><option value="Times">Times</option><option value="Courier">Courier</option></select></label>
              <label className="field">{translateUi("Tamanho")}<input type="number" min={4} max={72} value={fontSize} onChange={(e) => setFontSize(Math.max(4, Math.min(72, number(e.target.value, 9))))} /></label>
              <label className="field">{translateUi("Primeiro número")}<input type="number" min={0} max={999999} value={start} onChange={(e) => setStart(Math.max(0, Math.min(999999, Math.round(number(e.target.value, 1)))))} /></label>
              <label className="field">{translateUi("Cor")}<input type="color" value={inkColor} onChange={(e) => setInkColor(e.target.value)} /></label>
            </div>
            <label className="check-row"><input type="checkbox" checked={shrink} onChange={(e) => setShrink(e.target.checked)} />{" "}{translateUi("Reduzir o conteúdo da página para não ser coberto")}</label>
          </section>
        )}
        {kind === "crop" && (
          <section className="protect-block">
            <div className="field-row">
              {(["Esquerda", "Inferior", "Direita", "Superior"] as const).map((label, i) => (
                <label key={label} className="field">{translateUi(label)} (mm)<input type="number" min={0} max={500} step={1} value={Math.round(margins[i]! / 72 * 25.4 * 10) / 10} onChange={(e) => setMargins(margins.map((m, k) => (k === i ? Math.max(0, number(e.target.value, 0)) / 25.4 * 72 : m)) as typeof margins)} /></label>
              ))}
            </div>
            <p className="compress-note">{translateUi("O corte esconde as margens sem apagar o conteúdo: ele pode ser desfeito.")}</p>
          </section>
        )}
        {kind === "flatten" && (
          <section className="protect-block">
            <label className="check-row"><input type="checkbox" checked={fields} onChange={(e) => setFields(e.target.checked)} />{" "}{translateUi("Campos de formulário (os valores passam a fazer parte da página)")}</label>
            <label className="check-row"><input type="checkbox" checked={comments} onChange={(e) => setComments(e.target.checked)} />{" "}{translateUi("Comentários e marcações")}</label>
            <p className="compress-note">{translateUi("Depois de achatados, campos e comentários aparecem em qualquer leitor e não podem mais ser editados.")}</p>
          </section>
        )}
        {kind === "redact" && (
          <section className="protect-block">
            <label className="field">{translateUi("Ocultar todas as ocorrências do texto")}<input value={find} maxLength={500} onChange={(e) => setFind(e.target.value)} autoFocus /></label>
            <label className="check-row"><input type="checkbox" checked={wholeWords} onChange={(e) => setWholeWords(e.target.checked)} />{" "}{translateUi("Somente palavras inteiras")}</label>
            <label className="check-row"><input type="checkbox" checked={caseSensitive} onChange={(e) => setCaseSensitive(e.target.checked)} />{" "}{translateUi("Diferenciar maiúsculas de minúsculas")}</label>
            <div className="section-label">{translateUi("Ocultar também")}</div>
            {([["email", "Endereços de e-mail"], ["phone", "Números de telefone"], ["credit-card", "Números de cartão"], ["date", "Datas"]] as const).map(([id, label]) => (
              <label key={id} className="check-row"><input type="checkbox" checked={patterns.has(id)} onChange={(e) => { const next = new Set(patterns); if (e.target.checked) next.add(id); else next.delete(id); setPatterns(next); }} />{" "}{translateUi(label)}</label>
            ))}
            <p className="quick-error">{translateUi("A tarja remove de forma definitiva o texto, as imagens e os dados sob ela. Depois de salvar, não há como recuperar.")}</p>
            <p className="compress-note">{translateUi("Para ocultar um trecho específico, selecione o texto na página e use o botão direito.")}</p>
          </section>
        )}
        {kind === "pdfa" && (
          <section className="protect-block">
            <div className="segmented">
              {([["2b", "PDF/A-2b"], ["3b", "PDF/A-3b (permite anexos)"]] as const).map(([value, label]) => <button key={value} className={level === value ? "selected" : ""} onClick={() => { setLevel(value); setIssues(null); }}>{translateUi(label)}</button>)}
            </div>
            <p className="compress-note">{translateUi("O PDF/A é o formato de arquivamento de longo prazo. É salva uma cópia; o documento aberto não é alterado.")}</p>
            {issues && saved && issues.length > 0 && <p className="quick-error">{translateUi("A cópia foi salva, mas ainda não está em conformidade com o PDF/A pelos pontos abaixo.")}</p>}
            {issues && (issues.length ? <div className="document-tool-report"><strong>{translateUi("Pontos que impedem a conformidade:")}</strong><ul>{issues.map((line, i) => <li key={i}>{line}</li>)}</ul></div> : <p className="compress-note">{translateUi("Nenhum problema de conformidade foi encontrado.")}</p>)}
          </section>
        )}
        {scopeRow}
      </div>
      <div className="modal-footer">
        <button className="button secondary" onClick={onClose}>{translateUi("Cancelar")}</button>
        {kind === "pdfa" ? <>
          <button className="button secondary" disabled={busy} onClick={() => void pdfa(false)}>{translateUi("Verificar")}</button>
          <button className="button primary" disabled={busy} onClick={() => void pdfa(true)}>{busy ? <LoaderCircle size={15} className="spin" /> : icon}{" "}{translateUi("Salvar cópia em PDF/A…")}</button>
        </> : <button className="button primary" disabled={!valid || busy} onClick={() => void apply()}>{busy ? <LoaderCircle size={15} className="spin" /> : icon}{" "}{translateUi(kind === "redact" ? "Ocultar definitivamente" : "Aplicar")}</button>}
      </div>
    </Modal>
  );
}
