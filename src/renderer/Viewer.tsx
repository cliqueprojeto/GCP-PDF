import React, { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from "react";
import type { DocumentInfo, FieldValue, PageObject, PageRef, Rect } from "../shared/types";
import { PageView, type SourceSelection } from "./PageView";
import { loadPage, totalRotation, usePageGeometry, displaySize } from "./pdf";
import type { Style, Tool } from "./editor";

export interface ViewerHandle { scrollToPage: (index: number, top?: number | null) => void; readingTop: () => number; fitWidth: () => number | null; fitPage: () => number | null }
interface Props {
  onDeleteAnnotation:(a:import("../shared/types").PdfAnnotation)=>void;
  doc: DocumentInfo;
  scale: number;
  tool: Tool;
  style: Style;
  search: string;
  selected: Set<string>;
  editingText: string | null;
  sourceSelection: SourceSelection | null;
  onSourceSelect: (selection: SourceSelection | null) => void;
  onEditText: (id: string | null) => void;
  onSelect: (ids: string[]) => void;
  onAdd: (object: PageObject, dataUrl?: string) => void;
  onUpdate: (objects: PageObject[]) => void;
  onDelete: (ids: string[]) => void;
  onFields: (values: Record<string, FieldValue>) => void;
  onToolDone: (created?: string) => void;
  searchFocus: { page: number; n: number } | null;
  onArea: (page: string, rect: Rect) => void;
  onFieldMenu?: (page: string, name: string, type: string) => void;
  onFormButton?: (page: string, action: import("./FormLayer").ButtonAction) => void;
  onEditImage?: (id: string) => void;
  openNote?: string | null;
  onOpenNote?: (id: string | null) => void;
  onSourceImageEdit?: (page: string, image: number, rect: Rect) => void;
  onPageMenu?: (menu: import("./PageView").PageMenu) => void;
  onCurrentPage: (index: number) => void;
  onZoom: (factor: number) => void;
  onError: (error: unknown) => void;
  layout?: "single" | "double" | "cover";
  filter?: string;
}
export const Viewer = forwardRef<ViewerHandle, Props>(function Viewer(props, handle) {
  const { doc, scale } = props, spread = props.layout === "double" || props.layout === "cover", scroller = useRef<HTMLDivElement>(null), geometry = usePageGeometry(doc.pages), current = useRef(0);
  const byPage = useMemo(() => {
    const map = new Map<string, PageObject[]>();
    for (const o of doc.objects) map.set(o.page, [...(map.get(o.page) ?? []), o]);
    return map;
  }, [doc.objects]);
  useImperativeHandle(handle, () => ({
    scrollToPage(index, top) {
      const node = scroller.current?.querySelector<HTMLElement>(`[data-page="${index + 1}"]`);
      if (node && scroller.current) scroller.current.scrollTo({ top: node.offsetTop - 16 + (top ? top * scale : 0), behavior: "auto" });
    },
    /** Points from the top of the current page to the top of the view (where a bookmark should take the reader back). */
    readingTop() {
      const node = scroller.current?.querySelector<HTMLElement>(`[data-page="${current.current + 1}"]`);
      return node && scroller.current ? Math.max(0, Math.round((scroller.current.scrollTop + 16 - node.offsetTop) / scale)) : 0;
    },
    fitPage() {
      const ref = doc.pages[current.current] ?? doc.pages[0];
      if (!ref || !scroller.current) return null;
      const g = geometry(ref), size = displaySize(g, totalRotation(ref, g), 1);
      return Math.max(0.1, Math.min(4, Math.min((scroller.current.clientWidth - 64 - (spread ? 24 : 0)) / (size.width * (spread ? 2 : 1)), (scroller.current.clientHeight - 48) / size.height)));
    },
    fitWidth() {
      const ref = doc.pages[current.current] ?? doc.pages[0];
      if (!ref || !scroller.current) return null;
      const g = geometry(ref), size = displaySize(g, totalRotation(ref, g), 1);
      return Math.max(0.25, Math.min(4, (scroller.current.clientWidth - 64 - (spread ? 24 : 0)) / (size.width * (spread ? 2 : 1))));
    },
  }));
  useEffect(() => {
    const node = scroller.current;
    if (!node) return;
    let frame = 0;
    const update = () => {
      frame = 0;
      const middle = node.scrollTop + node.clientHeight / 3;
      let best = 0;
      for (const page of node.querySelectorAll<HTMLElement>(".page-sheet")) { if (page.offsetTop <= middle) best = Number(page.dataset.page) - 1; else if (page.offsetLeft <= 0 || !spread) break; }
      if (best !== current.current) { current.current = best; props.onCurrentPage(best); }
    };
    const onScroll = () => { if (!frame) frame = requestAnimationFrame(update); };
    node.addEventListener("scroll", onScroll, { passive: true });
    return () => { node.removeEventListener("scroll", onScroll); cancelAnimationFrame(frame); };
  }, [doc.id]);
  // Ctrl + mouse wheel zooms around the reading position, as in desktop PDF readers.
  useEffect(() => {
    const node = scroller.current;
    if (!node) return;
    const wheel = (e: WheelEvent) => { if (!e.ctrlKey) return; e.preventDefault(); props.onZoom(e.deltaY < 0 ? 1.1 : 1 / 1.1); };
    node.addEventListener("wheel", wheel, { passive: false });
    return () => node.removeEventListener("wheel", wheel);
  }, [props.onZoom]);
  return (
    <div ref={scroller} className={`canvas-scroll filter-${props.filter ?? "none"}`}>
      <div className={`page-column layout-${props.layout ?? "single"}`}>
        {doc.pages.map((ref, index) => {
          const g = geometry(ref);
          return (
            <PageView
              key={ref.id}
              annotations={doc.annotations.filter(a=>a.page===ref.id)}
              onDeleteAnnotation={props.onDeleteAnnotation}
              docId={doc.id}
              docKey={`${doc.path ?? doc.name}#${index}`}
              pageRef={ref}
              index={index}
              geometry={g}
              rotation={totalRotation(ref, g)}
              scale={scale}
              objects={byPage.get(ref.id) ?? []}
              selected={props.selected}
              tool={props.tool}
              style={props.style}
              search={props.search}
              editingText={props.editingText}
              sourceSelection={props.sourceSelection}
              onSourceSelect={props.onSourceSelect}
              onEditText={props.onEditText}
              onSelect={props.onSelect}
              onAdd={props.onAdd}
              onUpdate={props.onUpdate}
              onDelete={props.onDelete}
              fields={doc.fields}
              onFields={props.onFields}
              onToolDone={props.onToolDone}
              searchFocus={props.searchFocus?.page === index ? props.searchFocus.n : -1}
              onArea={props.onArea}
              onFieldMenu={props.onFieldMenu}
              onFormButton={props.onFormButton}
              onEditImage={props.onEditImage}
              openNote={props.openNote}
              onOpenNote={props.onOpenNote}
              onSourceImageEdit={props.onSourceImageEdit}
              onPageMenu={props.onPageMenu}
              onError={props.onError}
            />
          );
        })}
      </div>
    </div>
  );
});

/** A lazily rendered page miniature; it re-renders only when its own page or rotation changes. */
export function PageThumb({ pageRef, width = 120 }: { pageRef: PageRef; width?: number }) {
  const canvas = useRef<HTMLCanvasElement>(null), [visible, setVisible] = useState(false), [size, setSize] = useState({ width, height: width * 1.414 });
  useEffect(() => {
    const node = canvas.current?.parentElement;
    if (!node) return;
    const observer = new IntersectionObserver((entries) => setVisible(entries.some((e) => e.isIntersecting)), { rootMargin: "400px 0px" });
    observer.observe(node);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    if (!visible) return;
    let dead = false, task: { cancel: () => void; promise: Promise<void> } | undefined;
    void (async () => {
      const page = await loadPage(pageRef);
      if (dead || !canvas.current) return;
      const rotation = (page.rotate + pageRef.rotate) % 360, base = page.getViewport({ scale: 1, rotation }), viewport = page.getViewport({ scale: width / base.width, rotation });
      const dpr = Math.min(window.devicePixelRatio || 1, 2), next = document.createElement("canvas");
      next.width = Math.ceil(viewport.width * dpr);
      next.height = Math.ceil(viewport.height * dpr);
      // Rendered off screen and swapped in when complete: a cancelled render (a new version of the page
      // arriving) never leaves the visible miniature blank or black.
      task = page.render({ canvas: next, canvasContext: next.getContext("2d", { alpha: false })!, viewport, background: "#ffffff", transform: dpr === 1 ? undefined : [dpr, 0, 0, dpr, 0, 0] });
      await task.promise;
      const c = canvas.current;
      if (dead || !c) return;
      c.width = next.width; c.height = next.height;
      c.getContext("2d", { alpha: false })!.drawImage(next, 0, 0);
      setSize({ width: viewport.width, height: viewport.height });
    })().catch(() => {});
    return () => { dead = true; task?.cancel(); };
  }, [visible, pageRef.base, pageRef.src, pageRef.rotate, width]);
  return (
    <div className="thumbnail-sheet" style={{ width: size.width, height: size.height }}>
      <canvas ref={canvas} style={{ width: size.width, height: size.height }} />
    </div>
  );
}
