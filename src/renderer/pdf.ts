import { useEffect, useState } from "react";
import * as pdfjs from "pdfjs-dist";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import "pdfjs-dist/web/pdf_viewer.css";
import type { PDFDocumentProxy, PDFPageProxy } from "pdfjs-dist";
import type { PageRef } from "../shared/types";
pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;
export { pdfjs };

/** Source PDFs are immutable, so each one is fetched and parsed once per window. */
const documents = new Map<string, Promise<PDFDocumentProxy>>();
const pages = new Map<string, Promise<PDFPageProxy>>();
const assets = new Map<string, Promise<string>>();
export function loadBase(id: string): Promise<PDFDocumentProxy> {
  let task = documents.get(id);
  if (!task) {
    task = window.gcp.getBase(id).then(
      (bytes) =>
        pdfjs.getDocument({
          data: bytes,
          cMapUrl: new URL("./pdfjs/cmaps/", document.baseURI).href,
          cMapPacked: true,
          standardFontDataUrl: new URL("./pdfjs/standard_fonts/", document.baseURI).href,
          wasmUrl: new URL("./pdfjs/wasm/", document.baseURI).href,
        }).promise,
    );
    task.catch(() => documents.delete(id));
    documents.set(id, task);
  }
  return task;
}
export function loadPage(ref: Pick<PageRef, "base" | "src">): Promise<PDFPageProxy> {
  const key = `${ref.base}:${ref.src}`;
  let task = pages.get(key);
  if (!task) {
    task = loadBase(ref.base).then((doc) => doc.getPage(ref.src + 1));
    task.catch(() => pages.delete(key));
    pages.set(key, task);
  }
  return task;
}
export function loadAsset(id: string): Promise<string> {
  let task = assets.get(id);
  if (!task) {
    task = window.gcp.getAsset(id);
    task.catch(() => assets.delete(id));
    assets.set(id, task);
  }
  return task;
}
/** Frees parsed sources that no open document in this window references any more. */
export function releaseBases(keep: Set<string>) {
  for (const [id, task] of documents) {
    if (keep.has(id)) continue;
    documents.delete(id);
    for (const key of pages.keys()) if (key.startsWith(id + ":")) pages.delete(key);
    void task.then((doc) => doc.loadingTask.destroy()).catch(() => {});
  }
}
/** Unrotated crop-box size and the page's own /Rotate. */
export interface PageGeometry { width: number; height: number; rotation: number }
const geometry = new Map<string, PageGeometry>();
/** Last size seen for each page id: an edit gives the page a new source whose size is still being read, and
 * falling back to a default size would jump the whole column (and the reading position) for a moment. */
const lastSeen = new Map<string, PageGeometry>();
export function pageGeometry(ref: Pick<PageRef, "base" | "src">) { return geometry.get(`${ref.base}:${ref.src}`); }
/** Resolves the geometry of every page so the continuous view can lay out all pages up front. */
export function usePageGeometry(refs: PageRef[]) {
  const [, setVersion] = useState(0);
  const key = refs.map((ref) => `${ref.base}:${ref.src}`).join("|");
  useEffect(() => {
    let alive = true;
    const missing = refs.filter((ref) => !geometry.has(`${ref.base}:${ref.src}`));
    if (!missing.length) return;
    void (async () => {
      for (let start = 0; start < missing.length && alive; start += 24) {
        await Promise.all(
          missing.slice(start, start + 24).map(async (ref) => {
            const page = await loadPage(ref);
            const [x0, y0, x1, y1] = page.view;
            geometry.set(`${ref.base}:${ref.src}`, { width: x1 - x0, height: y1 - y0, rotation: page.rotate });
          }),
        ).catch(() => {});
        if (alive) setVersion((v) => v + 1);
      }
    })();
    return () => { alive = false; };
  }, [key]);
  return (ref: PageRef): PageGeometry => {
    const known = pageGeometry(ref);
    if (known) { lastSeen.set(ref.id, known); return known; }
    return lastSeen.get(ref.id) ?? pageGeometry(refs[0]!) ?? { width: 595.28, height: 841.89, rotation: 0 };
  };
}
export const totalRotation = (ref: PageRef, g: PageGeometry) => (((g.rotation + ref.rotate) % 360) + 360) % 360;
export function displaySize(g: PageGeometry, rotation: number, scale: number) {
  return rotation % 180 ? { width: g.height * scale, height: g.width * scale } : { width: g.width * scale, height: g.height * scale };
}
