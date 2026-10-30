import {t as translateUi} from "./i18n";
import React, { useEffect, useState } from "react";
import { ArrowDown, ArrowUp, Check, FileText, FolderOpen, Image as ImageIcon, Layers3, LoaderCircle, Plus, Trash2, X, FileInput, ExternalLink } from "lucide-react";
import type { QuickState } from "../shared/types";

/** Compact window opened from Explorer's right-click menu: combine several files into one PDF, or
 * convert each file to PDF, without opening the full editor. */
export default function Quick() {
  const [state, setState] = useState<QuickState | null>(null), [order, setOrder] = useState<string[]>([]), [ranges, setRanges] = useState<Record<string, string>>({});
  const [name, setName] = useState(""), [folder, setFolder] = useState<string | null>(null), [busy, setBusy] = useState(""), [error, setError] = useState(""), [done, setDone] = useState<string[] | null>(null);
  useEffect(() => {
    void window.gcp.getQuickState().then((value) => value && setState(value)).catch(() => {});
    const offState = window.gcp.onQuickState(setState);
    const offAction = window.gcp.onAction((action) => { if (action.startsWith("progress:")) setBusy(action.slice(9)); });
    return () => { offState(); offAction(); };
  }, []);
  useEffect(() => { if (state) document.documentElement.dataset.theme = state.theme; }, [state?.theme]);
  useEffect(() => {
    if (!state) return;
    setOrder((old) => [...old.filter((path) => state.files.some((f) => f.path === path)), ...state.files.map((f) => f.path).filter((path) => !old.includes(path))]);
    if (!name && state.files[0]) setName(state.files[0].name.replace(/\.[^.]+$/, "") + (state.action === "combine" ? " - combinado" : ""));
    document.title = state.action === "combine" ? "Combinar arquivos — GCP-PDF" : "Converter para PDF — GCP-PDF";
  }, [state]);
  if (!state) return <div className="quick-app loading"><LoaderCircle className="spin" /></div>;
  const combine = state.action === "combine", files = order.map((path) => state.files.find((f) => f.path === path)!).filter(Boolean);
  const move = (index: number, delta: number) => setOrder((o) => { const copy = [...o], target = index + delta; if (target < 0 || target >= copy.length) return o; [copy[index], copy[target]] = [copy[target]!, copy[index]!]; return copy; });
  async function run() {
    setError(""); setDone(null);
    try { setDone(await window.gcp.quickRun({ files: files.filter((f) => !f.error).map((f) => ({ path: f.path, range: ranges[f.path] ?? "" })), name, folder })); }
    catch (e) { setError(e instanceof Error ? e.message.replace(/^Error invoking remote method '[^']+': (?:Error: )?/, "") : String(e)); }
    finally { setBusy(""); }
  }
  const valid = files.filter((f) => !f.error).length >= (combine ? 2 : 1);
  return (
    <div className="quick-app">
      <header className="quick-header">
        <div className="quick-icon">{combine ? <Layers3 size={20} /> : <FileInput size={20} />}</div>
        <div>
          <h1>{combine ? translateUi("Combinar em um PDF") : translateUi("Converter para PDF")}</h1>
          <p>{combine ? translateUi("Arraste a ordem com as setas e escolha intervalos de páginas, se quiser.") : translateUi("Cada arquivo vira um PDF com o mesmo nome.")}</p>
        </div>
        <button className="button secondary" onClick={() => void window.gcp.quickAddFiles()}><Plus size={16} />{" "}{translateUi("Adicionar arquivos")}</button>
      </header>
      <div className="quick-body">
        <div className={`quick-table ${combine ? "combine" : ""}`}>
          <div className="quick-row head"><span>{translateUi("Nº")}</span><span>{translateUi("Nome")}</span><span>{translateUi("Páginas")}</span>{combine && <span>{translateUi("Intervalo")}</span>}<span>{translateUi("Ação")}</span></div>
          {files.map((file, index) => (
            <div className={`quick-row ${file.error ? "error" : ""}`} key={file.path} title={file.path}>
              <span>{index + 1}</span>
              <span className="quick-name">{/\.(png|jpe?g|webp|bmp)$/i.test(file.name) ? <ImageIcon size={15} /> : <FileText size={15} />}{file.name}{file.error && <small>{file.error}</small>}</span>
              <span>{file.pages ?? <LoaderCircle size={13} className="spin" />}</span>
              {combine && <input placeholder={translateUi("Tudo")} value={ranges[file.path] ?? ""} onChange={(e) => setRanges((r) => ({ ...r, [file.path]: e.target.value }))} title={translateUi("Ex.: 1-3, 5")} disabled={!!file.error} />}
              <span className="quick-actions">
                {combine && <><button title={translateUi("Mover para cima")} disabled={index === 0} onClick={() => move(index, -1)}><ArrowUp size={14} /></button><button title={translateUi("Mover para baixo")} disabled={index === files.length - 1} onClick={() => move(index, 1)}><ArrowDown size={14} /></button></>}
                <button title={translateUi("Remover da lista")} onClick={() => setOrder((o) => o.filter((p) => p !== file.path))}><Trash2 size={14} /></button>
              </span>
            </div>
          ))}
          {!files.length && <div className="quick-empty">{translateUi("Adicione arquivos PDF, imagens ou documentos do Office.")}</div>}
        </div>
        <aside className="quick-side">
          {combine && <label className="field">{translateUi("Nome do arquivo")}<input value={name} onChange={(e) => setName(e.target.value)} /></label>}
          <label className="field">{translateUi("Pasta de destino")}{" "}<div className="folder-picker">
              <span title={folder ?? undefined}>{folder ?? "Mesma pasta dos arquivos"}</span>
              <button className="text-button" onClick={() => void window.gcp.quickChooseFolder().then((f) => f && setFolder(f))}><FolderOpen size={14} />{" "}{translateUi("Escolher")}</button>
              {folder && <button className="text-button" onClick={() => setFolder(null)}><X size={14} /></button>}
            </div>
          </label>
          {error && <div className="quick-error">{error}</div>}
          {done && (
            <div className="quick-done">
              <strong><Check size={15} /> {done.length === 1 ? translateUi("Arquivo criado") : `${done.length} arquivos criados`}</strong>
              {done.map((path) => <button key={path} className="text-button" onClick={() => void window.gcp.quickReveal(path)} title={path}><FolderOpen size={13} /> {path.split(/[\\/]/).pop()}</button>)}
              <button className="button secondary" onClick={() => void window.gcp.quickOpen(done)}><ExternalLink size={14} />{" "}{translateUi("Abrir no GCP-PDF")}</button>
            </div>
          )}
        </aside>
      </div>
      <footer className="quick-footer">
        <span>{busy}</span>
        <button className="button primary" disabled={!valid || !!busy} onClick={() => void run()}>{busy ? <LoaderCircle size={16} className="spin" /> : combine ? <Layers3 size={16} /> : <FileInput size={16} />} {combine ? translateUi("Combinar") : translateUi("Converter")}</button>
      </footer>
    </div>
  );
}
