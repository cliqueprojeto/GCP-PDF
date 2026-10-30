export const UI_PREFERENCES_EVENT = "gcp-ui-preferences-changed";
export const HOME_ACTIONS = [
  { id: "highlight", label: "Destacar" },
  { id: "shapes", label: "Formas" },
  { id: "edit-all", label: "Editar tudo" },
  { id: "add-text", label: "Adicionar texto" },
  { id: "ocr", label: "OCR" },
  { id: "compress", label: "Comprimir" },
  { id: "find", label: "Buscar" },
  { id: "ai", label: "IA" },
  { id: "ink", label: "Desenhar" },
  { id: "image", label: "Imagem" },
  { id: "signatures", label: "Minhas assinaturas" },
  { id: "stamps", label: "Carimbos" },
  { id: "rotate", label: "Girar páginas" },
  { id: "combine", label: "Combinar arquivos" },
  { id: "compare", label: "Comparar PDFs" },
  { id: "word", label: "Exportar para Word" },
] as const;
export const DEFAULT_HOME_ACTIONS = [
  "highlight",
  "shapes",
  "edit-all",
  "add-text",
  "ocr",
  "compress",
  "find",
  "ai",
];
export const SHORTCUT_COMMANDS = [
  { id: "open", label: "Abrir arquivos", keys: "Ctrl+O", scope: "Aplicativo" },
  { id: "new", label: "Novo documento", keys: "Ctrl+N", scope: "Aplicativo" },
  { id: "save", label: "Salvar", keys: "Ctrl+S", scope: "Documento" },
  {
    id: "save-as",
    label: "Salvar como",
    keys: "Ctrl+Shift+S",
    scope: "Documento",
  },
  { id: "print", label: "Imprimir", keys: "Ctrl+P", scope: "Documento" },
  {
    id: "close-tab",
    label: "Fechar documento",
    keys: "Ctrl+W",
    scope: "Documento",
  },
  { id: "undo", label: "Desfazer", keys: "Ctrl+Z", scope: "Documento" },
  { id: "redo", label: "Refazer", keys: "Ctrl+Shift+Z", scope: "Documento" },
  { id: "find", label: "Pesquisar texto", keys: "Ctrl+F", scope: "Documento" },
  {
    id: "properties",
    label: "Propriedades do documento",
    keys: "Ctrl+D",
    scope: "Documento",
  },
  { id: "reading", label: "Modo leitura", keys: "Ctrl+H", scope: "Documento" },
  {
    id: "fullscreen",
    label: "Tela cheia",
    keys: "Ctrl+L",
    scope: "Aplicativo",
  },
  {
    id: "delete-pages",
    label: "Excluir páginas selecionadas",
    keys: "Delete",
    scope: "Miniaturas (fora de campos de texto)",
  },
  {
    id: "zoom-in",
    label: "Aumentar zoom",
    keys: "Ctrl+Plus",
    scope: "Documento",
  },
  {
    id: "zoom-out",
    label: "Diminuir zoom",
    keys: "Ctrl+Minus",
    scope: "Documento",
  },
  { id: "zoom-reset", label: "Zoom 100%", keys: "Ctrl+0", scope: "Documento" },
  {
    id: "palette",
    label: "Localizar ferramentas",
    keys: "Ctrl+K",
    scope: "Aplicativo",
  },
  { id: "help", label: "Central de ajuda", keys: "F1", scope: "Aplicativo" },
  {
    id: "rotate",
    label: "Girar páginas à direita",
    keys: "Ctrl+Shift+R",
    scope: "Miniaturas",
  },
] as const;
export type ShortcutMap = Record<string, string>;
export const DEFAULT_SHORTCUTS: ShortcutMap = Object.fromEntries(
  SHORTCUT_COMMANDS.map((c) => [c.id, c.keys]),
);
const aliases: Record<string, string> = {
  control: "Ctrl",
  ctrl: "Ctrl",
  cmd: "Ctrl",
  command: "Ctrl",
  meta: "Ctrl",
  shift: "Shift",
  alt: "Alt",
  option: "Alt",
  del: "Delete",
  delete: "Delete",
  esc: "Escape",
  escape: "Escape",
  plus: "Plus",
  "=": "Plus",
  minus: "Minus",
  "-": "Minus",
  " ": "Space",
  space: "Space",
};
export function normalizeShortcut(value: string): string {
  if (!value.trim()) return "";
  const tokens = value
    .replace(/\+\+$/, "+Plus")
    .split("+")
    .map((x) => x.trim())
    .filter(Boolean)
    .map(
      (x) =>
        aliases[x.toLowerCase()] ||
        (/^[a-z]$/i.test(x)
          ? x.toUpperCase()
          : /^f\d+$/i.test(x)
            ? x.toUpperCase()
            : x),
    );
  const modifiers = ["Ctrl", "Alt", "Shift"].filter((m) => tokens.includes(m));
  const keys = tokens.filter((t) => !["Ctrl", "Alt", "Shift"].includes(t));
  if (keys.length !== 1) return "";
  return [...modifiers, keys[0]].join("+");
}
export function shortcutFromEvent(
  event: Pick<
    KeyboardEvent,
    "key" | "ctrlKey" | "metaKey" | "altKey" | "shiftKey"
  >,
): string {
  if (["Control", "Meta", "Alt", "Shift"].includes(event.key)) return "";
  const key = event.key === "+" ? "Plus" : event.key;
  return normalizeShortcut(
    [
      ...(event.ctrlKey || event.metaKey ? ["Ctrl"] : []),
      ...(event.altKey ? ["Alt"] : []),
      ...(event.shiftKey && event.key !== "+" ? ["Shift"] : []),
      key,
    ].join("+"),
  );
}
export function shortcutConflict(
  map: ShortcutMap,
  id: string,
  value: string,
): string | undefined {
  const normalized = normalizeShortcut(value);
  return normalized
    ? Object.keys(map).find(
        (other) =>
          other !== id && normalizeShortcut(map[other] || "") === normalized,
      )
    : undefined;
}
export function resolveShortcut(
  event: Pick<
    KeyboardEvent,
    "key" | "ctrlKey" | "metaKey" | "altKey" | "shiftKey"
  >,
  map = readShortcuts(),
): string | undefined {
  const key = shortcutFromEvent(event);
  return key
    ? SHORTCUT_COMMANDS.find(
        (command) =>
          map[command.id] && normalizeShortcut(map[command.id]) === key,
      )?.id
    : undefined;
}
function read(key: string): unknown {
  try {
    return JSON.parse(globalThis.localStorage?.getItem(key) || "null");
  } catch {
    return null;
  }
}
export function readShortcuts(): ShortcutMap {
  const stored = read("gcp.keyboard-shortcuts");
  const result = { ...DEFAULT_SHORTCUTS };
  if (stored && typeof stored === "object")
    for (const command of SHORTCUT_COMMANDS) {
      const value = (stored as ShortcutMap)[command.id];
      if (typeof value === "string")
        result[command.id] = normalizeShortcut(value);
    }
  return result;
}
export function readHomeActions(): string[] {
  const stored = read("gcp.home-actions");
  return Array.isArray(stored)
    ? [
        ...new Set(
          stored.filter((id) =>
            HOME_ACTIONS.some((action) => action.id === id),
          ),
        ),
      ]
    : [...DEFAULT_HOME_ACTIONS];
}
export function saveShortcuts(map: ShortcutMap) {
  const normalized = Object.fromEntries(
    SHORTCUT_COMMANDS.map((c) => [c.id, normalizeShortcut(map[c.id] || "")]),
  );
  for (const command of SHORTCUT_COMMANDS)
    if (shortcutConflict(normalized, command.id, normalized[command.id] || ""))
      throw new Error("Esse atalho já está associado a outro comando.");
  localStorage.setItem("gcp.keyboard-shortcuts", JSON.stringify(normalized));
  window.dispatchEvent(new Event(UI_PREFERENCES_EVENT));
}
export function saveHomeActions(ids: string[]) {
  localStorage.setItem(
    "gcp.home-actions",
    JSON.stringify(ids.filter((id) => HOME_ACTIONS.some((a) => a.id === id))),
  );
  window.dispatchEvent(new Event(UI_PREFERENCES_EVENT));
}
