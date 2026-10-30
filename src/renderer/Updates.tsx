import React, { useEffect, useState } from "react";
import { RefreshCw, Download, LoaderCircle, CheckCircle2, Sparkles } from "lucide-react";
import type { UpdateInfo, UpdateStatus } from "../shared/types";
import { Modal } from "./Dialogs";
import { Markdown } from "./Markdown";

const FREQUENCIES: [UpdateStatus["frequency"], string][] = [["daily", "Todos os dias"], ["weekly", "A cada semana"], ["biweekly", "A cada duas semanas"], ["monthly", "A cada mês"], ["startup", "Sempre que abrir o programa"], ["never", "Nunca"]];
const when = (t?: number) => (t ? new Date(t).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" }) : "nunca");

/** Configurações › Atualizações (like PDFelement's "Atualizar"): how often, and check now. */
export function UpdateSettings({ onFound }: { onFound: (info: UpdateInfo) => void }) {
  const [status, setStatus] = useState<UpdateStatus | null>(null), [busy, setBusy] = useState(false), [message, setMessage] = useState(""), [error, setError] = useState("");
  useEffect(() => { void window.gcp.getUpdateStatus().then(setStatus).catch((e) => setError(String(e))); }, []);
  const save = async (input: Parameters<typeof window.gcp.saveUpdateSettings>[0], done?: string) => { setError(""); try { setStatus(await window.gcp.saveUpdateSettings(input)); if (done) setMessage(done); } catch (e) { setError(e instanceof Error ? e.message : String(e)); } };
  const check = async () => {
    setBusy(true); setError(""); setMessage("");
    try { const found = await window.gcp.checkUpdates(); setStatus(await window.gcp.getUpdateStatus()); if (found) onFound(found); else setMessage("Você já está com a versão mais recente."); }
    catch (e) { setError(e instanceof Error ? e.message.replace(/^Error: /, "") : String(e)); } finally { setBusy(false); }
  };
  if (!status) return <div className="cert-loading"><LoaderCircle className="spin" size={16} /> Carregando…</div>;
  return (
    <section className="form-section">
      <h3>Atualizações</h3>
      <p className="muted">Versão instalada: <b>{status.version}</b> · última verificação: {when(status.lastCheck)}. As novas versões vêm do repositório do projeto no GitHub ({status.repository}).</p>
      <label className="field">Verificar se há atualizações automaticamente
        <select value={status.frequency} onChange={(e) => void save({ frequency: e.target.value as UpdateStatus["frequency"] })}>
          {FREQUENCIES.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select>
      </label>
      <div className="button-row">
        <button className="button secondary" disabled={busy} onClick={() => void check()}>{busy ? <LoaderCircle size={15} className="spin" /> : <RefreshCw size={15} />} Verificar agora</button>
      </div>
      {message && <p className="success-note"><CheckCircle2 size={14} /> {message}</p>}
      {error && <p className="quick-error">{error}</p>}
    </section>
  );
}

/** Shown once on the first start of a new version: what changed, in plain Portuguese. */
export function WhatsNewDialog({ info, onClose }: { info: { versao: string; data: string; itens: string[] }; onClose: () => void }) {
  return (
    <Modal title={`O que há de novo na versão ${info.versao}`} description="O GCP-PDF foi atualizado. Veja as novidades:" onClose={onClose}>
      <ul className="whats-new">{info.itens.map((item, i) => <li key={i}><Sparkles size={15} /><span>{item}</span></li>)}</ul>
      <div className="modal-footer"><button className="button primary" onClick={onClose}>Começar a usar</button></div>
    </Modal>
  );
}
/** "Nova versão disponível": notes, download with progress, install (the app reopens updated). */
export function UpdateDialog({ info, onClose, onError }: { info: UpdateInfo; onClose: () => void; onError: (e: unknown) => void }) {
  const [busy, setBusy] = useState(false);
  return (
    <Modal title={`Nova versão disponível: ${info.version}`} description={`Você está com a ${info.current}${info.published ? ` · publicada em ${new Date(info.published).toLocaleDateString("pt-BR")}` : ""} · ${Math.max(1, Math.round(info.size / 1048576))} MB`} onClose={onClose} wide>
      <div className="update-notes">{info.notes ? <Markdown text={info.notes} /> : <p className="muted">Sem notas de versão.</p>}</div>
      {!info.manual && !info.sha256 && <p className="quick-error">Esta versão não informa o SHA-256 do instalador; por segurança ela não será instalada automaticamente.</p>}
      <p className="compress-note">{info.manual ? 'Abra os downloads no GitHub, escolha o pacote do seu sistema e instale a nova versão. Seus documentos continuam abertos até você fechar o programa.' : 'O instalador é conferido (SHA-256) antes de rodar. O GCP-PDF fecha, atualiza e abre de novo; seus arquivos e configurações são mantidos.'}</p>
      <div className="modal-footer">
        <button className="button secondary" onClick={onClose}>Depois</button>
        <button className="button primary" disabled={busy || (!info.manual && !info.sha256)} onClick={() => { setBusy(true); void window.gcp.installUpdate().then(() => {if(info.manual)onClose();}).catch((e) => { setBusy(false); onError(e); }); }}>{busy ? <LoaderCircle size={15} className="spin" /> : <Download size={15} />} {info.manual ? 'Abrir downloads' : 'Baixar e instalar'}</button>
      </div>
    </Modal>
  );
}
