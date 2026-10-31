import {t as translateUi} from "./i18n";
import React, { useEffect, useState } from "react";
import { Eye, EyeOff, LoaderCircle, Lock, ShieldCheck, BadgeCheck, ExternalLink, FileSignature, AlertTriangle, CheckCircle2, XCircle, HelpCircle } from "lucide-react";
import type { Certificate, FieldProps, ProtectOptions, Rect, Signature } from "../shared/types";
import { Modal } from "./Dialogs";
import { SavedColors } from "./ColorLibrary";

const ITI = "https://validar.iti.gov.br/";
function Password({ label, value, onChange, disabled }: { label: string; value: string; onChange: (v: string) => void; disabled?: boolean }) {
  const [show, setShow] = useState(false);
  return (
    <label className="field password-field">
      {translateUi(label)}
      <span>
        <input type={show ? "text" : "password"} value={value} disabled={disabled} autoComplete="new-password" onChange={(e) => onChange(e.target.value)} placeholder={translateUi("Digite a senha")} />
        <button type="button" title={show ? translateUi("Ocultar senha") : translateUi("Mostrar senha")} onClick={() => setShow(!show)} disabled={disabled}>{show ? <EyeOff size={15} /> : <Eye size={15} />}</button>
      </span>
    </label>
  );
}
/** Password protection with AES encryption and Acrobat-style permissions, saved as a protected copy. */
export function ProtectDialog({ docId, name, onClose, onSaved, onError }: { docId: string; name: string; onClose: () => void; onSaved: (path: string) => void; onError: (e: unknown) => void }) {
  const [useOpen, setUseOpen] = useState(true), [open, setOpen] = useState(""), [usePerms, setUsePerms] = useState(false), [perms, setPerms] = useState("");
  const [options, setOptions] = useState<Omit<ProtectOptions, "openPassword" | "permissionsPassword">>({ printing: "high", changes: "none", copy: false, encryption: "aes-256" }), [busy, setBusy] = useState(false);
  const valid = (useOpen || usePerms) && (!useOpen || open.length >= 4) && (!usePerms || perms.length >= 4);
  async function save() {
    setBusy(true);
    try { const path = await window.gcp.protectDocument(docId, { ...options, ...(useOpen ? { openPassword: open } : {}), ...(usePerms ? { permissionsPassword: perms } : {}) }); if (path) { onSaved(path); onClose(); } }
    catch (e) { onError(e); } finally { setBusy(false); }
  }
  return (
    <Modal title={translateUi("Proteger com senha")} description={`${name} · o original não é alterado; é salva uma cópia criptografada`} onClose={onClose} wide>
      <div className="protect">
        <section className="protect-block">
          <label className="check-row strong"><input type="checkbox" checked={useOpen} onChange={(e) => setUseOpen(e.target.checked)} />{" "}{translateUi("Senha para abrir o documento")}</label>
          <Password label="" value={open} onChange={setOpen} disabled={!useOpen} />
        </section>
        <section className="protect-block">
          <label className="check-row strong"><input type="checkbox" checked={usePerms} onChange={(e) => setUsePerms(e.target.checked)} />{" "}{translateUi("Senha de permissões (restringir edição e impressão)")}</label>
          <Password label="" value={perms} onChange={setPerms} disabled={!usePerms} />
          <div className="field-row">
            <label className="field">{translateUi("Impressão")}<select disabled={!usePerms} value={options.printing} onChange={(e) => setOptions({ ...options, printing: e.target.value as ProtectOptions["printing"] })}><option value="high">{translateUi("Permitida em alta resolução")}</option><option value="low">{translateUi("Somente baixa resolução")}</option><option value="none">{translateUi("Não permitida")}</option></select></label>
            <label className="field">{translateUi("Alterações")}<select disabled={!usePerms} value={options.changes} onChange={(e) => setOptions({ ...options, changes: e.target.value as ProtectOptions["changes"] })}><option value="none">{translateUi("Nenhuma alteração")}</option><option value="pages">{translateUi("Inserir, excluir e girar páginas")}</option><option value="fill-sign">{translateUi("Preencher formulários e assinar")}</option><option value="comment-fill-sign">{translateUi("Comentar, preencher e assinar")}</option><option value="any-except-extract">{translateUi("Tudo, exceto extrair páginas")}</option></select></label>
          </div>
          <label className="check-row"><input type="checkbox" disabled={!usePerms} checked={options.copy} onChange={(e) => setOptions({ ...options, copy: e.target.checked })} />{" "}{translateUi("Permitir copiar texto, imagens e outros conteúdos")}</label>
        </section>
        <section className="protect-block">
          <div className="section-label">{translateUi("Nível de criptografia")}</div>
          <div className="segmented">
            {([["aes-256", "AES 256 bits (recomendado)"], ["aes-128", "AES 128 bits"], ["rc4-128", "RC4 128 bits (antigo)"]] as const).map(([value, label]) => <button key={value} className={options.encryption === value ? "selected" : ""} onClick={() => setOptions({ ...options, encryption: value })}>{translateUi(label)}</button>)}
          </div>
          {useOpen && usePerms && open && open === perms && <p className="quick-error">{translateUi("As duas senhas precisam ser diferentes.")}</p>}
          <p className="compress-note">{translateUi("Guarde a senha: sem ela não é possível abrir o arquivo protegido.")}</p>
        </section>
      </div>
      <div className="modal-footer">
        <button className="button secondary" onClick={onClose}>{translateUi("Cancelar")}</button>
        <button className="button primary" disabled={!valid || busy || (useOpen && usePerms && open === perms)} onClick={() => void save()}>{busy ? <LoaderCircle size={15} className="spin" /> : <Lock size={15} />}{" "}{translateUi("Proteger e salvar…")}</button>
      </div>
    </Modal>
  );
}

/** PAdES signing with a system identity or a user-selected A1 PKCS#12 file. */
export interface PlacedSignature { options: Omit<import("../shared/types").SignOptions, "page" | "rect">; width: number; height: number; lines: string[]; image?: string }
/** Lines the visible stamp shows, in the order the engine draws them. */
export function stampLines(name: string, reason: string, location: string) { const now = new Date(); return ["Assinado digitalmente por", name, `Data: ${now.toLocaleDateString("pt-BR")} ${now.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}`, ...(reason ? [`Motivo: ${reason}`] : []), ...(location ? [`Local: ${location}`] : [])]; }
const STAMP_SIZES = { small: 0.75, medium: 1, large: 1.35 } as const;
export function CertificateDialog({ docId, area, visible = false, signatures, onClose, onSigned, onPlace, onError }: { docId: string; area: { page: string; rect: Rect } | null; visible?: boolean; signatures: Signature[]; onClose: () => void; onSigned: (path: string) => void; onPlace?: (placed: PlacedSignature) => void; onError: (e: unknown) => void }) {
  const [size, setSize] = useState<keyof typeof STAMP_SIZES>("medium");
  const [list, setList] = useState<Certificate[] | null>(null), [chosen, setChosen] = useState(""), [reason, setReason] = useState(""), [location, setLocation] = useState(""), [image, setImage] = useState(""), [busy, setBusy] = useState(false), [loadError, setLoadError] = useState("");
  const [password,setPassword]=useState("");
  const fromFile=chosen.startsWith('file:');
  const signerName=fromFile?'Titular do certificado':list?.find(c=>c.id===chosen)?.name.split(':')[0]??'';
  async function chooseFile(){
    try{const certificate=await window.gcp.chooseCertificate();if(!certificate)return;setList(items=>[...(items??[]).filter(c=>!c.id.startsWith('file:')),certificate]);setChosen(certificate.id);setPassword('');}
    catch(error){onError(error);}
  }
  useEffect(() => { void window.gcp.listCertificates().then((items) => { setList(items); setChosen(items.find((c) => c.icp)?.id ?? items[0]?.id ?? ""); }).catch((e) => setLoadError(e instanceof Error ? e.message : String(e))); }, []);
  async function sign() {
    setBusy(true);
    try { const path = await window.gcp.signDocument(docId, { certificate: chosen, ...(fromFile?{password}:{}), page: area?.page ?? null, rect: area?.rect ?? null, reason, location, showName: true, signatureImage: image || undefined }); if (path) { onSigned(path); onClose(); } }
    catch (e) { onError(e); } finally { setBusy(false); }
  }
  return (
    <Modal title={translateUi("Assinar com certificado digital")} description={visible ? translateUi("Escolha o certificado e posicione o carimbo na página antes de assinar") : area ? translateUi("Assinatura visível na área marcada") : translateUi("Assinatura invisível (sem carimbo na página)")} onClose={onClose} wide>
      {loadError ? <p className="quick-error">{loadError}</p> : !list ? (
        <div className="cert-loading"><LoaderCircle className="spin" size={18} />{" "}{translateUi("Lendo certificados disponíveis no sistema…")}</div>
      ) : !list.length ? (
        <p className="muted">{translateUi("Escolha seu arquivo A1 (.pfx ou .p12) abaixo. Certificados do Windows ou do Chaves do macOS também aparecem aqui quando disponíveis.")}</p>
      ) : (
        <div className="cert-list">
          {list.map((c) => (
            <button key={c.id} className={`cert ${chosen === c.id ? "selected" : ""}`} onClick={() => setChosen(c.id)}>
              <BadgeCheck size={20} />
              <span><strong>{c.name}</strong><small>{c.issuer}{c.validTo?` · válido até ${c.validTo.slice(0,10).replace(/\./g,'/')}`:''}</small></span>
              {c.icp && <em>{translateUi("ICP-Brasil")}{c.kind ? ` ${c.kind}` : ""}</em>}
            </button>
          ))}
        </div>
      )}
      <button className="button secondary" disabled={busy} onClick={()=>void chooseFile()}><FileSignature size={15}/>{" "}{translateUi("Escolher arquivo A1 (.pfx/.p12)…")}</button>
      {fromFile&&<><Password label={translateUi("Senha do certificado A1")} value={password} onChange={setPassword} disabled={busy}/><p className="muted">{translateUi("A senha não é salva. O nome real do titular é lido do certificado ao assinar.")}</p></>}
      <div className="field-row">
        <label className="field">{translateUi("Motivo (opcional)")}<input value={reason} onChange={(e) => setReason(e.target.value)} placeholder={translateUi("Ex.: Aprovo este documento")} maxLength={120} /></label>
        <label className="field">{translateUi("Local (opcional)")}<input value={location} onChange={(e) => setLocation(e.target.value)} placeholder={translateUi("Ex.: Belo Horizonte - MG")} maxLength={120} /></label>
      </div>
      {(area || visible) && signatures.length > 0 && (
        <label className="field">{translateUi("Imagem no carimbo")}{" "}<select value={image} onChange={(e) => setImage(e.target.value)}>
            <option value="">{translateUi("Somente nome e data")}</option>
            {signatures.map((s) => <option key={s.id} value={s.dataUrl}>{s.name}</option>)}
          </select>
        </label>
      )}
      {visible && chosen && (
        <div className="stamp-size">
          <span>{translateUi("Tamanho do carimbo")}</span>
          <div className="segmented small">{(["small", "medium", "large"] as const).map((k) => <button key={k} className={size === k ? "selected" : ""} onClick={() => setSize(k)}>{{ small: "Pequeno", medium: "Médio", large: "Grande" }[k]}</button>)}</div>
          <SignaturePreview lines={stampLines(signerName, reason, location)} image={image || undefined} scale={STAMP_SIZES[size]} />
        </div>
      )}
      <p className="compress-note"><ShieldCheck size={13} />{" "}{translateUi("Padrão PAdES (SHA-256). A1 em arquivo funciona no Windows, Linux e macOS. Certificados do sistema podem pedir autorização ou PIN. Depois de assinar, qualquer alteração invalida a assinatura: assine por último. Você pode conferir a validade no")}{" "}<button className="text-button" onClick={() => void window.gcp.openExternal(ITI)}>{translateUi("validador do ITI")}{" "}<ExternalLink size={11} /></button>.</p>
      <div className="modal-footer">
        <button className="button secondary" onClick={onClose}>{translateUi("Cancelar")}</button>
        {visible && onPlace ? (
          <button className="button primary" disabled={!chosen} onClick={() => { const lines = stampLines(signerName, reason, location), k = STAMP_SIZES[size]; onPlace({ options: { certificate: chosen, ...(fromFile?{password}:{}), reason, location, showName: true, signatureImage: image || undefined }, width: Math.round((image ? 250 : 190) * k), height: Math.round((26 + lines.length * 11) * k), lines, image: image || undefined }); }}><FileSignature size={15} />{" "}{translateUi("Posicionar na página")}</button>
        ) : <button className="button primary" disabled={!chosen || busy} onClick={() => void sign()}>{busy ? <LoaderCircle size={15} className="spin" /> : <FileSignature size={15} />}{" "}{translateUi("Assinar e salvar…")}</button>}
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
      {translateUi(label)}
      <div className="swatches">
        {SWATCHES.map((c) => <button key={c} title={c === "none" ? translateUi("Sem cor") : c} className={`swatch ${value === c ? "selected" : ""} ${c === "none" ? "none" : ""}`} style={c === "none" ? undefined : { background: c }} onClick={() => onChange(c)} />)}
        <input type="color" value={value === "none" ? "#ffffff" : value} onChange={(e) => onChange(e.target.value)} title={translateUi("Outra cor")} />
        <SavedColors value={value} onPick={onChange} />
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
    <Modal title={translateUi("Propriedades do campo")} description={`${name} · aparência, comportamento e formato`} onClose={onClose} wide>
      <div className="field-props">
        <section>
          <h3>{translateUi("Geral")}</h3>
          <label className="field">{translateUi("Nome do campo")}<input value={props.name ?? ""} onChange={(e) => set({ name: e.target.value })} /></label>
          <label className="field">{translateUi("Dica ao passar o mouse")}<input value={props.tooltip ?? ""} onChange={(e) => set({ tooltip: e.target.value })} placeholder={translateUi("Ex.: Informe o CPF do proponente")} /></label>
          <label className="check-row"><input type="checkbox" checked={!!props.required} onChange={(e) => set({ required: e.target.checked })} />{" "}{translateUi("Obrigatório")}</label>
          <label className="check-row"><input type="checkbox" checked={!!props.read_only} onChange={(e) => set({ read_only: e.target.checked })} />{" "}{translateUi("Somente leitura")}</label>
          {type === "text" && <label className="check-row"><input type="checkbox" checked={!!props.multiline} onChange={(e) => set({ multiline: e.target.checked })} />{" "}{translateUi("Várias linhas")}</label>}
          {type === "button" && (
            <>
              <label className="field">{translateUi("Texto do botão")}<input value={props.caption ?? ""} onChange={(e) => set({ caption: e.target.value })} placeholder={translateUi("Ex.: Enviar formulário")} /></label>
              <label className="field">{translateUi("Ação ao clicar")}{" "}<select value={props.action?.type ?? "keep"} onChange={(e) => { const t = e.target.value; set({ action: t === "keep" ? undefined : t === "url" || t === "submit" ? { type: t, url: "" } : t === "page" ? { type: "page", page: 1 } : { type: t as "none" | "reset" | "print" } }); }}>
                  <option value="keep">{translateUi("Manter a ação atual")}</option><option value="url">{translateUi("Abrir link (site ou e-mail)")}</option><option value="page">{translateUi("Ir para uma página")}</option>
                  <option value="reset">{translateUi("Limpar o formulário")}</option><option value="print">{translateUi("Imprimir o documento")}</option><option value="submit">{translateUi("Enviar o formulário (URL ou e-mail)")}</option><option value="none">{translateUi("Nenhuma ação")}</option>
                </select>
              </label>
              {(props.action?.type === "url" || props.action?.type === "submit") && <label className="field">{props.action.type === "url" ? translateUi("Endereço") : translateUi("Destino do envio")}<input value={props.action.url} onChange={(e) => set({ action: { type: props.action!.type as "url", url: e.target.value } })} placeholder={translateUi("https://… ou mailto:nome@exemplo.com")} /></label>}
              {props.action?.type === "page" && <label className="field">{translateUi("Página de destino")}<input type="number" min={1} value={props.action.page} onChange={(e) => set({ action: { type: "page", page: Math.max(1, Number(e.target.value) || 1) } })} /></label>}
            </>
          )}
          {textual && (
            <label className="field">{translateUi("Formato")}{" "}<select value={props.format} onChange={(e) => set({ format: e.target.value as FieldProps["format"] })}>
                <option value="none">{translateUi("Texto livre")}</option><option value="date">{translateUi("Data (dd/mm/aaaa)")}</option><option value="currency">{translateUi("Moeda (R$ 0.000,00)")}</option><option value="number">{translateUi("Número (0.000,00)")}</option>
                <option value="cpf">{translateUi("CPF")}</option><option value="cnpj">{translateUi("CNPJ")}</option><option value="cep">{translateUi("CEP")}</option><option value="phone">{translateUi("Telefone")}</option>
              </select>
            </label>
          )}
        </section>
        <section>
          <h3>{translateUi("Aparência")}</h3>
          <ColorPick label={translateUi("Borda")} value={props.appearance?.border ?? "none"} onChange={(border) => look({ border })} />
          <ColorPick label={translateUi("Preenchimento")} value={props.appearance?.fill ?? "none"} onChange={(fill) => look({ fill })} />
          <ColorPick label={translateUi("Texto")} value={props.appearance?.text_color ?? "#000000"} onChange={(text_color) => look({ text_color })} />
          <div className="field-row">
            <label className="field">{translateUi("Espessura")}<select value={props.appearance?.width} onChange={(e) => look({ width: Number(e.target.value) })}><option value={0}>{translateUi("Nenhuma")}</option><option value={1}>{translateUi("Fina")}</option><option value={2}>{translateUi("Média")}</option><option value={3}>{translateUi("Grossa")}</option></select></label>
            <label className="field">{translateUi("Estilo")}<select value={props.appearance?.style} onChange={(e) => look({ style: e.target.value as "solid" })}><option value="solid">{translateUi("Sólida")}</option><option value="dashed">{translateUi("Tracejada")}</option><option value="underline">{translateUi("Sublinhado")}</option><option value="beveled">{translateUi("Chanfrada")}</option><option value="inset">{translateUi("Embutida")}</option></select></label>
          </div>
          <div className="field-row">
            {!checks && <label className="field">{translateUi("Tamanho da fonte")}<select value={props.font_size} onChange={(e) => set({ font_size: Number(e.target.value) })}><option value={0}>{translateUi("Automático")}</option>{[8, 9, 10, 11, 12, 14, 16, 18, 24].map((n) => <option key={n} value={n}>{n}{" "}{translateUi("pt")}</option>)}</select></label>}
            {!checks && <label className="field">{translateUi("Alinhamento")}<select value={props.align} onChange={(e) => set({ align: e.target.value as "left" })}><option value="left">{translateUi("Esquerda")}</option><option value="center">{translateUi("Centro")}</option><option value="right">{translateUi("Direita")}</option></select></label>}
            {checks && <label className="field">{translateUi("Marca")}<select value={props.check_style ?? (type === "radio" ? "circle" : "check")} onChange={(e) => set({ check_style: e.target.value as "check" })}><option value="check">{translateUi("Visto ✓")}</option><option value="cross">{translateUi("Xis ✗")}</option><option value="circle">{translateUi("Círculo ●")}</option><option value="square">{translateUi("Quadrado ■")}</option><option value="diamond">{translateUi("Losango ◆")}</option><option value="star">{translateUi("Estrela ★")}</option></select></label>}
          </div>
        </section>
      </div>
      <div className="modal-footer">
        <button className="button secondary" onClick={onClose}>{translateUi("Fechar")}</button>
        <button className="button primary" onClick={() => onApply(props)}>{translateUi("Aplicar")}</button>
      </div>
    </Modal>
  );
}
export function FieldOptionsDialog({ kind, onClose, onConfirm }: { kind: "combo" | "list"; onClose: () => void; onConfirm: (options: string[], name: string) => void }) {
  const [text, setText] = useState("Opção 1\nOpção 2\nOpção 3"), [name, setName] = useState("");
  return (
    <Modal title={kind === "combo" ? translateUi("Lista suspensa") : translateUi("Caixa de lista")} description={translateUi("Uma opção por linha")} onClose={onClose}>
      <label className="field">{translateUi("Nome do campo (opcional)")}<input value={name} onChange={(e) => setName(e.target.value)} placeholder={translateUi("Ex.: Estado")} /></label>
      <label className="field">{translateUi("Opções")}<textarea rows={6} value={text} onChange={(e) => setText(e.target.value)} /></label>
      <div className="modal-footer">
        <button className="button secondary" onClick={onClose}>{translateUi("Cancelar")}</button>
        <button className="button primary" onClick={() => onConfirm(text.split("\n").map((s) => s.trim()).filter(Boolean), name.trim())}>{translateUi("Criar campo")}</button>
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
    <Modal title={translateUi("Assinaturas digitais do documento")} description={translateUi("Verificação local da cópia atual; alterações não salvas são sinalizadas")} onClose={onClose} wide>
      {error ? <p className="quick-error">{error}</p> : !list ? <div className="cert-loading"><LoaderCircle className="spin" size={18} />{" "}{translateUi("Verificando…")}</div> : !list.length ? <p className="sidebar-description">{translateUi("Este documento não tem assinaturas digitais.")}</p> : (
        <div className="cert-list">
          {list.map((s, i) => { const st = STATUS[s.status] ?? STATUS.unknown!; return (
            <div key={i} className={`cert sig-${st.tone}`}>{st.icon}<span><strong>{s.signer || s.name}</strong><small>{st.label}{s.date ? ` · assinado em ${pdfDate(s.date)}` : ""}</small>{s.explanation && <small>{s.explanation}</small>}</span></div>
          ); })}
        </div>
      )}
      <div className="modal-footer">
        <button className="button secondary" onClick={() => void window.gcp.openExternal(ITI)}><ExternalLink size={14} />{" "}{translateUi("Validar no ITI (validar.iti.gov.br)")}</button>
        <button className="button primary" onClick={onClose}>{translateUi("Fechar")}</button>
      </div>
    </Modal>
  );
}
