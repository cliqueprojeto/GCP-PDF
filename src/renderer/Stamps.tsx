import React, { useEffect, useMemo, useState } from "react";
import { Stamp, Save, Trash2, Plus } from "lucide-react";
import { Modal } from "./Dialogs";

/** Ready-made stamps for cultural projects, accounting and public agreements. Every text line can be
 * edited before applying; {data}, {hora} and {nome} fill in automatically. */
type Shape = "badge" | "box" | "double" | "arrow" | "seal";
export interface StampTemplate { id: string; group: string; shape: Shape; color: string; lines: string[]; opacity?: number }
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
    return { width: w, height: h, svg: `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"><rect x="2" y="2" width="${w - 4}" height="${h - 4}" rx="10" fill="${c}14" stroke="${c}" stroke-width="2.5"/><text x="${w / 2}" y="${lines.length > 1 ? 30 : 30}" text-anchor="middle" font-family="${font}" font-size="21" font-weight="800" letter-spacing="1.5" fill="${c}">${lines[0]}</text>${lines[1] ? `<text x="${w / 2}" y="50" text-anchor="middle" font-family="${font}" font-size="11.5" font-weight="600" fill="${c}">${lines[1]}</text>` : ""}</svg>` };
  }
  if (t.shape === "arrow") {
    const w = Math.max(200, longest + 70), h = 46;
    return { width: w, height: h, svg: `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"><path d="M2 23 L26 2 H${w - 2} V${h - 2} H26 Z" fill="${c}"/><text x="${(w + 26) / 2}" y="29.5" text-anchor="middle" font-family="${font}" font-size="16" font-weight="800" letter-spacing="1" fill="#fff">${lines[0]}</text></svg>` };
  }
  if (t.shape === "seal") {
    const s = 150;
    return { width: s, height: s, svg: `<svg xmlns="http://www.w3.org/2000/svg" width="${s}" height="${s}" viewBox="0 0 ${s} ${s}"><circle cx="75" cy="75" r="71" fill="none" stroke="${c}" stroke-width="3"/><circle cx="75" cy="75" r="62" fill="${c}10" stroke="${c}" stroke-width="1.2" stroke-dasharray="3 3"/><defs><path id="arc" d="M27 75 a48 48 0 0 1 96 0"/></defs><text font-family="${font}" font-size="12.5" font-weight="800" letter-spacing="2" fill="${c}"><textPath href="#arc" startOffset="50%" text-anchor="middle">${lines[0] ?? ""}</textPath></text><text x="75" y="82" text-anchor="middle" font-family="${font}" font-size="17" font-weight="800" fill="${c}">${lines[1] ?? ""}</text><text x="75" y="103" text-anchor="middle" font-family="${font}" font-size="11" font-weight="600" fill="${c}">${lines[2] ?? ""}</text></svg>` };
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
  const canvas = document.createElement("canvas");
  canvas.width = width * 3; canvas.height = height * 3;
  const ctx = canvas.getContext("2d")!;
  // Opacity is baked into the PNG, so it survives saving, printing and every PDF reader.
  ctx.globalAlpha = Math.min(1, Math.max(0.1, t.opacity ?? 1));
  ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL("image/png");
}
function Preview({ t, name }: { t: StampTemplate; name: string }) {
  const { svg } = useMemo(() => stampSvg(t, name), [t, name]);
  return <img className="stamp-preview" alt="" style={{ opacity: t.opacity ?? 1 }} src={"data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg)} />;
}
function loadCustom(): StampTemplate[] { try { return JSON.parse(localStorage.getItem("gcp.stamps") ?? "[]"); } catch { return []; } }
export function StampDialog({ onClose, onApply }: { onClose: () => void; onApply: (dataUrl: string, name: string) => void }) {
  const [custom, setCustom] = useState<StampTemplate[]>(loadCustom), [name, setName] = useState(() => { try { return localStorage.getItem("gcp.stamp-name") ?? ""; } catch { return ""; } });
  const [current, setCurrent] = useState<StampTemplate>(STAMPS[0]!), [lines, setLines] = useState<string[]>(STAMPS[0]!.lines), [color, setColor] = useState(STAMPS[0]!.color), [opacity, setOpacity] = useState(1);
  const editing: StampTemplate = { ...current, lines, color, opacity };
  const pick = (t: StampTemplate) => { setCurrent(t); setLines(t.lines); setColor(t.color); setOpacity(t.opacity ?? 1); };
  const lineLimit = current.shape === "badge" ? 2 : current.shape === "arrow" ? 1 : current.shape === "seal" ? 3 : 10;
  useEffect(() => { try { localStorage.setItem("gcp.stamp-name", name); } catch {} }, [name]);
  const persist = (list: StampTemplate[]) => { setCustom(list); try { localStorage.setItem("gcp.stamps", JSON.stringify(list)); } catch {} };
  const groups = [...new Set(STAMPS.map((s) => s.group))];
  return (
    <Modal title="Carimbos" description="Escolha um modelo, edite os textos e clique na página para aplicar. Depois é possível mover e redimensionar." onClose={onClose} wide>
      <div className="stamps">
        <div className="stamp-gallery">
          {custom.length > 0 && <div className="section-label">Meus carimbos</div>}
          {custom.map((t) => (
            <div key={t.id} className={`stamp-item ${current.id === t.id ? "selected" : ""}`}>
              <button onClick={() => pick(t)}><Preview t={t} name={name} /></button>
              <button className="stamp-delete" title="Excluir carimbo" onClick={() => persist(custom.filter((c) => c.id !== t.id))}><Trash2 size={13} /></button>
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
              <label className="field">{i === 0 ? "Título" : `Linha ${i + 1}`}<input value={line} onChange={(e) => setLines(lines.map((l, j) => (j === i ? e.target.value : l)))} /></label>
              {i > 0 && <button className="icon-button" title="Remover linha" onClick={() => setLines(lines.filter((_, j) => j !== i))}><Trash2 size={14} /></button>}
            </div>
          ))}
          {lines.length < lineLimit && <button className="text-button" onClick={() => setLines([...lines, ""])}><Plus size={14} /> Adicionar linha</button>}
          <label className="field">Opacidade · {Math.round(opacity * 100)}%<input type="range" min={10} max={100} step={5} value={Math.round(opacity * 100)} onChange={(e) => setOpacity(Number(e.target.value) / 100)} /></label>
          <div className="field-row">
            <label className="field">Seu nome ({"{nome}"})<input value={name} onChange={(e) => setName(e.target.value)} placeholder="Quem carimba" /></label>
            <label className="field">Cor<input type="color" value={color} onChange={(e) => setColor(e.target.value)} /></label>
          </div>
          <p className="compress-note">{"{data}"} e {"{hora}"} são preenchidos com o momento em que o carimbo é aplicado.</p>
        </aside>
      </div>
      <div className="modal-footer">
        <button className="button secondary" onClick={() => persist([{ ...editing, id: `meu-${Date.now()}`, group: "Meus carimbos" }, ...custom])}><Save size={15} /> Salvar em Meus carimbos</button>
        <button className="button primary" onClick={() => void stampPng(editing, name).then((url) => onApply(url, fillTokens(lines[0] ?? "Carimbo", name)))}><Stamp size={15} /> Aplicar na página</button>
      </div>
    </Modal>
  );
}
