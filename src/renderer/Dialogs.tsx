import React, { useEffect, useRef, useState } from "react";
import { UpdateSettings } from "./Updates";
import {
  X,
  ArrowUpRight,
  Copy,
  Check,
  Upload,
  PenLine,
  Trash2,
  KeyRound,
  ShieldCheck,
  Heart,
  FileText,
  Table2,
  Presentation,
  Image as ImageIcon,
  FileImage,
  LoaderCircle,
  RotateCcw,
  FolderCog,
  ScanText,
} from "lucide-react";
import QRCode from "qrcode";
import {
  HOME_ACTIONS,
  DEFAULT_HOME_ACTIONS,
  SHORTCUT_COMMANDS,
  DEFAULT_SHORTCUTS,
  readHomeActions,
  saveHomeActions,
  readShortcuts,
  saveShortcuts,
  shortcutFromEvent,
  shortcutConflict,
  type ShortcutMap,
} from "../shared/shortcuts";
import type {
  AppPrompt,
  AiConfig,
  ExportFormat,
  ExportOptions,
  Signature,
} from "../shared/types";
export const PIX =
  "00020126850014br.gov.bcb.pix0136e474b71b-7491-4eac-992f-632652e5a4eb0223DEV GESTAO CULTURAL PRO5204000053039865802BR5915BRUNO ALBERTINI6006BRASIL62200516ChromeExtensions63042B27";
export const SITE = "https://gestaoculturalpro.com.br/";
export const STRIPE = "https://donate.stripe.com/fZu4gzeBSfhbd7451F6Ri00";
export function Modal({
  title,
  description,
  onClose,
  children,
  wide = false,
}: {
  title: string;
  description?: string;
  onClose: () => void;
  children: React.ReactNode;
  wide?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const handler = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
      if (event.key === "Tab" && ref.current) {
        const nodes = ref.current.querySelectorAll<HTMLElement>(
          'button:not(:disabled),input:not(:disabled),select,textarea,[tabindex="0"]',
        );
        const first = nodes[0],
          last = nodes[nodes.length - 1];
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last?.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first?.focus();
        }
      }
    };
    window.addEventListener("keydown", handler);
    ref.current?.querySelector<HTMLElement>("input,button")?.focus();
    return () => {
      window.removeEventListener("keydown", handler);
      previous?.focus();
    };
  }, []);
  return (
    <div
      className="modal-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={ref}
        className={`modal ${wide ? "modal-wide" : ""}`}
        role="dialog"
        aria-modal="true"
        aria-label={title}
      >
        <div className="modal-heading">
          <div>
            <h2>{title}</h2>
            {description && <p>{description}</p>}
          </div>
          <button
            className="icon-button"
            onClick={onClose}
            title="Fechar"
            aria-label="Fechar janela"
          >
            <X size={19} />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
export function ExportDialog({
  name,
  initialFormat,
  onClose,
  onExport,
}: {
  name: string;
  initialFormat?: ExportFormat;
  onClose: () => void;
  onExport: (options: ExportOptions) => Promise<void>;
}) {
  const [format, setFormat] = useState<ExportFormat>(initialFormat ?? "docx"),
    [mode, setMode] = useState<"editable" | "fidelity">("editable"),
    [dpi, setDpi] = useState(300),
    [pending, setPending] = useState(false),
    [error, setError] = useState("");
  const formats: {
    id: ExportFormat;
    title: string;
    extension: string;
    icon: React.ReactNode;
  }[] = [
    { id: "docx", title: "Word", extension: ".docx", icon: <FileText /> },
    { id: "xlsx", title: "Excel", extension: ".xlsx", icon: <Table2 /> },
    {
      id: "pptx",
      title: "PowerPoint",
      extension: ".pptx",
      icon: <Presentation />,
    },
    {
      id: "image-pdf",
      title: "PDF de imagens",
      extension: ".pdf",
      icon: <FileImage />,
    },
    { id: "png", title: "Imagem PNG", extension: ".png", icon: <ImageIcon /> },
    {
      id: "txt",
      title: "Texto simples",
      extension: ".txt",
      icon: <FileText />,
    },
  ];
  return (
    <Modal title="Exportar documento" description={name} onClose={onClose} wide>
      <div className="format-grid">
        {formats.map((f) => (
          <button
            key={f.id}
            className={`format-option ${format === f.id ? "selected" : ""}`}
            onClick={() => setFormat(f.id)}
          >
            {f.icon}
            <strong>{f.title}</strong>
            <span>{f.extension}</span>
            {format === f.id && <Check className="format-check" size={15} />}
          </button>
        ))}
      </div>
      {["docx", "pptx"].includes(format) && (
        <section className="form-section">
          <h3>Como deseja preservar o documento?</h3>
          <label className="radio-card">
            <input
              type="radio"
              checked={mode === "editable"}
              onChange={() => setMode("editable")}
            />
            <span>
              <strong>
                {format === "docx"
                  ? "Layout preservado e editável"
                  : "Conteúdo editável"}
              </strong>
              <small>
                {format === "docx"
                  ? "Mantém fundos, tabelas, ícones e imagens exatamente como no PDF; os textos ficam editáveis, com as fontes, cores e tamanhos originais."
                  : "Reconstrói textos, posições e elementos compatíveis. Revise documentos complexos após converter."}
              </small>
            </span>
          </label>
          <label className="radio-card">
            <input
              type="radio"
              checked={mode === "fidelity"}
              onChange={() => setMode("fidelity")}
            />
            <span>
              <strong>Aparência original</strong>
              <small>
                Cada página vira uma imagem de alta resolução. Preserva o
                visual, mas o texto não será editável.
              </small>
            </span>
          </label>
        </section>
      )}
      {(format === "image-pdf" || format === "png" || mode === "fidelity") && (
        <label className="field">
          Resolução
          <select value={dpi} onChange={(e) => setDpi(Number(e.target.value))}>
            <option value={150}>150 dpi — arquivo menor</option>
            <option value={300}>300 dpi — alta qualidade</option>
          </select>
        </label>
      )}
      <p className="muted" style={{ fontSize: 11 }}>
        Para converter um XML fiscal em PDF, use a aba Converter → XML fiscal
        para PDF. O arquivo XML original é mantido.
      </p>
      {format === "image-pdf" && (
        <div className="info-note">
          <ShieldCheck size={20} />
          <p>
            O PDF exportado conterá imagens das páginas, sem texto selecionável.
            Isso não impede OCR ou alterações com outros programas.
          </p>
        </div>
      )}
      {format === "xlsx" && (
        <div className="info-note">
          <Table2 size={20} />
          <p>
            A conversão identifica linhas e colunas do texto. Documentos
            digitalizados precisam de OCR antes da exportação. Revise fórmulas e
            a organização final.
          </p>
        </div>
      )}
      {format === "png" && (
        <div className="info-note">
          <ImageIcon size={20} />
          <p>
            Esta opção exporta a primeira página. Para todas as páginas, use PDF
            de imagens.
          </p>
        </div>
      )}
      {error && (
        <p className="inline-error" role="alert">
          {error}
        </p>
      )}
      <div className="modal-footer">
        <span className="privacy-caption">
          <ShieldCheck size={14} /> Conversão local, sem enviar arquivos
        </span>
        <button
          className="button secondary"
          onClick={onClose}
          disabled={pending}
        >
          Cancelar
        </button>
        <button
          className="button primary"
          disabled={pending}
          onClick={async () => {
            setPending(true);
            setError("");
            try {
              await onExport({ format, mode, dpi });
            } catch (e) {
              setError(String(e));
            } finally {
              setPending(false);
            }
          }}
        >
          {pending ? (
            <LoaderCircle size={17} className="spin" />
          ) : (
            <ArrowUpRight size={17} />
          )}{" "}
          {pending ? "Convertendo…" : "Exportar arquivo"}
        </button>
      </div>
    </Modal>
  );
}
function SignatureCanvas({
  onChange,
  clearToken,
}: {
  onChange: (value: string) => void;
  clearToken: number;
}) {
  const ref = useRef<HTMLCanvasElement>(null),
    active = useRef(false),
    last = useRef<{ x: number; y: number } | null>(null);
  useEffect(() => {
    const c = ref.current;
    c?.getContext("2d")?.clearRect(0, 0, c.width, c.height);
    onChange("");
  }, [clearToken]);
  function point(event: React.PointerEvent) {
    const r = ref.current!.getBoundingClientRect();
    return {
      x: ((event.clientX - r.left) * 900) / r.width,
      y: ((event.clientY - r.top) * 300) / r.height,
    };
  }
  return (
    <canvas
      ref={ref}
      width={900}
      height={300}
      className="signature-draw"
      aria-label="Área para desenhar sua assinatura"
      onPointerDown={(e) => {
        active.current = true;
        last.current = point(e);
        e.currentTarget.setPointerCapture(e.pointerId);
        e.preventDefault();
      }}
      onPointerMove={(e) => {
        if (!active.current || !last.current) return;
        const next = point(e),
          ctx = ref.current?.getContext("2d");
        if (!ctx) return;
        ctx.beginPath();
        ctx.moveTo(last.current.x, last.current.y);
        ctx.lineTo(next.x, next.y);
        ctx.strokeStyle = "#191726";
        ctx.lineWidth = 3;
        ctx.lineCap = "round";
        ctx.lineJoin = "round";
        ctx.stroke();
        last.current = next;
      }}
      onPointerUp={(e) => {
        active.current = false;
        last.current = null;
        e.currentTarget.releasePointerCapture(e.pointerId);
        onChange(e.currentTarget.toDataURL("image/png"));
      }}
    />
  );
}
export function SignatureDialog({
  onClose,
  onSaved,
}: {
  onClose: () => void;
  onSaved: (signatures: Signature[]) => void;
}) {
  const [name, setName] = useState(""),
    [data, setData] = useState(""),
    [method, setMethod] = useState<"draw" | "image">("draw"),
    [clear, setClear] = useState(0),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  return (
    <Modal
      title="Nova assinatura"
      description="Salve com um nome e reutilize em qualquer documento."
      onClose={onClose}
    >
      <label className="field">
        Nome da assinatura
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Ex.: Bruno — assinatura completa"
          maxLength={100}
        />
      </label>
      <div className="segmented">
        <button
          className={method === "draw" ? "selected" : ""}
          onClick={() => {
            setMethod("draw");
            setData("");
          }}
        >
          <PenLine size={16} /> Desenhar
        </button>
        <button
          className={method === "image" ? "selected" : ""}
          onClick={() => {
            setMethod("image");
            setData("");
          }}
        >
          <Upload size={16} /> Enviar imagem
        </button>
      </div>
      {method === "draw" ? (
        <>
          <SignatureCanvas onChange={setData} clearToken={clear} />
          <button
            className="text-button"
            onClick={() => setClear((x) => x + 1)}
          >
            <RotateCcw size={14} /> Limpar desenho
          </button>
        </>
      ) : (
        <div className="signature-upload">
          {data ? (
            <img src={data} alt="Prévia da assinatura" />
          ) : (
            <Upload size={30} />
          )}
          <button
            className="button secondary"
            onClick={async () => {
              try {
                const image = await window.gcp.chooseImage();
                if (image) {
                  setData(image.dataUrl);
                  if (!name) setName(image.name.replace(/\.[^.]+$/, ""));
                }
              } catch (e) {
                setError(String(e));
              }
            }}
          >
            {data ? "Trocar imagem" : "Escolher imagem PNG ou JPEG"}
          </button>
          <p>Use uma imagem com fundo transparente para melhor resultado.</p>
        </div>
      )}
      {error && <p className="inline-error">{error}</p>}
      <div className="modal-footer">
        <span className="privacy-caption">
          A assinatura fica neste computador.
        </span>
        <button className="button secondary" onClick={onClose}>
          Cancelar
        </button>
        <button
          className="button primary"
          disabled={!name.trim() || !data || busy}
          onClick={async () => {
            setBusy(true);
            try {
              onSaved(
                await window.gcp.saveSignature({
                  name: name.trim(),
                  dataUrl: data,
                }),
              );
              onClose();
            } catch (e) {
              setError(String(e));
            } finally {
              setBusy(false);
            }
          }}
        >
          {busy ? (
            <LoaderCircle size={16} className="spin" />
          ) : (
            <Check size={16} />
          )}{" "}
          Salvar assinatura
        </button>
      </div>
    </Modal>
  );
}
export function SettingsDialog({
  onClose,
  onTheme,
  theme,
  labels = "below",
  onLabels,
  quickActions = true,
  onUpdateFound,
}: {
  quickActions?: boolean;
  onUpdateFound?: (info: import("../shared/types").UpdateInfo) => void;
  onClose: () => void;
  onTheme: (theme: "light" | "dark") => void;
  theme: "light" | "dark";
  labels?: "below" | "side" | "hidden";
  onLabels?: (labels: "below" | "side" | "hidden") => void;
}) {
  const [tab, setTab] = useState<"general" | "ai" | "shortcuts">("general"),
    [config, setConfig] = useState<AiConfig | null>(null),
    [key, setKey] = useState(""),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState(""),
    [error, setError] = useState("");
  useEffect(() => {
    window.gcp
      .getAiConfig()
      .then(setConfig)
      .catch((e) => setError(String(e)));
  }, []);
  const [models, setModels] = useState<{ id: string; label: string }[]>([]);
  /** Runs a model tool with the typed key (or the saved one), showing errors in Portuguese. */
  const aiTool = async (run: (input: { provider: AiConfig["provider"]; baseUrl: string; key?: string }) => Promise<void>) => {
    if (!config) return;
    setBusy(true); setError(""); setMessage("");
    try { await run({ provider: config.provider, baseUrl: config.baseUrl, key: key.trim() || undefined }); }
    catch (e) { setError(e instanceof Error ? e.message.replace(/^Error: /, "").replace(/^Error invoking remote method '[^']+': (Error: )?/, "") : String(e)); }
    finally { setBusy(false); }
  };
  const field = (name: "model" | "baseUrl", value: string) =>
    config && setConfig({ ...config, [name]: value });
  return (
    <Modal
      title="Configurações"
      description="Seu espaço de trabalho, do seu jeito."
      onClose={onClose}
      wide
    >
      <div className="settings-tabs">
        <button
          className={tab === "general" ? "active" : ""}
          onClick={() => setTab("general")}
        >
          <FolderCog size={17} /> Aplicativo
        </button>
        <button
          className={tab === "ai" ? "active" : ""}
          onClick={() => setTab("ai")}
        >
          <KeyRound size={17} /> Inteligência artificial
        </button>
        <button
          className={tab === "shortcuts" ? "active" : ""}
          onClick={() => setTab("shortcuts")}
        >
          Atalhos e Início
        </button>
      </div>
      {tab === "shortcuts" ? (
        <ShortcutPreferences />
      ) : tab === "general" ? (
        <>
          <UpdateSettings onFound={(info) => { onUpdateFound?.(info); }} />
          <section className="form-section">
            <h3>Aparência</h3>
            <div className="theme-options">
              <button
                className={theme === "light" ? "selected" : ""}
                onClick={() => onTheme("light")}
              >
                <div className="theme-preview light">
                  <i />
                  <i />
                  <i />
                </div>
                Tema claro
              </button>
              <button
                className={theme === "dark" ? "selected" : ""}
                onClick={() => onTheme("dark")}
              >
                <div className="theme-preview dark">
                  <i />
                  <i />
                  <i />
                </div>
                Tema escuro
              </button>
            </div>
          </section>
          {onLabels && (
            <section className="form-section">
              <h3>Rótulos da barra de ferramentas</h3>
              <div className="segmented">
                {(
                  [
                    ["below", "Abaixo do ícone"],
                    ["side", "Ao lado do ícone"],
                    ["hidden", "Só ícones (nome ao passar o mouse)"],
                  ] as const
                ).map(([value, label]) => (
                  <button
                    key={value}
                    className={labels === value ? "selected" : ""}
                    onClick={() => onLabels(value)}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </section>
          )}
          <section className="form-section">
            <h3>Ações rápidas no Windows</h3>
            <p className="muted">
              “Converter para PDF” e “Combinar em um PDF” (PDF, imagens, Word,
              Excel, PowerPoint…) no menu de contexto do Explorador. No Windows
              11, use “Mostrar mais opções”.
            </p>
            <label className="switch-row">
              <input
                type="checkbox"
                checked={quickActions}
                disabled={busy}
                onChange={async (e) => {
                  const enabled = e.target.checked;
                  setBusy(true);
                  try {
                    await window.gcp.installContextMenu(enabled);
                    setMessage(
                      enabled
                        ? "Ações rápidas ativas no menu do Explorador."
                        : "Ações rápidas removidas do Explorador.",
                    );
                  } catch (error) {
                    setError(String(error));
                  } finally {
                    setBusy(false);
                  }
                }}
              />
              <span style={{ fontSize: 12, lineHeight: 1.45, fontWeight: 400 }}>
                {quickActions
                  ? "Ativadas — instaladas automaticamente ao abrir o GCP-PDF"
                  : "Desativadas"}
              </span>
            </label>
          </section>
          <div className="info-note">
            <ShieldCheck size={21} />
            <p>
              Seus PDFs, assinaturas e configurações ficam neste computador. Não
              há cadastro, sincronização ou envio automático de documentos.
            </p>
          </div>
        </>
      ) : config ? (
        <>
          <GoogleApiHelp />
          <label className="field">
            Provedor
            <select
              value={config.provider}
              onChange={(e) => {
                setConfig({
                  ...config,
                  provider: e.target.value as AiConfig["provider"],
                  model: e.target.value === "gemini" ? "gemini-3.5-flash-lite" : "",
                  hasKey: false,
                  baseUrl:
                    e.target.value === "gemini"
                      ? "https://generativelanguage.googleapis.com/v1beta"
                      : e.target.value === "openai"
                        ? "https://api.openai.com/v1"
                        : "",
                });
                setKey("");
              }}
            >
              <option value="gemini">Google AI Studio / Gemini</option>
              <option value="openai">OpenAI</option>
              <option value="compatible">API compatível com OpenAI</option>
            </select>
          </label>
          <label className="field">
            Modelo
            <input
              value={config.model}
              list="gcp-ai-models"
              onChange={(e) => field("model", e.target.value)}
              placeholder="Nome do modelo disponível na sua conta"
            />
            <datalist id="gcp-ai-models">{models.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}</datalist>
            <small>{models.length ? `${models.length} modelos disponíveis para a sua chave — escolha na lista ou digite.` : "Use “Ver modelos” para listar os que a sua chave pode usar."}</small>
          </label>
          <div className="button-row ai-model-tools">
            <button className="button secondary" disabled={busy} onClick={() => void aiTool(async (input) => { const list = await window.gcp.listAiModels(input); setModels(list); setMessage(list.length ? `${list.length} modelos encontrados. Escolha um na lista do campo Modelo.` : "A chave não tem modelos de texto disponíveis."); })}>Ver modelos</button>
            <button className="button secondary" disabled={busy || !config.model.trim()} onClick={() => void aiTool(async (input) => { const r = await window.gcp.probeAiModel({ ...input, model: config.model }); if (r.ok) setMessage(`O modelo ${config.model} respondeu: está funcionando com a sua chave.`); else setError(r.message ?? "O modelo não respondeu."); })}>Testar modelo</button>
            <button className="button primary" disabled={busy} title="Chave com faturamento: escolhe o modelo mais completo. Chave gratuita: testa do mais leve ao mais completo e escolhe o primeiro que responder" onClick={() => void aiTool(async (input) => {
              const r = await window.gcp.findFreeAiModel(input);
              if (r.model) { const saved = await window.gcp.saveAiConfig({ ...config, model: r.model, key: key || undefined }); setConfig(saved); setKey(""); setMessage(r.paid ? `Sua chave tem faturamento ativo: escolhemos o modelo mais completo, ${r.model}, e ele já foi salvo.` : `Pronto: o modelo ${r.model} funciona com a sua chave gratuita e já foi salvo.`); }
              else setError(`Nenhum modelo respondeu com esta chave agora. ${r.tried[0]?.message ?? ""} Se a cota diária gratuita acabou, tente amanhã; ou ative o faturamento no Google AI Studio.`);
            })}>Encontrar melhor modelo</button>
          </div>
          <label className="field">
            Chave de API
            <input
              type="password"
              autoComplete="off"
              value={key}
              onChange={(e) => setKey(e.target.value)}
              placeholder={
                config.hasKey
                  ? "Chave salva — preencha apenas para substituir"
                  : "Cole sua chave de API"
              }
            />
            <small>
              {config.hasKey
                ? "Uma chave está configurada. Ela não é exibida aqui."
                : "A chave é armazenada com proteção do sistema operacional quando disponível."}
            </small>
          </label>
          <label className="field">
            Endereço da API
            <input
              value={config.baseUrl}
              onChange={(e) => field("baseUrl", e.target.value)}
              placeholder={
                config.provider === "gemini"
                  ? "https://generativelanguage.googleapis.com"
                  : config.provider === "openai"
                    ? "https://api.openai.com/v1"
                    : "https://servidor.exemplo/v1"
              }
            />
            <small>Use o endereço correspondente ao provedor escolhido.</small>
          </label>
          <div className="info-note">
            <ShieldCheck size={20} />
            <p>
              Somente ao clicar em “Enviar pergunta” o texto do documento será
              enviado ao provedor configurado. A cobrança e os limites seguem
              sua conta de API.
            </p>
          </div>
          <div className="button-row">
            <button
              className="button primary"
              disabled={busy || !config.model.trim()}
              onClick={async () => {
                setBusy(true);
                setError("");
                try {
                  const saved = await window.gcp.saveAiConfig({
                    ...config,
                    key: key || undefined,
                  });
                  setConfig(saved);
                  setKey("");
                  setMessage("Configuração de IA salva.");
                } catch (e) {
                  setError(String(e));
                } finally {
                  setBusy(false);
                }
              }}
            >
              {busy ? (
                <LoaderCircle className="spin" size={16} />
              ) : (
                <Check size={16} />
              )}{" "}
              Salvar configuração
            </button>
          </div>
        </>
      ) : (
        <div className="dialog-loading">
          <LoaderCircle className="spin" /> Carregando configurações…
        </div>
      )}
      {message && (
        <p className="inline-success" role="status">
          {message}
        </p>
      )}
      {error && (
        <p className="inline-error" role="alert">
          {error}
        </p>
      )}
    </Modal>
  );
}
export function SupportDialog({ onClose }: { onClose: () => void }) {
  const [qr, setQr] = useState(""),
    [copied, setCopied] = useState(false);
  useEffect(() => {
    void QRCode.toDataURL(PIX, {
      width: 280,
      margin: 2,
      errorCorrectionLevel: "M",
    }).then(setQr);
  }, []);
  return (
    <Modal
      title="Apoie o projeto"
      description="Sua contribuição ajuda a manter o GCP-PDF aberto e em evolução."
      onClose={onClose}
      wide
    >
      <div className="support-credit">
        <div className="brand-mark small">
          <FileText size={23} />
        </div>
        <div>
          <strong>Desenvolvido por Bruno Albertini</strong>
          <button
            className="text-button"
            onClick={() => window.gcp.openExternal(SITE)}
          >
            Gestão Cultural Pro <ArrowUpRight size={14} />
          </button>
        </div>
      </div>
      <div className="support-grid">
        <section className="support-card">
          <span className="eyebrow">PIX · BRASIL</span>
          {qr ? (
            <img
              className="pix-qr"
              src={qr}
              alt="QR Code PIX para apoiar o projeto"
            />
          ) : (
            <div className="pix-qr" />
          )}
          <p>Escaneie com o aplicativo do seu banco.</p>
          <button
            className="button primary full"
            onClick={async () => {
              await window.gcp.copyText(PIX);
              setCopied(true);
              setTimeout(() => setCopied(false), 2500);
            }}
          >
            {copied ? <Check size={17} /> : <Copy size={17} />}{" "}
            {copied ? "PIX copiado" : "Copiar PIX"}
          </button>
          <details>
            <summary>Ver código PIX</summary>
            <code className="pix-code">{PIX}</code>
          </details>
        </section>
        <section className="support-card">
          <span className="eyebrow">STRIPE · INTERNACIONAL</span>
          <div className="support-heart">
            <Heart size={34} />
          </div>
          <h3>Faça parte dessa construção</h3>
          <p>Contribua com qualquer valor pelo checkout seguro do Stripe.</p>
          <button
            className="button secondary full"
            onClick={() => window.gcp.openExternal(STRIPE)}
          >
            Contribuir via Stripe <ArrowUpRight size={17} />
          </button>
          <button
            className="text-button"
            onClick={() => window.gcp.copyText(STRIPE)}
          >
            <Copy size={14} /> Copiar link do Stripe
          </button>
          <p className="support-disclaimer">
            O apoio é voluntário. As funções do aplicativo estão disponíveis sem
            contribuição.
          </p>
        </section>
      </div>
    </Modal>
  );
}
/** The app's own confirmation dialog, replacing native Windows message boxes. */
export function PromptDialog({
  prompt,
  onAnswer,
}: {
  prompt: AppPrompt;
  onAnswer: (index: number) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    ref.current
      ?.querySelector<HTMLButtonElement>(`[data-index="${prompt.defaultId}"]`)
      ?.focus();
    const handler = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        onAnswer(prompt.cancelId);
      }
    };
    window.addEventListener("keydown", handler, true);
    return () => window.removeEventListener("keydown", handler, true);
  }, [prompt.id]);
  return (
    <div className="modal-backdrop prompt-backdrop" role="presentation">
      <div
        className={`prompt-card tone-${prompt.tone ?? "question"}`}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="prompt-title"
        ref={ref}
      >
        <div className="prompt-icon">
          {prompt.tone === "danger" ? (
            <Trash2 size={20} />
          ) : prompt.tone === "info" ? (
            <Check size={20} />
          ) : (
            <FileText size={20} />
          )}
        </div>
        <div className="prompt-text">
          <h2 id="prompt-title">{prompt.title}</h2>
          <p>{prompt.message}</p>
          {prompt.detail && <small>{prompt.detail}</small>}
        </div>
        <div className="prompt-buttons">
          {prompt.buttons.map((label, index) => (
            <button
              key={label}
              data-index={index}
              className={`button ${index === prompt.defaultId ? "primary" : index === prompt.cancelId ? "ghost" : "secondary"}`}
              onClick={() => onAnswer(index)}
            >
              {label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

export function GoogleApiHelp() {
  return (
    <section
      className="form-section"
      style={{ fontSize: 12, lineHeight: 1.55 }}
    >
      <h3>Obter uma chave Google AI Studio</h3>
      <ol>
        <li>Abra o Google AI Studio e entre com sua conta Google.</li>
        <li>
          Em API Keys, escolha Criar chave de API e selecione ou crie um
          projeto.
        </li>
        <li>Copie a chave e cole no campo Chave de API do GCP-PDF.</li>
        <li>Escolha um modelo disponível na conta e salve a configuração.</li>
      </ol>
      <p>
        Criar a chave não tem custo. O uso gratuito depende dos modelos, cotas,
        região e elegibilidade da conta; ativar faturamento pode gerar
        cobranças.
      </p>
      <button
        className="text-button"
        onClick={() =>
          void window.gcp.openExternal("https://aistudio.google.com/apikey")
        }
      >
        Abrir Google AI Studio <ArrowUpRight size={13} />
      </button>
    </section>
  );
}
function ShortcutPreferences() {
  const [home, setHome] = useState(readHomeActions),
    [keys, setKeys] = useState(readShortcuts),
    [error, setError] = useState(""),
    [message, setMessage] = useState("");
  const homeChange = (ids: string[]) => {
    saveHomeActions(ids);
    setHome(ids);
    setMessage("Atalhos da aba Início salvos.");
  };
  function change(id: string, value: string) {
    const conflict = shortcutConflict(keys, id, value);
    if (conflict) {
      setError(
        "Esse atalho já está associado a " +
          (SHORTCUT_COMMANDS.find((c) => c.id === conflict)?.label ||
            conflict) +
          ". Limpe a associação anterior primeiro.",
      );
      return;
    }
    const next = { ...keys, [id]: value };
    saveShortcuts(next);
    setKeys(next);
    setError("");
    setMessage("Atalho salvo.");
  }
  return (
    <div>
      <section className="form-section">
        <h3>Ferramentas da aba Início</h3>
        <p className="muted">
          Escolha os atalhos e sua ordem. As ações de arquivo, seleção e zoom
          permanecem fixas.
        </p>
        <div
          style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 }}
        >
          {HOME_ACTIONS.map((item) => {
            const index = home.indexOf(item.id);
            return (
              <div
                key={item.id}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 7,
                  fontSize: 12,
                }}
              >
                <label
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 6,
                    flex: 1,
                  }}
                >
                  <input
                    type="checkbox"
                    checked={index >= 0}
                    onChange={(e) =>
                      homeChange(
                        e.target.checked
                          ? [...home, item.id]
                          : home.filter((id) => id !== item.id),
                      )
                    }
                  />
                  {item.label}
                </label>
                {index >= 0 && (
                  <>
                    <button
                      className="text-button"
                      title={"Mover " + item.label + " para a esquerda"}
                      disabled={index === 0}
                      onClick={() => {
                        const next = [...home];
                        [next[index - 1], next[index]] = [
                          next[index],
                          next[index - 1],
                        ];
                        homeChange(next);
                      }}
                    >
                      ↑
                    </button>
                    <button
                      className="text-button"
                      title={"Mover " + item.label + " para a direita"}
                      disabled={index === home.length - 1}
                      onClick={() => {
                        const next = [...home];
                        [next[index], next[index + 1]] = [
                          next[index + 1],
                          next[index],
                        ];
                        homeChange(next);
                      }}
                    >
                      ↓
                    </button>
                  </>
                )}
              </div>
            );
          })}
        </div>
        <button
          className="text-button"
          onClick={() => homeChange([...DEFAULT_HOME_ACTIONS])}
        >
          Restaurar Início padrão
        </button>
      </section>
      <section className="form-section">
        <h3>Atalhos do teclado</h3>
        <p className="muted">
          Clique em uma combinação e pressione o novo atalho. As alterações
          ficam salvas neste computador. Ao digitar em texto ou formulários,
          Delete e os atalhos de edição atuam no campo. F11 também alterna a
          tela cheia; Esc encerra a ferramenta atual.
        </p>
        <table
          style={{ width: "100%", fontSize: 12, borderCollapse: "collapse" }}
        >
          <thead>
            <tr>
              <th align="left">Ação e contexto</th>
              <th align="left">Combinação</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {SHORTCUT_COMMANDS.map((command) => (
              <tr key={command.id}>
                <td
                  style={{
                    padding: "7px 4px",
                    borderBottom: "1px solid var(--border,#e5e1ef)",
                  }}
                >
                  {command.label}
                  <small style={{ display: "block", opacity: 0.65 }}>
                    {command.scope}
                  </small>
                </td>
                <td style={{ width: 160 }}>
                  <span
                    style={{ display: "flex", gap: 3, marginBottom: 4 }}
                    aria-hidden="true"
                  >
                    {(keys[command.id] || "Sem atalho")
                      .split("+")
                      .map((part, index) => (
                        <kbd key={index}>
                          {{
                            Plus: "+",
                            Minus: "−",
                            Delete: "Del",
                            Escape: "Esc",
                          }[part] || part}
                        </kbd>
                      ))}
                  </span>
                  <input
                    aria-label={"Atalho para " + command.label}
                    readOnly
                    value={keys[command.id] || "Sem atalho"}
                    style={{ width: 148, padding: 7, fontFamily: "monospace" }}
                    onKeyDown={(e) => {
                      if (e.key === "Tab") return;
                      e.preventDefault();
                      e.stopPropagation();
                      const shortcut = shortcutFromEvent(e.nativeEvent);
                      if (shortcut) change(command.id, shortcut);
                    }}
                  />
                </td>
                <td>
                  <button
                    className="text-button"
                    aria-label={"Limpar atalho de " + command.label}
                    onClick={() => change(command.id, "")}
                  >
                    Limpar
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <button
          className="text-button"
          onClick={() => {
            saveShortcuts(DEFAULT_SHORTCUTS);
            setKeys({ ...DEFAULT_SHORTCUTS });
            setMessage("Atalhos padrão restaurados.");
            setError("");
          }}
        >
          Restaurar atalhos padrão
        </button>
      </section>
      {error && (
        <p className="inline-error" role="alert">
          {error}
        </p>
      )}
      {message && (
        <p className="inline-success" role="status">
          {message}
        </p>
      )}
    </div>
  );
}
