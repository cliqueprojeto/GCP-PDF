import React, { useEffect, useMemo, useRef, useState } from "react";
import { FileCog, GitCompareArrows, LoaderCircle, FolderOpen, X, ChevronUp, ChevronDown, FileText, Type } from "lucide-react";
import type { DocumentInfo, DocumentMetadata, DocumentStats, PageRef, PdfOperation } from "../shared/types";
import { Modal } from "./Dialogs";
import { PageThumb } from "./Viewer";
import { loadPage, pdfjs } from "./pdf";
import type {PDFDocumentProxy} from "pdfjs-dist";

const bytes = (n: number) => (n >= 1048576 ? `${(n / 1048576).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} MB` : `${Math.max(1, Math.round(n / 1024)).toLocaleString("pt-BR")} KB`);
const number = (n: number) => n.toLocaleString("pt-BR");
const PAPERS: [string, number, number][] = [["A4", 210, 297], ["A3", 297, 420], ["A5", 148, 210], ["Carta", 216, 279], ["Ofício", 216, 356]];
function paper(width: number, height: number) {
  const mm = (pt: number) => Math.round((pt / 72) * 25.4), w = mm(width), h = mm(height), [a, b] = [Math.min(w, h), Math.max(w, h)];
  const name = PAPERS.find(([, x, y]) => Math.abs(x - a) <= 2 && Math.abs(y - b) <= 2)?.[0];
  return `${w} × ${h} mm${name ? ` (${name}${w > h ? ", paisagem" : ""})` : ""}`;
}

/** Revisar > Propriedades: the PDF's description (title, author…) editable, plus file facts. */
export function PropertiesDialog({ doc, onClose, onError, onSaved }: { doc: DocumentInfo; onClose: () => void; onError: (e: unknown) => void; onSaved: () => void }) {
  const [info, setInfo] = useState<Awaited<ReturnType<typeof window.gcp.getProperties>> | null>(null), [form, setForm] = useState<Partial<DocumentMetadata>>({});
  useEffect(() => { void window.gcp.getProperties(doc.id).then((value) => { setInfo(value); setForm({ title: value.title, author: value.author, subject: value.subject, keywords: value.keywords, creator: value.creator, producer: value.producer }); }).catch(onError); }, [doc.id]);
  const date = (iso?: string) => (iso ? new Date(iso).toLocaleString("pt-BR", { dateStyle: "long", timeStyle: "short" }) : "—");
  const field = (key: keyof DocumentMetadata, label: string, placeholder = "") => <label className="field">{label}<input value={(form[key] as string) ?? ""} placeholder={placeholder} onChange={(e) => setForm({ ...form, [key]: e.target.value })} /></label>;
  return (
    <Modal title="Propriedades do documento" description={doc.name} onClose={onClose} wide>
      {!info ? <div className="cert-loading"><LoaderCircle className="spin" size={18} /> Lendo propriedades…</div> : (
        <div className="props-grid">
          <section>
            <h3>Descrição</h3>
            {field("title", "Título", "Ex.: Prestação de contas — Projeto Paraíso")}
            {field("author", "Autor", "Pessoa ou instituição")}
            {field("subject", "Assunto")}
            {field("keywords", "Palavras-chave", "Separe por vírgulas")}
            <div className="field-row">{field("creator", "Aplicativo de criação")}{field("producer", "Produtor do PDF")}</div>
          </section>
          <section className="props-facts">
            <h3>Arquivo</h3>
            <dl>
              <dt>Local</dt><dd title={info.path}>{info.path ?? "Ainda não salvo"}</dd>
              <dt>Tamanho</dt><dd>{info.fileSize ? bytes(info.fileSize) : "—"}</dd>
              <dt>Páginas</dt><dd>{number(info.pageCount)}</dd>
              <dt>Tamanho da página</dt><dd>{paper(info.pageSize.width, info.pageSize.height)}</dd>
              <dt>Versão do PDF</dt><dd>{info.version || "—"}</dd>
              <dt>Criado em</dt><dd>{date(info.created)}</dd>
              <dt>Modificado em</dt><dd>{date(info.modified)}</dd>
              <dt>Segurança</dt><dd>{info.encrypted ? "Protegido por senha" : "Sem proteção"}</dd>
            </dl>
          </section>
        </div>
      )}
      <div className="modal-footer">
        <span className="footer-note">As alterações entram no PDF ao salvar.</span>
        <button className="button secondary" onClick={onClose}>Cancelar</button>
        <button className="button primary" disabled={!info} onClick={() => void window.gcp.applyOperation(doc.id, { type: "set-metadata", values: form } as PdfOperation, doc.revision).then(() => { onSaved(); onClose(); }).catch(onError)}><FileCog size={15} /> Aplicar</button>
      </div>
    </Modal>
  );
}

/** Revisar > Estatísticas: counts and the heaviest pages, with what makes them heavy. */
export function StatsDialog({ doc, onClose, onError, onGoto }: { doc: DocumentInfo; onClose: () => void; onError: (e: unknown) => void; onGoto: (page: number) => void }) {
  const [stats, setStats] = useState<DocumentStats | null>(null);
  useEffect(() => { void window.gcp.documentStats(doc.id).then(setStats).catch((e) => { onError(e); onClose(); }); }, [doc.id]);
  const heavy = useMemo(() => (stats ? [...stats.pages].sort((a, b) => b.total - a.total).slice(0, 8) : []), [stats]);
  const max = heavy[0]?.total || 1;
  return (
    <Modal title="Estatísticas do documento" description={doc.name} onClose={onClose} wide>
      {!stats ? <div className="cert-loading"><LoaderCircle className="spin" size={18} /> Contando palavras e pesando as páginas…</div> : (
        <div className="stats">
          <div className="stat-cards">
            {([["Palavras", number(stats.words)], ["Caracteres (com espaços)", number(stats.characters)], ["Caracteres (sem espaços)", number(stats.charactersNoSpaces)], ["Linhas", number(stats.lines)], ["Páginas", number(stats.pageCount)], ["Imagens", number(stats.images)], ["Anotações", number(stats.annotations)], ["Tamanho do PDF", bytes(stats.size)]] as const).map(([label, value]) => (
              <div key={label} className="stat-card"><strong>{value}</strong><span>{label}</span></div>
            ))}
          </div>
          <div className="stats-columns">
            <section>
              <h3>Páginas mais pesadas</h3>
              <div className="heavy-list">
                {heavy.map((p) => (
                  <button key={p.page} className="heavy-row" onClick={() => { onGoto(p.page - 1); onClose(); }} title="Ir para a página">
                    <span className="heavy-page">Pág. {p.page}</span>
                    <span className="heavy-bar">
                      <span className="seg images" style={{ width: `${(p.images / max) * 100}%` }} />
                      <span className="seg fonts" style={{ width: `${(p.fonts / max) * 100}%` }} />
                      <span className="seg content" style={{ width: `${(p.content / max) * 100}%` }} />
                    </span>
                    <span className="heavy-size">{bytes(p.total)}</span>
                    <small>{p.imageCount ? `${p.imageCount} ${p.imageCount > 1 ? "imagens" : "imagem"} ${bytes(p.images)}` : "sem imagens"} · fontes {bytes(p.fonts)} · conteúdo {bytes(p.content)} · {number(p.words)} palavras</small>
                  </button>
                ))}
              </div>
              <div className="legend"><span><i className="images" /> Imagens</span><span><i className="fonts" /> Fontes</span><span><i className="content" /> Texto e vetores</span></div>
              <p className="footer-note">Recursos compartilhados (como uma fonte usada em várias páginas) são contados em cada página que os usa. Para reduzir, use Comprimir PDF.</p>
            </section>
            <section>
              <h3>Fontes usadas ({stats.fonts.length})</h3>
              <ul className="font-list">{stats.fonts.map((f) => <li key={f}><Type size={13} /> {f}</li>)}</ul>
            </section>
          </div>
        </div>
      )}
      <div className="modal-footer"><button className="button primary" onClick={onClose}>Fechar</button></div>
    </Modal>
  );
}

interface Word { text: string; page: number; x: number; y: number; width: number; height: number }
interface Change { kind: "changed" | "deleted" | "inserted"; a: Word[]; b: Word[] }
/** Words of a document with their boxes (page points, top-left, the page's displayed rotation). */
async function documentWords(pdf: PDFDocumentProxy): Promise<Word[]> {
  const out: Word[] = [];
  for (let index=0;index<pdf.numPages;index++) {
    const page = await pdf.getPage(index+1), viewport = page.getViewport({ scale: 1 }), content = await page.getTextContent();
    for (const item of content.items) {
      if (!("str" in item) || !item.str.trim()) continue;
      const [a, b, c, d, e, f] = item.transform as number[];
      const total = item.str.length || 1, re = /\S+/g;
      for (let m = re.exec(item.str); m; m = re.exec(item.str)) {
        // Word boxes are proportional to their characters within the item: close enough to point at a change.
        const start = (m.index / total) * item.width, width = (m[0].length / total) * item.width, dir = Math.hypot(a!, b!) || 1;
        const x0 = e! + (a! / dir) * start, y0 = f! + (b! / dir) * start, x1 = x0 + (a! / dir) * width, y1 = y0 + (b! / dir) * width;
        // Baseline ends plus the same points raised by the text's up vector (c, d): the word's quadrilateral.
        const p = [viewport.convertToViewportPoint(x0, y0), viewport.convertToViewportPoint(x1, y1), viewport.convertToViewportPoint(x0 + c!, y0 + d!), viewport.convertToViewportPoint(x1 + c!, y1 + d!)];
        const xs = p.map((q) => q[0]!), ys = p.map((q) => q[1]!);
        out.push({ text: m[0], page: index, x: Math.min(...xs), y: Math.min(...ys), width: Math.max(...xs) - Math.min(...xs), height: Math.max(...ys) - Math.min(...ys) });
      }
    }
  }
  return out;
}
/** Myers' O(ND) diff over words; returns runs of equal / deleted / inserted words. */
function diffWords(a: string[], b: string[]): { op: "=" | "-" | "+"; i: number; j: number }[] {
  const n = a.length, m = b.length, max = n + m, v = new Int32Array(2 * max + 2), trace: Int32Array[] = [];
  let found = false;
  for (let d = 0; d <= max && !found; d++) {
    trace.push(v.slice());
    for (let k = -d; k <= d; k += 2) {
      let x = k === -d || (k !== d && v[max + k - 1]! < v[max + k + 1]!) ? v[max + k + 1]! : v[max + k - 1]! + 1, y = x - k;
      while (x < n && y < m && a[x] === b[y]) { x++; y++; }
      v[max + k] = x;
      if (x >= n && y >= m) { found = true; break; }
    }
    if ((trace.length*(2*max+2)*4)>64*1024*1024) throw new Error("Os documentos são diferentes demais para comparar palavra a palavra.");
  }
  const ops: { op: "=" | "-" | "+"; i: number; j: number }[] = [];
  let x = n, y = m;
  for (let d = trace.length - 1; d >= 0; d--) {
    const t = trace[d]!, k = x - y, prevK = k === -d || (k !== d && t[max + k - 1]! < t[max + k + 1]!) ? k + 1 : k - 1, px = t[max + prevK]!, py = px - prevK;
    while (x > px && y > py) ops.push({ op: "=", i: --x, j: --y });
    if (d > 0) ops.push(x === px ? { op: "+", i: x, j: --y } : { op: "-", i: --x, j: y });
    x = px; y = py;
  }
  return ops.reverse();
}
function changesOf(a: Word[], b: Word[]): Change[] {
  const norm = (w: Word) => w.text.normalize("NFC");
  const ops = diffWords(a.map(norm), b.map(norm)), changes: Change[] = [];
  let current: Change | null = null;
  for (const op of ops) {
    if (op.op === "=") { current = null; continue; }
    if (!current) { current = { kind: "changed", a: [], b: [] }; changes.push(current); }
    if (op.op === "-") current.a.push(a[op.i]!); else current.b.push(b[op.j]!);
  }
  for (const c of changes) c.kind = c.a.length && c.b.length ? "changed" : c.a.length ? "deleted" : "inserted";
  return changes;
}
async function comparisonPixels(pdf:PDFDocumentProxy,index:number){const page=await pdf.getPage(index+1),viewport=page.getViewport({scale:.35}),canvas=document.createElement('canvas');canvas.width=Math.ceil(viewport.width);canvas.height=Math.ceil(viewport.height);const context=canvas.getContext('2d')!;await page.render({canvas,canvasContext:context,viewport}).promise;return {width:canvas.width,height:canvas.height,pixels:context.getImageData(0,0,canvas.width,canvas.height).data};}
function ComparePage({ pdf, index, width, marks, focus }: { pdf:PDFDocumentProxy; index:number;width:number;marks:{word:Word;kind:string;change:number}[];focus:number }) {
 const canvas=useRef<HTMLCanvasElement>(null),host=useRef<HTMLDivElement>(null),[visible,setVisible]=useState(false),[size,setSize]=useState({width:595,height:842});
 useEffect(()=>{const observer=new IntersectionObserver(entries=>{if(entries.some(entry=>entry.isIntersecting)){setVisible(true);observer.disconnect();}},{rootMargin:'500px'});if(host.current)observer.observe(host.current);return()=>observer.disconnect();},[pdf,index]);
 useEffect(()=>{if(!visible)return;let gone=false,task:ReturnType<import('pdfjs-dist').PDFPageProxy['render']>|undefined;void pdf.getPage(index+1).then(async page=>{if(gone||!canvas.current)return;const base=page.getViewport({scale:1});setSize({width:base.width,height:base.height});const viewport=page.getViewport({scale:width/base.width}),c=canvas.current;c.width=Math.ceil(viewport.width);c.height=Math.ceil(viewport.height);task=page.render({canvas:c,canvasContext:c.getContext('2d')!,viewport});await task.promise;}).catch(()=>{});return()=>{gone=true;task?.cancel();};},[pdf,index,width,visible]);
 const scale=width/size.width;return <div ref={host} className="compare-page" data-compare-page={index} style={{width,height:size.height*scale}}><canvas ref={canvas}/>{marks.map((m,i)=><span key={i} data-change={m.change} className={`compare-mark ${m.kind} ${m.change===focus?'focus':''}`} style={{left:m.word.x*scale,top:m.word.y*scale,width:m.word.width*scale,height:m.word.height*scale}}/>)}<span className="compare-page-number">{index+1}</span></div>;
}
/** Revisar > Comparar: two versions side by side in this window, every difference marked and listed. */
export function CompareView({ documents, first, onClose, onOpen }: { documents: DocumentInfo[]; first: string; onClose: () => void; onOpen: () => Promise<void> }) {
  const a = documents.find((d) => d.id === first), others = documents.filter((d) => d.id !== first);
  const [second, setSecond] = useState<string>(others.at(-1)?.id ?? ""), [result, setResult] = useState<{ changes: Change[]; words: [number, number] } | null>(null);
  const [pair,setPair]=useState<[PDFDocumentProxy,PDFDocumentProxy]|null>(null);
  const [busy, setBusy] = useState(false), [error, setError] = useState(""), [focus, setFocus] = useState(0);
  const left = useRef<HTMLDivElement>(null), right = useRef<HTMLDivElement>(null), count = useRef(documents.length), [width, setWidth] = useState(420);
  const b = documents.find((d) => d.id === second);
  // A file opened from here becomes the second document.
  useEffect(() => { if (documents.length > count.current) { const added = documents.at(-1); if (added && added.id !== first) setSecond(added.id); } count.current = documents.length; }, [documents.length]);
  useEffect(() => { const resize = () => setWidth(Math.max(240, Math.min(620, (window.innerWidth - 420) / 2))); resize(); window.addEventListener("resize", resize); return () => window.removeEventListener("resize", resize); }, []);
  useEffect(() => {
    if (!a || !b) { setResult(null); return; }
    let alive = true;let owned:PDFDocumentProxy[]=[];
    setPair(null);setBusy(true); setError(""); setResult(null); setFocus(0);
    void (async () => {
      const raw=await Promise.all([window.gcp.getComparisonPdf(a.id),window.gcp.getComparisonPdf(b.id)]);
      const docs=await Promise.all(raw.map(data=>pdfjs.getDocument({data}).promise));owned=docs;const [pa,pb]=docs as [PDFDocumentProxy,PDFDocumentProxy];if(!alive){await Promise.all(docs.map(d=>d.loadingTask.destroy()));return;}setPair([pa,pb]);
      const [wa, wb] = await Promise.all([documentWords(pa), documentWords(pb)]);
      await new Promise((r) => setTimeout(r, 0));
      const changes = changesOf(wa, wb);
      for(let index=0;index<Math.max(pa.numPages,pb.numPages)&&alive;index++){
       if(changes.some(c=>[...c.a,...c.b].some(w=>w.page===index)))continue;
       let different=index>=pa.numPages||index>=pb.numPages;
       if(!different){const [x,y]=await Promise.all([comparisonPixels(pa,index),comparisonPixels(pb,index)]);different=x.width!==y.width||x.height!==y.height||x.pixels.some((value,i)=>value!==y.pixels[i]);}
       if(different){const word={text:'Alteração visual (imagem, forma, cor ou diagramação)',page:index,x:0,y:0,width:595,height:842};changes.push({kind:index>=pa.numPages?'inserted':index>=pb.numPages?'deleted':'changed',a:index<pa.numPages?[word]:[],b:index<pb.numPages?[word]:[]});}
      }
      if (alive) setResult({ changes, words: [wa.length, wb.length] });
    })().catch((e) => alive && setError(e instanceof Error ? e.message : String(e))).finally(() => alive && setBusy(false));
    return () => { alive = false;for(const pdf of owned)void pdf.loadingTask.destroy().catch(()=>{}); };
  }, [a?.id, a?.revision, b?.id, b?.revision]);
  const marks = useMemo(() => {
    const side = (pick: "a" | "b") => { const map = new Map<number, { word: Word; kind: string; change: number }[]>(); result?.changes.forEach((c, n) => { for (const word of c[pick]) { const list = map.get(word.page) ?? []; list.push({ word, kind: c.kind, change: n }); map.set(word.page, list); } }); return map; };
    return { a: side("a"), b: side("b") };
  }, [result]);
  function go(n: number) {
    if (!result?.changes.length) return;
    const index = (n + result.changes.length) % result.changes.length;
    setFocus(index);
    requestAnimationFrame(() => { for (const column of [left.current, right.current]) column?.querySelector<HTMLElement>(`[data-change="${index}"]`)?.scrollIntoView({ block: "center", behavior: "smooth" }); });
  }
  const totals = result ? { changed: result.changes.filter((c) => c.kind === "changed").length, deleted: result.changes.filter((c) => c.kind === "deleted").length, inserted: result.changes.filter((c) => c.kind === "inserted").length } : null;
  return (
    <div className="compare-view" role="dialog" aria-label="Comparar documentos">
      <header className="compare-header">
        <GitCompareArrows size={18} />
        <strong>Comparar documentos</strong>
        <span className="compare-file a" title={a?.name}><FileText size={14} /> {a?.name ?? "—"}</span>
        <span className="compare-vs">com</span>
        <select value={second} onChange={(e) => setSecond(e.target.value)}>
          {!others.length && <option value="">Abra o outro PDF…</option>}
          {others.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
        </select>
        <button className="button secondary" onClick={() => void onOpen()}><FolderOpen size={14} /> Abrir outro PDF</button>
        {totals && <span className="compare-totals"><b className="changed">{totals.changed} alterações</b><b className="deleted">{totals.deleted} exclusões</b><b className="inserted">{totals.inserted} inserções</b></span>}
        <button className="icon-button" title="Fechar comparação" onClick={onClose}><X size={18} /></button>
      </header>
      <div className="compare-body">
        <aside className="compare-list">
          <div className="compare-nav"><span>{result?.changes.length ? `${focus + 1} de ${result.changes.length}` : busy ? "Comparando…" : error ? "Comparação não concluída" : !result ? "Selecione dois documentos" : "Nenhuma diferença"}</span><button className="icon-button" title="Diferença anterior" onClick={() => go(focus - 1)}><ChevronUp size={16} /></button><button className="icon-button" title="Próxima diferença" onClick={() => go(focus + 1)}><ChevronDown size={16} /></button></div>
          {busy && <div className="cert-loading"><LoaderCircle className="spin" size={16} /> Lendo e comparando o texto…</div>}
          {error && <p className="quick-error">{error}</p>}
          {!busy && result && !result.changes.length && <p className="sidebar-description">Texto e aparência renderizada dos documentos são iguais ({number(result.words[0])} palavras).</p>}
          {result?.changes.slice(0, 2000).map((c, n) => (
            <button key={n} className={`compare-item ${c.kind} ${n === focus ? "active" : ""}`} onClick={() => go(n)}>
              <small>{c.kind === "changed" ? "Alterado" : c.kind === "deleted" ? "Excluído" : "Inserido"} · pág. {(c.a[0]?.page ?? c.b[0]!.page) + 1}</small>
              {c.a.length > 0 && <del>{c.a.map((w) => w.text).join(" ").slice(0, 160)}</del>}
              {c.b.length > 0 && <ins>{c.b.map((w) => w.text).join(" ").slice(0, 160)}</ins>}
            </button>
          ))}
        </aside>
        <div className="compare-column" ref={left}>{pair && Array.from({length:pair[0].numPages},(_,i) => <ComparePage key={i} pdf={pair[0]} index={i} width={width} marks={marks.a.get(i) ?? []} focus={focus} />)}</div>
        <div className="compare-column" ref={right}>{pair ? Array.from({length:pair[1].numPages},(_,i) => <ComparePage key={i} pdf={pair[1]} index={i} width={width} marks={marks.b.get(i) ?? []} focus={focus} />) : <div className="compare-empty"><FolderOpen size={28} /><p>Abra a outra versão do PDF para comparar.</p></div>}</div>
      </div>
    </div>
  );
}
