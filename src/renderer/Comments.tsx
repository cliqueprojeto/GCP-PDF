import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { MessageSquare, Trash2, X, Pencil, MoreHorizontal, Reply, Highlighter, Square, PenLine, Type, Stamp, FileText } from "lucide-react";
import type { NoteReply, PageObject, PageRef } from "../shared/types";
import { loadPage, pdfjs } from "./pdf";
import { measureLabel } from "../shared/geometry";

export type PdfNote = Extract<PageObject, { kind: "note" }>;
const uid = () => (crypto.randomUUID ? crypto.randomUUID() : String(Date.now() + Math.random()));
/** Who comments: the name typed once in the panel (like Acrobat's identity), kept on this computer. */
export function commentAuthor() { try { return localStorage.getItem("gcp.author") || "Você"; } catch { return "Você"; } }
const when = (iso: string) => {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime()) || d.getTime() === 0) return "";
  const today = new Date().toDateString() === d.toDateString();
  return today ? d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" }) : d.toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", year: "2-digit", hour: "2-digit", minute: "2-digit" });
};
const initial = (name: string) => (name.trim()[0] ?? "?").toUpperCase();

function Entry({ author, createdAt, text, onEdit, onDelete }: { author: string; createdAt: string; text: string; onEdit?: (text: string) => void; onDelete?: () => void }) {
  const [menu, setMenu] = useState(false), [editing, setEditing] = useState(false), [value, setValue] = useState(text);
  return (
    <div className="note-entry">
      <div className="note-entry-head">
        <span className="note-avatar">{initial(author)}</span>
        <strong>{author || "Comentário"}</strong>
        <small>{when(createdAt)}</small>
        {(onEdit || onDelete) && (
          <span className="note-menu">
            <button className="icon-button" title="Mais opções" onClick={(e) => { e.stopPropagation(); setMenu(!menu); }}><MoreHorizontal size={14} /></button>
            {menu && (
              <span className="dropdown-menu note-menu-list" onPointerDown={(e) => e.stopPropagation()}>
                {onEdit && <button onClick={() => { setEditing(true); setValue(text); setMenu(false); }}><Pencil size={13} /> Editar</button>}
                {onDelete && <button className="danger" onClick={() => { setMenu(false); onDelete(); }}><Trash2 size={13} /> Excluir</button>}
              </span>
            )}
          </span>
        )}
      </div>
      {editing ? (
        <Composer initial={value} label="Salvar" onCancel={() => setEditing(false)} onSubmit={(t) => { onEdit?.(t); setEditing(false); }} />
      ) : <p className="note-text">{text}</p>}
    </div>
  );
}
function Composer({ initial = "", label = "Publicar", placeholder = "Adicionar comentário", autoFocus = true, onSubmit, onCancel }: { initial?: string; label?: string; placeholder?: string; autoFocus?: boolean; onSubmit: (text: string) => void; onCancel?: () => void }) {
  const [value, setValue] = useState(initial), area = useRef<HTMLTextAreaElement>(null);
  // Focused as soon as it exists, so the first keystrokes after "Responder" are not lost.
  useLayoutEffect(() => { if (autoFocus) area.current?.focus(); }, []);
  const submit = () => { if (value.trim()) { onSubmit(value.trim()); setValue(""); } };
  return (
    <div className="note-composer" onPointerDown={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>
      <textarea ref={area} value={value} maxLength={20000} placeholder={placeholder} onChange={(e) => setValue(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) { e.preventDefault(); submit(); } if (e.key === "Escape") onCancel?.(); }} />
      <div className="note-composer-actions">
        {onCancel && <button className="text-button" onClick={onCancel}>Cancelar</button>}
        <button className="button primary small" disabled={!value.trim()} onClick={submit}>{label}</button>
      </div>
    </div>
  );
}
/** The thread of one comment: the note, its replies and a reply box (used on the page and in the panel). */
export function NoteThread({ note, onChange, onDelete, compact = false }: { note: PdfNote; onChange: (note: PdfNote) => void; onDelete: () => void; compact?: boolean }) {
  const [replying, setReplying] = useState(false), author = commentAuthor();
  const replies = note.replies ?? [];
  if (!note.text) return <Composer placeholder="Escreva seu comentário…" onSubmit={(text) => onChange({ ...note, text, author: note.author || author })} onCancel={onDelete} />;
  return (
    <div className="note-thread">
      <Entry author={note.author} createdAt={note.createdAt} text={note.text} onEdit={(text) => onChange({ ...note, text })} onDelete={onDelete} />
      {replies.map((r) => <div key={r.id} className="note-reply"><Entry author={r.author} createdAt={r.createdAt} text={r.text} onEdit={(text) => onChange({ ...note, replies: replies.map((x) => (x.id === r.id ? { ...x, text } : x)) })} onDelete={() => onChange({ ...note, replies: replies.filter((x) => x.id !== r.id) })} /></div>)}
      {replying ? <Composer placeholder="Responder…" label="Responder" onCancel={() => setReplying(false)} onSubmit={(text) => { const reply: NoteReply = { id: uid(), author, text, createdAt: new Date().toISOString() }; onChange({ ...note, replies: [...replies, reply] }); setReplying(false); }} />
        : !compact || replies.length < 50 ? <button className="text-button note-reply-button" onClick={() => setReplying(true)}><Reply size={13} /> Responder</button> : null}
    </div>
  );
}
/** The bubble next to a note icon on the page (rendered at screen scale, whatever the zoom). */
/** The bubble next to a note icon, drawn above the whole interface (a portal at screen position), so zoom,
 * neighbouring pages and panels never cover it. Clicking outside or Esc closes it. */
export function NoteBubble({ note, onChange, onDelete, onClose }: { note: PdfNote; onChange: (note: PdfNote) => void; onDelete: () => void; onClose: () => void }) {
  const box = useRef<HTMLDivElement>(null), [at, setAt] = useState<{ left: number; top: number } | null>(null);
  const close = useRef(onClose); close.current = onClose;
  useLayoutEffect(() => {
    let frame = 0;
    const place = () => {
      frame = 0;
      const icon = document.querySelector<HTMLElement>(`.overlay-note[data-object-id="${CSS.escape(note.id)}"]`);
      if (!icon) return;
      const r = icon.getBoundingClientRect(), w = box.current?.offsetWidth ?? 280, h = box.current?.offsetHeight ?? 160, gap = 8;
      // Prefer the right side; flip left or clamp so the bubble always stays inside the window.
      let left = r.right + gap; if (left + w > window.innerWidth - 8) left = Math.max(8, r.left - gap - w);
      const top = Math.max(8, Math.min(r.top, window.innerHeight - h - 8));
      setAt((old) => (old && old.left === left && old.top === top ? old : { left, top }));
    };
    const schedule = () => { if (!frame) frame = requestAnimationFrame(place); };
    place();
    window.addEventListener("scroll", schedule, true); window.addEventListener("resize", schedule);
    const observer = new ResizeObserver(schedule); if (box.current) observer.observe(box.current);
    return () => { cancelAnimationFrame(frame); window.removeEventListener("scroll", schedule, true); window.removeEventListener("resize", schedule); observer.disconnect(); };
  }, [note.id, note.x, note.y]);
  useEffect(() => {
    const outside = (e: PointerEvent) => { const t = e.target as HTMLElement; if (box.current?.contains(t) || t.closest(`[data-object-id="${CSS.escape(note.id)}"]`) || t.closest(".comments-panel")) return; close.current(); };
    const key = (e: KeyboardEvent) => { if (e.key === "Escape") { e.preventDefault(); close.current(); } };
    window.addEventListener("pointerdown", outside, true); window.addEventListener("keydown", key);
    return () => { window.removeEventListener("pointerdown", outside, true); window.removeEventListener("keydown", key); };
  }, [note.id]);
  return createPortal(
    <div ref={box} className="note-bubble" style={{ left: at?.left ?? -9999, top: at?.top ?? -9999 }} onPointerDown={(e) => e.stopPropagation()} onDoubleClick={(e) => e.stopPropagation()}>
      <button className="icon-button note-bubble-close" title="Fechar (Esc)" onClick={onClose}><X size={13} /></button>
      <NoteThread note={note} onChange={onChange} onDelete={onDelete} compact />
    </div>,
    document.body,
  );
}

interface DocAnnotation { page: number; type: string; author: string; text: string; date: string }
const KIND: Record<string, { label: string; icon: React.ReactNode }> = {
  markup: { label: "Destaque", icon: <Highlighter size={13} /> }, shape: { label: "Forma", icon: <Square size={13} /> }, ink: { label: "Desenho", icon: <PenLine size={13} /> },
  text: { label: "Caixa de texto", icon: <Type size={13} /> }, image: { label: "Imagem ou carimbo", icon: <Stamp size={13} /> },
};
/** Comments panel in Acrobat's manner: add box, threads grouped by page, other markups, and comments already in the PDF. */
export function CommentsPanel({ objects, pages, currentPage, openNote, onOpen, onCreate, onUpdate, onDelete, onSelectObject, onClose }: {
  objects: PageObject[]; pages: PageRef[]; currentPage: number; openNote: string | null; onOpen: (note: PdfNote) => void; onCreate: (text: string) => void;
  onUpdate: (note: PdfNote) => void; onDelete: (id: string) => void; onSelectObject: (object: PageObject) => void; onClose: () => void;
}) {
  const [author, setAuthor] = useState(commentAuthor()), [filter, setFilter] = useState(""), [foreign, setForeign] = useState<DocAnnotation[]>([]);
  const pageNumber = (id: string) => pages.findIndex((p) => p.id === id) + 1;
  // Comments other programs left in the PDF (Acrobat, Foxit…): listed read-only, they stay in the file.
  useEffect(() => {
    let alive = true;
    void (async () => {
      const found: DocAnnotation[] = [];
      for (const [index, ref] of pages.entries()) {
        if (index > 400) break;
        const page = await loadPage(ref);
        for (const a of (await page.getAnnotations({ intent: "display" })) as any[]) {
          if (a.annotationType === pdfjs.AnnotationType.WIDGET || a.annotationType === pdfjs.AnnotationType.LINK || a.annotationType === pdfjs.AnnotationType.POPUP) continue;
          const text = a.contentsObj?.str ?? a.contents ?? "";
          if (/^GCP-PDF:/.test(a.annotationName ?? "") ) continue;
          if (!text && !a.titleObj?.str) continue;
          found.push({ page: index + 1, type: a.subtype ?? "Anotação", author: a.titleObj?.str ?? "", text, date: a.modificationDate ?? "" });
        }
      }
      if (alive) setForeign(found);
    })().catch(() => {});
    return () => { alive = false; };
  }, [pages]);
  const notes = objects.filter((o): o is PdfNote => o.kind === "note");
  const marks = objects.filter((o) => o.kind !== "note");
  const q = filter.trim().toLowerCase(), match = (t: string) => !q || t.toLowerCase().includes(q);
  const byPage = useMemo(() => {
    const map = new Map<number, React.ReactNode[]>();
    const add = (n: number, node: React.ReactNode) => map.set(n, [...(map.get(n) ?? []), node]);
    for (const note of notes.slice().sort((a, b) => a.createdAt.localeCompare(b.createdAt))) {
      if (!match(note.text + note.author + (note.replies ?? []).map((r) => r.text).join(" "))) continue;
      add(pageNumber(note.page), <article key={note.id} className={`note-card ${openNote === note.id ? "active" : ""}`} onClick={() => onOpen(note)}>
        <NoteThread note={note} onChange={onUpdate} onDelete={() => onDelete(note.id)} />
      </article>);
    }
    for (const mark of marks) { const k = KIND[mark.kind]; if (!k || !match(k.label)) continue; add(pageNumber(mark.page), <button key={mark.id} className="note-mark" onClick={() => onSelectObject(mark)}>{k.icon}<span>{mark.kind === "shape" && mark.measure ? `Medida: ${measureLabel(mark)?.text ?? ""}` : k.label}{mark.kind === "text" && "text" in mark ? `: ${String(mark.text).slice(0, 60)}` : ""}</span></button>); }
    for (const [i, a] of foreign.entries()) { if (!match(a.text + a.author)) continue; add(a.page, <div key={"f" + i} className="note-card foreign"><div className="note-entry-head"><span className="note-avatar">{initial(a.author || a.type)}</span><strong>{a.author || a.type}</strong><small>{a.type}</small></div><p className="note-text">{a.text}</p></div>); }
    return [...map.entries()].sort((a, b) => a[0] - b[0]);
  }, [objects, foreign, filter, openNote, pages]);
  const total = notes.length + marks.length + foreign.length;
  return (
    <aside className="comments-panel" aria-label="Comentários">
      <header><MessageSquare size={17} /><strong>Comentários {total}</strong><button className="icon-button" title="Fechar" onClick={onClose}><X size={15} /></button></header>
      <Composer key={currentPage} autoFocus={false} placeholder={`Adicionar comentário na página ${currentPage + 1}`} onSubmit={onCreate} />
      <div className="comments-tools">
        <input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Filtrar comentários" />
        <label title="Nome que aparece nos seus comentários">Seu nome <input value={author} onChange={(e) => { setAuthor(e.target.value); try { localStorage.setItem("gcp.author", e.target.value.trim() || "Você"); } catch {} }} /></label>
      </div>
      {!byPage.length && <p className="comments-empty"><FileText size={22} />Use <b>Comentário › Adicionar comentário</b> e clique na página onde quer a nota, ou escreva acima. As notas ficam no PDF salvo e abrem no Adobe com as respostas.</p>}
      {byPage.map(([page, nodes]) => (
        <section key={page} className="comments-page"><h4>Página {page} <small>{nodes.length}</small></h4>{nodes}</section>
      ))}
    </aside>
  );
}
