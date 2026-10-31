import {t as translateUi} from "./i18n";
import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  Search,
  CornerDownLeft,
  BookOpen,
  ChevronRight,
  X,
  FolderOpen,
  Save,
  SavePen,
  Printer,
  FilePlus2,
  PencilLine,
  Type,
  ImagePlus,
  Shapes,
  Highlighter,
  Underline,
  Strikethrough,
  PenLine,
  LayoutGrid,
  RotateCw,
  Trash2,
  FileOutput,
  Scissors,
  Hash,
  Layers,
  FileInput,
  FileText,
  Sheet,
  Presentation,
  Image,
  Minimize2,
  ScanText,
  Signature,
  Stamp,
  BadgeCheck,
  ShieldCheck,
  FormInput,
  ScanSearch,
  Download,
  Lock,
  Eraser,
  Sparkles,
  SunMoon,
  Settings,
  CircleHelp,
  GitCompareArrows,
  BarChart3,
  FileCog,
  Command as CommandIcon,
  type LucideIcon,
} from "lucide-react";

import { GoogleApiHelp } from "./Dialogs";
import { SHORTCUT_COMMANDS, readShortcuts } from "../shared/shortcuts";
export interface Command {
  id: string;
  label: string;
  group: string;
  keywords?: string;
  shortcut?: string;
  disabled?: boolean;
  run: () => void;
  help?: string;
}
/** One illustrative icon per command, so the list reads at a glance like the ribbon. */
const ICONS: Record<string, LucideIcon> = {
  open: FolderOpen,
  save: Save,
  "save-as": SavePen,
  print: Printer,
  new: FilePlus2,
  "edit-all": PencilLine,
  "add-text": Type,
  image: ImagePlus,
  shapes: Shapes,
  highlight: Highlighter,
  underline: Underline,
  strike: Strikethrough,
  ink: PenLine,
  organize: LayoutGrid,
  rotate: RotateCw,
  "delete-pages": Trash2,
  extract: FileOutput,
  split: Scissors,
  number: Hash,
  combine: Layers,
  "convert-files": FileInput,
  "fiscal-xml": FileInput,
  word: FileText,
  excel: Sheet,
  ppt: Presentation,
  "image-pdf": Image,
  compress: Minimize2,
  ocr: ScanText,
  signatures: Signature,
  stamps: Stamp,
  certificate: BadgeCheck,
  "check-signatures": ShieldCheck,
  "form-text": FormInput,
  "form-detect": ScanSearch,
  "form-export": Download,
  protect: Lock,
  hidden: Eraser,
  find: Search,
  ai: Sparkles,
  theme: SunMoon,
  settings: Settings,
  help: CircleHelp,
  compare: GitCompareArrows,
  stats: BarChart3,
  properties: FileCog,
};
const fold = (text: string) =>
  text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();
/** Ctrl+K: find any tool by name or by what it does ("assinar", "senha", "juntar"…). */
export function CommandPalette({
  commands,
  onClose,
  onHelp,
}: {
  commands: Command[];
  onClose: () => void;
  onHelp: (topic?: string) => void;
}) {
  const [query, setQuery] = useState(""),
    [index, setIndex] = useState(0),
    list = useRef<HTMLDivElement>(null);
  const results = useMemo(() => {
    const words = fold(query).split(/\s+/).filter(Boolean);
    const scored = commands
      .map((c) => {
        const label = fold(translateUi(c.label)),
          all = fold(
            `${translateUi(c.label)} ${translateUi(c.group)} ${c.keywords ?? ""} ${c.help ?? ""}`,
          );
        if (!words.every((w) => all.includes(w))) return null;
        const labelWords = label.split(/[^a-z0-9]+/),
          keyWords = fold(`${c.keywords ?? ""} ${c.group}`).split(/[^a-z0-9]+/);
        // Whole-word matches rank first, so "senha" finds Proteger before "de-senha-r".
        return {
          c,
          score:
            words.reduce(
              (s, w) =>
                s +
                (labelWords.some((x) => x.startsWith(w))
                  ? 6
                  : keyWords.some((x) => x.startsWith(w))
                    ? 4
                    : label.includes(w)
                      ? 2
                      : 1),
              0,
            ) - (c.disabled ? 5 : 0),
        };
      })
      .filter(Boolean) as { c: Command; score: number }[];
    return scored
      .sort(
        (a, b) =>
          b.score - a.score || a.c.label.localeCompare(b.c.label, "pt-BR"),
      )
      .map((x) => x.c)
      .slice(0, 60);
  }, [query, commands]);
  useEffect(() => setIndex(0), [query]);
  useEffect(() => {
    list.current
      ?.querySelector<HTMLElement>(`[data-i="${index}"]`)
      ?.scrollIntoView({ block: "nearest" });
  }, [index]);
  const run = (c?: Command) => {
    if (!c || c.disabled) return;
    onClose();
    setTimeout(c.run, 0);
  };
  return (
    <div
      className="modal-backdrop palette-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="palette" role="dialog" aria-label={translateUi("Localizar ferramentas")}>
        <div className="palette-search">
          <Search size={17} />
          <input
            autoFocus
            value={query}
            placeholder={translateUi("Localizar ferramentas e comandos… (ex.: senha, juntar, assinar)")}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown") {
                e.preventDefault();
                setIndex((i) => Math.min(results.length - 1, i + 1));
              }
              if (e.key === "ArrowUp") {
                e.preventDefault();
                setIndex((i) => Math.max(0, i - 1));
              }
              if (e.key === "Enter") run(results[index]);
              if (e.key === "Escape") onClose();
            }}
          />
          <kbd>{translateUi("Esc")}</kbd>
        </div>
        <div className="palette-list" ref={list}>
          {results.map((c, i) => (
            <button
              key={c.id}
              data-i={i}
              className={`palette-item ${i === index ? "active" : ""}`}
              disabled={c.disabled}
              onMouseEnter={() => setIndex(i)}
              onClick={() => run(c)}
            >
              {(() => {
                const Icon = ICONS[c.id] ?? CommandIcon;
                return (
                  <span className="palette-icon">
                    <Icon size={16} />
                  </span>
                );
              })()}
              <span className="palette-label">
                {translateUi(c.label)}
                {c.help && i === index && <small>{c.help}</small>}
              </span>
              <span className="palette-group">{c.group}</span>
              {c.shortcut ? (
                <kbd>{c.shortcut}</kbd>
              ) : i === index ? (
                <CornerDownLeft size={13} />
              ) : null}
            </button>
          ))}
          {!results.length && (
            <div className="palette-empty">{" "}{translateUi("Nenhuma ferramenta encontrada para “")}{query}”.
            </div>
          )}
        </div>
        <div className="palette-footer">
          <span>{translateUi("↑↓ navegar · Enter executar")}</span>
          <button
            className="text-button"
            onClick={() => {
              onClose();
              onHelp();
            }}
          >
            <BookOpen size={13} />{" "}{translateUi("Central de ajuda")}{" "}</button>
        </div>
      </div>
    </div>
  );
}

/** Small illustrated guides: what each tool does, with a step-by-step example. */
interface Topic {
  id: string;
  title: string;
  summary: string;
  steps: string[];
  tip?: string;
  art: React.ReactNode;
}
const page = (children: React.ReactNode) => (
  <svg viewBox="0 0 160 110" className="help-art" aria-hidden>
    <rect
      x="44"
      y="6"
      width="72"
      height="98"
      rx="4"
      fill="#fff"
      stroke="#d9d1f3"
    />
    {children}
  </svg>
);
const lines = (y: number, n: number) =>
  Array.from({ length: n }, (_, i) => (
    <rect
      key={i}
      x="54"
      y={y + i * 8}
      width={i % 3 === 2 ? 34 : 52}
      height="3"
      rx="1.5"
      fill="#d9d1f3"
    />
  ));
export const TOPICS: Topic[] = [
  {
    id: "xml-fiscal",
    title: "XML fiscal para PDF",
    summary:
      "Gere uma representação em PDF dos dados de um XML fiscal, inteiramente neste computador.",
    steps: [
      "Na aba Converter, clique em XML fiscal para PDF e escolha o arquivo .xml.",
      "O aplicativo identifica os leiautes reconhecidos: NF-e/NFC-e, NFS-e Nacional ou ABRASF e CF-e/SAT. Variações municipais de NFS-e podem não ser compatíveis.",
      "Confira os dados extraídos no PDF aberto. Você pode editar o texto e salvar o resultado como outro documento.",
      "Guarde o XML original: a conversão não o modifica e não consulta a SEFAZ nem confirma autorização ou autenticidade fiscal.",
    ],
    tip: "Um XML que não corresponda aos leiautes reconhecidos deve ser indicado como não compatível, sem inventar dados ausentes.",
    art: page(<>{lines(18, 7)}</>),
  },
  {
    id: "ia",
    title: "Google AI Studio: obter uma chave",
    summary: "Configure a chave Gemini e conheça as condições de uso gratuito.",
    steps: [],
    art: page(<>{lines(18, 5)}</>),
  },
  {
    id: "atalhos",
    title: "Atalhos de teclado e aba Início",
    summary:
      "Use combinações familiares de leitores PDF e personalize suas ferramentas.",
    steps: [
      "Abra Configurações → Atalhos e Início.",
      "Escolha as ferramentas da aba Início e altere a ordem pelas setas.",
      "Para mapear uma tecla, clique na combinação e pressione o novo atalho.",
      "Use Limpar antes de transferir uma combinação já usada por outra ação.",
    ],
    tip: "As personalizações são salvas imediatamente neste computador.",
    art: page(<>{lines(18, 5)}</>),
  },
  {
    id: "editar",
    title: "Editar o texto original (Editar tudo)",
    summary:
      "Altere palavras, tamanho, negrito, cor e alinhamento do próprio PDF, direto na página.",
    steps: [
      "Abra a aba Editar e clique em “Editar tudo”.",
      "Os blocos de texto ficam com contorno azul tracejado. Clique em um deles.",
      "Digite a correção. Ctrl+Enter aplica; Esc cancela.",
      "Use a barra de formatação logo abaixo para tamanho, negrito, cor e alinhamento. Arraste o ícone azul para mover o parágrafo.",
    ],
    tip: "Imagens originais têm contorno verde e podem ser arrastadas.",
    art: page(
      <>
        {lines(20, 3)}
        <rect
          x="51"
          y="44"
          width="58"
          height="22"
          fill="#4f8cff14"
          stroke="#4f8cff"
          strokeDasharray="3 2"
        />
        {lines(48, 2)}
        {lines(76, 3)}
      </>,
    ),
  },
  {
    id: "texto",
    title: "Caixas de texto, formas e destaques",
    summary:
      "Adicione anotações que você pode mover, redimensionar e editar a qualquer momento.",
    steps: [
      "Escolha Adicionar texto, Formas ou Destacar.",
      "Clique ou arraste na página para criar.",
      "Volte para Selecionar (ou clique de novo na ferramenta) para mover e ajustar.",
      "Dê dois cliques em uma caixa de texto para corrigir o conteúdo; a barra de formatação mostra fonte, tamanho e cor.",
    ],
    tip: "Para destacar, selecione o texto com o mouse. Em páginas escaneadas, arraste um retângulo.",
    art: page(
      <>
        {lines(16, 2)}
        <rect x="52" y="33" width="44" height="7" fill="#ffe06699" />
        {lines(34, 1)}
        <rect
          x="56"
          y="54"
          width="40"
          height="22"
          rx="3"
          fill="none"
          stroke="#e5484d"
          strokeWidth="2"
        />
        <path d="M100 86l12-10" stroke="#4f8cff" strokeWidth="2" />
      </>,
    ),
  },
  {
    id: "assinatura",
    title: "Assinaturas (imagem) e certificado digital ICP-Brasil",
    summary:
      "Use sua biblioteca de assinaturas desenhadas ou assine digitalmente com certificado A1/A3.",
    steps: [
      "Assinatura desenhada: aba Assinar → Minhas assinaturas → clique na assinatura → clique na página. Depois ajuste posição e tamanho.",
      "Certificado digital: aba Assinar → Certificado digital → desenhe a área do carimbo → escolha o certificado (o Windows pode pedir o PIN do token).",
      "Salve o arquivo assinado e, se quiser, confira em validar.iti.gov.br.",
    ],
    tip: "A assinatura digital deve ser a última etapa: qualquer edição depois dela invalida a assinatura.",
    art: page(
      <>
        {lines(16, 6)}
        <rect
          x="74"
          y="74"
          width="38"
          height="22"
          rx="2"
          fill="#3ecf6e22"
          stroke="#3ecf6e"
        />
        <path
          d="M78 88c6-10 10 6 16-4s6 4 12-2"
          stroke="#1a237e"
          fill="none"
          strokeWidth="1.5"
        />
      </>,
    ),
  },
  {
    id: "formularios",
    title: "Formulários: preencher e criar",
    summary:
      "Preencha formulários PDF e Adobe XFA, crie campos e exporte os dados.",
    steps: [
      "Para preencher: abra o PDF e clique nos campos azuis com a ferramenta Selecionar.",
      "Para criar: aba Formulário → escolha o tipo de campo → desenhe na página.",
      "“Reconhecer formulário” encontra linhas e caixas em branco e cria os campos sozinho.",
      "“Exportar dados” gera CSV, XML ou XFDF com as respostas.",
    ],
    tip: "Formulários XFA são convertidos ao abrir; salve com outro nome para manter o original.",
    art: page(
      <>
        {lines(14, 1)}
        <rect
          x="54"
          y="24"
          width="52"
          height="9"
          rx="1.5"
          fill="#4f8cff22"
          stroke="#4f8cff"
        />
        {lines(40, 1)}
        <rect
          x="54"
          y="50"
          width="52"
          height="9"
          rx="1.5"
          fill="#4f8cff22"
          stroke="#4f8cff"
        />
        <rect
          x="54"
          y="68"
          width="7"
          height="7"
          rx="1"
          fill="none"
          stroke="#4f8cff"
        />
        <path d="M55.5 71.5l2 2 3-4" stroke="#6d35d5" fill="none" />
      </>,
    ),
  },
  {
    id: "organizar",
    title: "Organizar páginas",
    summary:
      "Reordene, gire, exclua, extraia, substitua, divida e numere páginas.",
    steps: [
      "Abra a aba Organizar para ver a grade de páginas.",
      "Clique para selecionar (Ctrl para várias, Shift para intervalo) e use os botões laterais.",
      "Arraste páginas para reordenar ou para outra janela/aba.",
      "O botão + entre as páginas insere uma página em branco ou de outro arquivo.",
    ],
    art: (
      <svg viewBox="0 0 160 110" className="help-art" aria-hidden>
        {[0, 1, 2].map((i) => (
          <rect
            key={i}
            x={14 + i * 48}
            y="22"
            width="36"
            height="50"
            rx="3"
            fill="#fff"
            stroke={i === 1 ? "#7446e8" : "#d9d1f3"}
            strokeWidth={i === 1 ? 2 : 1}
          />
        ))}
        <path
          d="M92 86c-14 12-34 12-46 0"
          stroke="#7446e8"
          fill="none"
          markerEnd="url(#a)"
        />
        <defs>
          <marker
            id="a"
            markerWidth="6"
            markerHeight="6"
            refX="3"
            refY="3"
            orient="auto"
          >
            <path d="M0 0L6 3L0 6z" fill="#7446e8" />
          </marker>
        </defs>
      </svg>
    ),
  },
  {
    id: "proteger",
    title: "Proteger com senha",
    summary:
      "Criptografe com AES-256, exija senha para abrir e restrinja impressão, edição e cópia.",
    steps: [
      "Aba Proteger → Criptografar com senha.",
      "Defina a senha de abertura e/ou a senha de permissões com as restrições.",
      "Salve a cópia protegida; o arquivo aberto continua sem senha.",
    ],
    tip: "“Remover dados ocultos” apaga metadados, anexos, camadas ocultas e scripts antes de compartilhar.",
    art: page(
      <>
        {lines(16, 3)}
        <rect x="66" y="48" width="28" height="24" rx="4" fill="#7446e8" />
        <path
          d="M72 48v-7a8 8 0 0 1 16 0v7"
          stroke="#7446e8"
          strokeWidth="3"
          fill="none"
        />
        <circle cx="80" cy="60" r="3" fill="#fff" />
      </>,
    ),
  },
  {
    id: "converter",
    title: "Converter e comprimir",
    summary:
      "Exporte para Word, Excel, PowerPoint, imagens ou texto e reduza o tamanho do arquivo.",
    steps: [
      "Aba Converter → escolha o formato.",
      "No Word, “Layout preservado” mantém fundos, tabelas e imagens com o texto editável.",
      "Comprimir: escolha o nível (Sem perdas a Extrema) e clique em “Calcular tamanho” para comparar.",
    ],
    art: (
      <svg viewBox="0 0 160 110" className="help-art" aria-hidden>
        <rect
          x="18"
          y="20"
          width="44"
          height="60"
          rx="4"
          fill="#fff"
          stroke="#e5484d"
        />
        <text
          x="40"
          y="56"
          fontSize="11"
          textAnchor="middle"
          fill="#e5484d"
          fontWeight="700"
        >{" "}{translateUi("PDF")}{" "}</text>
        <path d="M70 50h20" stroke="#7446e8" strokeWidth="2" />
        <path d="M86 45l6 5-6 5" fill="none" stroke="#7446e8" strokeWidth="2" />
        <rect
          x="98"
          y="20"
          width="44"
          height="60"
          rx="4"
          fill="#fff"
          stroke="#2b5797"
        />
        <text
          x="120"
          y="56"
          fontSize="11"
          textAnchor="middle"
          fill="#2b5797"
          fontWeight="700"
        >{" "}{translateUi("DOCX")}{" "}</text>
      </svg>
    ),
  },
  {
    id: "rapido",
    title: "Ações rápidas, arrastar e soltar",
    summary:
      "Combine e converta pelo botão direito do Explorador e arraste arquivos para dentro do app.",
    steps: [
      "No Explorador, selecione arquivos → botão direito → GCP-PDF → Combinar em um PDF (no Windows 11, em “Mostrar mais opções”).",
      "Arraste PDFs, imagens ou documentos do Office para a janela: solte em “Abrir”, “Inserir antes” ou “Inserir depois” da página atual.",
      "Ctrl+K abre o localizador de ferramentas.",
    ],
    art: page(
      <>
        {lines(16, 6)}
        <rect
          x="20"
          y="58"
          width="30"
          height="38"
          rx="3"
          fill="#fff"
          stroke="#7446e8"
          strokeDasharray="3 2"
        />
        <path d="M50 70l14-6" stroke="#7446e8" />
      </>,
    ),
  },
];
export function HelpDialog({
  topic,
  onClose,
}: {
  topic?: string;
  onClose: () => void;
}) {
  const [current, setCurrent] = useState(topic ?? TOPICS[0]!.id),
    item = TOPICS.find((t) => t.id === current) ?? TOPICS[0]!;
  return (
    <div
      className="modal-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="help" role="dialog" aria-label={translateUi("Central de ajuda")}>
        <nav className="help-nav">
          <h2>
            <BookOpen size={17} />{" "}{translateUi("Central de ajuda")}{" "}</h2>
          {TOPICS.map((t) => (
            <button
              key={t.id}
              className={t.id === item.id ? "active" : ""}
              onClick={() => setCurrent(t.id)}
            >
              {translateUi(t.title)}
              <ChevronRight size={13} />
            </button>
          ))}
        </nav>
        <article className="help-body">
          <button
            className="help-close"
            aria-label={translateUi("Fechar ajuda")}
            onClick={onClose}
          >
            <X size={18} />
          </button>
          {item.art}
          <h3>{translateUi(item.title)}</h3>
          <p className="help-summary">{translateUi(item.summary)}</p>
          <ol>
            {item.steps.map((s, i) => (
              <li key={i}>{translateUi(s)}</li>
            ))}
          </ol>
          {item.id === "ia" && <GoogleApiHelp />}
          {item.id === "atalhos" && (
            <dl>
              {SHORTCUT_COMMANDS.map((command) => (
                <div
                  key={command.id}
                  style={{
                    display: "flex",
                    gap: 14,
                    justifyContent: "space-between",
                    padding: "5px 0",
                  }}
                >
                  <dt>{translateUi(command.label)}</dt>
                  <dd>
                    <kbd>{readShortcuts()[command.id] || "Sem atalho"}</kbd>
                  </dd>
                </div>
              ))}
            </dl>
          )}
          {item.tip && (
            <p className="help-tip">
              <strong>{translateUi("Dica:")}</strong> {translateUi(item.tip)}
            </p>
          )}
        </article>
      </div>
    </div>
  );
}
