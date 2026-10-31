import {t as translateUi} from "./i18n";
import React, { useEffect, useMemo, useState } from "react";
import { Stamp, Save, Trash2, Plus, Dices } from "lucide-react";
import { Modal } from "./Dialogs";
import { SavedColors } from "./ColorLibrary";

/** Ready-made stamps for cultural projects, accounting and public agreements. Every text line can be
 * edited before applying; {data}, {hora} and {nome} fill in automatically. */
type Shape = "badge" | "box" | "double" | "arrow" | "seal";
export interface StampTemplate { id: string; group: string; shape: Shape; color: string; lines: string[]; opacity?: number; /** "Efeito batido" 0–1: gaps, pooled ink, bleed and rough edges of a real rubber stamp. */ effect?: number; seed?: number }
const GREEN = "#1f8a4c", RED = "#c62f3f", BLUE = "#2456b5", PURPLE = "#6d35d5", ORANGE = "#d4600f", GRAY = "#3d3a47", TEAL = "#0f7c80";
export const STAMPS: StampTemplate[] = [
  { id: "pago", group: "Situação", shape: "badge", color: GREEN, lines: ["PAGO", "em {data} por {nome}"] },
  { id: "contabilizado", group: "Situação", shape: "badge", color: BLUE, lines: ["CONTABILIZADO", "em {data} por {nome}"] },
  { id: "aprovado", group: "Situação", shape: "badge", color: GREEN, lines: ["APROVADO", "em {data} às {hora}"] },
  { id: "recebido", group: "Situação", shape: "badge", color: TEAL, lines: ["RECEBIDO", "em {data} às {hora}"] },
  { id: "conferido", group: "Situação", shape: "badge", color: PURPLE, lines: ["CONFERIDO", "por {nome} em {data}"] },
  { id: "lancado", group: "Situação", shape: "badge", color: BLUE, lines: ["LANÇADO NO SISTEMA", "em {data}"] },
  { id: "arquivado", group: "Situação", shape: "badge", color: GRAY, lines: ["ARQUIVADO", "em {data}"] },
  { id: "pendente", group: "Situação", shape: "badge", color: ORANGE, lines: ["PENDENTE", "aguardando documentação"] },
  { id: "cancelado", group: "Situação", shape: "badge", color: RED, lines: ["CANCELADO", "em {data}"] },
  { id: "glosado", group: "Situação", shape: "badge", color: RED, lines: ["GLOSADO", "valor não elegível"] },
  { id: "confidencial", group: "Situação", shape: "badge", color: RED, lines: ["CONFIDENCIAL", "uso restrito"] },
  { id: "urgente", group: "Situação", shape: "badge", color: RED, lines: ["URGENTE", "prazo: ____/____/______"] },
  { id: "confere", group: "Prestação de contas", shape: "box", color: GRAY, lines: ["CONFERE COM O ORIGINAL", "Conferente:", "________________________________", "Data: ____/____/______"] },
  { id: "projeto", group: "Prestação de contas", shape: "box", color: GRAY, lines: ["NOME DA INSTITUIÇÃO", "Projeto: ________________", "Conta: ____________________"] },
  { id: "convenio", group: "Prestação de contas", shape: "box", color: GRAY, lines: ["Convênio nº __________", "NOME DA INSTITUIÇÃO", "Ref.: __________________________"] },
  { id: "despesa", group: "Prestação de contas", shape: "double", color: PURPLE, lines: ["DESPESA PAGA COM RECURSOS DO", "PROJETO ____________________", "Rubrica / meta: ______________", "Lei de incentivo: ______________"] },
  { id: "incentivo", group: "Prestação de contas", shape: "double", color: TEAL, lines: ["PROJETO INCENTIVADO", "Lei nº ______ · PRONAC/Proc. ______", "Valor: R$ ______________"] },
  { id: "cnpj", group: "Prestação de contas", shape: "double", color: BLUE, lines: ["00.000.000/0000-00", "NOME DA INSTITUIÇÃO", "IE: 000.000.000.0000", "IM: 0.000.000/000-0", "Endereço · CEP 00000-000", "Cidade - UF"] },
  { id: "nota-fiscal", group: "Prestação de contas", shape: "box", color: GRAY, lines: ["NOTA FISCAL Nº ________", "Atesto o recebimento do serviço", "________________________________", "Responsável"] },
  { id: "assine", group: "Assine aqui", shape: "arrow", color: ORANGE, lines: ["ASSINE AQUI"] },
  { id: "rubrique", group: "Assine aqui", shape: "arrow", color: ORANGE, lines: ["RUBRIQUE AQUI"] },
  { id: "testemunha", group: "Assine aqui", shape: "arrow", color: ORANGE, lines: ["TESTEMUNHA"] },
  { id: "aceito", group: "Assine aqui", shape: "arrow", color: GREEN, lines: ["ACEITO"] },
  { id: "recusado", group: "Assine aqui", shape: "arrow", color: RED, lines: ["RECUSADO"] },
  { id: "selo", group: "Selos", shape: "seal", color: PURPLE, lines: ["GESTÃO CULTURAL", "VERIFICADO", "{data}"] },
];
/** The colour mixed with white, as an opaque hex: tinted backgrounds stay solid at 100% opacity
 * instead of letting the page show through (only the opacity slider makes a stamp transparent). */
export function tint(color: string, amount: number) {
  const hex = /^#?([0-9a-f]{6})$/i.exec(color)?.[1] ?? "000000";
  return "#" + [0, 2, 4].map((i) => Math.round(255 + (parseInt(hex.slice(i, i + 2), 16) - 255) * amount).toString(16).padStart(2, "0")).join("");
}
const escape = (t: string) => t.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
export function fillTokens(text: string, name: string) {
  const now = new Date();
  return text.replace(/\{data\}/g, now.toLocaleDateString("pt-BR")).replace(/\{hora\}/g, now.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })).replace(/\{nome\}/g, name || "____________");
}
/** SVG markup of a stamp (also used for previews). */
export function stampSvg(t: StampTemplate, name: string): { svg: string; width: number; height: number } {
  const lines = t.lines.map((l) => escape(fillTokens(l, name))), font = "Segoe UI, Arial, sans-serif", c = t.color;
  const longest = Math.max(...lines.map((l, i) => l.length * (i === 0 ? 11.5 : 7.4)));
  if (t.shape === "badge") {
    const w = Math.max(220, longest + 40), h = lines.length > 1 ? 64 : 46;
    return { width: w, height: h, svg: `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"><rect x="2" y="2" width="${w - 4}" height="${h - 4}" rx="10" fill="${tint(c, 0.09)}" stroke="${c}" stroke-width="2.5"/><text x="${w / 2}" y="${lines.length > 1 ? 30 : 30}" text-anchor="middle" font-family="${font}" font-size="21" font-weight="800" letter-spacing="1.5" fill="${c}">${lines[0]}</text>${lines[1] ? `<text x="${w / 2}" y="50" text-anchor="middle" font-family="${font}" font-size="11.5" font-weight="600" fill="${c}">${lines[1]}</text>` : ""}</svg>` };
  }
  if (t.shape === "arrow") {
    const w = Math.max(200, longest + 70), h = 46;
    return { width: w, height: h, svg: `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"><path d="M2 23 L26 2 H${w - 2} V${h - 2} H26 Z" fill="${c}"/><text x="${(w + 26) / 2}" y="29.5" text-anchor="middle" font-family="${font}" font-size="16" font-weight="800" letter-spacing="1" fill="#fff">${lines[0]}</text></svg>` };
  }
  if (t.shape === "seal") {
    const s = 150;
    return { width: s, height: s, svg: `<svg xmlns="http://www.w3.org/2000/svg" width="${s}" height="${s}" viewBox="0 0 ${s} ${s}"><circle cx="75" cy="75" r="71" fill="#ffffff" stroke="${c}" stroke-width="3"/><circle cx="75" cy="75" r="62" fill="${tint(c, 0.07)}" stroke="${c}" stroke-width="1.2" stroke-dasharray="3 3"/><defs><path id="arc" d="M27 75 a48 48 0 0 1 96 0"/></defs><text font-family="${font}" font-size="12.5" font-weight="800" letter-spacing="2" fill="${c}"><textPath href="#arc" startOffset="50%" text-anchor="middle">${lines[0] ?? ""}</textPath></text><text x="75" y="82" text-anchor="middle" font-family="${font}" font-size="17" font-weight="800" fill="${c}">${lines[1] ?? ""}</text><text x="75" y="103" text-anchor="middle" font-family="${font}" font-size="11" font-weight="600" fill="${c}">${lines[2] ?? ""}</text></svg>` };
  }
  const w = Math.max(250, longest + 44), h = 28 + lines.length * 24, inset = t.shape === "double" ? 6 : 0;
  const rows = lines.map((l, i) => `<text x="${w / 2}" y="${36 + i * 24}" text-anchor="middle" font-family="${font}" font-size="${i === 0 ? 17 : 13}" font-weight="${i === 0 ? 800 : 600}" fill="${c}"${i === 0 && t.shape === "box" ? ' text-decoration="underline"' : ""}>${l}</text>`).join("");
  return { width: w, height: h, svg: `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"><rect x="2" y="2" width="${w - 4}" height="${h - 4}" rx="${t.shape === "double" ? 8 : 2}" fill="#ffffff" fill-opacity="1" stroke="${c}" stroke-width="2.5"/>${inset ? `<rect x="${2 + inset}" y="${2 + inset}" width="${w - 4 - inset * 2}" height="${h - 4 - inset * 2}" rx="5" fill="none" stroke="${c}" stroke-width="1"/>` : ""}${rows}</svg>` };
}
/** Rasterizes the stamp at 3× for a crisp PNG that keeps transparency. */
export async function stampPng(t: StampTemplate, name: string): Promise<string> {
  const { svg, width, height } = stampSvg(t, name), image = new Image();
  image.src = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg);
  await image.decode();
  const canvas = document.createElement("canvas"), effect = Math.min(1, Math.max(0, t.effect ?? 0)), pad = effect ? 4 : 0;
  canvas.width = (width + pad * 2) * 3; canvas.height = (height + pad * 2) * 3;
  const ctx = canvas.getContext("2d", { willReadFrequently: effect > 0 })!;
  if (effect) {
    // Ink that spread into the paper fibres: a soft halo under the sharp print.
    ctx.filter = `blur(${(0.6 + effect * 1.8).toFixed(2)}px)`; ctx.globalAlpha = 0.25 + effect * 0.35;
    ctx.drawImage(image, pad * 3, pad * 3, width * 3, height * 3);
    ctx.filter = "none"; ctx.globalAlpha = 1;
  }
  ctx.drawImage(image, pad * 3, pad * 3, width * 3, height * 3);
  if (effect) stampedInk(ctx, canvas.width, canvas.height, effect, t.seed ?? 1);
  if ((t.opacity ?? 1) < 1) {
    // Opacity is baked into the PNG, so it survives saving, printing and every PDF reader.
    const faded = document.createElement("canvas"); faded.width = canvas.width; faded.height = canvas.height;
    const f = faded.getContext("2d")!; f.globalAlpha = Math.max(0.1, t.opacity!); f.drawImage(canvas, 0, 0);
    return faded.toDataURL("image/png");
  }
  return canvas.toDataURL("image/png");
}
/** Deterministic noise, so the preview is exactly what gets applied. */
function random(seed: number) { let a = seed >>> 0 || 1; return () => { a = (a + 0x6d2b79f5) >>> 0; let x = Math.imul(a ^ (a >>> 15), 1 | a); x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x; return ((x ^ (x >>> 14)) >>> 0) / 4294967296; }; }
function valueNoise(width: number, height: number, cell: number, next: () => number) {
  const cols = Math.ceil(width / cell) + 2, rows = Math.ceil(height / cell) + 2, grid = Float32Array.from({ length: cols * rows }, next);
  const smooth = (v: number) => v * v * (3 - 2 * v);
  return (x: number, y: number) => {
    const gx = x / cell, gy = y / cell, x0 = Math.floor(gx), y0 = Math.floor(gy), fx = smooth(gx - x0), fy = smooth(gy - y0), at = (c: number, r: number) => grid[r * cols + c]!;
    const top = at(x0, y0) + (at(x0 + 1, y0) - at(x0, y0)) * fx, bottom = at(x0, y0 + 1) + (at(x0 + 1, y0 + 1) - at(x0, y0 + 1)) * fx;
    return top + (bottom - top) * fy;
  };
}
/** "Efeito batido": uneven pressure leaves gaps, ink pools darker in patches, and the edges come out
 * grainy ("crocado"). Strength 0–1 scales all three. */
function stampedInk(ctx: CanvasRenderingContext2D, width: number, height: number, strength: number, seed: number) {
  const next = random(seed), blotch = valueNoise(width, height, 46, next), patch = valueNoise(width, height, 13, next), grain = valueNoise(width, height, 2.6, next);
  const image = ctx.getImageData(0, 0, width, height), d = image.data, edge = (v: number, a: number, b: number) => Math.min(1, Math.max(0, (v - a) / (b - a)));
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const i = (y * width + x) * 4; if (!d[i + 3]) continue;
    const big = blotch(x, y), mid = patch(x, y), fine = grain(x, y), n = big * 0.55 + mid * 0.3 + fine * 0.15;
    // Gaps where the stamp did not touch, a speckled fringe around them, then fine grain everywhere.
    const gap = edge(n, strength * 0.42 - 0.05, strength * 0.42 + 0.04);
    const speck = fine < strength * 0.32 ? 0.15 + fine : 1;
    const alpha = gap * speck * (1 - strength * 0.28 * (1 - mid));
    // Ink concentrates where the pressure was strongest.
    const pool = edge(big, 1 - strength * 0.38, 1) * strength * 0.45;
    d[i] = d[i]! * (1 - pool); d[i + 1] = d[i + 1]! * (1 - pool); d[i + 2] = d[i + 2]! * (1 - pool);
    d[i + 3] = d[i + 3]! * alpha;
  }
  ctx.putImageData(image, 0, 0);
}
function Preview({ t, name }: { t: StampTemplate; name: string }) {
  const { svg } = useMemo(() => stampSvg(t, name), [t, name]);
  const [stamped, setStamped] = useState<string | null>(null);
  const effect = t.effect ?? 0, key = `${svg}|${effect}|${t.seed}`;
  useEffect(() => {
    if (!effect) { setStamped(null); return; }
    let live = true; const timer = window.setTimeout(() => void stampPng({ ...t, opacity: 1 }, name).then((url) => { if (live) setStamped(url); }), 60);
    return () => { live = false; window.clearTimeout(timer); };
  }, [key]);
  return <img className="stamp-preview" alt="" style={{ opacity: t.opacity ?? 1 }} src={effect && stamped ? stamped : "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg)} />;
}
function loadCustom(): StampTemplate[] { try { return JSON.parse(localStorage.getItem("gcp.stamps") ?? "[]"); } catch { return []; } }
export function StampDialog({ onClose, onApply }: { onClose: () => void; onApply: (dataUrl: string, name: string) => void }) {
  const [custom, setCustom] = useState<StampTemplate[]>(loadCustom), [name, setName] = useState(() => { try { return localStorage.getItem("gcp.stamp-name") ?? ""; } catch { return ""; } });
  const [current, setCurrent] = useState<StampTemplate>(STAMPS[0]!), [lines, setLines] = useState<string[]>(STAMPS[0]!.lines), [color, setColor] = useState(STAMPS[0]!.color), [opacity, setOpacity] = useState(1), [effect, setEffect] = useState(0), [seed, setSeed] = useState(() => Math.floor(Math.random() * 1e9));
  const editing: StampTemplate = { ...current, lines, color, opacity, effect, seed };
  const pick = (t: StampTemplate) => { setCurrent(t); setLines(t.lines); setColor(t.color); setOpacity(t.opacity ?? 1); setEffect(t.effect ?? 0); if (t.seed) setSeed(t.seed); };
  const lineLimit = current.shape === "badge" ? 2 : current.shape === "arrow" ? 1 : current.shape === "seal" ? 3 : 10;
  useEffect(() => { try { localStorage.setItem("gcp.stamp-name", name); } catch {} }, [name]);
  const persist = (list: StampTemplate[]) => { setCustom(list); try { localStorage.setItem("gcp.stamps", JSON.stringify(list)); } catch {} };
  const groups = [...new Set(STAMPS.map((s) => s.group))];
  return (
    <Modal title={translateUi("Carimbos")} description={translateUi("Escolha um modelo, edite os textos e clique na página para aplicar. Depois é possível mover e redimensionar.")} onClose={onClose} wide>
      <div className="stamps">
        <div className="stamp-gallery">
          {custom.length > 0 && <div className="section-label">{translateUi("Meus carimbos")}</div>}
          {custom.map((t) => (
            <div key={t.id} className={`stamp-item ${current.id === t.id ? "selected" : ""}`}>
              <button onClick={() => pick(t)}><Preview t={t} name={name} /></button>
              <button className="stamp-delete" title={translateUi("Excluir carimbo")} onClick={() => persist(custom.filter((c) => c.id !== t.id))}><Trash2 size={13} /></button>
            </div>
          ))}
          {groups.map((g) => (
            <React.Fragment key={g}>
              <div className="section-label">{g}</div>
              {STAMPS.filter((s) => s.group === g).map((t) => <div key={t.id} className={`stamp-item ${current.id === t.id ? "selected" : ""}`}><button onClick={() => pick(t)}><Preview t={t} name={name} /></button></div>)}
            </React.Fragment>
          ))}
        </div>
        <aside className="stamp-editor">
          <div className="stamp-stage"><Preview t={editing} name={name} /></div>
          {lines.map((line, i) => (
            <div key={i} className="stamp-line">
              <label className="field">{i === 0 ? translateUi("Título") : `Linha ${i + 1}`}<input value={line} onChange={(e) => setLines(lines.map((l, j) => (j === i ? e.target.value : l)))} /></label>
              {i > 0 && <button className="icon-button" title={translateUi("Remover linha")} onClick={() => setLines(lines.filter((_, j) => j !== i))}><Trash2 size={14} /></button>}
            </div>
          ))}
          {lines.length < lineLimit && <button className="text-button" onClick={() => setLines([...lines, ""])}><Plus size={14} />{" "}{translateUi("Adicionar linha")}</button>}
          <label className="field">{translateUi("Opacidade ·")}{" "}{Math.round(opacity * 100)}%<input type="range" min={10} max={100} step={5} value={Math.round(opacity * 100)} onChange={(e) => setOpacity(Number(e.target.value) / 100)} /></label>
          <div className="stamp-effect">
            <label className="field">{translateUi("Efeito batido ·")}{" "}{Math.round(effect * 100)}%<input type="range" min={0} max={100} step={5} value={Math.round(effect * 100)} onChange={(e) => setEffect(Number(e.target.value) / 100)} title={translateUi("Falhas, concentração e vazamento de tinta, como um carimbo de borracha batido no papel")} /></label>
            <button className="icon-button" disabled={!effect} title={translateUi("Outra batida (sorteia novas falhas)")} onClick={() => setSeed(Math.floor(Math.random() * 1e9))}><Dices size={15} /></button>
          </div>
          <div className="field-row">
            <label className="field">{translateUi("Seu nome (")}{translateUi("{nome}")})<input value={name} onChange={(e) => setName(e.target.value)} placeholder={translateUi("Quem carimba")} /></label>
            <label className="field">{translateUi("Cor")}<input type="color" value={color} onChange={(e) => setColor(e.target.value)} /><SavedColors value={color} onPick={setColor} /></label>
          </div>
          <p className="compress-note">{translateUi("{data}")}{" "}{translateUi("e")}{" "}{translateUi("{hora}")}{" "}{translateUi("são preenchidos com o momento em que o carimbo é aplicado.")}</p>
        </aside>
      </div>
      <div className="modal-footer">
        <button className="button secondary" onClick={() => persist([{ ...editing, id: `meu-${Date.now()}`, group: "Meus carimbos" }, ...custom])}><Save size={15} />{" "}{translateUi("Salvar em Meus carimbos")}</button>
        <button className="button primary" onClick={() => void stampPng(editing, name).then((url) => onApply(url, fillTokens(lines[0] ?? "Carimbo", name)))}><Stamp size={15} />{" "}{translateUi("Aplicar na página")}</button>
      </div>
    </Modal>
  );
}
