import React, { useEffect, useRef } from "react";
import type { FieldFormat, FieldValue, PageRef } from "../shared/types";
import { loadBase, loadPage, pdfjs } from "./pdf";

/** Form links never navigate or run scripts in GCP-PDF; widgets only need these hooks. */
const linkService = {
  eventBus: null, externalLinkEnabled: false, pagesCount: 0, page: 1, rotation: 0, isInPresentationMode: false,
  getDestinationHash: () => "#", getAnchorUrl: () => "#", addLinkAttributes() {}, goToDestination() {}, goToPage() {},
  executeNamedAction() {}, executeSetOCGState() {}, isPageVisible: () => true, isPageCached: () => true,
};
const formats = new Map<string, Promise<Record<string, FieldFormat>>>();
function formatsOf(base: string) { let task = formats.get(base); if (!task) { task = window.gcp.getFieldFormats(base).catch(() => ({})); formats.set(base, task); } return task; }
/** Applies an Acrobat-style mask while typing: 9 digit, A letter, X letter or digit; dates and numbers in PT-BR. */
export function applyFormat(value: string, format: FieldFormat): string {
  if (format.kind === "mask" || format.kind === "date") {
    const pattern = format.kind === "date" ? format.mask.replace(/[dmyHhMs]/g, "9") : format.mask;
    const chars = [...value].filter((c) => /[0-9A-Za-z]/.test(c));
    let out = "", k = 0;
    for (const p of pattern) {
      if (k >= chars.length) break;
      const c = chars[k]!;
      if (p === "9") { if (/\d/.test(c)) { out += c; k++; } else { k++; continue; } }
      else if (p === "A") { if (/[A-Za-z]/.test(c)) { out += c; k++; } else { k++; continue; } }
      else if (p === "X" || p === "O") { out += c; k++; }
      else out += p;
    }
    return out;
  }
  const numeric = format as Extract<FieldFormat, { decimals: number }>;
  const digits = value.replace(/\D/g, "").replace(/^0+(?=\d)/, "");
  if (!digits) return "";
  const decimals = numeric.decimals, n = Number(digits) / 10 ** decimals;
  const text = n.toLocaleString("pt-BR", { minimumFractionDigits: decimals, maximumFractionDigits: decimals, useGrouping: numeric.kind === "percent" || (numeric.separator !== 1 && numeric.separator !== 3) });
  return numeric.kind === "percent" ? text + "%" : (numeric.currency ? numeric.currency.trim() + " " : "") + text;
}
interface Widget { id: string; fieldName: string; checkBox?: boolean; radioButton?: boolean; buttonValue?: string; exportValue?: string; multiSelect?: boolean }

/** Interactive AcroForm fields (including XFA forms converted on open). Typed values are sent to the
 * document model and written into the PDF form when it is saved or exported. */
export interface ButtonAction { field: string; image: boolean; url?: string; page?: number; reset?: boolean; print?: boolean }
export function FormLayer({ pageRef, rotation, scale, values, interactive, onChange, onFieldMenu, onButton, onError }: { pageRef: PageRef; rotation: number; scale: number; values: Record<string, FieldValue>; interactive: boolean; onChange: (values: Record<string, FieldValue>) => void; onFieldMenu?: (name: string, type: string) => void; onButton?: (action: ButtonAction) => void; onError:(error:unknown)=>void }) {
  const div = useRef<HTMLDivElement>(null), widgets = useRef(new Map<string, Widget>()), latest = useRef(values), pending = useRef<Record<string, FieldValue>>({}), timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  latest.current = values;
  const [buttonView,setButtonView]=React.useState<{buttons:any[];transform:number[]}|null>(null);
  const masks = useRef<Record<string, FieldFormat>>({}), images = useRef<Set<string>>(new Set()), pushes = useRef(new Map<string, any>());
  useEffect(() => { let alive = true; void window.gcp.getImageFields(pageRef.base).then((list) => { if (alive) images.current = new Set(list); }).catch(() => {}); return () => { alive = false; }; }, [pageRef.base]);
  useEffect(() => { let alive = true; void formatsOf(pageRef.base).then((f) => { if (alive) masks.current = f; }); return () => { alive = false; }; }, [pageRef.base]);
  useEffect(() => {
    let dead = false;
    setButtonView(null);
    void (async () => {
      const page = await loadPage(pageRef);
      const annotations = (await page.getAnnotations({ intent: "display" })).filter((a: any) => a.annotationType === pdfjs.AnnotationType.WIDGET && a.fieldName);
      if (dead || !div.current) return;
      div.current.replaceChildren();
      if (!annotations.length) return;
      const doc = await loadBase(pageRef.base), storage = doc.annotationStorage;
      if(dead||!div.current)return;
      widgets.current = new Map(annotations.map((a: any) => [a.id, a as Widget]));
      pushes.current = new Map((annotations as any[]).filter((a) => a.pushButton).map((a) => [a.id, a]));
      for (const a of annotations as any[]) {
        const value = latest.current[a.fieldName];
        if (value === undefined) continue;
        storage.setValue(a.id, { value: a.checkBox ? value === true : a.radioButton ? value === a.buttonValue : value });
      }
      const pageViewport=page.getViewport({scale,rotation}),viewport=pageViewport.clone({dontFlip:true});
      div.current.style.setProperty("--scale-factor", String(scale));
      div.current.style.setProperty("--total-scale-factor", String(scale));
      const layer = new pdfjs.AnnotationLayer({ div: div.current, page, viewport, accessibilityManager: null, annotationCanvasMap: null, annotationEditorUIManager: null, structTreeLayer: null, commentManager: null, linkService, annotationStorage: storage } as any);
      await layer.render({ viewport, div: div.current, annotations, page, linkService: linkService as any, annotationStorage: storage, renderForms: true, enableScripting: false, imageResourcesPath: "" } as any);
      if(!dead)setButtonView({buttons:(annotations as any[]).filter(a=>a.pushButton),transform:pageViewport.transform});
    })().catch(error=>{if(!dead)onError(error);});
    return () => { dead = true; };
  }, [pageRef.base, pageRef.src, rotation, scale]);
  function read(event: React.SyntheticEvent) {
    const element = event.target as HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement;
    const id = element.closest<HTMLElement>("[data-element-id]")?.dataset.elementId ?? element.getAttribute("data-element-id") ?? "";
    const widget = widgets.current.get(id);
    if (!widget) return;
    // Masks (CPF, CNPJ, CEP, telefone, data, moeda…) are applied as the user types.
    const format = masks.current[widget.fieldName];
    if (format && event.type === "input" && element instanceof HTMLInputElement && element.type === "text") {
      const masked = applyFormat(element.value, format);
      if (masked !== element.value) { element.value = masked; element.setSelectionRange(masked.length, masked.length); }
    }
    let value: FieldValue;
    if (widget.checkBox) value = (element as HTMLInputElement).checked;
    else if (widget.radioButton) { if (!(element as HTMLInputElement).checked) return; value = widget.buttonValue ?? ""; }
    else if (element instanceof HTMLSelectElement && element.multiple) value = [...element.selectedOptions].map((o) => o.value);
    else value = element.value;
    pending.current[widget.fieldName] = value;
    if (timer.current) clearTimeout(timer.current);
    // Typing is gathered and sent once the user pauses, as a single undo step.
    timer.current = setTimeout(() => { const batch = pending.current; pending.current = {}; onChange(batch); }, event.type === "input" ? 500 : 0);
  }
  return <>
  <div ref={div} className={`annotationLayer form-layer ${interactive ? "" : "passive"}`} onInput={read} onChange={read} onPointerDown={(e) => interactive && e.stopPropagation()} onContextMenu={(e) => {
    // Right-click on a field opens its properties, as in Acrobat.
    const id = (e.target as HTMLElement).closest<HTMLElement>("[data-annotation-id]")?.dataset.annotationId ?? (e.target as HTMLElement).closest<HTMLElement>("[data-element-id]")?.dataset.elementId ?? "";
    const widget = widgets.current.get(id);
    if (!widget || !onFieldMenu) return;
    e.preventDefault(); e.stopPropagation();
    const any = widget as Widget & { fieldType?: string; combo?: boolean; pushButton?: boolean };
    onFieldMenu(widget.fieldName, widget.checkBox ? "checkbox" : widget.radioButton ? "radio" : any.fieldType === "Ch" ? "combo" : any.fieldType === "Btn" ? "button" : any.fieldType === "Sig" ? "signature" : "text");
  }} />;
  <ButtonLayer buttons={buttonView?.buttons??[]} transform={buttonView?.transform??null} interactive={interactive} isImage={(name) => images.current.has(name)} onButton={onButton} />
  </>;
}

/** Push buttons and image fields as real, clickable buttons (pdf.js only draws them), with a pressed effect. */
function ButtonLayer({ buttons, transform, interactive, isImage, onButton }: { buttons: any[]; transform:number[]|null; interactive: boolean; isImage: (name: string) => boolean; onButton?: (action: ButtonAction) => void }) {
  if (!transform || !onButton || !buttons.length) return null;
  const [a, b, c, d, e, f] = transform as [number, number, number, number, number, number];
  const at = (x: number, y: number) => ({ x: a * x + c * y + e, y: b * x + d * y + f });
  return (
    <div className={`button-layer ${interactive ? "" : "passive"}`}>
      {buttons.map((w) => {
        const p = at(w.rect[0], w.rect[1]), q = at(w.rect[2], w.rect[3]), image = isImage(w.fieldName);
        const action: ButtonAction = { field: w.fieldName, image, url: w.url, page: typeof w.dest === "number" ? w.dest + 1 : undefined, reset: !!w.resetForm, print: w.action === "Print" };
        const title = image ? "Clique para escolher uma imagem" : action.url ? `Abre ${action.url}` : action.reset ? "Limpa o formulário" : action.print ? "Imprime o documento" : w.alternativeText || "Botão";
        return <button key={w.id} type="button" className={`form-button ${image ? "image" : ""}`} title={title} style={{ left: Math.min(p.x, q.x), top: Math.min(p.y, q.y), width: Math.abs(q.x - p.x), height: Math.abs(q.y - p.y) }} onClick={(e) => { e.stopPropagation(); onButton(action); }} onPointerDown={(e) => e.stopPropagation()} />;
      })}
    </div>
  );
}
