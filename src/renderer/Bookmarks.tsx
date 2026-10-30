import React, { useEffect, useRef, useState } from "react";
import { Bookmark as BookmarkIcon, BookmarkPlus, FolderPlus, Pencil, Trash2, Wand2, ChevronRight, ChevronDown, AArrowUp, AArrowDown, ListTree, Flag, Bold, MoreHorizontal, LoaderCircle } from "lucide-react";
import type { Bookmark, BookmarkEdit, DocumentInfo } from "../shared/types";

const stored = (key: string, fallback: number) => { try { const v = Number(localStorage.getItem(key)); return Number.isFinite(v) && v > 0 ? v : fallback; } catch { return fallback; } };
const same = (a: number[] | null, b: number[]) => !!a && a.length === b.length && a.every((n, i) => n === b[i]);
/** Bookmarks panel in PDFelement's manner: the outline of the PDF, a click goes to the marked place; add (at the
 * place being read), subgroup, rename, delete, set destination, bold, automatic bookmarks from titles and text size. */
export function BookmarksPanel({ doc, currentPage, readingTop, onGo, onError, notify }: { doc: DocumentInfo; currentPage: number; readingTop: () => number; onGo: (page: number, top: number | null) => void; onError: (e: unknown) => void; notify: (text: string) => void }) {
  const [items, setItems] = useState<Bookmark[] | null>(null), [selected, setSelected] = useState<number[] | null>(null), [renaming, setRenaming] = useState<number[] | null>(null);
  const [open, setOpen] = useState<Set<string>>(new Set()), [size, setSize] = useState(() => stored("gcp.bookmark-size", 13)), [busy, setBusy] = useState(false), [menu, setMenu] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const load = () => window.gcp.listBookmarks(doc.id).then((list) => { setItems(list); setOpen((o) => (o.size ? o : new Set(flatten(list).filter((b) => b.open).map((b) => b.path.join("."))))); }).catch(onError);
  useEffect(() => { void load(); }, [doc.id, doc.revision]);
  useEffect(() => { try { localStorage.setItem("gcp.bookmark-size", String(size)); } catch {} }, [size]);
  useEffect(() => { if (!menu) return; const close = (e: PointerEvent) => { if (!menuRef.current?.contains(e.target as Node)) setMenu(false); }; window.addEventListener("pointerdown", close); return () => window.removeEventListener("pointerdown", close); }, [menu]);
  const run = async (edit: BookmarkEdit, after?: (count: number) => void) => { setBusy(true); try { const n = await window.gcp.editBookmarks(doc.id, edit); after?.(n); } catch (e) { onError(e); } finally { setBusy(false); } };
  const add = (child: boolean) => {
    const title = `Marcador ${flatten(items ?? []).length + 1}`, parent = child && selected ? selected : undefined;
    void run({ type: "add", title, page: currentPage, top: readingTop(), ...(parent ? { parent } : {}) }, () => {
      // The new bookmark is the last child of its parent: select it and open the name for typing.
      const siblings = parent ? find(items ?? [], parent)?.children.length ?? 0 : (items ?? []).length, path = [...(parent ?? []), siblings + 1];
      if (parent) setOpen((o) => new Set([...o, parent.join(".")]));
      setSelected(path); setRenaming(path);
    });
  };
  const selectedItem = selected && items ? find(items, selected) : null;
  const all = (expand: boolean) => setOpen(expand ? new Set(flatten(items ?? []).map((b) => b.path.join("."))) : new Set());
  function Row({ b, depth }: { b: Bookmark; depth: number }) {
    const key = b.path.join("."), expanded = open.has(key), active = same(selected, b.path);
    return (
      <>
        <div className={`bookmark-row ${active ? "active" : ""}`} style={{ paddingLeft: 6 + depth * 16, fontSize: size }} onClick={() => { setSelected(b.path); if (b.page >= 0) onGo(b.page, b.top); }} onDoubleClick={() => setRenaming(b.path)} onKeyDown={(e) => { if (e.key === "F2") setRenaming(b.path); if (e.key === "Delete") void run({ type: "delete", path: b.path }, () => setSelected(null)); }} tabIndex={0}>
          {b.children.length ? <button className="bookmark-twisty" onClick={(e) => { e.stopPropagation(); setOpen((o) => { const n = new Set(o); if (n.has(key)) n.delete(key); else n.add(key); return n; }); }}>{expanded ? <ChevronDown size={13} /> : <ChevronRight size={13} />}</button> : <span className="bookmark-twisty" />}
          <BookmarkIcon size={13} className="bookmark-icon" />
          {same(renaming, b.path) ? (
            <input autoFocus defaultValue={b.title} onClick={(e) => e.stopPropagation()} onFocus={(e) => e.currentTarget.select()} onKeyDown={(e) => { e.stopPropagation(); if (e.key === "Enter") e.currentTarget.blur(); if (e.key === "Escape") { setRenaming(null); } }}
              onBlur={(e) => { const title = e.currentTarget.value.trim(); setRenaming(null); if (title && title !== b.title) void run({ type: "rename", path: b.path, title }); }} />
          ) : <span className="bookmark-title" style={{ fontWeight: b.bold ? 700 : undefined }} title={b.page >= 0 ? `Página ${b.page + 1}` : "Destino fora deste documento"}>{b.title}</span>}
          {b.page >= 0 && <small>{b.page + 1}</small>}
        </div>
        {expanded && b.children.map((c) => <Row key={c.path.join(".")} b={c} depth={depth + 1} />)}
      </>
    );
  }
  return (
    <div className="bookmarks-panel">
      <div className="bookmarks-toolbar" ref={menuRef}>
        <button className="icon-button" title="Mais opções" onClick={() => setMenu(!menu)}><MoreHorizontal size={16} /></button>
        <span className="toolbar-divider" />
        <button className="icon-button" title="Adicionar marcador (no ponto que você está lendo)" disabled={busy} onClick={() => add(false)}><BookmarkPlus size={16} /></button>
        <button className="icon-button" title="Renomear · F2" disabled={!selected} onClick={() => setRenaming(selected)}><Pencil size={15} /></button>
        <button className="icon-button" title="Excluir · Delete" disabled={!selected || busy} onClick={() => selected && void run({ type: "delete", path: selected }, () => setSelected(null))}><Trash2 size={15} /></button>
        <button className="icon-button" title="Aumentar a fonte dos marcadores" onClick={() => setSize((s) => Math.min(20, s + 1))}><AArrowUp size={16} /></button>
        <button className="icon-button" title="Diminuir a fonte dos marcadores" onClick={() => setSize((s) => Math.max(10, s - 1))}><AArrowDown size={16} /></button>
        {busy && <LoaderCircle size={14} className="spin" />}
        {menu && (
          <div className="dropdown-menu bookmarks-menu">
            <button disabled={!selected} onClick={() => { setMenu(false); selected && void run({ type: "delete", path: selected }, () => setSelected(null)); }}><Trash2 size={14} /> Excluir marcador</button>
            <button disabled={!selected} onClick={() => { setMenu(false); setRenaming(selected); }}><Pencil size={14} /> Alterar nome do marcador</button>
            <button onClick={() => { setMenu(false); add(false); }}><BookmarkPlus size={14} /> Adicionar marcador</button>
            <button disabled={!selected} onClick={() => { setMenu(false); add(true); }}><FolderPlus size={14} /> Adicionar subgrupo</button>
            <button disabled={!selected} onClick={() => { setMenu(false); selected && void run({ type: "set-page", path: selected, page: currentPage }, () => notify(`Destino definido para a página ${currentPage + 1}.`)); }}><Flag size={14} /> Definir destino (página atual)</button>
            <button disabled={!selectedItem} onClick={() => { setMenu(false); selectedItem && void run({ type: "style", path: selectedItem.path, bold: !selectedItem.bold }); }}><Bold size={14} /> {selectedItem?.bold ? "Remover negrito" : "Negrito"}</button>
            <hr />
            <button disabled={!items?.length} onClick={() => { setMenu(false); all(true); }}><ListTree size={14} /> Expandir todos os marcadores</button>
            <button disabled={!items?.length} onClick={() => { setMenu(false); all(false); }}><ListTree size={14} /> Recolher todos os marcadores</button>
            <hr />
            <button onClick={() => { setMenu(false); void run({ type: "auto" }, (n) => notify(`${n} marcador${n > 1 ? "es criados" : " criado"} a partir dos títulos do documento.`)); }}><Wand2 size={14} /> Marcadores automáticos</button>
          </div>
        )}
      </div>
      {!items ? <div className="cert-loading"><LoaderCircle className="spin" size={16} /> Lendo marcadores…</div> : !items.length ? (
        <div className="bookmarks-empty">
          <BookmarkIcon size={30} />
          <p>Sem marcadores</p>
          <small>Marque o ponto que você está lendo para voltar a ele com um clique, ou crie a partir dos títulos do documento.</small>
          <button className="button primary" disabled={busy} onClick={() => void run({ type: "auto" }, (n) => notify(`${n} marcador${n > 1 ? "es criados" : " criado"} a partir dos títulos do documento.`))}><Wand2 size={15} /> Marcadores automáticos</button>
          <button className="button secondary" disabled={busy} onClick={() => add(false)}><BookmarkPlus size={15} /> Marcar esta posição</button>
        </div>
      ) : <div className="bookmarks-tree">{items.map((b) => <Row key={b.path.join(".")} b={b} depth={0} />)}</div>}
    </div>
  );
}
function flatten(list: Bookmark[]): Bookmark[] { return list.flatMap((b) => [b, ...flatten(b.children)]); }
function find(list: Bookmark[], path: number[]): Bookmark | null { let level = list, hit: Bookmark | null = null; for (const n of path) { hit = level[n - 1] ?? null; if (!hit) return null; level = hit.children; } return hit; }
