import {t as translateUi} from "./i18n";
import React, { useEffect, useLayoutEffect, useRef, useState } from "react";
import {
  MousePointer2,
  Type,
  Highlighter,
  Underline,
  Strikethrough,
  PenLine,
  Image as ImageIcon,
  Square,
  Circle,
  Minus,
  ArrowUpRight,
  Spline,
  Cloud,
  Pentagon,
  Check,
  X,
  ChevronDown,
  ZoomIn,
  ZoomOut,
  ScanText,
  Search,
  Sparkles,
  RotateCcw,
  RotateCw,
  FilePlus2,
  Trash2,
  Layers3,
  SplitSquareHorizontal,
  FolderOpen,
  Home,
  FileText,
  Table2,
  Presentation,
  FileImage,
  FileType2,
  Signature as SignatureIcon,
  Bold,
  Italic,
  AlignLeft,
  AlignCenter,
  AlignRight,
  TextCursorInput,
  CalendarDays,
  SquareCheck,
  CircleDot,
  ListCollapse,
  List,
  RectangleHorizontal,
  ImagePlus,
  PenTool,
  ScanSearch,
  FileDown,
  Lock,
  Eraser,
  BadgeCheck,
  ShieldCheck,
  Command,
  Stamp as StampIcon,
  FileSignature,
  PencilLine,
  Files,
  Download,
  Save,
  Printer,
  Undo2,
  Redo2,
  Combine,
  FileInput,
  Maximize,
  Minimize2,
  Hash,
  MessageSquare,
  GitCompareArrows,
  BarChart3,
  FileCog,
  BookOpenText,
  Expand,
  PanelLeft,
  RectangleVertical,
  Columns2,
  BookOpen,
  MoveHorizontal,
  Sun,
  Moon,
  Pin,
  ChevronsUp,
  EyeOff,
  Receipt,
  Ruler
} from "lucide-react";
import { readHomeActions, UI_PREFERENCES_EVENT } from "../shared/shortcuts";
import type { PageObject, ShapeKind, ExportFormat } from "../shared/types";
import { PALETTE, SHAPES, type Style, type Tool } from "./editor";
import type { SourceSelection } from "./PageView";

export const TABS = [
  "Início",
  "Editar",
  "Comentário",
  "Organizar",
  "Formulário",
  "Converter",
  "Assinar",
  "Proteger",
  "Revisar",
  "Exibição",
  "IA",
] as const;
export type PageLayout = "single" | "double" | "cover";
export type ReadingFilter =
  | "none"
  | "sepia"
  | "warm"
  | "night"
  | "gray"
  | "contrast";
export type Tab = (typeof TABS)[number];
const SHAPE_ICONS: Record<ShapeKind, React.ReactNode> = {
  rect: <Square size={16} />,
  ellipse: <Circle size={16} />,
  line: <Minus size={16} />,
  arrow: <ArrowUpRight size={16} />,
  dimension: <Ruler size={16} />,
  polyline: <Spline size={16} />,
  cloud: <Cloud size={16} />,
  polygon: <Pentagon size={16} />,
  check: <Check size={16} />,
  cross: <X size={16} />,
};
export interface RibbonActions {
  home?(): void;
  open(): void;
  save(): void;
  saveAs(): void;
  print(): void;
  undo(): void;
  redo(): void;
  editImage(): void;
  zoom(factor: number): void;
  fit(): void;
  rotate(degrees: number): void;
  blank(): void;
  deletePages(): void;
  combineOpen(): void;
  quick(action: "combine" | "convert"): void;
  fiscalXml(): void;
  compare(): void;
  exportAs(format?: ExportFormat): void;
  ocr(): void;
  find(): void;
  ai(): void;
  signatures(): void;
  image(): void;
  deleteObjects(): void;
  stamps(): void;
  detectFields(): void;
  exportData(format: "csv" | "xml" | "xfdf"): void;
  protect(): void;
  removeHidden(): void;
  certificate(visible: boolean): void;
  checkSignatures(): void;
  palette(): void;
  restyle(patch: Partial<Style>): void;
  formatParagraph(patch: Record<string, unknown>): void;
  compress(): void;
  numbering(): void;
  zoomTo(value: number | "width" | "page"): void;
  ribbon(value: "pinned" | "collapsed" | "auto"): void;
  layout(value: PageLayout): void;
  filter(value: ReadingFilter): void;
  reading(): void;
  fullscreen(): void;
  sidebar(): void;
  theme(): void;
  compareFiles(): void;
  stats(): void;
  properties(): void;
  comment?(): void;
}
interface Props {
  tab: Tab;
  hasDocument: boolean;
  canUndo: boolean;
  canRedo: boolean;
  tool: Tool;
  setTool: (tool: Tool) => void;
  style: Style;
  selection: PageObject[];
  source: SourceSelection | null;
  pagesSelected: number;
  zoom: number;
  fonts: string[];
  labels: "below" | "side" | "hidden";
  actions: RibbonActions;
  layout: PageLayout;
  filter: ReadingFilter;
  ribbonMode: "pinned" | "collapsed" | "auto";
  dark: boolean;
}
function useOutside(open: boolean, close: () => void) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const handler = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) close();
    };
    window.addEventListener("pointerdown", handler);
    return () => window.removeEventListener("pointerdown", handler);
  }, [open]);
  return ref;
}
function Big({
  icon,
  label,
  active,
  disabled,
  onClick,
  title,
}: {
  icon: React.ReactNode;
  label: string;
  active?: boolean;
  disabled?: boolean;
  onClick: () => void;
  title?: string;
}) {
  return (
    <button
      className={`tool-button ${active ? "selected" : ""}`}
      disabled={disabled}
      onClick={onClick}
      title={title ?? label}
    >
      {icon}
      <span>{translateUi(label)}</span>
    </button>
  );
}
function Small({
  icon,
  title,
  active,
  disabled,
  onClick,
}: {
  icon: React.ReactNode;
  title: string;
  active?: boolean;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      className={`icon-button ${active ? "active" : ""}`}
      title={translateUi(title)}
      aria-label={translateUi(title)}
      aria-pressed={active || undefined}
      disabled={disabled}
      onClick={onClick}
    >
      {icon}
    </button>
  );
}
function ShapeMenu({
  tool,
  setTool,
  disabled,
}: {
  tool: Tool;
  setTool: (t: Tool) => void;
  disabled: boolean;
}) {
  const [open, setOpen] = useState(false),
    ref = useOutside(open, () => setOpen(false));
  const current = tool.kind === "shape" ? tool.shape : "rect";
  return (
    <div className="dropdown" ref={ref}>
      <button
        className={`tool-button split ${tool.kind === "shape" ? "selected" : ""}`}
        disabled={disabled}
        title={translateUi("Formas")}
        onClick={() => setTool({ kind: "shape", shape: current })}
      >
        {SHAPE_ICONS[current]}
        <span>{translateUi("Formas")}</span>
      </button>
      <button
        className="dropdown-caret"
        disabled={disabled}
        aria-label={translateUi("Escolher forma")}
        onClick={() => setOpen(!open)}
      >
        <ChevronDown size={12} />
      </button>
      {open && (
        <div className="dropdown-menu">
          {SHAPES.map((s) => (
            <button
              key={s.shape}
              className={
                current === s.shape && tool.kind === "shape" ? "active" : ""
              }
              onClick={() => {
                setTool({ kind: "shape", shape: s.shape });
                setOpen(false);
              }}
            >
              {SHAPE_ICONS[s.shape]} {s.label}
              {(s.shape === "polyline" || s.shape === "polygon") && (
                <small>{translateUi("duplo clique conclui")}</small>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
const MEASURES = [
  { measure: "distance" as const, shape: "dimension" as const, label: "Distância", hint: "arraste de um ponto a outro" },
  { measure: "perimeter" as const, shape: "polyline" as const, label: "Perímetro", hint: "clique os pontos · duplo clique conclui" },
  { measure: "area" as const, shape: "polygon" as const, label: "Área", hint: "clique os vértices · duplo clique conclui" },
];
const MEASURE_ICON = { distance: <Ruler size={18} />, perimeter: <Spline size={18} />, area: <Pentagon size={18} /> };
/** Measuring tools (cm), like Acrobat/PDFelement: distance, perimeter and area annotations. */
function MeasureMenu({ tool, setTool, disabled }: { tool: Tool; setTool: (t: Tool) => void; disabled: boolean }) {
  const [open, setOpen] = useState(false), ref = useOutside(open, () => setOpen(false));
  const active = tool.kind === "shape" && tool.measure ? tool.measure : null, current = MEASURES.find((m) => m.measure === (active ?? "distance"))!;
  return (
    <div className="dropdown" ref={ref}>
      <button className={`tool-button split ${active ? "selected" : ""}`} disabled={disabled} title={`Medir ${current.label.toLowerCase()} em centímetros`} onClick={() => setTool({ kind: "shape", shape: current.shape, measure: current.measure })}>
        {MEASURE_ICON[current.measure]}<span>{translateUi("Medir")}</span>
      </button>
      <button className="dropdown-caret" disabled={disabled} aria-label={translateUi("Escolher medida")} onClick={() => setOpen(!open)}><ChevronDown size={12} /></button>
      {open && (
        <div className="dropdown-menu">
          {MEASURES.map((m) => <button key={m.measure} className={active === m.measure ? "active" : ""} onClick={() => { setTool({ kind: "shape", shape: m.shape, measure: m.measure }); setOpen(false); }}>{MEASURE_ICON[m.measure]} {m.label}<small>{m.hint}</small></button>)}
        </div>
      )}
    </div>
  );
}
function EditMenu({
  tool,
  setTool,
  toggleTool,
  disabled,
}: {
  tool: Tool;
  setTool: (tool: Tool) => void;
  toggleTool: (tool: Tool) => void;
  disabled: boolean;
}) {
  const [open, setOpen] = useState(false),
    ref = useOutside(open, () => setOpen(false));
  const mode = tool.kind === "edit" ? (tool.mode ?? "all") : "all";
  const options = [
    {
      mode: "all" as const,
      label: "Editar tudo",
      icon: <PencilLine size={18} />,
      description: "Textos e imagens originais detectados na página",
    },
    {
      mode: "text" as const,
      label: "Texto",
      icon: <Type size={18} />,
      description: "Selecionar somente os blocos de texto original",
    },
    {
      mode: "images" as const,
      label: "Imagens",
      icon: <ImageIcon size={18} />,
      description: "Selecionar somente as imagens originais detectadas",
    },
  ];
  const current = options.find((option) => option.mode === mode)!;
  return (
    <div className="dropdown" ref={ref}>
      <button
        className={
          "tool-button split " + (tool.kind === "edit" ? "selected" : "")
        }
        disabled={disabled}
        onClick={() => toggleTool({ kind: "edit", mode })}
        title={current.description}
      >
        {current.icon}
        <span>
          {mode === "all"
            ? translateUi("Editar tudo")
            : mode === "text"
              ? translateUi("Editar texto")
              : translateUi("Editar imagens")}
        </span>
      </button>
      <button
        className="dropdown-caret"
        disabled={disabled}
        aria-label={translateUi("Escolher modo de edição")}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        <ChevronDown size={12} />
      </button>
      {open && (
        <div className="dropdown-menu" role="menu" aria-label={translateUi("Modos de edição")}>
          {options.map((option) => (
            <button
              key={option.mode}
              role="menuitemradio"
              aria-checked={tool.kind === "edit" && mode === option.mode}
              className={
                tool.kind === "edit" && mode === option.mode ? "active" : ""
              }
              title={option.description}
              onClick={() => {
                setTool({ kind: "edit", mode: option.mode });
                setOpen(false);
              }}
            >
              {option.icon}
              <span>{option.label}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
function HighlightMenu({
  tool,
  setTool,
  style,
  restyle,
  disabled,
}: {
  tool: Tool;
  setTool: (t: Tool) => void;
  style: Style;
  restyle: (p: Partial<Style>) => void;
  disabled: boolean;
}) {
  const [open, setOpen] = useState(false),
    ref = useOutside(open, () => setOpen(false));
  const active = tool.kind === "markup" && tool.style === "highlight";
  return (
    <div className="dropdown" ref={ref}>
      <button
        className={`tool-button split ${active ? "selected" : ""}`}
        disabled={disabled}
        title={translateUi("Destacar texto (selecione o trecho)")}
        onClick={() => setTool({ kind: "markup", style: "highlight" })}
      >
        <span
          className="highlight-icon"
          style={{ ["--swatch" as string]: style.highlight }}
        >
          <Highlighter size={17} />
        </span>
        <span>{translateUi("Destacar")}</span>
      </button>
      <button
        className="dropdown-caret"
        disabled={disabled}
        aria-label={translateUi("Cor do destaque")}
        onClick={() => setOpen(!open)}
      >
        <ChevronDown size={12} />
      </button>
      {open && (
        <div className="dropdown-menu palette-menu">
          <div className="swatches">
            {PALETTE.slice(0, 6).map((color) => (
              <button
                key={color}
                className={`swatch ${style.highlight === color ? "active" : ""}`}
                style={{ background: color }}
                title={color}
                onClick={() => {
                  restyle({ highlight: color });
                  setTool({ kind: "markup", style: "highlight" });
                }}
              />
            ))}
            <label className="swatch custom" title={translateUi("Outra cor")}>
              <input
                type="color"
                value={style.highlight}
                onChange={(e) => restyle({ highlight: e.target.value })}
              />
            </label>
          </div>
          <label className="slider-row">{" "}{translateUi("Opacidade")}{" "}<input
              type="range"
              min={0.15}
              max={1}
              step={0.05}
              value={style.highlightOpacity}
              onChange={(e) =>
                restyle({ highlightOpacity: Number(e.target.value) })
              }
            />
          </label>
        </div>
      )}
    </div>
  );
}
function Swatches({
  value,
  onChange,
  allowNone,
}: {
  value: string | null;
  onChange: (v: string | null) => void;
  allowNone?: boolean;
}) {
  return (
    <div className="swatches inline">
      {allowNone && (
        <button
          className={`swatch none ${value === null ? "active" : ""}`}
          title={translateUi("Sem preenchimento")}
          onClick={() => onChange(null)}
        />
      )}
      {PALETTE.map((color) => (
        <button
          key={color}
          className={`swatch ${value === color ? "active" : ""}`}
          style={{ background: color }}
          title={color}
          onClick={() => onChange(color)}
        />
      ))}
      <label className="swatch custom" title={translateUi("Outra cor")}>
        <input
          type="color"
          value={value ?? "#ffffff"}
          onChange={(e) => onChange(e.target.value)}
        />
      </label>
    </div>
  );
}
/** Properties of the active tool or of the selected objects. */
function PropertyBar({
  tool,
  style,
  selection,
  source,
  actions,
  fonts,
}: Pick<
  Props,
  "tool" | "style" | "selection" | "source" | "actions" | "fonts"
>) {
  const kinds = new Set(selection.map((o) => o.kind));
  if (source) {
    const p = source.paragraph;
    return (
      <div className="property-bar">
        <span className="property-title">
          <PencilLine size={15} />{" "}{translateUi("Texto original")}{" "}</span>
        <select
          title={translateUi("Fonte")}
          defaultValue=""
          onChange={(e) =>
            e.target.value && actions.formatParagraph({ font: e.target.value })
          }
        >
          <option value="">{p.font || "Fonte do documento"}</option>
          <option value="helvetica">{translateUi("Helvetica / Arial")}</option>
          <option value="times">{translateUi("Times")}</option>
          <option value="courier">{translateUi("Courier")}</option>
        </select>
        <label className="number-field" title={translateUi("Tamanho")}>
          <input
            type="number"
            min={4}
            max={200}
            step={0.5}
            defaultValue={Number(p.size.toFixed(1))}
            onKeyDown={(e) => {
              if (e.key === "Enter")
                actions.formatParagraph({
                  size: Number((e.target as HTMLInputElement).value),
                });
            }}
            onBlur={(e) =>
              Number(e.target.value) !== Number(p.size.toFixed(1)) &&
              actions.formatParagraph({ size: Number(e.target.value) })
            }
          />{" "}{translateUi("pt")}{" "}</label>
        <Small
          icon={<Bold size={15} />}
          title={translateUi("Negrito")}
          active={p.bold}
          onClick={() => actions.formatParagraph({ bold: !p.bold })}
        />
        <Small
          icon={<Italic size={15} />}
          title={translateUi("Itálico")}
          active={p.italic}
          onClick={() => actions.formatParagraph({ italic: !p.italic })}
        />
        <Small
          icon={<Underline size={15} />}
          title={translateUi("Sublinhado")}
          onClick={() => actions.formatParagraph({ underline: true })}
        />
        <label className="color-field" title={translateUi("Cor do texto")}>
          <input
            type="color"
            defaultValue={source.color}
            onChange={(e) => actions.formatParagraph({ color: e.target.value })}
          />
        </label>
        <Small
          icon={<AlignLeft size={15} />}
          title={translateUi("Alinhar à esquerda")}
          onClick={() => actions.formatParagraph({ align: "left" })}
        />
        <Small
          icon={<AlignCenter size={15} />}
          title={translateUi("Centralizar")}
          onClick={() => actions.formatParagraph({ align: "center" })}
        />
        <Small
          icon={<AlignRight size={15} />}
          title={translateUi("Alinhar à direita")}
          onClick={() => actions.formatParagraph({ align: "right" })}
        />
        <span className="property-hint">{" "}{translateUi("Edite o texto na página · Ctrl+Enter aplica · Esc cancela · arraste o ícone para mover")}{" "}</span>
      </div>
    );
  }
  const textual = tool.kind === "text" || kinds.has("text");
  const stroked =
    tool.kind === "shape" ||
    tool.kind === "ink" ||
    kinds.has("shape") ||
    kinds.has("ink") ||
    (tool.kind === "markup" && tool.style !== "highlight");
  const highlighting =
    (tool.kind === "markup" && tool.style === "highlight") ||
    selection.some((o) => o.kind === "markup" && o.style === "highlight");
  const fillable =
    (tool.kind === "shape" &&
      !["line", "arrow", "polyline", "check", "cross"].includes(tool.shape)) ||
    selection.some((o) => o.kind === "shape");
  if (!textual && !stroked && !highlighting) {
    if (!selection.length) return null;
    return (
      <div className="property-bar">
        <span className="property-title">
          {selection.length}{" "}{translateUi("objeto")}{selection.length > 1 ? translateUi("s") : ""}{" "}{translateUi("selecionado")}{" "}{selection.length > 1 ? translateUi("s") : ""}
        </span>
        {selection.length === 1 && selection[0]!.kind === "image" && (
          <button className="text-button" onClick={actions.editImage}>
            <ImageIcon size={14} />{" "}{translateUi("Editar imagem (recortar, girar, ajustes)")}{" "}</button>
        )}
        <button className="text-button danger" onClick={actions.deleteObjects}>
          <Trash2 size={14} />{" "}{translateUi("Excluir")}{" "}</button>
      </div>
    );
  }
  return (
    <div className="property-bar">
      {textual && (
        <>
          <span className="property-title">
            <Type size={15} />{" "}{translateUi("Texto")}{" "}</span>
          <select
            className="font-select"
            value={style.font}
            style={{
              fontFamily: ["sans", "serif", "mono"].includes(style.font)
                ? undefined
                : `"${style.font}"`,
            }}
            onChange={(e) => actions.restyle({ font: e.target.value })}
            title={translateUi("Fonte")}
          >
            <optgroup label={translateUi("Padrão do PDF")}>
              <option value="sans">{translateUi("Sem serifa (Helvetica)")}</option>
              <option value="serif">{translateUi("Com serifa (Times)")}</option>
              <option value="mono">{translateUi("Monoespaçada (Courier)")}</option>
            </optgroup>
            {fonts.length > 0 && (
              <optgroup label={`Instaladas neste computador (${fonts.length})`}>
                {fonts.map((family) => (
                  <option
                    key={family}
                    value={family}
                    style={{ fontFamily: `"${family}"` }}
                  >
                    {family}
                  </option>
                ))}
              </optgroup>
            )}
          </select>
          <label className="number-field" title={translateUi("Tamanho")}>
            <input
              type="number"
              min={4}
              max={200}
              value={style.size}
              onChange={(e) =>
                actions.restyle({
                  size: Math.max(4, Number(e.target.value) || 12),
                })
              }
            />{" "}{translateUi("pt")}{" "}</label>
          <Small
            icon={<Bold size={15} />}
            title={translateUi("Negrito")}
            active={style.bold}
            onClick={() => actions.restyle({ bold: !style.bold })}
          />
          <Small
            icon={<Italic size={15} />}
            title={translateUi("Itálico")}
            active={style.italic}
            onClick={() => actions.restyle({ italic: !style.italic })}
          />
          <Small
            icon={<AlignLeft size={15} />}
            title={translateUi("Alinhar à esquerda")}
            active={style.align === "left"}
            onClick={() => actions.restyle({ align: "left" })}
          />
          <Small
            icon={<AlignCenter size={15} />}
            title={translateUi("Centralizar")}
            active={style.align === "center"}
            onClick={() => actions.restyle({ align: "center" })}
          />
          <Small
            icon={<AlignRight size={15} />}
            title={translateUi("Alinhar à direita")}
            active={style.align === "right"}
            onClick={() => actions.restyle({ align: "right" })}
          />
          <span className="property-label">{translateUi("Cor")}</span>
          <Swatches
            value={style.textColor}
            onChange={(v) => actions.restyle({ textColor: v ?? "#1f1a2e" })}
          />
        </>
      )}
      {highlighting && (
        <>
          <span className="property-title">
            <Highlighter size={15} />{" "}{translateUi("Destaque")}{" "}</span>
          <Swatches
            value={style.highlight}
            onChange={(v) => actions.restyle({ highlight: v ?? "#ffe066" })}
          />
          <label className="slider-row">{" "}{translateUi("Opacidade")}{" "}<input
              type="range"
              min={0.15}
              max={1}
              step={0.05}
              value={style.highlightOpacity}
              onChange={(e) =>
                actions.restyle({ highlightOpacity: Number(e.target.value) })
              }
            />
            <b>{Math.round(style.highlightOpacity * 100)}%</b>
          </label>
        </>
      )}
      {stroked && (
        <>
          <span className="property-title">
            <PenLine size={15} />{" "}{translateUi("Contorno")}{" "}</span>
          <Swatches
            value={style.stroke}
            onChange={(v) => actions.restyle({ stroke: v ?? "#1f1a2e" })}
          />
          <label className="slider-row">{" "}{translateUi("Espessura")}{" "}<input
              type="range"
              min={0.5}
              max={16}
              step={0.5}
              value={style.strokeWidth}
              onChange={(e) =>
                actions.restyle({ strokeWidth: Number(e.target.value) })
              }
            />
            <b>{style.strokeWidth}{" "}{translateUi("pt")}</b>
          </label>
          {fillable && (
            <>
              <span className="property-label">{translateUi("Preenchimento")}</span>
              <Swatches
                value={style.fill}
                allowNone
                onChange={(v) => actions.restyle({ fill: v })}
              />
            </>
          )}
          <label className="slider-row">{" "}{translateUi("Opacidade")}{" "}<input
              type="range"
              min={0.1}
              max={1}
              step={0.05}
              value={style.opacity}
              onChange={(e) =>
                actions.restyle({ opacity: Number(e.target.value) })
              }
            />
            <b>{Math.round(style.opacity * 100)}%</b>
          </label>
        </>
      )}
      {selection.length > 0 && (
        <button className="text-button danger" onClick={actions.deleteObjects}>
          <Trash2 size={14} />{" "}{translateUi("Excluir")}{" "}</button>
      )}
    </div>
  );
}
const ZOOMS = [50, 75, 100, 125, 150, 200, 300, 400];
/** Zoom you can type (e.g. 135) or pick from common sizes. */
export function ZoomBox({
  zoom,
  onZoom,
  compact = false,
}: {
  zoom: number;
  onZoom: (value: number | "width" | "page") => void;
  compact?: boolean;
}) {
  const [text, setText] = useState(String(Math.round(zoom * 100))),
    [open, setOpen] = useState(false),
    ref = useOutside(open, () => setOpen(false));
  useEffect(() => setText(String(Math.round(zoom * 100))), [zoom]);
  const apply = () => {
    const value = Number(text.replace(/[^\d.,]/g, "").replace(",", "."));
    if (value >= 10 && value <= 800) onZoom(value / 100);
    else setText(String(Math.round(zoom * 100)));
  };
  return (
    <div className={`zoom-box ${compact ? "compact" : ""}`} ref={ref}>
      <input
        aria-label={translateUi("Zoom em porcentagem")}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onFocus={(e) => e.target.select()}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            apply();
            (e.target as HTMLInputElement).blur();
          }
          if (e.key === "Escape") setText(String(Math.round(zoom * 100)));
        }}
        onBlur={apply}
      />
      <span>%</span>
      <button aria-label={translateUi("Tamanhos de zoom")} onClick={() => setOpen(!open)}>
        <ChevronDown size={12} />
      </button>
      {open && (
        // Fixed position: the tool row scrolls horizontally and would otherwise clip the list.
        <div
          className="dropdown-menu zoom-menu"
          style={(() => {
            const r = ref.current?.getBoundingClientRect();
            return r
              ? compact
                ? {
                    position: "fixed",
                    left: r.left,
                    bottom: window.innerHeight - r.top + 4,
                    top: "auto",
                  }
                : { position: "fixed", left: r.left, top: r.bottom + 4 }
              : undefined;
          })()}
        >
          <button
            onClick={() => {
              onZoom("width");
              setOpen(false);
            }}
          >{" "}{translateUi("Ajustar à largura")}{" "}</button>
          <button
            onClick={() => {
              onZoom("page");
              setOpen(false);
            }}
          >{" "}{translateUi("Página inteira")}{" "}</button>
          {ZOOMS.map((z) => (
            <button
              key={z}
              className={Math.round(zoom * 100) === z ? "active" : ""}
              onClick={() => {
                onZoom(z / 100);
                setOpen(false);
              }}
            >
              {z}%
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
const same = (a: Tool, b: Tool) =>
  a.kind === b.kind &&
  (a.kind !== "shape" || (b.kind === "shape" && a.shape === b.shape)) &&
  (a.kind !== "markup" || (b.kind === "markup" && a.style === b.style)) &&
  (a.kind !== "edit" ||
    (b.kind === "edit" && (a.mode ?? "all") === (b.mode ?? "all")));
/** Keeps the tool row scrollable with visible arrows when it is wider than the window. */
function ScrollRow({
  children,
  className,
}: {
  children: React.ReactNode;
  className: string;
}) {
  const row = useRef<HTMLDivElement>(null),
    [edges, setEdges] = useState({ left: false, right: false });
  const measure = () => {
    const n = row.current;
    if (!n) return;
    const next = {
      left: n.scrollLeft > 2,
      right: n.scrollLeft + n.clientWidth < n.scrollWidth - 2,
    };
    // Only a real change re-renders; otherwise measuring after every render would loop forever.
    setEdges((old) =>
      old.left === next.left && old.right === next.right ? old : next,
    );
  };
  useLayoutEffect(() => {
    measure();
    const observer = new ResizeObserver(measure);
    if (row.current) {
      observer.observe(row.current);
      for (const child of row.current.children) observer.observe(child);
    }
    return () => observer.disconnect();
  }, [children]);
  const scroll = (dx: number) =>
    row.current?.scrollBy({ left: dx, behavior: "smooth" });
  return (
    <div className="scroll-row-host">
      {edges.left && (
        <button
          className="row-arrow left"
          aria-label={translateUi("Mais ferramentas à esquerda")}
          onClick={() => scroll(-260)}
        >
          <ChevronDown size={14} style={{ transform: "rotate(90deg)" }} />
        </button>
      )}
      <div
        ref={row}
        className={className}
        onScroll={measure}
        onWheel={(e) => {
          if (row.current && Math.abs(e.deltaY) > Math.abs(e.deltaX))
            row.current.scrollLeft += e.deltaY;
        }}
      >
        {children}
      </div>
      {edges.right && (
        <button
          className="row-arrow right"
          aria-label={translateUi("Mais ferramentas à direita")}
          onClick={() => scroll(260)}
        >
          <ChevronDown size={14} style={{ transform: "rotate(-90deg)" }} />
        </button>
      )}
    </div>
  );
}
export function Ribbon(props: Props) {
  const { tab, tool, actions, hasDocument: doc } = props,
    none = !doc;
  // Clicking the active tool again turns it off and returns to Select.
  const setTool = (next: Tool) =>
    props.setTool(
      same(tool, next) && next.kind !== "select" ? { kind: "select" } : next,
    );
  const [homeActions, setHomeActions] = useState(readHomeActions);
  useEffect(() => {
    const update = () => setHomeActions(readHomeActions());
    window.addEventListener(UI_PREFERENCES_EVENT, update);
    window.addEventListener("storage", update);
    return () => {
      window.removeEventListener(UI_PREFERENCES_EVENT, update);
      window.removeEventListener("storage", update);
    };
  }, []);
  const is = (kind: Tool["kind"]) => tool.kind === kind;
  const select = (
    <Big
      icon={<MousePointer2 size={17} />}
      label={translateUi("Selecionar")}
      active={is("select")}
      disabled={none}
      onClick={() => setTool({ kind: "select" })}
    />
  );
  const editAll = (
    <EditMenu
      tool={tool}
      setTool={props.setTool}
      toggleTool={setTool}
      disabled={none}
    />
  );
  const addText = (
    <Big
      icon={<Type size={18} />}
      label={translateUi("Adicionar texto")}
      active={is("text")}
      disabled={none}
      onClick={() => setTool({ kind: "text" })}
    />
  );
  const image = (
    <Big
      icon={<ImageIcon size={18} />}
      label={translateUi("Imagem")}
      active={is("stamp") && tool.kind === "stamp" && !tool.signature}
      disabled={none}
      onClick={actions.image}
    />
  );
  const ink = (
    <Big
      icon={<PenLine size={18} />}
      label={translateUi("Desenhar")}
      active={is("ink")}
      disabled={none}
      onClick={() => setTool({ kind: "ink" })}
    />
  );
  const markup = (
    style: "underline" | "strike",
    label: string,
    icon: React.ReactNode,
  ) => (
    <Big
      icon={icon}
      label={translateUi(label)}
      active={tool.kind === "markup" && tool.style === style}
      disabled={none}
      onClick={() => setTool({ kind: "markup", style })}
    />
  );
  const groups: Record<Tab, React.ReactNode> = {
    Início: (
      <>
        <div className="tool-group">
          {select}
          <Small
            icon={<ZoomOut size={17} />}
            title={translateUi("Diminuir zoom")}
            disabled={none}
            onClick={() => actions.zoom(1 / 1.15)}
          />
          <ZoomBox zoom={props.zoom} onZoom={actions.zoomTo} />
          <Small
            icon={<ZoomIn size={17} />}
            title={translateUi("Aumentar zoom")}
            disabled={none}
            onClick={() => actions.zoom(1.15)}
          />
          <Small
            icon={<Maximize size={16} />}
            title={translateUi("Ajustar à largura")}
            disabled={none}
            onClick={actions.fit}
          />
        </div>
        <div className="tool-group">
          {homeActions.map((id) => (
            <React.Fragment key={id}>
              {
                (
                  {
                    highlight: (
                      <HighlightMenu
                        tool={tool}
                        setTool={setTool}
                        style={props.style}
                        restyle={actions.restyle}
                        disabled={none}
                      />
                    ),
                    shapes: (
                      <ShapeMenu
                        tool={tool}
                        setTool={setTool}
                        disabled={none}
                      />
                    ),
                    "edit-all": editAll,
                    "add-text": addText,
                    ink,
                    image,
                    ocr: (
                      <Big
                        icon={<ScanText size={18} />}
                        label={translateUi("OCR")}
                        disabled={none}
                        onClick={actions.ocr}
                      />
                    ),
                    compress: (
                      <Big
                        icon={<Minimize2 size={18} />}
                        label={translateUi("Comprimir")}
                        disabled={none}
                        onClick={actions.compress}
                      />
                    ),
                    find: (
                      <Big
                        icon={<Search size={18} />}
                        label={translateUi("Buscar")}
                        disabled={none}
                        onClick={actions.find}
                      />
                    ),
                    ai: (
                      <Big
                        icon={<Sparkles size={18} />}
                        label={translateUi("IA")}
                        onClick={actions.ai}
                      />
                    ),
                    signatures: (
                      <Big
                        icon={<SignatureIcon size={18} />}
                        label={translateUi("Minhas assinaturas")}
                        onClick={actions.signatures}
                      />
                    ),
                    stamps: (
                      <Big
                        icon={<StampIcon size={18} />}
                        label={translateUi("Carimbos")}
                        disabled={none}
                        onClick={actions.stamps}
                      />
                    ),
                    rotate: (
                      <Big
                        icon={<RotateCw size={18} />}
                        label={translateUi("Girar páginas")}
                        disabled={none}
                        onClick={() => actions.rotate(90)}
                      />
                    ),
                    combine: (
                      <Big
                        icon={<Combine size={18} />}
                        label={translateUi("Combinar arquivos")}
                        onClick={() => actions.quick("combine")}
                      />
                    ),
                    compare: (
                      <Big
                        icon={<GitCompareArrows size={18} />}
                        label={translateUi("Comparar PDFs")}
                        disabled={none}
                        onClick={actions.compareFiles}
                      />
                    ),
                    word: (
                      <Big
                        icon={<FileText size={18} />}
                        label={translateUi("Para Word")}
                        disabled={none}
                        onClick={() => actions.exportAs("docx")}
                      />
                    ),
                  } as Record<string, React.ReactNode>
                )[id]
              }
            </React.Fragment>
          ))}
        </div>
      </>
    ),
    Editar: (
      <div className="tool-group">
        {select}
        {editAll}
        {addText}
        {image}
      </div>
    ),
    Comentário: (
      <>
        <div className="tool-group">
          <Big
            icon={<MessageSquare size={18} />}
            label={translateUi("Adicionar comentário")}
            active={tool.kind === "note"}
            title={translateUi("Clique na página onde deseja deixar o comentário")}
            disabled={none || !actions.comment}
            onClick={() => actions.comment?.()}
          />
        </div>
        <div className="tool-group">
          {select}
          <HighlightMenu
            tool={tool}
            setTool={setTool}
            style={props.style}
            restyle={actions.restyle}
            disabled={none}
          />
          {markup("underline", "Sublinhar", <Underline size={18} />)}
          {markup("strike", "Tachar", <Strikethrough size={18} />)}
        </div>
        <div className="tool-group">
          <Big
            icon={<Type size={18} />}
            label={translateUi("Caixa de texto")}
            active={is("text")}
            disabled={none}
            onClick={() => setTool({ kind: "text" })}
          />
          <Big
            icon={<StampIcon size={18} />}
            label={translateUi("Carimbos")}
            disabled={none}
            onClick={actions.stamps}
          />
          <ShapeMenu tool={tool} setTool={setTool} disabled={none} />
          <MeasureMenu tool={tool} setTool={setTool} disabled={none} />
          {ink}
        </div>
      </>
    ),
    Organizar: (
      <>
        <div className="tool-group">
          <Big
            icon={<RotateCcw size={18} />}
            label={translateUi("Girar à esquerda")}
            disabled={none}
            onClick={() => actions.rotate(-90)}
          />
          <Big
            icon={<RotateCw size={18} />}
            label={translateUi("Girar à direita")}
            disabled={none}
            onClick={() => actions.rotate(90)}
          />
          <Big
            icon={<FilePlus2 size={18} />}
            label={translateUi("Página em branco")}
            disabled={none}
            onClick={actions.blank}
          />
          <Big
            icon={<Trash2 size={18} />}
            label={translateUi("Excluir páginas")}
            disabled={none || !props.pagesSelected}
            onClick={actions.deletePages}
          />
          <Big
            icon={<Hash size={18} />}
            label={translateUi("Numerar páginas")}
            disabled={none}
            onClick={actions.numbering}
          />
          <Big
            icon={<Minimize2 size={18} />}
            label={translateUi("Comprimir")}
            disabled={none}
            onClick={actions.compress}
          />
        </div>
        <div className="tool-group">
          <Big
            icon={<Layers3 size={18} />}
            label={translateUi("Combinar abertos")}
            disabled={none}
            onClick={actions.combineOpen}
          />
          <Big
            icon={<Combine size={18} />}
            label={translateUi("Combinar arquivos")}
            onClick={() => actions.quick("combine")}
          />
          <Big
            icon={<FolderOpen size={18} />}
            label={translateUi("Abrir outro")}
            onClick={actions.open}
          />
        </div>
      </>
    ),
    Converter: (
      <>
        <div className="tool-group">
          <Big
            icon={<FileInput size={18} />}
            label={translateUi("XML fiscal para PDF")}
            onClick={actions.fiscalXml}
            title={translateUi("Converter XML de NF-e, NFC-e, NFS-e ou CF-e/SAT em um PDF local")}
          />
          <Big
            icon={<FileText size={18} />}
            label={translateUi("Para Word")}
            disabled={none}
            onClick={() => actions.exportAs("docx")}
          />
          <Big
            icon={<Table2 size={18} />}
            label={translateUi("Para Excel")}
            disabled={none}
            onClick={() => actions.exportAs("xlsx")}
          />
          <Big
            icon={<Presentation size={18} />}
            label={translateUi("Para PowerPoint")}
            disabled={none}
            onClick={() => actions.exportAs("pptx")}
          />
          <Big
            icon={<ImageIcon size={18} />}
            label={translateUi("Para imagem")}
            disabled={none}
            onClick={() => actions.exportAs("png")}
          />
          <Big
            icon={<FileImage size={18} />}
            label={translateUi("PDF de imagens")}
            disabled={none}
            onClick={() => actions.exportAs("image-pdf")}
          />
          <Big
            icon={<FileType2 size={18} />}
            label={translateUi("Para texto")}
            disabled={none}
            onClick={() => actions.exportAs("txt")}
          />
        </div>
        <div className="tool-group">
          <Big
            icon={<FileInput size={18} />}
            label={translateUi("Arquivos para PDF")}
            onClick={() => actions.quick("convert")}
          />
          <Big
            icon={<ScanText size={18} />}
            label={translateUi("OCR")}
            disabled={none}
            onClick={actions.ocr}
          />
        </div>
      </>
    ),
    Assinar: (
      <>
        <div className="tool-group">
          {select}
          <Big
            icon={<SignatureIcon size={18} />}
            label={translateUi("Minhas assinaturas")}
            onClick={actions.signatures}
          />
          <Big
            icon={<Type size={18} />}
            label={translateUi("Texto / data")}
            active={is("text")}
            disabled={none}
            onClick={() => setTool({ kind: "text" })}
          />
        </div>
        <div className="tool-group">
          <Big
            icon={<BadgeCheck size={18} />}
            label={translateUi("Certificado digital")}
            active={is("sign-area")}
            disabled={none}
            onClick={() => setTool({ kind: "sign-area" })}
            title={translateUi("Desenhe a área do carimbo e assine com seu certificado ICP-Brasil (A1/A3)")}
          />
          <Big
            icon={<FileSignature size={18} />}
            label={translateUi("Assinatura invisível")}
            disabled={none}
            onClick={() => actions.certificate(false)}
          />
          <Big
            icon={<ShieldCheck size={18} />}
            label={translateUi("Verificar assinaturas")}
            disabled={none}
            onClick={actions.checkSignatures}
          />
        </div>
      </>
    ),
    Formulário: (
      <>
        <div className="tool-group">
          {select}
          {(
            [
              ["text", "Texto", <TextCursorInput size={18} />],
              ["date", "Data", <CalendarDays size={18} />],
              ["checkbox", "Seleção", <SquareCheck size={18} />],
              ["radio", "Opção", <CircleDot size={18} />],
              ["combo", "Lista suspensa", <ListCollapse size={18} />],
              ["list", "Caixa de lista", <List size={18} />],
              ["button", "Botão", <RectangleHorizontal size={18} />],
              ["image", "Imagem", <ImagePlus size={18} />],
              ["signature", "Assinatura", <PenTool size={18} />],
            ] as const
          ).map(([field, label, icon]) => (
            <Big
              key={field}
              icon={icon}
              label={translateUi(label)}
              active={tool.kind === "field" && tool.field === field}
              disabled={none}
              onClick={() => setTool({ kind: "field", field })}
              title={`Desenhe um campo de ${label.toLowerCase()} na página`}
            />
          ))}
        </div>
        <div className="tool-group">
          <Big
            icon={<ScanSearch size={18} />}
            label={translateUi("Reconhecer formulário")}
            disabled={none}
            onClick={actions.detectFields}
            title={translateUi("Encontra linhas, caixas e espaços em branco e cria os campos automaticamente")}
          />
          <Big
            icon={<FileDown size={18} />}
            label={translateUi("Exportar dados (CSV)")}
            disabled={none}
            onClick={() => actions.exportData("csv")}
          />
          <Big
            icon={<FileDown size={18} />}
            label={translateUi("XML / XFDF")}
            disabled={none}
            onClick={() => actions.exportData("xfdf")}
          />
        </div>
      </>
    ),
    Proteger: (
      <div className="tool-group">
        <Big
          icon={<Lock size={18} />}
          label={translateUi("Criptografar com senha")}
          disabled={none}
          onClick={actions.protect}
        />
        <Big
          icon={<Eraser size={18} />}
          label={translateUi("Remover dados ocultos")}
          disabled={none}
          onClick={actions.removeHidden}
          title={translateUi("Metadados, anexos, camadas ocultas, scripts e dados privados")}
        />
      </div>
    ),
    Revisar: (
      <div className="tool-group">
        <Big
          icon={<SplitSquareHorizontal size={18} />}
          label={translateUi("Comparar em nova janela")}
          disabled={none}
          onClick={actions.compare}
        />
        <Big
          icon={<GitCompareArrows size={18} />}
          label={translateUi("Comparar PDFs")}
          onClick={actions.compareFiles}
          title={translateUi("Mostra lado a lado todas as diferenças de texto entre duas versões")}
        />
        <Big
          icon={<BarChart3 size={18} />}
          label={translateUi("Estatísticas")}
          disabled={none}
          onClick={actions.stats}
          title={translateUi("Palavras, caracteres, páginas e o que mais pesa no arquivo")}
        />
        <Big
          icon={<FileCog size={18} />}
          label={translateUi("Propriedades")}
          disabled={none}
          onClick={actions.properties}
          title={translateUi("Título, autor, assunto, palavras-chave e demais metadados")}
        />
      </div>
    ),
    Exibição: (
      <>
        <div className="tool-group">
          <Big
            icon={<BookOpenText size={18} />}
            label={translateUi("Modo leitura")}
            disabled={none}
            onClick={actions.reading}
            title={translateUi("Leitura sem distrações na janela atual · Esc para sair")}
          />
          <Big
            icon={<Expand size={18} />}
            label={translateUi("Tela cheia")}
            onClick={actions.fullscreen}
            title={translateUi("Tela cheia · F11")}
          />
          <Big
            icon={<PanelLeft size={18} />}
            label={translateUi("Painel lateral")}
            onClick={actions.sidebar}
          />
        </div>
        <div className="tool-group">
          <Big
            icon={<Pin size={18} />}
            label={translateUi("Faixa fixa")}
            active={props.ribbonMode === "pinned"}
            onClick={() => actions.ribbon("pinned")}
          />
          <Big
            icon={<ChevronsUp size={18} />}
            label={translateUi("Recolher faixa")}
            active={props.ribbonMode === "collapsed"}
            onClick={() => actions.ribbon("collapsed")}
            title={translateUi("Mostra só as guias · Ctrl+F1")}
          />
          <Big
            icon={<EyeOff size={18} />}
            label={translateUi("Ocultar auto.")}
            active={props.ribbonMode === "auto"}
            onClick={() => actions.ribbon("auto")}
            title={translateUi("A faixa aparece ao passar o mouse no topo")}
          />
        </div>
        <div className="tool-group">
          <Big
            icon={<RectangleVertical size={18} />}
            label={translateUi("Uma página")}
            active={props.layout === "single"}
            disabled={none}
            onClick={() => actions.layout("single")}
          />
          <Big
            icon={<Columns2 size={18} />}
            label={translateUi("Duas páginas")}
            active={props.layout === "double"}
            disabled={none}
            onClick={() => actions.layout("double")}
          />
          <Big
            icon={<BookOpen size={18} />}
            label={translateUi("Livro (com capa)")}
            active={props.layout === "cover"}
            disabled={none}
            onClick={() => actions.layout("cover")}
            title={translateUi("Duas páginas, com a capa sozinha, como um livro aberto")}
          />
          <Big
            icon={<MoveHorizontal size={18} />}
            label={translateUi("Ajustar largura")}
            disabled={none}
            onClick={() => actions.zoomTo("width")}
          />
          <Big
            icon={<Maximize size={18} />}
            label={translateUi("Página inteira")}
            disabled={none}
            onClick={() => actions.zoomTo("page")}
          />
        </div>
        <div className="tool-group">
          {(
            [
              ["none", "Normal", "#ffffff"],
              ["sepia", "Sépia", "#f1e3c6"],
              ["warm", "Papel", "#fbf3e2"],
              ["night", "Noturno", "#1d1b26"],
              ["gray", "Cinza", "#c9c9c9"],
              ["contrast", "Contraste", "#000000"],
            ] as const
          ).map(([value, label, swatch]) => (
            <Big
              key={value}
              icon={
                <span
                  className="filter-swatch"
                  style={{ background: swatch }}
                />
              }
              label={translateUi(label)}
              active={props.filter === value}
              onClick={() => actions.filter(value)}
              title={`Filtro de leitura: ${translateUi(label)}`}
            />
          ))}
          <Big
            icon={props.dark ? <Sun size={18} /> : <Moon size={18} />}
            label={props.dark ? translateUi("Tema claro") : translateUi("Tema escuro")}
            onClick={actions.theme}
          />
        </div>
      </>
    ),
    IA: (
      <div className="tool-group">
        <Big
          icon={<Sparkles size={18} />}
          label={translateUi("Assistente de IA")}
          onClick={actions.ai}
        />
      </div>
    ),
  };
  return (
    <>
      <ScrollRow className={`toolbar labels-${props.labels}`}>
        <div className="tool-group">
          {actions.home && <Small icon={<Home size={18} />} title={translateUi("Página inicial")} onClick={actions.home} />}
          <Small
            icon={<FolderOpen size={18} />}
            title={translateUi("Abrir · Ctrl+O")}
            onClick={actions.open}
          />
          <Small
            icon={<Save size={18} />}
            title={translateUi("Salvar · Ctrl+S")}
            disabled={none}
            onClick={actions.save}
          />
          <Small icon={<Save size={18} />} title={translateUi("Salvar como · Ctrl+Shift+S")} disabled={none} onClick={actions.saveAs} />
          <Small
            icon={<Download size={18} />}
            title={translateUi("Exportar (Word, Excel, PowerPoint, imagem…) · Ctrl+E")}
            disabled={none}
            onClick={() => actions.exportAs()}
          />
          <Small
            icon={<Printer size={18} />}
            title={translateUi("Imprimir · Ctrl+P")}
            disabled={none}
            onClick={actions.print}
          />
          <Small
            icon={<Undo2 size={18} />}
            title={translateUi("Desfazer · Ctrl+Z")}
            disabled={!props.canUndo}
            onClick={actions.undo}
          />
          <Small
            icon={<Redo2 size={18} />}
            title={translateUi("Refazer · Ctrl+Y")}
            disabled={!props.canRedo}
            onClick={actions.redo}
          />
        </div>
        {groups[tab]}
        <div className="toolbar-spacer" />
      </ScrollRow>
      <PropertyBar
        tool={tool}
        style={props.style}
        selection={props.selection}
        source={props.source}
        actions={actions}
        fonts={props.fonts}
      />
    </>
  );
}
