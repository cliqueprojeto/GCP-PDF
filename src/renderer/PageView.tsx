import {t as translateUi} from "./i18n";
import React, { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Move, LoaderCircle } from "lucide-react";
import type { FieldValue, PageObject, PageRef, Point, Rect, SourceObjects, SourceParagraph } from "../shared/types";
import { FormLayer } from "./FormLayer";
import { NativeAnnotations } from "./NativeAnnotations";
import { NoteBubble, commentAuthor, type PdfNote } from "./Comments";
import { SignaturePreview } from "./Security";
import { fromPage, inkPath, measureLabel, objectBounds, pageTransform, resizeObject, shapePath, toPage, translateObject } from "../shared/geometry";
import { loadAsset, loadPage, pdfjs, displaySize, type PageGeometry } from "./pdf";
import { uid, type Style, type Tool } from "./editor";

export interface SourceSelection { page: string; paragraph: SourceParagraph; color: string; caret?: { x: number; y: number } }
/** PDF.js text of the rendered page, kept so the paragraph editor can show the page's own embedded fonts. */
interface PageText { items: { str: string; fontName: string; transform: number[]; width: number; hasEOL: boolean }[]; view: number[] }
interface EditorRun { text: string; font: string; size: number }
interface EditorLine { runs: EditorRun[]; baseline: number; x: number; right: number }
interface Props {
  annotations:import("../shared/types").PdfAnnotation[];
  onDeleteAnnotation:(a:import("../shared/types").PdfAnnotation)=>void;
  docId: string;
  pageRef: PageRef;
  index: number;
  geometry: PageGeometry;
  rotation: number;
  scale: number;
  objects: PageObject[];
  selected: Set<string>;
  tool: Tool;
  style: Style;
  search: string;
  editingText: string | null;
  sourceSelection: SourceSelection | null;
  onSourceSelect: (selection: SourceSelection | null) => void;
  onEditText: (id: string | null) => void;
  onSelect: (ids: string[], additive: boolean) => void;
  onAdd: (object: PageObject, dataUrl?: string) => void;
  onUpdate: (objects: PageObject[]) => void;
  onDelete: (ids: string[]) => void;
  fields: Record<string, FieldValue>;
  onFields: (values: Record<string, FieldValue>) => void;
  onToolDone: (created?: string) => void;
  searchFocus: number;
  onArea: (page: string, rect: Rect) => void;
  onFieldMenu?: (page: string, name: string, type: string) => void;
  onFormButton?: (page: string, action: import("./FormLayer").ButtonAction) => void;
  onEditImage?: (id: string) => void;
  openNote?: string | null;
  onOpenNote?: (id: string | null) => void;
  onSourceImageEdit?: (page: string, image: number, rect: Rect) => void;
  onError: (error: unknown) => void;
}
type Drag =
  | { kind: "move"; start: Point; ids: string[]; dx: number; dy: number }
  | { kind: "resize"; start: Point; id: string; handle: string; from: Rect; to: Rect }
  | { kind: "create"; start: Point; current: Point; points: Point[] }
  | { kind: "area"; start: Point; current: Point }
  | { kind: "source"; start: Point; dx: number; dy: number; target: { kind: "text" | "image"; index: number; rect: Rect }; ghost?: string }
  | { kind: "source-resize"; start: Point; index: number; handle: string; from: Rect; to: Rect };
const FONTS: Record<string, string> = { sans: "Helvetica, Arial, sans-serif", serif: '"Times New Roman", Times, serif', mono: '"Courier New", Courier, monospace' };
const HANDLES = ["nw", "n", "ne", "e", "se", "s", "sw", "w"];
const sourceCache = new Map<string, Promise<SourceObjects>>();
function useAsset(id: string | undefined) {
  const [url, setUrl] = useState<string>();
  useEffect(() => { if (id) void loadAsset(id).then(setUrl).catch(() => {}); }, [id]);
  return url;
}
function normalize(a: Point, b: Point): Rect { return { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), width: Math.abs(b.x - a.x), height: Math.abs(b.y - a.y) }; }
function resized(from: Rect, handle: string, dx: number, dy: number): Rect {
  let { x, y, width, height } = from;
  if (handle.includes("w")) { x += dx; width -= dx; }
  if (handle.includes("e")) width += dx;
  if (handle.includes("n")) { y += dy; height -= dy; }
  if (handle.includes("s")) height += dy;
  if (width < 0) { x += width; width = -width; }
  if (height < 0) { y += height; height = -height; }
  return { x, y, width: Math.max(width, 2), height: Math.max(height, 2) };
}
/** Joins selection rectangles that sit on the same text line. */
function mergeLines(rects: Rect[]): Rect[] {
  const sorted = [...rects].sort((a, b) => a.y - b.y || a.x - b.x), out: Rect[] = [];
  for (const r of sorted) {
    const last = out.at(-1);
    if (last && Math.abs(last.y - r.y) < Math.max(2, r.height * 0.4) && r.x <= last.x + last.width + 3) {
      const right = Math.max(last.x + last.width, r.x + r.width), bottom = Math.max(last.y + last.height, r.y + r.height);
      last.y = Math.min(last.y, r.y); last.width = right - last.x; last.height = bottom - last.y;
    } else out.push({ ...r });
  }
  return out;
}
function luminance(rgb: number[]) { return 0.2126 * rgb[0]! + 0.7152 * rgb[1]! + 0.0722 * rgb[2]!; }
const hex = (rgb: number[]) => "#" + rgb.slice(0, 3).map((v) => v.toString(16).padStart(2, "0")).join("");

function ObjectView({ o, editing, onCommitText }: { o: PageObject; editing: boolean; onCommitText: (text: string, height: number) => void }) {
  const asset = useAsset(o.kind === "image" ? o.asset : undefined);
  const editor = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    if (editing && editor.current) {
      editor.current.focus();
      const range = document.createRange();
      range.selectNodeContents(editor.current);
      range.collapse(false);
      const selection = window.getSelection();
      selection?.removeAllRanges();
      selection?.addRange(range);
    }
  }, [editing]);
  if (o.kind === "text") {
    const style: React.CSSProperties = { left: o.x, top: o.y, width: o.width, minHeight: o.height, fontSize: o.size, color: o.color, fontFamily: FONTS[o.font] ?? `"${o.font}", Helvetica, Arial, sans-serif`, fontWeight: o.bold ? 700 : 400, fontStyle: o.italic ? "italic" : "normal", textAlign: o.align, transform: o.rotation ? `rotate(${o.rotation}deg)` : undefined };
    return (
      <div
        ref={editor}
        className={`overlay-text ${editing ? "editing" : ""}`}
        style={style}
        data-object-id={editing ? undefined : o.id}
        contentEditable={editing}
        suppressContentEditableWarning
        spellCheck={false}
        onPointerDown={editing ? (e) => e.stopPropagation() : undefined}
        onKeyDown={(e) => { if (e.key === "Escape" || (e.key === "Enter" && e.ctrlKey)) (e.target as HTMLElement).blur(); e.stopPropagation(); }}
        onBlur={(e) => onCommitText(e.currentTarget.innerText.replace(/\n$/, ""), e.currentTarget.offsetHeight)}
      >
        {o.text}
      </div>
    );
  }
  if (o.kind === "note") return <div className="overlay-note" data-object-id={o.id} title={`${o.author || "Comentário"}: ${o.text}`} style={{ left: o.x, top: o.y, width: o.width, height: o.height, background: o.color }}><svg viewBox="0 0 24 24" width="70%" height="70%" fill="none" stroke="#3b2a00" strokeWidth="1.8" strokeLinejoin="round"><path d="M4 4h16v12H10l-4 4v-4H4z" fill="#fff8" /><path d="M8 8.5h8M8 12h5" /></svg>{(o.replies?.length ?? 0) > 0 && <span className="note-count">{o.replies!.length + 1}</span>}</div>;
  if (o.kind === "image")
    return asset ? <img className="overlay-image" src={asset} alt="" draggable={false} style={{ left: o.x, top: o.y, width: o.width, height: o.height, transform: o.rotation ? `rotate(${o.rotation}deg)` : undefined }} /> : null;
  return null;
}
function VectorView({ o }: { o: PageObject }) {
  if (o.kind === "shape") {
    const path = shapePath(o);
    return (
      <g opacity={o.opacity} fill="none" stroke={o.stroke} strokeWidth={o.strokeWidth} strokeLinecap="round" strokeLinejoin="round">
        <path d={path.outline} fill={path.closed && o.fill ? o.fill : "none"} />
        {path.head && <path d={path.head} />}
        {(() => { const label = measureLabel(o); if (!label) return null; const size = Math.max(7, o.strokeWidth * 4 + 5); return <text x={label.at.x} y={label.at.y - size * 0.45} transform={label.angle ? `rotate(${label.angle} ${label.at.x} ${label.at.y})` : undefined} textAnchor={o.measure === "perimeter" ? "start" : "middle"} fontSize={size} fontFamily="Helvetica, Arial, sans-serif" fill={o.stroke} stroke="#ffffff" strokeWidth={size * 0.28} paintOrder="stroke" style={{ fontWeight: 600 }}>{label.text}</text>; })()}
      </g>
    );
  }
  if (o.kind === "ink") return <path d={inkPath(o.points)} fill="none" stroke={o.stroke} strokeWidth={o.strokeWidth} opacity={o.opacity} strokeLinecap="round" strokeLinejoin="round" />;
  if (o.kind === "markup")
    return (
      <g>
        {o.rects.map((r, i) =>
          o.style === "highlight" ? (
            <rect key={i} x={r.x} y={r.y} width={r.width} height={r.height} fill={o.color} opacity={o.opacity} style={{ mixBlendMode: "multiply" }} />
          ) : (
            <line key={i} x1={r.x} x2={r.x + r.width} y1={r.y + r.height * (o.style === "underline" ? 0.94 : 0.55)} y2={r.y + r.height * (o.style === "underline" ? 0.94 : 0.55)} stroke={o.color} strokeWidth={Math.max(0.8, r.height * 0.07)} opacity={Math.max(o.opacity, 0.8)} />
          ),
        )}
      </g>
    );
  return null;
}

export function PageView(props: Props) {
  const { pageRef, geometry, rotation, scale, tool, style } = props;
  const outer = useRef<HTMLDivElement>(null), canvas = useRef<HTMLCanvasElement>(null), textLayer = useRef<HTMLDivElement>(null), pageText = useRef<PageText | null>(null);
  const [near, setNear] = useState(false), [rendered, setRendered] = useState(false), [drag, setDrag] = useState<Drag | null>(null);
  const [ghost, setGhost] = useState<Point | null>(null), [pickedImage, setPickedImage] = useState<number | null>(null), [imageMenu, setImageMenu] = useState<{ x: number; y: number; index: number; rect: Rect } | null>(null);
  const [source, setSource] = useState<SourceObjects | null>(null), [engineBusy, setEngineBusy] = useState(false);
  // A dropped picture stays where it was dropped until the engine returns the page's new objects.
  const [dropped, setDropped] = useState<{ generation: number; index: number; dx: number; dy: number; ghost?: string } | null>(null);
  useEffect(() => setDropped(null), [source]);
  const display = displaySize(geometry, rotation, scale);
  const size = { width: geometry.width, height: geometry.height };
  useEffect(() => {
    const node = outer.current;
    if (!node) return;
    const observer = new IntersectionObserver((entries) => setNear(entries.some((e) => e.isIntersecting)), { rootMargin: "1400px 0px" });
    observer.observe(node);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    if (!near || !canvas.current) return;
    let dead = false, task: ReturnType<pdfjs.PDFPageProxy["render"]> | undefined, layer: pdfjs.TextLayer | undefined;
    void (async () => {
      const page = await loadPage(pageRef);
      if (dead || !canvas.current) return;
      const viewport = page.getViewport({ scale, rotation });
      const dpr = Math.min(window.devicePixelRatio || 1, 3), c = canvas.current;
      const next = document.createElement("canvas");
      next.width = Math.ceil(viewport.width * dpr);
      next.height = Math.ceil(viewport.height * dpr);
      task = page.render({ canvas: next, canvasContext: next.getContext("2d", { alpha: false })!, viewport, annotationMode: pdfjs.AnnotationMode.ENABLE_FORMS, transform: dpr === 1 ? undefined : [dpr, 0, 0, dpr, 0, 0] });
      await task.promise;
      if (dead) return;
      // Swap only when the new raster is complete, so zooming and edits never flash a blank page.
      c.width = next.width; c.height = next.height;
      c.getContext("2d", { alpha: false })!.drawImage(next, 0, 0);
      setRendered(true);
      if (textLayer.current) {
        textLayer.current.replaceChildren();
        textLayer.current.style.setProperty("--scale-factor", String(scale));
        textLayer.current.style.setProperty("--total-scale-factor", String(scale));
        textLayer.current.style.setProperty("--user-unit", String(page.userUnit));
        const content = await page.getTextContent();
        pageText.current = { items: content.items.filter((i) => "str" in i) as PageText["items"], view: page.view };
        layer = new pdfjs.TextLayer({ textContentSource: content, container: textLayer.current, viewport });
        await layer.render();
        const q = props.search.trim().toLocaleLowerCase("pt-BR");
        if (q) {
          let n = 0;
          textLayer.current.querySelectorAll("span").forEach((span) => {
            const text = span.textContent?.toLocaleLowerCase("pt-BR") ?? "";
            for (let at = text.indexOf(q); at >= 0; at = text.indexOf(q, at + q.length)) {
              span.classList.add("search-match");
              if (n++ === props.searchFocus) { span.classList.add("search-current"); span.scrollIntoView({ block: "center", inline: "nearest" }); }
            }
          });
        }
        // PDF.js' end-of-content guard keeps fast drags from selecting the whole page.
        const end = document.createElement("div");
        end.className = "endOfContent";
        textLayer.current.append(end);
      }
    })().catch((error) => { if (!dead && !String(error).includes("RenderingCancelled")) props.onError(error); });
    return () => { dead = true; task?.cancel(); layer?.cancel(); };
  }, [near, pageRef.base, pageRef.src, rotation, scale, props.search, props.searchFocus]);
  // Existing paragraphs and images, listed by the text engine while "Editar tudo" is on.
  useEffect(() => {
    if (tool.kind !== "edit" || !near) { setSource(null); return; }
    let alive = true;
    const key = `${props.docId}:${pageRef.base}:${pageRef.src}`;
    let task = sourceCache.get(key);
    if (!task) { task = window.gcp.getSourceObjects(props.docId, pageRef.id); sourceCache.set(key, task); task.catch(() => sourceCache.delete(key)); }
    void task.then((value) => alive && setSource(value)).catch((error) => alive && props.onError(error));
    return () => { alive = false; };
  }, [tool.kind, near, pageRef.base, pageRef.src]);

  function pagePoint(e: { clientX: number; clientY: number }): Point {
    const rect = outer.current!.getBoundingClientRect();
    return toPage(e.clientX - rect.left, e.clientY - rect.top, size, rotation, scale);
  }
  /** The rendered pixels of an area of the page, shown under the pointer while a picture is dragged. */
  function snapshot(rect: Rect): string | undefined {
    const c = canvas.current;
    if (!c || !rendered || rotation % 360) return undefined;
    const ratio = c.width / display.width, at = fromPage(rect.x, rect.y, size, rotation, scale);
    const w = Math.max(1, Math.round(rect.width * scale * ratio)), h = Math.max(1, Math.round(rect.height * scale * ratio)), out = document.createElement("canvas");
    out.width = w; out.height = h;
    out.getContext("2d")!.drawImage(c, Math.round(at.x * ratio), Math.round(at.y * ratio), w, h, 0, 0, w, h);
    return out.toDataURL();
  }
  function sample(rect: Rect): { background: string; color: string } {
    const c = canvas.current, ctx = c?.getContext("2d");
    if (!c || !ctx || !rendered) return { background: "#ffffff", color: "#1f1a2e" };
    const ratio = c.width / display.width, pixel = (p: Point) => { const d = fromPage(p.x, p.y, size, rotation, scale); return ctx.getImageData(Math.max(0, Math.min(c.width - 1, Math.round(d.x * ratio))), Math.max(0, Math.min(c.height - 1, Math.round(d.y * ratio))), 1, 1).data; };
    const bg = pixel({ x: rect.x - 3, y: rect.y + rect.height / 2 });
    let best = bg, contrast = 0;
    for (let i = 0; i < 60; i++) {
      const p = pixel({ x: rect.x + (rect.width * ((i * 7) % 60)) / 60, y: rect.y + rect.height * (((i * 13) % 17) / 17) });
      const diff = Math.abs(luminance([...p]) - luminance([...bg]));
      if (diff > contrast) { contrast = diff; best = p; }
    }
    return { background: hex([...bg]), color: contrast > 40 ? hex([...best]) : luminance([...bg]) > 128 ? "#1f1a2e" : "#ffffff" };
  }
  const own = props.objects;
  const preview: PageObject[] = own.map((o) => {
    if (!drag) return o;
    if (drag.kind === "move" && drag.ids.includes(o.id)) return translateObject(o, drag.dx, drag.dy);
    if (drag.kind === "resize" && drag.id === o.id) return resizeObject(o, drag.from, drag.to);
    return o;
  });
  const draft: PageObject | null = (() => {
    if (!drag) return null;
    if (drag.kind === "area") { const r = normalize(drag.start, drag.current); return { id: "draft", page: pageRef.id, kind: "markup", style: "highlight", rects: [r], color: style.highlight, opacity: style.highlightOpacity }; }
    if (drag.kind !== "create") return null;
    if (tool.kind === "ink") return { id: "draft", page: pageRef.id, kind: "ink", points: drag.points, stroke: style.stroke, strokeWidth: style.strokeWidth, opacity: style.opacity };
    if (tool.kind === "shape") {
      const r = normalize(drag.start, drag.current), multi = tool.shape === "polyline" || tool.shape === "polygon";
      return { id: "draft", page: pageRef.id, kind: "shape", shape: tool.shape, ...(tool.measure ? { measure: tool.measure } : {}), ...r, points: multi ? [...drag.points, drag.current] : tool.shape === "line" || tool.shape === "arrow" ? [drag.start, drag.current] : undefined, stroke: style.stroke, fill: style.fill, strokeWidth: style.strokeWidth, opacity: style.opacity };
    }
    if (tool.kind === "stamp" || tool.kind === "text") { const r = normalize(drag.start, drag.current); return { id: "draft", page: pageRef.id, kind: "shape", shape: "rect", ...r, stroke: "#6d35d5", fill: null, strokeWidth: 1 / scale, opacity: 0.8 }; }
    if (tool.kind === "field" || tool.kind === "sign-area") { const r = normalize(drag.start, drag.current); return { id: "draft", page: pageRef.id, kind: "shape", shape: "rect", ...r, stroke: tool.kind === "field" ? "#4f8cff" : "#3ecf6e", fill: tool.kind === "field" ? "#4f8cff" : "#3ecf6e", strokeWidth: 1.5 / scale, opacity: 0.35 }; }
    return null;
  })();

  async function finishCreate(d: Extract<Drag, { kind: "create" }>) {
    const r = normalize(d.start, d.current), clicked = r.width < 4 && r.height < 4;
    if (tool.kind === "note") {
      // Acrobat-style sticky note: the icon goes where the user clicked and its bubble opens for typing.
      const id = uid();
      props.onAdd({ id, page: pageRef.id, kind: "note", x: Math.max(0, d.start.x - 11), y: Math.max(0, d.start.y - 11), width: 22, height: 22, text: "", author: commentAuthor(), createdAt: new Date().toISOString(), color: "#ffd43b", replies: [] });
      props.onToolDone(id); props.onOpenNote?.(id);
      return;
    }
    if (tool.kind === "field" || tool.kind === "sign-area") {
      // A click places a default-sized field; a drag sets its size.
      const area = clicked ? { x: d.start.x, y: d.start.y, width: tool.kind === "sign-area" ? 200 : tool.field === "checkbox" || tool.field === "radio" ? 14 : 160, height: tool.kind === "sign-area" ? 60 : tool.field === "checkbox" || tool.field === "radio" ? 14 : 22 } : r;
      props.onArea(pageRef.id, area);
      return;
    }
    if (tool.kind === "text") {
      const object: PageObject = { id: uid(), page: pageRef.id, kind: "text", x: d.start.x, y: d.start.y, width: clicked ? Math.min(260, size.width - d.start.x - 8) : r.width, height: style.size * 1.3, text: "", size: style.size, color: style.textColor, font: style.font, bold: style.bold, italic: style.italic, align: style.align, rotation: (360 - rotation) % 360 };
      if (!clicked) Object.assign(object, { x: r.x, y: r.y });
      props.onAdd(object);
      props.onEditText(object.id);
      props.onToolDone(object.id);
    } else if (tool.kind === "stamp") {
      const image = new Image();
      image.src = tool.dataUrl;
      await image.decode();
      // Stamps keep their drawn size (rendered at 3×, so 1 px = 0.25 pt); other images start at a comfortable width.
      const width = clicked ? Math.min(tool.natural ? (image.width / 3) * 0.75 : tool.signature ? 170 : 240, size.width - d.start.x) : r.width, height = clicked ? (width * image.height) / image.width : r.height;
      const id = uid();
      props.onAdd({ id, page: pageRef.id, kind: "image", x: clicked ? d.start.x : r.x, y: clicked ? d.start.y : r.y, width, height, asset: "", rotation: (360 - rotation) % 360 }, tool.dataUrl);
      props.onToolDone(id);
    } else if (tool.kind === "ink") {
      if (d.points.length > 1) { const id=uid();props.onAdd({ id, page: pageRef.id, kind: "ink", points: d.points, stroke: style.stroke, strokeWidth: style.strokeWidth, opacity: style.opacity });props.onToolDone(id); }
    } else if (tool.kind === "shape") {
      const line = tool.shape === "line" || tool.shape === "arrow", mark=tool.shape==='check'||tool.shape==='cross';
      const area=clicked?{x:d.start.x,y:d.start.y,width:Math.max(12,Math.min(mark?30:120,size.width-d.start.x)),height:line?0:Math.max(12,Math.min(mark?30:70,size.height-d.start.y))}:r;
      const end=clicked?{x:area.x+area.width,y:area.y+area.height}:d.current,id=uid();
      props.onAdd({ id, page: pageRef.id, kind: "shape", shape: tool.shape, ...(tool.measure ? { measure: tool.measure } : {}), ...area, points: line ? [d.start, end] : undefined, stroke: style.stroke, fill: style.fill, strokeWidth: style.strokeWidth, opacity: style.opacity });props.onToolDone(id);
    }
  }
  function finishPolyline(raw: Point[]) {
    if (tool.kind !== "shape") return false;
    const points=raw.filter((point,index)=>index===0||Math.hypot(point.x-raw[index-1]!.x,point.y-raw[index-1]!.y)>0.5);
    if(points.length>2&&Math.hypot(points[0]!.x-points.at(-1)!.x,points[0]!.y-points.at(-1)!.y)<0.5)points.pop();
    if(points.length<(tool.shape==='polygon'?3:2))return false;
    const xs = points.map((p) => p.x), ys = points.map((p) => p.y), r = { x: Math.min(...xs), y: Math.min(...ys), width: Math.max(...xs) - Math.min(...xs), height: Math.max(...ys) - Math.min(...ys) },id=uid();
    props.onAdd({ id, page: pageRef.id, kind: "shape", shape: tool.shape, ...(tool.measure ? { measure: tool.measure } : {}), ...r, points, stroke: style.stroke, fill: style.fill, strokeWidth: style.strokeWidth, opacity: style.opacity });props.onToolDone(id);return true;
  }
  function markupFromSelection() {
    if (tool.kind !== "markup") return false;
    const selection = window.getSelection(), layer = textLayer.current;
    if (!selection || selection.isCollapsed || !selection.rangeCount || !layer) return false;
    const range = selection.getRangeAt(0), rects: Rect[] = [], walker = document.createTreeWalker(layer, NodeFilter.SHOW_TEXT);
    // Measure only the selected characters of each text node, never whole elements.
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      if (!range.intersectsNode(node)) continue;
      const part = document.createRange();
      part.selectNodeContents(node);
      if (node === range.startContainer) part.setStart(node, range.startOffset);
      if (node === range.endContainer) part.setEnd(node, range.endOffset);
      for (const r of part.getClientRects()) if (r.width >= 1 && r.height >= 1) rects.push(normalize(pagePoint({ clientX: r.left, clientY: r.top }), pagePoint({ clientX: r.right, clientY: r.bottom })));
    }
    selection.removeAllRanges();
    if (!rects.length) return false;
    const typical = [...rects].map((r) => r.height).sort((a, b) => a - b)[Math.floor(rects.length / 2)]!;
    const lines = mergeLines(rects.filter((r) => r.height < typical * 3));
    props.onAdd({ id: uid(), page: pageRef.id, kind: "markup", style: tool.style, rects: lines, color: tool.style === "highlight" ? style.highlight : style.stroke, opacity: tool.style === "highlight" ? style.highlightOpacity : 1 });
    return true;
  }
  const creating = tool.kind === "text" || tool.kind === "shape" || tool.kind === "ink" || tool.kind === "stamp" || tool.kind === "field" || tool.kind === "sign-area" || tool.kind === "note";
  function onPointerDown(e: React.PointerEvent) {
    if (e.button !== 0) return;
    if (tool.kind === "sign-place") { e.preventDefault(); const p = pagePoint(e); props.onArea(pageRef.id, { x: Math.max(0, Math.min(size.width - tool.width, p.x - tool.width / 2)), y: Math.max(0, Math.min(size.height - tool.height, p.y - tool.height / 2)), width: tool.width, height: tool.height }); return; }
    const target = e.target as HTMLElement, point = pagePoint(e);
    if (creating) {
      e.preventDefault();
      outer.current!.setPointerCapture(e.pointerId);
      if (tool.kind === "shape" && (tool.shape === "polyline" || tool.shape === "polygon")) {
        // Quick clicks on different vertices also report detail ≥ 2: only a double click on the last vertex (or a click on the first) finishes.
        const last=drag?.kind==='create'?drag.points.at(-1):undefined;
        if(drag?.kind==='create'&&drag.points.length>=(tool.shape==='polygon'?3:2)&&((e.detail>=2&&last&&Math.hypot(point.x-last.x,point.y-last.y)<6/scale)||Math.hypot(point.x-drag.points[0]!.x,point.y-drag.points[0]!.y)<8/scale)){if(finishPolyline(drag.points))setDrag(null);return;}
        setDrag((d) => (d?.kind === "create" ? { ...d, points: [...d.points, point], current: point } : { kind: "create", start: point, current: point, points: [point] }));
        return;
      }
      setDrag({ kind: "create", start: point, current: point, points: [point] });
      return;
    }
    if (tool.kind === "edit") {
      const box = target.closest<HTMLElement>("[data-source]");
      const selected = props.sourceSelection;
      const selectedBox = box?.dataset.source?.split(":");
      const stayingInText = selected?.page === pageRef.id && selectedBox?.[0] === "text" && Number(selectedBox[1]) === selected.paragraph.index && !target.closest("[data-grip]");
      // A click on the page may not move browser focus. Commit before replacing the
      // selection, otherwise React removes the contentEditable before its blur runs.
      if (selected && !stayingInText && !target.closest(".source-editor")) {
        e.preventDefault();
        const next = selectedBox?.[0] === "text" ? source?.paragraphs.find((p) => p.index === Number(selectedBox[1])) : undefined;
        void commitPendingParagraph().then((applied) => {
          if (!applied) return;
          if (next) props.onSourceSelect({ page: pageRef.id, paragraph: next, color: sample(next.rect).color, caret: { x: e.clientX, y: e.clientY } });
          else { props.onSourceSelect(null); setPickedImage(selectedBox?.[0] === "image" ? Number(selectedBox[1]) : null); }
        });
        return;
      }
      if (!box || !source) { if (!target.closest(".source-editor")) props.onSourceSelect(null); setPickedImage(null); return; }
      const [kind, raw] = box.dataset.source!.split(":"), index = Number(raw);
      if (kind === "text") {
        const paragraph = source.paragraphs.find((p) => p.index === index)!;
        if (target.closest("[data-grip]")) { e.preventDefault(); outer.current!.setPointerCapture(e.pointerId); setDrag({ kind: "source", start: point, dx: 0, dy: 0, target: { kind: "text", index: index + 1, rect: paragraph.rect } }); return; }
        // Prevent the click from moving focus away from the editor that opens right now.
        e.preventDefault();
        if (props.sourceSelection?.paragraph.index !== index || props.sourceSelection.page !== pageRef.id) props.onSourceSelect({ page: pageRef.id, paragraph, color: sample(paragraph.rect).color, caret: { x: e.clientX, y: e.clientY } });
      } else {
        const image = source.images.find((i) => i.index === index)!;
        e.preventDefault(); outer.current!.setPointerCapture(e.pointerId);
        setPickedImage(index); props.onSourceSelect(null);
        const handle = target.dataset.srcHandle;
        if (handle) { setDrag({ kind: "source-resize", start: point, index, handle, from: image.rect, to: image.rect }); return; }
        setDrag({ kind: "source", start: point, dx: 0, dy: 0, target: { kind: "image", index, rect: image.rect }, ghost: snapshot(image.rect) });
      }
      return;
    }
    if (tool.kind === "markup" || tool.kind === "select") textLayer.current?.classList.add("selecting");
    if (tool.kind === "markup") {
      if (!target.closest(".textLayer span")) { e.preventDefault(); outer.current!.setPointerCapture(e.pointerId); setDrag({ kind: "area", start: point, current: point }); }
      return;
    }
    const handle = target.dataset.handle, objectId = target.closest<HTMLElement>("[data-object-id]")?.dataset.objectId;
    if (handle && props.selected.size === 1) {
      const o = own.find((item) => props.selected.has(item.id));
      if (o) { e.preventDefault(); outer.current!.setPointerCapture(e.pointerId); const from = objectBounds(o); setDrag({ kind: "resize", start: point, id: o.id, handle, from, to: from }); }
      return;
    }
    if (objectId) {
      e.preventDefault();
      const note = own.find((o) => o.id === objectId && o.kind === "note");
      if (note) props.onOpenNote?.(props.openNote === note.id ? null : note.id);
      const additive = e.shiftKey || e.ctrlKey;
      const ids = props.selected.has(objectId) && !additive ? [...props.selected] : additive ? [...props.selected, objectId] : [objectId];
      props.onSelect(ids, false);
      outer.current!.setPointerCapture(e.pointerId);
      setDrag({ kind: "move", start: point, ids: ids.filter((id) => own.some((o) => o.id === id)), dx: 0, dy: 0 });
      return;
    }
    if (props.selected.size && !e.shiftKey) props.onSelect([], false);
  }
  function onPointerMove(e: React.PointerEvent) {
    if (tool.kind === "sign-place") { setGhost(pagePoint(e)); return; }
    if (!drag) return;
    const point = pagePoint(e);
    switch (drag.kind) {
      case "create": setDrag({ ...drag, current: point, points: tool.kind === "ink" ? [...drag.points, point] : drag.points }); break;
      case "area": setDrag({ ...drag, current: point }); break;
      case "move": setDrag({ ...drag, dx: point.x - drag.start.x, dy: point.y - drag.start.y }); break;
      case "source": setDrag({ ...drag, dx: point.x - drag.start.x, dy: point.y - drag.start.y }); break;
      case "source-resize": {
        let to = resized(drag.from, drag.handle, point.x - drag.start.x, point.y - drag.start.y);
        // Corners keep the picture's proportions (Shift frees them), as in Acrobat.
        if (drag.handle.length === 2 && !e.shiftKey) { const ratio = drag.from.height / drag.from.width, height = to.width * ratio; to = { ...to, y: drag.handle.includes("n") ? drag.from.y + drag.from.height - height : drag.from.y, height }; }
        setDrag({ ...drag, to }); break;
      }
      case "resize": {
        let to = resized(drag.from, drag.handle, point.x - drag.start.x, point.y - drag.start.y);
        // Images and signatures keep their proportions on corner handles (Shift frees them).
        const target = own.find((o) => o.id === drag.id);
        if (target?.kind === "image" && drag.handle.length === 2 && !e.shiftKey) {
          const ratio = drag.from.height / drag.from.width, height = to.width * ratio;
          to = { ...to, y: drag.handle.includes("n") ? drag.from.y + drag.from.height - height : drag.from.y, height };
        }
        setDrag({ ...drag, to });
        break;
      }
    }
  }
  function onPointerUp(e: React.PointerEvent) {
    textLayer.current?.classList.remove("selecting");
    if (!drag) { if (tool.kind === "markup") markupFromSelection(); return; }
    outer.current?.releasePointerCapture(e.pointerId);
    const d = drag;
    if (d.kind === "create" && tool.kind === "shape" && (tool.shape === "polyline" || tool.shape === "polygon")) return;
    setDrag(null);
    if (d.kind === "create") void finishCreate(d).catch(props.onError);
    else if (d.kind === "area") { const r = normalize(d.start, d.current); if (r.width > 3 && r.height > 3 && tool.kind === "markup") props.onAdd({ id: uid(), page: pageRef.id, kind: "markup", style: tool.style, rects: [r], color: tool.style === "highlight" ? style.highlight : style.stroke, opacity: tool.style === "highlight" ? style.highlightOpacity : 1 }); }
    else if (d.kind === "move" && (Math.abs(d.dx) > 0.5 || Math.abs(d.dy) > 0.5)) props.onUpdate(own.filter((o) => d.ids.includes(o.id)).map((o) => translateObject(o, d.dx, d.dy)));
    else if (d.kind === "resize") { const o = own.find((item) => item.id === d.id); if (o) props.onUpdate([resizeObject(o, d.from, d.to)]); }
    else if (d.kind === "source-resize" && (Math.abs(d.to.width - d.from.width) > 1 || Math.abs(d.to.height - d.from.height) > 1)) {
      setEngineBusy(true);
      void window.gcp.editSourceImage(props.docId, pageRef.id, { image: d.index, action: "resize", from: d.from, to: d.to }).catch(props.onError).finally(() => setEngineBusy(false));
    }
    else if (d.kind === "source" && (Math.abs(d.dx) > 1 || Math.abs(d.dy) > 1) && source) {
      setEngineBusy(true);
      props.onSourceSelect(null);
      if (d.target.kind === "image") setDropped({ generation: source.generation, index: d.target.index, dx: d.dx, dy: d.dy, ...(d.ghost ? { ghost: d.ghost } : {}) });
      void window.gcp.moveSourceObjects(props.docId, pageRef.id, { generation: source.generation, objects: [{ kind: d.target.kind, index: d.target.index }], dx: d.dx, dy: d.dy }).catch((error) => { setDropped(null); props.onError(error); }).finally(() => setEngineBusy(false));
    }
  }
  /** One action from the image menu on an original picture, applied by the engine and undoable. */
  function imageAction(index: number, action: "rotate" | "flip_horizontal" | "flip_vertical" | "delete", quarters?: 1 | -1) {
    setImageMenu(null); setEngineBusy(true);
    void window.gcp.editSourceImage(props.docId, pageRef.id, { image: index, action, ...(quarters ? { quarters } : {}) }).catch(props.onError).finally(() => setEngineBusy(false));
  }
  function onDoubleClick(e: React.MouseEvent) {
    // Pointer capture retargets the event to the page, so the picture is found by position.
    if (tool.kind === "edit") { const p = pagePoint(e), image = source?.images.slice().reverse().find((i) => p.x >= i.rect.x && p.x <= i.rect.x + i.rect.width && p.y >= i.rect.y && p.y <= i.rect.y + i.rect.height); if (image && (tool.mode ?? "all") !== "text") props.onSourceImageEdit?.(pageRef.id, image.index, image.rect); return; }
    if (drag?.kind === "create" && tool.kind === "shape") { e.preventDefault();if(finishPolyline(drag.points))setDrag(null);return; }
    if (tool.kind !== "select") return;
    const p = pagePoint(e), hit = [...own].reverse().find((item) => { if (item.kind !== "text") return false; const b = objectBounds(item); return p.x >= b.x - 2 && p.x <= b.x + b.width + 2 && p.y >= b.y - 2 && p.y <= b.y + b.height + 2; });
    if (hit) { props.onSelect([hit.id], false); props.onEditText(hit.id); return; }
    const picture = [...own].reverse().find((item) => { if (item.kind !== "image") return false; const b = objectBounds(item); return p.x >= b.x && p.x <= b.x + b.width && p.y >= b.y && p.y <= b.y + b.height; });
    if (picture) { props.onSelect([picture.id], false); props.onEditImage?.(picture.id); }
  }
  useEffect(() => {
    if (!drag || drag.kind !== "create") return;
    const cancel = (e: KeyboardEvent) => { if (e.key === "Escape") setDrag(null); if (e.key === "Enter" && tool.kind === "shape") { e.preventDefault();if(finishPolyline(drag.points))setDrag(null); } };
    window.addEventListener("keydown", cancel);
    return () => window.removeEventListener("keydown", cancel);
  }, [drag]);
  const selectedObjects = preview.filter((o) => props.selected.has(o.id));
  const single = selectedObjects.length === 1 && selectedObjects[0]!.kind !== "markup" ? selectedObjects[0]! : null;
  const activeParagraph = props.sourceSelection?.page === pageRef.id ? props.sourceSelection.paragraph : null;
  return (
    <div
      ref={outer}
      className={`page-sheet tool-${tool.kind} ${rendered ? "" : "loading"}`}
      onPointerLeave={() => setGhost(null)}
      style={{ width: display.width, height: display.height }}
      data-page={props.index + 1}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onDoubleClick={onDoubleClick}
    >
      <canvas ref={canvas} style={{ width: display.width, height: display.height }} />
      <div ref={textLayer} className="textLayer" />
      {near && <FormLayer pageRef={pageRef} rotation={rotation} scale={scale} values={props.fields} interactive={tool.kind === "select"} onChange={props.onFields} onFieldMenu={(name, type) => props.onFieldMenu?.(pageRef.id, name, type)} onButton={(action) => props.onFormButton?.(pageRef.id, action)} onError={props.onError} />}
      <div className="page-overlay" style={{ width: size.width, height: size.height, transform: pageTransform(size, rotation, scale) }}>
        <NativeAnnotations annotations={props.annotations} open={props.openNote} onOpen={(id)=>props.onOpenNote?.(id)} onDelete={props.onDeleteAnnotation} interactive={tool.kind === "select"} />
        <svg className="overlay-vectors" width={size.width} height={size.height} viewBox={`0 0 ${size.width} ${size.height}`}>
          {preview.map((o) => <VectorView key={o.id} o={o} />)}
          {draft && <VectorView o={draft} />}
        </svg>
        {preview.map((o) => (
          <ObjectView key={o.id} o={o} editing={props.editingText === o.id} onCommitText={(text, height) => {
            props.onEditText(null);
            if (o.kind !== "text") return;
            if (!text.trim()) { props.onDelete([o.id]); return; }
            if (text !== o.text || Math.abs(height - o.height) > 1) props.onUpdate([{ ...o, text, height: Math.max(height, o.size * 1.2) }]);
          }} />
        ))}
        {tool.kind === "select" && preview.flatMap((o) => (o.kind === "markup" ? o.rects : [objectBounds(o)]).map((r, i) => (
          <div key={o.id + i} className={`object-hit ${props.selected.has(o.id) ? "selected" : ""} ${o.kind === "text" ? "text-hit" : ""}`} data-object-id={o.id} style={{ left: r.x, top: r.y, width: r.width, height: r.height, display: props.editingText === o.id ? "none" : undefined }} />
        )))}
        {single && tool.kind === "select" && props.editingText !== single.id && (() => {
          const b = objectBounds(single);
          return (
            <div className="selection-box" style={{ left: b.x, top: b.y, width: b.width, height: b.height, ["--handle" as string]: `${8 / scale}px` }}>
              {HANDLES.map((h) => <span key={h} className={`handle ${h}`} data-handle={h} />)}
            </div>
          );
        })()}
        {props.openNote && (() => { const n = own.find((o) => o.id === props.openNote && o.kind === "note") as PdfNote | undefined; return n ? <NoteBubble note={n} onChange={(next) => props.onUpdate([next])} onDelete={() => { props.onOpenNote?.(null); props.onDelete([n.id]); }} onClose={() => { if (!n.text && !(n.replies ?? []).length) props.onDelete([n.id]); props.onOpenNote?.(null); }} /> : null; })()}
        {tool.kind === "sign-place" && ghost && <div className="signature-ghost" style={{ left: Math.max(0, Math.min(size.width - tool.width, ghost.x - tool.width / 2)), top: Math.max(0, Math.min(size.height - tool.height, ghost.y - tool.height / 2)) }}><SignaturePreview lines={tool.lines} image={tool.image} width={tool.width} height={tool.height} scale={tool.height / (26 + tool.lines.length * 11)} /></div>}
        {tool.kind === "edit" && source && (
          <>
            {/* Editar texto / Editar imagens limit what can be picked; Editar tudo shows both. */}
            {(tool.mode ?? "all") !== "text" && source.images.map((image) => {
              const moving = drag?.kind === "source" && drag.target.kind === "image" && drag.target.index === image.index ? drag : dropped?.index === image.index && dropped.generation === source.generation ? dropped : null;
              const sizing = drag?.kind === "source-resize" && drag.index === image.index ? drag.to : null, r = sizing ?? image.rect, picked = pickedImage === image.index;
              return (
                <div key={"i" + image.index} className={`source-box image ${picked ? "picked" : ""}`} data-source={`image:${image.index}`} title={translateUi("Arraste para mover · duplo clique para editar · botão direito para mais opções")}
                  onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); setPickedImage(image.index); setImageMenu({ x: e.clientX, y: e.clientY, index: image.index, rect: image.rect }); }}
                  style={{ left: r.x + (moving?.dx ?? 0), top: r.y + (moving?.dy ?? 0), width: r.width, height: r.height, ["--handle" as string]: `${8 / scale}px` }}>
                  {moving?.ghost && <img className="source-ghost" src={moving.ghost} alt="" draggable={false} />}
                  {picked && HANDLES.map((h) => <span key={h} className={`handle ${h}`} data-src-handle={h} />)}
                </div>
              );
            })}
            {(tool.mode ?? "all") !== "images" && source.paragraphs.map((p) => {
              const moving = drag?.kind === "source" && drag.target.kind === "text" && drag.target.index === p.index + 1, active = activeParagraph?.index === p.index;
              return (
                <div key={"p" + p.index} className={`source-box text ${active ? "active" : ""}`} data-source={`text:${p.index}`} style={{ left: p.rect.x + (moving ? drag.dx : 0) - 2, top: p.rect.y + (moving ? drag.dy : 0) - 2, width: p.rect.width + 4, height: p.rect.height + 4 }}>
                  {active && <span className="source-grip" data-grip title={translateUi("Arraste para mover o parágrafo")} style={{ ["--grip" as string]: `${18 / scale}px` }}><Move size={12} /></span>}
                </div>
              );
            })}
            {activeParagraph && <ParagraphEditor key={`${pageRef.id}:${activeParagraph.index}`} paragraph={activeParagraph} lines={paragraphLines(pageText.current, activeParagraph.rect)} caret={props.sourceSelection?.caret} colors={sample(activeParagraph.rect)} onCommit={async (text, width) => {
              const resized = width !== undefined && Math.abs(width - activeParagraph.rect.width) > 0.5;
              if (text === activeParagraph.text && !resized) { props.onSourceSelect(null); return; }
              setEngineBusy(true);
              try {
                await window.gcp.editParagraph(props.docId, pageRef.id, { paragraph: activeParagraph.index, text, ...(width !== undefined ? { width } : {}) });
                props.onSourceSelect(null);
              } finally { setEngineBusy(false); }
            }} onError={props.onError} />}
          </>
        )}
      </div>
      {imageMenu && (
        <div className="context-menu image-menu" style={{ position: "fixed", left: Math.min(imageMenu.x, window.innerWidth - 270), top: Math.min(imageMenu.y, window.innerHeight - 350) }} onPointerDown={(e) => e.stopPropagation()} onMouseLeave={() => setImageMenu(null)}>
          <div className="context-title">{translateUi("Imagem")}</div>
          <button onClick={() => { const m = imageMenu; setImageMenu(null); props.onSourceImageEdit?.(pageRef.id, m.index, m.rect); }}>{translateUi("Editar imagem (recortar, cores, fundo)…")}</button>
          <button onClick={() => { const m = imageMenu; setImageMenu(null); void (async () => { const picked = await window.gcp.chooseImage(); if (!picked) return; setEngineBusy(true); try { await window.gcp.editSourceImage(props.docId, pageRef.id, { image: m.index, action: "replace", dataUrl: picked.dataUrl }); } finally { setEngineBusy(false); } })().catch(props.onError); }}>{translateUi("Substituir imagem…")}</button>
          <button onClick={() => { const m = imageMenu; setImageMenu(null); void window.gcp.exportSourceImage(props.docId, pageRef.id, m.index, true).catch(props.onError); }}>{translateUi("Salvar imagem como…")}</button>
          <hr />
          <button onClick={() => imageAction(imageMenu.index, "rotate", -1)}>{translateUi("Girar 90° à esquerda")}</button>
          <button onClick={() => imageAction(imageMenu.index, "rotate", 1)}>{translateUi("Girar 90° à direita")}</button>
          <button onClick={() => imageAction(imageMenu.index, "flip_horizontal")}>{translateUi("Espelhar na horizontal")}</button>
          <button onClick={() => imageAction(imageMenu.index, "flip_vertical")}>{translateUi("Espelhar na vertical")}</button>
          <hr />
          <button className="danger" onClick={() => imageAction(imageMenu.index, "delete")}>{translateUi("Excluir imagem")}</button>
        </div>
      )}
      {(engineBusy || (tool.kind === "edit" && near && !source)) && (
        <div className="page-busy"><LoaderCircle size={14} className="spin" /> {engineBusy ? translateUi("Aplicando no PDF…") : translateUi("Lendo textos da página…")}</div>
      )}
    </div>
  );
}

/** The PDF.js runs inside a paragraph's box, grouped into its printed lines (unrotated top-left points). */
function paragraphLines(text: PageText | null, rect: Rect): EditorLine[] {
  if (!text) return [];
  const left = text.view[0]!, top = text.view[3]!, lines: EditorLine[] = [];
  const runs = text.items.map((item) => {
    const size = Math.hypot(item.transform[2]!, item.transform[3]!) || Math.hypot(item.transform[0]!, item.transform[1]!);
    return { ...item, size, x: item.transform[4]! - left, baseline: top - item.transform[5]! };
  }).filter((r) => r.str.length && r.x >= rect.x - 1 && r.x + r.width <= rect.x + rect.width + Math.max(1.5, r.size * 0.12) && r.baseline >= rect.y && r.baseline <= rect.y + rect.height + Math.max(1, r.size * 0.2));
  for (const run of runs.sort((a, b) => a.baseline - b.baseline || a.x - b.x)) {
    let line = lines.find((l) => Math.abs(l.baseline - run.baseline) < run.size * 0.35);
    if (!line) { line = { runs: [], baseline: run.baseline, x: run.x, right: run.x }; lines.push(line); }
    const last = line.runs.at(-1), gap = run.x - line.right;
    // PDF.js often leaves out the space between runs; restore it from the gap.
    if (last && gap > run.size * 0.15 && !/\s$/.test(last.text) && !/^\s/.test(run.str)) last.text += " ";
    if (last && last.font === run.fontName && Math.abs(last.size - run.size) < 0.2) last.text += run.str;
    else line.runs.push({ text: run.str, font: run.fontName, size: run.size });
    line.x = Math.min(line.x, run.x); line.right = Math.max(line.right, run.x + run.width);
  }
  for (const line of lines) { const last = line.runs.at(-1); if (last) last.text = last.text.trimEnd(); }
  return lines.filter((l) => l.runs.some((r) => r.text.trim())).sort((a, b) => a.baseline - b.baseline);
}
/** Edits a paragraph in place: same embedded fonts, size, line pitch and justification as the page, with the caret where the user clicked. */
function ParagraphEditor({ paragraph, lines, caret, colors, onCommit, onError }: { paragraph: SourceParagraph; lines: EditorLine[]; caret?: { x: number; y: number }; colors: { background: string; color: string }; onCommit: (text: string, width?: number) => Promise<void>; onError: (error: unknown) => void }) {
  const box = useRef<HTMLDivElement>(null), content = useRef<HTMLDivElement>(null), done = useRef(false), busy = useRef(false);
  const commitRef = useRef<() => Promise<boolean>>(() => Promise.resolve(true));
  const pendingCommit = useRef<Promise<boolean> | null>(null);
  const lastPointer = useRef<{ target: HTMLElement; at: number } | null>(null);
  useEffect(() => { const remember = (event: PointerEvent) => { if (event.target instanceof HTMLElement) lastPointer.current = { target: event.target, at: Date.now() }; }; document.addEventListener("pointerdown", remember, true); return () => document.removeEventListener("pointerdown", remember, true); }, []);
  const [width, setWidth] = useState(paragraph.rect.width), [saving, setSaving] = useState(false);
  const resized = useRef(false), drag = useRef<{x:number;width:number;scale:number}|null>(null);
  const fallback = paragraph.family ? `"${paragraph.family}", Helvetica, Arial, sans-serif` : "Helvetica, Arial, sans-serif";
  const usable = lines.length > 0, size = usable ? lines[0]!.runs[0]!.size : paragraph.size;
  const pitch = usable && lines.length > 1 ? (lines.at(-1)!.baseline - lines[0]!.baseline) / (lines.length - 1) : size * 1.25;
  const top = usable ? lines[0]!.baseline - (pitch - size) / 2 - size * 0.8 : paragraph.rect.y;
  useLayoutEffect(() => {
    const frame = requestAnimationFrame(() => {
      const node = content.current; if (!node) return;
      node.focus();
      const at = caret ? document.caretRangeFromPoint?.(caret.x, caret.y) : null, selection = window.getSelection();
      if (at && node.contains(at.startContainer)) { selection?.removeAllRanges(); selection?.addRange(at); return; }
      const range = document.createRange(); range.selectNodeContents(node); range.collapse(false); selection?.removeAllRanges(); selection?.addRange(range);
    });
    return () => cancelAnimationFrame(frame);
  }, []);
  const editedText = () => (content.current?.innerText ?? paragraph.text).replace(/\r\n?/g, "\n").replace(/\n$/, "");
  // The formatting bar applies font/size/colour together with what was typed (see pendingParagraphText).
  useEffect(() => { openEditor = { text: () => { const t = editedText(); return t.replace(/\s+/g, " ").trim() === paragraph.text.replace(/\s+/g, " ").trim() ? undefined : t; }, done: () => { done.current = true; }, commit: () => commitRef.current() }; return () => { openEditor = null; }; }, []);
  const applyEdit = async (cancel: boolean): Promise<boolean> => {
    if (done.current) return true;
    if (busy.current || drag.current) return false;
    busy.current = true; setSaving(true);
    try {
      if (cancel) { await onCommit(paragraph.text); done.current = true; return true; }
      const text = editedText(), flat = (v:string) => v.replace(/\s+/g," ").trim();
      let actualWidth = width;
      // Existing printed rows do not reflow in the browser. Grow to fit new glyphs unless the user
      // explicitly chose a width. This avoids a one-line title wrapping at its old tight glyph box.
      if (!resized.current && content.current && box.current) {
        const scale = box.current.getBoundingClientRect().width / box.current.offsetWidth || 1;
        for (const child of Array.from(content.current.children)) {
          const range = document.createRange(); range.selectNodeContents(child);
          actualWidth = Math.max(actualWidth, range.getBoundingClientRect().width / scale + 2);
        }
      }
      const changed = flat(text) !== flat(paragraph.text);
      await onCommit(changed ? text : paragraph.text, changed || resized.current ? actualWidth : undefined);
      done.current = true;
      return true;
    } catch (error) { onError(error); content.current?.focus(); return false; }
    finally { busy.current = false; setSaving(false); }
  };
  const commit = (cancel: boolean): Promise<boolean> => {
    if (pendingCommit.current) return pendingCommit.current;
    const pending = applyEdit(cancel);
    pendingCommit.current = pending;
    void pending.finally(() => { if (pendingCommit.current === pending) pendingCommit.current = null; });
    return pending;
  };
  commitRef.current = () => commit(false);
  return <div ref={box} className="source-editor" data-saving={saving || undefined}
    style={{left:paragraph.rect.x-2,top,width:width+4,minHeight:pitch*Math.max(1,usable?lines.length:paragraph.text.split("\n").length),fontSize:size,lineHeight:`${pitch}px`,fontFamily:fallback,fontWeight:!usable&&paragraph.bold?700:400,fontStyle:!usable&&paragraph.italic?"italic":"normal",background:colors.background,color:colors.color}}
    onPointerDown={e=>e.stopPropagation()} onDoubleClick={e=>e.stopPropagation()}>
    <div ref={content} className="source-editor-content" contentEditable={!saving} suppressContentEditableWarning spellCheck={false}
      onPaste={e=>{e.preventDefault();document.execCommand("insertText",false,e.clipboardData.getData("text/plain"));}}
      onKeyDown={e=>{e.stopPropagation();if(e.key==="Escape"){e.preventDefault();void commit(true);}if(e.key==="Enter"&&e.ctrlKey){e.preventDefault();void commit(false);}}}
      onBlur={e=>{const to=e.relatedTarget as HTMLElement|null, pointer=lastPointer.current;if(box.current?.contains(to)||to?.closest('.property-bar')||(pointer&&Date.now()-pointer.at<200&&pointer.target.closest('.property-bar')))return;void commit(false);}}>
      {usable ? lines.map((line,i)=><div key={i} style={{marginLeft:line.x-paragraph.rect.x,minHeight:pitch}}>{line.runs.map((run,r)=><span key={r} style={{fontFamily:`"${run.font}", ${fallback}`,fontSize:run.size}}>{run.text}</span>)}</div>) : paragraph.text.split("\n").map((line,i)=><div key={i}>{line||<br/>}</div>)}
    </div>
    <span className="source-width-handle" role="slider" aria-label={translateUi("Largura da caixa de texto")} aria-valuenow={Math.round(width)} tabIndex={0}
      title={translateUi("Arraste para ajustar a largura da caixa de texto")}
      onKeyDown={e=>{if(e.key==='ArrowLeft'||e.key==='ArrowRight'){e.preventDefault();e.stopPropagation();resized.current=true;setWidth(w=>Math.max(20,w+(e.key==='ArrowRight'?5:-5)));}}}
      onPointerDown={e=>{e.preventDefault();e.stopPropagation();if(saving)return;const node=box.current!;drag.current={x:e.clientX,width,scale:node.getBoundingClientRect().width/node.offsetWidth||1};e.currentTarget.setPointerCapture(e.pointerId);}}
      onPointerMove={e=>{if(!drag.current)return;resized.current=true;setWidth(Math.max(20,drag.current.width+(e.clientX-drag.current.x)/drag.current.scale));}}
      onPointerUp={e=>{if(!drag.current)return;drag.current=null;e.currentTarget.releasePointerCapture(e.pointerId);content.current?.focus();}} />
    {saving && <span className="source-editor-hint" contentEditable={false}>{translateUi("Aplicando…")}</span>}
  </div>;
}

export function clearSourceCache() { sourceCache.clear(); }
let openEditor: { text: () => string | undefined; done: () => void; commit: () => Promise<boolean> } | null = null;
/** Returns false after a failed edit so callers keep the draft and its selection. */
export function commitPendingParagraph(): Promise<boolean> { return openEditor?.commit() ?? Promise.resolve(true); }
/** Text typed in the open paragraph editor (undefined when unchanged); marks it handled for the formatting edit. */
export function pendingParagraphText() { const editor = openEditor; if (!editor) return undefined; const text = editor.text(); editor.done(); return text; }
