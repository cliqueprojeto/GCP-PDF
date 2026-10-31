import {t as translateUi} from "./i18n";
import { useEffect, useMemo, useRef, useState } from "react";
import { BookOpen, ImagePlus, Plus, Trash2, LoaderCircle, Wand2, FileImage, Ban } from "lucide-react";
import { Modal } from "./Dialogs";
import type { DocumentInfo, EpubAnalysis, EpubChapter, EpubOptions } from "../shared/types";

/** Converter > EPUB: chapters found automatically (bookmarks or headings), editable before converting;
 * a cover generated from a bank of designs, the first page or an image; and the metadata library apps
 * use to file the book (title, author, year, genre, publisher, language). */
const GENRES = ["Romance", "Conto", "Crônica", "Poesia", "Ficção científica", "Fantasia", "Suspense", "Biografia", "Memórias", "História", "Ensaio", "Filosofia", "Educação", "Didático", "Infantojuvenil", "Religião", "Autoajuda", "Negócios", "Cultura", "Arte", "Tecnologia", "Relatório", "Manual"];
interface Design { id: string; name: string; background: [string, string]; ink: string; accent: string; serif: boolean; layout: "center" | "band" | "frame" | "split" | "stripes" | "minimal" }
export const COVER_DESIGNS: Design[] = [
  { id: "classico", name: "Clássico", background: ["#1d2b44", "#0f1829"], ink: "#f4ead5", accent: "#c9a45c", serif: true, layout: "frame" },
  { id: "aurora", name: "Aurora", background: ["#6d35d5", "#e0477a"], ink: "#ffffff", accent: "#ffd58a", serif: false, layout: "center" },
  { id: "papel", name: "Papel", background: ["#f3eee3", "#e6dcc8"], ink: "#2b2622", accent: "#a2452f", serif: true, layout: "minimal" },
  { id: "floresta", name: "Floresta", background: ["#16463a", "#0b2a22"], ink: "#eef5e9", accent: "#8bc48a", serif: true, layout: "band" },
  { id: "editorial", name: "Editorial", background: ["#ffffff", "#f1f1f1"], ink: "#111111", accent: "#e4572e", serif: false, layout: "split" },
  { id: "noite", name: "Noite", background: ["#0d0d12", "#24243a"], ink: "#e9e6ff", accent: "#7c6cff", serif: false, layout: "stripes" },
  { id: "terra", name: "Terra", background: ["#8c3b1f", "#c06a2b"], ink: "#fff4e3", accent: "#2a1408", serif: true, layout: "center" },
  { id: "oceano", name: "Oceano", background: ["#0b5d7a", "#0a2e4d"], ink: "#ffffff", accent: "#5fe0d0", serif: false, layout: "band" },
  { id: "festa", name: "Festa popular", background: ["#8c1a3c", "#5d0f27"], ink: "#ffffff", accent: "#f2c12e", serif: false, layout: "stripes" },
  { id: "jornal", name: "Jornal", background: ["#f7f5ef", "#ebe7dc"], ink: "#1a1a1a", accent: "#1a1a1a", serif: true, layout: "frame" },
];

/** Draws a 1600×2560 cover (the size e-book stores ask for) with title, author, year and genre. */
export function drawCover(canvas: HTMLCanvasElement, d: Design, text: { title: string; author: string; year?: string; genre?: string }) {
  const W = 1600, H = 2560, c = canvas.getContext("2d")!;
  canvas.width = W; canvas.height = H;
  const g = c.createLinearGradient(0, 0, W * 0.4, H); g.addColorStop(0, d.background[0]); g.addColorStop(1, d.background[1]);
  c.fillStyle = g; c.fillRect(0, 0, W, H);
  const family = d.serif ? 'Georgia, "Times New Roman", serif' : '"Segoe UI", Inter, Arial, sans-serif';
  c.fillStyle = d.accent; c.strokeStyle = d.accent;
  if (d.layout === "frame") { c.lineWidth = 10; c.strokeRect(90, 90, W - 180, H - 180); c.lineWidth = 3; c.strokeRect(120, 120, W - 240, H - 240); }
  if (d.layout === "band") c.fillRect(0, H * 0.58, W, 26);
  if (d.layout === "split") c.fillRect(0, 0, 70, H);
  if (d.layout === "stripes") for (let i = 0; i < 9; i++) { c.globalAlpha = 0.16 + (i % 3) * 0.08; c.fillRect(0, H - 520 + i * 40, W, 18); }
  c.globalAlpha = 1;
  if (d.layout === "center" || d.layout === "minimal") { c.beginPath(); c.arc(W / 2, H * 0.28, d.layout === "center" ? 200 : 8, 0, Math.PI * 2); c.globalAlpha = d.layout === "center" ? 0.22 : 1; c.fill(); c.globalAlpha = 1; }
  // The title wraps into lines that fit, with the size shrinking for long titles.
  const wrap = (value: string, size: number, width: number, weight: number) => {
    c.font = `${weight} ${size}px ${family}`;
    const lines: string[] = []; let line = "";
    for (const word of value.split(/\s+/).filter(Boolean)) { const next = line ? `${line} ${word}` : word; if (c.measureText(next).width > width && line) { lines.push(line); line = word; } else line = next; }
    if (line) lines.push(line);
    return lines;
  };
  const left = d.layout === "split" ? 180 : 0, width = W - (d.layout === "split" ? 300 : 300), x = d.layout === "split" ? left : W / 2;
  c.textAlign = d.layout === "split" ? "left" : "center"; c.textBaseline = "alphabetic";
  let size = 170, lines = wrap(text.title || "Sem título", size, width, 800);
  while (lines.length > 5 && size > 80) { size -= 12; lines = wrap(text.title || "Sem título", size, width, 800); }
  const top = d.layout === "band" ? H * 0.56 - lines.length * size * 1.08 : d.layout === "split" ? H * 0.22 : H * 0.42;
  c.fillStyle = d.ink; c.font = `800 ${size}px ${family}`;
  lines.forEach((l, i) => c.fillText(l, x, top + size + i * size * 1.08));
  const below = top + size + lines.length * size * 1.08 + 40;
  if (text.genre) { c.fillStyle = d.accent; c.font = `600 54px ${family}`; c.fillText(text.genre.toUpperCase().split("").join(" "), x, d.layout === "band" ? H * 0.58 - 60 - lines.length * size * 1.08 - size : below + 30); }
  c.fillStyle = d.ink; c.font = `500 84px ${family}`;
  if (text.author) c.fillText(text.author, x, d.layout === "stripes" ? H - 620 : H * 0.8);
  if (text.year) { c.globalAlpha = 0.75; c.font = `400 56px ${family}`; c.fillText(text.year, x, d.layout === "stripes" ? H - 540 : H * 0.8 + 100); c.globalAlpha = 1; }
}

type CoverChoice = { kind: "design"; design: string } | { kind: "page" } | { kind: "image"; dataUrl: string } | { kind: "none" };

export function EpubDialog({ doc, onClose, onDone, onError }: { doc: DocumentInfo; onClose: () => void; onDone: (path: string) => void; onError: (error: unknown) => void }) {
  const [analysis, setAnalysis] = useState<EpubAnalysis | null>(null), [busy, setBusy] = useState(false);
  const [title, setTitle] = useState(""), [author, setAuthor] = useState(""), [year, setYear] = useState(String(new Date().getFullYear())), [genre, setGenre] = useState(""), [publisher, setPublisher] = useState(""), [description, setDescription] = useState(""), [language, setLanguage] = useState<EpubOptions["language"]>("pt-BR");
  const [chapters, setChapters] = useState<EpubChapter[]>([]), [cover, setCover] = useState<CoverChoice>({ kind: "design", design: COVER_DESIGNS[0]!.id }), [firstPage, setFirstPage] = useState<string | null>(null);
  const preview = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    void window.gcp.analyzeEpub(doc.id).then((a) => {
      setAnalysis(a); setChapters(a.chapters);
      setTitle(a.title || doc.name.replace(/\.pdf$/i, "")); setAuthor(a.author);
    }).catch((error) => { onError(error); onClose(); });
    void window.gcp.epubPagePreview(doc.id, 0).then(setFirstPage).catch(() => {});
  }, []);
  const design = cover.kind === "design" ? COVER_DESIGNS.find((d) => d.id === cover.design) ?? COVER_DESIGNS[0]! : null;
  useEffect(() => { if (design && preview.current) drawCover(preview.current, design, { title, author, year, genre }); }, [design?.id, title, author, year, genre, analysis]);
  const thumbs = useMemo(() => COVER_DESIGNS.map((d) => { const canvas = document.createElement("canvas"); drawCover(canvas, d, { title: title || "Título", author: author || "Autor", year, genre }); const small = document.createElement("canvas"); small.width = 160; small.height = 256; small.getContext("2d")!.drawImage(canvas, 0, 0, 160, 256); return { id: d.id, name: d.name, url: small.toDataURL("image/jpeg", 0.8) }; }), [title, author, year, genre, !!analysis]);
  async function convert() {
    let coverUrl: string | undefined;
    if (cover.kind === "design" && preview.current) coverUrl = preview.current.toDataURL("image/jpeg", 0.9);
    else if (cover.kind === "page" && firstPage) coverUrl = firstPage;
    else if (cover.kind === "image") coverUrl = cover.dataUrl;
    setBusy(true);
    try {
      const path = await window.gcp.exportEpub(doc.id, { title, author, year, genre, publisher, description, language, chapters: chapters.filter((c) => c.title.trim()), ...(coverUrl ? { cover: coverUrl } : {}) });
      if (path) onDone(path);
    } catch (error) { onError(error); } finally { setBusy(false); }
  }
  const pages = analysis?.pages ?? doc.pageCount;
  return (
    <Modal title={translateUi("Converter para EPUB (livro digital)")} description={translateUi("Capítulos, sumário e notas de rodapé com links de ida e volta, para ler bem no celular, no leitor de e-book e no computador.")} onClose={onClose} wide>
      {!analysis ? <p className="lookup-note"><LoaderCircle size={15} className="spin" />{" "}{translateUi("Lendo o documento e procurando capítulos e notas…")}</p> : (
        <div className="epub-dialog">
          <section className="epub-meta">
            <h3>{translateUi("Dados do livro")}</h3>
            <label className="field">{translateUi("Título")}<input value={title} onChange={(e) => setTitle(e.target.value)} /></label>
            <label className="field">{translateUi("Autor(a)")}<input value={author} onChange={(e) => setAuthor(e.target.value)} placeholder={translateUi("Nome e sobrenome")} /></label>
            <div className="field-row">
              <label className="field">{translateUi("Ano")}<input value={year} inputMode="numeric" maxLength={4} onChange={(e) => setYear(e.target.value.replace(/\D/g, ""))} /></label>
              <label className="field">{translateUi("Idioma")}<select value={language} onChange={(e) => setLanguage(e.target.value as EpubOptions["language"])}><option value="pt-BR">{translateUi("Português (Brasil)")}</option><option value="en">{translateUi("Inglês")}</option><option value="es">{translateUi("Espanhol")}</option></select></label>
            </div>
            <label className="field">{translateUi("Gênero (separe por vírgulas)")}<input value={genre} list="epub-genres" onChange={(e) => setGenre(e.target.value)} /></label>
            <datalist id="epub-genres">{GENRES.map((g) => <option key={g} value={g} />)}</datalist>
            <label className="field">{translateUi("Editora ou instituição")}<input value={publisher} onChange={(e) => setPublisher(e.target.value)} /></label>
            <label className="field">{translateUi("Sinopse")}<textarea rows={3} value={description} onChange={(e) => setDescription(e.target.value)} /></label>
            <p className="compress-note">{translateUi("Esses dados vão para os metadados do EPUB: bibliotecas como Apple Livros, Google Play Livros, Kobo e Calibre organizam o livro por eles.")}</p>
          </section>
          <section className="epub-chapters">
            <h3>{translateUi("Capítulos")}{" "}<span className="muted">({chapters.length})</span></h3>
            <p className="compress-note">{analysis.source === "outline" ? translateUi("Encontrados nos marcadores do PDF.") : analysis.source === "headings" ? translateUi("Encontrados pelos títulos maiores do texto. Confira e ajuste.") : translateUi("Nenhum título encontrado: o livro terá um capítulo único, ou adicione capítulos abaixo.")}{analysis.footnotes ? ` ${analysis.footnotes} ${translateUi("notas de rodapé serão ligadas ao texto.")}` : ""}</p>
            <div className="epub-chapter-list">
              {chapters.map((c, i) => (
                <div key={i} className={`epub-chapter level-${c.level}`}>
                  <input aria-label={translateUi("Título do capítulo")} value={c.title} onChange={(e) => setChapters(chapters.map((x, j) => j === i ? { ...x, title: e.target.value } : x))} />
                  <label className="epub-page" title={translateUi("Página onde começa")}>{translateUi("pág.")}<input type="number" min={1} max={pages} value={c.page + 1} onChange={(e) => setChapters(chapters.map((x, j) => j === i ? { ...x, page: Math.max(0, Math.min(pages - 1, Number(e.target.value) - 1)) } : x))} /></label>
                  <button className="icon-button" title={c.level === 1 ? translateUi("Tornar seção (nível 2)") : translateUi("Tornar capítulo (nível 1)")} onClick={() => setChapters(chapters.map((x, j) => j === i ? { ...x, level: x.level === 1 ? 2 : 1 } : x))}>{c.level === 1 ? "1" : "2"}</button>
                  <button className="icon-button" title={translateUi("Remover")} onClick={() => setChapters(chapters.filter((_, j) => j !== i))}><Trash2 size={13} /></button>
                </div>
              ))}
            </div>
            <button className="text-button" onClick={() => setChapters([...chapters, { title: `Capítulo ${chapters.length + 1}`, page: Math.min(pages - 1, (chapters.at(-1)?.page ?? -1) + 1), level: 1 as const }].sort((a, b) => a.page - b.page))}><Plus size={14} />{" "}{translateUi("Adicionar capítulo")}</button>
          </section>
          <section className="epub-cover">
            <h3>{translateUi("Capa")}</h3>
            <div className="segmented lookup-modes">
              <button className={cover.kind === "design" ? "active" : ""} onClick={() => setCover({ kind: "design", design: design?.id ?? COVER_DESIGNS[0]!.id })}><Wand2 size={13} />{" "}{translateUi("Gerar")}</button>
              <button className={cover.kind === "page" ? "active" : ""} disabled={!firstPage} onClick={() => setCover({ kind: "page" })}><FileImage size={13} />{" "}{translateUi("1ª página")}</button>
              <button className={cover.kind === "image" ? "active" : ""} onClick={() => void window.gcp.chooseImage().then((img) => img && setCover({ kind: "image", dataUrl: img.dataUrl })).catch(onError)}><ImagePlus size={13} />{" "}{translateUi("Imagem")}</button>
              <button className={cover.kind === "none" ? "active" : ""} onClick={() => setCover({ kind: "none" })}><Ban size={13} />{" "}{translateUi("Sem capa")}</button>
            </div>
            <div className="epub-cover-stage">
              {cover.kind === "design" && <canvas ref={preview} className="epub-cover-preview" />}
              {cover.kind === "page" && firstPage && <img className="epub-cover-preview" src={firstPage} alt="" />}
              {cover.kind === "image" && <img className="epub-cover-preview" src={cover.dataUrl} alt="" />}
              {cover.kind === "none" && <div className="epub-cover-preview empty">{translateUi("Sem capa")}</div>}
            </div>
            {cover.kind === "design" && <div className="epub-designs">{thumbs.map((t) => <button key={t.id} className={design?.id === t.id ? "selected" : ""} title={t.name} onClick={() => setCover({ kind: "design", design: t.id })}><img src={t.url} alt={t.name} /></button>)}</div>}
          </section>
        </div>
      )}
      <div className="modal-footer">
        <button className="button secondary" onClick={onClose}>{translateUi("Cancelar")}</button>
        <button className="button primary" disabled={!analysis || busy || !title.trim()} onClick={() => void convert()}>{busy ? <LoaderCircle size={15} className="spin" /> : <BookOpen size={15} />}{" "}{translateUi("Gerar EPUB")}</button>
      </div>
    </Modal>
  );
}
