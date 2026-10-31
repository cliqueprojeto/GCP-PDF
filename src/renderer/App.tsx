import {t as translateUi} from "./i18n";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import appIconUrl from "../../assets/icon.svg?url";
import {
  FileText, FolderOpen, Plus, X, Settings, Sun, Moon, ChevronLeft, ChevronRight, RotateCw, RotateCcw, Trash2, PanelLeftClose,
  Search, Check, Sparkles, Send, Heart, Layers3, Files, LoaderCircle, GripVertical, MoveUpRight, Signature as SignatureIcon,
  MessageSquare, ShieldCheck, SplitSquareHorizontal, PenLine, ArrowUpRight, Copy, Maximize2, Minimize2, FilePlus2, HelpCircle, ZoomIn, ZoomOut, Scissors, ClipboardPaste, FileOutput, Replace,
  ArrowDownRight, Lightbulb, Bookmark as BookmarkIcon, Pin, ChevronsUp, ChevronsDown, EyeOff, SlidersHorizontal, PanelRightClose } from "lucide-react";
import type { AppPrompt, PageObject, PdfOperation, Signature, WorkspaceState, ExportFormat, ExportOptions } from "../shared/types";
import { ExportDialog, Modal, PromptDialog, SettingsDialog, SignatureDialog, SupportDialog, SITE } from "./Dialogs";
import { Viewer, PageThumb, type ViewerHandle } from "./Viewer";
import { OrganizeView, NumberingDialog, CompressDialog, type OrganizeActions } from "./Tools";
import { ProtectDialog, CertificateDialog, FieldOptionsDialog, FieldPropsDialog, SignaturesDialog , type PlacedSignature } from "./Security";
import { CommandPalette, HelpDialog, type Command } from "./Palette";
import { StampDialog } from "./Stamps";
import { ImageEditor } from "./ImageEditor";
import { PrintDialog } from "./Print";
import { BookmarksPanel } from "./Bookmarks";
import { UpdateDialog, WhatsNewDialog } from "./Updates";
import { CommentsPanel, commentAuthor } from "./Comments";
import { CompareView, PropertiesDialog, StatsDialog } from "./Review";
import { Ribbon, TABS, ZoomBox, PropertyBar, propertiesContext, type Tab, type RibbonActions, type PageLayout, type ReadingFilter } from "./Ribbon";
import {resolveShortcut,readShortcuts,SHORTCUT_COMMANDS} from "../shared/shortcuts";
import { AiUsagePanel } from "./AiUsage";
import { Markdown } from "./Markdown";
import { DEFAULT_STYLE, uid, type Style, type Tool } from "./editor";
import { loadAsset, loadPage, pageGeometry, releaseBases } from "./pdf";
import { commitPendingParagraph, pendingParagraphText, type SourceSelection } from "./PageView";
import { Home, useRecentFiles } from "./Home";

type Panel = "comments" | "pages" | "bookmarks" | "search" | "signatures" | "ai";
const initial: WorkspaceState = { windowId: 0, documents: [], theme: "light", quickActions: true };
const PAGE_MIME = "application/x-gcp-pages", TAB_MIME = "application/x-gcp-tab";
function errorText(error: unknown) { return String(error instanceof Error ? error.message : error).replace(/^Error invoking remote method '[^']+': (?:Error: )?/, ""); }
function dragData(event: React.DragEvent) {
  for (const mime of [PAGE_MIME, TAB_MIME, "text/plain"]) {
    try { const raw = event.dataTransfer.getData(mime); if (raw) { const value = JSON.parse(raw); if (value && typeof value === "object") return value; } } catch {}
  }
  return null;
}
/** Every load, conversion and export shows what is running; "3 de 10" in the message drives a real bar. */
function ProgressCard({ text }: { text: string }) {
  const [since] = useState(() => Date.now()), [, tick] = useState(0);
  useEffect(() => { const timer = setInterval(() => tick((n) => n + 1), 1000); return () => clearInterval(timer); }, []);
  const match = /(\d+)\s+de\s+(\d+)/.exec(text), percent = match ? Math.min(100, (Number(match[1]) / Math.max(1, Number(match[2]))) * 100) : null, seconds = Math.floor((Date.now() - since) / 1000);
  return (
    <div className="progress-card" role="status" aria-live="polite">
      <LoaderCircle size={16} className="spin" />
      <div>
        <strong>{text}</strong>
        <div className={`progress-track ${percent === null ? "indeterminate" : ""}`}><span style={percent === null ? undefined : { width: `${percent}%` }} /></div>
        <small>{percent !== null ? `${Math.round(percent)}% · ` : ""}{seconds >= 2 ? `${seconds} s` : translateUi("processamento local")}</small>
      </div>
    </div>
  );
}
/** The model ends each answer with "### Sugestões" and short follow-up questions, shown as buttons. */
function splitSuggestions(answer: string): { body: string; suggestions: string[] } {
  const at = answer.search(/^#{2,4}\s*Sugest(?:õ|o)es[^\n]*$/im);
  if (at < 0) return { body: answer, suggestions: [] };
  const suggestions = answer.slice(at).split("\n").slice(1).map((l) => l.replace(/^\s*(?:[-*•]|\d+[.)])\s*/, "").replace(/\*\*/g, "").trim()).filter((l) => l.length > 3).slice(0, 4);
  return { body: answer.slice(0, at).trimEnd(), suggestions };
}
/** The ▾ button at the end of the tab row: how the ribbon behaves (Ctrl+F1 or double-click a tab toggles). */
function RibbonModeMenu({ mode, onMode }: { mode: "pinned" | "collapsed" | "auto"; onMode: (mode: "pinned" | "collapsed" | "auto") => void }) {
  const [open, setOpen] = useState(false), ref = useRef<HTMLDivElement>(null);
  useEffect(() => { if (!open) return; const close = (e: PointerEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); }; window.addEventListener("pointerdown", close); return () => window.removeEventListener("pointerdown", close); }, [open]);
  const options = [["pinned", "Fixar a faixa", "Sempre visível", Pin], ["collapsed", "Recolher a faixa", "Mostra só as guias; clique numa guia para abrir", ChevronsUp], ["auto", "Ocultar automaticamente", "Mais espaço para o documento; passe o mouse no topo", EyeOff]] as const;
  return (
    <div className="ribbon-mode" ref={ref}>
      <button className="icon-button" title={`Exibição da faixa de opções · Ctrl+F1`} onClick={() => setOpen(!open)}>{mode === "pinned" ? <ChevronsUp size={16} /> : <ChevronsDown size={16} />}</button>
      {open && (
        <div className="dropdown-menu ribbon-mode-menu">
          {options.map(([value, label, hint, Icon]) => (
            <button key={value} className={mode === value ? "active" : ""} onClick={() => { onMode(value); setOpen(false); }}><Icon size={15} /><span><strong>{translateUi(label)}</strong><small>{hint}</small></span></button>
          ))}
        </div>
      )}
    </div>
  );
}
function stored<T>(key: string, fallback: T): T { try { const raw = localStorage.getItem(key); return raw === null ? fallback : (JSON.parse(raw) as T); } catch { return fallback; } }
function store(key: string, value: unknown) { try { localStorage.setItem(key, JSON.stringify(value)); } catch {} }
function IconButton({ title, children, onClick, disabled = false, active = false, className = "" }: { title: string; children: React.ReactNode; onClick?: () => void; disabled?: boolean; active?: boolean; className?: string }) {
  return <button title={translateUi(title)} aria-label={translateUi(title)} aria-pressed={active ? true : undefined} disabled={disabled} onClick={onClick} className={`icon-button ${active ? "active" : ""} ${className}`}>{children}</button>;
}
/** Applies style changes from the property bar to an existing object. */
function restyled(o: PageObject, s: Partial<Style>): PageObject {
  switch (o.kind) {
    case "text": return { ...o, size: s.size ?? o.size, color: s.textColor ?? o.color, font: s.font ?? o.font, bold: s.bold ?? o.bold, italic: s.italic ?? o.italic, align: s.align ?? o.align };
    case "shape": return { ...o, stroke: s.stroke ?? o.stroke, fill: s.fill !== undefined ? s.fill : o.fill, strokeWidth: s.strokeWidth ?? o.strokeWidth, opacity: s.opacity ?? o.opacity };
    case "ink": return { ...o, stroke: s.stroke ?? o.stroke, strokeWidth: s.strokeWidth ?? o.strokeWidth, opacity: s.opacity ?? o.opacity };
    case "markup": return o.style === "highlight" ? { ...o, color: s.highlight ?? o.color, opacity: s.highlightOpacity ?? o.opacity } : { ...o, color: s.stroke ?? o.color };
    default: return o;
  }
}
export default function App() {
  const [workspace, setWorkspace] = useState<WorkspaceState>(initial), [ready, setReady] = useState(false);
  const [home, setHome] = useState(false);
  const [page, setPage] = useState(0), [selection, setSelection] = useState<Set<number>>(new Set([0])), [zoom, setZoom] = useState(1);
  const [panel, setPanel] = useState<Panel>("pages"), [sideOpen, setSideOpen] = useState(false);
  // Faixa de opções: fixa (padrão), recolhida (só as guias; clicar numa guia mostra a faixa) ou oculta automaticamente.
  const [ribbonMode, setRibbonMode] = useState<"pinned" | "collapsed" | "auto">(() => stored("gcp.ribbon", "pinned")), [peek, setPeek] = useState(false);
  const setRibbon = (mode: "pinned" | "collapsed" | "auto") => { setRibbonMode(mode); setPeek(false); store("gcp.ribbon", mode); };
  // Clicking the document closes a peeked ribbon.
  useEffect(() => { if (!peek || ribbonMode === "pinned") return; const close = (e: PointerEvent) => { if (!(e.target as HTMLElement).closest(".chrome, .modal, .dropdown-menu, .context-menu")) setPeek(false); }; window.addEventListener("pointerdown", close); return () => window.removeEventListener("pointerdown", close); }, [peek, ribbonMode]);
  const [layout, setLayout] = useState<PageLayout>(() => stored("gcp.layout", "single")), [readingFilter, setReadingFilter] = useState<ReadingFilter>(() => stored("gcp.filter", "none")), [reading, setReading] = useState(false);
  const toggleFullscreen = () => void window.gcp.setFullscreen().catch(onError);
  const startReading = () => { setReading(true); setTool({ kind: 'select' }); setTimeout(() => { const value = viewer.current?.fitPage(); if (value) setZoom(value); }, 250); };
  const stopReading = () => setReading(false);
  const [widths, setWidths] = useState<Record<string, number>>(() => stored("gcp.panel-widths", { pages: 230, search: 280, signatures: 290, ai: 420 }));
  const [resizing, setResizing] = useState(false);
  const [tool, setToolState] = useState<Tool>({ kind: "select" }), [style, setStyle] = useState<Style>(() => ({ ...DEFAULT_STYLE, ...stored("gcp.style", {}) }));
  const [tab, setTab] = useState<Tab>("Início"), [labels, setLabels] = useState<"below" | "side" | "hidden">(() => stored("gcp.labels", "below"));
  const [modal, setModal] = useState<"export" | "settings" | "support" | "signature" | "combine" | "numbering" | "compress" | "split" | "protect" | "certificate" | "signatures-check" | "field-options" | "palette" | "help" | "stamps" | "compare" | "stats" | "properties" | "print" | null>(null), [signArea, setSignArea] = useState<{ page: string; rect: import("../shared/types").Rect } | null>(null), [pendingField, setPendingField] = useState<{ page: string; rect: import("../shared/types").Rect; type: "combo" | "list" } | null>(null), [splitEvery, setSplitEvery] = useState(1), [splitMode, setSplitMode] = useState<"pages" | "size">("pages"), [splitMb, setSplitMb] = useState(5), [exportFormat, setExportFormat] = useState<ExportFormat | undefined>();
  const [busy, setBusy] = useState(""), [toast, setToast] = useState<{ text: string; error?: boolean } | null>(null);
  const [signatures, setSignatures] = useState<Signature[]>([]), [fonts, setFonts] = useState<string[]>([]);
  const [query, setQuery] = useState(""), [activeSearch, setActiveSearch] = useState(""), [matches, setMatches] = useState<{ page: number; count: number }[]>([]), [hit, setHit] = useState(0), [searching, setSearching] = useState(false);
  const [question, setQuestion] = useState(""), [conversation, setConversation] = useState<{ question: string; answer: string }[]>([]), [aiBusy, setAiBusy] = useState(false);
  const [dropIndex, setDropIndex] = useState<number | null>(null), [tabDrop, setTabDrop] = useState(false), [combineIds, setCombineIds] = useState<string[]>([]);
  const [update, setUpdate] = useState<import("../shared/types").UpdateInfo | null>(null), [whatsNew, setWhatsNew] = useState<{ versao: string; data: string; itens: string[] } | null>(null);
  useEffect(() => { void window.gcp?.whatsNew?.().then((info) => info && setWhatsNew(info)).catch(() => {}); }, []);
  const [signVisible, setSignVisible] = useState(false), [placed, setPlaced] = useState<PlacedSignature | null>(null);
  const [compareFirst, setCompareFirst] = useState<string | null>(null), [openNote, setOpenNote] = useState<string | null>(null);
  const [imageEdit, setImageEdit] = useState<{ id: string; src: string; source?: { page: string; image: number; rect: import("../shared/types").Rect } } | null>(null);
  const [fieldProps, setFieldProps] = useState<{ page: string; name: string; type: string } | null>(null);
  const [selectedObjects, setSelectedObjects] = useState<Set<string>>(new Set()), [editingText, setEditingText] = useState<string | null>(null), [sourceSelection, setSourceSelection] = useState<SourceSelection | null>(null);
  const [helpTopic, setHelpTopic] = useState<string | undefined>(), [thumbSize, setThumbSize] = useState<number>(() => stored("gcp.thumb", 130)), [pageMenu, setPageMenu] = useState<{ x: number; y: number; index: number } | null>(null), tabHover = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const [prompts, setPrompts] = useState<AppPrompt[]>([]), [fileDrag, setFileDrag] = useState(false), fileDragDepth = useRef(0);
  const active = workspace.documents.find((d) => d.id === workspace.activeDocumentId) || workspace.documents[0];
  const showHome = home || !active;
  const recent = useRecentFiles(workspace.documents, active?.id);
  const viewer = useRef<ViewerHandle>(null), searchRef = useRef<HTMLInputElement>(null), toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null), dragEndInside = useRef(false);
  const readingSaveTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined), restoringReading = useRef(false);
  const readingState = useRef({ path: active?.path, page, home: showHome });
  readingState.current = { path: active?.path, page, home: showHome };
  const notify = useCallback((message: string, error = false) => {
    setToast({ text: translateUi(message), error });
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), error ? 9000 : 4500);
  }, []);
  const onError = useCallback((error: unknown) => notify(errorText(error), true), [notify]);
  const perform = useCallback(async <T,>(task: () => Promise<T>, label = "") => {
    if (label) setBusy(label);
    try { return await task(); } catch (error) { onError(error); return undefined; } finally { if (label) setBusy(""); }
  }, [onError]);
  const setTool = useCallback((next: Tool) => { setToolState(next); setSelectedObjects(new Set()); setEditingText(null); if (next.kind !== "edit") setSourceSelection(null); }, []);
  function saveReadingPosition() {
    const current = readingState.current;
    if (!current.path || current.home || !viewer.current || restoringReading.current) return;
    const all = stored<Record<string, { page: number; top: number; at: number }>>("gcp.last-page", {});
    all[current.path.toLowerCase()] = { page: current.page, top: viewer.current.readingTop(), at: Date.now() };
    store("gcp.last-page", Object.fromEntries(Object.entries(all).sort((x, y) => y[1].at - x[1].at).slice(0, 300)));
  }
  function scheduleReadingSave() { clearTimeout(readingSaveTimer.current); readingSaveTimer.current = setTimeout(saveReadingPosition, 300); }
  async function goHome() { if (!(await commitPendingParagraph())) return; saveReadingPosition(); setHome(true); setReading(false); setSideOpen(false); setTool({ kind: "select" }); }
  async function resumeDocument(id: string) { if (!(await commitPendingParagraph())) return; saveReadingPosition(); setHome(false); void perform(() => window.gcp.activateDocument(id)); }
  async function openFilesFromHome(paths?: string[]) {
    if (!(await commitPendingParagraph())) return;
    saveReadingPosition();
    await window.gcp.openFiles(paths);
    const state = await window.gcp.getWorkspace();
    setWorkspace(state);
    if (state.documents.length) setHome(false);
  }
  useEffect(() => { if (tool.kind === "edit") setTab("Editar"); }, [tool.kind]);
  useEffect(() => {
    if (!window.gcp) { setReady(true); notify("A ponte desktop não está disponível. Abra o GCP-PDF pelo aplicativo.", true); return; }
    window.gcp.getWorkspace().then((state) => { setWorkspace(state); setReady(true); }).catch(onError);
    const off = window.gcp.onWorkspace((state) => setWorkspace(state));
    const offPrompt = window.gcp.onPrompt((prompt) => setPrompts((list) => [...list, prompt]));
    void window.gcp.getSignatures().then(setSignatures).catch(onError);
    void window.gcp.listFonts().then(setFonts).catch(() => {});
    return () => { off(); offPrompt(); };
  }, []);
  useEffect(() => { document.documentElement.dataset.theme = workspace.theme; }, [workspace.theme]);
  useEffect(() => { releaseBases(new Set(workspace.documents.flatMap((doc) => doc.pages.map((ref) => ref.base)))); }, [workspace]);
  useEffect(() => { store("gcp.style", style); }, [style]);
  // Where each file was left (page and position), so reopening continues the reading.
  const lastSeen = (path?: string) => (path ? (stored<Record<string, { page: number; top: number; at: number }>>("gcp.last-page", {})[path.toLowerCase()] ?? null) : null);
  useEffect(() => {
    const resume = lastSeen(active?.path), start = resume && active && resume.page < active.pageCount ? resume.page : 0;
    setPage(start); setSelection(new Set([start])); setTool({ kind: "select" }); setMatches([]); setActiveSearch(""); setConversation([]);
    setHome(false);
    setSideOpen(!!active); if (active) setPanel((p) => (p === "ai" ? p : "pages"));
  }, [active?.id]);
  useEffect(() => {
    if (!active || showHome) { restoringReading.current = false; return; }
    const resume = lastSeen(active.path), start = resume && Number.isInteger(resume.page) && resume.page >= 0 && resume.page < active.pageCount ? resume.page : 0;
    const top = resume && Number.isFinite(resume.top) ? Math.max(0, resume.top) : 0;
    let timer: ReturnType<typeof setTimeout> | undefined, canceled = false, tries = 0;
    restoringReading.current = true;
    const restore = () => {
      if (canceled) return;
      const node = document.querySelector(`.viewer-host .page-sheet[data-page="${start + 1}"]`);
      if (viewer.current && node) {
        viewer.current.scrollToPage(start, top);
        if (!node.classList.contains("loading") || tries >= 40) {
          restoringReading.current = false;
          if (resume && (start > 0 || top > 0)) notify(`Continuando da página ${start + 1}, onde você parou.`);
          scheduleReadingSave();
          return;
        }
      }
      if (tries++ < 40) timer = setTimeout(restore, 100);
      else restoringReading.current = false;
    };
    timer = setTimeout(restore, 60);
    return () => { canceled = true; clearTimeout(timer); restoringReading.current = false; };
  }, [active?.id, showHome]);
  useEffect(() => { if (!showHome) scheduleReadingSave(); return () => clearTimeout(readingSaveTimer.current); }, [page, active?.path, showHome]);
  useEffect(() => {
    const flush = () => saveReadingPosition();
    window.addEventListener("beforeunload", flush);
    return () => { window.removeEventListener("beforeunload", flush); clearTimeout(readingSaveTimer.current); };
  }, []);
  useEffect(() => {
    if (!active) return;
    setPage((p) => Math.max(0, Math.min(p, active.pageCount - 1)));
    setSelection((old) => new Set([...old].filter((p) => p < active.pageCount)));
    const ids = new Set(active.objects.map((o) => o.id));
    setSelectedObjects((old) => { const next = new Set([...old].filter((id) => ids.has(id))); return next.size === old.size ? old : next; });
  }, [active?.revision]);
  // The search box in the logo bar keeps the focus while it opens the Pesquisar panel.
  useEffect(() => { if (panel === "search" && !document.activeElement?.closest(".title-search")) searchRef.current?.focus(); }, [panel]);

  const operation = useCallback((op: PdfOperation, label = "") => {
    if (!active) return Promise.resolve(undefined);
    return perform(() => window.gcp.applyOperation(active.id, op, active.revision), label);
  }, [active?.id, active?.revision, perform]);
  const selectedPages = [...selection].sort((a, b) => a - b), docDirty = !!active && active.revision !== active.savedRevision;
  const selectionObjects = useMemo(() => (active ? active.objects.filter((o) => selectedObjects.has(o.id)) : []), [active, selectedObjects]);
  // Dismissal belongs only to the current resource, never to other tools or documents.
  const propertiesResource = propertiesContext({ tool, selection: selectionObjects, source: sourceSelection });
  const propertiesKey = active && propertiesResource ? JSON.stringify([active.id, tab, propertiesResource]) : null;
  const propertiesAvailable = !showHome && !!active && !reading && !modal && !imageEdit && !fieldProps && tab !== "Organizar" && propertiesKey !== null;
  const [closedPropertiesKey, setClosedPropertiesKey] = useState<string | null>(null);
  const propertiesClosed = propertiesKey !== null && closedPropertiesKey === propertiesKey;
  useEffect(() => { setClosedPropertiesKey(null); }, [propertiesKey]);
  // A tab dragged from this window below the tab row opens in its own window.
  const draggingTab = useRef<string | null>(null), [tabDetachHint, setTabDetachHint] = useState(false);
  useEffect(() => {
    const o = selectionObjects.length === 1 ? selectionObjects[0]! : null;
    if (o?.kind === "text") setStyle((s) => ({ ...s, font: o.font, size: o.size, textColor: o.color, bold: o.bold, italic: o.italic, align: o.align }));
    else if (o?.kind === "shape" || o?.kind === "ink") setStyle((s) => ({ ...s, stroke: o.stroke, strokeWidth: o.strokeWidth, opacity: o.opacity, ...(o.kind === "shape" ? { fill: o.fill } : {}) }));
  }, [selectionObjects.map((o) => o.id).join()]);
  function rotate(degrees: number, pages = selectedPages.length ? selectedPages : [page]) { void operation({ type: "rotate", pages, degrees }); }
  const zoomBy = useCallback((factor: number) => setZoom((z) => Math.max(0.25, Math.min(5, Math.round(z * factor * 100) / 100))), []);
  function choosePage(index: number, event?: React.MouseEvent, scroll = true) {
    setPage(index);
    if (scroll) viewer.current?.scrollToPage(index);
    setSelection((old) => {
      if (event?.shiftKey) { const start = Math.min(page, index), end = Math.max(page, index); return new Set(Array.from({ length: end - start + 1 }, (_, i) => start + i)); }
      if (event?.ctrlKey || event?.metaKey) { const next = new Set(old); next.has(index) ? next.delete(index) : next.add(index); return next; }
      return new Set([index]);
    });
  }
  function deleteObjects(ids = [...selectedObjects]) { if (!ids.length) return; setSelectedObjects(new Set()); void operation({ type: "delete-objects", ids }); }
  function showPanel(next: Panel) { if (active) setHome(false); setPanel(next); setSideOpen(true); }
  async function exportDocument(options: ExportOptions) {
    if (!active) return;
    const beforeNotice = noticeSequence.current;
    try { const path = await window.gcp.exportDocument(active.id, options); if (path) { if (noticeSequence.current === beforeNotice) notify("Arquivo exportado com sucesso."); setModal(null); } } finally { setBusy(""); }
  }
  function openImageEditor(id: string) {
    const object = active?.objects.find((o) => o.id === id);
    if (object?.kind !== "image") return;
    void perform(async () => setImageEdit({ id, src: await loadAsset(object.asset) }));
  }
  /** Replaces an image with its edited version, keeping its place and width. */
  function applyImageEdit(id: string, dataUrl: string, aspect: number) {
    const object = active?.objects.find((o) => o.id === id);
    if (!active || object?.kind !== "image") return;
    const next = { ...object, id: uid(), asset: "", height: object.width / aspect };
    void perform(async () => {
      await window.gcp.applyOperation(active.id, { type: "add-object", object: next, dataUrl } as PdfOperation, active.revision);
      const fresh = (await window.gcp.getWorkspace()).documents.find((d) => d.id === active.id);
      if (fresh) await window.gcp.applyOperation(active.id, { type: "delete-objects", ids: [id] } as PdfOperation, fresh.revision);
      setSelectedObjects(new Set([next.id]));
    }, "Aplicando a imagem editada…");
  }
  /** Ctrl+V with an image or text on the clipboard places it on the current page, like Acrobat. */
  async function pasteClipboard(data: DataTransfer) {
    if (!active) return false;
    const ref = active.pages[page] ?? active.pages[0]!, geo = pageGeometry(ref) ?? { width: 595.28, height: 841.89, rotation: 0 };
    const turned = ((geo.rotation + ref.rotate) % 180) !== 0, size = turned ? { width: geo.height, height: geo.width } : { width: geo.width, height: geo.height };
    const file = [...data.items].find((item) => item.kind === "file" && item.type.startsWith("image/"))?.getAsFile();
    if (file) {
      const dataUrl = await new Promise<string>((ok, fail) => { const reader = new FileReader(); reader.onload = () => ok(String(reader.result)); reader.onerror = () => fail(reader.error); reader.readAsDataURL(file); });
      const image = new Image(); image.src = dataUrl; await image.decode();
      const width = Math.min(image.naturalWidth * 0.75, size.width * 0.6), height = (width * image.naturalHeight) / image.naturalWidth;
      const object: PageObject = { id: uid(), page: ref.id, kind: "image", x: (size.width - width) / 2, y: Math.max(20, (size.height - height) / 2), width, height, asset: "", rotation: 0 };
      await perform(() => window.gcp.applyOperation(active.id, { type: "add-object", object, dataUrl } as PdfOperation, active.revision), "Colando imagem…");
      setToolState({ kind: "select" }); setSelectedObjects(new Set([object.id]));
      return true;
    }
    const text = data.getData("text/plain").trim();
    if (text && text.length < 20000) {
      const object: PageObject = { id: uid(), page: ref.id, kind: "text", x: 60, y: size.height / 3, width: Math.min(420, size.width - 120), height: style.size * 1.3 * Math.max(1, text.split("\n").length), text, size: style.size, color: style.textColor, font: style.font, bold: style.bold, italic: style.italic, align: style.align, rotation: 0 };
      await perform(() => window.gcp.applyOperation(active.id, { type: "add-object", object } as PdfOperation, active.revision));
      setToolState({ kind: "select" }); setSelectedObjects(new Set([object.id]));
      return true;
    }
    return false;
  }
  const pasteRef = useRef(pasteClipboard);
  pasteRef.current = pasteClipboard;
  useEffect(() => {
    const onPaste = (event: ClipboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (!event.clipboardData || target?.closest("input, textarea, select, [contenteditable=true], [contenteditable=''], .modal, .thumbnails-scroll, .organize-grid")) return;
      const data = event.clipboardData;
      if ([...data.items].some((item) => item.kind === "file" && item.type.startsWith("image/")) || data.getData("text/plain").trim()) { event.preventDefault(); void pasteRef.current(data); }
    };
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
  }, []);
  async function chooseImage() {
    await perform(async () => { const img = await window.gcp.chooseImage(); if (img) setTool({ kind: "stamp", dataUrl: img.dataUrl, name: img.name, signature: false }); });
  }
  const actions: RibbonActions = {
    home: goHome,
    open: () => void perform(() => openFilesFromHome(), "Abrindo arquivos…"),
    saveAs: () => active && void perform(() => window.gcp.saveDocument(active.id, true), "Salvando cópia…"),
    save: () => active && void perform(() => window.gcp.saveDocument(active.id), "Salvando…"),
    print: () => active && setModal("print"),
    undo: () => active && void perform(() => window.gcp.undo(active.id)),
    redo: () => active && void perform(() => window.gcp.redo(active.id)),
    zoom: zoomBy,
    zoomTo: (value) => {
      if (typeof value === "number") { setZoom(value); return; }
      const fitted = value === "width" ? viewer.current?.fitWidth() : viewer.current?.fitPage();
      if (fitted) setZoom(fitted);
    },
    fit: () => { const fitted = viewer.current?.fitWidth(); if (fitted) setZoom(fitted); },
    rotate: (degrees) => rotate(degrees),
    blank: () => void operation({ type: "blank", index: page + 1 }),
    deletePages: () => active && selectedPages.length < active.pageCount && void operation({ type: "delete", pages: selectedPages }),
    combineOpen: () => { setCombineIds(workspace.documents.map((d) => d.id)); if (workspace.documents.length > 1) setModal("combine"); else void perform(() => window.gcp.openQuick("combine")); },
    quick: (kind) => void perform(() => window.gcp.openQuick(kind)),
    compare: () => active && void perform(() => window.gcp.detachDocument(active.id)),
    exportAs: (format) => { setExportFormat(format); setModal("export"); },
    ocr: () => active && void perform(() => window.gcp.runOcr(active.id, selectedPages.length > 1 ? selectedPages : undefined), "Reconhecendo texto…"),
    // Like Acrobat: the tool waits for a click on the page to drop the note there; the panel lists the threads.
    comment: () => { showPanel("comments"); setTool(tool.kind === "note" ? { kind: "select" } : { kind: "note" }); },
    find: () => showPanel("search"),
    ai: () => showPanel("ai"),
    signatures: () => { setTab("Assinar"); showPanel("signatures"); },
    image: () => void chooseImage(),
    fiscalXml: () => void perform(() => window.gcp.openFiscalXml(), "Gerando o documento fiscal…"),
    ribbon: (value) => setRibbon(value),
    layout: (value) => { setLayout(value); store("gcp.layout", value); setTimeout(() => { const fit = viewer.current?.fitWidth(); if (fit && value !== "single") setZoom(Math.min(fit, zoom)); }, 50); },
    filter: (value) => { setReadingFilter(value); store("gcp.filter", value); },
    reading: () => startReading(),
    fullscreen: () => toggleFullscreen(),
    sidebar: () => setSideOpen((open) => !open),
    theme: () => void perform(() => window.gcp.setTheme(workspace.theme === "light" ? "dark" : "light")),
    compareFiles: () => { if (active) { setCompareFirst(active.id); setModal("compare"); } },
    stats: () => setModal("stats"),
    properties: () => setModal("properties"),
    editImage: () => { const id = [...selectedObjects][0]; if (id) openImageEditor(id); },
    deleteObjects: () => deleteObjects(),
    compress: () => active && setModal("compress"),
    detectFields: () => active && void perform(async () => { const n = await window.gcp.detectFormFields(active.id); notify(n ? `${n} campo${n > 1 ? "s" : ""} de formulário criado${n > 1 ? "s" : ""}. Use Selecionar para preencher.` : "Nenhum campo em branco foi encontrado."); }, "Reconhecendo formulário…"),
    exportData: (format) => active && void perform(async () => { const path = await window.gcp.exportFormData(active.id, format); if (path) notify("Dados do formulário exportados."); }),
    protect: () => active && setModal("protect"),
    removeHidden: () => active && void perform(async () => { await window.gcp.removeHiddenData(active.id, []); notify("Dados ocultos removidos. Salve para gravar o documento limpo."); }, "Removendo dados ocultos…"),
    // Visible signature: choose the certificate, then place the real-size stamp on the page, then sign.
    certificate: (visible) => { setSignArea(null); setSignVisible(!!visible); setModal("certificate"); },
    checkSignatures: () => active && setModal("signatures-check"),
    palette: () => setModal("palette"),
    stamps: () => active && setModal("stamps"),
    numbering: () => active && setModal("numbering"),
    restyle: (patch) => {
      setStyle((s) => ({ ...s, ...patch }));
      if (active && selectionObjects.length) for (const o of selectionObjects) { const next = restyled(o, patch); if (next !== o) void operation({ type: "update-object", object: next }); }
    },
    formatParagraph: (patch) => {
      if (!active || !sourceSelection) return;
      const target = sourceSelection, text = pendingParagraphText();
      setSourceSelection(null);
      void perform(() => window.gcp.editParagraph(active.id, target.page, { paragraph: target.paragraph.index, ...(text !== undefined ? { text } : {}), ...patch }), "Aplicando formatação…");
    },
  };
  const organize: OrganizeActions = {
    rotate: (degrees, pages) => rotate(degrees, pages),
    remove: (pages) => { if (active && pages.length < active.pageCount) { setSelection(new Set()); void operation({ type: "delete", pages }); } },
    blank: (index) => void operation({ type: "blank", index }),
    insertFile: (index) => active && void perform(() => window.gcp.insertFromFile(active.id, index, active.revision)),
    move: (pages, index) => active && void perform(() => window.gcp.transferPages({ sourceId: active.id, targetId: active.id, pages, index, move: true, sourceRevision: active.revision, targetRevision: active.revision })),
    extract: (mode) => active && void perform(async () => { const path = await window.gcp.extractPages(active.id, selectedPages, mode); if (path) notify(mode === "files" ? `Páginas salvas em ${path}` : "Páginas extraídas."); }, "Extraindo páginas…"),
    replace: () => active && void perform(() => window.gcp.replacePages(active.id, selectedPages, active.revision)),
    split: () => setModal("split"),
    numbering: () => setModal("numbering"),
    compress: () => setModal("compress"),
    close: () => setTab("Início"),
  };
  const none = !active || showHome;
  const tabTool = (target: Tab, run: () => void) => () => { setTab(target); run(); };
  // The Editar tab is the editing mode, like Acrobat/PDFelement: entering it edits the page directly, leaving it ends editing.
  const openTab = async (label: Tab) => {
    if (label !== "Editar" && !(await commitPendingParagraph())) return;
    if (active) setHome(false);
    setTab(label);
    if (label !== tab) setTool(label === "Editar" && active ? { kind: "edit" } : { kind: "select" });
    else if (label === "Editar" && active && tool.kind === "select") setTool({ kind: "edit" });
  };
  const commands: Command[] = [
    { id: "open", label: "Abrir arquivos", group: "Arquivo", shortcut: "Ctrl+O", keywords: "carregar documento", run: actions.open },
    { id: "save-as", label: "Salvar como", group: "Arquivo", shortcut: "Ctrl+Shift+S", disabled: none, run: actions.saveAs },
    { id: "save", label: "Salvar", group: "Arquivo", shortcut: "Ctrl+S", disabled: none, run: actions.save },
    { id: "print", label: "Imprimir", group: "Arquivo", shortcut: "Ctrl+P", disabled: none, run: actions.print },
    { id: "new", label: "Novo PDF em branco", group: "Arquivo", run: () => void perform(() => window.gcp.newDocument()) },
    { id: "edit-all", label: "Editar texto e imagens originais", group: "Editar", keywords: "editar tudo corrigir alterar texto", disabled: none, help: "Clique nos blocos do PDF e edite direto na página.", run: tabTool("Editar", () => setTool({ kind: "edit" })) },
    { id: "add-text", label: "Adicionar caixa de texto", group: "Editar", keywords: "escrever digitar", disabled: none, run: () => setTool({ kind: "text" }) },
    { id: "image", label: "Inserir imagem", group: "Editar", keywords: "foto logo carimbo", disabled: none, run: actions.image },
    { id: "shapes", label: "Desenhar formas (retângulo, seta, nuvem…)", group: "Comentário", keywords: "forma linha circulo oval", disabled: none, run: () => setTool({ kind: "shape", shape: "rect" }) },
    { id: "highlight", label: "Destacar texto", group: "Comentário", keywords: "marca texto amarelo grifar", disabled: none, run: () => setTool({ kind: "markup", style: "highlight" }) },
    { id: "underline", label: "Sublinhar texto", group: "Comentário", disabled: none, run: () => setTool({ kind: "markup", style: "underline" }) },
    { id: "strike", label: "Tachar texto", group: "Comentário", keywords: "riscar", disabled: none, run: () => setTool({ kind: "markup", style: "strike" }) },
    { id: "ink", label: "Desenhar à mão livre", group: "Comentário", keywords: "lapis caneta", disabled: none, run: () => setTool({ kind: "ink" }) },
    { id: "organize", label: "Organizar páginas", group: "Organizar", keywords: "reordenar mover paginas miniaturas", disabled: none, run: () => setTab("Organizar") },
    { id: "rotate", label: "Girar páginas selecionadas", group: "Organizar", keywords: "rotacionar", disabled: none, run: () => rotate(90) },
    { id: "delete-pages", label: "Excluir páginas selecionadas", group: "Organizar", keywords: "apagar remover", disabled: none, run: actions.deletePages },
    { id: "extract", label: "Extrair páginas", group: "Organizar", keywords: "separar salvar paginas", disabled: none, run: () => organize.extract("file") },
    { id: "split", label: "Dividir documento", group: "Organizar", keywords: "partes separar", disabled: none, run: () => setModal("split") },
    { id: "number", label: "Numerar páginas / Bates", group: "Organizar", keywords: "numeracao rodape", disabled: none, run: () => setModal("numbering") },
    { id: "combine", label: "Combinar arquivos em um PDF", group: "Organizar", keywords: "juntar unir mesclar", run: () => actions.quick("combine") },
    { id: "fiscal-xml", label: "Abrir XML de nota fiscal (NF-e, NFC-e, NFS-e)", group: "Converter", keywords: "danfe danfse nfe nfce nfse cupom xml nota fiscal", run: () => actions.fiscalXml() },
    { id: "convert-files", label: "Converter arquivos para PDF", group: "Converter", keywords: "word imagem transformar", run: () => actions.quick("convert") },
    { id: "word", label: "Exportar para Word", group: "Converter", keywords: "docx", disabled: none, run: () => actions.exportAs("docx") },
    { id: "excel", label: "Exportar para Excel", group: "Converter", keywords: "xlsx planilha", disabled: none, run: () => actions.exportAs("xlsx") },
    { id: "ppt", label: "Exportar para PowerPoint", group: "Converter", keywords: "pptx slides", disabled: none, run: () => actions.exportAs("pptx") },
    { id: "image-pdf", label: "Exportar como PDF de imagens", group: "Converter", keywords: "achatar nao editavel", disabled: none, run: () => actions.exportAs("image-pdf") },
    { id: "compress", label: "Comprimir PDF (reduzir tamanho)", group: "Converter", keywords: "diminuir otimizar", disabled: none, run: actions.compress },
    { id: "ocr", label: "Reconhecer texto (OCR)", group: "Converter", keywords: "digitalizado escaneado", disabled: none, run: actions.ocr },
    { id: "signatures", label: "Minhas assinaturas", group: "Assinar", keywords: "rubrica", run: actions.signatures },
    { id: "stamps", label: "Carimbos (PAGO, CONTABILIZADO, Confere com o original…)", group: "Comentário", keywords: "carimbo selo convenio prestacao de contas aprovado recebido", disabled: none, run: actions.stamps },
    { id: "certificate", label: "Assinar com certificado digital (ICP-Brasil)", group: "Assinar", keywords: "a1 a3 token e-cpf e-cnpj", disabled: none, run: tabTool("Assinar", () => actions.certificate(true)) },
    { id: "check-signatures", label: "Verificar assinaturas digitais", group: "Assinar", keywords: "validar iti", disabled: none, run: actions.checkSignatures },
    { id: "form-text", label: "Criar campo de formulário", group: "Formulário", keywords: "campo texto caixa selecao", disabled: none, run: tabTool("Formulário", () => setTool({ kind: "field", field: "text" })) },
    { id: "form-detect", label: "Reconhecer formulário automaticamente", group: "Formulário", disabled: none, run: actions.detectFields },
    { id: "form-export", label: "Exportar dados do formulário (CSV)", group: "Formulário", disabled: none, run: () => actions.exportData("csv") },
    { id: "protect", label: "Proteger com senha", group: "Proteger", keywords: "criptografar senha bloquear", disabled: none, run: actions.protect },
    { id: "hidden", label: "Remover dados ocultos", group: "Proteger", keywords: "metadados limpar sanitizar", disabled: none, run: actions.removeHidden },
    { id: "reading", label: "Modo leitura (tela cheia sem distrações)", group: "Exibição", keywords: "ler apresentar foco tela cheia", disabled: none, run: () => startReading() },
    { id: "fullscreen", label: "Tela cheia", group: "Exibição", shortcut: "F11", run: () => toggleFullscreen() },
    { id: "two-pages", label: "Exibir duas páginas lado a lado", group: "Exibição", keywords: "dupla livro spread", disabled: none, run: () => actions.layout("double") },
    { id: "night", label: "Filtro noturno para leitura", group: "Exibição", keywords: "escuro sepia filtro olhos", disabled: none, run: () => actions.filter("night") },
    { id: "compare", label: "Comparar dois PDFs", group: "Revisar", keywords: "diferencas versoes alteracoes", disabled: none, run: () => actions.compareFiles() },
    { id: "stats", label: "Estatísticas do documento", group: "Revisar", keywords: "contar palavras caracteres paginas tamanho", disabled: none, run: () => setModal("stats") },
    { id: "properties", label: "Propriedades e metadados", group: "Revisar", keywords: "titulo autor assunto palavras-chave", disabled: none, run: () => setModal("properties") },
    { id: "find", label: "Pesquisar no documento", group: "Ver", shortcut: "Ctrl+F", disabled: none, run: actions.find },
    { id: "ai", label: "Perguntar à IA", group: "IA", keywords: "resumo chatgpt gemini", run: actions.ai },
    { id: "theme", label: "Alternar tema claro/escuro", group: "Ver", run: () => void perform(() => window.gcp.setTheme(workspace.theme === "light" ? "dark" : "light")) },
    { id: "settings", label: "Configurações", group: "Ver", keywords: "chave api preferencias", run: () => setModal("settings") },
    { id: "help", label: "Central de ajuda", group: "Ajuda", shortcut: "F1", run: () => { setHelpTopic(undefined); setModal("help"); } },
  ];
  const pageTools = {
    copy: (cut: boolean) => active && selectedPages.length && void perform(async () => { const n = await window.gcp.copyPages(active.id, selectedPages, cut, active.revision); notify(`${n} página${n > 1 ? "s" : ""} ${cut ? "recortada" : "copiada"}${n > 1 ? "s" : ""}. Cole em qualquer janela com Ctrl+V.`); }),
    paste: (after: boolean) => active && void perform(async () => { const index = after ? (selectedPages.at(-1) ?? page) + 1 : (selectedPages[0] ?? page); const n = await window.gcp.pastePages(active.id, index, active.revision); notify(`${n} página${n > 1 ? "s coladas" : " colada"}.`); }),
  };
  const noticeSequence = useRef(0), menuAction = useRef<(action: string) => void>(() => {});
  menuAction.current = (action: string) => {
    if (action.startsWith("notice:")) { noticeSequence.current += 1; notify(action.slice(7)); return; }
    if (action.startsWith("progress:")) { setBusy(action.slice(9)); return; }
    if (action === "update-available") { void window.gcp.pendingUpdate().then((info) => info && setUpdate(info)); return; }
    if (action.startsWith("error:")) { notify(action.slice(6), true); return; }
    switch (action) {
      case "open": actions.open(); break;
      case "new": void perform(() => window.gcp.newDocument()); break;
      case "new-window": void perform(() => window.gcp.newWindow()); break;
      case "save": actions.save(); break;
      case "save-as": actions.saveAs(); break;
      case "print": actions.print(); break;
      case "export": if (active) actions.exportAs(); break;
      case "settings": setModal("settings"); break;
      case "support": setModal("support"); break;
      case "undo": actions.undo(); break;
      case "redo": actions.redo(); break;
      case "close-tab": if (active) void perform(() => window.gcp.closeDocument(active.id)); break;
      case "find": showPanel("search"); break;
    }
  };
  const shortcutAction=useRef((id:string)=>{});
  shortcutAction.current=id=>{if(id==='properties')actions.properties();else if(id==='reading')startReading();else if(id==='fullscreen')toggleFullscreen();else if(id==='delete-pages')actions.deletePages();else if(id==='rotate')rotate(90);else if(id==='palette')setModal('palette');else if(id==='help')setModal('help');else if(id==='zoom-in')zoomBy(1.15);else if(id==='zoom-out')zoomBy(1/1.15);else if(id==='zoom-reset')setZoom(1);else menuAction.current(id);};
  useEffect(() => window.gcp?.onAction((action) => menuAction.current(action)), []);
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      const typing = (event.target as HTMLElement)?.closest('input,textarea,select,[contenteditable="true"]');
      if (event.key === "Escape" && !typing) { dragEndInside.current = true; setReading(false);void window.gcp.setFullscreen(false);setTool({ kind: "select" }); return; }
      if ((event.key === "Delete" || event.key === "Backspace") && !typing && !(event.target as HTMLElement)?.closest(".thumbnails-scroll,.organize-grid") && selectedObjectsRef.current.size) { event.preventDefault(); deleteRef.current(); return; }
      if (event.key === "F11" && !typing) { event.preventDefault(); void window.gcp.setFullscreen(); return; }

      if(event.defaultPrevented)return;
      const mapped=resolveShortcut(event,readShortcuts());
      if(mapped&&(!typing||['save','save-as','open','find'].includes(mapped))){if(mapped==='delete-pages'&&!(event.target as HTMLElement)?.closest('.thumbnails-scroll,.organize-grid'))return;event.preventDefault();shortcutAction.current(mapped);return;}
      if (event.key === "F1" && event.ctrlKey) { event.preventDefault(); ribbonKey.current(); return; }


      if (!(event.ctrlKey || event.metaKey)) return;
      if (typing && !["s", "o", "f"].includes(event.key.toLowerCase())) return;
      const pagesFocused = (document.activeElement as HTMLElement | null)?.closest(".thumbnails-scroll, .organize-grid");
      if (pagesFocused && !typing && ["c", "x", "v"].includes(event.key.toLowerCase())) { event.preventDefault(); pageKeyRef.current(event.key.toLowerCase(), event.shiftKey); return; }
      const key = event.key.toLowerCase();
      const action = key === "o" ? "open" : key === "s" ? (event.shiftKey ? "save-as" : "save") : key === "p" ? "print" : key === "f" ? "find" : key === "w" ? "close-tab" : key === "n" ? (event.shiftKey ? "new-window" : "new") : key === "z" ? (event.shiftKey ? "redo" : "undo") : key === "y" ? "redo" : key === "=" || key === "+" ? "zoom-in" : key === "-" ? "zoom-out" : key === "0" ? "zoom-reset" : null;
      if (!action) return;
      if(SHORTCUT_COMMANDS.some(command=>command.id===action))return;
      event.preventDefault();
      if (action === "zoom-in") zoomBy(1.15); else if (action === "zoom-out") zoomBy(1 / 1.15); else if (action === "zoom-reset") setZoom(1); else menuAction.current(action);
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);
  const ribbonKey = useRef(() => {});
  ribbonKey.current = () => setRibbon(ribbonMode === "pinned" ? "collapsed" : "pinned");
  // The thumbnail list follows the page being read in the main view.
  useEffect(() => { document.querySelector<HTMLElement>(".thumbnails-scroll .thumbnail-item.current")?.scrollIntoView({ block: "nearest", behavior: "smooth" }); }, [page, sideOpen, panel]);
  const selectedObjectsRef = useRef(selectedObjects), deleteRef = useRef(() => deleteObjects()), pageKeyRef = useRef((_key: string, _shift: boolean) => {});
  pageKeyRef.current = (key, shift) => { if (key === "delete") actions.deletePages(); else if (key === "c") pageTools.copy(false); else if (key === "x") pageTools.copy(true); else pageTools.paste(!shift); };
  selectedObjectsRef.current = selectedObjects; deleteRef.current = () => deleteObjects();

  async function pageDrop(event: React.DragEvent, index: number) {
    event.preventDefault(); event.stopPropagation(); setDropIndex(null);
    const data = dragData(event);
    if (!active || !data?.sourceId || !Array.isArray(data.pages)) return;
    const copied = event.ctrlKey || event.altKey || event.metaKey;
    await perform(async () => {
      await window.gcp.transferPages({ sourceId: data.sourceId, targetId: active.id, pages: data.pages, index, move: !copied, sourceRevision: Number(data.sourceRevision), targetRevision: active.revision });
      if (data.sourceId !== active.id) notify(copied ? "Páginas copiadas." : "Páginas transferidas.");
    });
  }
  async function tabDropEvent(event: React.DragEvent, beforeId?:string) {
    event.preventDefault(); event.stopPropagation(); setTabDrop(false);
    const data = dragData(event);
    if(data?.documentId){dragEndInside.current=true;await perform(async()=>{if(data.sourceWindowId!==workspace.windowId)await window.gcp.attachDocument(data.documentId,data.sourceWindowId);await window.gcp.moveDocumentTab(data.documentId,beforeId);});}
  }
  function clearSearch() { setQuery(""); setActiveSearch(""); setMatches([]); setHit(0); }
  // Typing in the logo bar search opens Pesquisar and searches as you type; clearing it closes the panel it opened.
  const titleSearch = useRef(false), searchOpenedByTitle = useRef(false);
  function closeTitleSearch() { clearSearch(); if (searchOpenedByTitle.current) { searchOpenedByTitle.current = false; setSideOpen(false); } }
  useEffect(() => { if (!titleSearch.current || !query.trim() || !active) return; const timer = setTimeout(() => void findText(), 450); return () => clearTimeout(timer); }, [query]);
  async function findText() {
    if (!active || !query.trim()) return;
    setSearching(true);
    try {
      const found: { page: number; count: number }[] = [], needle = query.trim().toLocaleLowerCase("pt-BR");
      for (const [index, ref] of active.pages.entries()) {
        const content = await (await loadPage(ref)).getTextContent();
        // Counted per text item, the same unit the page highlights, so "3 de 27" matches what is shown.
        let count = 0;
        for (const item of content.items) { const text = ("str" in item ? item.str : "").toLocaleLowerCase("pt-BR"); for (let at = text.indexOf(needle); at >= 0; at = text.indexOf(needle, at + needle.length)) count++; }
        if (count) found.push({ page: index, count });
      }
      setMatches(found); setActiveSearch(query.trim()); setHit(0);
      if (found.length) choosePage(found[0]!.page); else notify("Nenhum resultado para esta pesquisa.");
    } catch (error) { onError(error); } finally { setSearching(false); }
  }
  async function ask(text?: string) {
    const asked = (text ?? question).trim();
    if (!active || !asked || aiBusy) return;
    setAiBusy(true); setQuestion("");
    try { const answer = await window.gcp.askAi(active.id, asked); setConversation((c) => [...c, { question: asked, answer }]); }
    catch (error) { setQuestion(asked); onError(error); } finally { setAiBusy(false); }
  }
  const totalHits = matches.reduce((sum, m) => sum + m.count, 0);
  const focus = (() => { let left = hit; for (const m of matches) { if (left < m.count) return { page: m.page, n: left }; left -= m.count; } return null; })();
  function goHit(next: number) {
    if (!totalHits) return;
    const value = (next + totalHits) % totalHits;
    setHit(value);
    let left = value;
    for (const m of matches) { if (left < m.count) { choosePage(m.page); break; } left -= m.count; }
  }
  function startResize(e: React.PointerEvent) {
    e.preventDefault();
    const start = e.clientX, from = widths[panel] ?? 260, key = panel;
    setResizing(true);
    const move = (ev: PointerEvent) => setWidths((w) => ({ ...w, [key]: Math.max(200, Math.min(window.innerWidth * 0.6, from + ev.clientX - start)) }));
    const up = () => { setResizing(false); window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", up); setWidths((w) => { store("gcp.panel-widths", w); return w; }); };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  }
  const panelWidth = widths[panel] ?? 260, aiWide = panel === "ai" && panelWidth > 560;
  const isFileDrag = (e: React.DragEvent) => e.dataTransfer.types.includes("Files") && !e.dataTransfer.types.includes(PAGE_MIME) && !e.dataTransfer.types.includes(TAB_MIME);
  function dropFiles(e: React.DragEvent, mode: "open" | "before" | "after") {
    e.preventDefault(); e.stopPropagation(); fileDragDepth.current = 0; setFileDrag(false);
    const paths = window.gcp.pathsForFiles([...e.dataTransfer.files]);
    if (!paths.length) return;
    if (mode === "open" || !active) void perform(() => window.gcp.openFiles(paths));
    else void perform(() => window.gcp.insertPaths(active.id, mode === "before" ? page : page + 1, paths, active.revision));
  }
  return (
    <div
      className={`application ${resizing ? "resizing" : ""} ${reading ? "reading" : ""} ribbon-${ribbonMode}`}
      onDragEnter={(e) => { if (isFileDrag(e)) { fileDragDepth.current++; setFileDrag(true); } }}
      onDragLeave={(e) => { if (isFileDrag(e) && --fileDragDepth.current <= 0) { fileDragDepth.current = 0; setFileDrag(false); } }}
      onDragOver={(e) => {
        if (isFileDrag(e)) { e.preventDefault(); e.dataTransfer.dropEffect = "copy"; return; }
        if (draggingTab.current && e.dataTransfer.types.includes(TAB_MIME) && !(e.target as HTMLElement).closest(".document-tabs-row")) { e.preventDefault(); e.dataTransfer.dropEffect = "move"; setTabDetachHint(true); }
        else if (tabDetachHint) setTabDetachHint(false);
      }}
      onDrop={(e) => {
        if (isFileDrag(e)) { dropFiles(e, "open"); return; }
        const id = draggingTab.current;
        if (id && e.dataTransfer.types.includes(TAB_MIME) && !(e.target as HTMLElement).closest(".document-tabs-row")) { e.preventDefault(); dragEndInside.current = true; setTabDetachHint(false); void perform(() => window.gcp.detachDocument(id)); }
      }}
    >
      {tabDetachHint && <div className="tab-detach-hint"><MoveUpRight size={26} /><strong>{translateUi("Solte para abrir em uma nova janela")}</strong><span>{translateUi("Volte para a barra de abas para apenas reorganizar")}</span></div>}
      {busy && <ProgressCard text={busy} />}
      {reading && active && (
        <div className="reading-bar" role="toolbar" aria-label={translateUi("Modo leitura")}>
          <span>{translateUi("Página")}{" "}{page + 1}{" "}{translateUi("de")}{" "}{active.pageCount}</span>
          <button title={translateUi("Página anterior")} onClick={() => choosePage(Math.max(0, page - (layout === "single" ? 1 : 2)))}><ChevronLeft size={15} /></button>
          <button title={translateUi("Próxima página")} onClick={() => choosePage(Math.min(active.pageCount - 1, page + (layout === "single" ? 1 : 2)))}><ChevronRight size={15} /></button>
          <button title={translateUi("Alternar uma/duas páginas")} onClick={() => actions.layout(layout === "single" ? "double" : "single")}>{layout === "single" ? translateUi("Duas páginas") : translateUi("Uma página")}</button>
          <button title={translateUi("Filtro de leitura")} onClick={() => actions.filter(({ none: "sepia", sepia: "warm", warm: "night", night: "gray", gray: "contrast", contrast: "none" } as const)[readingFilter])}>{translateUi("Filtro:")}{" "}{({ none: "Normal", sepia: "Sépia", warm: "Papel", night: "Noturno", gray: "Cinza", contrast: "Contraste" } as const)[readingFilter]}</button>
          <button className="exit" onClick={stopReading}><X size={14} />{" "}{translateUi("Sair do modo leitura")}</button>
        </div>
      )}
      {fileDrag && (
        <div className="file-drop">
          <div className={`file-drop-zones ${active ? "" : "single"}`}>
            <div className="file-drop-zone" onDragOver={(e) => e.preventDefault()} onDrop={(e) => dropFiles(e, "open")}><FolderOpen size={30} /><strong>{translateUi("Abrir em nova aba")}</strong><span>{translateUi("Cada arquivo abre separado")}</span></div>
            {active && (
              <>
                <div className="file-drop-zone" onDragOver={(e) => e.preventDefault()} onDrop={(e) => dropFiles(e, "before")}><FilePlus2 size={30} /><strong>{translateUi("Inserir antes da página")}{" "}{page + 1}</strong><span>{translateUi("em “")}{active.name}”</span></div>
                <div className="file-drop-zone" onDragOver={(e) => e.preventDefault()} onDrop={(e) => dropFiles(e, "after")}><FilePlus2 size={30} /><strong>{translateUi("Inserir depois da página")}{" "}{page + 1}</strong><span>{translateUi("em “")}{active.name}”</span></div>
              </>
            )}
          </div>
          <p>{translateUi("Solte sobre a opção desejada · PDF, imagens e documentos do Office")}</p>
        </div>
      )}
      {ribbonMode === "auto" && !reading && <div className="chrome-hotzone" onMouseEnter={() => setPeek(true)} />}
      <div className={`chrome ${peek ? "peek" : ""}`} onMouseLeave={() => { if (ribbonMode === "auto") setPeek(false); }}>
      <header className="titlebar">
        <button className="brand-title" title={translateUi("Página inicial")} aria-label={translateUi("Ir para a página inicial")} onClick={goHome}>
          <img className="brand-icon" src={appIconUrl} alt="" width={34} height={34} />
          <span>{translateUi("GCP")}<span className="brand-divider">/</span>{translateUi("PDF")}</span>
          <span className="brand-edition">{translateUi("LOCAL")}</span>
        </button>
        <div className="titlebar-spacer" />
        {!showHome && active && (
          <div className="title-document" title={active.path || active.name}>
            {docDirty ? <span className="unsaved-label">{translateUi("Não salvo")}</span> : <span className="saved-label"><Check size={12} />{" "}{translateUi("Salvo")}</span>}
            <div className="viewer-controls">
              <IconButton title={translateUi("Página anterior")} disabled={page <= 0} onClick={() => choosePage(page - 1)}><ChevronLeft size={16} /></IconButton>
              <label className="page-input">
                <input aria-label={translateUi("Número da página")} key={page} defaultValue={page + 1} onKeyDown={(e) => { if (e.key === "Enter") { const n = Number((e.target as HTMLInputElement).value); if (n >= 1 && n <= active.pageCount) choosePage(n - 1); } }} />
                <span>/ {active.pageCount}</span>
              </label>
              <IconButton title={translateUi("Próxima página")} disabled={page >= active.pageCount - 1} onClick={() => choosePage(page + 1)}><ChevronRight size={16} /></IconButton>
            </div>
          </div>
        )}
        <div className="title-search search-box">
          <Search size={14} />
          <input aria-label={translateUi("Pesquisar no PDF")} placeholder={translateUi("Pesquisar no PDF")} value={query} disabled={showHome || !active}
            onFocus={() => { titleSearch.current = true; }} onBlur={() => { titleSearch.current = false; }}
            onChange={(e) => { const value = e.target.value; setQuery(value); if (!value.trim()) { closeTitleSearch(); return; } if (!(sideOpen && panel === "search")) { searchOpenedByTitle.current = true; showPanel("search"); } }}
            onKeyDown={(e) => { if (e.key === "Escape") { e.stopPropagation(); closeTitleSearch(); e.currentTarget.blur(); return; } if (e.key === "Enter") { if (activeSearch === query.trim() && totalHits) goHit(hit + (e.shiftKey ? -1 : 1)); else void findText(); } }} />
          {query && <button className="search-clear" title={translateUi("Limpar busca e destaques · Esc")} aria-label={translateUi("Limpar busca e destaques · Esc")} onClick={closeTitleSearch}><X size={14} /></button>}
        </div>
        <button className="tool-finder" onClick={() => setModal("palette")}><Search size={14} />{" "}{translateUi("Localizar ferramentas")}{" "}<kbd>{translateUi("Ctrl+K")}</kbd></button>
        <button className="publisher-link" onClick={() => void window.gcp.openExternal(SITE)}>{translateUi("Gestão Cultural Pro")}{" "}<ArrowUpRight size={12} /></button>
        <div className="window-actions">

          <IconButton title={workspace.theme === "light" ? translateUi("Ativar tema escuro") : translateUi("Ativar tema claro")} onClick={() => void perform(() => window.gcp.setTheme(workspace.theme === "light" ? "dark" : "light"))}>{workspace.theme === "light" ? <Moon size={17} /> : <Sun size={17} />}</IconButton>
          <IconButton title={translateUi("Central de ajuda · F1")} onClick={() => { setHelpTopic(undefined); setModal("help"); }}><HelpCircle size={17} /></IconButton>
          <IconButton title={translateUi("Configurações")} onClick={() => setModal("settings")}><Settings size={17} /></IconButton>
        </div>
      </header>
      <div className="menu-row">
        <div className="ribbon-tabs">
          {TABS.map((label) => (
            <button className={tab === label ? "active" : ""} key={translateUi(label)} onDoubleClick={() => setRibbon(ribbonMode === "pinned" ? "collapsed" : "pinned")} onClick={() => { openTab(label); if (ribbonMode !== "pinned") setPeek(true); if (label === "Comentário") showPanel("comments"); if (label === "Assinar") showPanel("signatures"); if (label === "IA") showPanel("ai"); if (label === "Organizar") showPanel("pages"); }}>
              {label === "IA" && <Sparkles size={14} />} {translateUi(label)}
            </button>
          ))}
        </div>
        <div className="toolbar-spacer" />
        <RibbonModeMenu mode={ribbonMode} onMode={setRibbon} />
      </div>
      <div className="ribbon-panel" onClick={(e) => { if (ribbonMode === "collapsed" && (e.target as HTMLElement).closest(".tool-button")) setPeek(false); }}>
        <Ribbon tab={tab} hasDocument={!showHome && !!active} canUndo={!!active?.canUndo} canRedo={!!active?.canRedo} tool={tool} setTool={setTool} style={style} selection={selectionObjects} source={sourceSelection} pagesSelected={selectedPages.length} zoom={zoom} fonts={fonts} labels={labels} actions={actions} ribbonMode={ribbonMode} layout={layout} filter={readingFilter} dark={workspace.theme === "dark"} />
      </div>
      </div>
      {/* Abas dos documentos abertos, abaixo da faixa de opções e logo acima do documento. */}
      <div className="document-tabs-row">
        <div className={`document-tabs ${tabDrop ? "drop-target" : ""}`} onDragOver={(e) => { if (e.dataTransfer.types.includes(TAB_MIME)) { e.preventDefault(); setTabDrop(true); } }} onDragLeave={() => setTabDrop(false)} onDrop={e=>void tabDropEvent(e)}>
          {workspace.documents.map((doc) => (
            <div
              key={doc.id}
              className={`document-tab ${!showHome && active?.id === doc.id ? "active" : ""}`}
              role="tab" aria-selected={!showHome && active?.id === doc.id}
              draggable
              onDragOver={e=>{if(e.dataTransfer.types.includes(TAB_MIME)){e.preventDefault();e.stopPropagation();e.dataTransfer.dropEffect="move";}}}
              onDrop={e=>{if(!e.dataTransfer.types.includes(TAB_MIME))return;const r=e.currentTarget.getBoundingClientRect(),index=workspace.documents.findIndex(d=>d.id===doc.id),before=e.clientX<r.left+r.width/2?doc.id:workspace.documents[index+1]?.id;void tabDropEvent(e,before);}}
              onDragStart={(e) => { dragEndInside.current = false; draggingTab.current = doc.id; const payload = JSON.stringify({ documentId: doc.id, sourceWindowId: workspace.windowId }); e.dataTransfer.setData(TAB_MIME, payload); e.dataTransfer.setData("text/plain", payload); e.dataTransfer.effectAllowed = "move"; }}
              onDragEnd={(e) => { draggingTab.current = null; setTabDetachHint(false); if (e.dataTransfer.dropEffect === "none" && !dragEndInside.current) void perform(() => window.gcp.detachDocument(doc.id)); }}
              onClick={() => resumeDocument(doc.id)}
              onDragEnter={(e) => { if (e.dataTransfer.types.includes(PAGE_MIME) && active?.id !== doc.id) { clearTimeout(tabHover.current); tabHover.current = setTimeout(() => resumeDocument(doc.id), 550); } }}
              onDragLeave={() => clearTimeout(tabHover.current)}
              title={`${doc.name}${doc.path?"\n"+doc.path:""}\n${translateUi("Arraste para reorganizar as abas, para baixo para abrir em nova janela ou para outra janela.")}`}
            >
              <FileText size={15} />
              <span>{doc.name}</span>
              {doc.revision !== doc.savedRevision && <i className="dirty-dot" title={translateUi("Alterações não salvas")} />}
              <button className="tab-detach" title={translateUi("Destacar em nova janela")} aria-label={`Destacar ${doc.name}`} onClick={(e) => { e.stopPropagation(); void perform(() => window.gcp.detachDocument(doc.id)); }}><MoveUpRight size={13} /></button>
              <button className="tab-close" title={translateUi("Fechar documento")} aria-label={`Fechar ${doc.name}`} onClick={(e) => { e.stopPropagation(); void perform(() => window.gcp.closeDocument(doc.id)); }}><X size={13} /></button>
            </div>
          ))}
          <button className="new-tab" aria-label={translateUi("Abrir documento")} title={translateUi("Abrir documento · Ctrl+O")} onClick={actions.open}><Plus size={18} /></button>
        </div>
      </div>
      {tool.kind === "stamp" && (
        <div className="tool-hint"><span className="pulse-dot" />{" "}{translateUi("Clique na página para aplicar “")}{tool.name}{translateUi("” ou arraste para definir o tamanho.")}{" "}<button className="text-button" onClick={() => setTool({ kind: "select" })}>{translateUi("Concluir")}{" "}<Check size={14} /></button></div>
      )}
      {tool.kind === "sign-place" && <div className="tool-hint"><span className="pulse-dot" />{" "}{translateUi("Mova o carimbo até o local desejado e clique para assinar. Esc cancela.")}{" "}<button className="text-button" onClick={() => { setPlaced(null); setTool({ kind: "select" }); }}>{translateUi("Cancelar")}</button></div>}
      {(tool.kind === "field" || tool.kind === "sign-area") && <div className="tool-hint"><span className="pulse-dot" /> {tool.kind === "field" ? translateUi("Clique ou arraste na página para criar o campo.") : translateUi("Arraste na página a área onde o carimbo da assinatura digital vai aparecer.")} <button className="text-button" onClick={() => { setHelpTopic(tool.kind === "field" ? "formularios" : "assinatura"); setModal("help"); }}><HelpCircle size={13} />{" "}{translateUi("Como usar")}</button><button className="text-button" onClick={() => setTool({ kind: "select" })}>{translateUi("Concluir")}{" "}<Check size={14} /></button></div>}
      {tool.kind === "markup" && <div className="tool-hint"><span className="pulse-dot" />{" "}{translateUi("Selecione o texto com o mouse para")}{" "}{tool.style === "highlight" ? translateUi("destacar") : tool.style === "underline" ? translateUi("sublinhar") : translateUi("tachar")}{translateUi(". Em áreas sem texto, arraste um retângulo.")}{" "}<button className="text-button" onClick={() => setTool({ kind: "select" })}>{translateUi("Concluir")}{" "}<Check size={14} /></button></div>}
      {tool.kind === "edit" && !sourceSelection && <div className="tool-hint"><span className="pulse-dot" />{" "}{translateUi("Clique em um bloco de texto para editá-lo na página. Arraste imagens para movê-las.")}{" "}<button className="text-button" onClick={() => { setHelpTopic("editar"); setModal("help"); }}><HelpCircle size={13} />{" "}{translateUi("Como usar")}</button><button className="text-button" onClick={() => setTool({ kind: "select" })}>{translateUi("Concluir")}{" "}<Check size={14} /></button></div>}
      <div className="workbench">
        <nav className="rail" aria-label={translateUi("Painéis do documento")}>
          <IconButton title={translateUi("Miniaturas das páginas")} active={panel === "pages" && sideOpen} onClick={() => (panel === "pages" ? setSideOpen(!sideOpen) : showPanel("pages"))}><Files size={20} /></IconButton>
          <IconButton title={translateUi("Marcadores")} active={panel === "bookmarks" && sideOpen} onClick={() => showPanel("bookmarks")}><BookmarkIcon size={20} /></IconButton>
          <IconButton title={translateUi("Pesquisar no documento · Ctrl+F")} active={panel === "search" && sideOpen} onClick={() => showPanel("search")}><Search size={20} /></IconButton>
          <IconButton title={translateUi("Comentários")} active={panel === "comments" && sideOpen} onClick={() => showPanel("comments")}><MessageSquare size={20} /></IconButton>
          <IconButton title={translateUi("Banco de assinaturas")} active={panel === "signatures" && sideOpen} onClick={() => showPanel("signatures")}><SignatureIcon size={20} /></IconButton>
          <IconButton title={translateUi("Pergunte à IA")} active={panel === "ai" && sideOpen} onClick={() => showPanel("ai")}><Sparkles size={20} /></IconButton>
          <div className="rail-spacer" />
          <IconButton title={translateUi("Nova janela para comparar documentos")} onClick={() => void perform(() => window.gcp.newWindow())}><SplitSquareHorizontal size={20} /></IconButton>
          <IconButton title={translateUi("Apoie o projeto")} onClick={() => setModal("support")}><Heart size={20} className="heart-filled" /></IconButton>
        </nav>
        {sideOpen && !(tab === "Organizar" && active) && (
          <aside className={`sidebar panel-${panel}`} style={{ width: panelWidth }}>
            <div className="sidebar-heading">
              <h2>{panel === "comments" ? translateUi("Comentários") : panel === "bookmarks" ? translateUi("Marcadores") : panel === "pages" ? translateUi("Páginas") : panel === "search" ? translateUi("Pesquisar") : panel === "signatures" ? translateUi("Suas assinaturas") : translateUi("Assistente de IA")} {panel === "pages" && active && <span>{active.pageCount}</span>}</h2>
              {panel === "ai" && <IconButton title={aiWide ? translateUi("Reduzir painel") : translateUi("Ampliar painel")} onClick={() => setWidths((w) => { const next = { ...w, ai: aiWide ? 420 : Math.min(760, window.innerWidth * 0.55) }; store("gcp.panel-widths", next); return next; })}>{aiWide ? <Minimize2 size={15} /> : <Maximize2 size={15} />}</IconButton>}
              <IconButton title={translateUi("Recolher painel")} onClick={() => setSideOpen(false)}><PanelLeftClose size={16} /></IconButton>
            </div>
            {panel === "bookmarks" && active && <BookmarksPanel doc={active} currentPage={page} readingTop={() => viewer.current?.readingTop() ?? 0} onGo={(index, top) => { setPage(index); viewer.current?.scrollToPage(index, top); }} onError={onError} notify={notify} />}
            {panel === "comments" && active && <CommentsPanel annotations={active.annotations} onOpenAnnotation={(a) => { setSelectedObjects(new Set()); setToolState({kind:"select"}); const index=active.pages.findIndex(p=>p.id===a.page); if(index>=0)choosePage(index); setOpenNote(`native:${a.page}:${a.index}`); }} onDeleteAnnotation={(a) => { setOpenNote(null); void operation({type:"delete-annotation",page:a.page,index:a.index}); }} objects={active.objects} pages={active.pages} currentPage={page} openNote={openNote} onClose={() => setSideOpen(false)}
              onOpen={(note) => { setOpenNote(note.id); setSelectedObjects(new Set([note.id])); const index = active.pages.findIndex((p) => p.id === note.page); if (index >= 0) choosePage(index); }}
              onSelectObject={(object) => { setToolState({ kind: "select" }); setSelectedObjects(new Set([object.id])); const index = active.pages.findIndex((p) => p.id === object.page); if (index >= 0) choosePage(index); }}
              onCreate={(text) => { const ref = active.pages[page]!, geo = pageGeometry(ref), width = geo ? (((geo.rotation + ref.rotate) % 180) ? geo.height : geo.width) : 595; const id = uid(); void operation({ type: "add-object", object: { id, page: ref.id, kind: "note", x: Math.max(8, width - 40), y: 24 + active.objects.filter((o) => o.kind === "note" && o.page === ref.id).length * 28, width: 22, height: 22, text, author: commentAuthor(), createdAt: new Date().toISOString(), color: "#ffd43b", replies: [] } }); setOpenNote(id); }}
              onUpdate={(object) => void operation({ type: "update-object", object })} onDelete={(id) => { if (openNote === id) setOpenNote(null); deleteObjects([id]); }} />}
            {panel === "pages" && (
              <>
                <div className="thumb-zoom"><ZoomOut size={13} /><input type="range" min={70} max={260} value={thumbSize} aria-label={translateUi("Tamanho das miniaturas")} onChange={(e) => { const v = Number(e.target.value); setThumbSize(v); store("gcp.thumb", v); }} /><ZoomIn size={13} /></div>
                <div className="thumbnail-actions">
                  <IconButton title={translateUi("Girar páginas selecionadas à esquerda")} disabled={!active} onClick={() => rotate(-90)}><RotateCcw size={17} /></IconButton>
                  <IconButton title={translateUi("Girar páginas selecionadas à direita")} disabled={!active} onClick={() => rotate(90)}><RotateCw size={17} /></IconButton>
                  <IconButton title={translateUi("Inserir página em branco após a seleção")} disabled={!active} onClick={actions.blank}><FilePlus2 size={17} /></IconButton>
                  <IconButton title={translateUi("Excluir páginas selecionadas")} disabled={!active || !selection.size || selection.size === active.pageCount} onClick={actions.deletePages}><Trash2 size={17} /></IconButton>
                  <div className="toolbar-spacer" />
                  <span>{selection.size ? `${selection.size} selec.` : ""}</span>
                </div>
                <div className="thumbnails-scroll">
                  {active ? (
                    Array.from({ length: active.pageCount + 1 }, (_, index) => (
                      <React.Fragment key={active.pages[index]?.id ?? "end"}>
                        <div
                          className={`page-insertion ${dropIndex === index ? "drop-active" : ""}`}
                          onDragOver={(e) => { if (e.dataTransfer.types.includes(PAGE_MIME)) { e.preventDefault(); e.stopPropagation(); e.dataTransfer.dropEffect = e.ctrlKey || e.altKey ? "copy" : "move"; setDropIndex(index); } }}
                          onDragLeave={() => setDropIndex(null)}
                          onDrop={(e) => void pageDrop(e, index)}
                        >
                          <span>{dropIndex === index ? translateUi("Inserir páginas aqui") : ""}</span>
                        </div>
                        {index < active.pageCount && (
                          <div
                            className={`thumbnail-item ${selection.has(index) ? "selected" : ""} ${page === index ? "current" : ""}`}
                            title={`Página ${index + 1}. Arraste para reordenar ou para outra janela. Ctrl ou Alt para copiar.`}
                            tabIndex={0}
                            onClick={(e) => choosePage(index, e)}
                            onContextMenu={(e) => { e.preventDefault(); if (!selection.has(index)) choosePage(index, undefined, false); setPageMenu({ x: e.clientX, y: e.clientY, index }); }}
                            draggable
                            onDragStart={(e) => { const pages = selection.has(index) && selection.size ? selectedPages : [index]; const payload = JSON.stringify({ sourceId: active.id, sourceRevision: active.revision, pages }); e.dataTransfer.setData(PAGE_MIME, payload); e.dataTransfer.setData("text/plain", payload); e.dataTransfer.effectAllowed = "copyMove"; }}
                            onDragOver={(e) => { if (e.dataTransfer.types.includes(PAGE_MIME)) { e.preventDefault(); const bounds = e.currentTarget.getBoundingClientRect(); setDropIndex(e.clientY < bounds.top + bounds.height / 2 ? index : index + 1); } }}
                            onDrop={(e) => void pageDrop(e, dropIndex ?? index)}
                          >
                            <div className="thumbnail-frame">
                              <PageThumb pageRef={active.pages[index]!} width={Math.min(thumbSize, panelWidth - 70)} />
                              {selection.has(index) && <span className="thumbnail-check"><Check size={11} /></span>}
                              <div className="thumbnail-hover-actions">
                                <button title={translateUi("Girar esta página à esquerda")} onClick={(e) => { e.stopPropagation(); rotate(-90, [index]); }}><RotateCcw size={14} /></button>
                                <button title={translateUi("Girar esta página à direita")} onClick={(e) => { e.stopPropagation(); rotate(90, [index]); }}><RotateCw size={14} /></button>
                                <button title={translateUi("Excluir esta página")} disabled={active.pageCount < 2} onClick={(e) => { e.stopPropagation(); void operation({ type: "delete", pages: [index] }); }}><Trash2 size={14} /></button>
                                <GripVertical size={14} />
                              </div>
                            </div>
                            <span className="thumbnail-number">{index + 1}</span>
                          </div>
                        )}
                      </React.Fragment>
                    ))
                  ) : (
                    <div className="sidebar-empty"><Files size={27} /><p>{translateUi("As páginas aparecem aqui ao abrir um PDF.")}</p></div>
                  )}
                </div>

              </>
            )}
            {panel === "search" && (
              <div className="sidebar-body">
                <div className="search-box">
                  <Search size={16} />
                  <input ref={searchRef} value={query} onChange={(e) => { setQuery(e.target.value); if (!e.target.value.trim()) clearSearch(); }} onKeyDown={(e) => { if (e.key === "Escape") { e.stopPropagation(); clearSearch(); return; } if (e.key === "Enter") { if (activeSearch === query.trim() && totalHits) goHit(hit + (e.shiftKey ? -1 : 1)); else void findText(); } }} placeholder={translateUi("Buscar no documento")} />
                  {(query || activeSearch) && <button className="search-clear" title={translateUi("Limpar busca e destaques · Esc")} onClick={() => { clearSearch(); searchRef.current?.focus(); }}><X size={15} /></button>}
                  <button title={translateUi("Pesquisar")} disabled={!active || searching} onClick={() => void findText()}>{searching ? <LoaderCircle className="spin" size={15} /> : <ChevronRight size={17} />}</button>
                </div>
                <p className="sidebar-description">{translateUi("Localize texto em todas as páginas do documento.")}</p>
                {matches.length > 0 && (
                  <>
                    <div className="search-nav">
                      <strong>{hit + 1}{" "}{translateUi("de")}{" "}{totalHits}</strong>
                      <span>{totalHits}{" "}{translateUi("resultado")}{totalHits > 1 ? translateUi("s") : ""}{" "}{translateUi("em")}{" "}{matches.length}{" "}{translateUi("página")}{matches.length > 1 ? translateUi("s") : ""}</span>
                      <IconButton title={translateUi("Resultado anterior · Shift+Enter")} onClick={() => goHit(hit - 1)}><ChevronLeft size={16} /></IconButton>
                      <IconButton title={translateUi("Próximo resultado · Enter")} onClick={() => goHit(hit + 1)}><ChevronRight size={16} /></IconButton>
                    </div>
                    {matches.map((m) => {
                      const first = matches.slice(0, matches.indexOf(m)).reduce((sum, x) => sum + x.count, 0);
                      return <button className={`search-result ${focus?.page === m.page ? "active" : ""}`} key={m.page} onClick={() => { setHit(first); choosePage(m.page); }}><FileText size={16} /><span>{translateUi("Página")}{" "}{m.page + 1}</span><small>{m.count}</small><ChevronRight size={15} /></button>;
                    })}
                  </>
                )}
              </div>
            )}
            {panel === "signatures" && (
              <div className="signature-panel">
                <p className="sidebar-description">{translateUi("Sua biblioteca pessoal. Escolha uma assinatura e clique onde deseja aplicá-la.")}</p>
                <button className="button primary full" onClick={() => setModal("signature")}><Plus size={16} />{" "}{translateUi("Nova assinatura")}</button>
                <div className="signature-list">
                  {signatures.map((signature) => (
                    <div className={`saved-signature ${tool.kind === "stamp" && tool.signature && tool.name === signature.name ? "selected" : ""}`} key={signature.id}>
                      <button className="signature-choice" disabled={!active} onClick={() => setTool({ kind: "stamp", dataUrl: signature.dataUrl, name: signature.name, signature: true })}>
                        <div className="signature-image"><img src={signature.dataUrl} alt={signature.name} /></div>
                        <strong>{signature.name}</strong>
                        <span>{translateUi("Clique para aplicar")}</span>
                      </button>
                      <button className="signature-delete" title={`Excluir assinatura ${signature.name}`} onClick={() => void perform(async () => { setSignatures(await window.gcp.deleteSignature(signature.id)); if (tool.kind === "stamp" && tool.signature && tool.name === signature.name) setTool({ kind: "select" }); })}><Trash2 size={14} /></button>
                    </div>
                  ))}
                </div>
                {!signatures.length && <div className="sidebar-empty"><PenLine size={32} /><h3>{translateUi("Assine do seu jeito")}</h3><p>{translateUi("Desenhe ou importe uma imagem. Salve quantas assinaturas precisar, cada uma com seu nome.")}</p></div>}
                <div className="sidebar-note"><ShieldCheck size={15} />{" "}{translateUi("Imagens de assinatura não substituem certificados digitais ICP-Brasil.")}</div>
              </div>
            )}
            {panel === "ai" && (
              <div className="ai-panel">
                <AiUsagePanel busy={aiBusy} />
                {!conversation.length && !aiBusy && (
                  <>
                    <div className="ai-intro">
                      <div className="ai-orb"><Sparkles size={22} /></div>
                      <h3>{translateUi("Uma nova perspectiva")}<br />{translateUi("para seus documentos")}</h3>
                      <p>{translateUi("Peça um resumo, encontre informações ou esclareça um trecho.")}</p>
                    </div>
                    <div className="ai-suggestions">
                      {["Resuma os principais pontos deste documento.", "Quais são os prazos e as obrigações mencionados?", "Explique este documento em linguagem simples."].map((s) => (
                        <button key={s} disabled={!active} onClick={() => setQuestion(s)}>{s}<ArrowUpRight size={13} /></button>
                      ))}
                    </div>
                  </>
                )}
                <div className="ai-conversation">
                  {conversation.map((item, i) => (
                    <div className="ai-exchange" key={i}>
                      <div className="ai-question">{item.question}</div>
                      <div className="ai-answer">
                        <div className="ai-answer-head"><Sparkles size={14} /><strong>{translateUi("Resposta")}</strong><button title={translateUi("Copiar resposta")} onClick={() => void window.gcp.copyText(item.answer).then(() => notify("Resposta copiada."))}><Copy size={13} /></button></div>
                        <Markdown text={splitSuggestions(item.answer).body} />
                      </div>
                      {i === conversation.length - 1 && splitSuggestions(item.answer).suggestions.length > 0 && (
                        <div className="ai-followups">
                          <span>{translateUi("Continue a conversa")}</span>
                          {splitSuggestions(item.answer).suggestions.map((s, k) => <button key={k} disabled={aiBusy} onClick={() => void ask(s)}>{k < 2 ? <ArrowDownRight size={13} /> : <Lightbulb size={13} />}{s}</button>)}
                        </div>
                      )}
                    </div>
                  ))}
                  {aiBusy && <div className="ai-thinking"><LoaderCircle className="spin" size={17} />{" "}{translateUi("Analisando o documento…")}</div>}
                </div>
                <div className="ai-compose">
                  <textarea value={question} onChange={(e) => setQuestion(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void ask(); } }} placeholder={translateUi("O que você deseja saber? (Enter envia)")} rows={3} disabled={!active || aiBusy} />
                  <div className="ai-compose-actions">
                    <button className="text-button" onClick={() => setModal("settings")}><Settings size={14} />{" "}{translateUi("Configurar API")}</button>
                    {conversation.length > 0 && <button className="text-button" onClick={() => setConversation([])}>{translateUi("Nova conversa")}</button>}
                    <button className="button primary" disabled={!active || !question.trim() || aiBusy} onClick={() => void ask()}><Send size={15} />{" "}{translateUi("Enviar")}</button>
                  </div>
                </div>
                <p className="ai-disclosure">{translateUi("Ao enviar, o texto do PDF será compartilhado com o provedor da sua API. Revise as respostas antes de usá-las.")}</p>
              </div>
            )}
            <div className="sidebar-resizer" onPointerDown={startResize} title={translateUi("Arraste para ajustar a largura")} />
          </aside>
        )}
        <main className={`document-area ${showHome ? "empty" : ""}`}>
          {showHome && <Home files={recent.items} documents={workspace.documents} activeId={active?.id} currentPage={page} ready={ready} onOpen={openFilesFromHome} onNew={() => void perform(() => window.gcp.newDocument())} onActivate={resumeDocument} onRemove={recent.remove} onClear={recent.clear} onCombine={() => actions.quick("combine")} onConvert={() => actions.quick("convert")} onSupport={() => setModal("support")} />}
          <div className="home-document-view" hidden={showHome}>
          {active && tab === "Organizar" ? (
            <OrganizeView doc={active} selection={selection} setSelection={setSelection} actions={organize} onContextMenu={(e, index) => setPageMenu({ x: e.clientX, y: e.clientY, index })} />
          ) : active ? (
            <div className="viewer-host" onScrollCapture={(event) => { if ((event.target as HTMLElement).classList.contains("canvas-scroll")) scheduleReadingSave(); }} onDragOver={(e) => { if (e.dataTransfer.types.includes(TAB_MIME)) e.preventDefault(); }} onDrop={(e) => { if (dragData(e)?.documentId && !draggingTab.current) void tabDropEvent(e); }}>
              <Viewer
                layout={layout}
                filter={readingFilter}
                ref={viewer}
                doc={active}
                scale={zoom}
                tool={tool}
                style={style}
                search={activeSearch}
                selected={selectedObjects}
                editingText={editingText}
                sourceSelection={sourceSelection}
                onSourceSelect={setSourceSelection}
                onEditText={setEditingText}
                onSelect={(ids) => setSelectedObjects(new Set(ids))}
                onAdd={(object, dataUrl) => void perform(async () => { await window.gcp.applyOperation(active.id, { type: "add-object", object, ...(dataUrl ? { dataUrl } : {}) } as PdfOperation, active.revision); setToolState({kind:"select"}); })}
                onUpdate={(objects) => { for (const object of objects) void operation({ type: "update-object", object }); }}
                onDelete={(ids) => deleteObjects(ids)}
                onFields={(values) => void operation({ type: "set-fields", values })}
                searchFocus={focus}
                onFieldMenu={(page, name, type) => setFieldProps({ page, name, type })}
                onFormButton={(pageId, action) => {
                  if (action.image) { void perform(() => window.gcp.setFieldImage(active.id, pageId, action.field), "Colocando a imagem no campo…"); return; }
                  if (action.url) { void perform(() => window.gcp.openFormLink(action.url!)); return; }
                  if (action.page) { choosePage(Math.min(active.pageCount, action.page) - 1); return; }
                  if (action.reset) { const cleared = Object.fromEntries(Object.entries(active.fields).map(([k, v]) => [k, typeof v === "boolean" ? false : Array.isArray(v) ? [] : ""])); void operation({ type: "set-fields", values: cleared }); notify("Formulário limpo."); return; }
                  if (action.print) { setModal("print"); return; }
                  notify("Este botão não tem ação. Clique com o botão direito no campo para definir uma em Propriedades.");
                }}
                onEditImage={openImageEditor}
                onDeleteAnnotation={(a) => { setOpenNote(null); void operation({type:"delete-annotation",page:a.page,index:a.index}); }}
                openNote={openNote}
                onSourceImageEdit={(pageId, image, rect) => void perform(async () => { const src = await window.gcp.exportSourceImage(active.id, pageId, image, false); if (src) setImageEdit({ id: "", src, source: { page: pageId, image, rect } }); }, "Abrindo a imagem…")}
                onOpenNote={(id) => { setOpenNote(id); if(id?.startsWith("native:"))setSelectedObjects(new Set()); if (id) { setPanel("comments"); setSideOpen(true); } }}
                onArea={(pageId, rect) => {
                  if (tool.kind === "sign-area") { setSignArea({ page: pageId, rect }); setToolState({ kind: "select" }); setModal("certificate"); return; }
                  if (tool.kind === "sign-place" && placed) { const options = placed.options; setToolState({ kind: "select" }); setPlaced(null); void perform(async () => { const path = await window.gcp.signDocument(active.id, { ...options, page: pageId, rect }); if (path) { notify("Documento assinado digitalmente."); void window.gcp.openFiles([path]); } }); return; }
                  if (tool.kind !== "field") return;
                  if (tool.field === "combo" || tool.field === "list") { setPendingField({ page: pageId, rect, type: tool.field }); setModal("field-options"); return; }
                  const type = tool.field;
                  // Like Acrobat: back to Selecionar with the new field's properties open.
                  setToolState({ kind: "select" });
                  void perform(async () => { const name = await window.gcp.addFormField(active.id, pageId, { type, rect }); if (name) setFieldProps({ page: pageId, name, type }); });
                }}
                onToolDone={(created) => { setToolState({ kind: "select" }); if (created) setSelectedObjects(new Set([created])); }}
                onCurrentPage={(index) => { setPage(index); setSelection((old) => (old.size <= 1 ? new Set([index]) : old)); }}
                onZoom={zoomBy}
                onError={onError}
              />
            </div>
          ) : null}
          </div>
        </main>
        {propertiesAvailable && !propertiesClosed && (
          <aside className="properties-panel" aria-label={translateUi("Propriedades")}>
            <div className="sidebar-heading">
              <h2>{translateUi("Propriedades")}</h2>
              <IconButton title={translateUi("Recolher painel")} onClick={() => setClosedPropertiesKey(propertiesKey)}><PanelRightClose size={16} /></IconButton>
            </div>
            <PropertyBar tool={tool} style={style} selection={selectionObjects} source={sourceSelection} actions={actions} fonts={fonts} />
          </aside>
        )}
        {!showHome && active && !reading && (
          <nav className="rail rail-right" aria-label={translateUi("Painéis de propriedades")}>
            <IconButton title={propertiesAvailable ? translateUi("Propriedades") : translateUi("Propriedades (selecione um objeto ou ferramenta)")} disabled={!propertiesAvailable} active={propertiesAvailable && !propertiesClosed} onClick={() => setClosedPropertiesKey(propertiesClosed ? null : propertiesKey)}><SlidersHorizontal size={19} /></IconButton>
          </nav>
        )}
      </div>
      <footer className="statusbar">
        <div>
          <span className={`status-dot ${busy ? "working" : ""}`} />
          {busy ? translateUi(busy) : !ready ? translateUi("Preparando seu espaço…") : active ? <>{translateUi("Página {page} de {total} · {selected} selecionada(s)",{page:page+1,total:active.pageCount,selected:selectedPages.length})}{active.objects.length?translateUi(" · {count} anotação(ões)",{count:active.objects.length}):""}</> : translateUi("Pronto para começar")}
          {busy && <LoaderCircle size={12} className="spin" />}
        </div>
        <div>
          {active && <ZoomBox zoom={zoom} compact onZoom={actions.zoomTo} />}
          <ShieldCheck size={12} /><span>{translateUi("Processamento local")}</span><span className="status-divider" />{translateUi("PT-BR")}{" "}<button onClick={() => setModal("support")}><Heart size={12} />{" "}{translateUi("Apoie o projeto")}</button>
        </div>
      </footer>
      {toast && (
        <div className={`toast ${toast.error ? "error" : ""}`} role={toast.error ? "alert" : "status"}>
          {toast.error ? <X size={17} /> : <Check size={17} />}
          <span>{toast.text}</span>
          <button aria-label={translateUi("Fechar aviso")} onClick={() => setToast(null)}><X size={15} /></button>
        </div>
      )}
      {pageMenu && active && (
        <div className="context-backdrop" onMouseDown={() => setPageMenu(null)} onContextMenu={(e) => { e.preventDefault(); setPageMenu(null); }}>
          <div className="context-menu" style={{ left: Math.min(pageMenu.x, window.innerWidth - 250), top: Math.min(pageMenu.y, window.innerHeight - 430) }} onMouseDown={(e) => e.stopPropagation()} onClick={() => setPageMenu(null)}>
            <div className="context-title">{selectedPages.length > 1 ? `${selectedPages.length} páginas selecionadas` : `Página ${pageMenu.index + 1}`}</div>
            <button onClick={() => organize.extract("tab")}><FileOutput size={14} />{" "}{translateUi("Extrair para nova aba")}</button>
            <button onClick={() => organize.extract("file")}><FileOutput size={14} />{" "}{translateUi("Extrair em um PDF…")}</button>
            <button onClick={() => organize.extract("files")}><FileOutput size={14} />{" "}{translateUi("Extrair separadamente (um PDF por página)…")}</button>
            <button onClick={() => setModal("split")}><Scissors size={14} />{" "}{translateUi("Dividir documento…")}</button>
            <button onClick={() => organize.replace()}><Replace size={14} />{" "}{translateUi("Substituir páginas…")}</button>
            <hr />
            <button onClick={() => rotate(-90)}><RotateCcw size={14} />{" "}{translateUi("Girar à esquerda")}</button>
            <button onClick={() => rotate(90)}><RotateCw size={14} />{" "}{translateUi("Girar à direita")}</button>
            <hr />
            <button onClick={() => pageTools.copy(true)}><Scissors size={14} />{" "}{translateUi("Recortar")}{" "}<kbd>{translateUi("Ctrl+X")}</kbd></button>
            <button onClick={() => pageTools.copy(false)}><Copy size={14} />{" "}{translateUi("Copiar")}{" "}<kbd>{translateUi("Ctrl+C")}</kbd></button>
            <button onClick={() => pageTools.paste(false)}><ClipboardPaste size={14} />{" "}{translateUi("Colar antes")}{" "}<kbd>{translateUi("Ctrl+Shift+V")}</kbd></button>
            <button onClick={() => pageTools.paste(true)}><ClipboardPaste size={14} />{" "}{translateUi("Colar depois")}{" "}<kbd>{translateUi("Ctrl+V")}</kbd></button>
            <button onClick={() => organize.insertFile(pageMenu.index + 1)}><FilePlus2 size={14} />{" "}{translateUi("Inserir de arquivo depois…")}</button>
            <button onClick={() => void operation({ type: "blank", index: pageMenu.index + 1 })}><FilePlus2 size={14} />{" "}{translateUi("Inserir página em branco")}</button>
            <hr />
            <button className="danger" disabled={selectedPages.length >= active.pageCount} onClick={() => organize.remove(selectedPages)}><Trash2 size={14} />{" "}{translateUi("Excluir páginas")}</button>
          </div>
        </div>
      )}
      {prompts[0] && <PromptDialog prompt={prompts[0]} onAnswer={(index) => { const current = prompts[0]!; setPrompts((list) => list.slice(1)); void window.gcp.answerPrompt(current.id, index); }} />}
      {modal === "export" && active && <ExportDialog name={active.name} initialFormat={exportFormat} onClose={() => setModal(null)} onExport={exportDocument} />}
      {modal === "numbering" && active && <NumberingDialog doc={active} selection={selectedPages} onClose={() => setModal(null)} onApply={async (objects) => { await perform(() => window.gcp.applyOperation(active.id, { type: "add-objects", objects }, active.revision), "Numerando páginas…"); notify("Páginas numeradas. Os números podem ser movidos ou excluídos."); }} />}
      {modal === "stamps" && <StampDialog onClose={() => setModal(null)} onApply={(dataUrl, name) => { setModal(null); setTool({ kind: "stamp", dataUrl, name, signature: false, natural: true }); }} />}
      {modal === "palette" && <CommandPalette commands={commands.map((c) => ({ ...c, run: () => { if ((TABS as readonly string[]).includes(c.group) && c.group !== tab) setTab(c.group as Tab); c.run(); } }))} onClose={() => setModal(null)} onHelp={(topic) => { setHelpTopic(topic); setModal("help"); }} />}
      {modal === "help" && <HelpDialog topic={helpTopic} onClose={() => setModal(null)} />}
      {modal === "protect" && active && <ProtectDialog docId={active.id} name={active.name} onClose={() => setModal(null)} onSaved={() => notify("Cópia protegida salva.")} onError={onError} />}
      {modal === "certificate" && active && <CertificateDialog docId={active.id} area={signArea} visible={signVisible && !signArea} onPlace={(p) => { setModal(null); setPlaced(p); setToolState({ kind: "sign-place", width: p.width, height: p.height, lines: p.lines, image: p.image }); }} signatures={signatures} onClose={() => setModal(null)} onSigned={(path) => { notify("Documento assinado digitalmente."); void window.gcp.openFiles([path]); }} onError={onError} />}
      {modal === "signatures-check" && active && <SignaturesDialog docId={active.id} onClose={() => setModal(null)} />}
      {modal === "field-options" && active && pendingField && <FieldOptionsDialog kind={pendingField.type} onClose={() => { setModal(null); setPendingField(null); }} onConfirm={(options, name) => { const field = pendingField; setModal(null); setPendingField(null); setToolState({ kind: "select" }); void perform(async () => { const created = await window.gcp.addFormField(active.id, field.page, { type: field.type, rect: field.rect, options, name: name || undefined }); if (created) setFieldProps({ page: field.page, name: created, type: field.type }); }); }} />}
      {modal === "compare" && active && <CompareView documents={workspace.documents} first={compareFirst ?? active.id} onClose={() => { setModal(null); setCompareFirst(null); }} onOpen={() => perform(() => window.gcp.openFiles())} />}
      {modal === "stats" && active && <StatsDialog doc={active} onClose={() => setModal(null)} onError={onError} onGoto={(index) => choosePage(index)} />}
      {modal === "properties" && active && <PropertiesDialog doc={active} onClose={() => setModal(null)} onError={onError} onSaved={() => notify("Propriedades aplicadas. Salve o PDF para gravá-las no arquivo.")} />}
      {whatsNew && <WhatsNewDialog info={whatsNew} onClose={() => setWhatsNew(null)} />}
      {update && <UpdateDialog info={update} onClose={() => setUpdate(null)} onError={onError} />}
      {modal === "print" && active && <PrintDialog doc={active} current={page} selected={selectedPages} onClose={() => setModal(null)} onPrint={(input) => { setModal(null); void perform(async () => { await window.gcp.printPages(active.id, input); notify("Enviado para a impressora."); }); }} />}
      {imageEdit && <ImageEditor src={imageEdit.src} onClose={() => setImageEdit(null)} onApply={(dataUrl, aspect) => { const edit = imageEdit; setImageEdit(null); if (!edit.source) { applyImageEdit(edit.id, dataUrl, aspect); return; } const s = edit.source; void perform(async () => { await window.gcp.editSourceImage(active!.id, s.page, { image: s.image, action: "replace", dataUrl }); if (Math.abs(s.rect.width / s.rect.height - aspect) > 0.01) { const fresh = (await window.gcp.getWorkspace()).documents.find((d) => d.id === active!.id); const page = fresh?.pages.find((p) => p.id === s.page) ? s.page : s.page; await window.gcp.editSourceImage(active!.id, page, { image: s.image, action: "resize", from: s.rect, to: { ...s.rect, height: s.rect.width / aspect } }); } }, "Aplicando a imagem editada…"); }} />}
      {fieldProps && active && <FieldPropsDialog key={fieldProps.name} name={fieldProps.name} type={fieldProps.type} onClose={() => setFieldProps(null)} onApply={(props) => { const target = fieldProps; setFieldProps(null); void perform(async () => { await window.gcp.setFormFieldProps(active.id, target.page, target.name, props); notify("Propriedades do campo aplicadas."); }, "Aplicando propriedades…"); }} />}
      {modal === "compress" && active && <CompressDialog doc={active} onClose={() => setModal(null)} onDone={(message) => notify(message)} onError={onError} />}
      {modal === "split" && active && (
        <Modal title={translateUi("Dividir documento")} description={`${active.name} · ${active.pageCount} páginas`} onClose={() => setModal(null)}>
          <div className="segmented">
            <button className={splitMode === "pages" ? "selected" : ""} onClick={() => setSplitMode("pages")}>{translateUi("Por número de páginas")}</button>
            <button className={splitMode === "size" ? "selected" : ""} onClick={() => setSplitMode("size")}>{translateUi("Por tamanho do arquivo")}</button>
          </div>
          {splitMode === "pages" ? (
            <>
              <label className="field">{translateUi("Páginas por arquivo")}<input type="number" min={1} max={active.pageCount} value={splitEvery} onChange={(e) => setSplitEvery(Math.max(1, Math.min(active.pageCount, Number(e.target.value) || 1)))} /></label>
              <p className="sidebar-description">{translateUi("Serão criados")}{" "}{Math.ceil(active.pageCount / splitEvery)}{" "}{translateUi("arquivo(s) PDF na pasta que você escolher.")}</p>
            </>
          ) : (
            <>
              <label className="field">{translateUi("Tamanho máximo de cada arquivo (MB)")}<input type="number" min={0.1} step={0.5} value={splitMb} onChange={(e) => setSplitMb(Math.max(0.1, Number(e.target.value) || 1))} /></label>
              <div className="chip-row">{[1, 2, 5, 10, 25].map((mb) => <button key={mb} className={`chip ${splitMb === mb ? "selected" : ""}`} onClick={() => setSplitMb(mb)}>{mb}{" "}{translateUi("MB")}</button>)}</div>
              <p className="sidebar-description">{translateUi("Útil para portais com limite de envio (SALIC, Prosas, e-mail). Cada parte recebe o máximo de páginas que cabe no limite; uma página maior que o limite fica sozinha.")}</p>
            </>
          )}
          <div className="modal-footer">
            <button className="button secondary" onClick={() => setModal(null)}>{translateUi("Cancelar")}</button>
            <button className="button primary" onClick={() => { setModal(null); void perform(async () => { const folder = await window.gcp.splitDocument(active.id, splitMode === "size" ? { maxMb: splitMb } : { every: splitEvery }); if (folder) notify(`Documento dividido em ${folder}`); }, "Dividindo…"); }}>{translateUi("Escolher pasta e dividir")}</button>
          </div>
        </Modal>
      )}
      {modal === "settings" && <SettingsDialog theme={workspace.theme} quickActions={workspace.quickActions} onUpdateFound={(info) => { setModal(null); setUpdate(info); }} onTheme={(theme) => void perform(() => window.gcp.setTheme(theme))} labels={labels} onLabels={(value) => { setLabels(value); store("gcp.labels", value); }} onClose={() => setModal(null)} />}
      {modal === "signature" && <SignatureDialog onClose={() => setModal(null)} onSaved={setSignatures} />}
      {modal === "support" && <SupportDialog onClose={() => setModal(null)} />}
      {modal === "combine" && (
        <Modal title={translateUi("Combinar documentos abertos")} description={translateUi("Confira a ordem dos arquivos antes de gerar um novo PDF.")} onClose={() => setModal(null)}>
          <div className="combine-list">
            {combineIds.map((id, index) => {
              const doc = workspace.documents.find((d) => d.id === id);
              return doc && (
                <div className="combine-row" key={id}>
                  <span>{index + 1}</span><FileText size={17} /><strong>{doc.name}</strong><small>{doc.pageCount}{" "}{translateUi("págs.")}</small>
                  <IconButton title={translateUi("Mover para cima")} disabled={index === 0} onClick={() => setCombineIds((ids) => { const copy = [...ids]; [copy[index - 1], copy[index]] = [copy[index]!, copy[index - 1]!]; return copy; })}><ChevronLeft className="rotate-90" size={16} /></IconButton>
                  <IconButton title={translateUi("Remover da combinação")} onClick={() => setCombineIds((ids) => ids.filter((x) => x !== id))}><X size={15} /></IconButton>
                </div>
              );
            })}
          </div>
          <div className="modal-footer">
            <button className="button secondary" onClick={() => setModal(null)}>{translateUi("Cancelar")}</button>
            <button className="button primary" disabled={combineIds.length < 2 || !!busy} onClick={() => void perform(async () => { await window.gcp.combineDocuments(combineIds); setModal(null); notify("Documentos combinados. Use Salvar para escolher o destino."); })}><Layers3 size={16} />{" "}{translateUi("Combinar documentos")}</button>
          </div>
        </Modal>
      )}
    </div>
  );
}
