import React, { useEffect, useState } from "react";
import { Eye, EyeOff, LoaderCircle, Lock, ShieldCheck, BadgeCheck, ExternalLink, FileSignature, AlertTriangle, CheckCircle2, XCircle, HelpCircle } from "lucide-react";
import type { Certificate, FieldProps, ProtectOptions, Rect, Signature } from "../shared/types";
import { Modal } from "./Dialogs";

const ITI = "https://validar.iti.gov.br/";
function Password({ label, value, onChange, disabled }: { label: string; value: string; onChange: (v: string) => void; disabled?: boolean }) {
  const [show, setShow] = useState(false);
  return (
    <label className="field password-field">
      {label}
      <span>
        <input type={show ? "text" : "password"} value={value} disabled={disabled} autoComplete="new-password" onChange={(e) => onChange(e.target.value)} placeholder="Digite a senha" />
        <button type="button" title={show ? "Ocultar senha" : "Mostrar senha"} onClick={() => setShow(!show)} disabled={disabled}>{show ? <EyeOff size={15} /> : <Eye size={15} />}</button>
      </span>
    </label>
  );
}
/** Password protection with AES encryption and Acrobat-style permissions, saved as a protected copy. */
export function ProtectDialog({ docId, name, onClose, onSaved, onError }: { docId: string; name: string; onClose: () => void; onSaved: (path: string) => void; onError: (e: unknown) => void }) {
  const [useOpen, setUseOpen] = useState(true), [open, setOpen] = useState(""), [usePerms, setUsePerms] = useState(false), [perms, setPerms] = useState("");
  const [options, setOptions] = useState<Omit<ProtectOptions, "openPassword" | "permissionsPassword">>({ printing: "high", changes: "none", copy: false, encryption: "aes-256" }), [busy, setBusy] = useState(false);
  const valid = (useOpen && open.length >= 4) || (usePerms && perms.length >= 4);
  async function save() {
    setBusy(true);
    try { const path = await window.gcp.protectDocument(docId, { ...options, ...(useOpen ? { openPassword: open } : {}), ...(usePerms ? { permissionsPassword: perms } : {}) }); if (path) { onSaved(path); onClose(); } }
    catch (e) { onError(e); } finally { setBusy(false); }
  }
  return (
    <Modal title="Proteger com senha" description={`${name} · o original não é alterado; é salva uma cópia criptografada`} onClose={onClose} wide>
      <div className="protect">
        <section className="protect-block">
          <label className="check-row strong"><input type="checkbox" checked={useOpen} onChange={(e) => setUseOpen(e.target.checked)} /> Senha para abrir o documento</label>
          <Password label="" value={open} onChange={setOpen} disabled={!useOpen} />
        </section>
        <section className="protect-block">
          <label className="check-row strong"><input type="checkbox" checked={usePerms} onChange={(e) => setUsePerms(e.target.checked)} /> Senha de permissões (restringir edição e impressão)</label>
          <Password label="" value={perms} onChange={setPerms} disabled={!usePerms} />
          <div className="field-row">
            <label className="field">Impressão<select disabled={!usePerms} value={options.printing} onChange={(e) => setOptions({ ...options, printing: e.target.value as ProtectOptions["printing"] })}><option value="high">Permitida em alta resolução</option><option value="low">Somente baixa resolução</option><option value="none">Não permitida</option></select></label>
            <label className="field">Alterações<select disabled={!usePerms} value={options.changes} onChange={(e) => setOptions({ ...options, changes: e.target.value as ProtectOptions["changes"] })}><option value="none">Nenhuma alteração</option><option value="pages">Inserir, excluir e girar páginas</option><option value="fill-sign">Preencher formulários e assinar</option><option value="comment-fill-sign">Comentar, preencher e assinar</option><option value="any-except-extract">Tudo, exceto extrair páginas</option></select></label>
          </div>
          <label className="check-row"><input type="checkbox" disabled={!usePerms} checked={options.copy} onChange={(e) => setOptions({ ...options, copy: e.target.checked })} /> Permitir copiar texto, imagens e outros conteúdos</label>
        </section>
        <section className="protect-block">
          <div className="section-label">Nível de criptografia</div>
          <div className="segmented">
            {([["aes-256", "AES 256 bits (recomendado)"], ["aes-128", "AES 128 bits"], ["rc4-128", "RC4 128 bits (antigo)"]] as const).map(([value, label]) => <button key={value} className={options.encryption === value ? "selected" : ""} onClick={() => setOptions({ ...options, encryption: value })}>{label}</button>)}
          </div>
          {useOpen && usePerms && open && open === perms && <p className="quick-error">As duas senhas precisam ser diferentes.</p>}
          <p className="compress-note">Guarde a senha: sem ela não é possível abrir o arquivo protegido.</p>
        </section>
      </div>
      <div className="modal-footer">
        <button className="button secondary" onClick={onClose}>Cancelar</button>
        <button className="button primary" disabled={!valid || busy || (useOpen && usePerms && open === perms)} onClick={() => void save()}>{busy ? <LoaderCircle size={15} className="spin" /> : <Lock size={15} />} Proteger e salvar…</button>
      </div>
    </Modal>
  );
}

/** Digital signature with an installed certificate (ICP-Brasil A1/A3 included), PAdES. */
export interface PlacedSignature { options: Omit<import("../shared/types").SignOptions, "page" | "rect">; width: number; height: number; lines: string[]; image?: string }
/** Lines the visible stamp shows, in the order the engine draws them. */
export function stampLines(name: string, reason: string, location: string) { const now = new Date(); return ["Assinado digitalmente por", name, `Data: ${now.toLocaleDateString("pt-BR")} ${now.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}`, ...(reason ? [`Motivo: ${reason}`] : []), ...(location ? [`Local: ${location}`] : [])]; }
const STAMP_SIZES = { small: 0.75, medium: 1, large: 1.35 } as const;
export function CertificateDialog({ docId, area, visible = false, signatures, onClose, onSigned, onPlace, onError }: { docId: string; area: { page: string; rect: Rect } | null; visible?: boolean; signatures: Signature[]; onClose: () => void; onSigned: (path: string) => void; onPlace?: (placed: PlacedSignature) => void; onError: (e: unknown) => void }) {
  const [size, setSize] = useState<keyof typeof STAMP_SIZES>("medium");
  const [list, setList] = useState<Certificate[] | null>(null), [chosen, setChosen] = useState(""), [reason, setReason] = useState(""), [location, setLocation] = useState(""), [image, setImage] = useState(""), [busy, setBusy] = useState(false), [loadError, setLoadError] = useState("");
  useEffect(() => { void window.gcp.listCertificates().then((items) => { setList(items); setChosen(items.find((c) => c.icp)?.id ?? items[0]?.id ?? ""); }).catch((e) => setLoadError(e instanceof Error ? e.message : String(e))); }, []);
  async function sign() {
    setBusy(true);
    try { const path = await window.gcp.signDocument(docId, { certificate: chosen, page: area?.page ?? null, rect: area?.rect ?? null, reason, location, showName: true, signatureImage: image || undefined }); if (path) { onSigned(path); onClose(); } }
    catch (e) { onError(e); } finally { setBusy(false); }
  }
  return (
    <Modal title="Assinar com certificado digital" description={visible ? "Escolha o certificado e posicione o carimbo na página antes de assinar" : area ? "Assinatura visível na área marcada" : "Assinatura invisível (sem carimbo na página)"} onClose={onClose} wide>
      {loadError ? <p className="quick-error">{loadError}</p> : !list ? (
        <div className="cert-loading"><LoaderCircle className="spin" size={18} /> Lendo certificados instalados no Windows…</div>
      ) : !list.length ? (
        <p className="quick-error">Nenhum certificado com chave privada foi encontrado. Instale o certificado A1 (arquivo .pfx) ou conecte o token/cartão A3 e tente de novo.</p>
      ) : (
        <div className="cert-list">
          {list.map((c) => (
            <button key={c.id} className={`cert ${chosen === c.id ? "selected" : ""}`} onClick={() => setChosen(c.id)}>
              <BadgeCheck size={20} />
              <span><strong>{c.name}</strong><small>{c.issuer} · válido até {c.validTo.slice(0, 10).replace(/\./g, "/")}</small></span>
              {c.icp && <em>ICP-Brasil{c.kind ? ` ${c.kind}` : ""}</em>}
            </button>
          ))}
        </div>
      )}
      <div className="field-row">
        <label className="field">Motivo (opcional)<input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Ex.: Aprovo este documento" maxLength={120} /></label>
        <label className="field">Local (opcional)<input value={location} onChange={(e) => setLocation(e.target.value)} placeholder="Ex.: Belo Horizonte - MG" maxLength={120} /></label>
      </div>
      {(area || visible) && signatures.length > 0 && (
        <label className="field">Imagem no carimbo
          <select value={image} onChange={(e) => setImage(e.target.value)}>
            <option value="">Somente nome e data</option>
            {signatures.map((s) => <option key={s.id} value={s.dataUrl}>{s.name}</option>)}
          </select>
        </label>
      )}
      {visible && chosen && (
        <div className="stamp-size">
          <span>Tamanho do carimbo</span>
          <div className="segmented small">{(["small", "medium", "large"] as const).map((k) => <button key={k} className={size === k ? "selected" : ""} onClick={() => setSize(k)}>{{ small: "Pequeno", medium: "Médio", large: "Grande" }[k]}</button>)}</div>
          <SignaturePreview lines={stampLines(list?.find((c) => c.id === chosen)?.name.split(":")[0] ?? "", reason, location)} image={image || undefined} scale={STAMP_SIZES[size]} />
        </div>
      )}
      <p className="compress-note"><ShieldCheck size={13} /> Padrão PAdES (SHA-256). O Windows pode pedir o PIN do token A3. Depois de assinar, qualquer alteração invalida a assinatura: assine por último. Você pode conferir a validade no <button className="text-button" onClick={() => void window.gcp.openExternal(ITI)}>validador do ITI <ExternalLink size={11} /></button>.</p>
      <div className="modal-footer">
        <button className="button secondary" onClick={onClose}>Cancelar</button>
        {visible && onPlace ? (
          <button className="button primary" disabled={!chosen} onClick={() => { const cert = list?.find((c) => c.id === chosen); const lines = stampLines(cert?.name.split(":")[0] ?? "", reason, location), k = STAMP_SIZES[size]; onPlace({ options: { certificate: chosen, reason, location, showName: true, signatureImage: image || undefined }, width: Math.round((image ? 250 : 190) * k), height: Math.round((26 + lines.length * 11) * k), lines, image: image || undefined }); }}><FileSignature size={15} /> Posicionar na página</button>
        ) : <button className="button primary" disabled={!chosen || busy} onClick={() => void sign()}>{busy ? <LoaderCircle size={15} className="spin" /> : <FileSignature size={15} />} Assinar e salvar…</button>}
      </div>
    </Modal>
  );
}

/** What the visible signature will look like (name/date block, optional handwritten image on the left). */
export function SignaturePreview({ lines, image, scale = 1, width, height }: { lines: string[]; image?: string; scale?: number; width?: number; height?: number }) {
  return (
    <div className="signature-stamp" style={{ width: width ?? (image ? 250 : 190) * scale, height: height ?? (26 + lines.length * 11) * scale, fontSize: 8.5 * scale }}>
      {image && <img src={image} alt="" />}
      <div>{lines.map((l, i) => <span key={i} className={i === 1 ? "strong" : ""}>{l}</span>)}</div>
    </div>
  );
}
const SWATCHES = ["none", "#000000", "#6d28d9", "#2563eb", "#0f766e", "#16a34a", "#d97706", "#dc2626", "#94a3b8", "#ffffff", "#f5f3ff", "#fef9c3"];
function ColorPick({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return (
    <div className="field">
      {label}
      <div className="swatches">
        {SWATCHES.map((c) => <button key={c} title={c === "none" ? "Sem cor" : c} className={`swatch ${value === c ? "selected" : ""} ${c === "none" ? "none" : ""}`} style={c === "none" ? undefined : { background: c }} onClick={() => onChange(c)} />)}
        <input type="color" value={value === "none" ? "#ffffff" : value} onChange={(e) => onChange(e.target.value)} title="Outra cor" />
      </div>
    </div>
  );
}
/** Properties of a form field: name, appearance (border, fill, text), behaviour and Brazilian formats. */
export function FieldPropsDialog({ name, type, onClose, onApply }: { name: string; type: string; onClose: () => void; onApply: (props: FieldProps) => void }) {
  const [props, setProps] = useState<FieldProps>({ name, required: false, read_only: false, font_size: 0, align: "left", appearance: { border: "#6d28d9", fill: "none", text_color: "#000000", width: 1, style: "solid" }, format: type === "date" ? "date" : "none" });
  const set = (patch: FieldProps) => setProps((p) => ({ ...p, ...patch }));
  const look = (patch: NonNullable<FieldProps["appearance"]>) => setProps((p) => ({ ...p, appearance: { ...p.appearance, ...patch } }));
  const textual = ["text", "date", "combo", "list", ""].includes(type), checks = type === "checkbox" || type === "radio";
  return (
    <Modal title="Propriedades do campo" description={`${name} · aparência, comportamento e formato`} onClose={onClose} wide>
      <div className="field-props">
        <section>
          <h3>Geral</h3>
          <label className="field">Nome do campo<input value={props.name ?? ""} onChange={(e) => set({ name: e.target.value })} /></label>
          <label className="field">Dica ao passar o mouse<input value={props.tooltip ?? ""} onChange={(e) => set({ tooltip: e.target.value })} placeholder="Ex.: Informe o CPF do proponente" /></label>
          <label className="check-row"><input type="checkbox" checked={!!props.required} onChange={(e) => set({ required: e.target.checked })} /> Obrigatório</label>
          <label className="check-row"><input type="checkbox" checked={!!props.read_only} onChange={(e) => set({ read_only: e.target.checked })} /> Somente leitura</label>
          {type === "text" && <label className="check-row"><input type="checkbox" checked={!!props.multiline} onChange={(e) => set({ multiline: e.target.checked })} /> Várias linhas</label>}
          {type === "button" && (
            <>
              <label className="field">Texto do botão<input value={props.caption ?? ""} onChange={(e) => set({ caption: e.target.value })} placeholder="Ex.: Enviar formulário" /></label>
              <label className="field">Ação ao clicar
                <select value={props.action?.type ?? "keep"} onChange={(e) => { const t = e.target.value; set({ action: t === "keep" ? undefined : t === "url" || t === "submit" ? { type: t, url: "" } : t === "page" ? { type: "page", page: 1 } : { type: t as "none" | "reset" | "print" } }); }}>
                  <option value="keep">Manter a ação atual</option><option value="url">Abrir link (site ou e-mail)</option><option value="page">Ir para uma página</option>
                  <option value="reset">Limpar o formulário</option><option value="print">Imprimir o documento</option><option value="submit">Enviar o formulário (URL ou e-mail)</option><option value="none">Nenhuma ação</option>
                </select>
              </label>
              {(props.action?.type === "url" || props.action?.type === "submit") && <label className="field">{props.action.type === "url" ? "Endereço" : "Destino do envio"}<input value={props.action.url} onChange={(e) => set({ action: { type: props.action!.type as "url", url: e.target.value } })} placeholder="https://… ou mailto:nome@exemplo.com" /></label>}
              {props.action?.type === "page" && <label className="field">Página de destino<input type="number" min={1} value={props.action.page} onChange={(e) => set({ action: { type: "page", page: Math.max(1, Number(e.target.value) || 1) } })} /></label>}
            </>
          )}
          {textual && (
            <label className="field">Formato
              <select value={props.format} onChange={(e) => set({ format: e.target.value as FieldProps["format"] })}>
                <option value="none">Texto livre</option><option value="date">Data (dd/mm/aaaa)</option><option value="currency">Moeda (R$ 0.000,00)</option><option value="number">Número (0.000,00)</option>
                <option value="cpf">CPF</option><option value="cnpj">CNPJ</option><option value="cep">CEP</option><option value="phone">Telefone</option>
              </select>
            </label>
          )}
        </section>
        <section>
          <h3>Aparência</h3>
          <ColorPick label="Borda" value={props.appearance?.border ?? "none"} onChange={(border) => look({ border })} />
          <ColorPick label="Preenchimento" value={props.appearance?.fill ?? "none"} onChange={(fill) => look({ fill })} />
          <ColorPick label="Texto" value={props.appearance?.text_color ?? "#000000"} onChange={(text_color) => look({ text_color })} />
          <div className="field-row">
            <label className="field">Espessura<select value={props.appearance?.width} onChange={(e) => look({ width: Number(e.target.value) })}><option value={0}>Nenhuma</option><option value={1}>Fina</option><option value={2}>Média</option><option value={3}>Grossa</option></select></label>
            <label className="field">Estilo<select value={props.appearance?.style} onChange={(e) => look({ style: e.target.value as "solid" })}><option value="solid">Sólida</option><option value="dashed">Tracejada</option><option value="underline">Sublinhado</option><option value="beveled">Chanfrada</option><option value="inset">Embutida</option></select></label>
          </div>
          <div className="field-row">
            {!checks && <label className="field">Tamanho da fonte<select value={props.font_size} onChange={(e) => set({ font_size: Number(e.target.value) })}><option value={0}>Automático</option>{[8, 9, 10, 11, 12, 14, 16, 18, 24].map((n) => <option key={n} value={n}>{n} pt</option>)}</select></label>}
            {!checks && <label className="field">Alinhamento<select value={props.align} onChange={(e) => set({ align: e.target.value as "left" })}><option value="left">Esquerda</option><option value="center">Centro</option><option value="right">Direita</option></select></label>}
            {checks && <label className="field">Marca<select value={props.check_style ?? (type === "radio" ? "circle" : "check")} onChange={(e) => set({ check_style: e.target.value as "check" })}><option value="check">Visto ✓</option><option value="cross">Xis ✗</option><option value="circle">Círculo ●</option><option value="square">Quadrado ■</option><option value="diamond">Losango ◆</option><option value="star">Estrela ★</option></select></label>}
          </div>
        </section>
      </div>
      <div className="modal-footer">
        <button className="button secondary" onClick={onClose}>Fechar</button>
        <button className="button primary" onClick={() => onApply(props)}>Aplicar</button>
      </div>
    </Modal>
  );
}
export function FieldOptionsDialog({ kind, onClose, onConfirm }: { kind: "combo" | "list"; onClose: () => void; onConfirm: (options: string[], name: string) => void }) {
  const [text, setText] = useState("Opção 1\nOpção 2\nOpção 3"), [name, setName] = useState("");
  return (
    <Modal title={kind === "combo" ? "Lista suspensa" : "Caixa de lista"} description="Uma opção por linha" onClose={onClose}>
      <label className="field">Nome do campo (opcional)<input value={name} onChange={(e) => setName(e.target.value)} placeholder="Ex.: Estado" /></label>
      <label className="field">Opções<textarea rows={6} value={text} onChange={(e) => setText(e.target.value)} /></label>
      <div className="modal-footer">
        <button className="button secondary" onClick={onClose}>Cancelar</button>
        <button className="button primary" onClick={() => onConfirm(text.split("\n").map((s) => s.trim()).filter(Boolean), name.trim())}>Criar campo</button>
      </div>
    </Modal>
  );
}

const STATUS: Record<string, { label: string; icon: React.ReactNode; tone: string }> = {
  valid: { label: "Válida", icon: <CheckCircle2 size={18} />, tone: "ok" },
  modified: { label: "Documento com alterações não salvas", icon: <AlertTriangle size={18} />, tone: "warn" },
  unknown: { label: "Validade não confirmada localmente", icon: <HelpCircle size={18} />, tone: "warn" },
  invalid: { label: "Inválida", icon: <XCircle size={18} />, tone: "bad" },
  unsigned: { label: "Campo de assinatura vazio", icon: <AlertTriangle size={18} />, tone: "warn" },
};
/** "D:20261030071345-03'00'" → "30/10/2026 07:13:45". */
const pdfDate = (d: string) => { const m = /^D:(\d{4})(\d{2})(\d{2})(\d{2})?(\d{2})?(\d{2})?/.exec(d); return m ? `${m[3]}/${m[2]}/${m[1]}${m[4] ? ` ${m[4]}:${m[5] ?? "00"}${m[6] ? ":" + m[6] : ""}` : ""}` : d; };
export function SignaturesDialog({ docId, onClose }: { docId: string; onClose: () => void }) {
  const [list, setList] = useState<Awaited<ReturnType<typeof window.gcp.checkSignatures>> | null>(null), [error, setError] = useState("");
  useEffect(() => { void window.gcp.checkSignatures(docId).then(setList).catch((e) => setError(e instanceof Error ? e.message : String(e))); }, [docId]);
  return (
    <Modal title="Assinaturas digitais do documento" description="Verificação local da cópia atual; alterações não salvas são sinalizadas" onClose={onClose} wide>
      {error ? <p className="quick-error">{error}</p> : !list ? <div className="cert-loading"><LoaderCircle className="spin" size={18} /> Verificando…</div> : !list.length ? <p className="sidebar-description">Este documento não tem assinaturas digitais.</p> : (
        <div className="cert-list">
          {list.map((s, i) => { const st = STATUS[s.status] ?? STATUS.unknown!; return (
            <div key={i} className={`cert sig-${st.tone}`}>{st.icon}<span><strong>{s.signer || s.name}</strong><small>{st.label}{s.date ? ` · assinado em ${pdfDate(s.date)}` : ""}</small>{s.explanation && <small>{s.explanation}</small>}</span></div>
          ); })}
        </div>
      )}
      <div className="modal-footer">
        <button className="button secondary" onClick={() => void window.gcp.openExternal(ITI)}><ExternalLink size={14} /> Validar no ITI (validar.iti.gov.br)</button>
        <button className="button primary" onClick={onClose}>Fechar</button>
      </div>
    </Modal>
  );
}
